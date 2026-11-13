async function lmSyncRunVerification(output){
 output.textContent='가상 PC 4개의 독립 저장소와 격리된 시험 서버를 검증 중입니다. 실제 고객·매물은 변경하지 않습니다.\n';
 const lines=[],testId=crypto.randomUUID(),key='SYNC-TEST-'+testId,stores=[];
 const assert=(ok,label)=>{if(!ok)throw Error(label);lines.push('통과 · '+label);output.textContent=lines.join('\n')};
 const op=(device,record,before,after)=>({id:crypto.randomUUID(),actor_id:lmSyncActor,device_id:device,target:'core',collection:'customers',record_id:record,before,after});
 const send=x=>lmSyncRequest(x,testId);
 try{
  if(!authToken||!lmSyncActor)throw Error('온라인 직원 로그인 후 실행해 주세요.');
  for(let i=0;i<4;i++){
   const name='landmaker-isolated-sync-test-'+testId+'-'+i;stores.push(name);const operation=op('가상PC-'+i,key+'-'+i,null,{id:key+'-'+i,name:'가상 고객 '+i,phone:''});
   await lmSyncStore('readwrite',s=>s.add({id:operation.id,operation,status:'pending'}),name);
  }
  const queues=[];for(const name of stores){const rows=await lmSyncStore('readonly',(s,m,set)=>{const r=s.getAll();r.onsuccess=()=>set(r.result)},name);queues.push(rows[0]);}
  assert(queues.length===4&&queues.every(x=>x.status==='pending'),'4개 PC 독립 보관 · 저장소 재열기 후 입력 유지');
  const first=await send(queues[2].operation); // Deliberately do not acknowledge: simulate accepted request with lost response.
  const repeated=await send(queues[2].operation);
  assert(first.status==='applied'&&repeated.version===first.version,'서버 저장 직후 응답 유실 · 같은 전송번호 재시도 중복 없음');
  const rest=await Promise.all([0,3,1].map(i=>send(queues[i].operation)));
  assert(rest.every(x=>x.status==='applied'),'4개 PC의 신규 입력 동시 재접속 · 모두 반영');
  const base={id:key+'-shared',name:'기준 이름',phone:'기준 연락처',nested:{a:'원본',b:'원본'}};
  await send(op('가상PC-0',base.id,null,base));
  const a=op('가상PC-0',base.id,base,{...base,name:'직원A 변경'}),b=op('가상PC-1',base.id,base,{...base,phone:'직원B 변경'});
  const ab=await Promise.all([send(a),send(b)]);
  const probe=await send(op('확인',base.id,null,null));
  assert(ab.every(x=>x.status==='applied')&&probe.value.name==='직원A 변경'&&probe.value.phone==='직원B 변경','같은 고객의 서로 다른 항목 자동 병합');
  const conflict=await send(op('가상PC-2',base.id,base,{...base,name:'다른 이름'}));
  assert(conflict.status==='conflict'&&conflict.remote.name==='직원A 변경','같은 항목 충돌 · 서버 원본 유지 · 내 수정 기록 보관');
  const replay=await send(queues[2].operation);assert(replay.version===first.version,'다른 변경 후 과거 전송 재시도 · 최신 자료 덮어쓰기 없음');
  for(let i=0;i<4;i++){const check=await send(op('확인',key+'-'+i,null,null));assert(check.value?.name==='가상 고객 '+i,'PC '+(i+1)+' 입력 최종 존재 확인');}
  const wrong={...queues[0].operation,after:{...queues[0].operation.after,name:'변조'}};let rejected=false;try{await send(wrong)}catch{rejected=true}assert(rejected,'같은 전송번호로 다른 내용 전송 차단');
  const profileId=crypto.randomUUID(),profile={import_row_id:profileId,customer_name:'기준',phone:'원본'};
  const tableOp=(before,after)=>({...op('프로필 시험',profileId,before,after),target:'table',collection:'lm_access_customer_profiles'});
  await send(tableOp(null,profile));
  const edits=await Promise.all([send(tableOp(profile,{...profile,customer_name:'이름 수정'})),send(tableOp(profile,{...profile,phone:'연락처 수정'}))]);
  const last=edits.slice().sort((a,b)=>b.version-a.version)[0];
  assert(edits.every(x=>x.status==='applied')&&last.value.customer_name==='이름 수정'&&last.value.phone==='연락처 수정','엑세스 기존 고객의 동시 수정도 항목별 병합');
  output.textContent=lines.join('\n')+'\n\n검증 완료. 실제 업무자료 변경 없음. 시험번호 '+testId;
 }catch(e){output.textContent=lines.join('\n')+'\n실패 · '+e.message;throw e}
}
