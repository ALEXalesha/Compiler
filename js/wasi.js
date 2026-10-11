// A small WASI (preview1) host for programs compiled from C and C++: standard input from a
// prepared buffer, standard output and errors to callbacks, clocks, random numbers and exit.
// There is no file system: the programs are console programs, and wasi-libc copes with "no
// preopened folders". Calls the program does not need here answer ENOSYS.
//
// The whole module is one function, wasiFactory: the page puts its source text into the worker
// that runs the program (workers from Blob cannot load files when the page is opened from disk),
// and Node loads the same function for unit checks.
(function (root) {
'use strict';

function wasiFactory() {
  const ERRNO = { SUCCESS: 0, BADF: 8, INVAL: 28, NOSYS: 52, SPIPE: 70 };

  class WasiExit extends Error {
    constructor(code) { super('exit ' + code); this.code = code; }
  }

  // opts: { args: [], env: {}, stdin: Uint8Array, write(fd, bytes), more() -> Uint8Array | null }
  // more - when stdin is read out: the next piece of input (a typed line), null - end of input.
  function createWasi(opts) {
    const args = opts.args || ['main'];
    const env = Object.entries(opts.env || {}).map(([k, v]) => k + '=' + v);
    let stdin = opts.stdin || new Uint8Array(0);
    let stdinPos = 0;
    let stdinEnded = !opts.more;
    let memory = null;
    const enc = new TextEncoder();
    const view = () => new DataView(memory.buffer);
    const bytes = () => new Uint8Array(memory.buffer);

    function strings(list, ptrs, buf) {
      const dv = view();
      const mem = bytes();
      for (const s of list) {
        const b = enc.encode(s + '\0');
        dv.setUint32(ptrs, buf, true);
        mem.set(b, buf);
        ptrs += 4;
        buf += b.length;
      }
      return ERRNO.SUCCESS;
    }
    function sizes(list, countPtr, sizePtr) {
      const dv = view();
      dv.setUint32(countPtr, list.length, true);
      dv.setUint32(sizePtr, list.reduce((n, s) => n + enc.encode(s).length + 1, 0), true);
      return ERRNO.SUCCESS;
    }
    function nowNs(id) {
      // 0 - realtime, 1 - monotonic, 2/3 - process/thread CPU time (monotonic is close enough)
      if (id === 0) return BigInt(Date.now()) * 1000000n;
      return BigInt(Math.round(performance.now() * 1e6));
    }

    const wasi = {
      args_get: (argv, buf) => strings(args, argv, buf),
      args_sizes_get: (c, s) => sizes(args, c, s),
      environ_get: (envp, buf) => strings(env, envp, buf),
      environ_sizes_get: (c, s) => sizes(env, c, s),

      fd_write(fd, iovs, iovsLen, nwritten) {
        if (fd !== 1 && fd !== 2) return ERRNO.BADF;
        const dv = view();
        let total = 0;
        for (let i = 0; i < iovsLen; i++) {
          const ptr = dv.getUint32(iovs + i * 8, true);
          const len = dv.getUint32(iovs + i * 8 + 4, true);
          if (len) opts.write(fd, bytes().slice(ptr, ptr + len));
          total += len;
        }
        view().setUint32(nwritten, total, true);
        return ERRNO.SUCCESS;
      },
      fd_read(fd, iovs, iovsLen, nread) {
        if (fd !== 0) return ERRNO.BADF;
        if (stdinPos >= stdin.length && !stdinEnded) {
          const piece = opts.more();
          if (piece === null) stdinEnded = true;
          else { stdin = piece; stdinPos = 0; }
        }
        const dv = view();
        let total = 0;
        for (let i = 0; i < iovsLen && stdinPos < stdin.length; i++) {
          const ptr = dv.getUint32(iovs + i * 8, true);
          const len = dv.getUint32(iovs + i * 8 + 4, true);
          const chunk = stdin.subarray(stdinPos, stdinPos + len);
          bytes().set(chunk, ptr);
          stdinPos += chunk.length;
          total += chunk.length;
        }
        view().setUint32(nread, total, true);
        return ERRNO.SUCCESS;       // 0 bytes read = end of input
      },
      fd_fdstat_get(fd, ptr) {
        if (fd > 2) return ERRNO.BADF;
        const dv = view();
        dv.setUint8(ptr, 2);                         // character device
        dv.setUint16(ptr + 2, fd === 0 ? 0 : 1, true);   // stdout/stderr: append
        dv.setBigUint64(ptr + 8, 0xffffffffffffffffn, true);
        dv.setBigUint64(ptr + 16, 0xffffffffffffffffn, true);
        return ERRNO.SUCCESS;
      },
      fd_fdstat_set_flags: () => ERRNO.SUCCESS,
      fd_filestat_get(fd, ptr) {
        if (fd > 2) return ERRNO.BADF;
        const mem = bytes();
        mem.fill(0, ptr, ptr + 64);
        view().setUint8(ptr + 16, 2);                // filetype: character device
        return ERRNO.SUCCESS;
      },
      fd_close: (fd) => (fd > 2 ? ERRNO.BADF : ERRNO.SUCCESS),
      fd_seek: (fd) => (fd > 2 ? ERRNO.BADF : ERRNO.SPIPE),
      fd_tell: (fd) => (fd > 2 ? ERRNO.BADF : ERRNO.SPIPE),
      fd_sync: () => ERRNO.SUCCESS,
      fd_datasync: () => ERRNO.SUCCESS,
      fd_prestat_get: () => ERRNO.BADF,              // no preopened folders
      fd_prestat_dir_name: () => ERRNO.BADF,

      clock_res_get(id, ptr) { view().setBigUint64(ptr, 1000n, true); return ERRNO.SUCCESS; },
      clock_time_get(id, precision, ptr) { view().setBigUint64(ptr, nowNs(id), true); return ERRNO.SUCCESS; },
      random_get(ptr, len) {
        const mem = bytes();
        for (let off = 0; off < len; off += 65536) {
          crypto.getRandomValues(mem.subarray(ptr + off, ptr + Math.min(len, off + 65536)));
        }
        return ERRNO.SUCCESS;
      },
      sched_yield: () => ERRNO.SUCCESS,
      // sleep(), usleep(), this_thread::sleep_for: clock subscriptions. The worker has nothing
      // else to do, so it waits in place; reading subscriptions are "ready" at once.
      poll_oneoff(inPtr, outPtr, nsubs, neventsPtr) {
        const dv = view();
        let waitUntil = 0;
        for (let i = 0; i < nsubs; i++) {
          const s = inPtr + i * 48;
          const userdata = dv.getBigUint64(s, true);
          const tag = dv.getUint8(s + 8);
          if (tag === 0) {
            const timeout = dv.getBigUint64(s + 24, true);
            const flags = dv.getUint16(s + 40, true);
            const id = dv.getUint32(s + 16, true);
            const nowMs = id === 0 ? Date.now() : performance.now();
            const end = (flags & 1) ? Number(timeout / 1000000n) : nowMs + Number(timeout / 1000000n);
            waitUntil = Math.max(waitUntil, end - nowMs + performance.now());
          }
          const e = outPtr + i * 32;
          dv.setBigUint64(e, userdata, true);
          dv.setUint16(e + 8, 0, true);
          dv.setUint8(e + 10, tag);
        }
        while (performance.now() < waitUntil) { /* waiting */ }
        dv.setUint32(neventsPtr, nsubs, true);
        return ERRNO.SUCCESS;
      },
      proc_exit(code) { throw new WasiExit(code); },
      proc_raise: () => ERRNO.NOSYS,
    };

    return {
      // Imports for this module: everything it asks from wasi_snapshot_preview1 that is not
      // above answers ENOSYS (files, sockets) instead of failing to instantiate.
      imports(module) {
        const ns = {};
        for (const imp of WebAssembly.Module.imports(module)) {
          if (imp.module !== 'wasi_snapshot_preview1' || imp.kind !== 'function') continue;
          ns[imp.name] = wasi[imp.name] || (() => ERRNO.NOSYS);
        }
        return { wasi_snapshot_preview1: ns };
      },
      // Runs _start; returns the exit code. Traps (RuntimeError) are thrown on.
      start(instance) {
        memory = instance.exports.memory;
        try {
          instance.exports._start();
          return 0;
        } catch (e) {
          if (e instanceof WasiExit) return e.code;
          throw e;
        }
      },
      stdinUsed: () => stdinPos,
    };
  }

  return { createWasi, WasiExit, ERRNO };
}

if (typeof module === 'object' && module.exports) module.exports = { wasiFactory };
else root.wasiFactory = wasiFactory;
})(typeof self !== 'undefined' ? self : this);
