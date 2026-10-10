// Languages of the compiler: file extensions, editor mode, runner, words for autocompletion and
// examples. The first line of every example is "%%" - the page puts a comment there with the
// example's title in the interface language (comment syntax from `comment`).
(function (root) {
'use strict';

const LANGS = [
  {
    id: 'cpp', name: 'C++', exts: ['cpp', 'cc', 'cxx', 'hpp', 'hh'], mode: 'text/x-c++src', comment: '//', runner: 'clang',
    words: 'alignas alignof auto bool break case catch char class const constexpr const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator private protected public return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile while include define std cout cin cerr endl string vector map set unordered_map unordered_set pair make_pair array deque queue stack priority_queue sort reverse min max swap abs size push_back pop_back emplace_back begin end insert erase find count iostream algorithm numeric accumulate getline printf scanf main',
  },
  {
    id: 'c', name: 'C', exts: ['c', 'h'], mode: 'text/x-csrc', comment: '//', runner: 'clang',
    words: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL include define printf scanf puts putchar getchar fgets malloc calloc realloc free memset memcpy strlen strcpy strcmp strcat qsort abs sqrt pow stdio stdlib string math main EOF stdin stdout stderr fprintf sprintf snprintf',
  },
  {
    id: 'python', name: 'Python', exts: ['py'], mode: 'python', comment: '#', runner: 'python',
    words: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield print input range len int str float list dict set tuple bool enumerate zip map filter sorted sum min max abs round open isinstance super self append extend items keys values split join strip format math random',
  },
  {
    id: 'js', name: 'JavaScript', exts: ['js', 'mjs'], mode: 'javascript', comment: '//', runner: 'js',
    words: 'await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof undefined var void while with yield async console log error warn input prompt readline Math Number String Array Object JSON Map Set Promise length push pop shift unshift slice splice map filter reduce forEach sort join split includes indexOf toFixed parseInt parseFloat setTimeout setInterval clearTimeout clearInterval',
  },
  {
    id: 'ts', name: 'TypeScript', exts: ['ts'], mode: 'text/typescript', comment: '//', runner: 'ts',
    words: 'abstract any as await boolean break case catch class const constructor continue declare default do else enum export extends false finally for function if implements import in interface instanceof keyof let module namespace never new null number private protected public readonly return string super switch this throw true try type typeof undefined unknown var void while console log input prompt readline Math Array Record Partial Readonly Map Set Promise length push pop map filter reduce forEach sort join split',
  },
  {
    id: 'lua', name: 'Lua', exts: ['lua'], mode: 'lua', comment: '--', runner: 'lua',
    words: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while print io read write lines string format sub len upper lower rep table insert remove concat sort unpack math floor ceil max min random sqrt pairs ipairs tostring tonumber type error pcall select',
  },
  {
    id: 'ruby', name: 'Ruby', exts: ['rb'], mode: 'ruby', comment: '#', runner: 'ruby',
    words: 'BEGIN END alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield puts print p gets chomp to_i to_s to_f each each_with_index map select reject reduce sort sort_by reverse length size push pop include? times upto downto step attr_accessor require format join split',
  },
  {
    id: 'sql', name: 'SQL', exts: ['sql'], mode: 'text/x-sqlite', comment: '--', runner: 'sql',
    words: 'SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE DROP ALTER ADD COLUMN PRIMARY KEY FOREIGN REFERENCES INTEGER TEXT REAL BLOB NULL NOT UNIQUE DEFAULT AUTOINCREMENT AND OR IN LIKE BETWEEN IS ORDER BY GROUP HAVING LIMIT OFFSET AS JOIN LEFT INNER ON DISTINCT COUNT SUM AVG MIN MAX CASE WHEN THEN ELSE END WITH RECURSIVE UNION ALL INDEX VIEW',
  },
];

// Examples per language: hello, loops, recursion, sorting, input. `stdin` - what goes into the
// input field with the example.
const T = {
  hello: { ru: 'Привет, мир', en: 'Hello, world' },
  loops: { ru: 'Циклы: таблица умножения и сумма', en: 'Loops: a multiplication table and a sum' },
  recursion: { ru: 'Рекурсия: факториал и числа Фибоначчи', en: 'Recursion: factorial and Fibonacci numbers' },
  sorting: { ru: 'Сортировка: пузырьком и встроенная', en: 'Sorting: bubble sort and the built-in one' },
  input: { ru: 'Ввод: строки берутся из поля «Ввод» справа от вывода', en: 'Input: lines come from the Input field next to the output' },
};

const EX = {
  cpp: {
    hello: `%%
#include <iostream>

int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}
`,
    loops: `%%
#include <iostream>

int main() {
    for (int i = 1; i <= 5; i++) {
        for (int j = 1; j <= 5; j++) std::cout << i * j << "\\t";
        std::cout << "\\n";
    }
    int sum = 0, n = 0;
    while (n < 100) sum += ++n;
    std::cout << "1 + 2 + ... + 100 = " << sum << "\\n";
}
`,
    recursion: `%%
#include <iostream>

long long factorial(int n) { return n <= 1 ? 1 : n * factorial(n - 1); }
long long fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

int main() {
    for (int i = 0; i <= 10; i++)
        std::cout << i << "! = " << factorial(i) << ", fib(" << i << ") = " << fib(i) << "\\n";
}
`,
    sorting: `%%
#include <algorithm>
#include <iostream>
#include <vector>

void bubbleSort(std::vector<int>& a) {
    for (size_t i = 0; i + 1 < a.size(); i++)
        for (size_t j = 0; j + 1 < a.size() - i; j++)
            if (a[j] > a[j + 1]) std::swap(a[j], a[j + 1]);
}

int main() {
    std::vector<int> a = {5, 3, 9, 1, 7, 2, 8};
    std::vector<int> b = a;
    bubbleSort(a);
    std::sort(b.begin(), b.end(), std::greater<int>());
    for (int x : a) std::cout << x << ' ';
    std::cout << "\\n";
    for (int x : b) std::cout << x << ' ';
    std::cout << "\\n";
}
`,
    input: `%%
#include <iostream>
#include <string>

int main() {
    std::string name;
    int a, b;
    std::getline(std::cin, name);
    std::cin >> a >> b;
    std::cout << "Hello, " << name << "! " << a << " + " << b << " = " << a + b << std::endl;
}
`,
  },
  c: {
    hello: `%%
#include <stdio.h>

int main(void) {
    printf("Hello, World!\\n");
    return 0;
}
`,
    loops: `%%
#include <stdio.h>

int main(void) {
    for (int i = 1; i <= 5; i++) {
        for (int j = 1; j <= 5; j++) printf("%d\\t", i * j);
        printf("\\n");
    }
    int sum = 0, n = 0;
    while (n < 100) sum += ++n;
    printf("1 + 2 + ... + 100 = %d\\n", sum);
    return 0;
}
`,
    recursion: `%%
#include <stdio.h>

long long factorial(int n) { return n <= 1 ? 1 : n * factorial(n - 1); }
long long fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

int main(void) {
    for (int i = 0; i <= 10; i++)
        printf("%d! = %lld, fib(%d) = %lld\\n", i, factorial(i), i, fib(i));
    return 0;
}
`,
    sorting: `%%
#include <stdio.h>
#include <stdlib.h>

static int desc(const void *x, const void *y) { return *(const int *)y - *(const int *)x; }

int main(void) {
    int a[] = {5, 3, 9, 1, 7, 2, 8};
    int n = sizeof a / sizeof a[0];
    for (int i = 0; i < n - 1; i++)
        for (int j = 0; j < n - 1 - i; j++)
            if (a[j] > a[j + 1]) { int t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; }
    for (int i = 0; i < n; i++) printf("%d ", a[i]);
    printf("\\n");
    qsort(a, n, sizeof a[0], desc);
    for (int i = 0; i < n; i++) printf("%d ", a[i]);
    printf("\\n");
    return 0;
}
`,
    input: `%%
#include <stdio.h>

int main(void) {
    char name[100];
    int a, b;
    if (scanf("%99s %d %d", name, &a, &b) != 3) {
        printf("Need: a name and two numbers\\n");
        return 1;
    }
    printf("Hello, %s! %d + %d = %d\\n", name, a, b, a + b);
    return 0;
}
`,
  },
  python: {
    hello: `%%
print("Hello, World!")
`,
    loops: `%%
for i in range(1, 6):
    print("\\t".join(str(i * j) for j in range(1, 6)))

total, n = 0, 0
while n < 100:
    n += 1
    total += n
print("1 + 2 + ... + 100 =", total)
`,
    recursion: `%%
def factorial(n):
    return 1 if n <= 1 else n * factorial(n - 1)

def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)

for i in range(11):
    print(f"{i}! = {factorial(i)}, fib({i}) = {fib(i)}")
`,
    sorting: `%%
def bubble_sort(a):
    a = list(a)
    for i in range(len(a) - 1):
        for j in range(len(a) - 1 - i):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]
    return a

data = [5, 3, 9, 1, 7, 2, 8]
print(*bubble_sort(data))
print(*sorted(data, reverse=True))
`,
    input: `%%
name = input("Name: ")
a, b = map(int, input("Two numbers: ").split())
print(f"Hello, {name}! {a} + {b} = {a + b}")
`,
  },
  js: {
    hello: `%%
console.log("Hello, World!");
`,
    loops: `%%
for (let i = 1; i <= 5; i++) {
  const row = [];
  for (let j = 1; j <= 5; j++) row.push(i * j);
  console.log(row.join("\\t"));
}
let sum = 0, n = 0;
while (n < 100) sum += ++n;
console.log("1 + 2 + ... + 100 =", sum);
`,
    recursion: `%%
function factorial(n) { return n <= 1 ? 1 : n * factorial(n - 1); }
function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

for (let i = 0; i <= 10; i++) {
  console.log(\`\${i}! = \${factorial(i)}, fib(\${i}) = \${fib(i)}\`);
}
`,
    sorting: `%%
function bubbleSort(arr) {
  const a = [...arr];
  for (let i = 0; i < a.length - 1; i++)
    for (let j = 0; j < a.length - 1 - i; j++)
      if (a[j] > a[j + 1]) [a[j], a[j + 1]] = [a[j + 1], a[j]];
  return a;
}

const data = [5, 3, 9, 1, 7, 2, 8];
console.log(bubbleSort(data).join(" "));
console.log([...data].sort((x, y) => y - x).join(" "));
`,
    input: `%%
// input() and prompt() return the next line or null
const name = input("Name: ");
const [a, b] = input("Two numbers: ").split(" ").map(Number);
console.log(\`Hello, \${name}! \${a} + \${b} = \${a + b}\`);
`,
  },
  ts: {
    hello: `%%
const greeting: string = "Hello, World!";
console.log(greeting);
`,
    loops: `%%
for (let i = 1; i <= 5; i++) {
  const row: number[] = [];
  for (let j = 1; j <= 5; j++) row.push(i * j);
  console.log(row.join("\\t"));
}
let sum: number = 0;
for (let n = 1; n <= 100; n++) sum += n;
console.log("1 + 2 + ... + 100 =", sum);
`,
    recursion: `%%
function factorial(n: number): number { return n <= 1 ? 1 : n * factorial(n - 1); }
function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

for (let i = 0; i <= 10; i++) {
  console.log(\`\${i}! = \${factorial(i)}, fib(\${i}) = \${fib(i)}\`);
}
`,
    sorting: `%%
interface Person { name: string; age: number; }

function bubbleSort<T>(arr: T[], less: (x: T, y: T) => boolean): T[] {
  const a = [...arr];
  for (let i = 0; i < a.length - 1; i++)
    for (let j = 0; j < a.length - 1 - i; j++)
      if (less(a[j + 1], a[j])) [a[j], a[j + 1]] = [a[j + 1], a[j]];
  return a;
}

const people: Person[] = [{ name: "Vera", age: 27 }, { name: "Anna", age: 23 }, { name: "Boris", age: 31 }];
console.log(bubbleSort(people, (x, y) => x.age < y.age).map((p) => p.name).join(" "));
console.log(bubbleSort([5, 3, 9, 1, 7], (x, y) => x > y).join(" "));
`,
    input: `%%
const name: string = input("Name: ") ?? "";
const [a, b] = (input("Two numbers: ") ?? "0 0").split(" ").map(Number);
console.log(\`Hello, \${name}! \${a} + \${b} = \${a + b}\`);
`,
  },
  lua: {
    hello: `%%
print("Hello, World!")
`,
    loops: `%%
for i = 1, 5 do
  local row = {}
  for j = 1, 5 do row[#row + 1] = i * j end
  print(table.concat(row, "\\t"))
end
local sum, n = 0, 0
while n < 100 do
  n = n + 1
  sum = sum + n
end
print("1 + 2 + ... + 100 = " .. sum)
`,
    recursion: `%%
local function factorial(n)
  if n <= 1 then return 1 end
  return n * factorial(n - 1)
end

local function fib(n)
  if n < 2 then return n end
  return fib(n - 1) + fib(n - 2)
end

for i = 0, 10 do
  print(string.format("%d! = %d, fib(%d) = %d", i, factorial(i), i, fib(i)))
end
`,
    sorting: `%%
local function bubbleSort(a)
  for i = 1, #a - 1 do
    for j = 1, #a - i do
      if a[j] > a[j + 1] then a[j], a[j + 1] = a[j + 1], a[j] end
    end
  end
  return a
end

print(table.concat(bubbleSort({5, 3, 9, 1, 7, 2, 8}), " "))
local b = {5, 3, 9, 1, 7, 2, 8}
table.sort(b, function(x, y) return x > y end)
print(table.concat(b, " "))
`,
    input: `%%
io.write("Name: ")
local name = io.read("l")
io.write("Two numbers: ")
local a, b = io.read("n", "n")
print(string.format("Hello, %s! %d + %d = %d", name, a, b, a + b))
`,
  },
  ruby: {
    hello: `%%
puts "Hello, World!"
`,
    loops: `%%
(1..5).each do |i|
  puts (1..5).map { |j| i * j }.join("\\t")
end
sum = 0
n = 0
while n < 100
  n += 1
  sum += n
end
puts "1 + 2 + ... + 100 = #{sum}"
`,
    recursion: `%%
def factorial(n) = n <= 1 ? 1 : n * factorial(n - 1)
def fib(n) = n < 2 ? n : fib(n - 1) + fib(n - 2)

(0..10).each { |i| puts "#{i}! = #{factorial(i)}, fib(#{i}) = #{fib(i)}" }
`,
    sorting: `%%
def bubble_sort(arr)
  a = arr.dup
  (a.size - 1).times do |i|
    (a.size - 1 - i).times do |j|
      a[j], a[j + 1] = a[j + 1], a[j] if a[j] > a[j + 1]
    end
  end
  a
end

data = [5, 3, 9, 1, 7, 2, 8]
puts bubble_sort(data).join(" ")
puts data.sort.reverse.join(" ")
`,
    input: `%%
print "Name: "
name = gets.chomp
print "Two numbers: "
a, b = gets.split.map(&:to_i)
puts "Hello, #{name}! #{a} + #{b} = #{a + b}"
`,
  },
  sql: {
    hello: `%%
SELECT 'Hello, World!' AS greeting;
`,
    loops: `%%
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5)
SELECT i, i * 2 AS x2, i * 3 AS x3, i * i AS square FROM n;

WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
SELECT SUM(i) AS "1 + 2 + ... + 100" FROM n;
`,
    recursion: `%%
WITH RECURSIVE f(n, fact, a, b) AS (
  SELECT 0, 1, 0, 1
  UNION ALL
  SELECT n + 1, fact * (n + 1), b, a + b FROM f WHERE n < 10
)
SELECT n, fact AS factorial, a AS fib FROM f;
`,
    sorting: `%%
CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER);
INSERT INTO people (name, age) VALUES ('Vera', 27), ('Anna', 23), ('Boris', 31), ('Gleb', 19);

SELECT name, age FROM people ORDER BY age;
SELECT name, age FROM people ORDER BY name DESC LIMIT 2;
SELECT COUNT(*) AS people, AVG(age) AS average_age FROM people;
`,
  },
};

const STDIN = {
  cpp: { input: 'Anna\n2 3\n' },
  c: { input: 'Anna 2 3\n' },
  python: { input: 'Anna\n2 3\n' },
  js: { input: 'Anna\n2 3\n' },
  ts: { input: 'Anna\n2 3\n' },
  lua: { input: 'Anna\n2 3\n' },
  ruby: { input: 'Anna\n2 3\n' },
};

const EXAMPLE_IDS = ['hello', 'loops', 'recursion', 'sorting', 'input'];
const FILE_BASE = { hello: 'main', loops: 'loops', recursion: 'recursion', sorting: 'sorting', input: 'input' };

function byId(id) { return LANGS.find((l) => l.id === id) || null; }
function byFile(name) {
  const m = /\.([^.]+)$/.exec(String(name || ''));
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return LANGS.find((l) => l.exts.includes(ext)) || null;
}
// Example text with the first line turned into a comment in the interface language.
function example(langId, exId, ui) {
  const lang = byId(langId);
  const code = EX[langId] && EX[langId][exId];
  if (!lang || !code) return null;
  const title = (T[exId] && (T[exId][ui] || T[exId].en)) || exId;
  return {
    file: FILE_BASE[exId] + '.' + lang.exts[0],
    code: code.replace('%%', lang.comment + ' ' + title),
    stdin: (STDIN[langId] && STDIN[langId][exId]) || '',
  };
}

const API = { LANGS, EXAMPLE_IDS, byId, byFile, example, EXAMPLE_TITLES: T };
if (typeof module === 'object' && module.exports) module.exports = API;
else root.CompilerLangs = API;
})(typeof self !== 'undefined' ? self : this);
