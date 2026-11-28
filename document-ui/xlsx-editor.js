/* Private XLSX value editor. ZIP parts are retained; formulas and protected sheets are read-only. */
(function(root){
'use strict';
const enc=new TextEncoder(),dec=new TextDecoder();
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main',REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAX=30*1024*1024,EXPANDED=96*1024*1024;
const elements=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
const parse=text=>{if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('외부 엔터티가 포함된 문서는 열 수 없습니다.');const d=new root.DOMParser().parseFromString(text,'application/xml');if(elements(d,'parsererror').length)throw Error('엑셀 XML을 읽을 수 없습니다.');return d;};
const serialize=d=>new root.XMLSerializer().serializeToString(d);
const colName=n=>{let out='';for(n++;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
function point(ref){const m=/^([A-Z]{1,3})([1-9]\d{0,6})$/i.exec(ref);if(!m)throw Error('셀 주소를 확인하세요. 예: A1');const col=[...m[1].toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1,row=Number(m[2])-1;if(col>16383||row>1048575)throw Error('엑셀 셀 범위를 벗어났습니다.');return {col,row,ref:colName(col)+(row+1)};}
function resolve(base,target){if(/^[a-z]+:/i.test(target)||target.includes('\\'))throw Error('외부 파일 경로는 열지 않습니다.');const path=target.startsWith('/')?target.slice(1):base.slice(0,base.lastIndexOf('/')+1)+target,out=[];for(const part of path.split('/')){if(part==='..'){if(!out.length)throw Error('잘못된 엑셀 경로');out.pop();}else if(part&&part!=='.')out.push(part);}return out.join('/');}
async function unzip(buffer){
 const bytes=new Uint8Array(buffer);if(bytes.length>MAX)throw Error('편집은 30MB 이하 XLSX 파일만 지원합니다.');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let n=bytes.length-22;n>=Math.max(0,bytes.length-65557);n--)if(view.getUint32(n,true)===0x06054b50&&n+22+view.getUint16(n+20,true)===bytes.length){end=n;break;}
 if(end<0)throw Error('암호화되었거나 올바른 XLSX 파일이 아닙니다.');
 const count=view.getUint16(end+10,true),entries=new Map();let at=view.getUint32(end+16,true),total=0;if(count>10000||count===65535)throw Error('파일 구성이 너무 크거나 ZIP64 형식입니다.');
 for(let i=0;i<count;i++){
  if(at+46>bytes.length||view.getUint32(at,true)!==0x02014b50)throw Error('엑셀 ZIP 목록 손상');
  const flags=view.getUint16(at+8,true),method=view.getUint16(at+10,true),checksum=view.getUint32(at+16,true),packed=view.getUint32(at+20,true),length=view.getUint32(at+24,true),nameLength=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true),offset=view.getUint32(at+42,true),name=dec.decode(bytes.slice(at+46,at+46+nameLength));
  if(flags&1)throw Error('암호가 걸린 엑셀은 편집할 수 없습니다.');if(name.startsWith('/')||name.split('/').includes('..')||name.includes('\\')||entries.has(name))throw Error('잘못된 엑셀 내부 경로');
  if(total+length>EXPANDED)throw Error('압축을 푼 문서가 편집 한도 96MB를 넘습니다.');
  if(offset+30>bytes.length||view.getUint32(offset,true)!==0x04034b50)throw Error('엑셀 ZIP 자료 손상');
  const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);if(start+packed>bytes.length)throw Error('엑셀 압축 자료가 잘렸습니다.');let data=bytes.slice(start,start+packed);
  if(method===8){
   let stream;try{stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw Error('현재 브라우저는 엑셀 압축 해제를 지원하지 않습니다. 최신 크롬·웨일에서 열어주세요.');}
   const reader=stream.getReader(),chunks=[];let size=0;for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>length||total+size>EXPANDED){await reader.cancel();throw Error('문서 압축 해제 한도를 초과했습니다.');}chunks.push(part.value);}data=new Uint8Array(size);let pos=0;for(const part of chunks){data.set(part,pos);pos+=part.length;}
  }else if(method!==0)throw Error('지원하지 않는 압축 형식입니다.');
  if(data.length!==length||crc(data)!==checksum)throw Error('문서 내용 확인에 실패했습니다. 손상된 파일일 수 있습니다.');
  entries.set(name,data);total+=data.length;at+=46+nameLength+extra+comment;
 }
 return entries;
}
function relationships(entries,part){const relPath=part.slice(0,part.lastIndexOf('/')+1)+'_rels/'+part.slice(part.lastIndexOf('/')+1)+'.rels',data=entries.get(relPath);return data?elements(parse(dec.decode(data)),'Relationship').filter(x=>x.getAttribute('TargetMode')!=='External').map(x=>({id:x.getAttribute('Id'),type:x.getAttribute('Type'),path:resolve(part,x.getAttribute('Target'))})):[];}
function valueOf(cell,strings){const type=cell.getAttribute('t'),v=elements(cell,'v')[0]?.textContent??'';return type==='s'?strings[Number(v)]??'':type==='inlineStr'?elements(cell,'t').map(x=>x.textContent).join(''):type==='b'?v==='1'?'TRUE':'FALSE':v;}
async function open(buffer){
 const entries=await unzip(buffer);if(entries.has('xl/vbaProject.bin')||[...entries.keys()].some(k=>k.startsWith('_xmlsignatures/')))throw Error('매크로 또는 전자서명 문서는 직접 편집하지 않습니다. 원본을 다운로드해 수정하세요.');
 const workbookPath=relationships(entries,'').find(r=>r.type.endsWith('/officeDocument'))?.path||'xl/workbook.xml';
 if(!entries.has(workbookPath))throw Error('워크북 정보를 찾을 수 없습니다.');const workbook=parse(dec.decode(entries.get(workbookPath))),rels=relationships(entries,workbookPath);
 const stringsPart=rels.find(r=>r.type.endsWith('/sharedStrings'))?.path,strings=stringsPart&&entries.has(stringsPart)?elements(parse(dec.decode(entries.get(stringsPart))),'si').map(si=>elements(si,'t').map(x=>x.textContent).join('')):[];
 const sheets=elements(workbook,'sheet').map(s=>({name:s.getAttribute('name'),path:rels.find(r=>r.id===s.getAttributeNS(REL,'id'))?.path})).filter(s=>s.path&&entries.has(s.path));if(!sheets.length)throw Error('편집할 시트가 없습니다.');
 const stylesPath=rels.find(r=>r.type.endsWith('/styles'))?.path,styles=stylesPath&&entries.has(stylesPath)?parse(dec.decode(entries.get(stylesPath))):null;
 return {entries,workbookPath,workbook,sheets,strings,styles,changes:new Map(),cache:new Map(),dirty:false};
}
function sheetData(book,index){
 if(book.cache.has(index))return book.cache.get(index);const sheet=book.sheets[index],doc=parse(dec.decode(book.entries.get(sheet.path))),cells=new Map();let maxRow=32,maxCol=9;
 for(const cell of elements(doc,'c')){const ref=cell.getAttribute('r');if(!ref)continue;let p;try{p=point(ref);}catch{continue;}const value=valueOf(cell,book.strings),formula=elements(cell,'f')[0];cells.set(p.ref,{value,formula:formula?(formula.textContent||'[공유수식]'):undefined,style:Number(cell.getAttribute('s')||0),type:cell.getAttribute('t')||'n'});if(value!==''||formula){maxRow=Math.max(maxRow,p.row);maxCol=Math.max(maxCol,p.col);}}
 if(cells.size>150000)throw Error('셀 수가 많아 브라우저 편집을 지원하지 않습니다. 엑셀에서 열어주세요.');
 const merges=elements(doc,'mergeCell').map(x=>{const [a,b]=x.getAttribute('ref').split(':');return {a:point(a),b:point(b||a)};});
 const arrayRanges=elements(doc,'f').filter(f=>f.hasAttribute('ref')).map(f=>{const [a,b]=f.getAttribute('ref').split(':');return {a:point(a),b:point(b||a)};});
 const format=elements(doc,'sheetFormatPr')[0];
 const data={sheet,doc,cells,merges,arrayRanges,maxRow,maxCol,defaultHeight:Number(format?.getAttribute('defaultRowHeight'))||15,defaultWidth:Number(format?.getAttribute('defaultColWidth'))||8.43,protected:elements(doc,'sheetProtection').length>0,cols:elements(doc,'col'),rows:new Map(elements(doc,'row').map(x=>[Number(x.getAttribute('r'))-1,Number(x.getAttribute('ht'))||Number(format?.getAttribute('defaultRowHeight'))||15]))};book.cache.set(index,data);return data;
}
function cellAt(book,index,ref){const s=sheetData(book,index),p=point(ref),merge=s.merges.find(m=>p.row>=m.a.row&&p.row<=m.b.row&&p.col>=m.a.col&&p.col<=m.b.col),canonical=merge?merge.a.ref:p.ref,cell=s.cells.get(canonical)||{value:'',type:'n',style:0},change=book.changes.get(s.sheet.path+'!'+canonical);return {...cell,...(change?{value:change.value,type:change.type}:{}),ref:canonical,readonly:s.protected||!!cell.formula||s.arrayRanges.some(m=>p.row>=m.a.row&&p.row<=m.b.row&&p.col>=m.a.col&&p.col<=m.b.col)};}
function edit(book,index,ref,value,type='auto'){
 const cell=cellAt(book,index,ref);if(cell.readonly)throw Error('수식 셀·배열 수식 영역·보호 시트는 편집하지 않습니다.');let stored=String(value),kind='inlineStr';
 const numeric=/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(stored.trim());
 if(type==='number'&&!numeric&&stored!=='')throw Error('숫자 형식으로 입력하세요. 쉼표 없이 입력합니다.');
 if(stored!==''&&(type==='number'||type==='auto'&&cell.type!=='s'&&cell.type!=='inlineStr'&&numeric&&!/^0\d/.test(stored.trim()))){const n=Number(stored);if(!Number.isFinite(n))throw Error('유효한 숫자를 입력하세요.');stored=String(n);kind='n';}
 const data=sheetData(book,index);book.changes.set(data.sheet.path+'!'+cell.ref,{ref:cell.ref,value:stored,type:kind});data.maxRow=Math.max(data.maxRow,point(cell.ref).row);data.maxCol=Math.max(data.maxCol,point(cell.ref).col);book.dirty=true;return stored;
}
function pack(book){
 const entries=new Map(book.entries),docs=new Map();
 for(const [key,change] of book.changes){const split=key.lastIndexOf('!'),path=key.slice(0,split);let doc=docs.get(path);if(!doc){doc=parse(dec.decode(entries.get(path)));docs.set(path,doc);}let cell=elements(doc,'c').find(c=>c.getAttribute('r')===change.ref);
  if(!cell){const p=point(change.ref),data=elements(doc,'sheetData')[0];let row=elements(data,'row').find(r=>Number(r.getAttribute('r'))===p.row+1);if(!row){row=doc.createElementNS(NS,'row');row.setAttribute('r',p.row+1);data.append(row);const rows=[...data.children].sort((a,b)=>Number(a.getAttribute('r'))-Number(b.getAttribute('r')));data.replaceChildren(...rows);}cell=doc.createElementNS(NS,'c');cell.setAttribute('r',change.ref);row.append(cell);row.replaceChildren(...[...row.children].sort((a,b)=>point(a.getAttribute('r')).col-point(b.getAttribute('r')).col));}
  for(const child of [...cell.children])if(['v','is','f'].includes(child.localName))child.remove();cell.setAttribute('t',change.type);
  if(change.type==='n'){const v=doc.createElementNS(NS,'v');v.textContent=change.value;cell.append(v);}else{const is=doc.createElementNS(NS,'is'),t=doc.createElementNS(NS,'t');t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=change.value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');is.append(t);cell.append(is);}
  const dim=elements(doc,'dimension')[0];if(dim){const current=point((dim.getAttribute('ref')||'A1').split(':').pop()),p=point(change.ref);dim.setAttribute('ref','A1:'+colName(Math.max(current.col,p.col))+(Math.max(current.row,p.row)+1));}
 }
 if(book.changes.size){
  // Recalculate in Excel rather than writing misleading cached formula results.
  for(const s of book.sheets){const doc=docs.get(s.path)||parse(dec.decode(entries.get(s.path)));let altered=docs.has(s.path);for(const f of elements(doc,'f')){const c=f.parentElement;for(const v of [...c.children])if(v.localName==='v'||v.localName==='is')v.remove();c.removeAttribute('t');altered=true;}if(altered)docs.set(s.path,doc);}
  const w=parse(dec.decode(entries.get(book.workbookPath)));let calc=elements(w,'calcPr')[0];if(!calc){calc=w.createElementNS(NS,'calcPr');w.documentElement.append(calc);}calc.setAttribute('calcMode','auto');calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');entries.set(book.workbookPath,enc.encode(serialize(w)));
  for(const [path,bytes] of [...entries])if(path.endsWith('.rels')||path==='[Content_Types].xml'){const doc=parse(dec.decode(bytes));let altered=false;for(const e of [...doc.documentElement.children])if((e.getAttribute('Type')||'').endsWith('/calcChain')||(e.getAttribute('PartName')||'').endsWith('/calcChain.xml')){e.remove();altered=true;}if(altered)entries.set(path,enc.encode(serialize(doc)));}
  for(const path of [...entries.keys()])if(path.endsWith('/calcChain.xml'))entries.delete(path);
 }
 for(const [path,doc] of docs)entries.set(path,enc.encode(serialize(doc)));
 const out=zip([...entries]);if(out.length>MAX)throw Error('수정본이 30MB를 넘습니다. 이 파일은 PC 엑셀에서 수정해 주세요. 원본은 유지됩니다.');return out;
}
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function edgeStyle(book,index,edge){
 const styles=book.styles;
 if(!styles)return '';
 const xf=elements(styles,'cellXfs')[0]?.children[index];
 const border=elements(styles,'borders')[0]?.children[Number(xf?.getAttribute('borderId')||0)];
 const side=border&&elements(border,edge)[0],kind=side?.getAttribute('style');
 if(!kind||kind==='none')return '';
 const rgb=elements(side,'color')[0]?.getAttribute('rgb');
 const color=/^[\da-f]{8}$/i.test(rgb||'')?'#'+rgb.slice(-6):'#222';
 const line=kind==='double'?'3px double':/dash/i.test(kind)?'1px dashed':kind==='dotted'?'1px dotted':kind==='thick'?'3px solid':/medium/i.test(kind)?'2px solid':'1px solid';
 return 'border-'+edge+':'+line+' '+color+';';
}
function styleOf(book,index){
 const d=book.styles;if(!d)return '';const xf=elements(d,'cellXfs')[0]?.children[index];if(!xf)return '';const font=elements(d,'fonts')[0]?.children[Number(xf.getAttribute('fontId')||0)],fill=elements(d,'fills')[0]?.children[Number(xf.getAttribute('fillId')||0)],alignment=elements(xf,'alignment')[0];
 const color=node=>{const rgb=node?.getAttribute('rgb');return /^[\da-f]{8}$/i.test(rgb||'')?'#'+rgb.slice(-6):null;};
 const size=Math.min(72,Math.max(6,Number(font&&elements(font,'sz')[0]?.getAttribute('val'))||11)),family=font&&elements(font,'name')[0]?.getAttribute('val')||'Malgun Gothic';let css='font-size:'+size+'pt;font-family:"'+family.replace(/[";<>\\]/g,'')+'",sans-serif;';
 if(font&&elements(font,'b').some(x=>x.getAttribute('val')!=='0'))css+='font-weight:bold;';const fg=font&&color(elements(font,'color')[0]),bg=fill&&color(elements(fill,'fgColor')[0]);if(fg)css+='color:'+fg+';';if(bg)css+='background:'+bg+';';
 if(['left','center','right'].includes(alignment?.getAttribute('horizontal')))css+='text-align:'+alignment.getAttribute('horizontal')+';';for(const edge of ['top','right','bottom','left'])css+=edgeStyle(book,index,edge);
 return css;
}
function previewCellStyle(book,data,cell,merge){
 let css=styleOf(book,cell.style);
 if(merge){
  const right=data.cells.get(colName(merge.b.col)+(merge.a.row+1));
  const bottom=data.cells.get(colName(merge.a.col)+(merge.b.row+1));
  if(right)css+=edgeStyle(book,right.style,'right');
  if(bottom)css+=edgeStyle(book,bottom.style,'bottom');
 }
 const xf=book.styles&&elements(book.styles,'cellXfs')[0]?.children[cell.style];
 const alignment=xf&&elements(xf,'alignment')[0];
 const wrap=['1','true'].includes(alignment?.getAttribute('wrapText'));
 return {css,wrap};
}
function fitPreviewText(grid){
 for(const label of grid.querySelectorAll('[data-xlsx-fit]')){
  const width=label.parentElement.clientWidth;
  if(!width||label.scrollWidth<=width)continue;
  const computed=getComputedStyle(label),size=parseFloat(computed.fontSize);
  if(size)label.style.fontSize=Math.max(5,size*width/label.scrollWidth)+'px';
 }
}
const builtInNumberFormats={1:'0',2:'0.00',3:'#,##0',4:'#,##0.00',9:'0%',10:'0.00%',37:'#,##0;(#,##0)',38:'#,##0;(#,##0)',39:'#,##0.00;(#,##0.00)',40:'#,##0.00;(#,##0.00)',41:'#,##0;(#,##0);"-"',42:'#,##0;(#,##0);"-"',43:'#,##0.00;(#,##0.00);"-"',44:'#,##0.00;(#,##0.00);"-"'};
function displayValue(book,cell){
 if(cell.type!=='n'||cell.value===''||!Number.isFinite(Number(cell.value)))return cell.value;
 const styles=book.styles;
 const id=Number(styles&&elements(styles,'cellXfs')[0]?.children[cell.style]?.getAttribute('numFmtId'));
 const format=(styles&&elements(styles,'numFmt').find(x=>Number(x.getAttribute('numFmtId'))===id)?.getAttribute('formatCode'))||builtInNumberFormats[id];
 if(!format)return cell.value;
 const value=Number(cell.value),parts=format.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
 const section=(value<0?parts[1]:value===0?parts[2]:null)||parts[0];
 const plain=section.replace(/"[^"]*"|[_*\\].|\[[^\]]*\]/g,'');
 if(value===0&&/["]-(?:["])/.test(section)&&!/[0#]/.test(plain))return '-';
 const pattern=plain.match(/^[\s()+%-]*([#,0]+)(?:\.([0#]+))?%?[\s()+%-]*$/);
 if(!pattern)return cell.value;
 const fraction=(pattern[2]||'').slice(0,20),percent=plain.includes('%');
 const result=Math.abs(value*(percent?100:1)).toLocaleString('ko-KR',{
  useGrouping:pattern[1].includes(','),minimumFractionDigits:(fraction.match(/0/g)||[]).length,
  maximumFractionDigits:Math.min(fraction.length,20)
 });
 return (value<0&&!plain.includes('(')?'-':'')+(plain.includes('(')?'('+result+')':result)+(percent?'%':'');
}
function widths(data,col){const c=data.cols.find(x=>col+1>=Number(x.getAttribute('min'))&&col+1<=Number(x.getAttribute('max')));return Math.max(35,Math.min(500,(Number(c?.getAttribute('width'))||data.defaultWidth)*7));}
function heights(data,row){return Math.max(20,Math.min(250,(data.rows.get(row)||data.defaultHeight)*4/3));}
async function pictures(book,index){
 const data=sheetData(book,index),drawing=relationships(book.entries,data.sheet.path).find(x=>x.type.endsWith('/drawing'));if(!drawing||!book.entries.has(drawing.path))return [];
 const doc=parse(dec.decode(book.entries.get(drawing.path))),rels=relationships(book.entries,drawing.path),images=[];
 for(const anchor of [...doc.documentElement.children]){
  const blip=elements(anchor,'blip')[0],target=rels.find(x=>x.id===blip?.getAttributeNS(REL,'embed'));if(!target||!book.entries.has(target.path))continue;
  const bytes=book.entries.get(target.path),hex=[...bytes.slice(0,4)].map(v=>v.toString(16).padStart(2,'0')).join(''),mime=hex.startsWith('ffd8')?'image/jpeg':hex==='89504e47'?'image/png':dec.decode(bytes.slice(0,3))==='GIF'?'image/gif':hex==='52494646'?'image/webp':null;if(!mime)continue;
  const from=elements(anchor,'from')[0],to=elements(anchor,'to')[0],ext=elements(anchor,'ext')[0];if(!from)continue;
  const n=(node,name)=>Number(node&&elements(node,name)[0]?.textContent)||0,col=n(from,'col'),row=n(from,'row'),endCol=to?n(to,'col'):col,endRow=to?n(to,'row'):row;
  const x=Array.from({length:Math.min(col,16384)},(_,i)=>widths(data,i)).reduce((a,b)=>a+b,0)+n(from,'colOff')/9525,y=Array.from({length:Math.min(row,20000)},(_,i)=>heights(data,i)).reduce((a,b)=>a+b,0)+n(from,'rowOff')/9525;
  const width=to?Array.from({length:Math.max(0,Math.min(endCol-col,16384))},(_,i)=>widths(data,col+i)).reduce((a,b)=>a+b,0)+(n(to,'colOff')-n(from,'colOff'))/9525:Number(ext?.getAttribute('cx')||0)/9525;
  const height=to?Array.from({length:Math.max(0,Math.min(endRow-row,20000))},(_,i)=>heights(data,row+i)).reduce((a,b)=>a+b,0)+(n(to,'rowOff')-n(from,'rowOff'))/9525:Number(ext?.getAttribute('cy')||0)/9525;
  if(width>0&&height>0)images.push({bytes,mime,x,y,width,height});
 }
 return images;
}
function fileName(original){const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()).replace(/[^\d]/g,'');return original.replace(/\.xlsx$/i,'').slice(0,100)+'_수정_'+stamp+'_'+crypto.randomUUID().slice(0,6)+'.xlsx';}
async function show({blob,file,client,propertyId,canEdit,onSaved}){
 const book=await open(await blob.arrayBuffer()),dialog=document.createElement('dialog');dialog.className='lm-xlsx-editor';dialog.innerHTML='<header><h2>첨부 엑셀 편집</h2><button type="button" data-close>닫기</button></header><p data-title></p><p class="lm-xlsx-note">셀을 선택해 아래 입력칸에서 글자·숫자를 수정하세요. 원본은 그대로 남고 수정본이 별도 첨부됩니다. 원본·수정본 모두 보관용량에 포함됩니다. 수식 셀과 보호 시트는 읽기 전용이며, 계산 결과는 다운로드한 수정본을 엑셀에서 열 때 다시 계산됩니다. 인쇄는 현재 표시된 셀 범위를 사용합니다. 엑셀 원본의 일부 개체는 미리보기와 인쇄에서 생략될 수 있습니다.</p><div class="lm-xlsx-toolbar"><label>시트<select data-sheet></select></label><label>셀 주소<input data-address value="A1" aria-label="편집할 셀 주소"></label><button type="button" data-jump>셀로 이동</button><label>입력 형식<select data-type><option value="auto">자동</option><option value="text">글자</option><option value="number">숫자</option></select></label><label class="lm-xlsx-value">선택 셀 값<input data-value aria-label="선택 셀 값"></label><button type="button" data-apply>셀에 적용</button></div><div class="lm-xlsx-toolbar"><button type="button" data-save>수정본을 매물에 저장</button><button type="button" class="alt" data-download>수정본 PC 다운로드</button><button type="button" class="alt" data-print>인쇄 · PDF 저장</button><button type="button" class="alt" data-row-prev>이전 행</button><button type="button" class="alt" data-row-next>다음 행</button><button type="button" class="alt" data-col-prev>이전 열</button><button type="button" class="alt" data-col-next>다음 열</button><span data-range></span></div><p data-status role="status"></p><div class="lm-xlsx-viewport"><div data-grid class="lm-xlsx-grid-surface"></div></div>';
 document.body.append(dialog);dialog.showModal();const $=s=>dialog.querySelector(s),urls=new Set();let alive=true,index=0,rowStart=0,colStart=0,selected='A1',busy=false,inputDirty=false,renderSeq=0;
 $('[data-title]').textContent=file.file_name;$('[data-sheet]').innerHTML=book.sheets.map((s,i)=>'<option value="'+i+'">'+escape(s.name)+'</option>').join('');
 const status=s=>{if(alive)$('[data-status]').textContent=s;};
 const revoke=()=>{urls.forEach(u=>URL.revokeObjectURL(u));urls.clear();};
 const unload=e=>{if(book.dirty||inputDirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);
 function close(force=false){if(!force&&(busy||((book.dirty||inputDirty)&&!confirm('저장하지 않은 수정 내용이 있습니다. 닫을까요? 원본 첨부는 유지됩니다.'))))return;if(!alive)return;alive=false;renderSeq++;revoke();window.removeEventListener('beforeunload',unload);dialog.close();dialog.remove();}
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});$('[data-close]').onclick=()=>close();
 function select(ref){const cell=cellAt(book,index,ref);selected=cell.ref;$('[data-address]').value=selected;$('[data-value]').value=cell.formula?'='+cell.formula:cell.value;$('[data-value]').disabled=!canEdit||cell.readonly||busy;$('[data-apply]').disabled=!canEdit||cell.readonly||busy;$('[data-type]').value='auto';inputDirty=false;dialog.querySelectorAll('[data-cell]').forEach(td=>td.classList.toggle('is-selected',td.dataset.cell===selected));}
 function apply(){if(!inputDirty)return;edit(book,index,selected,$('[data-value]').value,$('[data-type]').value);inputDirty=false;}
 async function draw(){
  const seq=++renderSeq;revoke();const d=sheetData(book,index),endRow=Math.min(1048575,Math.max(d.maxRow,rowStart+31),rowStart+99),endCol=Math.min(16383,Math.max(d.maxCol,colStart+9),colStart+25),covered=new Set(),mergeMap=new Map();
  for(const m of d.merges){mergeMap.set(m.a.ref,m);for(let r=Math.max(rowStart,m.a.row);r<=Math.min(endRow,m.b.row);r++)for(let c=Math.max(colStart,m.a.col);c<=Math.min(endCol,m.b.col);c++)if(r!==m.a.row||c!==m.a.col)covered.add(colName(c)+(r+1));}
  const cols=Array.from({length:endCol-colStart+1},(_,i)=>colStart+i);let html='<table class="lm-xlsx-table" style="width:'+(60+cols.reduce((n,c)=>n+widths(d,c),0))+'px"><colgroup><col style="width:60px">'+cols.map(c=>'<col style="width:'+widths(d,c)+'px">').join('')+'</colgroup><thead><tr><th></th>'+cols.map(c=>'<th>'+colName(c)+'</th>').join('')+'</tr></thead><tbody>';
  for(let row=rowStart;row<=endRow;row++){html+='<tr style="height:'+heights(d,row)+'px"><th>'+(row+1)+'</th>';for(const col of cols){const ref=colName(col)+(row+1);if(covered.has(ref))continue;const cell=cellAt(book,index,ref),merge=mergeMap.get(ref),style=previewCellStyle(book,d,cell,merge),display=cell.formula&&(book.changes.size||cell.value==='')?'재계산 필요':displayValue(book,cell),height=Array.from({length:merge?Math.min(endRow,merge.b.row)-row+1:1},(_,i)=>heights(d,row+i)).reduce((a,b)=>a+b,0);html+='<td data-cell="'+ref+'" tabindex="0" '+(merge?'colspan="'+(Math.min(endCol,merge.b.col)-col+1)+'" rowspan="'+(Math.min(endRow,merge.b.row)-row+1)+'"':'')+' style="'+escape((cell.type==='n'&&cell.value!==''?'text-align:right;':'')+style.css+'padding:0 3px;')+'" title="'+escape(cell.formula?'수식: '+cell.formula:cell.value)+'">'+'<div style="height:'+Math.max(0,height-1)+'px;display:grid;grid-template-columns:minmax(0,1fr);align-items:center;overflow:hidden;white-space:'+(style.wrap?'pre-wrap;overflow-wrap:anywhere':'pre')+'"><span '+(style.wrap?'':'data-xlsx-fit')+' style="display:block;min-width:0;max-height:100%;overflow:hidden">'+escape(display)+'</span></div></td>';}html+='</tr>';}
  $('[data-grid]').innerHTML=html+'</tbody></table>';fitPreviewText($('[data-grid]'));$('[data-range]').textContent=colName(colStart)+(rowStart+1)+' ~ '+colName(endCol)+(endRow+1)+' · 100행/26열 단위';$('[data-save]').disabled=!canEdit||busy||d.protected;$('[data-value]').disabled=!canEdit||d.protected;
  const images=await pictures(book,index);if(!alive||seq!==renderSeq)return;
  const xOffset=Array.from({length:colStart},(_,i)=>widths(d,i)).reduce((a,b)=>a+b,0),yOffset=Array.from({length:rowStart},(_,i)=>heights(d,i)).reduce((a,b)=>a+b,0);
  for(const picture of images){const url=URL.createObjectURL(new Blob([picture.bytes],{type:picture.mime}));urls.add(url);const img=document.createElement('img');img.src=url;img.alt='첨부 엑셀에 포함된 사진';img.style.cssText='position:absolute;pointer-events:none;left:'+(60+picture.x-xOffset)+'px;top:'+(28+picture.y-yOffset)+'px;width:'+picture.width+'px;height:'+picture.height+'px;object-fit:fill;';$('[data-grid]').append(img);}
  select(selected);status((canEdit?'편집 가능':'읽기 전용')+' · '+(book.dirty?'저장하지 않은 수정 있음 · ':'')+(d.protected?'이 시트는 보호되어 있습니다.':'셀을 선택해 수정하세요.'));
 }
 const run=fn=>async()=>{try{apply();await fn();}catch(e){status(e.message);}};
 $('[data-value]').oninput=()=>{inputDirty=true;};$('[data-apply]').onclick=run(async()=>{await draw();});
 $('[data-value]').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();void $('[data-apply]').onclick();}};
 $('[data-grid]').onclick=async e=>{const td=e.target.closest('[data-cell]');if(!td)return;try{apply();select(td.dataset.cell);}catch(err){status(err.message);}};
 $('[data-grid]').onkeydown=e=>{const td=e.target.closest('[data-cell]');if(td&&e.key==='Enter'){e.preventDefault();$('[data-value]').focus();$('[data-value]').select();}};
 $('[data-jump]').onclick=run(async()=>{const p=point($('[data-address]').value.trim());selected=p.ref;rowStart=Math.floor(p.row/100)*100;colStart=Math.floor(p.col/26)*26;await draw();});
 $('[data-sheet]').onchange=run(async()=>{index=Number($('[data-sheet]').value);rowStart=colStart=0;selected='A1';await draw();});
 for(const [button,change] of [['row-prev',()=>rowStart=Math.max(0,rowStart-100)],['row-next',()=>rowStart=Math.min(1048500,rowStart+100)],['col-prev',()=>colStart=Math.max(0,colStart-26)],['col-next',()=>colStart=Math.min(16358,colStart+26)]])$('[data-'+button+']').onclick=run(async()=>{change();selected=colName(colStart)+(rowStart+1);await draw();});
 const saveFile=()=>new File([pack(book)],fileName(file.file_name),{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 $('[data-print]').onclick=run(async()=>{
  await draw();
  if(!alive)return;
  const frame=document.createElement('iframe');
  frame.style.cssText='position:fixed;left:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  document.body.append(frame);
  const printDoc=frame.contentDocument,printWindow=frame.contentWindow;
  try{
   printDoc.title=file.file_name;
   const css=printDoc.createElement('style');
   css.textContent='@page{size:A4 landscape;margin:8mm}body{margin:0;color:#111;font:11pt Arial,sans-serif}.lm-xlsx-table{table-layout:fixed;border-collapse:collapse;background:white}.lm-xlsx-table td,.lm-xlsx-table th{box-sizing:border-box;border:1px solid #c8d0d4;vertical-align:middle}.lm-xlsx-table th{height:28px;padding:2px;font-size:12px}.lm-xlsx-table tr{break-inside:avoid}.lm-xlsx-table th{visibility:hidden}*{print-color-adjust:exact}';
   printDoc.head.append(css);
   const grid=printDoc.importNode($('[data-grid]'),true);
   const width=$('[data-grid] table').getBoundingClientRect().width||1000;
   grid.style.cssText='position:relative;width:'+width+'px;overflow:hidden;zoom:'+Math.min(1,1050/width);
   printDoc.body.append(grid);
   await Promise.all([...grid.querySelectorAll('img')].map(img=>img.decode?.().catch(()=>{})));
   printWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});
   printWindow.focus();printWindow.print();
  }catch(error){frame.remove();throw error}
 });
 $('[data-download]').onclick=run(async()=>{const out=saveFile(),url=URL.createObjectURL(out);urls.add(url);const a=document.createElement('a');a.href=url;a.download=out.name;a.click();status('수정본 다운로드를 요청했습니다. 원본 첨부는 그대로입니다.');});
 $('[data-save]').onclick=run(async()=>{if(!canEdit||busy)return;if(!book.dirty){status('변경한 셀이 없습니다.');return;}busy=true;$('[data-save]').disabled=true;$('[data-value]').disabled=true;$('[data-download]').disabled=true;try{const out=saveFile();status('수정본 저장 중… 원본은 유지됩니다.');await client.upload(propertyId,out,n=>status('수정본 저장 '+n+'%'));if(!alive)return;book.dirty=false;await draw();await onSaved?.();status('수정본을 별도 첨부로 저장했습니다. 원본은 문서 목록에서 그대로 열 수 있습니다.');}finally{busy=false;if(alive){$('[data-save]').disabled=!canEdit;$('[data-download]').disabled=false;select(selected);}}});
 try{await draw();}catch(e){close(true);throw e;}
 return ()=>close(true);
}
root.LMXlsxEditor={open,sheetData,cellAt,edit,pack,pictures,show};if(typeof module!=='undefined')module.exports=root.LMXlsxEditor;

function crc(data){let x=0xffffffff;for(const b of data){x^=b;for(let i=0;i<8;i++)x=(x>>>1)^((x&1)?0xedb88320:0);}return (x^0xffffffff)>>>0;}
function zip(files){const parts=[],central=[];let offset=0;const u16=(v,n,o)=>v.setUint16(o,n,true),u32=(v,n,o)=>v.setUint32(o,n,true);for(const [name,value] of files){const data=typeof value==='string'?enc.encode(value):value,n=enc.encode(name),checksum=crc(data),h=new Uint8Array(30+n.length),v=new DataView(h.buffer);u32(v,0x04034b50,0);u16(v,20,4);u16(v,0x800,6);u16(v,0x21,12);u32(v,checksum,14);u32(v,data.length,18);u32(v,data.length,22);u16(v,n.length,26);h.set(n,30);parts.push(h,data);const c=new Uint8Array(46+n.length),w=new DataView(c.buffer);u32(w,0x02014b50,0);u16(w,20,4);u16(w,20,6);u16(w,0x800,8);u16(w,0x21,14);u32(w,checksum,16);u32(w,data.length,20);u32(w,data.length,24);u16(w,n.length,28);u32(w,offset,42);c.set(n,46);central.push(c);offset+=h.length+data.length;}const len=central.reduce((a,b)=>a+b.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);u32(v,0x06054b50,0);u16(v,files.length,8);u16(v,files.length,10);u32(v,len,12);u32(v,offset,16);parts.push(...central,end);const out=new Uint8Array(offset+len+22);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
})(typeof window==='undefined'?globalThis:window);
