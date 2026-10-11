// Cross-origin isolation for a static site (GitHub Pages cannot send headers).
// The same idea as coi-serviceworker by Guido Zuidhof (MIT): this one file is both the page
// script and the service worker. The worker adds Cross-Origin-Opener-Policy and
// Cross-Origin-Embedder-Policy to every answer of the site, the page then becomes
// crossOriginIsolated and may give a SharedArrayBuffer to the program's worker - the program can
// wait for a line typed in the output (input while it runs).
// Nothing happens on a page opened from disk (file://: no service workers) and on a page that is
// isolated already (the server or the app sends the headers itself).
/* global clients */
if (typeof window === 'undefined') {
  // ---- the service worker
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (e) => {
    const r = e.request;
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
    e.respondWith(fetch(r).then((res) => {
      if (res.status === 0) return res;
      const h = new Headers(res.headers);
      h.set('Cross-Origin-Embedder-Policy', 'require-corp');
      h.set('Cross-Origin-Opener-Policy', 'same-origin');
      h.set('Cross-Origin-Resource-Policy', 'cross-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }).catch(() => fetch(r)));
  });
} else {
  // ---- the page
  (() => {
    // only a site: Electron lets file:// pages register service workers too, and a worker there
    // broke the page of the app (the app sends the headers itself)
    if (!/^https?:$/.test(location.protocol)) return;
    if (window.crossOriginIsolated || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    const KEY = 'coiReloaded';
    let tried = false;
    try { tried = sessionStorage.getItem(KEY) === '1'; } catch (e) { /* storage off: one try */ }
    const script = document.currentScript && document.currentScript.src;
    if (!script) return;
    navigator.serviceWorker.register(script).then((reg) => {
      // the first visit: the page was loaded without the worker - load it once more through it
      if (navigator.serviceWorker.controller || tried) return;
      try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
      const go = () => window.location.reload();
      if (reg.active) go();
      else (reg.installing || reg.waiting).addEventListener('statechange', (ev) => { if (ev.target.state === 'activated') go(); });
    }, () => {});
  })();
}
