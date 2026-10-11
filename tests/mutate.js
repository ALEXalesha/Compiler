// Checks of the checks of the Compiler: breaks one key rule at a time in a COPY of the page in a
// temporary folder and runs the matching laws of tests/compiler.spec.js on it (COMPILER_DIR).
// A broken rule must fail at least one law ("mutant killed"). the page itself is never
// changed, so stopping the script half-way spoils nothing.
// The copy takes the page's own files (PAGE_FILES); vendor/ and the shared folder of paths.js
// (python_ide/) are linked (junctions on Windows), not copied - they are tens of megabytes
// and are not mutated.
// Run from the repository root: node tests/mutate.js
// The file is not *.spec.js - Playwright does not run it by itself.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = ROOT;
const PAGE_FILES = ['index.html', 'compiler.css', 'themes.css', 'paths.js', 'js'];
// the shared folder as paths.js names it, relative to the page ('../python_ide/')
const SHARED_REL = /COMPILER_SHARED\s*=\s*'([^']*)'/.exec(fs.readFileSync(path.join(SRC, 'paths.js'), 'utf8'))[1];
const SHARED = path.resolve(SRC, SHARED_REL);
const SPEC = 'tests/compiler.spec.js';

// file - inside web/compiler; from - exact code (must occur once); to - the broken version;
// grep - the laws to run for it (all of them would take long because of C and Python)
const MUTANTS = [
  { name: 'no time limit (the endless loop is not stopped)', file: 'js/runners.js',
    from: "if (job.timeoutMs > 0) this.timer = setTimeout(() => this.finish({ status: 'timeout' }), job.timeoutMs);",
    to: 'if (false) this.timer = 0;', grep: 'endless loop is stopped' },
  { name: 'Stop does not stop', file: 'js/runners.js', from: "  stop() { this.finish({ status: 'stopped' }); }", to: '  stop() {}', grep: 'Stop button' },
  { name: 'JavaScript error line off by one (prelude lines not subtracted right)', file: 'js/runners.js',
    from: "const offset = head.split('\\n').length - 1;", to: "const offset = head.split('\\n').length - 2;", grep: 'JavaScript errors' },
  { name: 'error line is not highlighted', file: 'js/app.js', from: "doc.addLineClass(line, 'background', cls);", to: 'void cls;', grep: 'JavaScript errors|TypeScript' },
  { name: 'the cursor does not go to the error', file: 'js/app.js', from: 'if (errs.length && errs[0].file in files) gotoLine(errs[0].file, errs[0].line);', to: 'void errs;', grep: 'JavaScript errors' },
  { name: 'TypeScript lines are not mapped back from JavaScript', file: 'js/runners.js',
    from: 'if (!job.lineMap) return g;\n      return job.lineMap[g] || null;', to: 'return g;', grep: 'TypeScript' },
  { name: 'compiler messages of C are not parsed into lines', file: 'js/runners.js',
    from: "const m = /^(?:\\/[^:]*\\/)?([^/:\\s][^:]*):(\\d+):(\\d+): (fatal error|error|warning|note): (.*)$/.exec(l);",
    to: 'const m = null;', grep: 'C: Hello' },
  { name: 'Python traceback line is not taken', file: 'js/runners.js', from: 'while ((m = re.exec(text))) last = { file: m[1], line: +m[2] };', to: 'while ((m = re.exec(text))) last = null;', grep: 'Python' },
  { name: 'input() ignores the Input field', file: 'js/runners.js', from: 'if (li >= lines.length) return null;\n    const l = lines[li++]', to: 'if (true) return null;\n    const l = lines[li++]', grep: 'input\\(\\)' },
  { name: 'files are not saved', file: 'js/app.js', from: 'if (!setItem(STORE, JSON.stringify({ files, order, tabs, active, stdin: stdins }))) toast(t(\'saveFailed\'), false);', to: 'void 0;', grep: 'survive a reload' },
  { name: 'theme is not applied', file: 'js/app.js', from: "else document.documentElement.setAttribute('data-theme', theme);", to: 'else void 0;', grep: 'themes' },
];

function runSpec(dir, grep) {
  const r = spawnSync(`npx playwright test ${SPEC} --workers=1 --max-failures=1 --reporter=dot -g "${grep}"`, {
    cwd: ROOT, env: { ...process.env, COMPILER_DIR: dir }, shell: true, encoding: 'utf8', timeout: 15 * 60 * 1000,
  });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

// copy of the page's own files; vendor/ and the shared folder linked where paths.js expects it
function makeCopy() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compiler-mutants-'));
  const dir = path.join(tmp, 'compiler');
  const copy = (from, to) => {
    if (fs.statSync(from).isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const e of fs.readdirSync(from)) copy(path.join(from, e), path.join(to, e));
    } else fs.copyFileSync(from, to);
  };
  fs.mkdirSync(dir, { recursive: true });
  for (const f of PAGE_FILES) copy(path.join(SRC, f), path.join(dir, f));
  const links = [path.join(dir, 'vendor'), path.resolve(dir, SHARED_REL)];
  fs.symlinkSync(path.join(SRC, 'vendor'), links[0], 'junction');
  fs.symlinkSync(SHARED, links[1], 'junction');
  return { tmp, dir, links };
}
function removeCopy({ tmp, links }) {
  // the links go first: removing through a junction would reach the real folders
  for (const l of links) {
    try { fs.unlinkSync(l); } catch (e) { try { fs.rmdirSync(l); } catch (e2) { /* already gone */ } }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

function main() {
  const copyInfo = makeCopy();
  const { dir } = copyInfo;
  let survived = 0;
  try {
    const greps = [...new Set(MUTANTS.map((m) => m.grep))].join('|');
    const base = runSpec(dir, greps);
    console.log(`original copy: ${base.ok ? 'laws green' : 'LAWS RED'}`);
    if (!base.ok) { console.log(base.out.slice(-3000)); process.exitCode = 2; return; }
    for (const m of MUTANTS) {
      const file = path.join(dir, m.file);
      const src = fs.readFileSync(path.join(SRC, m.file), 'utf8');
      const n = src.split(m.from).length - 1;
      if (n !== 1) { console.log(`? ${m.name}: the code is found ${n} times - the mutant is out of date`); survived++; continue; }
      fs.writeFileSync(file, src.replace(m.from, m.to));
      const r = runSpec(dir, m.grep);
      fs.writeFileSync(file, src);
      const failed = /\d+\) .*›\s*(.+)/.exec(r.out);
      console.log(`${r.ok ? 'SURVIVED' : 'killed  '}  ${m.name}${!r.ok && failed ? '  <- ' + failed[1].replace(/[─\s]+$/, '') : ''}`);
      if (r.ok) survived++;
    }
    console.log(`total: killed ${MUTANTS.length - survived} of ${MUTANTS.length}`);
    if (survived) process.exitCode = 1;
  } finally {
    removeCopy(copyInfo);
  }
}

if (require.main === module) main();
module.exports = { MUTANTS };
