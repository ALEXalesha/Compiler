// Laws of the Compiler (index.html): programs run in workers without the network, the time
// limit stops an endless loop and the page stays alive, errors point at their line (the line is
// highlighted and the cursor goes there), input comes from the Input field, files and settings
// survive a reload, themes and the interface language switch.
// COMPILER_DIR points the checks at a copy of the page (tests/mutate.js).
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const { pageUrl } = require('./helpers');

const DIR = process.env.COMPILER_DIR || path.dirname(fileURLToPath(pageUrl('compiler')));
const URL_ = pathToFileURL(path.join(DIR, 'index.html')).href;
const DONE = /─── (готово|компиляция|ошибка|время вышло|остановлено|не запустилось|слишком|done|compiled|error|time is up|stopped|could not|too much)/;

test.describe.configure({ timeout: 120_000 });

async function openPage(page, { viewport } = {}) {
  if (viewport) await page.setViewportSize(viewport);
  const errors = [];
  const net = [];
  page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (/^https?:/.test(r.url())) net.push(r.url()); });
  await page.addInitScript(() => {
    // the page has no pointer lock; the stub keeps the rule of all checks here
    Element.prototype.requestPointerLock = function () {};
    document.exitPointerLock = function () {};
  });
  await page.route(/^https?:\/\//, (route) => route.abort());
  await require('./helpers').lockFirst(page); await page.goto(URL_);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 20_000 });
  return { errors, net };
}
const out = (page) => page.locator('#out');
const setCode = (page, code) => page.evaluate((c) => window.__compiler.cm.setValue(c), code);
const cursorLine = (page) => page.evaluate(() => window.__compiler.cm.getCursor().line + 1);
const errorLines = (page) => page.evaluate(() => {
  const cm = window.__compiler.cm;
  const lines = [];
  cm.eachLine((h) => { if (/error-line/.test(h.bgClass || '')) lines.push(cm.getLineNumber(h) + 1); });
  return lines;
});
async function pick(page, name) {
  await page.locator(`#files .file[data-name="${name}"]`).click();
  await expect(page.locator('.tab.active')).toHaveAttribute('data-name', name);
}
async function run(page, timeout = 60_000) {
  await page.locator('#runBtn').click();
  await expect(out(page)).toContainText(DONE, { timeout });
}
async function engineReady(page, re, timeout) {
  await expect(page.locator('#statusText')).toHaveText(re, { timeout });
}

test('JavaScript: Hello runs in a worker without the network, output in the panel', async ({ page }) => {
  const { errors, net } = await openPage(page);
  await expect(page.locator('.tab.active')).toHaveAttribute('data-name', 'main.js');
  await run(page);
  await expect(out(page)).toContainText('Hello, World!');
  await expect(out(page)).toContainText(/─── готово за \d+\.\d\d с ───/);
  await setCode(page, 'const xs = [3, 1, 2];\nconsole.log(xs.sort(), { a: 1 }, new Set([1]));\nconsole.error("bad");\n');
  await run(page);
  await expect(out(page)).toContainText("[ 1, 2, 3 ] { a: 1 } Set(1) { 1 }");
  await expect(out(page).locator('.err')).toContainText('bad');
  expect(net).toEqual([]);
  expect(errors).toEqual([]);
});

test('JavaScript: an endless loop is stopped by the time limit, the page stays alive', async ({ page }) => {
  await openPage(page);
  await page.selectOption('#limitSel', '2');
  await setCode(page, 'console.log("start");\nwhile (true) {}\n');
  const t0 = Date.now();
  await page.locator('#runBtn').click();
  await expect(page.locator('#statusText')).toHaveText('Выполняется…');
  await expect(out(page)).toContainText('start');
  // the page answers while the program loops: the field takes text, the stop button is on
  await page.locator('#stdin').fill('alive');
  await expect(page.locator('#stopBtn')).toBeEnabled();
  await expect(out(page)).toContainText('─── время вышло (2 с): программа остановлена ───', { timeout: 15_000 });
  expect(Date.now() - t0).toBeLessThan(12_000);
  await expect(page.locator('#runBtn')).toBeEnabled();
  await setCode(page, 'console.log(6 * 7);\n');
  await run(page);
  await expect(out(page)).toContainText('42');
});

test('Stop button stops a running program at once', async ({ page }) => {
  await openPage(page);
  await page.selectOption('#limitSel', '0');            // no limit: only the button stops it
  await setCode(page, 'let i = 0;\nwhile (true) { i++; }\n');
  await page.locator('#runBtn').click();
  await expect(page.locator('#stopBtn')).toBeEnabled();
  await page.waitForTimeout(500);
  await page.locator('#stopBtn').click();
  await expect(out(page)).toContainText('─── остановлено ───', { timeout: 5_000 });
  await expect(page.locator('#stopBtn')).toBeDisabled();
});

test('JavaScript errors: the line is highlighted and the cursor goes there', async ({ page }) => {
  await openPage(page);
  await setCode(page, 'console.log(1);\n\nlet = = 2;\n');
  await run(page);
  await expect(out(page)).toContainText(/main\.js:3:\d+: SyntaxError/);
  expect(await errorLines(page)).toEqual([3]);
  expect(await cursorLine(page)).toBe(3);
  await setCode(page, 'function f(x) {\n  return x.y.z;\n}\nconsole.log("before");\nf({});\n');
  await run(page);
  await expect(out(page)).toContainText('before');
  await expect(out(page)).toContainText(/main\.js:2: TypeError: Cannot read properties of undefined/);
  await expect(out(page)).toContainText(/at f \(main\.js:2:\d+\)/);
  expect(await errorLines(page)).toEqual([2]);
  // the place in the output is a link to the line
  await page.evaluate(() => window.__compiler.cm.setCursor({ line: 4, ch: 0 }));
  await out(page).locator('.goto').first().click();
  expect(await cursorLine(page)).toBe(2);
  // a clean run removes the highlight
  await setCode(page, 'console.log("ok");\n');
  await run(page);
  expect(await errorLines(page)).toEqual([]);
});

test('JavaScript input(): lines from the Input field, null when they are over', async ({ page }) => {
  await openPage(page);
  await setCode(page, 'const a = input("a? ");\nconst b = input();\nconst c = input();\nconsole.log(a + "+" + b, c);\n');
  await page.fill('#stdin', 'x\ny\n');
  await run(page);
  await expect(out(page)).toContainText('a? x');
  await expect(out(page)).toContainText('x+y null');
});

test('TypeScript: a type error stops the run and points at the line; correct code runs', async ({ page }) => {
  await openPage(page);
  await pick(page, 'main.ts');
  await engineReady(page, /^TypeScript 5\.\d+\.\d+ готов$/, 60_000);
  await setCode(page, 'interface P { age: number }\n\nconst p: P = { age: "old" };\nconsole.log("never");\n');
  await run(page);
  await expect(out(page)).toContainText(/main\.ts:3:\d+: error: Type 'string' is not assignable to type 'number'/);
  await expect(out(page)).toContainText('─── ошибка компиляции ───');
  await expect(out(page)).not.toContainText('never');
  expect(await errorLines(page)).toEqual([3]);
  // types are removed before running: the error line of a runtime error is the TypeScript line
  await setCode(page, 'interface P { age: number }\n\n\nfunction f(p: P): number { throw new Error("boom " + p.age); }\nconsole.log(f({ age: 5 }));\n');
  await run(page);
  await expect(out(page)).toContainText('main.ts:4: Error: boom 5');
  expect(await errorLines(page)).toEqual([4]);
});

test('Python: print, input() from the field, a traceback with the line', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page);
  await pick(page, 'main.py');
  await engineReady(page, /^Python 3\.\d+\.\d+ готов$/, 120_000);
  await setCode(page, 'name = input("Name: ")\nprint(f"Hi, {name}!")\nprint(sum(range(101)))\n');
  await page.fill('#stdin', 'Vera\n');
  await run(page);
  await expect(out(page)).toContainText('Name: Vera');
  await expect(out(page)).toContainText('Hi, Vera!');
  await expect(out(page)).toContainText('5050');
  await expect(out(page)).toContainText(/─── готово за/);
  await setCode(page, 'x = 1\ny = 0\nprint(x / y)\n');
  await run(page);
  await expect(out(page)).toContainText('File "main.py", line 3');
  await expect(out(page)).toContainText('ZeroDivisionError: division by zero');
  expect(await errorLines(page)).toEqual([3]);
  // input() beyond the field: a hint about the field
  await setCode(page, 'print(input())\n');
  await page.fill('#stdin', '');
  await run(page);
  await expect(out(page)).toContainText('EOFError');
  await expect(out(page)).toContainText('поле «Ввод (stdin)»');
});

test('C: Hello compiles to WebAssembly and runs; a compile error points at its line', async ({ page }) => {
  test.setTimeout(300_000);
  await openPage(page);
  await pick(page, 'main.c');
  await engineReady(page, /^Clang \d+\.\d+\.\d+ готов$/, 240_000);
  await run(page, 120_000);
  await expect(out(page)).toContainText('Hello, World!');
  await expect(out(page)).toContainText(/─── компиляция \d+\.\d\d с, выполнение \d+\.\d\d с ───/);
  await setCode(page, '#include <stdio.h>\n\nint main(void) {\n    int x = ;\n    printf("%d\\n", x);\n    return 0;\n}\n');
  await run(page, 120_000);
  await expect(out(page)).toContainText('main.c:4:13: error: expected expression');
  await expect(out(page)).toContainText('─── ошибка компиляции ───');
  expect(await errorLines(page)).toEqual([4]);
  expect(await cursorLine(page)).toBe(4);
  // scanf reads the Input field; the exit code of main is shown
  await setCode(page, '#include <stdio.h>\nint main(void) {\n    int a, b;\n    if (scanf("%d %d", &a, &b) != 2) return 3;\n    printf("%d\\n", a * b);\n    return 0;\n}\n');
  await page.fill('#stdin', '6 7\n');
  await run(page, 120_000);
  await expect(out(page)).toContainText('42');
  await page.fill('#stdin', '');
  await run(page, 120_000);
  await expect(out(page)).toContainText('─── ошибка (код 3) ───');
  // an endless loop of a compiled program is stopped by the time limit as well
  await page.selectOption('#limitSel', '2');
  await setCode(page, '#include <stdio.h>\nint main(void) {\n    puts("spin");\n    for (;;) {}\n}\n');
  await run(page, 120_000);
  await expect(out(page)).toContainText('spin');
  await expect(out(page)).toContainText('─── время вышло (2 с)');
});

test('C++: iostream with cin and the standard library', async ({ page }) => {
  test.setTimeout(300_000);
  await openPage(page);
  await pick(page, 'main.cpp');
  await engineReady(page, /^Clang \d+\.\d+\.\d+ готов$/, 240_000);
  await setCode(page, '#include <iostream>\n#include <vector>\n#include <algorithm>\n#include <string>\n\nint main() {\n    std::string name;\n    std::vector<int> v;\n    std::cin >> name;\n    for (int x; std::cin >> x;) v.push_back(x);\n    std::sort(v.begin(), v.end());\n    std::cout << name << ":";\n    for (int x : v) std::cout << " " << x;\n    std::cout << std::endl;\n}\n');
  await page.fill('#stdin', 'Anna\n5 3 9 1\n');
  await run(page, 120_000);
  await expect(out(page)).toContainText('Anna: 1 3 5 9');
  await setCode(page, '#include <iostream>\nint main() {\n    std::cout << undefined_name << std::endl;\n}\n');
  await run(page, 120_000);
  await expect(out(page)).toContainText("main.cpp:3:18: error: use of undeclared identifier 'undefined_name'");
  expect(await errorLines(page)).toEqual([3]);
});

test('light languages: Lua, SQL and Ruby run with their errors on the line', async ({ page }) => {
  test.setTimeout(240_000);
  await openPage(page);
  await pick(page, 'main.lua');
  await setCode(page, 'local name = io.read()\nprint("Hi, " .. name)\nprint(nil + 1)\n');
  await page.fill('#stdin', 'Gleb\n');
  await run(page);
  await expect(out(page)).toContainText('Hi, Gleb');
  await expect(out(page)).toContainText('main.lua:3: attempt to perform arithmetic on a nil value');
  expect(await errorLines(page)).toEqual([3]);

  await pick(page, 'main.sql');
  await setCode(page, "CREATE TABLE t (x INTEGER);\nINSERT INTO t VALUES (2), (5);\nSELECT SUM(x) AS total FROM t;\nSELECT * FROM missing;\n");
  await run(page);
  await expect(out(page)).toContainText('| total |');
  await expect(out(page)).toContainText('|     7 |');
  await expect(out(page)).toContainText('main.sql:4: no such table: missing');
  expect(await errorLines(page)).toEqual([4]);

  await pick(page, 'main.rb');
  await engineReady(page, /^Ruby 3\.\d+\.\d+ готов$/, 120_000);
  await setCode(page, 'name = gets.chomp\nputs "Hi, #{name}"\nputs 1 / 0\n');
  await page.fill('#stdin', 'Ivan\n');
  await run(page);
  await expect(out(page)).toContainText('Hi, Ivan');
  await expect(out(page)).toContainText('main.rb:3');
  await expect(out(page)).toContainText('ZeroDivisionError');
  expect(await errorLines(page)).toEqual([3]);
});

test('examples: every language has Hello, loops, recursion and sorting', async ({ page }) => {
  await openPage(page);
  const ids = await page.evaluate(() => window.CompilerLangs.LANGS.map((l) => l.id));
  for (const id of ids) {
    for (const ex of ['hello', 'loops', 'recursion', 'sorting']) {
      expect(await page.evaluate(([l, e]) => !!window.CompilerLangs.example(l, e, 'ru'), [id, ex]), `${id}/${ex}`).toBe(true);
    }
  }
  // the menu opens an example as a new file with its input
  await page.selectOption('#exampleSel', 'sorting');
  await expect(page.locator('.tab.active')).toHaveAttribute('data-name', 'sorting.js');
  await run(page);
  await expect(out(page)).toContainText('1 2 3 5 7 8 9');
  await expect(out(page)).toContainText('9 8 7 5 3 2 1');
  await page.selectOption('#exampleSel', 'input');
  await expect(page.locator('#stdin')).toHaveValue(/Anna/);
  await run(page);
  await expect(out(page)).toContainText('Hello, Anna! 2 + 3 = 5');
  // the language list takes you to that language's file
  await page.selectOption('#langSel', 'lua');
  await expect(page.locator('.tab.active')).toHaveAttribute('data-name', 'main.lua');
});

test('files: edits, a new file, rename and delete with undo survive a reload', async ({ page }) => {
  await openPage(page);
  await setCode(page, 'console.log("saved text");\n');
  await page.locator('#newFile').click();
  const input = page.locator('#files .new-file input');
  await input.fill('notes.py');
  await input.press('Enter');
  await expect(page.locator('.tab.active')).toHaveAttribute('data-name', 'notes.py');
  await setCode(page, 'print("notes")\n');
  await page.fill('#stdin', 'line for notes\n');
  // rename main.lua -> game.lua
  const row = page.locator('#files .file[data-name="main.lua"]');
  await row.hover();
  await row.getByRole('button', { name: 'Переименовать' }).click();
  await page.locator('#files .file input').fill('game.lua');
  await page.locator('#files .file input').press('Enter');
  await expect(page.locator('#files .file[data-name="game.lua"]')).toHaveCount(1);
  // delete main.sql, undo; delete main.rb for good
  await page.locator('#files .file[data-name="main.sql"]').hover();
  await page.locator('#files .file[data-name="main.sql"]').getByRole('button', { name: 'Удалить' }).click();
  await expect(page.locator('#files .file[data-name="main.sql"]')).toHaveCount(0);
  await page.locator('#toastUndo').click();
  await expect(page.locator('#files .file[data-name="main.sql"]')).toHaveCount(1);
  await page.locator('#files .file[data-name="main.rb"]').hover();
  await page.locator('#files .file[data-name="main.rb"]').getByRole('button', { name: 'Удалить' }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('html[data-ready="1"]');
  await expect(page.locator('.tab.active')).toHaveAttribute('data-name', 'notes.py');
  expect(await page.evaluate(() => window.__compiler.cm.getValue())).toBe('print("notes")\n');
  await expect(page.locator('#stdin')).toHaveValue('line for notes\n');
  await expect(page.locator('#files .file[data-name="game.lua"]')).toHaveCount(1);
  await expect(page.locator('#files .file[data-name="main.lua"]')).toHaveCount(0);
  await expect(page.locator('#files .file[data-name="main.sql"]')).toHaveCount(1);
  await expect(page.locator('#files .file[data-name="main.rb"]')).toHaveCount(0);
  await pick(page, 'main.js');
  expect(await page.evaluate(() => window.__compiler.cm.getValue())).toBe('console.log("saved text");\n');
  // the page writes only its own keys
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.every((k) => k.startsWith('compiler.')), keys.join(', ')).toBe(true);
});

test('files: a double click with the real mouse renames, on the open file and on another one', async ({ page }) => {
  await openPage(page);
  // the first click opens the file and draws the list again: the second press must still rename
  for (const [from, to] of [['main.lua', 'game.lua'], ['game.lua', 'play.lua'], ['main.sql', 'base.sql']]) {
    const box = await page.locator(`#files .file[data-name="${from}"] .file-name`).boundingBox();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    const input = page.locator('#files .file input');
    await expect(input, `double click on ${from}`).toHaveCount(1);
    await expect(input).toBeFocused();
    await input.fill(to);
    await input.press('Enter');
    await expect(page.locator(`#files .file[data-name="${to}"]`)).toHaveCount(1);
    await expect(page.locator(`#files .file[data-name="${from}"]`)).toHaveCount(0);
  }
  // one click only opens the file, no rename field
  await page.locator('#files .file[data-name="main.js"] .file-name').click();
  await page.waitForTimeout(600);
  await expect(page.locator('#files .file input')).toHaveCount(0);
  await expect(page.locator('.tab.active')).toHaveAttribute('data-name', 'main.js');
});

test('files: a bad or taken name is refused with a reason', async ({ page }) => {
  await openPage(page);
  await page.locator('#newFile').click();
  const input = page.locator('#files .new-file input');
  await input.fill('main.c');
  await input.press('Enter');
  await expect(page.locator('#files .name-err')).toHaveText('Файл с таким именем уже есть');
  await input.fill('bad name?.c');
  await input.press('Enter');
  await expect(page.locator('#files .name-err')).toContainText('Имя файла');
  await input.press('Escape');
  await expect(page.locator('#files .new-file')).toHaveCount(0);
});

test('export downloads the current file, import adds files from disk', async ({ page }) => {
  await openPage(page);
  await setCode(page, 'console.log("export me");\n');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
  expect(download.suggestedFilename()).toBe('main.js');
  const fs = require('fs');
  expect(fs.readFileSync(await download.path(), 'utf8')).toBe('console.log("export me");\n');
  await page.locator('#fileInput').setInputFiles([{ name: 'from disk.py', mimeType: 'text/plain', buffer: Buffer.from('print(7 * 6)\n') }]);
  await expect(page.locator('.tab.active')).toHaveAttribute('data-name', 'from_disk.py');
  expect(await page.evaluate(() => window.__compiler.cm.getValue())).toBe('print(7 * 6)\n');
});

test('themes: the five Paint themes switch the colours and are remembered', async ({ page }) => {
  await openPage(page);
  const colors = {};
  for (const th of ['glass', 'formal', 'light', 'night', 'warm']) {
    await page.selectOption('#themeSel', th);
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(attr).toBe(th === 'glass' ? null : th);
    colors[th] = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.CodeMirror')).color].join(' '));
  }
  expect(new Set(Object.values(colors)).size).toBe(5);
  // the editor follows the theme: a dark editor in the dark themes (codemirror.css must not win)
  const editorRgb = () => page.evaluate(() => getComputedStyle(document.querySelector('.CodeMirror')).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number));
  for (const th of ['glass', 'formal', 'night', 'warm']) {
    await page.selectOption('#themeSel', th);
    expect(Math.max(...await editorRgb()), th).toBeLessThan(60);
  }
  await page.selectOption('#themeSel', 'light');
  expect(Math.min(...await editorRgb())).toBeGreaterThan(200);
  // Light: dark text on a light editor
  await page.selectOption('#themeSel', 'light');
  const lum = await page.evaluate(() => {
    const c = getComputedStyle(document.querySelector('.CodeMirror')).color.match(/\d+/g).map(Number);
    return (c[0] + c[1] + c[2]) / 3;
  });
  expect(lum).toBeLessThan(90);
  await page.reload();
  await page.waitForSelector('html[data-ready="1"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#themeSel')).toHaveValue('light');
});

test('interface language: Russian by default, English on the button, remembered', async ({ page }) => {
  await openPage(page);
  await expect(page.locator('#runBtn')).toContainText('Запустить');
  await page.locator('#uiLangBtn').click();
  await expect(page.locator('#runBtn')).toContainText('Run');
  await expect(page.locator('#stopBtn')).toContainText('Stop');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await run(page);
  await expect(out(page)).toContainText(/─── done in \d+\.\d\d s ───/);
  await page.reload();
  await page.waitForSelector('html[data-ready="1"]');
  await expect(page.locator('#runBtn')).toContainText('Run');
  await page.locator('#uiLangBtn').click();
  await expect(page.locator('#runBtn')).toContainText('Запустить');
});

test('autocompletion offers keywords and names of the file', async ({ page }) => {
  await openPage(page);
  await setCode(page, 'const counterValue = 1;\n');
  await page.evaluate(() => { const cm = window.__compiler.cm; cm.focus(); cm.setCursor({ line: 1, ch: 0 }); });
  await page.keyboard.type('cou');
  await expect(page.locator('.CodeMirror-hints')).toBeVisible();
  await expect(page.locator('.CodeMirror-hint', { hasText: 'counterValue' })).toHaveCount(1);
  // The list opens after 'co' and is rebuilt a frame after 'u'. Enter pressed between the old
  // list closing and the new one opening goes to the editor as a new line (CI runner: 'cou').
  // Wait until the list is the one for 'cou': 'const' is gone from it.
  await expect(page.locator('.CodeMirror-hint', { hasText: /^const$/ })).toHaveCount(0);
  await expect(page.locator('.CodeMirror-hint-active')).toHaveText('counterValue');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__compiler.cm.getLine(1))).toBe('counterValue');
});

test('phone width: no sideways scroll, Run and Stop are on the screen', async ({ page }) => {
  await openPage(page, { viewport: { width: 375, height: 760 } });
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
  for (const id of ['#runBtn', '#stopBtn', '#out', '#stdin']) {
    const b = await page.locator(id).boundingBox();
    expect(b, id).not.toBeNull();
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(375.5);
  }
  await page.locator('#sideToggle').click();
  await expect(page.locator('#files .file').first()).toBeInViewport();
  await page.locator('#files .file[data-name="main.js"]').click();     // choosing a file closes the list
  await expect(page.locator('#files .file').first()).not.toBeInViewport();
  await run(page);
  await expect(out(page)).toContainText('Hello, World!');
});

// 1.1.2 (independent review): in a narrow window the open file list covered the ☰ button and a click
// beside it did nothing - the only way out was to pick a file.
test('narrow window: the file list closes with a click beside it, with Esc and with ☰', async ({ page }) => {
  for (const [width, height] of [[420, 520], [760, 600]]) {
    await openPage(page, { viewport: { width, height } });
    const isOpen = () => page.evaluate(() => document.body.classList.contains('side-open'));
    await page.locator('#sideToggle').click();
    expect(await isOpen(), `${width}: opened`).toBe(true);
    await page.waitForTimeout(250);                                        // the slide takes .15 s
    // a click on the editor side of the window closes the list and does not run anything else
    await page.mouse.click(width - 30, Math.round(height / 2));
    await expect.poll(isOpen, `${width}: click beside`).toBe(false);
    await page.locator('#sideToggle').click();
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await expect.poll(isOpen, `${width}: Esc`).toBe(false);
    // ☰ stays reachable over the open list and closes it
    await page.locator('#sideToggle').click();
    await page.waitForTimeout(250);
    const t = await page.locator('#sideToggle').boundingBox();
    const top = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.closest('#sideToggle') ? 'toggle' : (e && (e.id || e.className)); }, [t.x + t.width / 2, t.y + t.height / 2]);
    expect(top, `${width}: ☰ is not under the list`).toBe('toggle');
    await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
    await expect.poll(isOpen, `${width}: ☰ closes`).toBe(false);
    // work inside the list does not close it: new file, its name field
    await page.locator('#sideToggle').click();
    await page.waitForTimeout(250);
    await page.locator('#newFile').click();
    await expect(page.locator('#files .new-file input')).toBeVisible();
    expect(await isOpen(), `${width}: + keeps the list`).toBe(true);
    await page.keyboard.press('Escape');                                   // Esc cancels the name first
    await expect(page.locator('#files .new-file input')).toHaveCount(0);
    expect(await isOpen(), `${width}: Esc in the name field keeps the list`).toBe(true);
  }
});

// 1.1.2 (independent review): the top bar had backdrop-filter with buttons inside. That is the cause of
// the light band across the panel on hover found in WritingSpeed 1.1.1 and MediaPlayer 1.0.2: on the
// graphics card Chromium recomputes the blur only in a band of the panel. Headless Chromium draws the
// whole frame and does not show the band, so the law is about the rule: no backdrop-filter on anything
// that holds a button, in every theme.
test('no backdrop-filter on panels with buttons, in all five themes; the bar keeps its glass look', async ({ page }) => {
  await openPage(page);
  for (const th of ['glass', 'formal', 'light', 'night', 'warm']) {
    await page.selectOption('#themeSel', th);
    const bad = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (!el.querySelector('button, select, input, textarea, a')) continue;
        for (const pseudo of [null, '::before', '::after']) {
          const bf = getComputedStyle(el, pseudo).backdropFilter;
          if (bf && bf !== 'none') out.push((el.id || el.className || el.tagName) + (pseudo || '') + ': ' + bf);
        }
      }
      return out;
    });
    expect(bad, th).toEqual([]);
    const look = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.topbar'), '::before'); return { att: s.backgroundAttachment, filter: s.filter }; });
    expect(look.att, th).toContain('fixed');
    expect(look.filter, th).toMatch(/^saturate\(/);
  }
});

// 1.1.2 (independent review): with many files the overlay scroll bar of the list (Chrome on Windows 11,
// macOS) is drawn over the right edge of the rows and covered the × (delete) button. The normal run has
// --hide-scrollbars, so this law starts its own Chromium with overlay and with classic scroll bars.
for (const mode of ['classic', 'overlay']) {
  test(`file list scroll bar (${mode}) keeps clear of the row buttons`, async ({ playwright }) => {
    const browser = await playwright.chromium.launch({
      ignoreDefaultArgs: ['--hide-scrollbars'],
      args: ['--allow-file-access-from-files', ...(mode === 'overlay' ? ['--enable-features=OverlayScrollbar,FluentOverlayScrollbar'] : [])],
    });
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        const files = {}, order = [];
        for (let i = 0; i < 40; i++) { const n = 'file' + i + '.py'; files[n] = 'print(' + i + ')'; order.push(n); }
        localStorage.setItem('compiler.v1', JSON.stringify({ files, order, tabs: ['file3.py'], active: 'file3.py', stdin: {} }));
      });
      await page.route(/^https?:\/\//, (route) => route.abort());
      for (const [width, height] of [[1280, 720], [1024, 600], [800, 600], [420, 520]]) {
        await page.setViewportSize({ width, height });
        await require('./helpers').lockFirst(page); await page.goto(URL_);
        await page.waitForSelector('html[data-ready="1"]');
        if (width <= 760) { await page.locator('#sideToggle').click(); await page.waitForTimeout(250); }
        const g = await page.evaluate(() => {
          const f = document.querySelector('#files'), r = f.getBoundingClientRect();
          const classic = f.offsetWidth - f.clientWidth;
          const btnRight = Math.max(...[...f.querySelectorAll('.file .icon-btn')].map((b) => b.getBoundingClientRect().right));
          return { scrolls: f.scrollHeight > f.clientHeight + 1, classic, right: r.right, btnRight };
        });
        expect(g.scrolls, `${width}x${height}: 40 files scroll`).toBe(true);
        if (mode === 'classic') expect(g.classic, 'classic bar takes room').toBeGreaterThan(0);
        // overlay: 0 px in the layout, drawn up to 14 px wide over the rows; plus a 4 px gap
        const bar = mode === 'classic' ? g.classic : 14;
        expect(g.btnRight + 4, `${width}x${height}: × right edge ${g.btnRight}, list right ${g.right}`).toBeLessThanOrEqual(g.right - bar);
      }
    } finally { await browser.close(); }
  });
}
// 1.1.3: the × of the last tab and of the last file did nothing and said nothing - now the tooltip
// says why, and a click shows the same words in the message at the bottom
test('files: the × of the last tab and of the last file say why they stay (tooltip and a message)', async ({ page }) => {
  const { errors } = await openPage(page);
  const tabs = page.locator('#tabs .tab');
  const files = page.locator('#files .file');
  // open a second file: both tabs close as usual and say so
  const names = await files.evaluateAll((rows) => rows.map((r) => r.dataset.name));
  expect(names.length).toBeGreaterThan(1);
  await pick(page, names.find((n) => n !== (names[0])));
  await pick(page, names[0]);
  expect(await tabs.count()).toBeGreaterThan(1);
  expect(await tabs.first().locator('.icon-btn').getAttribute('title')).toBe('Закрыть вкладку');
  while (await tabs.count() > 1) await tabs.last().locator('.icon-btn').click();
  // the last tab: the tooltip explains, a click leaves it and shows the message
  const x = tabs.first().locator('.icon-btn');
  const tip = await x.getAttribute('title');
  expect(tip).toMatch(/последн/i);
  expect(await x.getAttribute('aria-label')).toBe(tip);
  await x.click();
  expect(await tabs.count()).toBe(1);
  await expect(page.locator('#toast')).toHaveClass(/show/);
  await expect(page.locator('#toastText')).toHaveText(tip);
  await expect(page.locator('#toastUndo')).toBeHidden();
  // the middle button on the last tab says the same
  await page.locator('#toast').evaluate((el) => el.classList.remove('show'));
  await tabs.first().click({ button: 'middle' });
  await expect(page.locator('#toast')).toHaveClass(/show/);
  // files: delete all but one, then the last × explains and a click keeps the file
  while (await files.count() > 1) {
    const row = files.last();
    await row.hover();
    const del = row.getByRole('button', { name: 'Удалить' });
    await del.click();
  }
  const last = files.first();
  await last.hover();
  const del = last.locator('.icon-btn').last();
  const ftip = await del.getAttribute('title');
  expect(ftip).toMatch(/последн/i);
  await page.locator('#toast').evaluate((el) => el.classList.remove('show'));
  await del.click();
  expect(await files.count()).toBe(1);
  await expect(page.locator('#toast')).toHaveClass(/show/);
  await expect(page.locator('#toastText')).toHaveText(ftip);
  // Delete on the row says the same
  await page.locator('#toast').evaluate((el) => el.classList.remove('show'));
  await last.focus();
  await page.keyboard.press('Delete');
  expect(await files.count()).toBe(1);
  await expect(page.locator('#toastText')).toHaveText(ftip);
  // a new file: the old one can go again, with the usual words
  await page.locator('#newFile').click();
  await page.locator('#files .new-file input').fill('second.py');
  await page.locator('#files .new-file input').press('Enter');
  await files.first().hover();
  expect(await files.first().getByRole('button', { name: 'Удалить' }).getAttribute('title')).toBe('Удалить');
  expect(errors).toEqual([]);
});
