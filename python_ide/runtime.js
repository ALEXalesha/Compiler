// Python в отдельном потоке (Web Worker) без сети.
//
// Почему так сложно: страница открывается по file://, а там браузер запрещает fetch()
// соседних файлов и запуск Worker из файла. Поэтому:
//   - Pyodide лежит в vendor/pyodide в виде обычных <script>-файлов (исходники строками,
//     wasm и стандартная библиотека - в base64), они подключаются тегом <script>;
//   - Worker собирается из Blob: код загрузчика Pyodide + наш код ниже;
//   - fetch внутри Worker подменён: wasm и stdlib отдаются из переданных байтов,
//     любой другой сетевой запрос отклоняется - страница гарантированно офлайн.
// Отдельный поток нужен, чтобы долгий или бесконечный цикл не вешал страницу
// и его можно было остановить кнопкой «Стоп» (поток уничтожается и запускается заново).
(function () {
'use strict';

const WORKER_CODE = `
'use strict';
let py = null;
let stdinLines = [];
const HOME = '/home/pyodide';
let userFiles = [];

function post(type, data) { self.postMessage(Object.assign({ type }, data)); }

// Вывод копится и уходит пачками: Python работает синхронно, таймеры в это время не
// срабатывают, поэтому пачка отправляется по размеру или по прошедшему времени при записи.
let outBuf = '', outKind = 'out', lastFlush = 0;
function flushOut() {
  if (outBuf) { post(outKind, { text: outBuf }); outBuf = ''; }
  lastFlush = performance.now();
}
function emit(kind, text) {
  if (kind !== outKind) { flushOut(); outKind = kind; }
  outBuf += text;
  if (outBuf.length > 65536 || performance.now() - lastFlush > 40) flushOut();
}

const RUNNER = \`
import sys, runpy, traceback

def __mix_run(path, home):
    for name, mod in list(sys.modules.items()):
        f = getattr(mod, '__file__', None) or ''
        if f.startswith(home + '/'):
            del sys.modules[name]
    if home not in sys.path:
        sys.path.insert(0, home)
    code = 0
    try:
        runpy.run_path(path, run_name='__main__')
    except SystemExit as e:
        if e.code is None or e.code == 0:
            code = 0
        elif isinstance(e.code, int):
            code = e.code
        else:
            print(e.code, file=sys.stderr)
            code = 1
    except BaseException:
        et, ev, tb = sys.exc_info()
        frames = [f for f in traceback.extract_tb(tb) if f.filename.startswith(home + '/')]
        if frames:
            print('Traceback (most recent call last):', file=sys.stderr)
            print(''.join(traceback.format_list(frames)), end='', file=sys.stderr)
        print(''.join(traceback.format_exception_only(et, ev)), end='', file=sys.stderr)
        code = 1
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
    return code
\`;

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const blobs = {
      'pyodide.asm.wasm': [m.wasm, 'application/wasm'],
      'python_stdlib.zip': [m.stdlib, 'application/zip'],
    };
    self.fetch = async (url) => {
      const u = String(url && url.url ? url.url : url);
      const name = u.split('?')[0].split('/').pop();
      if (blobs[name]) return new Response(blobs[name][0], { headers: { 'Content-Type': blobs[name][1] } });
      throw new TypeError('офлайн-сборка: сетевой запрос отклонён: ' + u);
    };
    try {
      py = await loadPyodide({
        indexURL: 'https://pyodide.invalid/',
        packageBaseUrl: 'https://pyodide.invalid/',
        lockFileContents: m.lock,
        env: { HOME },
      });
      const dec = new TextDecoder();
      const decErr = new TextDecoder();
      py.setStdout({ write: (buf) => { emit('out', dec.decode(buf, { stream: true })); return buf.length; } });
      py.setStderr({ write: (buf) => { emit('err', decErr.decode(buf, { stream: true })); return buf.length; } });
      py.setStdin({ stdin: () => {
        if (!stdinLines.length) return null;
        const line = stdinLines.shift();
        flushOut();
        post('stdin', { text: line });
        return line;
      } });
      py.runPython(RUNNER);
      post('ready', { version: py.runPython('import sys; sys.version.split()[0]') });
    } catch (err) {
      post('fail', { message: String(err && err.message || err) });
    }
  } else if (m.type === 'run') {
    try {
      for (const name of userFiles) {
        if (!(name in m.files)) { try { py.FS.unlink(HOME + '/' + name); } catch (x) {} }
      }
      for (const [name, text] of Object.entries(m.files)) py.FS.writeFile(HOME + '/' + name, text);
      userFiles = Object.keys(m.files);
      stdinLines = m.stdin.slice();
      py.FS.chdir(HOME);
      const t0 = performance.now();
      const run = py.globals.get('__mix_run');
      const code = run(HOME + '/' + m.entry, HOME);
      run.destroy();
      flushOut();
      post('done', { code, ms: performance.now() - t0 });
    } catch (err) {
      flushOut();
      post('err', { text: String(err && err.message || err) + '\\n' });
      post('done', { code: 1, ms: 0 });
    }
  }
};
`;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('не найден файл ' + src));
    document.head.appendChild(s);
  });
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let assets = null;
async function loadAssets(base) {
  if (assets) return assets;
  await loadScript(base + 'pyodide-src.js');
  await loadScript(base + 'pyodide-stdlib.js');
  await loadScript(base + 'pyodide-wasm.js');
  const P = window.PYODIDE_OFFLINE;
  assets = {
    version: P.version,
    lock: P.lock,
    workerUrl: URL.createObjectURL(new Blob([P.asm, '\n;\n', P.loader, '\n;\n', WORKER_CODE], { type: 'text/javascript' })),
    wasm: b64ToBytes(window.PYODIDE_OFFLINE_WASM),
    stdlib: b64ToBytes(window.PYODIDE_OFFLINE_STDLIB),
  };
  // Строки base64 больше не нужны - освобождаем память.
  delete window.PYODIDE_OFFLINE_WASM;
  delete window.PYODIDE_OFFLINE_STDLIB;
  return assets;
}

class PyRuntime {
  // on: { out(text), err(text), stdin(text), state(name, info) }
  constructor(on, base = 'vendor/pyodide/') {
    this.on = on;
    this.base = base;
    this.worker = null;
    this.state = 'idle';     // idle | loading | ready | running | failed
    this.pending = null;
    // Сколько ждать запуска Python; проверки подставляют меньшее значение.
    this.timeoutMs = window.__PY_START_TIMEOUT_MS || 45000;
  }

  setState(s, info) { this.state = s; this.on.state && this.on.state(s, info); }

  async start() {
    this.setState('loading');
    let a;
    try { a = await loadAssets(this.base); }
    catch (err) { this.setState('failed', { message: err.message }); return; }
    const w = new Worker(a.workerUrl);
    this.worker = w;
    await new Promise((resolve) => {
      // Если wasm не создался, Pyodide только пишет предупреждение и ждёт вечно -
      // поэтому ограничиваем запуск по времени и честно сообщаем об ошибке.
      const timer = setTimeout(() => {
        w.terminate();
        this.setState('failed', { message: `не запустился за ${this.timeoutMs / 1000} с` });
        resolve();
      }, this.timeoutMs);
      const finish = () => { clearTimeout(timer); resolve(); };
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') { this.version = m.version; this.setState('ready', { version: m.version }); finish(); }
        else if (m.type === 'fail') { this.setState('failed', { message: m.message }); finish(); }
        else this.handle(m);
      };
      w.onerror = (e) => { e.preventDefault(); this.setState('failed', { message: e.message || 'ошибка потока Python' }); finish(); };
      // Байты копируются (не передаются), чтобы после «Стоп» запустить Python заново.
      w.postMessage({ type: 'init', wasm: a.wasm.slice().buffer, stdlib: a.stdlib.slice().buffer, lock: a.lock });
    });
    this.worker.onmessage = (e) => this.handle(e.data);
  }

  handle(m) {
    if (m.type === 'out') this.on.out(m.text);
    else if (m.type === 'err') this.on.err(m.text);
    else if (m.type === 'stdin') this.on.stdin && this.on.stdin(m.text);
    else if (m.type === 'done') {
      const p = this.pending;
      this.pending = null;
      this.setState('ready', { version: this.version });
      if (p) p({ code: m.code, ms: m.ms, stopped: false });
    }
  }

  run(files, entry, stdin) {
    if (this.state !== 'ready') return Promise.resolve({ code: -1, notReady: true });
    this.setState('running');
    return new Promise((resolve) => {
      this.pending = resolve;
      this.worker.postMessage({ type: 'run', files, entry, stdin });
    });
  }

  // Остановить выполнение: поток уничтожается, Python запускается заново.
  async stop() {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    const p = this.pending;
    this.pending = null;
    if (p) p({ code: -1, stopped: true });
    await this.start();
  }
}

window.PyRuntime = PyRuntime;
})();
