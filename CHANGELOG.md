# Changelog / Журнал изменений

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
