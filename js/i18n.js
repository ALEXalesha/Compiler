// Interface texts in Russian and English. Elements carry data-i18n (text), data-i18n-title,
// data-i18n-placeholder and data-i18n-aria; t(key, vars) is for texts built in code.
(function (root) {
'use strict';

const DICT = {
  ru: {
    appName: 'Компилятор',
    files: 'Файлы',
    newFile: 'Новый файл',
    language: 'Язык',
    examples: 'Примеры',
    examplesPick: 'Пример…',
    ex_hello: 'Привет, мир',
    ex_loops: 'Циклы',
    ex_recursion: 'Рекурсия',
    ex_sorting: 'Сортировка',
    ex_input: 'Ввод данных',
    run: 'Запустить',
    runTitle: 'Запустить (Ctrl+Enter или F5)',
    stop: 'Стоп',
    stopTitle: 'Остановить (Shift+F5)',
    timeLimit: 'Предел времени',
    noLimit: 'без предела',
    seconds: '{n} с',
    theme: 'Тема',
    th_glass: 'Стеклянная', th_formal: 'Строгая', th_light: 'Светлая', th_night: 'Ночная', th_warm: 'Тёплая',
    uiLang: 'Язык интерфейса',
    import: 'Открыть',
    importTitle: 'Открыть файлы с диска',
    export: 'Скачать',
    exportTitle: 'Скачать текущий файл',
    output: 'Вывод',
    clear: 'очистить',
    input: 'Ввод (stdin)',
    inputPlaceholder: 'Строки для input(), cin, scanf, gets… - по строке на чтение',
    rename: 'Переименовать',
    delete: 'Удалить',
    closeTab: 'Закрыть вкладку',
    restoreExamples: 'вернуть примеры',
    storageNote: 'Файлы сохраняются в этом браузере.',
    hint: 'Ctrl+Enter - запуск · Ctrl+Space - подсказка · Ctrl+/ - комментарий',
    fileExists: 'Файл с таким именем уже есть',
    badName: 'Имя файла: буквы, цифры, точка, «-» и «_»; расширение задаёт язык (.cpp .c .py .js .ts .lua .rb .sql)',
    unknownLang: 'Этот файл не запускается: расширение не связано с языком',
    deleted: 'Файл «{name}» удалён',
    undo: 'Вернуть',
    saveFailed: 'Не удалось сохранить: хранилище браузера заполнено или запрещено',
    imported: 'Открыто файлов: {n}',
    tooBig: 'Файл «{name}» больше 1 МБ - пропущен',
    st_idle: '{lang}: загрузится при запуске',
    st_loading: 'Загружаю {lang}…',
    st_ready: '{version} готов',
    st_failed: '{lang}: не загрузился - {message}',
    st_running: 'Выполняется…',
    st_compiling: 'Компилирую…',
    runStart: '─── {file} ───',
    doneOk: '─── готово за {s} с ───',
    doneOkCompile: '─── компиляция {c} с, выполнение {s} с ───',
    doneErr: '─── ошибка (код {code}) ───',
    doneCompileErr: '─── ошибка компиляции ───',
    doneTimeout: '─── время вышло ({s} с): программа остановлена ───',
    doneStopped: '─── остановлено ───',
    doneOutput: '─── слишком много вывода (больше 2 МБ): программа остановлена ───',
    doneFailed: '─── не запустилось: {message} ───',
    trap: 'Ошибка выполнения: {message}',
    stdinHint: 'Подсказка: программа читает больше строк, чем есть в поле «Ввод (stdin)» справа.',
    noExceptions: 'Подсказка: исключения C++ (throw/try) здесь выключены (-fno-exceptions): в сборке Clang для WebAssembly нет их поддержки.',
    loadingBig: 'Загружаю {lang} ({mb} МБ), первый раз это занимает время…',
    sqlRows: '({n} {n|строка|строки|строк})',
    sqlChanged: '{what}: изменено строк - {n}',
    jumpTo: 'перейти к строке {line}',
    lineCol: 'Стр {line}, стлб {col}',
  },
  en: {
    appName: 'Compiler',
    files: 'Files',
    newFile: 'New file',
    language: 'Language',
    examples: 'Examples',
    examplesPick: 'Example…',
    ex_hello: 'Hello, world',
    ex_loops: 'Loops',
    ex_recursion: 'Recursion',
    ex_sorting: 'Sorting',
    ex_input: 'Reading input',
    run: 'Run',
    runTitle: 'Run (Ctrl+Enter or F5)',
    stop: 'Stop',
    stopTitle: 'Stop (Shift+F5)',
    timeLimit: 'Time limit',
    noLimit: 'no limit',
    seconds: '{n} s',
    theme: 'Theme',
    th_glass: 'Glass', th_formal: 'Formal', th_light: 'Light', th_night: 'Night', th_warm: 'Warm',
    uiLang: 'Interface language',
    import: 'Open',
    importTitle: 'Open files from disk',
    export: 'Download',
    exportTitle: 'Download the current file',
    output: 'Output',
    clear: 'clear',
    input: 'Input (stdin)',
    inputPlaceholder: 'Lines for input(), cin, scanf, gets… - one line per read',
    rename: 'Rename',
    delete: 'Delete',
    closeTab: 'Close tab',
    restoreExamples: 'restore examples',
    storageNote: 'Files are saved in this browser.',
    hint: 'Ctrl+Enter - run · Ctrl+Space - suggestions · Ctrl+/ - comment',
    fileExists: 'A file with this name already exists',
    badName: 'File name: letters, digits, dot, "-" and "_"; the extension sets the language (.cpp .c .py .js .ts .lua .rb .sql)',
    unknownLang: 'This file cannot run: its extension is not a language',
    deleted: 'File "{name}" deleted',
    undo: 'Undo',
    saveFailed: 'Could not save: the browser storage is full or not allowed',
    imported: 'Files opened: {n}',
    tooBig: 'File "{name}" is larger than 1 MB - skipped',
    st_idle: '{lang}: loads on first run',
    st_loading: 'Loading {lang}…',
    st_ready: '{version} ready',
    st_failed: '{lang}: failed to load - {message}',
    st_running: 'Running…',
    st_compiling: 'Compiling…',
    runStart: '─── {file} ───',
    doneOk: '─── done in {s} s ───',
    doneOkCompile: '─── compiled in {c} s, ran in {s} s ───',
    doneErr: '─── error (exit code {code}) ───',
    doneCompileErr: '─── compilation failed ───',
    doneTimeout: '─── time is up ({s} s): the program was stopped ───',
    doneStopped: '─── stopped ───',
    doneOutput: '─── too much output (over 2 MB): the program was stopped ───',
    doneFailed: '─── could not start: {message} ───',
    trap: 'Runtime error: {message}',
    stdinHint: 'Hint: the program reads more lines than there are in the Input (stdin) field on the right.',
    noExceptions: 'Hint: C++ exceptions (throw/try) are off here (-fno-exceptions): the Clang build for WebAssembly does not support them.',
    loadingBig: 'Loading {lang} ({mb} MB), the first time takes a while…',
    sqlRows: '({n} {n|row|rows})',
    sqlChanged: '{what}: rows changed - {n}',
    jumpTo: 'go to line {line}',
    lineCol: 'Ln {line}, Col {col}',
  },
};

let lang = 'ru';
function t(key, vars) {
  const s = (DICT[lang] && DICT[lang][key]) || DICT.en[key] || key;
  if (!vars) return s;
  // {n|one|few|many}: the word form for the number (Russian has three, English two)
  return s.replace(/\{(\w+)\|([^}]*)\}/g, (m, k, forms) => plural(Number(vars[k]), forms.split('|')))
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
function plural(n, f) {
  if (lang !== 'ru') return n === 1 ? f[0] : f[f.length - 1];
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return f[2];
  if (b === 1) return f[0];
  if (b >= 2 && b <= 4) return f[1];
  return f[2];
}
function setLang(l) { lang = DICT[l] ? l : 'ru'; }
function getLang() { return lang; }
function apply(rootEl) {
  const el = rootEl || document;
  for (const n of el.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of el.querySelectorAll('[data-i18n-title]')) n.title = t(n.dataset.i18nTitle);
  for (const n of el.querySelectorAll('[data-i18n-placeholder]')) n.placeholder = t(n.dataset.i18nPlaceholder);
  for (const n of el.querySelectorAll('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
  document.documentElement.lang = lang;
}

root.CompilerI18n = { t, setLang, getLang, apply, DICT };
})(typeof self !== 'undefined' ? self : this);
