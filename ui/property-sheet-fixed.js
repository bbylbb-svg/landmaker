/* Fixed layouts extracted from the supplied workbook; no customer data in this asset. */
(function(root){
'use strict';
const enc=new TextEncoder();
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships',pkg='http://schemas.openxmlformats.org/package/2006/relationships';
const xml=v=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const number=v=>v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;
const sum=(xs,key)=>xs.length&&xs.every(x=>number(x[key])!==null)?xs.reduce((a,x)=>a+Number(x[key]),0):null;
const date=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const base=typeof document==='undefined'?'':new URL('./templates/sale-fixed.json',document.currentScript?.src||document.baseURI).href;
let pending;
function load(){return pending||(pending=fetch(base).then(r=>{if(!r.ok)throw Error('고정 엑셀 양식을 불러오지 못했습니다. 새로고침 후 다시 열어주세요.');return r.json();}).catch(e=>{pending=null;throw e;}));}
function infer(p){return /토지/.test(p.propertyKind||'')?'land':/상가|사무실|지식산업|지산/.test(p.propertyKind||'')?'shop':/주택|아파트|빌라/.test(p.propertyKind||'')?'home':'factory';}
function smallUse(value){
 let text=String(value||'').trim();
 // Keep the recorded specific use; never infer one from a broad legal category.
 text=text.replace(/^(?:업무시설|판매시설|공장|창고시설)\s*[（(](.+)[）)]$/,'$1');
 text=text.replace(/제?\s*[12]\s*종\s*근린\s*생활\s*시설|제?\s*[12]\s*종\s*근생|근린\s*생활\s*시설/g,'');
 text=text.replace(/[（(]\s*[）)]/g,'').replace(/^[\s·:：/\-]+|[\s·:：/\-]+$/g,'').trim();
 if(/^[（(].*[）)]$/.test(text))text=text.slice(1,-1).trim();
 return text;
}
function plan(m,o,bundle){
 const key=o.template||infer(m.p),template=bundle.sheets[key];if(!template)throw Error('지원하지 않는 고정 양식입니다.');
 const p=m.p,parcels=m.parcels||[],rooms=p.unitRooms||[],shop=key==='shop';
 const floors=(p.buildings||[]).flatMap(b=>(b.levels?.length?b.levels:[{levelName:b.floors,levelUse:b.buildingUse,sqm:b.floorSqm}]).filter(l=>!b.perFloorSale||l.forSale).map(l=>({name:smallUse(l.levelUse||b.buildingUse),area:number(l.sqm),floor:l.levelName||''})));
 const left=shop?rooms.map(u=>({name:[u.address,u.dong,u.ho].filter(Boolean).join(' · '),area:number(u.exclusiveSqm)!==null&&number(u.commonSqm)!==null?Number(u.exclusiveSqm)+Number(u.commonSqm):null,detail:u.floor||''})):parcels.map(x=>({name:[x.san?'산':'',x.main].filter(Boolean).join(' ')+(x.sub?'-'+x.sub:''),area:number(x.sqm),detail:x.landUse||''}));
 const right=key==='land'?[]:shop?rooms.map(u=>({name:[u.dong,u.ho,smallUse(u.exclusiveUse||u.use)].filter(Boolean).join(' · '),area:number(u.exclusiveSqm),floor:u.floor||''})):floors;
 const total=Math.max(1,Math.ceil(Math.max(left.length,right.length)/9)),land=sum(left,'area'),building=sum(right,'area'),pages=[];
 const warnings=[];if(shop&&!rooms.length)warnings.push('등록된 동·호실이 없어 분양·전용면적은 빈칸입니다.');
 if(shop&&left.some(x=>x.area===null))warnings.push('전용·공용면적이 모두 입력된 호실만 분양면적을 계산합니다.');
 if(left.some(x=>x.area===null)||right.some(x=>x.area===null))warnings.push('면적 미입력 항목이 있어 해당 합계는 확정하지 않습니다.');
 for(let page=0;page<total;page++){
  const cells={},put=(ref,v,f)=>{cells[ref]={v:v??'',...(f?{f}: {})};};
  put('A1',(o.office||'광장공인중개사사무소')+' ('+(o.contact||'02-2060-5500 / 010-2382-5600')+')');
  const first=parcels[0];const representative=first?[first.dong,first.san?'산':'',first.main].filter(Boolean).join(' ')+(first.sub?'-'+first.sub:'')+(parcels.length>1?' 외 '+(parcels.length-1)+'필지':''):m.address;
  put('J1',p.propertyKind||'');put('B2',representative+(total>1?' ['+(page+1)+'/'+total+']':''));put('J2',number(p.salePrice));put('J3',parcels[0]?.dong||'');
  const sumRefs=col=>Array.from({length:total},(_,i)=>"'매매물건장"+(i+1)+"'!"+col+'5:'+col+'13').join(',');
  put('B3',land,left.length?'IF(COUNT('+sumRefs('B')+')='+left.length+',SUM('+sumRefs('B')+'),"")':null);put('C3',land===null?'':land/3.3058,'IF(ISNUMBER(B3),B3/3.3058,"")');put('J4',land===null?'':land/3.3058,'IF(ISNUMBER(C3),C3,"")');
  put('H2',number(p.salePrice)!==null&&land>0?Number(p.salePrice)/(land/3.3058):'','IF(AND(ISNUMBER(J2),ISNUMBER(J4),J4>0),J2/J4,"")');
  if(key!=='land'){put('F3',building,right.length?'IF(COUNT('+sumRefs('F')+')='+right.length+',SUM('+sumRefs('F')+'),"")':null);put('G3',building===null?'':building/3.3058,'IF(ISNUMBER(F3),F3/3.3058,"")');put('J5',building===null?'':building/3.3058,'IF(ISNUMBER(G3),G3,"")');}
  for(let i=0;i<9;i++){
   const row=i+5,l=left[page*9+i],r=right[page*9+i];
   put('A'+row,l?.name||'');put('B'+row,l?.area);put('C'+row,l?.area===null||!l?'':l.area/3.3058,'IF(ISNUMBER(B'+row+'),B'+row+'/3.3058,"")');put('D'+row,l?.detail||'');
   if(key!=='land'){put('E'+row,r?.name||'');put('F'+row,r?.area);put('G'+row,r?.area===null||!r?'':r.area/3.3058,'IF(ISNUMBER(F'+row+'),F'+row+'/3.3058,"")');put('H'+row,r?.floor||'');}
  }
  const approval=(p.buildings||[]).map(x=>x.approvalDate).filter(Boolean).join(' / ');
  if(key==='factory'){put('J6',p.hoist);put('J7',p.electricity);put('J8',number(p.deposit));put('J9',number(p.rent));put('J10',approval);}
  if(key==='land'){put('J5',[...new Set(parcels.map(x=>x.landUse).filter(Boolean))].join(' / '));put('J6',p.vehicle);put('J7',p.electricity);}
  if(key==='home'){put('J6',number(p.deposit));put('J7',number(p.rent));put('J8',approval);}
  if(key==='shop'){put('J6',p.electricity);put('J7',number(p.deposit));put('J8',number(p.rent));put('J9',approval);}
  put('J13',date());put('B14',o.memo||'');
  pages.push({cells,name:'매매물건장'+(page+1)});
 }
 return {template,bundle,pages,key,address:m.address,photo:o.photo||'',map:o.map||'',warnings};
}
function format(v,fmt){if(typeof v!=='number')return v??'';const decimals=/0\.00/.test(fmt)?2:/0\.0/.test(fmt)?1:0;return v.toLocaleString('ko-KR',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});}
function html(plan){
 const t=plan.template,width=t.widths.reduce((a,b)=>a+b,0),scale=718/width,covered=new Set(),merges={};
 for(const m of t.merges){merges[String.fromCharCode(64+m.c1)+m.r1]=m;for(let r=m.r1;r<=m.r2;r++)for(let c=m.c1;c<=m.c2;c++)if(r!==m.r1||c!==m.c1)covered.add(String.fromCharCode(64+c)+r);}
 const images=[plan.photo,plan.map].filter(Boolean);
 const pages=plan.pages.map(page=>'<main class="sheet"><table><colgroup>'+t.widths.map(w=>'<col style="width:'+w/width*100+'%">').join('')+'</colgroup><tbody>'+t.heights.map((height,i)=>'<tr style="height:'+height*4/3*scale+'px">'+Array.from({length:plan.columns||10},(_,j)=>{
  const ref=String.fromCharCode(65+j)+(i+1);if(covered.has(ref))return '';const cell=t.cells[ref]||{},merge=merges[ref],value=Object.hasOwn(page.cells,ref)?page.cells[ref].v:typeof cell.v==='string'&&cell.v.startsWith('=')?'':cell.v;
  const imageRegion=ref===(plan.photoCell||'A15')||!plan.clean&&plan.key==='land'&&ref==='E3';
  let content=xml(format(value,cell.fmt||''));
  if(imageRegion){const urls=!plan.clean&&ref==='E3'?[plan.photo].filter(Boolean):images;content='<div class="pictures">'+(urls.length?urls.map(url=>'<img src="'+xml(url)+'" alt="첨부 사진">').join(''):'<span>위치·항공사진 또는 매물 사진을 첨부하세요</span>')+'</div>';}
  const h=merge?t.heights.slice(merge.r1-1,merge.r2).reduce((a,b)=>a+b,0)*4/3*scale:height*4/3*scale;
  let style=(cell.css||'').replace(/font-size:([\d.]+)pt/,(_,size)=>'font-size:'+(Number(size)*4/3*scale)+'px');
  if(merge){const right=t.cells[String.fromCharCode(64+merge.c2)+merge.r1]?.css||'',bottom=t.cells[String.fromCharCode(64+merge.c1)+merge.r2]?.css||'';for(const [edge,css] of [['right',right],['bottom',bottom]]){const border=css.match(new RegExp('border-'+edge+':[^;]+'));if(border)style+=';'+border[0];}}
  const alignment=typeof value==='number'?'flex-end':/text-align:left/.test(style)?'flex-start':'center';
  return '<td '+(merge?'rowspan="'+(merge.r2-merge.r1+1)+'" colspan="'+(merge.c2-merge.c1+1)+'"':'')+' style="'+xml(style)+';height:'+h+'px" title="'+xml(format(value,cell.fmt||''))+'"><div class="cell" style="height:'+Math.max(0,h-2)+'px;justify-content:'+alignment+'">'+content+'</div></td>';
 }).join('')+'</tr>').join('')+'</tbody></table></main>').join('');
 return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>'+xml(plan.address)+' 매매 물건장</title><style>@page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{margin:0;background:#e9eff1;color:#111;font-family:"Malgun Gothic",sans-serif}.sheet{width:190mm;background:white;margin:12px auto;break-after:page}.sheet:last-child{break-after:auto}table{width:100%;border-collapse:collapse;table-layout:fixed}td{padding:0;overflow:hidden}.cell{display:flex;align-items:center;justify-content:center;overflow-wrap:anywhere;padding:0 2px;overflow:hidden;line-height:1.05}.pictures{height:100%;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;color:#708088;font-size:11px}.pictures img{width:100%;min-height:0;flex:1;object-fit:contain}.pictures span{padding:12px}@media print{body{background:white}.sheet{margin:0 auto}}</style></head><body>'+pages+'</body></html>';
}
function crc(data){let x=0xffffffff;for(const b of data){x^=b;for(let i=0;i<8;i++)x=(x>>>1)^((x&1)?0xedb88320:0);}return (x^0xffffffff)>>>0;}
function zip(files){const parts=[],central=[];let offset=0;const u16=(v,n,o)=>v.setUint16(o,n,true),u32=(v,n,o)=>v.setUint32(o,n,true);for(const [name,value] of files){const data=typeof value==='string'?enc.encode(value):value,n=enc.encode(name),checksum=crc(data),h=new Uint8Array(30+n.length),v=new DataView(h.buffer);u32(v,0x04034b50,0);u16(v,20,4);u16(v,0x800,6);u16(v,0x21,12);u32(v,checksum,14);u32(v,data.length,18);u32(v,data.length,22);u16(v,n.length,26);h.set(n,30);parts.push(h,data);const c=new Uint8Array(46+n.length),w=new DataView(c.buffer);u32(w,0x02014b50,0);u16(w,20,4);u16(w,20,6);u16(w,0x800,8);u16(w,0x21,14);u32(w,checksum,16);u32(w,data.length,20);u32(w,data.length,24);u16(w,n.length,28);u32(w,offset,42);c.set(n,46);central.push(c);offset+=h.length+data.length;}const len=central.reduce((a,b)=>a+b.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);u32(v,0x06054b50,0);u16(v,files.length,8);u16(v,files.length,10);u32(v,len,12);u32(v,offset,16);parts.push(...central,end);const out=new Uint8Array(offset+len+22);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
function build(plan,images=[]){
 const files=[['xl/styles.xml',plan.bundle.styles],['xl/theme/theme1.xml',plan.bundle.theme]],overrides=[],relationships=[],sheets=[],defined=[];
 for(const [i,page] of plan.pages.entries()){
  const id=i+1,doc=new root.DOMParser().parseFromString(plan.template.xml,'application/xml'),sheet=doc.documentElement;
  if(doc.getElementsByTagName('parsererror').length)throw Error('엑셀 원본 양식 해석 실패');
  const sheetData=doc.getElementsByTagNameNS(ns,'sheetData')[0];
  if(plan.clean){doc.getElementsByTagNameNS(ns,'dimension')[0]?.setAttribute('ref','A1:P37');const cols=doc.getElementsByTagNameNS(ns,'cols')[0],hidden=doc.createElementNS(ns,'col');hidden.setAttribute('min','13');hidden.setAttribute('max','16');hidden.setAttribute('hidden','1');hidden.setAttribute('width','10');cols.append(hidden);}
  for(const [ref,value] of Object.entries(page.cells)){
   let cell=[...doc.getElementsByTagNameNS(ns,'c')].find(x=>x.getAttribute('r')===ref);
   if(!cell){const rowNumber=ref.match(/\d+$/)[0];let row=[...sheetData.children].find(x=>x.getAttribute('r')===rowNumber);if(!row){row=doc.createElementNS(ns,'row');row.setAttribute('r',rowNumber);sheetData.append(row);}cell=doc.createElementNS(ns,'c');cell.setAttribute('r',ref);row.append(cell);}
   cell.replaceChildren();cell.removeAttribute('t');
   if(value.f){const f=doc.createElementNS(ns,'f');f.textContent=value.f;cell.append(f);}
   if(typeof value.v==='number'||value.f){if(typeof value.v!=='number')cell.setAttribute('t','str');const v=doc.createElementNS(ns,'v');v.textContent=String(value.v);cell.append(v);}
   else {cell.setAttribute('t','inlineStr');const is=doc.createElementNS(ns,'is'),t=doc.createElementNS(ns,'t');t.setAttribute('xml:space','preserve');t.textContent=String(value.v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');is.append(t);cell.append(is);}
  }
  // Keep cell order valid even when a previously empty template cell was populated.
  for(const row of sheetData.children){const cells=[...row.children].sort((a,b)=>a.getAttribute('r').localeCompare(b.getAttribute('r'),'en',{numeric:true}));row.replaceChildren(...cells);}
  let pr=doc.getElementsByTagNameNS(ns,'sheetPr')[0];if(!pr){pr=doc.createElementNS(ns,'sheetPr');sheet.prepend(pr);}for(const old of [...pr.getElementsByTagNameNS(ns,'pageSetUpPr')])old.remove();const fit=doc.createElementNS(ns,'pageSetUpPr');fit.setAttribute('fitToPage','1');pr.append(fit);
  const add=(name,attrs)=>{const e=doc.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);sheet.append(e);return e;};
  add('printOptions',{horizontalCentered:'1'});add('pageMargins',{left:'.2',right:'.2',top:'.2',bottom:'.2',header:'0',footer:'0'});add('pageSetup',{paperSize:'9',orientation:'portrait',fitToWidth:'1',fitToHeight:'1'});
  if(images.length){
   const drawing=add('drawing',{});drawing.setAttributeNS(rel,'r:id','rPhoto');
   files.push(['xl/worksheets/_rels/sheet'+id+'.xml.rels','<Relationships xmlns="'+pkg+'"><Relationship Id="rPhoto" Type="'+rel+'/drawing" Target="../drawings/drawing'+id+'.xml"/></Relationships>']);
   let anchors='',rels='';
   images.forEach((img,j)=>{const imageId=j+1;
    anchors+='<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>'+(img.left??0)+'</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>'+img.start+'</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>'+(img.right??10)+'</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>'+img.end+'</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="'+imageId+'" name="첨부사진 '+imageId+'"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId'+imageId+'"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>';
    rels+='<Relationship Id="rId'+imageId+'" Type="'+rel+'/image" Target="../media/image'+imageId+'.jpg"/>';
   });
   files.push(['xl/drawings/drawing'+id+'.xml','<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="'+rel+'">'+anchors+'</xdr:wsDr>'],['xl/drawings/_rels/drawing'+id+'.xml.rels','<Relationships xmlns="'+pkg+'">'+rels+'</Relationships>']);
   overrides.push('<Override PartName="/xl/drawings/drawing'+id+'.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>');
  }
  files.push(['xl/worksheets/sheet'+id+'.xml',new root.XMLSerializer().serializeToString(doc)]);
  sheets.push('<sheet name="'+page.name+'" sheetId="'+id+'" r:id="rId'+id+'"/>');defined.push('<definedName name="_xlnm.Print_Area" localSheetId="'+i+'">\''+page.name+'\'!$A$1:$'+String.fromCharCode(64+(plan.columns||10))+'$'+(plan.printRows||33)+'</definedName>');
  relationships.push('<Relationship Id="rId'+id+'" Type="'+rel+'/worksheet" Target="worksheets/sheet'+id+'.xml"/>');overrides.push('<Override PartName="/xl/worksheets/sheet'+id+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
 }
 images.forEach((img,j)=>files.push(['xl/media/image'+(j+1)+'.jpg',img.bytes]));
 relationships.push('<Relationship Id="rStyles" Type="'+rel+'/styles" Target="styles.xml"/>','<Relationship Id="rTheme" Type="'+rel+'/theme" Target="theme/theme1.xml"/>');
 files.push(['xl/workbook.xml','<workbook xmlns="'+ns+'" xmlns:r="'+rel+'"><bookViews><workbookView activeTab="0"/></bookViews><sheets>'+sheets.join('')+'</sheets><definedNames>'+defined.join('')+'</definedNames><calcPr calcMode="auto" fullCalcOnLoad="1"/></workbook>'],['xl/_rels/workbook.xml.rels','<Relationships xmlns="'+pkg+'">'+relationships.join('')+'</Relationships>'],['_rels/.rels','<Relationships xmlns="'+pkg+'"><Relationship Id="rId1" Type="'+rel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'],['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'+overrides.join('')+'</Types>']);
 return zip(files);
}
async function download(plan){
 const urls=[plan.photo,plan.map].filter(Boolean),images=[];
 const regions=urls.map((url,i)=>({url,start:(plan.photoStart??14)+Math.floor(((plan.photoEnd??33)-(plan.photoStart??14))*i/urls.length),end:(plan.photoStart??14)+Math.floor(((plan.photoEnd??33)-(plan.photoStart??14))*(i+1)/urls.length),left:0,right:plan.columns||10}));
 if(!plan.clean&&plan.key==='land'&&plan.photo)regions.push({url:plan.photo,start:2,end:13,left:4,right:8});
 for(const {url,start,end,left,right} of regions){
  if(!url.startsWith('blob:'))throw Error('현재 창에서 불러온 사진만 엑셀에 첨부할 수 있습니다.');
  const r=await fetch(url);if(!r.ok)throw Error('첨부 사진 읽기 실패');const bitmap=await createImageBitmap(await r.blob());
  const canvas=document.createElement('canvas');
  canvas.width=1400;canvas.height=Math.round(1400*plan.template.heights.slice(start,end).reduce((a,b)=>a+b,0)*4/3/plan.template.widths.slice(left,right).reduce((a,b)=>a+b,0));
  const ctx=canvas.getContext('2d');if(!ctx){bitmap.close();throw Error('사진 변환을 지원하지 않습니다.');}ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  const ratio=Math.min(canvas.width/bitmap.width,canvas.height/bitmap.height),w=bitmap.width*ratio,h=bitmap.height*ratio;ctx.drawImage(bitmap,(canvas.width-w)/2,(canvas.height-h)/2,w,h);bitmap.close();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!blob)throw Error('엑셀 사진 변환 실패');images.push({start,end,left,right,bytes:new Uint8Array(await blob.arrayBuffer())});
 }
 const bytes=build(plan,images),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=plan.address.replace(/[\\/:*?"<>|]/g,'_').slice(0,80)+'_매매물건장.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
root.LMFixedSheet={load,infer,smallUse,plan,html,build,download};if(typeof module!=='undefined')module.exports=root.LMFixedSheet;
})(typeof window==='undefined'?globalThis:window);
