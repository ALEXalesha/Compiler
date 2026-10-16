# Compiler

**English** · [Русский](README.ru.md)

**Compiler** («Компилятор») runs programs in eight languages right in the browser: **C, C++, Python, JavaScript, TypeScript, Lua, Ruby and SQL**. There is no server: compilers and interpreters are WebAssembly and JavaScript inside the page, and it works offline - from the site or straight from disk (`index.html`).

**[▶ Open online](https://alexalesha.github.io/Compiler/)**

The interface is in Russian and English (the RU/EN button in the header).

![C++ compiled to WebAssembly and run](docs/screens/cpp.png)

![A compile error: the line is highlighted, the cursor goes there](docs/screens/c-error.png)

## Languages

| Language | Engine | How it runs | Download on first use |
|---|---|---|---|
| C | Clang 22 + LLD ([YoWASP](https://yowasp.org/)), wasi-libc | compiled to WebAssembly (C17, `-O2`), then run with a small WASI host | ~50 MB, shared with C++ |
| C++ | the same Clang, libc++ | C++20, `-O2`; `<iostream>` is precompiled, so a small program compiles in 1-5 s instead of 10-15 | (same) |
| Python | [Pyodide](https://pyodide.org/) 0.29.5 (Python 3.13) | interpreter in a worker; other `.py` files of the project can be imported | ~16 MB |
| JavaScript | the browser's own engine | the program is a worker script; `console.log`, `input()`, timers | nothing |
| TypeScript | [TypeScript](https://www.typescriptlang.org/) 5.9.3 | type check (strict), then JavaScript; type errors stop the run like a compiler | ~2 MB |
| Lua | [Fengari](https://fengari.io/) 0.1.4 (Lua 5.3) | interpreter in a worker; `print`, `io.read`, `io.write` | 0.1 MB |
| Ruby | [ruby.wasm](https://github.com/ruby/ruby.wasm) 2.10.1 (Ruby 3.4 with the standard library) | a fresh Ruby VM per run (a spare one is warmed up in advance) | ~12 MB |
| SQL | [sql.js](https://sql.js.org/) 1.14.2 (SQLite) | a new empty database per run; statements one by one, result tables in the output | 0.4 MB |

An engine is loaded when its language is first chosen (a tab with a file of that language), not when the page opens.

## What it can do

- **Editor** (CodeMirror 5): highlighting for every language, autocompletion (keywords and names from the file; Ctrl+Space or just typing), brackets, comment toggle (Ctrl+/).
- **Files and tabs**: a file list (new, rename, delete with undo) and tabs; the extension sets the language. Everything is saved in the browser (`localStorage`, keys `compiler.*`); the page keeps working if the storage is blocked. **Open** reads files from disk, **Download** saves the current file.
- **Running**: Run (Ctrl+Enter or F5) and Stop (Shift+F5). Every program runs in its own Web Worker, so an endless loop never freezes the page: the **time limit** (2, 5, 10, 30, 60 s or none) or the Stop button ends it.
- **Input while the program runs**: when the program waits for a line (`input()`, `cin`, `scanf`, `gets`, `io.read`, `prompt()`), an input box appears right in the output. Enter sends the line, Ctrl+D ends the input, Stop works while it waits, and waiting does not use up the time limit. Lines of the Input (stdin) field go first, so a test input can still be prepared in advance. The program worker sleeps in `Atomics.wait` on a `SharedArrayBuffer`; on the site the page is made cross-origin isolated by `coi-sw.js` (a small service worker, the idea of [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker), MIT): the first visit reloads the page once.
- **Errors**: compiler messages and runtime errors point at their line: the line is highlighted, a mark is put in the margin, the cursor jumps to the first error, and `file:line` in the output is a link.
- **Examples** for every language: Hello, loops, recursion, sorting, reading input.
- **Look**: five themes (Glass, Formal, Light, Night, Warm - the same as in Paint Pro), a layout for phones.

![Python in the light theme, English interface](docs/screens/python-light.png)

![On a phone](docs/screens/phone.png)

### Limits

- A page opened from disk (`file://`) cannot be cross-origin isolated: there the program reads only the Input field, and when it wants more, a hint appears and the field flashes. Served from a site or a local server, input in the output works.
- C/C++: no files, threads or sockets (WASI without a file system); C++ exceptions are off (`-fno-exceptions`: the WebAssembly build of libc++ has no exception support), `throw`/`try` give a compile error with a hint. `#include <bits/stdc++.h>` works. The stack is 8 MB.
- Python: the standard library only (no `pip`).
- Output over 2 MB stops the program.

## Run locally

- **Double click `index.html`** (Chrome, Edge, Firefox). Everything works from disk: the engines are ordinary `<script>` files (gzip + base64), nothing is fetched.
- Or serve the folder with any static server, e.g. `npx http-server .` or `python -m http.server`, and open `http://localhost:8080/`.

The engines are rebuilt from npm packages by `node vendor/make-packs.js` (versions are pinned in the script; it also builds the precompiled `<iostream>`). Python and the editor core live in `python_ide/` (shared with the Python IDE of the GameRoom collection; `paths.js` says where).

## Tests

```
npm install
npx playwright install chromium
npm test                  # 32 laws in headless Chromium, one at a time
node tests/mutate.js      # mutation check: 23 broken copies must fail the laws
```

The laws open `index.html` by its file address with the network closed: JS Hello and output; an endless loop is stopped by the time limit while the page stays responsive; Stop; JS/TS/Python/C/C++/Lua/SQL/Ruby errors highlighted on their line; Python `input()`; C Hello, a compile error with its line and number, `scanf`, the exit code, a time-limited endless loop of a compiled program; C++ with `cin` and the standard library; examples; files surviving a reload; input while the program runs (`tests/compiler-input.spec.js`, its own small server with and without the COOP/COEP headers): JS `prompt()`, Python `input()`, C `scanf`, C++ `cin`/`getline`, Lua `io.read`, Ruby `gets`, Ctrl+D, Stop while waiting, the time limit paused while waiting, the service worker isolating the page, and the hint from disk; export and import; themes (the editor follows the theme); RU/EN; autocompletion; phone width. The mutation check breaks the key rules one by one (time limit, Stop, line mapping of JS and TS, line highlighting, jumping to the error, parsing of compiler and Python messages, input, saving, themes, and input while the program runs: the live mode itself, the paused time limit, the typed line kept in the output, Ctrl+D, WASI reading for C, the hint from disk, the service worker headers) in a copy in a temporary folder and never touches the page. Mouse capture in the tests is a stub. The pictures above were made headless by `tools/screenshots.js`.

## History

The Compiler was made in the [GameRoom](https://github.com/ALEXalesha/GameRoom) collection (folder `web/compiler`), where it is a program in the "Programs" section of the Igroteka launcher ([open there](https://alexalesha.github.io/GameRoom/)). This repository carries it with its commit history.

## Licences

The page is MIT ([LICENSE](LICENSE)). Third-party parts, each with its licence text next to it:

| Part | Where | Licence |
|---|---|---|
| YoWASP Clang 22 (Clang, LLD), wasi-libc, libc++ | `vendor/clang/` | Apache-2.0 WITH LLVM-exception; wasi-libc: Apache-2.0 / MIT; YoWASP packaging: ISC |
| ruby.wasm 2.10.1 (CRuby 3.4) | `vendor/ruby/` | MIT; Ruby and bundled libraries: see NOTICE |
| TypeScript 5.9.3 | `vendor/typescript/` | Apache-2.0 |
| sql.js 1.14.2 (SQLite) | `vendor/sqljs/` | MIT; SQLite: public domain |
| Fengari 0.1.4 | `vendor/fengari/` | MIT |
| CodeMirror 5.65.21 | `python_ide/vendor/codemirror/`, `vendor/codemirror/` | MIT |
| Pyodide 0.29.5 (Python 3.13.2) | `python_ide/vendor/pyodide/` | MPL-2.0; Python standard library: PSF |
