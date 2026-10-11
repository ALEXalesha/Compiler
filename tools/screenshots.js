// Pictures for the README (docs/screens/*.png), made in headless Chromium - no window opens.
//   node tools/screenshots.js
// COMPILER_PAGE=<path to index.html> takes another copy of the page (the GameRoom collection).
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');
const PAGE = process.env.COMPILER_PAGE || path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'docs', 'screens');
const DONE = /─── (готово|компиляция|ошибка|done|compiled|error)/;

const CPP = `#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    std::vector<int> v = {5, 3, 9, 1, 7, 2, 8};
    std::sort(v.begin(), v.end());
    std::cout << "sorted:";
    for (int x : v) std::cout << ' ' << x;
    std::cout << "\\nsum = " << [&] { int s = 0; for (int x : v) s += x; return s; }() << std::endl;
}
`;
const C_ERR = `#include <stdio.h>

int square(int x) {
    return x * x
}

int main(void) {
    printf("%d\\n", square(7));
    return 0;
}
`;
const PY = `name = input("Name: ")
nums = list(map(int, input("Numbers: ").split()))
print(f"Hello, {name}! Sum = {sum(nums)}, max = {max(nums)}")
`;

async function shot(browser, file, { theme = 'glass', ui = 'ru', width = 1280, height = 800, lang, code, stdin = '', run = true }) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(([t, u]) => {
    Element.prototype.requestPointerLock = function () {};
    try { localStorage.setItem('compiler.theme', t); localStorage.setItem('compiler.ui', u); } catch (e) { /* no storage */ }
  }, [theme, ui]);
  await page.route(/^https?:\/\//, (r) => r.abort());
  await page.goto(pathToFileURL(PAGE).href);
  await page.waitForSelector('html[data-ready="1"]');
  // on a phone the file list slides in from the side: open it first
  if (lang && width < 600) await page.locator('#sideToggle').click();
  if (lang) await page.locator(`#files .file[data-name="${lang}"]`).click();
  if (code) await page.evaluate((c) => window.__compiler.cm.setValue(c), code);
  await page.fill('#stdin', stdin);
  if (run) {
    await page.waitForFunction(() => /готов|ready/.test(document.getElementById('statusText').textContent), null, { timeout: 240000 });
    await page.locator('#runBtn').click();
    await page.waitForFunction((re) => new RegExp(re).test(document.getElementById('out').textContent), DONE.source, { timeout: 240000 });
  }
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, file) });
  await page.close();
  console.log(path.join('docs', 'screens', file));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  await shot(browser, 'cpp.png', { lang: 'main.cpp', code: CPP });
  await shot(browser, 'c-error.png', { lang: 'main.c', code: C_ERR, theme: 'formal' });
  await shot(browser, 'python-light.png', { lang: 'main.py', code: PY, stdin: 'Vera\n3 14 15 92\n', theme: 'light', ui: 'en' });
  await shot(browser, 'phone.png', { lang: 'main.js', width: 390, height: 780, theme: 'warm' });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
