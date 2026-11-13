/* The online views and forms are shared. Only their read provider changes. */
window.lmUsingLocalData=false;
let lmOfflineTables=null,lmOfflinePreparing=null,lmOfflineGeneration=0,lmOfflineStartSequence=0,lmOfflinePendingAtStart=new Set(),lmOfflineQueryMemo=new Map();
function lmIsLocal(){return window.lmUsingLocalData||!navigator.onLine||lmOfflineTest()}
async function lmOfflinePrepare(snapshot){
 if(lmOfflineTables&&!snapshot)return;
 if(lmOfflinePreparing&&!snapshot)return lmOfflinePreparing;
 const task=(async()=>{const view=snapshot||await lmSyncMaterialize(),operations=await lmSyncRows();lmOfflineTables=view.archives?.tables||{};lmOfflineStartSequence=Math.max(0,...operations.map(x=>x.sequence));lmOfflinePendingAtStart=new Set(operations.filter(x=>!x.checkpointed).map(x=>x.id));lmOfflineQueryMemo.clear();lmOfflineGeneration++;})();
 lmOfflinePreparing=task;try{await task}finally{if(lmOfflinePreparing===task)lmOfflinePreparing=null}
}
async function lmOfflineArchive(table,params={},method='GET',body=null){
 await lmOfflinePrepare();
 const operations=(await lmSyncRows()).filter(x=>x.status!=='superseded'&&(x.sequence>lmOfflineStartSequence||lmOfflinePendingAtStart.has(x.id))&&x.operation.target==='table');
 const revision=operations.map(x=>x.id+':'+x.status).join('|');
 if(table.startsWith('rpc/'))return window.LMOfflineQuery.clone(window.LMOfflineQuery.rpc(lmOfflineTables,table.slice(4),body));
 if(!Object.hasOwn(lmOfflineTables,table)){
  if(['lm_access_property_edits','lm_access_customer_profiles','lm_access_customer_consultations','lm_onenote_customer_profiles','lm_onenote_edits','lm_onenote_customer_links','lm_new_properties'].includes(table))return [];
  throw Error('이 PC에 '+({lm_import_rows:'엑세스 원본',lm_onenote_pages:'원노트 원문'}[table]||'해당 자료')+' 사본이 없습니다. 온라인에서 PC 사본 갱신을 완료해 주세요.');
 }
 const allParams={...params};delete allParams.limit;delete allParams.offset;delete allParams.select;
 const key=JSON.stringify([table,allParams,revision]);let rows=lmOfflineQueryMemo.get(key);
 if(!rows){
  let data=lmOfflineTables[table];const primary=lmSyncEngine.tableKeys[table];
  if(primary&&operations.some(x=>x.operation.collection===table)){const map=new Map(data.map(x=>[String(x[primary]),x]));for(const row of operations){const op=row.operation;if(op.collection!==table)continue;if(op.after===null)map.delete(op.record_id);else map.set(op.record_id,op.after)}data=[...map.values()]}
  rows=window.LMOfflineQuery.select(data,allParams,false);lmOfflineQueryMemo.set(key,rows);
 }
 if(method==='HEAD')return rows.length;
 const offset=Math.max(0,Number(params.offset)||0),limit=params.limit==null?rows.length:Math.max(0,Number(params.limit)||0);
 return window.LMOfflineQuery.clone(rows.slice(offset,offset+limit));
}
async function lmOfflineStandardStart(kind='propertyList'){
 try{
  const snapshot=await lmSyncStartEditing();window.lmUsingLocalData=true;await lmOfflinePrepare(snapshot);
  tab=kind;editing=null;window.lmShowPropertyForm=false;render();lmOfflineReturnButton();
  showSaveStatus('오프라인 · 이 PC 저장자료 사용 · 온라인과 같은 목록·검색·입력 서식입니다.',false);
  return true;
 }catch(e){const el=document.getElementById('authProgress');if(el)el.textContent=e.message;showSaveStatus(e.message,true);return false}
}
function lmOfflineReturnButton(){
 if(document.getElementById('lmLocalReturnOnline'))return;
 const b=document.createElement('button');b.id='lmLocalReturnOnline';b.type='button';b.textContent='온라인 자료로 돌아가기';b.onclick=()=>{if(!navigator.onLine){showSaveStatus('인터넷 연결 후 온라인 자료로 돌아갈 수 있습니다.',true);return}const url=new URL(location.href);url.searchParams.delete('lm-offline-test');location.href=url.href};document.getElementById('authInfo')?.append(b);
}
function lmInlineWorkStatus(message,error=false){
 let el=document.getElementById('lmWorkStatus');if(!el){el=document.createElement('span');el.id='lmWorkStatus';el.setAttribute('role','status');el.style.cssText='display:block;max-width:560px;font-size:12px;line-height:1.5;white-space:normal';document.getElementById('authInfo')?.append(el)}el.textContent=message;el.style.color=error?'#a52626':'#245c45';
 const status=document.getElementById('lmWorkToolsStatus');if(status)status.textContent=document.getElementById('lmSyncStatus')?.textContent||message;
}
const lmFloatingSaveStatus=showSaveStatus;
showSaveStatus=function(message,error){lmFloatingSaveStatus(message,error);lmInlineWorkStatus(message,error)};
function lmWorkToolsView(){
 document.getElementById('view').innerHTML='<div class="panel"><h2>저장·동기화 관리</h2><p>저장 내역과 복구 도구는 이 메뉴에서 확인합니다.</p><p id="lmWorkToolsStatus" role="status"></p><div class="row"><button type="button" id="lmOpenSyncHistory">자동 병합 내역·충돌 확인</button><button type="button" id="lmOpenRecoveryTests">저장·복구 안전검증</button><button type="button" id="lmToolsRefreshPC">PC 사본 갱신</button></div><p class="muted">오프라인에서도 매물목록·고객목록과 기존 상세·수정 서식을 그대로 사용합니다. 인터넷 대장 조회는 연결 후 사용할 수 있습니다.</p></div>';
 document.getElementById('lmOpenSyncHistory').onclick=()=>void lmSyncCenter();document.getElementById('lmOpenRecoveryTests').onclick=()=>document.getElementById('lmTestOpen')?.click();document.getElementById('lmToolsRefreshPC').onclick=()=>document.getElementById('lmLocalRefresh')?.click();void lmSyncStatus();
}
if(!menus.some(x=>x[0]==='syncTools'))menus.push(['syncTools','저장·동기화 관리']);
window.addEventListener('offline',()=>{window.lmUsingLocalData=true;void lmOfflinePrepare().then(()=>lmOfflineReturnButton()).catch(e=>showSaveStatus(e.message,true))});
