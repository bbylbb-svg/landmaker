const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const outputDir=fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'lm-fixed-template-'));after(()=>fs.rmSync(outputDir,{recursive:true,force:true}));
const dom=new JSDOM('');global.DOMParser=dom.window.DOMParser;global.XMLSerializer=dom.window.XMLSerializer;
const fixed=require('../ui/property-sheet-fixed.js'),{model}=require('../ui/property-sheet.js'),bundle=JSON.parse(fs.readFileSync('ui/templates/sale-fixed.json'));
const property={id:'fixture-only',propertyKind:'공장',salePrice:'350000',deposit:8700,rent:870,parcels:[{dong:'계수동',main:'243',sub:'6',landUse:'목장용지',sqm:1404},{dong:'계수동',main:'243',sub:'2',landUse:'목장용지',sqm:301}],buildings:[{buildingName:'가동',relatedLots:'243-2',approvalDate:'2022-05-10',levels:[{levelName:'1층',levelUse:'축사',sqm:352.8},{levelName:'1층',levelUse:'농수산물창고',sqm:313.06},{levelName:'1층',levelUse:'퇴비사',sqm:84}]}]};
test('specific building use excludes broad legal category and template keeps original font sizes',()=>{
 assert.equal(fixed.smallUse('제2종근린생활시설(제조업소)'),'제조업소');assert.equal(fixed.smallUse('제1종 근린생활시설(소매점)'),'소매점');assert.equal(fixed.smallUse('제2종근린생활시설'),'');assert.equal(fixed.smallUse('창고'),'창고');
 const p={...property,buildings:[{levels:[{levelUse:'제2종근린생활시설(제조업소)',sqm:50}]}]};const output=fixed.plan(model(p,'sale'),{},bundle);assert.equal(output.pages[0].cells.E5.v,'제조업소');assert.equal(p.buildings[0].levels[0].levelUse,'제2종근린생활시설(제조업소)');
 for(const [ref,size] of [['A1',20],['B2',11],['J2',12]])assert.ok(bundle.sheets.factory.cells[ref].css.includes('font-size:'+size+'.0pt'));
});
test('factory: provided cell layout, calculated totals, blank missing values and escaped user data',()=>{
 const p=fixed.plan(model(property,'sale'),{memo:'=HYPERLINK("bad") <script>'},bundle);
 assert.equal(p.pages[0].cells.B3.v,1705);assert.equal(p.pages[0].cells.F3.v,749.86);assert.equal(p.pages[0].cells.J1.v,'공장');assert.equal(p.pages[0].cells.J8.v,8700);assert.equal(p.pages[0].cells.E5.v,'축사');assert.equal(p.pages[0].cells.J6.v,'');
 const html=fixed.html(p);assert.ok(html.includes('colspan="8"'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('필지별 현황'));assert.ok(!html.includes('매물번호'));
 fs.writeFileSync(outputDir+'/factory.xlsx',fixed.build(p));fs.writeFileSync(outputDir+'/factory.html',html);
});
test('continuation: all rows retained, totals reference every page and selected per-floor sale only',()=>{
 const p={...property,parcels:Array.from({length:20},(_,i)=>({dong:'테스트동',main:String(i+1),sqm:10})),buildings:[{perFloorSale:true,levels:[{forSale:true,sqm:12},{forSale:false,sqm:100}]}]};
 const out=fixed.plan(model(p,'sale'),{},bundle);assert.equal(out.pages.length,3);assert.equal(out.pages[2].cells.A6.v,'20');assert.equal(out.pages[0].cells.B3.v,200);assert.equal(out.pages[0].cells.F3.v,12);assert.ok(out.pages[0].cells.B3.f.includes("'매매물건장3'!B5:B13"));fs.writeFileSync(outputDir+'/continuation.xlsx',fixed.build(out));
});
test('land and shop use their own original merges and field mappings; unknown shop sale area never uses land area',()=>{
 const land=fixed.plan(model({...property,propertyKind:'토지'},'sale'),{},bundle);assert.equal(land.key,'land');assert.ok(land.template.merges.some(x=>x.c1===5&&x.r1===3&&x.r2===13));assert.equal(land.pages[0].cells.J5.v,'목장용지');assert.equal(land.pages[0].cells.F3,undefined);fs.writeFileSync(outputDir+'/land.xlsx',fixed.build(land));
 const shop=fixed.plan(model({...property,propertyKind:'상가',unitRooms:[{ho:'101호',exclusiveSqm:60,commonSqm:20,floor:'1층'},{ho:'102호',exclusiveSqm:40,floor:'1층'}]},'sale'),{},bundle);assert.equal(shop.key,'shop');assert.equal(shop.pages[0].cells.B3.v,'');assert.equal(shop.pages[0].cells.F3.v,100);assert.equal(shop.pages[0].cells.B6.v,'');assert.ok(shop.warnings.length);fs.writeFileSync(outputDir+'/shop.xlsx',fixed.build(shop));
});
test('image relationships, template styling and area range retained in a real OOXML zip',()=>{
 const p=fixed.plan(model(property,'sale'),{},bundle);const jpg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAAB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==','base64');fs.writeFileSync(outputDir+'/images.xlsx',fixed.build(p,[{start:14,end:23,bytes:jpg},{start:23,end:33,bytes:jpg}]));
});
test('actual property dialog uses the provided sale layout, switches type and exports current controls',async()=>{
 const browser=new JSDOM('<body></body>',{url:'https://example.test/landmaker/',runScripts:'outside-only'}),w=browser.window;
 w.TextEncoder=TextEncoder;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.eval('var db='+JSON.stringify({properties:[{...property,type:'매매'}]})+';');w.eval(fs.readFileSync('ui/property-sheet-fixed.js','utf8'));w.LMFixedSheet.load=async()=>bundle;w.eval(fs.readFileSync('ui/property-sheet-clean.js','utf8'));w.LMCleanSheet.load=async()=>JSON.parse(fs.readFileSync('ui/templates/sale-clean.json'));let exported;w.LMFixedSheet.download=async p=>{exported=p;};w.eval(fs.readFileSync('ui/property-sheet.js','utf8'));
 await w.LMPropertySheet.launch(property.id);const d=w.document.querySelector('dialog');assert.ok(d);assert.equal(d.querySelector('[data-layout]').value,'clean');d.querySelector('[data-layout]').value='original';d.querySelector('[data-layout]').dispatchEvent(new w.Event('change'));assert.ok(d.querySelector('iframe').srcdoc.includes('대표번지'));assert.ok(!d.querySelector('iframe').srcdoc.includes('필지별 현황'));d.querySelector('[data-template]').value='land';d.querySelector('[data-template]').dispatchEvent(new w.Event('change'));assert.ok(d.querySelector('iframe').srcdoc.includes('rowspan="11"'));d.querySelector('[data-memo]').value='현장 방문 전 연락';await d.querySelector('[data-excel]').onclick();assert.equal(exported.key,'land');assert.equal(exported.pages[0].cells.B14.v,'현장 방문 전 연락');d.close();w.close();
});
