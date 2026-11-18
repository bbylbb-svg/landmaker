import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {database,USERS} from './database.mjs';import {createHandler,verifyTicket} from '../worker.mjs';import {cleanJPEG} from '../image.mjs';
const require=createRequire(import.meta.url);const sharp=require('sharp');
const origin='https://landmaker.test';const secret='test-secret-at-least-32-characters-only-local';
async function setup(){
 const {db,call}=await database();const objects=new Map();const counters={get:0,put:0};let failPut=false;
 const env={TICKET_SECRET:secret,ALLOWED_ORIGINS:origin,PHOTOS:{async put(k,v){counters.put++;if(failPut)throw Error('R2 outage');objects.set(k,Uint8Array.from(v));},async get(k){counters.get++;const b=objects.get(k);return b?{body:b}:null;}}};
 const handler=createHandler(()=>({authenticate:async token=>{if(!USERS.includes(token)){const e=Error('invalid session');e.status=401;throw e;}return token;},call:async(...a)=>{try{return await call(...a);}catch(e){const mapped={'42501':403,P0002:404,'40001':409,'54000':413};const err=Error(e.message);err.status=mapped[e.code]||503;throw err;}}}));
 const request=(path,body,user=USERS[0],extra={})=>handler(new Request('https://photos.test'+path,{method:'POST',headers:{Origin:origin,...(user?{Authorization:'Bearer '+user}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...extra},body:body instanceof FormData?body:JSON.stringify(body)}),env);
 const api=async(action,args={},u=USERS[0])=>{const response=await request('/api',{action,...args},u);return {response,data:await response.json()};};
 const full=await sharp({create:{width:1920,height:1080,channels:3,background:'#5599aa'}}).jpeg({quality:85,progressive:false}).toBuffer();const thumb=await sharp(full).resize({width:360}).jpeg({progressive:false}).toBuffer();
 const upload=async(pid='p1',u=USERS[0])=>{const f=new FormData();f.set('propertyId',pid);f.set('full',new Blob([full],{type:'image/jpeg'}),'photo.jpg');f.set('thumb',new Blob([thumb],{type:'image/jpeg'}),'thumb.jpg');return request('/upload',f,u);};
 return {db,call,api,request,upload,full,thumb,handler,env,objects,counters,setFail:v=>failPut=v};
}
test('end-to-end: private upload, dedup, separate listings, ad approval, revocation, soft delete and restoration',async()=>{
 const s=await setup();try{
  assert.equal((await s.api('list',{propertyId:'p1'},null)).response.status,401);
  assert.equal((await s.api('list',{propertyId:'p1'},USERS[3])).response.status,403);
  assert.equal((await s.api('list',{propertyId:'missing'})).response.status,404);
  await s.db.query('update lm_photo_permissions set can_edit=false where staff_id=$1',[USERS[2]]);assert.equal((await s.upload('p1',USERS[2])).status,403);assert.equal((await s.api('list',{propertyId:'p1'},USERS[2])).response.status,200);
  assert.equal((await s.upload()).status,200);const a=(await s.api('list',{propertyId:'p1'})).data.photos[0];assert(a.asset_id);assert.equal(s.objects.size,2);
  assert.equal((await s.api('list',{propertyId:'p2'})).data.photos.length,0);
  assert.equal((await s.upload()).status,200);assert.equal((await s.api('list',{propertyId:'p1'})).data.photos.length,1);assert.equal(s.counters.put,2);
  assert.equal((await s.api('ticket',{propertyId:'p1',assetId:a.asset_id,variant:'full',purpose:'download'})).response.status,403);
  assert.equal((await s.api('update',{propertyId:'p1',assetId:a.asset_id,adApproved:true},USERS[1])).response.status,403);
  assert.equal((await s.api('update',{propertyId:'p1',assetId:a.asset_id,adApproved:true,cover:true})).response.status,200);
  const t=(await s.api('ticket',{propertyId:'p1',assetId:a.asset_id,variant:'full',purpose:'download'})).data;
  let response=await s.handler(new Request(t.url,{headers:{Origin:origin}}),s.env);assert.equal(response.status,401);
  response=await s.handler(new Request(t.url,{headers:{Origin:origin,Authorization:'Bearer '+USERS[1]}}),s.env);assert.equal(response.status,403);
  response=await s.handler(new Request(t.url,{headers:{Origin:origin,Authorization:'Bearer '+USERS[0]}}),s.env);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store, private');assert(response.headers.get('Content-Disposition').includes('attachment'));assert.deepEqual(new Uint8Array(await response.arrayBuffer()),cleanJPEG(s.full).bytes);
  await s.api('link',{propertyId:'p2',sourcePropertyId:'p1',assetId:a.asset_id});assert.equal(s.objects.size,2);assert.equal((await s.api('list',{propertyId:'p2',adsOnly:true})).data.photos.length,0);
  await s.api('update',{propertyId:'p1',assetId:a.asset_id,adApproved:false});response=await s.handler(new Request(t.url,{headers:{Authorization:'Bearer '+USERS[0]}}),s.env);assert.equal(response.status,403);
  await s.api('unlink',{propertyId:'p1',assetId:a.asset_id});assert.equal((await s.api('list',{propertyId:'p1'})).data.photos.length,0);assert.equal((await s.api('list',{propertyId:'p1',trash:true})).data.photos.length,1);assert.equal((await s.api('list',{propertyId:'p2'})).data.photos.length,1);assert.equal(s.objects.size,2);
  await s.api('restore',{propertyId:'p1',assetId:a.asset_id});assert.equal((await s.api('list',{propertyId:'p1'})).data.photos[0].ad_approved,false);
  await s.db.query('update lm_photo_permissions set can_read=false where staff_id=$1',[USERS[0]]);assert.equal((await s.api('list',{propertyId:'p1'})).response.status,403);
  const audit=(await s.db.query('select action from lm_photo_audit')).rows.map(x=>x.action);for(const a of ['reserve','complete','media','update','unlink','restore','link'])assert(audit.includes(a));
 }finally{await s.db.close();}
});
test('quota and failed upload retry do not lose objects or create duplicate links',async()=>{
 const s=await setup();try{
  await s.db.exec('update lm_photo_limits set max_bytes=1');assert.equal((await s.upload()).status,413);assert.equal(s.objects.size,0);
  await s.db.exec('update lm_photo_limits set max_bytes=8000000000');s.setFail(true);assert.equal((await s.upload()).status,503);assert.equal((await s.api('list',{propertyId:'p1'})).data.photos.length,0);
  s.setFail(false);assert.equal((await s.upload()).status,409);await s.db.exec("update lm_photo_assets set leased_at=now()-interval '3 minutes'");assert.equal((await s.upload()).status,200);assert.equal((await s.api('list',{propertyId:'p1'})).data.photos.length,1);
  const a=(await s.api('list',{propertyId:'p1'})).data.photos[0];await s.db.exec('update lm_photo_limits set max_class_b=0');const t=(await s.api('ticket',{propertyId:'p1',assetId:a.asset_id,variant:'thumb',purpose:'view'})).data;const before=s.counters.get;assert.equal((await s.handler(new Request(t.url,{headers:{Authorization:'Bearer '+USERS[0]}}),s.env)).status,413);assert.equal(s.counters.get,before);
 }finally{await s.db.close();}
});
test('RLS and RPC grants prevent public or directly authenticated access',async()=>{
 const {db}=await database();try{
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from public.lm_photo_assets'),/permission denied/);await assert.rejects(db.query("select public.lm_photo_dispatch($1,'authorize','{}')",[USERS[0]]),/permission denied/);await db.exec('reset role');}
  await db.exec('set role service_role');const r=await db.query("select public.lm_photo_dispatch($1,'authorize','{}') as p",[USERS[0]]);assert.equal(r.rows[0].p.can_read,true);await db.exec('reset role');
 }finally{await db.close();}
});
test('expired or tampered tickets, CORS, and arbitrary URL requests are rejected',async()=>{
 const s=await setup();try{
  const {signTicket}=await import('../worker.mjs');const ticket=await signTicket({uid:USERS[0],exp:Math.floor(Date.now()/1000)-1},secret);await assert.rejects(verifyTicket(ticket,secret,USERS[0]));await assert.rejects(verifyTicket(ticket+'x',secret,USERS[0]));
  const response=await s.request('/api',{action:'usage'},USERS[0],{Origin:'https://evil.test'});assert.equal(response.status,403);
  assert.equal((await s.api('fetch',{url:'http://169.254.169.254/'})).response.status,400);
  assert.equal((await s.request('/api',{action:'usage'},'bad-session')).status,401);
 }finally{await s.db.close();}
});
test('metadata is removed server-side, invalid photos and excessive dimensions are rejected',async()=>{
 const s=await setup();try{
  const metadata=Uint8Array.from([255,225,0,13,...new TextEncoder().encode('ExifGPS123') ,0]);const tagged=Buffer.concat([s.full.subarray(0,2),metadata,s.full.subarray(2)]);const clean=cleanJPEG(tagged);assert.equal(Buffer.from(clean.bytes).includes(Buffer.from('ExifGPS')),false);assert.equal(clean.width,1920);
  const tooBig=await sharp({create:{width:1921,height:2,channels:3,background:'#aaa'}}).jpeg().toBuffer();assert.throws(()=>cleanJPEG(tooBig),/해상도/);assert.throws(()=>cleanJPEG(new Uint8Array([1,2,3])),/형식/);
 }finally{await s.db.close();}
});
