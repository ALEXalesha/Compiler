# Changelog / Журнал изменений

## 1.1.0 - 2026-10-11

**EN**

- Input while the program runs: when the program waits for a line, an input box appears right in the output. Enter sends the line (it stays in the output as typed input), Ctrl+D ends the input, Stop works while the program waits, and waiting does not use up the time limit. JavaScript and TypeScript (`prompt()`, `input()`), Python (`input()`), C and C++ (`scanf`, `cin`, `getline` through WASI `fd_read`), Lua (`io.read`) and Ruby (`gets`). Lines of the Input (stdin) field still go first.
- The program worker sleeps in `Atomics.wait` on a `SharedArrayBuffer`. On the site the page is made cross-origin isolated by `coi-sw.js` (a small service worker after the idea of coi-serviceworker, MIT); the first visit reloads the page once.
- A page opened from disk keeps only the Input field: when the program wants more, a hint appears and the field flashes.
- 9 new laws (`tests/compiler-input.spec.js`, 27 in all) and 7 new mutants (18 in all, all killed).

**RU**

- Ввод по ходу программы: когда программа ждёт строку, поле ввода появляется прямо в выводе. Enter отправляет строку (она остаётся в выводе как набранный ввод), Ctrl+D - конец ввода, «Стоп» работает во время ожидания, а ожидание не тратит предел времени. JavaScript и TypeScript (`prompt()`, `input()`), Python (`input()`), C и C++ (`scanf`, `cin`, `getline` через WASI `fd_read`), Lua (`io.read`) и Ruby (`gets`). Строки поля «Ввод (stdin)» по-прежнему идут первыми.
- Поток программы спит в `Atomics.wait` на `SharedArrayBuffer`. На сайте изоляцию страницы даёт `coi-sw.js` (маленький service worker по мысли coi-serviceworker, MIT); при первом заходе страница один раз перезагружается.
- У страницы, открытой с диска, только поле «Ввод»: когда программе нужно больше, появляется подсказка и поле мигает.
- 9 новых законов (`tests/compiler-input.spec.js`, всего 27) и 7 новых мутантов (всего 18, все убиты).

## 1.0.0 - 2026-10-11

**EN**

First release.

- Eight languages in the browser, offline and without a server: C and C++ (Clang 22 + LLD compiled to WebAssembly, wasi-libc, libc++; C17 / C++20, `-O2`), Python 3.13 (Pyodide 0.29.5), JavaScript, TypeScript 5.9.3 (strict type check before the run), Lua 5.3 (Fengari), Ruby 3.4 (ruby.wasm) and SQL (SQLite via sql.js).
- Every program runs in its own Web Worker: time limit (2-60 s or none), Stop, output up to 2 MB, run and compile time.
- Input from the Input (stdin) field for `input()`, `cin`, `scanf`, `gets`, `io.read`, `readline()`.
- Compile and runtime errors on their line: highlight, margin mark, the cursor jumps there, `file:line` links in the output; TypeScript errors are mapped back through the source map.
- C++: precompiled `<iostream>` (a small program compiles in 1-5 s instead of 10-15), `<bits/stdc++.h>`, 8 MB stack; exceptions are off.
- Editor: highlighting, autocompletion, files and tabs saved in the browser, open from disk and download, examples for every language (Hello, loops, recursion, sorting, input).
- Five Paint Pro themes, Russian and English interface, phone layout.
- Engines are loaded when their language is first used and work from disk (`file://`): gzip + base64 packs built by `vendor/make-packs.js`.
- 18 Playwright laws and 11 mutants (all killed).

**RU**

Первый выпуск.

- Восемь языков в браузере, без интернета и без сервера: C и C++ (Clang 22 + LLD, собранные в WebAssembly, wasi-libc, libc++; C17 / C++20, `-O2`), Python 3.13 (Pyodide 0.29.5), JavaScript, TypeScript 5.9.3 (строгая проверка типов перед запуском), Lua 5.3 (Fengari), Ruby 3.4 (ruby.wasm) и SQL (SQLite через sql.js).
- Каждая программа - в своём Web Worker: предел времени (2-60 с или без предела), «Стоп», вывод до 2 МБ, время компиляции и выполнения.
- Ввод из поля «Ввод (stdin)» для `input()`, `cin`, `scanf`, `gets`, `io.read`, `readline()`.
- Ошибки компиляции и выполнения на своей строке: подсветка, знак на полях, курсор переходит туда, ссылки `файл:строка` в выводе; ошибки TypeScript переводятся обратно по карте исходника.
- C++: готовый `<iostream>` (небольшая программа собирается за 1-5 с вместо 10-15), `<bits/stdc++.h>`, стек 8 МБ; исключения выключены.
- Редактор: подсветка, подсказки, файлы и вкладки сохраняются в браузере, открыть с диска и скачать, примеры для каждого языка (привет, циклы, рекурсия, сортировка, ввод).
- Пять тем Paint Pro, интерфейс на русском и английском, вид для телефона.
- Движки грузятся при первом выборе языка и работают с диска (`file://`): пакеты gzip + base64, их собирает `vendor/make-packs.js`.
- 18 законов Playwright и 11 мутантов (все убиты).
