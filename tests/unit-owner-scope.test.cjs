const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
(async()=>{for(const file of ['index.html','offline-test/index.html']){
 const dom=new JSDOM(fs.readFileSync(file,'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.com',beforeParse(w){const Base=w.MutationObserver;w.obs=[];w.MutationObserver=class extends Base{constructor(cb){super(cb);w.obs.push(this)}}}}),w=dom.window;
 w.eval(`db={customers:[],properties:[],records:[],schedules:[],transactions:[],ownership:[],quick:[]};document.querySelector('#view').innerHTML=propertyForm({unitRooms:[{key:'a',address:'매화동 846',dong:'센터',ho:'226'},{key:'b',address:'매화동 846',dong:'센터',ho:'227'}]});bindParcels();bindBuildings();bindOwners();lmBindOwnerChanges(document.querySelector('#propertyForm'));`);
 await new Promise(r=>setTimeout(r,0));const f=w.document.querySelector('#propertyForm'),row=f.querySelector('#buildingOwnerFields .ownerrow');
 assert(row.querySelector('.lm-owner-targets').textContent.includes('대상 호실'));
 let choices=row.querySelectorAll('[data-owner-scope-choice]');assert.equal(choices.length,2);assert(choices[0].parentElement.textContent.includes('226호'));
 row.querySelector('[name=ownerNameItem]').value='테스트 소유주';row.querySelector('[name=ownerShareItem]').value='1/2';choices[0].checked=true;choices[0].dispatchEvent(new w.Event('change',{bubbles:true}));
 const saved=w.eval(`parseOwners(document.querySelector('#propertyForm'),'building')`);assert.equal(saved[0].scopeMode,'selected');assert.equal(saved[0].scope.length,1);assert(saved[0].scope[0].includes('226호'));assert(!saved[0].scope[0].includes('227호'));assert.equal(saved[0].share,'1/2');
 const info=f.querySelector('[data-unit-owner-summary]');assert(info.textContent.includes('테스트 소유주'));assert(info.textContent.includes('소유주 연결 필요'));
 const input=f.querySelector('[name=unitRoomsDraft]');input.value=JSON.stringify([...JSON.parse(input.value),{key:'c',address:'매화동 846',dong:'센터',ho:'228'}]);input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(row.querySelectorAll('[data-owner-scope-choice]').length,3);assert(row.querySelector('[data-owner-scope-choice]').checked);
 for(const o of w.obs)o.disconnect();dom.window.close();console.log(file+': room selection, owner/share persistence, unassigned room and import refresh passed');
}})().catch(e=>{console.error(e);process.exit(1)});
