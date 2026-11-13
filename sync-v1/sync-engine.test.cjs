const assert=require('node:assert/strict');
const E=require('./sync-engine.js');
const base={customers:[{id:'c',name:'original',phone:'000'}],properties:[],records:[],customerCompletionOverrides:{},customerCategoryOverrides:{}};
const local=E.clone(base);local.customers[0].name='changed';local.properties.push({id:'p',title:'new'});local.customerCategoryOverrides.c={category:'매수'};
const serialized=JSON.stringify(base),changes=E.diff(base,local),materialized=E.clone(base);changes.forEach(c=>E.apply(materialized,c));
assert.equal(changes.length,3);assert(E.equal(local,materialized));assert.equal(JSON.stringify(base),serialized);
assert.deepEqual(E.merge({name:'old',phone:'000'},{name:'new',phone:'000'},{name:'old',phone:'111'}),{value:{name:'new',phone:'111'},conflicts:[]});
assert.equal(E.merge({name:'old'},{name:'a'},{name:'b'}).conflicts.length,1);
assert.equal(E.merge({name:'old'},null,{name:'new'}).conflicts.length,1);
assert.equal(E.merge(null,{id:'same',name:'a'},{id:'same',name:'b'}).conflicts.length,1);
assert.throws(()=>E.diff(base,{...base,customers:[{id:'c'},{id:'c'}]}));
assert(E.equal({b:1,a:2},{a:2,b:1}));
for(let i=0;i<100;i++){const b={nested:{a:i,b:i}},l=E.clone(b),r=E.clone(b);l.nested.a++;r.nested.b++;const merged=E.merge(b,l,r);assert.equal(merged.conflicts.length,0);assert.deepEqual(merged.value,{nested:{a:i+1,b:i+1}})}
console.log('Passed: per-record diff, immutable source, map changes, independent fields, nested merges, conflicting updates, delete/update, identity collisions.');
// Exercise the actual archive adapter, including the stale-editor baseline.
const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/sync-adapter.js','utf8');
const wrapper=source.slice(source.indexOf('const lmSyncArchiveBases='),source.indexOf('async function lmSyncPull()'));
const original={import_row_id:'row',customer_name:'old',phone:'000'},requests=[];
const context={archiveAPI:null,lmSyncEngine:E,navigator:{onLine:true},lmOfflineTest:()=>false,lmArchiveNetwork:async()=>[E.clone(original)],lmSyncRows:async()=>[],lmLocalRead:async()=>({archives:{tables:{}}}),lmSyncLocalTableSave:async(table,before,after)=>requests.push({table,before,after}),lmSyncFlush:async()=>{},crypto:require('node:crypto').webcrypto};
vm.createContext(context);vm.runInContext(wrapper,context);
(async()=>{
 await context.archiveAPI('lm_access_customer_profiles',{select:'*',import_row_id:'eq.row'});
 original.phone='REMOTE';
 await context.archiveAPI('lm_access_customer_profiles',{},'POST',{import_row_id:'row',customer_name:'local',phone:'000'});
 assert.equal(requests[0].before.phone,'000','Editor baseline must not advance to remote values at save time');
 assert.equal(E.merge(requests[0].before,requests[0].after,original).value.phone,'REMOTE');
 assert.equal(E.merge(requests[0].before,requests[0].after,original).value.customer_name,'local');
 console.log('Passed: actual archive wrapper preserves read-time base and avoids stale-form overwrites.');
})().catch(error=>{console.error(error);process.exitCode=1});
