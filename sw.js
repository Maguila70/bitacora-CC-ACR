/* Bitácora PWA Service Worker */
const CACHE_NAME = "bitacora-cache-v20260106d";
const ASSETS = [
  "/bitacora-CC-ACR/",
  "/bitacora-CC-ACR/index.html",
  "/bitacora-CC-ACR/styles.css",
  "/bitacora-CC-ACR/app.js",
  "/bitacora-CC-ACR/manifest.json",
  "/bitacora-CC-ACR/icons/icon-192.png",
  "/bitacora-CC-ACR/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin navigations/assets
  if (url.origin !== location.origin) return;

  // Navigation: serve shell offline
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const net = await fetch(req);
          // update cache
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", net.clone());
          return net;
        } catch (_) {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match("/bitacora-CC-ACR/index.html")) || (await cache.match("./")) || Response.error();
        }
      })()
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const net = await fetch(req);
        // cache a copy (without query)
        if (net && net.ok) cache.put(url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname, net.clone());
        return net;
      } catch (_) {
        return cached || Response.error();
      }
    })()
  );
});

// --- Navigation fallback (app-shell) ---
self.addEventListener('fetch', (event) => {
  try{
    if (event.request.mode === 'navigate') {
      event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME || 'bitacora-shell-v1');
        try {
          const fresh = await fetch(event.request);
          cache.put(event.request, fresh.clone());
          return fresh;
        } catch (e) {
          // fallback a index.html en cache
          const cached = await cache.match('./') || await cache.match('index.html') || await cache.match('/');
          return cached || new Response('Offline', {status: 200, headers: {'Content-Type':'text/plain'}});
        }
      })());
    }
  }catch(_){}
});
