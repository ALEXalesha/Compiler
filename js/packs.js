// Loading of the offline packs (vendor/*/*.pack.js, see vendor/make-packs.js) and of shared
// scripts. A pack is an ordinary <script>: it puts gzip + base64 strings into
// self.COMPILER_PACKS. Nothing here uses fetch(), so it works from disk (file://) too.
(function (root) {
'use strict';

const loaded = new Map();          // src -> Promise
const store = new Map();           // pack entry name -> base64 string (kept for restarts)

function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => { loaded.delete(src); reject(new Error('file not found: ' + src)); };
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}

function loadStyle(href) {
  if (document.querySelector('link[href="' + href + '"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}

// Loads a pack file and returns the base64 strings of the given entries.
async function pack(src, names) {
  if (!names.every((n) => store.has(n))) {
    await loadScript(src);
    const P = self.COMPILER_PACKS || {};
    for (const n of Object.keys(P)) { store.set(n, P[n]); delete P[n]; }
  }
  const out = {};
  for (const n of names) {
    if (!store.has(n)) throw new Error('no "' + n + '" in ' + src);
    out[n] = store.get(n);
  }
  return out;
}

// --- unpacking; the same functions run in workers (their source goes into the Blob) ---
function b64ToBytes(b64) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unpackBytes(b64) { return gunzip(b64ToBytes(b64)); }
async function unpackText(b64) { return new TextDecoder().decode(await unpackBytes(b64)); }

const WORKER_HELPERS = [b64ToBytes, gunzip, unpackBytes, unpackText].map((f) => f.toString()).join('\n');

root.CompilerPacks = { loadScript, loadStyle, pack, unpackBytes, unpackText, b64ToBytes, WORKER_HELPERS };
})(typeof self !== 'undefined' ? self : this);
