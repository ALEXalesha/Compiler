// The page: files and tabs, the editor, running, output, themes and the interface language.
(function () {
'use strict';

const I18N = window.CompilerI18n;
const t = I18N.t;
const Langs = window.CompilerLangs;
const Packs = window.CompilerPacks;
const { RUNNERS, StdinChannel } = window.CompilerRunners;
// typing input while the program runs needs a cross-origin isolated page (SharedArrayBuffer)
const LIVE_INPUT = StdinChannel.available();
const SHARED = window.COMPILER_SHARED || '../python_ide/';
const BASE = '';
const $ = (id) => document.getElementById(id);

const VERSION = '1.1.2';
const STORE = 'compiler.v1';
const THEME_KEY = 'compiler.theme';
const UI_KEY = 'compiler.ui';
const LIMIT_KEY = 'compiler.limit';
const THEMES = ['glass', 'formal', 'light', 'night', 'warm'];
const LIMITS = [2, 5, 10, 30, 60, 0];
const NAME_RE = /^[\w-][\w.-]{0,59}$/;
const PACK_MB = { clang: 35, python: 16, ruby: 12, ts: 2 };

// ---------------------------------------------------------------- storage (never throws)
function getItem(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function setItem(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

// ---------------------------------------------------------------- settings
let theme = getItem(THEME_KEY);
if (!THEMES.includes(theme)) theme = 'glass';
let ui = getItem(UI_KEY) === 'en' ? 'en' : 'ru';
let limit = Number(getItem(LIMIT_KEY));
if (!LIMITS.includes(limit) || getItem(LIMIT_KEY) === null) limit = 10;
I18N.setLang(ui);

function applyTheme() {
  if (theme === 'glass') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}
applyTheme();

// ---------------------------------------------------------------- project
let files = {};        // name -> text
let order = [];        // order in the file list
let tabs = [];         // open tabs
let active = null;
let filePressed = null; // file of the last first press in the list (a second press renames it)
let stdins = {};       // name -> text of the Input field for that file

function defaultProject() {
  files = {}; order = []; stdins = {};
  for (const l of Langs.LANGS) {
    const ex = Langs.example(l.id, 'hello', ui);
    files[ex.file] = ex.code;
    order.push(ex.file);
  }
  tabs = order.slice();
  active = 'main.js';
}
function loadProject() {
  try {
    const d = JSON.parse(getItem(STORE) || 'null');
    if (d && d.files && typeof d.files === 'object' && Object.keys(d.files).length) {
      files = {};
      for (const [n, v] of Object.entries(d.files)) if (NAME_RE.test(n) && typeof v === 'string') files[n] = v;
      order = (Array.isArray(d.order) ? d.order : []).filter((n) => n in files);
      for (const n of Object.keys(files)) if (!order.includes(n)) order.push(n);
      tabs = (Array.isArray(d.tabs) ? d.tabs : []).filter((n) => n in files);
      active = d.active in files ? d.active : (tabs[0] || order[0]);
      if (!tabs.includes(active)) tabs.push(active);
      stdins = d.stdin && typeof d.stdin === 'object' ? d.stdin : {};
      if (order.length) return;
    }
  } catch (e) { /* damaged data: start with the examples */ }
  defaultProject();
}
let saveTimer = null;
function save(now) {
  clearTimeout(saveTimer);
  const doSave = () => {
    if (!setItem(STORE, JSON.stringify({ files, order, tabs, active, stdin: stdins }))) toast(t('saveFailed'), false);
  };
  if (now) doSave(); else saveTimer = setTimeout(doSave, 300);
}
function uniqueName(name) {
  if (!(name in files)) return name;
  const m = /^(.*?)(\d*)(\.[^.]+)?$/.exec(name);
  for (let i = 2; ; i++) { const n = m[1] + i + (m[3] || ''); if (!(n in files)) return n; }
}

// ---------------------------------------------------------------- toast
let toastTimer = null, toastUndo = null;
function toast(text, undo) {
  $('toastText').textContent = text;
  toastUndo = typeof undo === 'function' ? undo : null;
  $('toastUndo').hidden = !toastUndo;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), toastUndo ? 6000 : 3000);
}
$('toastUndo').onclick = () => { if (toastUndo) toastUndo(); $('toast').classList.remove('show'); };

// ---------------------------------------------------------------- output
const out = $('out');
let outChars = 0;
function write(cls, text) {
  if (!text) return;
  const last = out.lastChild;
  if (cls === 'err' || cls === 'warn') { writeLinked(cls, text); return; }
  if (last && last.nodeType === 1 && last.className === cls && !last.dataset.line) last.textContent += text;
  else { const s = document.createElement('span'); s.className = cls; s.textContent = text; out.appendChild(s); }
  after(text.length);
}
// "main.cpp:5:3: error: ..." and 'File "main.py", line 3' become links to the place
function writeLinked(cls, text) {
  const re = /(^|\n|\s|\()(?:File ")?([\w.-]+\.\w+)(?:", line |:)(\d+)/g;
  let pos = 0, m;
  const frag = document.createDocumentFragment();
  const plain = (s) => { if (s) { const e = document.createElement('span'); e.className = cls; e.textContent = s; frag.appendChild(e); } };
  while ((m = re.exec(text))) {
    if (!(m[2] in files)) continue;
    const start = m.index + m[1].length;
    plain(text.slice(pos, start));
    const a = document.createElement('span');
    a.className = cls + ' goto';
    a.textContent = text.slice(start, m.index + m[0].length);
    a.dataset.file = m[2];
    a.dataset.line = m[3];
    a.title = t('jumpTo', { line: m[3] });
    frag.appendChild(a);
    pos = m.index + m[0].length;
  }
  plain(text.slice(pos));
  out.appendChild(frag);
  after(text.length);
}
function after(n) {
  outChars += n;
  while (outChars > 400000 && out.firstChild) { outChars -= out.firstChild.textContent.length; out.removeChild(out.firstChild); }
  out.scrollTop = out.scrollHeight;
}
function clearOut() { out.textContent = ''; outChars = 0; }
out.addEventListener('click', (e) => {
  const g = e.target.closest('.goto');
  if (g) gotoLine(g.dataset.file, +g.dataset.line);
});
$('clearOut').onclick = clearOut;

// ---------------------------------------------------------------- editor
let cm = null;
const docs = {};
function langOf(name) { return Langs.byFile(name); }
function modeOf(name) { const l = langOf(name); return l ? l.mode : 'text/plain'; }
function docFor(name) {
  if (!docs[name]) {
    docs[name] = CodeMirror.Doc(files[name], modeOf(name));
    docs[name].on('change', (d) => {
      const n = Object.keys(docs).find((k) => docs[k] === d);
      if (n && n in files) { files[n] = d.getValue(); save(); }
    });
  }
  return docs[name];
}

function hint(cmi) {
  const l = langOf(active);
  const cur = cmi.getCursor();
  const line = cmi.getLine(cur.line);
  let s = cur.ch;
  while (s > 0 && /[\w$]/.test(line.charAt(s - 1))) s--;
  const prefix = line.slice(s, cur.ch);
  if (!prefix) return null;
  const ci = l && l.id === 'sql';
  const p = ci ? prefix.toLowerCase() : prefix;
  const seen = new Set();
  const list = [];
  const add = (w) => {
    if (w.length <= prefix.length || seen.has(w)) return;
    if ((ci ? w.toLowerCase() : w).startsWith(p)) { seen.add(w); list.push(w); }
  };
  for (const w of (l ? l.words : '').split(' ')) if (w) add(w);
  const words = cmi.getValue().match(/[A-Za-z_$][\w$]{2,}/g) || [];
  for (const w of words) if (list.length < 60) add(w);
  if (!list.length) return null;
  list.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return { list: list.slice(0, 40), from: CodeMirror.Pos(cur.line, s), to: CodeMirror.Pos(cur.line, cur.ch) };
}

function makeEditor() {
  cm = CodeMirror.fromTextArea($('editor'), {
    theme: 'compiler', lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false, matchBrackets: true, autoCloseBrackets: true,
    styleActiveLine: true, gutters: ['CodeMirror-linenumbers', 'diag-gutter'],
    extraKeys: {
      'Ctrl-Enter': () => run(), 'Cmd-Enter': () => run(),
      'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment',
      'Ctrl-Space': (c) => c.showHint({ hint, completeSingle: false }),
      Tab: (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection(' '.repeat(c.getOption('indentUnit')), 'end')),
      'Shift-Tab': (c) => c.indentSelection('subtract'),
    },
  });
  cm.on('inputRead', (c, ch) => {
    if (c.state.completionActive || ch.origin !== '+input' || !/^[\w$]$/.test(ch.text[0])) return;
    const cur = c.getCursor();
    const before = c.getLine(cur.line).slice(0, cur.ch);
    const tok = c.getTokenTypeAt(cur);
    if (tok && /comment|string/.test(tok)) return;
    if (/[\w$]{2,}$/.test(before)) c.showHint({ hint, completeSingle: false });
  });
  cm.on('cursorActivity', () => {
    const c = cm.getCursor();
    $('cursorPos').textContent = t('lineCol', { line: c.line + 1, col: c.ch + 1 });
  });
}

// ---------------------------------------------------------------- diagnostics
let marks = [];        // { name, line, cls }
function clearDiagnostics() {
  for (const m of marks) {
    const d = docs[m.name];
    if (d && m.line < d.lineCount()) d.removeLineClass(m.line, 'background', m.cls);
  }
  marks = [];
  if (cm) cm.clearGutter('diag-gutter');
  renderTabs();
}
function showDiagnostics(list) {
  const seen = new Set();
  // an error and a warning on one line: the line shows the error
  const sorted = list.slice().sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1));
  for (const d of sorted) {
    if (!(d.file in files) || !d.line) continue;
    const doc = docFor(d.file);
    const line = Math.min(d.line, doc.lineCount()) - 1;
    const key = d.file + ':' + line;
    const cls = d.severity === 'error' ? 'error-line' : 'warn-line';
    if (seen.has(key)) continue;
    seen.add(key);
    doc.addLineClass(line, 'background', cls);
    marks.push({ name: d.file, line, cls, severity: d.severity, message: d.message });
  }
  paintGutter();
  renderTabs();
}
function paintGutter() {
  if (!cm) return;
  cm.clearGutter('diag-gutter');
  for (const m of marks) {
    if (m.name !== active) continue;
    const el = document.createElement('span');
    el.className = 'diag-mark' + (m.severity === 'error' ? '' : ' warn');
    el.textContent = m.severity === 'error' ? '●' : '▲';
    el.title = m.message;
    cm.setGutterMarker(m.line, 'diag-gutter', el);
  }
}
function gotoLine(name, line) {
  if (!(name in files)) return;
  openTab(name);
  const doc = cm.getDoc();
  const l = Math.max(0, Math.min(line - 1, doc.lineCount() - 1));
  doc.setCursor({ line: l, ch: 0 });
  cm.scrollIntoView({ line: l, ch: 0 }, 80);
  cm.focus();
}

// ---------------------------------------------------------------- runners and status
const runnerStates = {};
const runners = {};
function runnerFor(id) {
  if (!runners[id]) {
    runnerStates[id] = { state: id === 'js' ? 'ready' : 'idle', info: {} };
    runners[id] = new RUNNERS[id]({
      base: BASE, shared: SHARED, t,
      onState: (state, info) => { runnerStates[id] = { state, info: info || {} }; renderStatus(); },
    });
  }
  return runners[id];
}
let running = null;      // { runner }
function renderStatus() {
  const l = langOf(active);
  const st = $('status');
  let cls = 'ready', text = '';
  if (running) { cls = 'running'; text = running.phase === 'compile' ? t('st_compiling') : t('st_running'); }
  else if (!l) { cls = 'idle'; text = t('unknownLang'); }
  else {
    const rs = runnerStates[l.runner] || { state: l.runner === 'js' ? 'ready' : 'idle', info: {} };
    cls = rs.state;
    if (rs.state === 'ready') text = t('st_ready', { version: rs.info.version || l.name });
    else if (rs.state === 'loading') text = PACK_MB[l.runner] ? t('loadingBig', { lang: l.name, mb: PACK_MB[l.runner] }) : t('st_loading', { lang: l.name });
    else if (rs.state === 'failed') text = t('st_failed', { lang: l.name, message: rs.info.message || '' });
    else text = t('st_idle', { lang: l.name });
  }
  st.className = 'status ' + cls;
  $('statusText').textContent = text;
  $('fileLang').textContent = l ? l.name : '';
  $('runBtn').disabled = !!running || !l;
  $('stopBtn').disabled = !running;
}
// The engine of the selected language starts loading as soon as the language is chosen.
function prepareActive() {
  const l = langOf(active);
  if (!l) return;
  runnerFor(l.runner).prepare().catch(() => {});
  renderStatus();
}

const fmtS = (ms) => (ms / 1000).toFixed(2);
async function run() {
  if (running || !cm) return;
  const name = active;
  const l = langOf(name);
  if (!l) { toast(t('unknownLang'), false); return; }
  files[name] = cm.getValue();
  save(true);
  clearDiagnostics();
  clearOut();
  write('info', t('runStart', { file: name }) + '\n');
  const runner = runnerFor(l.runner);
  running = { runner, phase: l.runner === 'clang' || l.runner === 'ts' ? 'compile' : 'run' };
  renderStatus();
  let errText = '', eofHint = false;
  const job = {
    files: Object.assign({}, files), entry: name, lang: l.id, stdin: $('stdin').value, timeoutMs: limit * 1000,
    out: (s) => { if (running) running.phase = 'run'; write('out', s); },
    err: (s) => { errText += s; write('err', s); },
    warn: (s) => write('warn', s),
    info: (s) => write('info', s),
    echo: (s) => write('in', s),
    // the program read past the Input field and the page cannot ask the person (file://)
    onEof: () => { if (eofHint) return; eofHint = true; write('hint-line', t('stdinMore') + '\n'); flashStdin(); },
  };
  if (LIVE_INPUT) { job.channel = new StdinChannel(); job.ask = askLine; }
  let res;
  try {
    res = await runner.run(job);
  } catch (err) {
    res = { status: 'failed', message: err && err.message || String(err) };
  }
  running = null;
  closeAsk(null);
  if (res.trap) write('err', t('trap', { message: res.trap }) + '\n');
  if (res.diagnostics && res.diagnostics.length) showDiagnostics(res.diagnostics);
  const errs = (res.diagnostics || []).filter((d) => d.severity === 'error');
  if (errs.length && errs[0].file in files) gotoLine(errs[0].file, errs[0].line);
  const s = res.status;
  if (/EOFError|undefined method 'chomp' for nil|attempt to (concatenate|perform arithmetic on) a nil value|of null \(reading|Cannot read properties of null|for nil/.test(errText) && !eofHint && !$('stdin').value.trim()) write('hint-line', t('stdinHint') + '\n');
  if (s === 'compile-error' && /exceptions (disabled|are disabled)|cannot use '(throw|try)'/.test(errText)) write('hint-line', t('noExceptions') + '\n');
  const line = s === 'ok' ? (res.compileMs ? t('doneOkCompile', { c: fmtS(res.compileMs), s: fmtS(res.ms) }) : t('doneOk', { s: fmtS(res.ms) }))
    : s === 'compile-error' ? t('doneCompileErr')
    : s === 'timeout' ? t('doneTimeout', { s: limit })
    : s === 'stopped' ? t('doneStopped')
    : s === 'output-limit' ? t('doneOutput')
    : s === 'failed' ? t('doneFailed', { message: res.message || '' })
    : t('doneErr', { code: res.code === undefined ? 1 : res.code });
  if (out.lastChild && !/\n$/.test(out.lastChild.textContent)) write('out', '\n');
  write(s === 'ok' ? 'info' : 'err', line + '\n');
  renderStatus();
  return res;
}
function stop() {
  if (!running) return;
  closeAsk(null);
  running.runner.stop();
}

// ---------------------------------------------------------------- input while the program runs
// The program waits for a line: an input box right in the output. Enter sends the line (it stays
// in the output as typed input), Ctrl+D ends the input, Stop works as usual.
let asking = null;   // { input, resolve }
function askLine() {
  closeAsk(null);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.className = 'term-in';
    input.id = 'termIn';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', t('typeLine'));
    input.placeholder = t('typeLine');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const v = input.value; closeAsk(v); write('in', v + '\n'); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D' || e.code === 'KeyD')) { e.preventDefault(); closeAsk(null); write('info', '^D\n'); }
    });
    out.appendChild(input);
    after(0);
    asking = { input, resolve };
    input.focus({ preventScroll: true });
    input.scrollIntoView({ block: 'nearest' });
  });
}
function closeAsk(value) {
  if (!asking) return;
  const a = asking;
  asking = null;
  a.input.remove();
  a.resolve(value);
}
function flashStdin() {
  const box = $('stdin');
  box.classList.remove('flash');
  void box.offsetWidth;
  box.classList.add('flash');
}

// ---------------------------------------------------------------- files and tabs
function badge(name) {
  const l = langOf(name);
  const b = document.createElement('span');
  b.className = 'badge ' + (l ? l.id : '');
  b.textContent = l ? (l.id === 'python' ? 'PY' : l.id === 'ruby' ? 'RB' : l.id.toUpperCase()) : '…';
  return b;
}
function iconBtn(text, titleKey, onClick) {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.textContent = text;
  b.title = t(titleKey);
  b.setAttribute('aria-label', t(titleKey));
  b.onclick = (e) => { e.stopPropagation(); onClick(); };
  return b;
}
function renderFiles() {
  const box = $('files');
  box.textContent = '';
  for (const name of order) {
    const row = document.createElement('div');
    row.className = 'file' + (name === active ? ' active' : '');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', name === active ? 'true' : 'false');
    row.tabIndex = 0;
    row.dataset.name = name;
    const label = document.createElement('span');
    label.className = 'file-name';
    label.textContent = name;
    row.append(badge(name), label, iconBtn('✎', 'rename', () => startRename(name, row)), iconBtn('×', 'delete', () => deleteFile(name)));
    row.onclick = () => { openTab(name); document.body.classList.remove('side-open'); };
    // the first click opens the file and draws the list again, so the dblclick goes to the row
    // that is already gone: rename on the second press of the same file instead
    row.onmousedown = (e) => {
      if (e.button !== 0) return;
      if (e.detail === 1) filePressed = name;
      else if (e.detail === 2 && filePressed === name && !row.querySelector('input')) {
        e.preventDefault();
        startRename(name, row);
      }
    };
    row.ondblclick = () => { if (row.isConnected && !row.querySelector('input')) startRename(name, row); };
    row.onkeydown = (e) => {
      if (e.key === 'Enter') openTab(name);
      else if (e.key === 'F2') { e.preventDefault(); startRename(name, row); }
      else if (e.key === 'Delete') deleteFile(name);
    };
    box.appendChild(row);
  }
}
function renderTabs() {
  const box = $('tabs');
  box.textContent = '';
  for (const name of tabs) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (name === active ? ' active' : '') + (marks.some((m) => m.name === name && m.severity === 'error') ? ' has-error' : '');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', name === active ? 'true' : 'false');
    tab.tabIndex = 0;
    tab.dataset.name = name;
    const label = document.createElement('span');
    label.textContent = name;
    const dot = document.createElement('span');
    dot.className = 'dot';
    tab.append(badge(name), label, dot, iconBtn('×', 'closeTab', () => closeTab(name)));
    tab.onclick = () => openTab(name);
    tab.onauxclick = (e) => { if (e.button === 1) closeTab(name); };
    tab.onkeydown = (e) => { if (e.key === 'Enter') openTab(name); };
    box.appendChild(tab);
  }
}
function openTab(name) {
  if (!(name in files)) return;
  if (!tabs.includes(name)) tabs.push(name);
  if (active !== name || cm.getDoc() !== docFor(name)) {
    active = name;
    cm.swapDoc(docFor(name));
  }
  $('stdin').value = stdins[name] || '';
  renderTabs();
  renderFiles();
  renderLangSel();
  paintGutter();
  prepareActive();
  save();
  const el = $('tabs').querySelector('.tab.active');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function closeTab(name) {
  if (tabs.length <= 1) return;
  const i = tabs.indexOf(name);
  tabs.splice(i, 1);
  if (active === name) openTab(tabs[Math.min(i, tabs.length - 1)]);
  else { renderTabs(); save(); }
}
function addFile(name, text, stdin) {
  files[name] = text;
  if (!order.includes(name)) order.push(name);
  if (stdin !== undefined) stdins[name] = stdin;
  delete docs[name];
  openTab(name);
  save();
}
function deleteFile(name) {
  if (order.length <= 1) return;
  const snapshot = { text: files[name], pos: order.indexOf(name), tabPos: tabs.indexOf(name), stdin: stdins[name], wasActive: active === name };
  delete files[name];
  delete docs[name];
  delete stdins[name];
  order = order.filter((n) => n !== name);
  const ti = tabs.indexOf(name);
  if (ti >= 0) tabs.splice(ti, 1);
  if (!tabs.length) tabs.push(order[0]);
  if (active === name) { active = null; openTab(tabs[Math.min(Math.max(ti, 0), tabs.length - 1)]); }
  else { renderFiles(); renderTabs(); }
  save();
  toast(t('deleted', { name }), () => {
    files[name] = snapshot.text;
    order.splice(snapshot.pos, 0, name);
    if (snapshot.stdin !== undefined) stdins[name] = snapshot.stdin;
    if (snapshot.tabPos >= 0) tabs.splice(Math.min(snapshot.tabPos, tabs.length), 0, name);
    if (snapshot.wasActive) openTab(name); else { renderFiles(); renderTabs(); }
    save();
  });
}
function nameInput(initial, onDone, container) {
  const input = document.createElement('input');
  input.value = initial;
  input.spellcheck = false;
  input.setAttribute('aria-label', t('newFile'));
  const errEl = document.createElement('div');
  errEl.className = 'name-err';
  let done = false;
  const finish = (ok) => {
    if (done) return;
    if (ok) {
      const v = input.value.trim();
      const problem = onDone(v, true);
      if (problem) { errEl.textContent = problem; input.focus(); return; }
    }
    done = true;
    onDone(null, false);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  input.onblur = () => setTimeout(() => finish(input.value.trim() !== initial && input.value.trim() !== ''), 0);
  container.append(input, errEl);
  input.focus();
  const dot = initial.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : initial.length);
  return input;
}
function checkName(v, old) {
  if (!NAME_RE.test(v)) return t('badName');
  if (v !== old && v in files) return t('fileExists');
  return null;
}
function startNewFile() {
  const box = $('files');
  const row = document.createElement('div');
  row.className = 'new-file';
  box.appendChild(row);
  const l = langOf(active);
  const suggested = uniqueName('new.' + (l ? l.exts[0] : 'txt'));
  nameInput(suggested, (v, ok) => {
    if (!ok) { row.remove(); return null; }
    const p = checkName(v);
    if (p) return p;
    const lang = langOf(v);
    const ex = lang ? Langs.example(lang.id, 'hello', ui) : null;
    row.remove();
    addFile(v, ex ? ex.code : '');
    return null;
  }, row);
}
function startRename(name, row) {
  row.textContent = '';
  row.onclick = null;
  nameInput(name, (v, ok) => {
    if (!ok || v === name) { renderFiles(); return null; }
    const p = checkName(v, name);
    if (p) return p;
    files[v] = files[name];
    delete files[name];
    order[order.indexOf(name)] = v;
    const ti = tabs.indexOf(name);
    if (ti >= 0) tabs[ti] = v;
    if (name in stdins) { stdins[v] = stdins[name]; delete stdins[name]; }
    // the shown document keeps its undo history; the others are made again on demand
    const d = docs[name];
    delete docs[name];
    if (d && cm.getDoc() === d) { docs[v] = d; cm.setOption('mode', modeOf(v)); }
    if (active === name) active = v;
    renderFiles(); renderTabs(); renderLangSel(); prepareActive(); save();
    return null;
  }, row);
}

// ---------------------------------------------------------------- toolbar
function fillSelect(sel, items) {
  sel.textContent = '';
  for (const [value, label] of items) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  }
}
function renderLangSel() {
  const l = langOf(active);
  fillSelect($('langSel'), [...(l ? [] : [['', '—']]), ...Langs.LANGS.map((x) => [x.id, x.name])]);
  $('langSel').value = l ? l.id : '';
  const exItems = [['', t('examplesPick')]];
  if (l) for (const id of Langs.EXAMPLE_IDS) if (Langs.example(l.id, id, ui)) exItems.push([id, t('ex_' + id)]);
  fillSelect($('exampleSel'), exItems);
  $('exampleSel').disabled = !l;
  renderStatus();
}
$('langSel').onchange = () => {
  const l = Langs.byId($('langSel').value);
  if (!l) return;
  const main = 'main.' + l.exts[0];
  const existing = order.find((n) => langOf(n) === l && n === main) || order.find((n) => langOf(n) === l);
  if (existing) openTab(existing);
  else { const ex = Langs.example(l.id, 'hello', ui); addFile(ex.file in files ? uniqueName(ex.file) : ex.file, ex.code, ex.stdin); }
};
$('exampleSel').onchange = () => {
  const l = langOf(active);
  const id = $('exampleSel').value;
  $('exampleSel').value = '';
  if (!l || !id) return;
  const ex = Langs.example(l.id, id, ui);
  if (!ex) return;
  if (ex.file in files && files[ex.file] === ex.code) { stdins[ex.file] = ex.stdin; openTab(ex.file); return; }
  addFile(ex.file in files ? uniqueName(ex.file) : ex.file, ex.code, ex.stdin);
};
function renderToolbar() {
  fillSelect($('limitSel'), LIMITS.map((n) => [String(n), n ? t('seconds', { n }) : t('noLimit')]));
  $('limitSel').value = String(limit);
  fillSelect($('themeSel'), THEMES.map((x) => [x, t('th_' + x)]));
  $('themeSel').value = theme;
  $('uiLangBtn').textContent = ui === 'ru' ? 'EN' : 'RU';
  I18N.apply();
  document.title = ui === 'ru' ? 'Компилятор - C, C++, Python, JavaScript и другие языки в браузере' : 'Compiler - C, C++, Python, JavaScript and more in the browser';
  renderLangSel();
  if (cm) { const c = cm.getCursor(); $('cursorPos').textContent = t('lineCol', { line: c.line + 1, col: c.ch + 1 }); }
}
$('limitSel').onchange = () => { limit = Number($('limitSel').value); setItem(LIMIT_KEY, String(limit)); };
$('themeSel').onchange = () => { theme = $('themeSel').value; applyTheme(); setItem(THEME_KEY, theme); };
$('uiLangBtn').onclick = () => {
  ui = ui === 'ru' ? 'en' : 'ru';
  I18N.setLang(ui);
  setItem(UI_KEY, ui);
  renderToolbar();
  renderFiles();
  renderTabs();
};
$('runBtn').onclick = () => run();
$('stopBtn').onclick = () => stop();
$('newFile').onclick = () => startNewFile();
$('sideToggle').onclick = () => document.body.classList.toggle('side-open');
// Narrow window (1.1.2): the file list closes with a click beside it and with Esc - before only by picking a file
const closeSide = () => document.body.classList.remove('side-open');
document.addEventListener('pointerdown', (e) => {
  if (document.body.classList.contains('side-open') && !e.target.closest('#sidebar, #sideToggle')) closeSide();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.defaultPrevented && document.body.classList.contains('side-open')) closeSide();
});
// Height of the top bar (it wraps in a narrow window): the file list starts under it
new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', document.querySelector('.topbar').offsetHeight + 'px')).observe(document.querySelector('.topbar'));
// Which scroll bar: a classic one takes room (width > 0), an overlay one does not (width 0)
const overlayScrollbars = () => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:-999px;top:0;width:80px;height:80px;overflow:scroll'; document.body.appendChild(d); const w = d.offsetWidth - d.clientWidth; d.remove(); return w === 0; };
document.documentElement.classList.toggle('overlay-sb', overlayScrollbars());
$('restoreExamples').onclick = () => {
  for (const l of Langs.LANGS) {
    const ex = Langs.example(l.id, 'hello', ui);
    if (!(ex.file in files)) { files[ex.file] = ex.code; order.push(ex.file); }
    if (!tabs.includes(ex.file)) tabs.push(ex.file);
  }
  renderFiles(); renderTabs(); save();
};
$('stdin').addEventListener('input', () => { stdins[active] = $('stdin').value; save(); });

// import / export: files from disk, and the current file as a download
$('importBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = async () => {
  const list = [...$('fileInput').files];
  $('fileInput').value = '';
  let n = 0, last = null;
  for (const f of list) {
    if (f.size > 1024 * 1024) { toast(t('tooBig', { name: f.name }), false); continue; }
    const text = await f.text();
    let name = f.name.replace(/[^\w.-]/g, '_').slice(-60).replace(/^\./, '_');
    if (!NAME_RE.test(name)) name = 'file.txt';
    if (name in files && files[name] !== text) name = uniqueName(name);
    files[name] = text;
    delete docs[name];
    if (!order.includes(name)) order.push(name);
    if (!tabs.includes(name)) tabs.push(name);
    last = name;
    n++;
  }
  if (last) openTab(last);
  save();
  if (n) toast(t('imported', { n }), false);
};
$('exportBtn').onclick = () => {
  if (!active) return;
  const blob = new Blob([cm.getValue()], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = active;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'F5' && e.shiftKey) { e.preventDefault(); stop(); }
  else if (e.key === 'F5') { e.preventDefault(); run(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(true); }
});
window.addEventListener('beforeunload', () => save(true));

// ---------------------------------------------------------------- start
async function boot() {
  loadProject();
  renderToolbar();
  renderFiles();
  renderTabs();
  const cmBase = SHARED + 'vendor/codemirror/';
  try {
    Packs.loadStyle(cmBase + 'codemirror.css');
    Packs.loadStyle('vendor/codemirror/show-hint.css');
    await Packs.loadScript(cmBase + 'codemirror.js');
    for (const f of ['python.js', 'matchbrackets.js', 'closebrackets.js', 'active-line.js', 'comment.js']) await Packs.loadScript(cmBase + f);
    for (const f of ['javascript.js', 'clike.js', 'lua.js', 'sql.js', 'ruby.js', 'show-hint.js']) await Packs.loadScript('vendor/codemirror/' + f);
  } catch (err) {
    write('err', 'CodeMirror: ' + err.message + '\n');
    return;
  }
  makeEditor();
  const name = active;
  active = null;
  openTab(name);
  $('version').textContent = 'v' + VERSION;
  window.__compiler = { cm, run, stop, runners, runnerStates, files: () => files, gotoLine, version: VERSION };
  document.documentElement.dataset.ready = '1';
}
boot();
})();
