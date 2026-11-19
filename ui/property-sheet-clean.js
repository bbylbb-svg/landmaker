(function(root){'use strict';
const base=typeof document==='undefined'?'':new URL('./templates/sale-clean.json?v=20261119a',document.currentScript?.src||document.baseURI).href;let pending;
function load(){return pending||(pending=fetch(base).then(r=>{if(!r.ok)throw Error('새 물건장 양식을 불러오지 못했습니다.');return r.json();}).catch(e=>{pending=null;throw e;}));}
function plan(m,o,bundle){
 const out=root.LMFixedSheet.plan(m,o,bundle),area=(sqm,py)=>typeof sqm==='number'?sqm.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2})+'㎡\n'+py.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2})+'평':'미입력';
 const refs=f=>f?.replace(/B5:B13/g,'E8:E16').replace(/F5:F13/g,'K8:K16');
 out.pages=out.pages.map((page,pi)=>{
  const old=page.cells,cells={},put=(ref,v,f)=>{cells[ref]={v:v??'',...(f?{f}:{})};},copy=(to,from)=>{if(old[from])cells[to]={...old[from]};};
  put('A1',o.office||'광장공인중개사사무소');put('I1',o.contact||'02-2060-5500 / 010-2382-5600');copy('A2','B2');put('J2',(m.p.propertyKind||'종류 미입력')+' · 매매');copy('A4','J2');
  put('M1',old.B3.v,refs(old.B3.f));put('N1',old.C3.v,'IF(ISNUMBER(M1),M1/3.3058,"")');
  put('O1',old.F3?.v??'',refs(old.F3?.f));put('P1',old.G3?.v??'','IF(ISNUMBER(O1),O1/3.3058,"")');
  put('D4',area(old.B3.v,old.C3.v),'IF(ISNUMBER(M1),TEXT(M1,"#,##0.00")&"㎡"&CHAR(10)&TEXT(N1,"#,##0.00")&"평","미입력")');
  put('G4',out.key==='land'?'해당 없음':area(old.F3?.v,old.G3?.v),out.key==='land'?null:'IF(ISNUMBER(O1),TEXT(O1,"#,##0.00")&"㎡"&CHAR(10)&TEXT(P1,"#,##0.00")&"평","미입력")');
  put('J4',old.H2.v,'IF(AND(ISNUMBER(A4),ISNUMBER(N1),N1>0),A4/N1,"")');
  for(let i=0;i<9;i++){
   const before=i+5,after=i+8;copy('A'+after,'A'+before);copy('D'+after,'D'+before);copy('E'+after,'B'+before);put('F'+after,old['C'+before].v,'IF(ISNUMBER(E'+after+'),E'+after+'/3.3058,"")');
   if(out.key==='shop'){const u=m.p.unitRooms?.[pi*9+i];put('A'+after,u?[u.dong||u.buildingName,u.ho].filter(Boolean).join(' '):'');}
   if(out.key!=='land'){copy('G'+after,'E'+before);copy('J'+after,'H'+before);copy('K'+after,'F'+before);put('L'+after,old['G'+before].v,'IF(ISNUMBER(K'+after+'),K'+after+'/3.3058,"")');}
  }
  if(out.key==='land'){put('G8','지목');copy('J8','J5');put('G9','진입차량');copy('J9','J6');put('G10','전기 (kW)');copy('J10','J7');}
  put('C18',m.p.hoist||'');put('G18',m.p.electricity||'');put('K18',(m.p.buildings||[]).map(b=>b.approvalDate).filter(Boolean).join(' / '));put('C19',m.p.deposit!==''&&m.p.deposit!=null&&Number.isFinite(Number(m.p.deposit))?Number(m.p.deposit):'');put('G19',m.p.rent!==''&&m.p.rent!=null&&Number.isFinite(Number(m.p.rent))?Number(m.p.rent):'');copy('K19','J13');copy('A21','B14');
  return {...page,cells};
 });
 return {...out,clean:true,columns:12,printRows:37,photoCell:'A24',photoStart:23,photoEnd:37};
}
root.LMCleanSheet={load,plan};if(typeof module!=='undefined')module.exports=root.LMCleanSheet;
})(typeof window==='undefined'?globalThis:window);
