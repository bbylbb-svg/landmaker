/* Cache the application shell only. No API, auth, POST, or customer data caching here. */
const SCOPE=new URL(self.registration.scope),APP=new URL('index.html',SCOPE).href;
const CACHE='landmaker-shell-v2-'+encodeURIComponent(SCOPE.pathname);
const appNavigation=url=>url.origin===SCOPE.origin&&(url.pathname===SCOPE.pathname||url.pathname===new URL(APP).pathname);
async function cachedShell(){const c=await caches.open(CACHE);return await c.match(APP)}
self.addEventListener('install',event=>{event.waitUntil((async()=>{const r=await fetch(new Request(APP,{cache:'reload'}));if(!r.ok)throw Error('Offline shell download failed');const c=await caches.open(CACHE);await c.put(APP,r);await self.skipWaiting()})())});
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 event.respondWith((async()=>{
  const client=event.clientId?await self.clients.get(event.clientId):null;
  const test=(req.mode==='navigate'&&appNavigation(url)&&url.searchParams.get('lm-offline-test')==='1')||(client&&new URL(client.url).searchParams.get('lm-offline-test')==='1');
  // Explicit per-tab verification mode: navigation and every outbound request stay local.
  if(test){if(req.method==='GET'&&req.mode==='navigate'&&appNavigation(url))return await cachedShell()||new Response('이 PC의 오프라인 화면이 아직 준비되지 않았습니다.',{status:503});return Response.error()}
  if(req.method!=='GET'||req.mode!=='navigate'||!appNavigation(url))return fetch(req);
  try{const response=await fetch(req);if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(APP,copy)));return response}return await cachedShell()||response}
  catch{return await cachedShell()||Response.error()}
 })());
});
