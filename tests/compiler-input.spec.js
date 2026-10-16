// Laws of input while the program runs (Compiler 1.1.0). The page is served by a small local
// server: with COOP/COEP headers it is cross-origin isolated, the program's worker sleeps in
// Atomics.wait and the person types a line right in the output (Enter sends it, Ctrl+D ends the
// input, Stop works while the program waits). Without the headers the service worker coi-sw.js
// makes the page isolated (GitHub Pages). From disk (file://) there is only the Input field: when
// the program wants more, a hint and the field flashes.
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const { pageUrl } = require('./helpers');

const DIR = process.env.COMPILER_DIR || path.dirname(fileURLToPath(pageUrl('compiler')));
const ROOT = path.dirname(DIR);              // the folder above the page: it is served as a whole
const SUB = path.basename(DIR);
const DONE = /─── (готово|ошибка|время вышло|остановлено|не запустилось)/;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png' };

test.describe.configure({ mode: 'serial', timeout: 120_000 });

let server, base;
let isolateHeaders = true;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(ROOT, u);
    if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (u.endsWith('/')) f = path.join(f, 'index.html');
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      const h = { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
      if (isolateHeaders) { h['Cross-Origin-Opener-Policy'] = 'same-origin'; h['Cross-Origin-Embedder-Policy'] = 'require-corp'; }
      res.writeHead(200, h);
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/${SUB}/`;
});
test.afterAll(() => new Promise((r) => server.close(r)));

async function openServed(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // only this computer: requests to other hosts are cut off
  await page.route((u) => !/^http:\/\/127\.0\.0\.1:/.test(u.href) && /^https?:/.test(u.href), (route) => route.abort());
  await require('./helpers').lockFirst(page); await page.goto(base);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 20_000 });
  return errors;
}
const out = (page) => page.locator('#out');
const setCode = (page, code) => page.evaluate((c) => window.__compiler.cm.setValue(c), code);
async function pick(page, name) {
  await page.locator(`#files .file[data-name="${name}"]`).click();
  await expect(page.locator('.tab.active')).toHaveAttribute('data-name', name);
}
async function typeLine(page, text) {
  const box = page.locator('#termIn');
  await expect(box).toBeVisible();
  await expect(box).toBeFocused();
  await box.pressSequentially(text);
  await box.press('Enter');
}

test('JavaScript: prompt() waits for a line typed in the output, Ctrl+D ends the input', async ({ page }) => {
  const errors = await openServed(page);
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
  await page.fill('#stdin', 'from field\n');
  await setCode(page, 'console.log("1: " + prompt());\nconsole.log("2: " + prompt("Name? "));\nconsole.log("3: " + prompt());\nconsole.log("end");\n');
  await page.locator('#runBtn').click();
  // the field line goes first, then the program waits: the question is on the screen already
  await expect(out(page)).toContainText('1: from field');
  await expect(out(page)).toContainText('Name? ');
  await expect(page.locator('#statusText')).toHaveText('Выполняется…');
  await typeLine(page, 'Вера');
  await expect(out(page)).toContainText('2: Вера');
  // the typed line stays in the output as input
  await expect(out(page).locator('.in', { hasText: 'Вера' })).toHaveCount(1);
  await expect(page.locator('#termIn')).toBeVisible();
  await page.locator('#termIn').press('Control+d');
  await expect(out(page)).toContainText('3: null');
  await expect(out(page)).toContainText(/─── готово за/);
  await expect(page.locator('#termIn')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('JavaScript: Stop works while the program waits; waiting does not use up the time limit', async ({ page }) => {
  await openServed(page);
  await page.selectOption('#limitSel', '2');
  await setCode(page, 'const a = prompt();\nconsole.log("got " + a);\nwhile (true) {}\n');
  await page.locator('#runBtn').click();
  await expect(page.locator('#termIn')).toBeVisible();
  await page.waitForTimeout(2600);          // longer than the 2 s limit: the program only waits
  await expect(out(page)).not.toContainText(DONE);
  await typeLine(page, 'x');
  await expect(out(page)).toContainText('got x');
  await expect(out(page)).toContainText('время вышло', { timeout: 10_000 });   // the loop is stopped by the limit
  // Stop while waiting
  await setCode(page, 'prompt();\nconsole.log("never");\n');
  await page.locator('#runBtn').click();
  await expect(page.locator('#termIn')).toBeVisible();
  await page.locator('#stopBtn').click();
  await expect(out(page)).toContainText('─── остановлено ───');
  await expect(out(page)).not.toContainText('never');
  await expect(page.locator('#termIn')).toHaveCount(0);
  await expect(page.locator('#runBtn')).toBeEnabled();
});

test('Lua: io.read waits for typed lines; io.read("a") reads up to Ctrl+D', async ({ page }) => {
  await openServed(page);
  await page.locator('#newFile').click();
  await page.locator('#files .new-file input').fill('main.lua');
  await page.locator('#files .new-file input').press('Enter');
  await pick(page, 'main.lua');
  await setCode(page, 'local n = io.read("n")\nprint("twice: " .. n * 2)\nlocal rest = io.read("a")\nprint("rest=[" .. rest .. "]")\n');
  await page.locator('#runBtn').click();
  await typeLine(page, '21');
  await expect(out(page)).toContainText('twice: 42');
  await typeLine(page, 'a');
  await typeLine(page, 'b');
  await page.locator('#termIn').press('Control+d');
  await expect(out(page)).toContainText('rest=[a\nb\n]');
  await expect(out(page)).toContainText(/─── готово за/);
});

test('Python: input() waits for a typed line', async ({ page }) => {
  test.setTimeout(180_000);
  await openServed(page);
  await pick(page, 'main.py');
  await expect(page.locator('#statusText')).toHaveText(/^Python 3\.\d+\.\d+ готов$/, { timeout: 120_000 });
  await page.fill('#stdin', '');
  await setCode(page, 'a = input("A? ")\nb = input("B? ")\nprint(f"{a}+{b}={int(a)+int(b)}")\ntry:\n    input()\nexcept EOFError:\n    print("eof")\n');
  await page.locator('#runBtn').click();
  await typeLine(page, '2');
  await expect(out(page)).toContainText('B? ');
  await typeLine(page, '40');
  await expect(out(page)).toContainText('2+40=42');
  await page.locator('#termIn').press('Control+d');
  await expect(out(page)).toContainText('eof');
  await expect(out(page)).toContainText(/─── готово за/);
});

test('C: scanf reads typed lines through WASI fd_read until Ctrl+D', async ({ page }) => {
  test.setTimeout(300_000);
  await openServed(page);
  await pick(page, 'main.c');
  await expect(page.locator('#statusText')).toHaveText(/^Clang \d+\.\d+\.\d+ готов$/, { timeout: 240_000 });
  await page.fill('#stdin', '');
  await setCode(page, '#include <stdio.h>\n\nint main(void) {\n    int x, sum = 0;\n    printf("numbers: ");\n    fflush(stdout);\n    while (scanf("%d", &x) == 1) sum += x;\n    printf("sum=%d\\n", sum);\n    return 0;\n}\n');
  await page.locator('#runBtn').click();
  await expect(out(page)).toContainText('numbers: ', { timeout: 120_000 });
  await typeLine(page, '1 2');
  await typeLine(page, '39');
  await page.locator('#termIn').press('Control+d');
  await expect(out(page)).toContainText('sum=42');
  await expect(out(page)).toContainText(/─── компиляция/);
});

test('C++: std::cin and std::getline read typed lines', async ({ page }) => {
  test.setTimeout(300_000);
  await openServed(page);
  await pick(page, 'main.cpp');
  await expect(page.locator('#statusText')).toHaveText(/^Clang \d+\.\d+\.\d+ готов$/, { timeout: 240_000 });
  await page.fill('#stdin', '');
  await setCode(page, '#include <iostream>\n#include <string>\n\nint main() {\n    int n;\n    std::cout << "n? " << std::flush;\n    std::cin >> n;\n    std::string rest, line;\n    std::getline(std::cin, rest);\n    std::getline(std::cin, line);\n    std::cout << n * 2 << " [" << line << "]" << std::endl;\n    return 0;\n}\n');
  await page.locator('#runBtn').click();
  await expect(out(page)).toContainText('n? ', { timeout: 120_000 });
  await typeLine(page, '21');
  await typeLine(page, 'привет мир');
  await expect(out(page)).toContainText('42 [привет мир]');
  await expect(out(page)).toContainText(/─── компиляция/);
});

test('Ruby: gets waits for typed lines, nil after Ctrl+D', async ({ page }) => {
  test.setTimeout(180_000);
  await openServed(page);
  await pick(page, 'main.rb');
  await expect(page.locator('#statusText')).toHaveText(/^Ruby 3\.\d+\.\d+ готов$/, { timeout: 120_000 });
  await page.fill('#stdin', '');
  await setCode(page, 'a = gets.to_i\nputs "twice: #{a * 2}"\nputs gets.nil? ? "eof" : "more"\n');
  await page.locator('#runBtn').click();
  await typeLine(page, '21');
  await expect(out(page)).toContainText('twice: 42');
  await expect(page.locator('#termIn')).toBeVisible();
  await page.locator('#termIn').press('Control+d');
  await expect(out(page)).toContainText('eof');
  await expect(out(page)).toContainText(/─── готово за/);
});

test('without headers the service worker makes the page isolated (GitHub Pages)', async ({ page }) => {
  isolateHeaders = false;
  try {
    await openServed(page);
    await expect.poll(() => page.evaluate(() => self.crossOriginIsolated), { timeout: 20_000 }).toBe(true);
    await page.waitForSelector('html[data-ready="1"]');
    await setCode(page, 'console.log("got " + prompt());\n');
    await page.locator('#runBtn').click();
    await typeLine(page, 'ok');
    await expect(out(page)).toContainText('got ok');
  } finally {
    isolateHeaders = true;
  }
});

test('from disk (file://): no input box, the program gets the field; past it a hint and the field flashes', async ({ page }) => {
  await page.route(/^https?:\/\//, (route) => route.abort());
  await require('./helpers').lockFirst(page); await page.goto(pathToFileURL(path.join(DIR, 'index.html')).href);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 20_000 });
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(false);
  await page.fill('#stdin', 'one\n');
  await setCode(page, 'console.log("1: " + prompt());\nconsole.log("2: " + prompt());\n');
  await page.locator('#runBtn').click();
  await expect(out(page)).toContainText(/─── готово за/);
  await expect(out(page)).toContainText('1: one');
  await expect(out(page)).toContainText('2: null');
  await expect(page.locator('#termIn')).toHaveCount(0);
  await expect(out(page).locator('.hint-line')).toContainText('поле «Ввод (stdin)»');
  await expect(page.locator('#stdin')).toHaveClass(/flash/);
});
