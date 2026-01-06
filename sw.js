const CACHE_NAME="bitacora-cache-v20260106f";
const ASSETS=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest",
"./icons/icon-192.png","./icons/icon-512.png","./icons/apple-touch-icon.png"];
self.addEventListener("install",e=>{e.waitUntil((async()=>{const c=await caches.open(CACHE_NAME);await c.addAll(ASSETS);self.skipWaiting();})())});
self.addEventListener("activate",e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==CACHE_NAME)await caches.delete(k);await self.clients.claim();})())});
self.addEventListener("fetch",e=>{
const url=new URL(e.request.url);
if(url.origin!==self.location.origin) return;
if(e.request.mode==="navigate"){
e.respondWith((async()=>{const c=await caches.open(CACHE_NAME);try{const r=await fetch(e.request);c.put("./index.html",r.clone());return r;}catch(_){return (await c.match("./index.html"))||Response.error();}})());
return;
}
e.respondWith((async()=>{const c=await caches.open(CACHE_NAME);const cached=await c.match(e.request);if(cached) return cached;
try{const r=await fetch(e.request);if(e.request.method==="GET") c.put(e.request,r.clone());return r;}catch(_){return cached||Response.error();}})());
});
