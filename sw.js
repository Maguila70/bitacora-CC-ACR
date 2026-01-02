/* Bitácora PWA Service Worker - cache-first + offline navigation fallback */
const CACHE = "bitacora-pwa-20260102-06";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js?v=20260102-06",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((k) => (k === CACHE) ? Promise.resolve() : caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Offline fallback for navigations
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Same-origin assets: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(()=>{});
          return res;
        });
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Cross-origin: network-first (don’t cache)
  event.respondWith(fetch(req));
});
