import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {JSDOM} from 'jsdom';
const source=await fs.readFile(new URL('../../photo-ui/client.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,15));
function setup(){const dom=new JSDOM('<div id="host"></div>',{url:'https://landmaker.test',runScripts:'outside-only'});let created=0,revoked=0;dom.window.URL.createObjectURL=()=>`blob:test-${++created}`;dom.window.URL.revokeObjectURL=()=>revoked++;dom.window.eval(source);return {dom,api:dom.window.LMPrivatePhotos,host:dom.window.document.querySelector('#host'),counts:()=>({created,revoked})};}
test('mobile compression preserves proportions and does not enlarge small pictures',()=>{const s=setup();assert.deepEqual(JSON.parse(JSON.stringify(s.api.dimensions(4032,3024,1920))),{width:1920,height:1440});assert.equal(s.api.dimensions(300,600,1920).height,600);s.dom.window.close();});
test('gallery filters approval at server and cleans private blob URLs',async()=>{
 const s=setup();const calls=[];const photos=[{asset_id:'a',ad_approved:false,is_cover:true,deleted_at:null},{asset_id:'b',ad_approved:true,deleted_at:null}];
 const client={async api(action,args){calls.push({action,args});if(action==='list')return {photos:args.adsOnly?photos.filter(p=>p.ad_approved):photos,permissions:{can_read:true,can_edit:true,can_approve:false}};return {ok:true};},async media(){return new s.dom.window.Blob(['photo'],{type:'image/jpeg'});}};
 const dispose=s.api.mount(s.host,client,'same-address-property-2',{adsOnly:true});await tick();assert.equal(calls[0].args.propertyId,'same-address-property-2');assert.equal(calls[0].args.adsOnly,true);assert.equal(s.host.querySelectorAll('article').length,1);assert.equal(s.host.querySelector('[data-act="approve"]').hidden,true);assert(s.host.querySelector('[data-act="download"]'));assert.equal(s.host.querySelector('[data-controls]').hidden,true);dispose();assert.deepEqual(s.counts(),{created:1,revoked:1});s.dom.window.close();
});
test('read-only staff cannot use upload or mutation controls and errors are visible',async()=>{
 const s=setup();const c={api:async()=>({photos:[{asset_id:'a',ad_approved:false}],permissions:{can_read:true,can_edit:false,can_approve:false}}),media:async()=>{throw Error('권한 차단');}};const dispose=s.api.mount(s.host,c,'p1');await tick();assert(s.host.querySelector('[data-pick]').disabled);assert(s.host.querySelector('[data-act="unlink"]').disabled);assert(s.host.querySelector('[data-act="approve"]').disabled);assert.match(s.host.querySelector('[data-status]').textContent,/권한 차단/);dispose();s.dom.window.close();
});
test('integration modules and every existing inline script parse successfully',async()=>{
 const html=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');let n=0;for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){if(m[1].trim()){new vm.Script(m[1]);n++;}}assert(n>5);for(const f of ['config.js','client.js','integration.js'])new vm.Script(await fs.readFile(new URL('../../photo-ui/'+f,import.meta.url),'utf8'));assert(html.includes('data-lm-photo-property'));assert(html.includes('lmPhotoAttachAds'));assert(!html.includes('SUPABASE_SERVICE_KEY'));
});

test('checkbox selection scopes bulk deletion and requires one photo for cover',async()=>{
 const s=setup(),calls=[];s.dom.window.confirm=()=>true;let photos=[{asset_id:'a',ad_approved:true},{asset_id:'b',ad_approved:false},{asset_id:'c',ad_approved:true}];
 const client={async api(action,args){calls.push({action,args});if(action==='list')return {photos,permissions:{can_read:true,can_edit:true,can_approve:true}};if(action==='unlink')photos=photos.filter(p=>p.asset_id!==args.assetId);return {ok:true};},async media(){return new s.dom.window.Blob(['photo']);}};
 const dispose=s.api.mount(s.host,client,'p1');await tick();assert.equal(s.host.querySelectorAll('article [data-act]').length,0);
 s.host.querySelector('[data-select="a"]').click();assert.equal(s.host.querySelector('[data-act="cover"]').disabled,false);assert.equal(s.host.querySelector('[data-act="download"]').disabled,false);
 s.host.querySelector('[data-select="b"]').click();assert.equal(s.host.querySelector('[data-act="cover"]').disabled,true);assert.equal(s.host.querySelector('[data-act="download"]').disabled,true);
 s.host.querySelector('[data-act="unlink"]').click();await tick();assert.deepEqual(calls.filter(c=>c.action==='unlink').map(c=>c.args.assetId),['a','b']);assert.equal(s.host.querySelectorAll('article').length,1);assert.equal(s.host.querySelector('[data-selected-count]').textContent,'0장 선택');dispose();s.dom.window.close();
});
