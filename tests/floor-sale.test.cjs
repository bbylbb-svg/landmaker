const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
(async()=>{for(const file of ['index.html','offline-test/index.html']){
 const dom=new JSDOM(fs.readFileSync(file,'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.com',beforeParse(w){const Base=w.MutationObserver;w.obs=[];w.MutationObserver=class extends Base{constructor(cb){super(cb);w.obs.push(this)}}}}),w=dom.window;
 w.eval(`db={customers:[],properties:[],records:[],schedules:[],transactions:[],ownership:[],quick:[]};document.querySelector('#view').innerHTML=propertyForm({unitRooms:[{key:'a',address:'매화동 846',dong:'센터',ho:'226'},{key:'b',address:'매화동 846',dong:'센터',ho:'227'}]});bindParcels();bindBuildings();bindOwners();lmBindOwnerChanges(document.querySelector('#propertyForm'));`);
 await new Promise(r=>setTimeout(r,0));const f=w.document.querySelector('#propertyForm'),row=f.querySelector('#buildingOwnerFields .ownerrow');
 const b=f.querySelector('.buildingrow');const toggle=b.querySelector('[name=perFloorSale]');assert(toggle);toggle.checked=true;
const name=b.querySelector('[name=levelName]');name.value='226+227';b.querySelector('[name=levelForSale]').checked=true;b.querySelector('[name=levelSalePrice]').value='88000';b.querySelector('[name=levelSaleStatus]').value='진행중';b.querySelector('[name=levelRent]').value='100';
let parsed=w.eval(`parseBuildings(document.querySelector('#propertyForm'))`);assert.equal(parsed[0].perFloorSale,true);assert.equal(parsed[0].levels[0].salePrice,'88000');assert.equal(parsed[0].levels[0].rent,'100');
toggle.checked=false;assert.equal(w.eval(`parseBuildings(document.querySelector('#propertyForm'))`)[0].levels[0].salePrice,'88000');
const restored=w.document.createElement('div');restored.innerHTML=w.eval('buildingRow')(parsed[0]);assert(restored.querySelector('[name=perFloorSale]').checked);assert.equal(restored.querySelector('[name=levelSalePrice]').value,'88000');
w.testProperty={buildings:parsed};const offers=w.eval(`lmExpandFloorLeaseRow({original_data:{}},testProperty,'sale')`);assert.equal(offers.length,1);assert.equal(offers[0].original_data['매매가'],'88000');assert.equal(offers[0].original_data['층'],'226+227');
 for(const o of w.obs)o.disconnect();dom.window.close();console.log(file+': individual sale amount, toggle preservation, restore and sale offer passed');
}})().catch(e=>{console.error(e);process.exit(1)});
