import test from 'node:test';import assert from 'node:assert/strict';import {NcloudStorage} from '../ncloud-storage.mjs';import {createHandler} from '../worker.mjs';
const config={accessKey:'test-access',secretKey:'test-secret',bucket:'landmaker-photos-test',clock:()=>new Date('2026-11-18T00:00:00Z')};
test('NAVER S3 signing keeps private ACL, Korea scope and secrets on server',async()=>{
 const calls=[];const storage=new NcloudStorage({...config,fetcher:async(url,init)=>{calls.push({url,init});return new Response(new Uint8Array([1,2]));}});
 await storage.put('photos/abcdef01/full.jpg',new Uint8Array([1,2]),{httpMetadata:{contentType:'image/jpeg'}});
 const {url,init}=calls[0];assert.equal(url,'https://kr.object.ncloudstorage.com/landmaker-photos-test/photos/abcdef01/full.jpg');assert.equal(init.headers['x-amz-acl'],'private');assert.equal(init.headers['cache-control'],'no-store');assert.match(init.headers.authorization,/20261118\/kr-standard\/s3\/aws4_request/);assert(!init.headers.authorization.includes('test-secret'));assert.equal(init.redirect,'error');assert.equal(init.headers['x-amz-content-sha256'].length,64);
 assert(await storage.get('photos/abcdef01/full.jpg'));await assert.rejects(storage.get('../private'),/경로/);
});
test('NAVER missing object and service errors fail closed without leaking credentials',async()=>{
 const missing=new NcloudStorage({...config,fetcher:async()=>new Response(null,{status:404})});assert.equal(await missing.get('photos/abcdef01/thumb.jpg'),null);
 const denied=new NcloudStorage({...config,fetcher:async()=>new Response('sensitive upstream error',{status:403})});await assert.rejects(denied.get('photos/abcdef01/thumb.jpg'),e=>e.message.includes('403')&&!e.message.includes('sensitive'));
});
test('Supabase function base path is retained in short-lived private media links',async()=>{
 const handler=createHandler(()=>({authenticate:async()=> 'employee',call:async()=>({})}));const env={TICKET_SECRET:'long-test-secret-at-least-thirty-two-characters',PHOTOS:{},ALLOWED_ORIGINS:'https://landmaker.test',API_BASE_PATH:'/functions/v1/landmaker-photos'};
 const r=await handler(new Request('https://test.supabase.co/functions/v1/landmaker-photos/api',{method:'POST',headers:{Origin:'https://landmaker.test',Authorization:'Bearer token','Content-Type':'application/json'},body:JSON.stringify({action:'ticket',propertyId:'p1',assetId:'a1',variant:'full',purpose:'view'})}),env);assert.equal(r.status,200);const data=await r.json();assert(data.url.startsWith('https://test.supabase.co/functions/v1/landmaker-photos/media?ticket='));assert.equal(data.expiresIn,60);
});
