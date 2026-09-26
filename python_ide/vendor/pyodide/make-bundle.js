// Пересборка офлайн-пакета Pyodide для web/python_ide.
// Запуск: node make-bundle.js <папка npm-пакета pyodide>   (npm pack pyodide@0.29.5 и распаковать)
// Страница открывается по file://, где fetch() и Worker из файла запрещены, поэтому всё нужное
// кладётся в обычные <script>-файлы: исходники загрузчика строками, wasm и stdlib - в base64.
const fs = require('fs');
const path = require('path');
const src = process.argv[2];
if (!src) { console.error('укажите папку пакета pyodide'); process.exit(1); }
const out = __dirname;
const read = (f) => fs.readFileSync(path.join(src, f));
const noMap = (s) => s.replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('pyodide-lock.json'));

fs.writeFileSync(path.join(out, 'pyodide-src.js'),
  '// Сгенерировано make-bundle.js из npm pyodide@' + pkg.version + '. Не править вручную.\n' +
  'window.PYODIDE_OFFLINE = ' + JSON.stringify({
    version: pkg.version,
    python: lock.info.python,
    loader: noMap(read('pyodide.js').toString('utf8')),
    asm: noMap(read('pyodide.asm.js').toString('utf8')),
    lock: JSON.stringify(lock),
  }) + ';\n');
fs.writeFileSync(path.join(out, 'pyodide-wasm.js'),
  '// pyodide.asm.wasm ' + pkg.version + ' в base64. Сгенерировано make-bundle.js.\n' +
  'window.PYODIDE_OFFLINE_WASM = "' + read('pyodide.asm.wasm').toString('base64') + '";\n');
fs.writeFileSync(path.join(out, 'pyodide-stdlib.js'),
  '// python_stdlib.zip ' + pkg.version + ' в base64. Сгенерировано make-bundle.js.\n' +
  'window.PYODIDE_OFFLINE_STDLIB = "' + read('python_stdlib.zip').toString('base64') + '";\n');
console.log('pyodide', pkg.version, 'python', lock.info.python);
for (const f of ['pyodide-src.js', 'pyodide-wasm.js', 'pyodide-stdlib.js']) {
  console.log(f, (fs.statSync(path.join(out, f)).size / 1048576).toFixed(2), 'МБ');
}
