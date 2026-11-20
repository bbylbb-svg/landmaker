const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const file of ['index.html','offline-test/index.html'])test(file+': sale owners become consultable customers without merging names or overwriting existing customers',()=>{
 const source=fs.readFileSync(file,'utf8'),start=source.indexOf('function lmSyncSaleOwnerCustomers('),end=source.indexOf('function lmPrepareOwnerSave(',start);
 const existing={id:'existing',personCode:'P-known',name:'기존 고객',phone:'010-0000-0001',category:'매수'},db={customers:[existing],records:[{id:'r',customerId:'existing',content:'기존 상담'}]};let n=0;
 const context={db,newPersonCode:()=>`P-new-${++n}`};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 const p={id:'property',type:'매매·임대',staff:'이보배',landOwners:[{personCode:'P-known',name:'변경 이름',phone:'different'},{personCode:'P-coowner',name:'공동 소유주'}],buildingOwners:[{personCode:'P-known',name:'변경 이름'}]};
 assert.equal(context.lmSyncSaleOwnerCustomers(p).length,2);assert.equal(db.customers.length,2);assert.equal(existing.category,'매수');assert.equal(existing.phone,'010-0000-0001');assert.equal(existing.name,'기존 고객');assert.equal(db.records[0].content,'기존 상담');assert.equal(p.landOwners[0].customerId,'existing');assert.equal(p.buildingOwners[0].customerId,'existing');assert.equal(db.customers[1].category,'소유주');
 context.lmSyncSaleOwnerCustomers(p);assert.equal(db.customers.length,2);
 const sameName={type:'매매',landOwners:[{name:'기존 고객'}]};context.lmSyncSaleOwnerCustomers(sameName);assert.equal(db.customers.length,3);assert.notEqual(sameName.landOwners[0].customerId,'existing');
 context.lmSyncSaleOwnerCustomers({type:'임대',landOwners:[{name:'임대만'}]});assert.equal(db.customers.length,3);
 db.customers.push({...existing,id:'duplicate'});const ambiguous={type:'매매',landOwners:[{personCode:'P-known',name:'기존 고객',customerId:'stale'}]};assert.equal(context.lmSyncSaleOwnerCustomers(ambiguous).length,0);assert.equal(ambiguous.landOwners[0].customerId,undefined);assert.equal(db.customers.length,4);
 assert.ok(source.includes('if(submittedForm?._ownerProperty)lmSyncSaleOwnerCustomers(submittedForm._ownerProperty)'));
 assert.ok(source.includes('고객 상세 · 상담 입력'));assert.ok(source.includes('연결 매물 · 소유 매물'));
});
