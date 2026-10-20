/* Card Display service worker: the app shell is precached; the text-recognition
   files are cached the first time they are used, so later scans work offline. */
const VERSION = 'card-display-v0.4.1';
const SHELL = ['./', './index.html', './styles.css', './pipeline.js', './ocr.js', './storage.js', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fonts and anything else go straight to the network

  // Vendored OCR files: cache-first, cached on first use.
  if (url.pathname.includes('/vendor/')) {
    event.respondWith(
      caches.open(VERSION).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // App shell: network-first so updates arrive, cache fallback when offline.
  event.respondWith(
    fetch(req).then(res => {
      if (res.ok) caches.open(VERSION).then(cache => cache.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
