/* Every saved revision is append-only in IndexedDB before any network write. */
const lmSyncSandbox=new URL(location.href).searchParams.get('lm-sync-sandbox');
const lmSyncEngine=window.LMSyncEngine,LM_SYNC_DB='landmaker-sync-journal-v1'+(lmSyncSandbox?'-sandbox-'+lmSyncSandbox:'');
let lmSyncActor='',lmSyncTail=null,lmSyncSerial=Promise.resolve(),lmSyncBusy=false,lmSyncSaving=0,lmSyncTimer,lmSyncNextAttempt=0,lmSyncFailures=0,lmSyncLastArchiveRefresh=0,lmSyncLastPulledVersion=-1;
window.lmOfflineEditing=false;
function lmSyncDB(name=LM_SYNC_DB){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{r.result.createObjectStore('operations',{keyPath:'id'});r.result.createObjectStore('metadata')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function lmSyncStore(mode,action,name=LM_SYNC_DB){const d=await lmSyncDB(name);try{return await new Promise((resolve,reject)=>{let tx;try{tx=d.transaction(['operations','metadata'],mode,{durability:'strict'})}catch{tx=d.transaction(['operations','metadata'],mode)}let result;const set=x=>result=x;action(tx.objectStore('operations'),tx.objectStore('metadata'),set);tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('PC 저장이 중단됐습니다.'))})}finally{d.close()}}
async function lmSyncRows(){return lmSyncStore('readonly',(s,m,set)=>{const r=s.getAll();r.onsuccess=()=>set(r.result.sort((a,b)=>a.sequence-b.sequence))})}
function lmSyncDevice(){let k=localStorage.getItem('landmaker-device-id-v1');if(!k){k=crypto.randomUUID();localStorage.setItem('landmaker-device-id-v1',k)}return k}
async function lmSyncAppend(changes,reason){
 if(!lmSyncActor)throw Error('이 PC에서 온라인 직원 확인을 한 번 완료해 주세요.');
 const operations=changes.map(change=>({...change,id:crypto.randomUUID(),actor_id:lmSyncActor,staff:lmLoggedInStaff,device_id:lmSyncDevice(),created_at:new Date().toISOString()}));
 await lmSyncStore('readwrite',(s,m)=>{const q=m.get('sequence');q.onsuccess=()=>{let seq=Number(q.result)||0;for(const operation of operations)s.add({id:operation.id,sequence:++seq,operation,status:'pending',reason});m.put(seq,'sequence')}});
 void lmSyncStatus();return operations;
}
async function lmSyncMark(id,result){await lmSyncStore('readwrite',s=>{const q=s.get(id);q.onsuccess=()=>{if(!q.result)throw Error('PC 원본을 찾지 못했습니다.');s.put({...q.result,status:result.status,result,acknowledged_at:new Date().toISOString()})}})}
async function lmSyncMaterialize(){
 const snapshot=await lmLocalRead();if(!snapshot?.data)throw Error('이 PC에 보관된 자료가 없습니다. 온라인 로그인 후 PC 사본을 준비해 주세요.');
 const state=lmSyncEngine.clone(snapshot.data);state.archives=lmSyncEngine.clone(snapshot.archives||{tables:{}});
 for(const row of await lmSyncRows())if(!row.checkpointed&&row.status!=='superseded')lmSyncEngine.apply(state,row.operation);
 return {...snapshot,data:Object.fromEntries(Object.entries(state).filter(([k])=>k!=='archives')),archives:state.archives};
}
async function lmSyncStatus(){
 try{const rows=await lmSyncRows(),pending=rows.filter(x=>x.status==='pending').length,conflict=rows.filter(x=>x.status==='conflict').length;
 const label=(lmSyncSaving?'PC 저장 중 · ':'')+(navigator.onLine&&!lmOfflineTest()?'':'오프라인 · ')+(!authToken&&pending?'직원 로그인 후 전송 · ':'')+'전송 대기 '+pending+'건 · 충돌 '+conflict+'건';
 let b=document.getElementById('lmSyncStatus');if(!b){b=document.createElement('button');b.type='button';b.id='lmSyncStatus';b.style.cssText='position:fixed;right:18px;bottom:108px;z-index:2147483641;max-width:600px;background:#075e6a;color:white';b.onclick=()=>void lmSyncCenter();document.body.append(b)}b.textContent=label+' · 저장 내역';
 }catch(e){showSaveStatus('동기화 기록 확인 실패: '+e.message,true)}
}
function lmQueueDurableSave(){
 const captured=lmSyncEngine.clone(db);lmSyncSaving++;void lmSyncStatus();
 const task=lmSyncSerial.catch(()=>{}).then(async()=>{
  if(!lmSyncTail)lmSyncTail=JSON.parse(cloudLastSaved||JSON.stringify(captured));
  const changes=lmSyncEngine.diff(lmSyncTail,captured);
  await lmSyncAppend(changes,'매물·고객·일정 저장');lmSyncTail=captured;
  showSaveStatus('이 PC 저장 완료 · '+changes.length+'건 자동 전송 대기',false);
 });lmSyncSerial=task;
 task.then(()=>void lmSyncFlush()).catch(e=>{showSaveStatus('PC 저장 실패 · 화면을 닫지 마세요: '+e.message,true);alert('PC에 입력내용을 저장하지 못했습니다. 화면을 닫지 말고 백업해 주세요.\n'+e.message)}).finally(()=>{lmSyncSaving--;void lmSyncStatus()});return task;
}
async function lmSyncRequest(operation,testId=lmSyncSandbox){
 if(lmOfflineTest()||!navigator.onLine||window.lmOfflineMode)throw Error('연결 대기 중');
 if(!authToken)throw Error('직원 로그인 후 자동 전송됩니다. PC 원본은 보존되어 있습니다.');
 await ensureFreshAuth();
 const r=await fetchWithTimeout(SB_URL+'/rest/v1/rpc/lm_sync_apply_v1',{method:'POST',headers:{apikey:SB_KEY,Authorization:'Bearer '+authToken,'Content-Type':'application/json'},body:JSON.stringify({p_operation:operation,p_test_id:testId})},30000);
 const result=await r.json();if(!r.ok)throw Error(result.message||'동기화 서버 '+r.status);if(!['applied','conflict'].includes(result.status)||result.id!==operation.id)throw Error('서버의 저장 확인번호가 올바르지 않습니다. PC 원본을 유지합니다.');return result;
}
async function lmSyncCheckpoint(){
 const rows=(await lmSyncRows()).filter(x=>x.status==='applied'&&!x.checkpointed);if(!rows.length)return;
 const latest=await cloudRPC('lm_cloud_read',{});if(!latest?.data||!Number.isFinite(latest.version))throw Error('저장 후 확인 조회 실패');
 const old=await lmLocalRead(),archives=lmSyncEngine.clone(old?.archives||{tables:{}});archives.tables??={};
 for(const row of rows.filter(x=>x.operation.target==='table')){
  if(lmSyncSandbox){lmSyncEngine.apply({archives},row.operation);continue;}
  const op=row.operation,key=lmSyncEngine.tableKeys[op.collection];
  const records=await lmArchiveNetwork(op.collection,{select:'*',[key]:'eq.'+op.record_id,limit:'1'});
  archives.tables[op.collection]=(archives.tables[op.collection]||[]).filter(x=>String(x[key])!==op.record_id).concat(records);
 }
 await window.lmCacheSnapshot(latest.data,latest.version,archives);
 await lmSyncStore('readwrite',s=>{for(const row of rows){const q=s.get(row.id);q.onsuccess=()=>{if(q.result?.status==='applied')s.put({...q.result,checkpointed:true})}}});
}
async function lmSyncFlush(){
 if(lmSyncBusy||lmSyncSaving||Date.now()<lmSyncNextAttempt||!navigator.onLine||lmOfflineTest()||window.lmOfflineMode||!authToken)return;
 lmSyncBusy=true;
 try{
  let processed=0;const run=async()=>{for(const row of await lmSyncRows()){
   if(row.status!=='pending')continue;
   if(row.operation.actor_id!==lmSyncActor)continue;
   const result=await lmSyncRequest(row.operation);await lmSyncMark(row.id,result);processed++;
  }await lmSyncCheckpoint();await lmSyncPull()};
  if(navigator.locks)await navigator.locks.request('landmaker-journal-sender-v1',run);else await run();
  lmSyncFailures=0;lmSyncNextAttempt=0;if(processed)showSaveStatus('자동 병합 처리 '+processed+'건 완료 · 충돌 여부는 저장 내역에서 확인하세요.',false);
 }catch(e){lmSyncNextAttempt=Date.now()+Math.min(120000,15000*2**lmSyncFailures++);showSaveStatus('자동 전송 대기 · PC 원본 유지: '+e.message,true)}finally{lmSyncBusy=false;void lmSyncStatus()}
}
const lmArchiveNetwork=archiveAPI;
async function lmSyncPull(){
 const latest=await cloudRPC('lm_cloud_read',{});if(!latest?.data||!Number.isFinite(latest.version))throw Error('최신 공동자료 조회 실패');
 if(latest.version===lmSyncLastPulledVersion&&Date.now()-lmSyncLastArchiveRefresh<60000)return;
 const cached=await lmLocalRead();let archives=cached?.archives;
 if(!lmSyncSandbox&&archives?.completedAt&&Date.now()-lmSyncLastArchiveRefresh>60000){
  archives=lmSyncEngine.clone(archives);
  for(const [table,key]of Object.entries(lmSyncEngine.tableKeys)){let after=null;const all=[];for(;;){const rows=await lmArchiveNetwork(table,{select:'*',order:key+'.asc',limit:'1000',...(after?{[key]:'gt.'+after}:{})});if(!Array.isArray(rows))throw Error('PC 사본 갱신 응답 오류');all.push(...rows);if(rows.length<1000)break;const next=String(rows.at(-1)[key]);if(next===after)throw Error('PC 사본 페이지 반복');after=next}archives.tables[table]=all;}
  lmSyncLastArchiveRefresh=Date.now();
 }
 await window.lmCacheSnapshot(latest.data,latest.version,archives);
 lmSyncLastPulledVersion=latest.version;if(lmSyncSandbox)lmSyncLastArchiveRefresh=Date.now();
 const pending=(await lmSyncRows()).some(x=>['pending','conflict'].includes(x.status));
 if(!lmSyncSaving&&!pending&&!lmFormDirty&&!window.lmPropertyDraftDirty&&!document.querySelector('#propertyForm,#customerForm')&&lmSyncEngine.equal(db,lmSyncTail)){
  db={...empty(),...latest.data};lmSyncTail=lmSyncEngine.clone(db);cloudVersion=latest.version;cloudLastSaved=JSON.stringify(db);lmAuditBaseline=lmAuditSnapshot();
 }
}
async function lmSyncStartEditing(){
 if(lmFormDirty||window.lmPropertyDraftDirty)throw Error('작성 중인 입력을 먼저 저장해 주세요. 현재 입력내용은 그대로 유지합니다.');
 await lmSyncSerial.catch(()=>{});const snapshot=await lmSyncMaterialize();
 lmSyncActor=snapshot.staffId||lmSyncActor;if(!lmSyncActor)throw Error('온라인 직원 로그인으로 이 PC의 작업자를 먼저 확인해 주세요.');
 db={...empty(),...snapshot.data};lmSyncTail=lmSyncEngine.clone(db);cloudLastSaved=JSON.stringify(db);cloudVersion=snapshot.version;lmAuditBaseline=lmAuditSnapshot();
 lmLoggedInStaff=snapshot.staff||lmLoggedInStaff;window.lmOfflineEditing=true;window.lmOfflineMode=false;
 document.getElementById('authGate').hidden=true;document.getElementById('authInfo').hidden=false;document.getElementById('authStaffName').textContent=lmLoggedInStaff+' 님 · PC 작업';
 document.getElementById('lmLocalViewer')?.remove();return snapshot;
}
async function lmSyncOpenNative(kind,record){
 try{await lmSyncStartEditing();if(record){if(kind==='customers'){openCustomer(record.id);nav()}else{editing={type:'property',id:record.id};window.lmShowPropertyForm=true;tab='properties';render()}}else{editing=null;tab=kind==='customers'?'customers':'properties';if(kind==='properties')window.lmShowPropertyForm=true;render()}
 }catch(e){alert(e.message)}
}
async function lmSyncLocalTableSave(table,before,after){
 const key=lmSyncEngine.tableKeys[table];if(!key)throw Error('이 종류는 오프라인 입력을 지원하지 않습니다.');
 await lmSyncAppend([{target:'table',collection:table,record_id:String(after[key]),before:before||null,after}],'기존 엑세스·원노트 수정');void lmSyncFlush();
}
async function lmSyncEditArchive(entry){
 const s=await lmSyncMaterialize(),tables=s.archives?.tables||{},value=entry.value;let table,previous,fields,title;
 if(entry.source==='엑세스 매물'||entry.source==='신규매물'){
  const row=value.원본;table=entry.source==='신규매물'?'lm_new_properties':'lm_access_property_edits';previous=entry.source==='신규매물'?row:(tables[table]||[]).find(x=>String(x.source_id)===String(row.id));
  const data={...row.original_data,...(previous?.edited_data||{})};fields=Object.entries(data).filter(([k,v])=>!k.startsWith('__')&&(typeof v==='string'||typeof v==='number'||v===null)).map(([key,v])=>({key,label:key,value:v??''}));title='엑세스 매물 수정';
 }else{
  const isNote=entry.source==='원노트',row=isNote?value.원문:value.원본;table=isNote?'lm_onenote_customer_profiles':'lm_access_customer_profiles';const key=lmSyncEngine.tableKeys[table],rid=String(isNote?(row.source_page_id??row.id):row.id);previous=(tables[table]||[]).find(x=>String(x[key])===rid);
  fields=[['customer_name','고객명'],['phone','연락처'],['address','주소·지역'],['customer_status','고객분류'],['memo','메모']].map(([key,label])=>({key,label,value:previous?.[key]||''}));title=isNote?'원노트 고객정보 수정':'엑세스 고객정보 수정';
 }
 const panel=document.createElement('div');panel.style.cssText='position:fixed;inset:0;overflow:auto;background:#f5f8f8;padding:25px;z-index:2147483643';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',title);
 panel.innerHTML='<h2>'+esc(title)+'</h2><p>PC에 먼저 저장하고, 온라인 직원 로그인 상태에서 자동 전송합니다. 충돌하면 양쪽 내용을 보관합니다.</p><form><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px">'+fields.map((f,i)=>'<label>'+esc(f.label)+'<textarea data-field="'+i+'">'+esc(f.value)+'</textarea></label>').join('')+'</div>'+(entry.source==='엑세스 고객'?'<label>새 상담내용<textarea data-consult></textarea></label>':'')+'<div class="row"><button type="submit">이 PC에 저장</button><button type="button" data-cancel>닫기</button></div><p data-state role="status"></p></form>';
 document.body.appendChild(panel);panel.querySelector('[data-cancel]').onclick=()=>panel.remove();
 panel.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=panel.querySelector('[type=submit]');b.disabled=true;try{
  let after;if(table==='lm_access_property_edits'||table==='lm_new_properties'){const r=value.원본,key=table==='lm_new_properties'?'original_data':'edited_data';after=table==='lm_new_properties'?{...previous,original_data:{...r.original_data}}:{...(previous||{}),source_id:r.id,source_table:r.source_table,source_row_number:r.source_row_number,edited_data:{...r.original_data,...(previous?.edited_data||{})}};for(let i=0;i<fields.length;i++)after[key][fields[i].key]=panel.querySelector('[data-field="'+i+'"]').value}
  else{const r=entry.source==='원노트'?value.원문:value.원본,key=lmSyncEngine.tableKeys[table];after={...(previous||{}),[key]:String(entry.source==='원노트'?(r.source_page_id??r.id):r.id)};for(let i=0;i<fields.length;i++)after[fields[i].key]=panel.querySelector('[data-field="'+i+'"]').value}
  await lmSyncLocalTableSave(table,previous,after);previous=after;
  const consult=panel.querySelector('[data-consult]');if(consult?.value.trim()){const r={id:crypto.randomUUID(),import_row_id:value.원본.id,consulted_on:today(),staff_name:lmLoggedInStaff,content:consult.value.trim()};await lmSyncLocalTableSave('lm_access_customer_consultations',null,r);consult.value=''}
  panel.querySelector('[data-state]').textContent='이 PC에 저장했습니다. 자동 전송 상태는 저장 내역에서 확인하세요.';
 }catch(ex){panel.querySelector('[data-state]').textContent='저장 실패: '+ex.message}finally{b.disabled=false}};
}
async function lmSyncCenter(){
 const rows=await lmSyncRows(),host=document.createElement('div');host.style.cssText='position:fixed;inset:0;background:white;padding:22px;overflow:auto;z-index:2147483644';host.setAttribute('role','dialog');host.setAttribute('aria-label','동기화 저장 내역');
 host.innerHTML='<h2>PC 저장·자동 병합 내역</h2><p>전송 순서는 이 PC의 저장 순서입니다. 다른 PC와는 서버에서 한 건씩 처리하며, 충돌 원본과 전송 완료 원본도 보관합니다.</p><div class="row"><button data-retry>지금 전송 재시도</button><button data-export>전체 저장기록 백업</button><button data-test>4명 동기화 안전검증</button><button data-close>닫기</button></div><pre data-test-out style="white-space:pre-wrap"></pre><div data-rows></div>';
 document.body.appendChild(host);host.querySelector('[data-close]').onclick=()=>host.remove();host.querySelector('[data-retry]').onclick=()=>void lmSyncFlush();
 host.querySelector('[data-export]').onclick=async()=>{const data=await lmSyncRows(),url=URL.createObjectURL(new Blob([JSON.stringify({format:'landmaker-operation-journal-v1',at:new Date().toISOString(),operations:data},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='landmaker-pc-journal-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)};
 host.querySelector('[data-test]').onclick=()=>void lmSyncRunVerification(host.querySelector('[data-test-out]'));
 const list=host.querySelector('[data-rows]');for(const row of rows.slice().reverse().slice(0,200)){
  const article=document.createElement('article');article.style.cssText='padding:12px;border:1px solid #cbdadb;margin:9px 0';
  const op=row.operation;article.innerHTML='<b>'+esc({pending:'전송 대기',applied:'서버 저장 확인',conflict:'충돌 · 양쪽 보관',superseded:'확인 후 대체'}[row.status]||row.status)+'</b> · '+esc(op.collection)+' · '+esc(op.staff)+'<p>'+esc(op.created_at)+' · 확인번호 '+esc(op.id)+'</p>';
  const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='변경 전·내 입력·서버 결과 보기';pre.style.whiteSpace='pre-wrap';pre.textContent='변경 전\n'+lmLocalDescribe(op.before)+'\n\n내 입력\n'+lmLocalDescribe(op.after)+'\n\n서버 확인 내용\n'+lmLocalDescribe(row.result?.remote);details.append(summary,pre);article.append(details);
  if(row.status==='conflict'){
   const keep=document.createElement('button');keep.textContent='서버 내용 유지 · 내 원본은 보관';keep.onclick=async()=>{if(!confirm('내 수정 원본은 기록에 보관하고 서버 내용을 유지할까요?'))return;await lmSyncStore('readwrite',s=>{s.put({...row,status:'superseded',resolution:'keep-server'})});article.remove();void lmSyncStatus()};article.append(keep);
   const edit=document.createElement('button');edit.textContent='항목별로 비교해 병합';edit.onclick=()=>lmSyncReviewConflict(row,article);article.append(edit);
  }list.append(article);
 }await lmSyncStatus();
}
function lmSyncReviewConflict(row,article){
 const op=row.operation,remote=row.result.remote??null,choices=[];
 const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
 function review(b,l,r,path=[]){
  if(lmSyncEngine.equal(l,b))return lmSyncEngine.clone(r);
  if(lmSyncEngine.equal(r,b)||lmSyncEngine.equal(l,r))return lmSyncEngine.clone(l);
  if(obj(b)&&obj(l)&&obj(r)){const out={};for(const k of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){const v=review(b[k],l[k],r[k],[...path,k]);if(v!==undefined)out[k]=v}return out}
  choices.push({path,local:l,remote:r});return lmSyncEngine.clone(r);
 }
 let merged=review(op.before,op.after,remote);
 const box=document.createElement('section');box.innerHTML='<h3>충돌 항목 선택</h3><p>서로 다른 항목의 변경은 함께 유지합니다. 아래에서 충돌한 항목만 선택해 주세요.</p>';
 for(const choice of choices){const label=document.createElement('label'),desc=document.createElement('pre'),select=document.createElement('select');
  label.textContent=choice.path.map(k=>lmAuditFieldNames[k]||k).join(' / ')||'자료 전체';desc.style.whiteSpace='pre-wrap';desc.textContent='서버: '+lmLocalDescribe(choice.remote)+'\n내 입력: '+lmLocalDescribe(choice.local);select.innerHTML='<option value="remote">서버 값 유지</option><option value="local">내 입력 적용</option>';choice.select=select;label.append(desc,select);box.append(label);
 }
 const save=document.createElement('button');save.textContent='선택한 병합본을 PC에 저장';save.onclick=async()=>{save.disabled=true;try{
  for(const c of choices){const value=lmSyncEngine.clone(c.select.value==='local'?c.local:c.remote);if(!c.path.length){merged=value;continue}let parent=merged;for(const k of c.path.slice(0,-1))parent=parent[k];const key=c.path.at(-1);if(value===undefined)delete parent[key];else parent[key]=value}
  await lmSyncAppend([{target:op.target,collection:op.collection,record_id:op.record_id,before:remote,after:merged??null}],'충돌 항목 검토 후 병합본');
  await lmSyncStore('readwrite',s=>s.put({...row,status:'superseded',resolution:'reviewed-replacement'}));article.remove();void lmSyncFlush();
 }catch(e){alert(e.message);save.disabled=false}};box.append(save);article.append(box);
}
window.addEventListener('online',()=>{lmSyncNextAttempt=0;lmSyncLastArchiveRefresh=0;void lmSyncFlush();void lmSyncStatus()});
window.addEventListener('beforeunload',e=>{if(lmSyncSaving){e.preventDefault();e.returnValue='PC 저장을 완료하는 중입니다.'}});
lmSyncTimer=setInterval(()=>{void lmSyncFlush()},15000);
void lmSyncStatus();
