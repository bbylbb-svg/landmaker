/* Uses the existing auth, backup and server version checks. */
async function lmCommitCustomerChange(beforeText){
 const desiredText=JSON.stringify(db);let locked=false,committed=false;
 try{
  if(cloudBusy||cloudPending||lmSyncSaving||lmSyncBusy)throw Error('다른 저장이 진행 중입니다. 잠시 후 다시 처리해 주세요.');
  cloudBusy=true;lmSyncBusy=true;locked=true;
  const journal=await lmSyncRows();
  if(journal.some(x=>!x.checkpointed&&['pending','conflict'].includes(x.status)))throw Error('PC 전송 대기 또는 충돌 자료가 있습니다. 저장·동기화 관리에서 먼저 확인해 주세요.');
  const pending=await lmSafeGet();if(pending)await lmSafeArchivePending(pending);
  const result=await LMCustomerRecovery.commit({base:JSON.parse(cloudLastSaved||beforeText),desired:JSON.parse(desiredText),read:()=>cloudRPC('lm_cloud_read',{}),write:(version,data)=>cloudRPC('lm_cloud_write',{p_expected_version:version,p_data:data}),merge:lmSafeThreeWay,equal:lmSyncEngine.equal,unchanged:()=>JSON.stringify(db)===desiredText});
  committed=true;cloudVersion=result.version;cloudLastSaved=JSON.stringify({...empty(),...result.data});
  if(JSON.stringify(db)!==desiredText)throw Error('서버 처리는 완료됐지만 화면에 새 입력이 있습니다. PC 자료를 보관하고 최신 자료로 계속해 주세요.');
  db=JSON.parse(cloudLastSaved);lmSyncTail=lmSyncEngine.clone(db);lmAuditBaseline=lmAuditSnapshot();
  await window.lmCacheSnapshot(db,cloudVersion).catch(e=>lmLocalStatus('PC 사본 갱신 실패: '+e.message));
  document.getElementById('lmCustomerRecovery')?.remove();return {ok:true,version:result.version};
 }catch(e){if(!committed&&JSON.stringify(db)===desiredText)db=JSON.parse(beforeText);throw e;}
 finally{if(locked){cloudBusy=false;lmSyncBusy=false;void lmSyncStatus();}}
}
function lmCustomerRecoveryNotice(error,retry){
 document.getElementById('lmCustomerRecovery')?.remove();
 const box=document.createElement('section');box.id='lmCustomerRecovery';box.setAttribute('role','status');box.className='warn';
 const title=document.createElement('strong');title.textContent='처리를 확인하거나 다시 진행할 수 있습니다';
 const message=document.createElement('p');message.textContent=error.message+' 서버 저장 여부가 불확실한 경우에도 최신 자료부터 확인하므로 중복 처리하지 않습니다.';
 box.append(title,message);
 if(error.conflicts?.length){const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('pre');summary.textContent='처리 전 · 이번 요청 · 서버 최신 내용 비교';list.textContent=JSON.stringify(error.comparison||error.conflicts,null,2);list.style.cssText='max-height:280px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere';details.append(summary,list);box.append(details);}
 if(retry&&!error.conflicts?.length){const button=document.createElement('button');button.type='button';button.textContent='최신 자료 확인 후 다시 처리';button.onclick=()=>{box.remove();retry();};box.append(button);}
 const latest=document.createElement('button');latest.type='button';latest.className=error.conflicts?.length?'':'alt';latest.textContent='재처리 중단 · PC 자료 보관 후 최신자료 열기';latest.onclick=()=>void lmResumeWithLatest();
 const backup=document.createElement('button');backup.type='button';backup.className='alt';backup.textContent='PC 복구자료 보기';backup.onclick=()=>void lmOpenSavedRecovery();
 box.append(latest,backup);const status=document.getElementById('cUnifiedStatus');if(status)status.after(box);else document.getElementById('view').prepend(box);
}
async function lmResumeWithLatest(){
 let locked=false;
 try{
  if(!authToken||!cloudReady)throw Error('직원 로그인과 자료 연결을 먼저 확인해 주세요.');
  if(cloudBusy||cloudPending||lmSyncSaving||lmSyncBusy)throw Error('저장이 끝난 뒤 다시 눌러 주세요.');
  if(lmActiveUnsavedForm())throw Error('작성 중인 입력란이 있습니다. 입력을 먼저 저장하거나 취소해 주세요.');
  cloudBusy=true;lmSyncBusy=true;locked=true;
  const rows=await lmSyncRows();if(rows.some(x=>!x.checkpointed&&['pending','conflict'].includes(x.status))){await lmSyncCenter();return;}
  if(!confirm('재처리를 중단하고 서버 최신 상태를 확인할까요?\nPC 자료와 기존 복구자료는 별도 보관하며 서버에 덮어쓰지 않습니다. 이미 완료된 서버 처리는 되돌리지 않습니다.'))return;
  const pending=await lmSafeGet();if(pending)await lmSafeArchivePending(pending);
  await lmSafePut(db,'사용자가 최신자료로 계속하기 전 PC 원본 보관');const snapshot=await lmSafeGet();if(snapshot)await lmSafeArchivePending(snapshot);
  await loadCloud();document.getElementById('lmRecoveryNotice')?.remove();document.getElementById('lmCustomerRecovery')?.remove();editing=null;render();
  lmRecoveryNonblockingNotice('PC 자료를 별도 보관하고 서버 최신 자료로 전환했습니다. 필요한 고객을 다시 선택해 처리하세요.');
 }catch(e){lmCustomerRecoveryNotice(e);}finally{if(locked){cloudBusy=false;lmSyncBusy=false;}}
}
