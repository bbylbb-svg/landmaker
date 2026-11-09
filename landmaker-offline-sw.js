
/* Landmaker offline shell test, 2026-11-09. Do NOT cache cloud API/auth or POST. */
const CACHE='landmaker-shell-test-20261109-v1';
const APP='./index.html';

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.add(APP)));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||req.mode!=='navigate')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname))return;

  event.respondWith(fetch(req).then(response=>{
    if(response.ok){
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE).then(c=>c.put(APP,copy)));
    }
    return response;
  }).catch(async()=>{
    const cache=await caches.open(CACHE);
    return await cache.match(APP)||Response.error();
  }));
});
