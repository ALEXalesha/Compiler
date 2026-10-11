// Runners: how a program of each language is checked and run. Every program runs in its own
// Web Worker, so an endless loop does not hang the page: the time limit or the Stop button
// terminates the worker. Engines (compilers, interpreters) load on first use of the language.
//
// Common interface:
//   prepare()                 - load the engine (idempotent); state goes loading -> ready/failed
//   run(job) -> Promise<Result>
//     job: { files: {name: text}, entry, stdin, timeoutMs, out(text), err(text), echo(text), info(text) }
//     Result: { status: 'ok' | 'error' | 'compile-error' | 'timeout' | 'stopped' | 'failed',
//               code, ms, compileMs, diagnostics: [{ file, line, col, severity, message }] }
//   stop()                    - stop the current run
// Workers are made from Blob sources (the page may be opened from disk, where Worker from a
// file is not allowed): their code is the source text of the functions below.
(function (root) {
'use strict';

const Packs = root.CompilerPacks;
const now = () => performance.now();

// ---------------------------------------------------------------------------------------
// A worker that runs one program. Resolves on its 'done' message, on an error the worker
// could not report itself (a syntax error in the worker script), on the time limit or on stop.
class Run {
  // source: the worker's script text, or a ready Worker (the Ruby spare)
  constructor(source, job, handlers) {
    this.job = job;
    this.handlers = handlers || {};
    if (typeof source === 'string') {
      this.url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      this.worker = new Worker(this.url);
    } else {
      this.url = '';
      this.worker = source;
    }
    this.t0 = now();
    this.finished = false;
    this.outBytes = 0;
    this.promise = new Promise((resolve) => { this.resolve = resolve; });
    this.worker.onmessage = (e) => this.message(e.data);
    this.worker.onerror = (e) => {
      e.preventDefault();
      if (this.handlers.onWorkerError) this.handlers.onWorkerError(e, this);
      else {
        this.job.err(String(e.message || 'worker error') + '\n');
        this.finish({ status: 'error', code: 1, message: e.message });
      }
    };
    this.limit = new Limit(job.timeoutMs, () => this.finish({ status: 'timeout' }));
  }
  post(msg, transfer) { this.worker.postMessage(msg, transfer || []); }
  message(m) {
    if (this.finished) return;
    if (m.type === 'out' || m.type === 'err') {
      // a flood of output must not eat the page's memory: after the limit the program is stopped
      this.outBytes += m.text.length;
      if (this.outBytes > OUTPUT_LIMIT) { this.finish({ status: 'output-limit' }); return; }
      (m.type === 'out' ? this.job.out : this.job.err)(m.text);
    } else if (m.type === 'in') {
      if (this.job.echo) this.job.echo(m.text);
    } else if (m.type === 'stdin-request') {
      // the program sleeps until the person types: the time limit waits too
      this.limit.pause();
      Promise.resolve(this.job.ask ? this.job.ask() : null).then((text) => {
        if (this.finished) return;
        this.limit.resume();
        this.job.channel.answer(text);
      });
    } else if (m.type === 'stdin-eof') {
      if (this.job.onEof) this.job.onEof();
    } else if (m.type === 'done') {
      this.finish({ status: m.code === 0 ? 'ok' : 'error', code: m.code });
    } else if (this.handlers.onMessage) {
      this.handlers.onMessage(m, this);
    }
  }
  finish(result) {
    if (this.finished) return;
    this.finished = true;
    this.limit.clear();
    this.worker.terminate();
    if (this.url) URL.revokeObjectURL(this.url);
    result.ms = now() - this.t0;
    this.resolve(result);
  }
  stop() { this.finish({ status: 'stopped' }); }
}
const OUTPUT_LIMIT = 2 * 1024 * 1024;

// Input of a program, inside its worker. First the lines prepared in the Input field, then -
// when the page is cross-origin isolated and gave a SharedArrayBuffer - the worker asks the page
// ('stdin-request') and sleeps in Atomics.wait until the person types a line (state 2) or ends
// the input with Ctrl+D (state 3). Without the buffer (a page opened from disk) the input ends
// with the field, and the page is told once ('stdin-eof') to show a hint about the field.
// Buffer: Int32 [0] state (0 idle, 1 waiting, 2 line ready, 3 end of input), [1] length;
// bytes of the line from offset 8.
function stdinReader(text, sab) {
  const lines = String(text || '').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  let li = 0, ended = false;
  const ctrl = sab ? new Int32Array(sab, 0, 2) : null;
  const data = sab ? new Uint8Array(sab, 8) : null;
  function ask() {
    if (ended) return null;
    if (!sab) { ended = true; self.postMessage({ type: 'stdin-eof' }); return null; }
    Atomics.store(ctrl, 0, 1);
    self.postMessage({ type: 'stdin-request' });
    Atomics.wait(ctrl, 0, 1);
    const state = Atomics.load(ctrl, 0);
    let s = null;
    if (state === 2) s = new TextDecoder().decode(data.slice(0, Atomics.load(ctrl, 1)));
    else ended = true;
    Atomics.store(ctrl, 0, 0);
    return s;
  }
  return {
    // the next line: { text, prepared } or null at the end of input
    line() {
      if (li < lines.length) return { text: lines[li++].replace(/\r$/, ''), prepared: true };
      const s = ask();
      return s === null ? null : { text: s, prepared: false };
    },
    // everything up to the end of input (Ctrl+D), as one text with line breaks
    rest() {
      let out = lines.slice(li).join('\n') + (li < lines.length ? '\n' : '');
      li = lines.length;
      for (let s = ask(); s !== null; s = ask()) out += s + '\n';
      return out;
    },
    ask,
  };
}

// The page's end of the input channel: one per run, its buffer goes to the worker.
class StdinChannel {
  constructor() {
    this.sab = new SharedArrayBuffer(8 + 65536);
    this.ctrl = new Int32Array(this.sab, 0, 2);
    this.data = new Uint8Array(this.sab, 8);
  }
  // text - the typed line (without the line break), null - end of input
  answer(text) {
    if (text === null) Atomics.store(this.ctrl, 0, 3);
    else {
      let b = new TextEncoder().encode(text);
      if (b.length > this.data.length) b = b.subarray(0, this.data.length);
      this.data.set(b);
      Atomics.store(this.ctrl, 1, b.length);
      Atomics.store(this.ctrl, 0, 2);
    }
    Atomics.notify(this.ctrl, 0);
  }
  // Can this page give a SharedArrayBuffer to a worker? Only a cross-origin isolated page can
  // (COOP/COEP from the server, coi-serviceworker on GitHub Pages, the app's headers).
  static available() {
    if (typeof SharedArrayBuffer !== 'function' || typeof Atomics !== 'object') return false;
    if (self.crossOriginIsolated) return true;
    try { new MessageChannel().port1.postMessage(new SharedArrayBuffer(8)); return true; } catch (e) { return false; }
  }
}

// Time limit that does not run while the program waits for the person to type.
class Limit {
  constructor(ms, onExpire) { this.ms = ms; this.onExpire = onExpire; this.timer = null; this.left = ms; this.start(); }
  start() { if (this.ms > 0 && this.left > 0) { this.t0 = now(); this.timer = setTimeout(this.onExpire, this.left); } }
  pause() { if (this.timer) { clearTimeout(this.timer); this.timer = null; this.left -= now() - this.t0; } }
  resume() { if (!this.timer && this.ms > 0) this.start(); }
  clear() { clearTimeout(this.timer); this.timer = null; this.left = 0; }
}

// Output batching used inside workers: a busy program posts its output in pieces, by size or
// by elapsed time, so the page shows it while the program is still running.
// While the program writes little, every piece is posted at once (a program that prints and
// then hangs in a loop still shows what it printed); after 40 posts within 50 ms the pieces
// are collected and posted every 30 ms or 32 KB.
function workerOutput() {
  let buf = '', kind = 'out', last = -1e9, windowStart = -1e9, posts = 0;
  function flush() {
    const t = performance.now();
    if (buf) {
      self.postMessage({ type: kind, text: buf });
      buf = '';
      if (t - windowStart > 50) { windowStart = t; posts = 0; }
      posts++;
    }
    last = t;
  }
  function emit(k, text) {
    if (k !== kind) { flush(); kind = k; }
    buf += text;
    const t = performance.now();
    if (posts < 40 || t - windowStart > 50 || buf.length > 32768 || t - last > 30) flush();
  }
  return { emit, flush };
}

// ---------------------------------------------------------------------------------------
// JavaScript. The program is the worker script itself, after a prelude (console, input(),
// timers, process.stdout). Line numbers of errors come from the worker's error events minus the
// prelude's lines.
function jsPrelude(stdinText, sab, workerOutputSrc, stdinReaderSrc) {
  const io = workerOutputSrc();
  const stdin = stdinReaderSrc(stdinText, sab);
  const emit = io.emit;
  const post = (type, data) => self.postMessage(Object.assign({ type }, data));

  function fmt(v, depth, seen, top) {
    const t = typeof v;
    if (t === 'string') return top ? v : JSON.stringify(v).replace(/^"|"$/g, "'").replace(/\\"/g, '"');
    if (t === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (t === 'bigint') return v + 'n';
    if (t === 'undefined' || t === 'boolean' || v === null) return String(v);
    if (t === 'symbol') return v.toString();
    if (t === 'function') return /^class\s/.test(Function.prototype.toString.call(v)) ? `[class ${v.name || '(anonymous)'}]` : `[Function: ${v.name || '(anonymous)'}]`;
    if (v instanceof Error) return v.stack && depth === 0 ? String(v.stack).split('\n').filter((l) => !/blob:/.test(l) || /^\s*at /.test(l) === false).join('\n') : `${v.name}: ${v.message}`;
    if (seen.has(v)) return '[Circular]';
    if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
    if (v instanceof RegExp) return String(v);
    if (depth > 2) return Array.isArray(v) ? '[Array]' : '[Object]';
    seen.add(v);
    let s;
    const list = (items, open, close) => {
      if (!items.length) return open.trim() + close.trim();
      const one = open + items.join(', ') + close;
      return one.length <= 72 ? one : open.trimEnd() + '\n' + items.map((x) => '  '.repeat(depth + 1) + x).join(',\n') + '\n' + '  '.repeat(depth) + close.trimStart();
    };
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      const arr = Array.from(v.length > 100 ? Array.prototype.slice.call(v, 0, 100) : v);
      const items = arr.map((x) => fmt(x, depth + 1, seen, false));
      if (v.length > 100) items.push(`... ${v.length - 100} more items`);
      s = list(items, '[ ', ' ]');
      if (!Array.isArray(v)) s = `${v.constructor.name}(${v.length}) ` + s;
    } else if (v instanceof Map) {
      s = `Map(${v.size}) ` + list([...v].map(([k, x]) => fmt(k, depth + 1, seen, false) + ' => ' + fmt(x, depth + 1, seen, false)), '{ ', ' }');
    } else if (v instanceof Set) {
      s = `Set(${v.size}) ` + list([...v].map((x) => fmt(x, depth + 1, seen, false)), '{ ', ' }');
    } else {
      const keys = Object.keys(v);
      const name = v.constructor && v.constructor !== Object && v.constructor.name ? v.constructor.name + ' ' : '';
      s = name + list(keys.map((k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ': ' + fmt(v[k], depth + 1, seen, false)), '{ ', ' }');
    }
    seen.delete(v);
    return s;
  }
  const line = (args) => args.map((a) => fmt(a, 0, new Set(), true)).join(' ') + '\n';
  const counts = {}, timers = {};
  const con = {
    log: (...a) => emit('out', line(a)), info: (...a) => emit('out', line(a)), debug: (...a) => emit('out', line(a)),
    error: (...a) => emit('err', line(a)), warn: (...a) => emit('err', line(a)), trace: (...a) => emit('err', line(a)),
    table: (d) => emit('out', line([d])), dir: (d) => emit('out', line([d])), clear() {}, group: (...a) => a.length && emit('out', line(a)), groupEnd() {},
    assert: (c, ...a) => { if (!c) emit('err', line(['Assertion failed' + (a.length ? ':' : ''), ...a])); },
    count: (l = 'default') => emit('out', `${l}: ${(counts[l] = (counts[l] || 0) + 1)}\n`),
    time: (l = 'default') => { timers[l] = performance.now(); },
    timeEnd: (l = 'default') => emit('out', `${l}: ${(performance.now() - (timers[l] || 0)).toFixed(3)} ms\n`),
  };
  Object.defineProperty(self, 'console', { value: con, configurable: true, writable: true });

  function readLine(question) {
    if (question !== undefined && question !== null && question !== '') emit('out', String(question));
    io.flush();
    const r = stdin.line();
    if (!r) return null;
    if (r.prepared) post('in', { text: r.text + '\n' });   // a typed line is echoed by the page
    return r.text;
  }
  self.input = readLine;
  self.prompt = readLine;
  self.readline = () => readLine();
  let exited = false;
  const EXIT = {};
  function exit(code) {
    io.flush();
    exited = true;
    post('done', { code: code | 0 });
    throw EXIT;
  }
  self.process = {
    argv: ['node', 'main.js'], env: {}, platform: 'browser',
    stdout: { write: (s) => { emit('out', String(s)); return true; } },
    stderr: { write: (s) => { emit('err', String(s)); return true; } },
    exit: (code) => exit(code === undefined ? 0 : code),
  };
  self.require = (name) => {
    if (name === 'fs' || name === 'node:fs') {
      return {
        readFileSync(f) {
          if (f === 0 || f === '/dev/stdin') { io.flush(); return stdin.rest(); }
          throw new Error('there are no files in the browser: ' + f);
        },
      };
    }
    throw new Error(`Cannot find module '${name}' (in the browser only require('fs').readFileSync(0) works, for the input)`);
  };

  const active = new Set();
  const oSet = self.setTimeout.bind(self), oClear = self.clearTimeout.bind(self);
  const oSetI = self.setInterval.bind(self), oClearI = self.clearInterval.bind(self);
  self.setTimeout = (fn, ms, ...args) => {
    const id = oSet(() => { active.delete(id); fn(...args); }, ms);
    active.add(id);
    return id;
  };
  self.clearTimeout = (id) => { active.delete(id); oClear(id); };
  self.setInterval = (fn, ms, ...args) => { const id = oSetI(() => fn(...args), ms); active.add(id); return id; };
  self.clearInterval = (id) => { active.delete(id); oClearI(id); };

  let done = false;
  function finish(code) {
    if (done || exited) return;
    done = true;
    io.flush();
    post('done', { code });
  }
  self.addEventListener('error', (e) => {
    e.preventDefault();
    if (e.error === EXIT || exited || done) return;
    io.flush();
    post('jserror', { message: e.message, line: e.lineno, col: e.colno, stack: e.error && e.error.stack ? String(e.error.stack) : '' });
    finish(1);
  });
  self.addEventListener('unhandledrejection', (e) => {
    e.preventDefault();
    if (e.reason === EXIT || exited || done) return;
    const r = e.reason;
    io.flush();
    post('jserror', { message: 'Uncaught (in promise) ' + (r instanceof Error ? r.name + ': ' + r.message : fmt(r, 0, new Set(), false)), stack: r && r.stack ? String(r.stack) : '' });
    finish(1);
  });
  // Called after the program's own code: the run ends when no timers are left.
  self.__programEnd = () => {
    const check = () => { if (active.size === 0) finish(0); else oSet(check, 15); };
    oSet(check, 0);
  };
}

// Source map (V3) -> for every generated line, the original line (both 1-based).
function sourceMapLines(map) {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out = [];
  let srcLine = 0;
  map.mappings.split(';').forEach((group, genLine) => {
    let first = null;
    for (const seg of group.split(',')) {
      if (!seg) continue;
      const vals = [];
      let shift = 0, value = 0;
      for (const ch of seg) {
        const d = B64.indexOf(ch);
        value += (d & 31) << shift;
        if (d & 32) shift += 5;
        else { vals.push(value & 1 ? -(value >>> 1) : value >>> 1); value = 0; shift = 0; }
      }
      if (vals.length >= 4) {
        srcLine += vals[2];
        if (first === null) first = srcLine;
      }
    }
    out[genLine + 1] = first === null ? null : first + 1;
  });
  return out;
}

class JsRunner {
  constructor(env) { this.env = env; this.state = 'ready'; this.current = null; }
  async prepare() { this.env.onState('ready'); }
  // job.lineMap: generated line -> original line (TypeScript); job.fileLabel: name for messages
  run(job) {
    // the prelude is one statement; the buffer of the input channel arrives in the first message
    const head = `self.onmessage = (e) => { self.onmessage = null; self.__sab = e.data.sab; importScripts(e.data.program); };\n`;
    const prelude = `(${jsPrelude.toString()})(${JSON.stringify(job.stdin || '')}, self.__sab || null, ${workerOutput.toString()}, ${stdinReader.toString()});\n`;
    const offset = prelude.split('\n').length - 1;
    const code = job.code !== undefined ? job.code : job.files[job.entry];
    const programUrl = URL.createObjectURL(new Blob([prelude + code + '\n;self.__programEnd();\n'], { type: 'text/javascript' }));
    const source = head;
    const file = job.entry;
    const mapLine = (l) => {
      if (!l || l <= offset) return null;
      const g = l - offset;
      if (!job.lineMap) return g;
      return job.lineMap[g] || null;
    };
    // Stack frames inside the program: "at fib (blob:...:12:5)" -> "at fib (main.js:9:5)".
    const cleanStack = (stack) => String(stack || '').split('\n').filter((l) => /^\s+at /.test(l)).map((l) => {
      const m = /blob:[^)\s]*?:(\d+):(\d+)/.exec(l);
      if (!m) return null;
      const line = mapLine(+m[1]);
      if (!line) return null;
      const where = job.lineMap ? `${file}:${line}` : `${file}:${line}:${m[2]}`;
      return /^\s+at blob:/.test(l) ? '    at ' + where : l.replace(/\(?blob:[^)\s]*?:(\d+):(\d+)\)?/, '(' + where + ')').replace(/^\s+/, '    ');
    }).filter(Boolean).slice(0, 12);
    const diagnostics = [];
    const r = new Run(source, job, {
      onMessage: (m, run) => {
        if (m.type === 'jserror') {
          const line = mapLine(m.line) || (() => {
            const f = /blob:[^)\s]*?:(\d+):(\d+)/.exec(m.stack || '');
            return f ? mapLine(+f[1]) : null;
          })();
          const msg = String(m.message).replace(/^Uncaught /, '');
          job.err((line ? `${file}:${line}: ` : '') + msg + '\n');
          const frames = cleanStack(m.stack);
          if (frames.length) job.err(frames.join('\n') + '\n');
          if (line) diagnostics.push({ file, line, col: m.col || 1, severity: 'error', message: msg });
        }
      },
      onWorkerError: (e, run) => {
        // The script did not even start: a syntax error in the program.
        const line = mapLine(e.lineno);
        const msg = String(e.message || 'SyntaxError').replace(/^Uncaught /, '');
        job.err((line ? `${file}:${line}:${e.colno || 1}: ` : '') + msg + '\n');
        if (line) diagnostics.push({ file, line, col: e.colno || 1, severity: 'error', message: msg });
        run.finish({ status: 'error', code: 1 });
      },
    });
    r.post({ sab: job.channel ? job.channel.sab : null, program: programUrl });
    this.current = r;
    return r.promise.then((res) => { this.current = null; URL.revokeObjectURL(programUrl); res.diagnostics = diagnostics; return res; });
  }
  stop() { if (this.current) this.current.stop(); }
}

// ---------------------------------------------------------------------------------------
// TypeScript: type check and translation to JavaScript on the page (the compiler is loaded
// from the pack once), then the JavaScript runner. Type errors stop the run, like a compiler.
const TS_GLOBALS = `
declare var console: { log(...data: any[]): void; info(...data: any[]): void; debug(...data: any[]): void;
  error(...data: any[]): void; warn(...data: any[]): void; table(data: any): void; dir(data: any): void;
  assert(condition?: boolean, ...data: any[]): void; count(label?: string): void; time(label?: string): void;
  timeEnd(label?: string): void; clear(): void; trace(...data: any[]): void; group(...data: any[]): void; groupEnd(): void; };
/** The next line of the Input field, or null when the lines are over. */
declare function input(message?: string): string | null;
declare function prompt(message?: string): string | null;
declare function readline(): string | null;
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearTimeout(id?: number): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearInterval(id?: number): void;
declare function queueMicrotask(callback: () => void): void;
declare function structuredClone<T>(value: T): T;
declare var performance: { now(): number };
declare var process: { argv: string[]; env: Record<string, string>; exit(code?: number): never;
  stdout: { write(s: string): boolean }; stderr: { write(s: string): boolean } };
declare function require(name: 'fs'): { readFileSync(fd: 0 | '/dev/stdin', encoding?: string): string };
`;

class TsRunner {
  constructor(env) { this.env = env; this.state = 'idle'; this.js = new JsRunner(env); this.loading = null; }
  prepare() {
    if (this.loading) return this.loading;
    this.state = 'loading';
    this.env.onState('loading');
    this.loading = (async () => {
      try {
        const p = await Packs.pack(this.env.base + 'vendor/typescript/typescript.pack.js', ['typescript.js', 'lib.json']);
        const src = await Packs.unpackText(p['typescript.js']);
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        await Packs.loadScript(url);
        URL.revokeObjectURL(url);
        this.libs = JSON.parse(await Packs.unpackText(p['lib.json']));
        this.libs['globals.d.ts'] = TS_GLOBALS;
        this.ts = self.ts;
        this.state = 'ready';
        this.env.onState('ready', { version: 'TypeScript ' + this.ts.version });
      } catch (err) {
        this.loading = null;
        this.state = 'failed';
        this.env.onState('failed', { message: err.message });
        throw err;
      }
    })();
    return this.loading;
  }
  // Type check + emit of one file. Returns { js, lineMap, diagnostics }.
  compile(name, text) {
    const ts = this.ts;
    const options = {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, strict: true, sourceMap: true,
      noEmitOnError: false, lib: ['lib.es2022.d.ts'], types: [], skipLibCheck: true, newLine: ts.NewLineKind.LineFeed,
    };
    const files = Object.assign({}, this.libs, { [name]: text });
    const host = {
      getScriptFileNames: () => [name, 'globals.d.ts'],
      getScriptVersion: (f) => (f === name ? String(++this.version) : '1'),
      getScriptSnapshot: (f) => (f in files ? ts.ScriptSnapshot.fromString(files[f]) : undefined),
      getCurrentDirectory: () => '',
      getCompilationSettings: () => options,
      getDefaultLibFileName: () => 'lib.es2022.d.ts',
      fileExists: (f) => f in files,
      readFile: (f) => files[f],
    };
    this.version = this.version || 0;
    // One language service is kept: the parsed standard library is reused between runs.
    if (!this.registry) this.registry = ts.createDocumentRegistry();
    const ls = ts.createLanguageService(host, this.registry);
    const diags = [...ls.getSyntacticDiagnostics(name), ...ls.getSemanticDiagnostics(name)];
    const sf = ls.getProgram().getSourceFile(name);
    const diagnostics = diags.map((d) => {
      const pos = d.file ? d.file.getLineAndCharacterOfPosition(d.start || 0) : { line: 0, character: 0 };
      return {
        file: name, line: pos.line + 1, col: pos.character + 1,
        severity: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n') + ` (TS${d.code})`,
      };
    });
    let js = '', lineMap = null;
    const emitted = ls.getEmitOutput(name);
    for (const f of emitted.outputFiles) {
      if (f.name.endsWith('.js')) js = f.text.replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
      else if (f.name.endsWith('.map')) lineMap = sourceMapLines(JSON.parse(f.text));
    }
    ls.dispose();
    return { js, lineMap, diagnostics, sf };
  }
  async run(job) {
    await this.prepare();
    const t0 = now();
    const c = this.compile(job.entry, job.files[job.entry]);
    const compileMs = now() - t0;
    const errors = c.diagnostics.filter((d) => d.severity === 'error');
    for (const d of c.diagnostics) (d.severity === 'error' ? job.err : job.warn || job.err)(`${d.file}:${d.line}:${d.col}: ${d.severity}: ${d.message}\n`);
    if (errors.length) return { status: 'compile-error', code: 1, ms: 0, compileMs, diagnostics: c.diagnostics };
    const res = await this.js.run(Object.assign({}, job, { code: c.js, lineMap: c.lineMap }));
    res.compileMs = compileMs;
    res.diagnostics = c.diagnostics.concat(res.diagnostics || []);
    return res;
  }
  stop() { this.js.stop(); }
}

// ---------------------------------------------------------------------------------------
// C and C++: Clang + LLD (YoWASP) in a compiler worker that stays alive between runs; the
// program (wasm32-wasip1) runs in a separate worker with the WASI host from wasi.js.
function clangWorkerMain() {
  const files = new Map();
  let ready = null;
  self.CLANG_BASE_URL = 'https://clang.invalid/gen/bundle.js';
  // The YoWASP runtime reads its wasm and the sysroot with fetch(): answer from the pack.
  self.fetch = async (url) => {
    const name = String(url && url.url ? url.url : url).split('?')[0].split('/').pop();
    await ready;
    const bytes = files.get(name);
    if (!bytes) throw new TypeError('offline build: no ' + name);
    return new Response(bytes, { headers: { 'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } });
  };
  // <bits/stdc++.h> of GCC, for programs from olympiad books: libc++ has no such header
  const BITS = ['algorithm', 'array', 'bitset', 'cassert', 'cctype', 'cfloat', 'chrono', 'climits', 'cmath', 'complex',
    'cstdint', 'cstdio', 'cstdlib', 'cstring', 'deque', 'functional', 'iomanip', 'iostream', 'iterator', 'limits', 'list',
    'map', 'memory', 'numeric', 'optional', 'queue', 'random', 'set', 'sstream', 'stack', 'string', 'string_view',
    'tuple', 'type_traits', 'unordered_map', 'unordered_set', 'utility', 'variant', 'vector', 'bit', 'numbers', 'span']
    .map((h) => '#include <' + h + '>\n').join('');
  async function compile(m) {
    let stderr = '';
    const decErr = new TextDecoder();
    const t0 = performance.now();
    const tree = Object.assign({}, m.files);
    if (m.lang === 'cpp' && !tree.bits) tree.bits = { 'stdc++.h': BITS };
    if (m.pch) { tree[m.pch.pch] = files.get(m.pch.pch); tree[m.pch.file] = m.pch.header; }
    try {
      const out = await self.YoWASPClang.runClang(m.args, tree, {
        stdout: (b) => { if (b) stderr += decErr.decode(b, { stream: true }); },
        stderr: (b) => { if (b) stderr += decErr.decode(b, { stream: true }); },
        fetchProgress: () => {},
      });
      const wasm = out && out['a.out'];
      return { ok: !!wasm, wasm, stderr, ms: performance.now() - t0 };
    } catch (err) {
      if (err && typeof err.code === 'number') return { ok: false, stderr, code: err.code, ms: performance.now() - t0 };
      return { ok: false, stderr: stderr + String(err && err.message || err) + '\n', ms: performance.now() - t0 };
    }
  }
  self.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'init') {
      ready = (async () => {
        for (const [name, b64] of Object.entries(m.packs)) files.set(name, await unpackBytes(b64));
      })();
      try {
        await ready;
        // warm-up: the first run compiles the 75 MB of wasm and unpacks the sysroot
        const r = await compile({ args: ['clang', '-O2', 'warm.c', '-o', 'a.out'], files: { 'warm.c': 'int main(void) { return 0; }\n' } });
        self.postMessage({ type: 'ready', ok: r.ok, stderr: r.stderr, version: self.YoWASPClang.version });
      } catch (err) {
        self.postMessage({ type: 'ready', ok: false, stderr: String(err && err.message || err) });
      }
    } else if (m.type === 'compile') {
      const r = await compile(m);
      self.postMessage(Object.assign({ type: 'compiled', id: m.id }, r), r.wasm ? [r.wasm.buffer] : []);
    }
  };
}

function execWorkerMain(wasiFactorySrc, workerOutputSrc, stdinReaderSrc) {
  const W = wasiFactorySrc();
  const io = workerOutputSrc();
  self.onmessage = async (e) => {
    const m = e.data;
    const dec = [new TextDecoder(), new TextDecoder(), new TextDecoder()];
    let code = 0;
    try {
      const module = await WebAssembly.compile(m.wasm);
      const wasi = W.createWasi({
        args: [m.name], env: { LANG: 'C.UTF-8' }, stdin: new TextEncoder().encode(m.stdin || ''),
        // after the Input field: one typed line at a time (null - end of input)
        more: (() => {
          const reader = stdinReaderSrc('', m.sab || null);
          const enc = new TextEncoder();
          return () => { io.flush(); const s = reader.ask(); return s === null ? null : enc.encode(s + '\n'); };
        })(),
        write: (fd, bytes) => io.emit(fd === 2 ? 'err' : 'out', dec[fd].decode(bytes, { stream: true })),
      });
      const instance = await WebAssembly.instantiate(module, wasi.imports(module));
      code = wasi.start(instance);
    } catch (err) {
      io.flush();
      self.postMessage({ type: 'trap', message: String(err && err.message || err), name: err && err.name || '' });
      code = 134;
    }
    io.flush();
    self.postMessage({ type: 'done', code });
  };
}

class ClangRunner {
  constructor(env) { this.env = env; this.state = 'idle'; this.loading = null; this.worker = null; this.pending = new Map(); this.seq = 0; this.current = null; }
  prepare() {
    if (this.loading) return this.loading;
    this.state = 'loading';
    this.env.onState('loading');
    this.loading = (async () => {
      try {
        const base = this.env.base + 'vendor/clang/';
        const core = await Packs.pack(base + 'clang-core.pack.js', ['llvm.core.wasm']);
        const rest = await Packs.pack(base + 'clang-rest.pack.js', ['bundle.js', 'llvm.core2.wasm', 'llvm.core3.wasm', 'llvm.core4.wasm', 'llvm-resources.tar']);
        const pch = await Packs.pack(base + 'clang-pch.pack.js', ['iostream.pch', 'pch.json']);
        if (!this.bundle) this.bundle = await Packs.unpackText(rest['bundle.js']);
        if (!this.pchInfo) this.pchInfo = JSON.parse(await Packs.unpackText(pch['pch.json']));
        const packs = Object.assign({}, core, rest, { [this.pchInfo.pch]: pch[this.pchInfo.pch] });
        delete packs['bundle.js'];
        const source = [Packs.WORKER_HELPERS, `(${clangWorkerMain.toString()})();`, this.bundle].join('\n;\n');
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const w = new Worker(url);
        this.worker = w;
        const info = await new Promise((resolve, reject) => {
          w.onmessage = (e) => {
            const m = e.data;
            if (m.type === 'ready') resolve(m);
            else if (m.type === 'compiled') this.compiled(m);
          };
          w.onerror = (e) => { e.preventDefault(); reject(new Error(e.message || 'compiler worker failed')); };
          w.postMessage({ type: 'init', packs });
        });
        URL.revokeObjectURL(url);
        if (!info.ok) throw new Error(info.stderr || 'clang did not start');
        w.onmessage = (e) => { if (e.data.type === 'compiled') this.compiled(e.data); };
        this.version = info.version;
        this.state = 'ready';
        this.env.onState('ready', { version: 'Clang ' + String(info.version).split('-')[0] });
      } catch (err) {
        if (this.worker) this.worker.terminate();
        this.worker = null;
        this.loading = null;
        this.state = 'failed';
        this.env.onState('failed', { message: err.message });
        throw err;
      }
    })();
    return this.loading;
  }
  compiled(m) {
    const p = this.pending.get(m.id);
    if (p) { this.pending.delete(m.id); p(m); }
  }
  compile(args, files, lang, pch) {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ type: 'compile', id, args, files, lang, pch: pch || null });
    });
  }
  // Compiler messages "main.cpp:5:3: error: ..." -> diagnostics
  static parse(stderr) {
    const out = [];
    for (const l of String(stderr).split('\n')) {
      const m = /^(?:\/[^:]*\/)?([^/:\s][^:]*):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/.exec(l);
      if (m && m[4] !== 'note') out.push({ file: m[1], line: +m[2], col: +m[3], severity: m[4] === 'warning' ? 'warning' : 'error', message: m[5] });
    }
    return out;
  }
  // C: C17. C++: the flags of the precompiled <iostream> (C++20, -O2, no exceptions); a program
  // that includes <iostream> gets it with -include-pch. Stack 8 MB for deep recursion.
  static args(lang, entry, pchInfo, usePch) {
    const tail = [entry, '-o', 'a.out', '-Wl,-z,stack-size=8388608'];
    if (lang === 'c') return ['clang', '-std=c17', '-O2', '-Wall', '-I.', ...tail, '-lm'];
    const flags = pchInfo ? pchInfo.flags : ['-std=c++20', '-O2', '-fno-exceptions'];
    return ['clang++', ...flags, ...(usePch ? ['-include-pch', pchInfo.pch] : []), '-Wall', '-I.', ...tail];
  }
  static wantsPch(lang, source) { return lang === 'cpp' && /^\s*#\s*include\s*<iostream>/m.test(source); }
  async run(job) {
    await this.prepare();
    // files of the project go into the compiler's folder: headers can be included
    const files = {};
    for (const [n, t] of Object.entries(job.files)) if (/^[\w.-]+$/.test(n)) files[n] = t;
    this.compiling = true;
    const usePch = !!this.pchInfo && ClangRunner.wantsPch(job.lang, files[job.entry] || '');
    let c = await this.compile(ClangRunner.args(job.lang, job.entry, this.pchInfo, usePch), files, job.lang, usePch ? this.pchInfo : null);
    // a precompiled header that does not fit (it should not happen): compile without it
    if (!c.ok && usePch && /precompiled|PCH file/i.test(c.stderr) && !this.stoppedWhileCompiling) {
      c = await this.compile(ClangRunner.args(job.lang, job.entry, this.pchInfo, false), files, job.lang, null);
    }
    this.compiling = false;
    if (this.stoppedWhileCompiling) {
      this.stoppedWhileCompiling = false;
      return { status: 'stopped', ms: 0, compileMs: c.ms };
    }
    const diagnostics = ClangRunner.parse(c.stderr);
    if (c.stderr) (c.ok ? (job.warn || job.err) : job.err)(c.stderr.replace(/\n?$/, '\n'));
    if (!c.ok) return { status: 'compile-error', code: c.code || 1, ms: 0, compileMs: c.ms, diagnostics };
    const source = `(${execWorkerMain.toString()})(${self.wasiFactory.toString()}, ${workerOutput.toString()}, ${stdinReader.toString()});`;
    let trap = null;
    const r = new Run(source, job, { onMessage: (m) => { if (m.type === 'trap') trap = m; } });
    this.current = r;
    r.post({ wasm: c.wasm, stdin: job.stdin || '', sab: job.channel ? job.channel.sab : null, name: job.entry.replace(/\.\w+$/, '') }, [c.wasm.buffer]);
    const res = await r.promise;
    this.current = null;
    if (trap) { res.status = 'error'; res.trap = trap.message; }
    res.compileMs = c.ms;
    res.diagnostics = diagnostics;
    return res;
  }
  stop() {
    if (this.current) { this.current.stop(); return; }
    if (this.compiling && this.worker) {
      // A long compilation: the compiler worker is restarted (the packs stay in memory).
      this.stoppedWhileCompiling = true;
      this.worker.terminate();
      this.worker = null;
      this.loading = null;
      this.state = 'idle';
      for (const [, p] of this.pending) p({ ok: false, stderr: '', ms: 0 });
      this.pending.clear();
      this.prepare().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------------------
// Python: the Pyodide runtime of web/python_ide (shared, not copied): Python in a worker, files
// of the project are importable modules, input() reads the Input field.
class PythonRunner {
  constructor(env) { this.env = env; this.state = 'idle'; this.loading = null; this.rt = null; this.sink = null; }
  prepare() {
    if (this.loading) return this.loading;
    this.state = 'loading';
    this.env.onState('loading');
    this.loading = (async () => {
      try {
        await Packs.loadScript(this.env.shared + 'runtime.js');
        const on = {
          out: (t) => this.sink && this.sink.out(t),
          err: (t) => this.sink && this.sink.err(t.replace(/\/home\/pyodide\//g, '')),
          stdin: (t) => this.sink && this.sink.echo && this.sink.echo(t + '\n'),
          request: () => this.sink && this.sink.request && this.sink.request(),
          eof: () => this.sink && this.sink.onEof && this.sink.onEof(),
          state: (s, info) => {
            if (s === 'ready' && this.state !== 'ready') { this.state = 'ready'; this.env.onState('ready', { version: 'Python ' + (info && info.version || '') }); }
            if (s === 'failed') { this.state = 'failed'; this.env.onState('failed', info); }
          },
        };
        this.rt = new self.PyRuntime(on, this.env.shared + 'vendor/pyodide/');
        await this.rt.start();
        if (this.rt.state !== 'ready') throw new Error((this.rt.lastError) || 'Python did not start');
      } catch (err) {
        this.loading = null;
        this.state = 'failed';
        this.env.onState('failed', { message: err.message });
        throw err;
      }
    })();
    return this.loading;
  }
  static parse(text) {
    let last = null;
    const re = /File "(?:\/home\/pyodide\/)?([^"]+)", line (\d+)/g;
    let m;
    while ((m = re.exec(text))) last = { file: m[1], line: +m[2] };
    if (!last) return [];
    const msg = String(text).trim().split('\n').pop();
    return [{ file: last.file, line: last.line, col: 1, severity: 'error', message: msg }];
  }
  async run(job) {
    await this.prepare();
    if (this.rt.state !== 'ready') await new Promise((r) => { const t = setInterval(() => { if (this.rt.state === 'ready') { clearInterval(t); r(); } }, 50); });
    let errText = '';
    let limit = null;
    this.sink = {
      out: job.out, err: (t) => { errText += t; job.err(t); }, echo: job.echo, onEof: job.onEof,
      // the program waits for a typed line: the time limit waits too
      request: () => {
        if (limit) limit.pause();
        Promise.resolve(job.ask ? job.ask() : null).then((text) => {
          if (this.rt.state !== 'running') return;
          if (limit) limit.resume();
          job.channel.answer(text);
        });
      },
    };
    const lines = String(job.stdin || '').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const files = {};
    for (const [n, t] of Object.entries(job.files)) if (/\.py$/.test(n)) files[n] = t;
    const t0 = now();
    let timedOut = false;
    limit = new Limit(job.timeoutMs, () => { timedOut = true; this.rt.stop(); });
    this.stopping = false;
    const r = await this.rt.run(files, job.entry, lines, job.channel ? job.channel.sab : null);
    limit.clear();
    this.sink = null;
    const ms = r.ms || now() - t0;
    if (r.stopped) return { status: timedOut ? 'timeout' : 'stopped', ms: now() - t0, diagnostics: [] };
    const diagnostics = r.code ? PythonRunner.parse(errText) : [];
    return { status: r.code === 0 ? 'ok' : 'error', code: r.code, ms, diagnostics };
  }
  stop() { if (this.rt && this.rt.state === 'running') this.rt.stop(); }
}

// ---------------------------------------------------------------------------------------
// Lua 5.3: Fengari in a fresh worker for every run. print/io.write/io.read go to the page.
function luaWorkerMain(workerOutputSrc, stdinReaderSrc) {
  const io = workerOutputSrc();
  self.onmessage = (e) => {
    const m = e.data;
    const { lua, lauxlib, lualib, to_luastring: L$, to_jsstring: J$ } = self.fengari;
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);
    const stdin = stdinReaderSrc(m.stdin || '', m.sab || null);
    const tostr = (i) => { const s = lauxlib.luaL_tolstring(L, i); lua.lua_pop(L, 1); return J$(s); };
    lua.lua_register(L, L$('print'), (L) => {
      const n = lua.lua_gettop(L);
      const parts = [];
      for (let i = 1; i <= n; i++) parts.push(tostr(i));
      io.emit('out', parts.join('\t') + '\n');
      return 0;
    });
    lua.lua_register(L, L$('__write'), (L) => {
      const n = lua.lua_gettop(L);
      for (let i = 1; i <= n; i++) io.emit('out', tostr(i));
      return 0;
    });
    lua.lua_register(L, L$('__readline'), (L) => {
      io.flush();
      const r = stdin.line();
      if (!r) { lua.lua_pushnil(L); return 1; }
      if (r.prepared) self.postMessage({ type: 'in', text: r.text + '\n' });
      lua.lua_pushstring(L, L$(r.text));
      return 1;
    });
    lua.lua_register(L, L$('__readall'), (L) => {
      io.flush();
      lua.lua_pushstring(L, L$(stdin.rest()));
      return 1;
    });
    // io.read with the formats of Lua 5.3: "l", "L", "n", "a" (with or without "*") and numbers
    const PRELUDE = `
io = io or {}
local rl, ra, w = __readline, __readall, __write
local pending = nil
local function line() if pending then local p = pending; pending = nil; return p end return rl() end
local function one(f)
  if type(f) == "number" then local l = line(); if not l then return nil end; if #l > f then pending = l:sub(f + 1) end; return l:sub(1, f) end
  f = tostring(f or "l"):gsub("^%*", ""):sub(1, 1)
  if f == "n" then
    while true do
      local l = line(); if not l then return nil end
      local s, e = l:find("^%s*[-+]?[%d%.]+[eE]?[-+]?%d*")
      if s then local rest = l:sub(e + 1); if rest:find("%S") then pending = rest end; return tonumber(l:sub(s, e)) end
      if l:find("%S") then pending = l; return nil end
    end
  elseif f == "a" then local p = pending; pending = nil; return (p and (p .. "\\n") or "") .. ra()
  elseif f == "L" then local l = line(); return l and (l .. "\\n")
  else return line() end
end
io.read = function(...)
  local n = select("#", ...)
  if n == 0 then return one("l") end
  local out = {}
  for i = 1, n do out[i] = one((select(i, ...))); if out[i] == nil then return table.unpack(out, 1, i) end end
  return table.unpack(out, 1, n)
end
io.lines = function(...) local fmts = {...}; return function() return io.read(table.unpack(fmts)) end end
io.write = function(...) w(...); return io end
local stdout = setmetatable({}, { __index = { write = function(self, ...) w(...); return self end, flush = function(self) return self end, close = function() end, setvbuf = function() return true end } })
io.stdout = stdout
io.stderr = stdout
io.stdin = setmetatable({}, { __index = { read = function(self, ...) return io.read(...) end, lines = function(self, ...) return io.lines(...) end, close = function() end } })
io.output = function() return stdout end
__readline, __readall, __write = nil, nil, nil
`;
    let code = 0;
    if (lauxlib.luaL_dostring(L, L$(PRELUDE)) !== 0) { io.emit('err', 'prelude: ' + tostr(-1) + '\n'); code = 1; }
    if (!code) {
      lua.lua_pushcfunction(L, (L) => {
        const msg = lua.lua_tostring(L, 1);
        lauxlib.luaL_traceback(L, L, msg === null ? L$(tostr(1)) : msg, 1);
        return 1;
      });
      const h = lua.lua_gettop(L);
      let status = lauxlib.luaL_loadbuffer(L, L$(m.code), null, L$('@' + m.name));
      if (status === 0) status = lua.lua_pcall(L, 0, 0, h);
      if (status !== 0) {
        const text = tostr(-1);
        io.flush();
        self.postMessage({ type: 'luaerror', text });
        code = 1;
      }
    }
    io.flush();
    self.postMessage({ type: 'done', code });
  };
}

class LuaRunner {
  constructor(env) { this.env = env; this.state = 'idle'; this.loading = null; this.current = null; }
  prepare() {
    if (this.loading) return this.loading;
    this.state = 'loading';
    this.env.onState('loading');
    this.loading = (async () => {
      try {
        const p = await Packs.pack(this.env.base + 'vendor/fengari/fengari.pack.js', ['fengari-web.js']);
        this.fengari = await Packs.unpackText(p['fengari-web.js']);
        this.state = 'ready';
        this.env.onState('ready', { version: 'Lua 5.3 (Fengari)' });
      } catch (err) {
        this.loading = null; this.state = 'failed'; this.env.onState('failed', { message: err.message }); throw err;
      }
    })();
    return this.loading;
  }
  run(job) {
    return this.prepare().then(() => {
      // fengari-web is written for a page: it takes `window` (here the worker's global) and runs
      // <script type="application/lua"> of `document` only when there is a document.
      const source = ['(function (window, document) {', this.fengari, '}).call(self, self, undefined);', `(${luaWorkerMain.toString()})(${workerOutput.toString()}, ${stdinReader.toString()});`].join('\n');
      const diagnostics = [];
      const r = new Run(source, job, {
        onMessage: (m) => {
          if (m.type === 'luaerror') {
            const text = m.text.replace(/\n\s*\[C\]: in \?$/, '').replace(/^stack traceback:\n/m, 'stack traceback:\n');
            job.err(text + '\n');
            const re = new RegExp('(?:^|\\s)' + job.entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+):');
            const f = re.exec(m.text);
            if (f) diagnostics.push({ file: job.entry, line: +f[1], col: 1, severity: 'error', message: m.text.split('\n')[0] });
          }
        },
      });
      this.current = r;
      r.post({ code: job.files[job.entry], name: job.entry, stdin: job.stdin || '', sab: job.channel ? job.channel.sab : null });
      return r.promise.then((res) => { this.current = null; res.diagnostics = diagnostics; return res; });
    });
  }
  stop() { if (this.current) this.current.stop(); }
}

// ---------------------------------------------------------------------------------------
// SQL: SQLite (sql.js) in a fresh worker: a new empty database every run, the script runs
// statement by statement; result tables go to the output.
function sqlWorkerMain() {
  self.onmessage = async (e) => {
    const m = e.data;
    let code = 0;
    try {
      const SQL = await self.initSqlJs({ wasmBinary: m.wasm });
      const db = new SQL.Database();
      const text = m.code;
      const it = db.iterateStatements(text);
      // the line where the next statement starts: after spaces and comments of what is left
      const lineOfRest = () => {
        const rest = it.getRemainingSQL();
        const lead = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/.exec(rest)[0].length;
        return text.slice(0, text.length - rest.length + lead).split('\n').length;
      };
      let line = 1;
      try {
        for (;;) {
          line = lineOfRest();
          const step = it.next();
          if (step.done) break;
          const stmt = step.value;
          const sql = stmt.getSQL();
          const columns = stmt.getColumnNames();
          const rows = [];
          while (stmt.step()) rows.push(stmt.get());
          if (columns.length) self.postMessage({ type: 'table', columns, rows: rows.slice(0, 1000), total: rows.length, line });
          else self.postMessage({ type: 'changes', n: db.getRowsModified(), sql: sql.trim().split(/\s+/)[0].toUpperCase(), line });
          stmt.free();
        }
      } catch (err) {
        self.postMessage({ type: 'sqlerror', message: String(err && err.message || err), line });
        code = 1;
      }
      db.close();
    } catch (err) {
      self.postMessage({ type: 'sqlerror', message: String(err && err.message || err) });
      code = 1;
    }
    self.postMessage({ type: 'done', code });
  };
}

function formatTable(columns, rows) {
  const str = (v) => (v === null ? 'NULL' : v instanceof Uint8Array ? `<blob ${v.length} B>` : String(v));
  const cells = rows.map((r) => r.map(str));
  const w = columns.map((c, i) => Math.min(60, Math.max(String(c).length, ...cells.map((r) => r[i].length))));
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const pad = (s, n, right) => (right ? cut(s, n).padStart(n) : cut(s, n).padEnd(n));
  const sep = '+' + w.map((n) => '-'.repeat(n + 2)).join('+') + '+';
  const isNum = (i) => rows.length && rows.every((r) => r[i] === null || typeof r[i] === 'number');
  const out = [sep, '| ' + columns.map((c, i) => pad(String(c), w[i], false)).join(' | ') + ' |', sep];
  for (const r of cells) out.push('| ' + r.map((c, i) => pad(c, w[i], isNum(i))).join(' | ') + ' |');
  out.push(sep);
  return out.join('\n') + '\n';
}

class SqlRunner {
  constructor(env) { this.env = env; this.state = 'idle'; this.loading = null; this.current = null; }
  prepare() {
    if (this.loading) return this.loading;
    this.state = 'loading';
    this.env.onState('loading');
    this.loading = (async () => {
      try {
        const p = await Packs.pack(this.env.base + 'vendor/sqljs/sqljs.pack.js', ['sql-wasm.js', 'sql-wasm.wasm']);
        this.glue = await Packs.unpackText(p['sql-wasm.js']);
        this.wasm = await Packs.unpackBytes(p['sql-wasm.wasm']);
        this.state = 'ready';
        this.env.onState('ready', { version: 'SQLite (sql.js)' });
      } catch (err) {
        this.loading = null; this.state = 'failed'; this.env.onState('failed', { message: err.message }); throw err;
      }
    })();
    return this.loading;
  }
  run(job) {
    return this.prepare().then(() => {
      const t = this.env.t;
      const source = [this.glue, `(${sqlWorkerMain.toString()})();`].join('\n;\n');
      const diagnostics = [];
      const r = new Run(source, job, {
        onMessage: (m) => {
          if (m.type === 'table') {
            job.out(formatTable(m.columns, m.rows) + t('sqlRows', { n: m.total }) + '\n\n');
          } else if (m.type === 'changes') {
            if (/^(INSERT|UPDATE|DELETE|REPLACE)$/.test(m.sql)) job.info(t('sqlChanged', { what: m.sql, n: m.n }) + '\n');
          } else if (m.type === 'sqlerror') {
            job.err((m.line ? `${job.entry}:${m.line}: ` : '') + m.message + '\n');
            if (m.line) diagnostics.push({ file: job.entry, line: m.line, col: 1, severity: 'error', message: m.message });
          }
        },
      });
      this.current = r;
      r.post({ code: job.files[job.entry], wasm: this.wasm.slice() });
      return r.promise.then((res) => { this.current = null; res.diagnostics = diagnostics; return res; });
    });
  }
  stop() { if (this.current) this.current.stop(); }
}

// ---------------------------------------------------------------------------------------
// Ruby 3.4 (ruby.wasm). Starting the Ruby VM takes seconds, so a spare worker with a started VM
// is kept ready; every run uses a fresh VM (no state left from the previous run).
function rubyWorkerMain(workerOutputSrc, stdinReaderSrc) {
  const io = workerOutputSrc();
  let vm = null;
  const outLog = (...a) => io.emit('out', a.join(' ') + '\n');
  const errLog = (...a) => io.emit('err', a.join(' ') + '\n');
  self.console = Object.assign({}, self.console, { log: outLog, info: outLog, warn: errLog, error: errLog, debug: () => {} });
  self.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'init') {
      try {
        const R = self['ruby-wasm-wasi'];
        vm = (await R.DefaultRubyVM(m.module, { consolePrint: true })).vm;
        self.postMessage({ type: 'ready', version: vm.eval('RUBY_VERSION').toString() });
      } catch (err) {
        self.postMessage({ type: 'ready', error: String(err && err.message || err) });
      }
      return;
    }
    self.__code = m.code;
    self.__stdin = m.stdin || '';
    self.__file = m.name;
    self.__out = (s) => io.emit('out', String(s));
    self.__err = (s) => io.emit('err', String(s));
    self.__in = (s) => { io.flush(); self.postMessage({ type: 'in', text: String(s) }); };
    // after the Input field (a StringIO): typed lines; "" means the end of input
    const more = stdinReaderSrc('', m.sab || null);
    self.__more = () => { io.flush(); const s = more.ask(); return s === null ? '' : s + '\n'; };
    self.__rberr = (line, message) => self.postMessage({ type: 'rberror', line: Number(line), message: String(message) });
    let code = 0;
    try {
      const r = vm.eval(`
require 'js'
require 'stringio'
class CompilerIO
  def initialize(fn) = @fn = fn
  def write(*a) = a.sum { |s| s = s.to_s; JS.global.call(@fn, s); s.bytesize }
  def <<(s) = (write(s); self)
  def print(*a) = (write(*a); nil)
  def puts(*a)
    a = [""] if a.empty?
    a.flatten.each { |s| s = s.nil? ? "" : s.to_s; write(s.end_with?("\\n") ? s : s + "\\n") }
    nil
  end
  def printf(*a) = (write(format(*a)); nil)
  def flush = self
  def sync = true
  def sync=(v); end
  def fileno = 1
  def tty? = false
  def isatty = false
end
class CompilerIn < StringIO
  def gets(*a)
    l = super
    if l
      JS.global.call(:__in, l)
      return l
    end
    m = JS.global.call(:__more).to_s
    m.empty? ? nil : m
  end
  def read(*a)
    s = super(*a) || ""
    while (m = JS.global.call(:__more).to_s) != ""
      s += m
    end
    s
  end
  def each_line
    while (l = gets)
      yield l
    end
  end
  def readlines = [].tap { |a| each_line { |l| a << l } }
end
$stdout = CompilerIO.new(:__out)
$stderr = CompilerIO.new(:__err)
$stdin = CompilerIn.new(JS.global[:__stdin].to_s)
file = JS.global[:__file].to_s
status = 0
begin
  eval(JS.global[:__code].to_s, TOPLEVEL_BINDING, file, 1)
rescue SystemExit => e
  status = e.status
rescue Exception => e
  status = 1
  bt = (e.backtrace || []).select { |l| l.start_with?(file + ":") }
  where = e.is_a?(SyntaxError) ? "" : (bt.first ? bt.first + ": " : "")
  $stderr.write(where + e.message.to_s + " (" + e.class.to_s + ")\\n")
  bt.drop(1).first(10).each { |l| $stderr.write("\\tfrom " + l + "\\n") }
  line = e.is_a?(SyntaxError) ? (e.message[/#{Regexp.escape(file)}:(\\d+)/, 1] || e.message[/:(\\d+):/, 1]) : (bt.first && bt.first[/:(\\d+)/, 1])
  JS.global.call(:__rberr, line.to_i, (e.message.to_s.lines.first || '').strip) if line
end
status
`);
      code = Number(r.toString()) || 0;
    } catch (err) {
      io.emit('err', String(err && err.message || err) + '\n');
      code = 1;
    }
    io.flush();
    self.postMessage({ type: 'done', code });
  };
}

class RubyRunner {
  constructor(env) { this.env = env; this.state = 'idle'; this.loading = null; this.spare = null; this.current = null; }
  prepare() {
    if (this.loading) return this.loading;
    this.state = 'loading';
    this.env.onState('loading');
    this.loading = (async () => {
      try {
        const p = await Packs.pack(this.env.base + 'vendor/ruby/ruby.pack.js', ['ruby+stdlib.wasm', 'browser.umd.js']);
        this.glue = await Packs.unpackText(p['browser.umd.js']);
        this.module = await WebAssembly.compile(await Packs.unpackBytes(p['ruby+stdlib.wasm']));
        const w = await this.spawn();
        this.spare = w;
        this.state = 'ready';
        this.env.onState('ready', { version: 'Ruby ' + w.version });
      } catch (err) {
        this.loading = null; this.state = 'failed'; this.env.onState('failed', { message: err.message }); throw err;
      }
    })();
    return this.loading;
  }
  // A worker with a started Ruby VM: resolves { source, worker, version } when it is ready.
  spawn() {
    const source = [this.glue, `(${rubyWorkerMain.toString()})(${workerOutput.toString()}, ${stdinReader.toString()});`].join('\n;\n');
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const ready = new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data.type !== 'ready') return;
        URL.revokeObjectURL(url);
        if (e.data.error) { worker.terminate(); reject(new Error(e.data.error)); }
        else resolve({ worker, version: e.data.version });
      };
      worker.onerror = (e) => { e.preventDefault(); worker.terminate(); reject(new Error(e.message || 'Ruby worker failed')); };
    });
    worker.postMessage({ type: 'init', module: this.module });
    return ready;
  }
  async run(job) {
    await this.prepare();
    const w = await (this.spare || this.spawn());
    this.spare = this.spawn();                 // the next run gets a fresh VM without waiting
    this.spare.catch(() => { this.spare = null; });
    const diagnostics = [];
    const r = new Run(w.worker, job, {
      onMessage: (m) => {
        if (m.type === 'rberror' && m.line) diagnostics.push({ file: job.entry, line: m.line, col: 1, severity: 'error', message: m.message });
      },
    });
    this.current = r;
    r.post({ type: 'run', code: job.files[job.entry], name: job.entry, stdin: job.stdin || '', sab: job.channel ? job.channel.sab : null });
    const res = await r.promise;
    this.current = null;
    res.diagnostics = diagnostics;
    return res;
  }
  stop() { if (this.current) this.current.stop(); }
}

const RUNNERS = { js: JsRunner, ts: TsRunner, clang: ClangRunner, python: PythonRunner, lua: LuaRunner, sql: SqlRunner, ruby: RubyRunner };

root.CompilerRunners = { RUNNERS, Run, StdinChannel, Limit, stdinReader, ClangRunner, PythonRunner, formatTable, sourceMapLines, workerOutput, jsPrelude };
})(typeof self !== 'undefined' ? self : this);
