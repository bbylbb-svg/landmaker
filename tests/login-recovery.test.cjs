const assert=require('node:assert/strict'),fs=require('fs'),{JSDOM}=require('jsdom');
(async()=>{for(const file of ['index.html','offline-test/index.html']){
 const dom=new JSDOM(fs.readFileSync(file,'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.com',beforeParse(w){const Base=w.MutationObserver;w.obs=[];w.MutationObserver=class extends Base{constructor(cb){super(cb);w.obs.push(this)}}}}),w=dom.window;
 w.eval(`
 window.fixture={customers:[],properties:[{id:'local',title:'보존할 PC 매물'}],records:[],schedules:[],transactions:[],ownership:[],quick:[]};
 window.serverData={...fixture,properties:[{id:'server',title:'서버 매물'}]};window.pending={data:JSON.stringify(fixture),at:'2026-11-18',version:1};window.reads=0;window.renders=0;window.downloads=0;
 checkStaff=async()=>({name:'시험직원',auth_user_id:'test-user'});lmSafeGet=async()=>pending;cloudRPC=async(fn)=>{if(fn!=='lm_cloud_read')throw Error('unexpected write');reads++;return {version:2,data:serverData}};render=()=>{renders++};lmSafeDownload=()=>{downloads++};window.lmCacheSnapshot=async()=>{};lmSyncRows=async()=>[];window.lmEnsureOfflineArchives=()=>{};
 window.originalDB=db;`);
 await w.eval(`activateAuth('valid-token')`);
 assert.equal(w.document.querySelector('#authGate').hidden,true);assert.equal(w.document.querySelector('#authInfo').hidden,false);assert(w.document.querySelector('#view').textContent.includes('로그인 완료'));
 assert.equal(w.lmRecoveryBlocked,true);assert.equal(w.renders,0);assert(w.eval('db===originalDB'));assert.equal(w.eval('authToken'),'valid-token');assert.equal(w.pending.data,JSON.stringify(w.fixture));
 const before=w.reads;await w.eval('lmSyncFlush()');assert.equal(w.reads,before);await assert.rejects(w.eval('lmCloudWriteProtected({})'),/서버에 저장할 수 없습니다/);
 w.document.querySelector('[data-recovery-local]').click();assert(w.document.querySelector('[data-recovery-data]').textContent.includes('보존할 PC 매물')===false); // default is customers; change to properties
 const select=w.document.querySelector('[data-recovery-kind]');select.value='properties';select.dispatchEvent(new w.Event('change'));assert(w.document.querySelector('[data-recovery-data]').textContent.includes('보존할 PC 매물'));
 w.document.querySelector('[data-recovery-server]').click();const select2=w.document.querySelector('[data-recovery-kind]');select2.value='properties';select2.dispatchEvent(new w.Event('change'));assert(w.document.querySelector('[data-recovery-data]').textContent.includes('서버 매물'));
 w.document.querySelector('[data-recovery-download]').click();assert.equal(w.downloads,1);assert.equal(w.pending.data,JSON.stringify(w.fixture));
 // Exact server match permits ordinary login without deleting the preserved snapshot.
 w.eval(`lmSyncFlush=async()=>{};serverData=JSON.parse(pending.data)`);await w.eval(`activateAuth('valid-token')`);assert.equal(w.lmRecoveryBlocked,false);assert.equal(w.renders,1);assert.equal(w.eval('db.properties[0].id'),'local');assert(w.pending.data);
 w.eval(`checkStaff=async()=>{throw Error('직원 아님')}`);await assert.rejects(w.eval(`activateAuth('invalid')`),/직원 아님/);
 for(const o of w.obs)o.disconnect();dom.window.close();console.log(file+': recovery login, immutable comparison/backup, blocked writes, identical server match and invalid staff passed');
}})().catch(e=>{console.error(e);process.exit(1)});
