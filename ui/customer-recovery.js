/* Compare-and-swap transaction for customer list changes. No force writes. */
(function(root){'use strict';
async function commit({base,desired,read,write,merge,equal,unchanged,attempts=3}){
 const normalize=value=>{const out=JSON.parse(JSON.stringify(value));out.customerCompletionOverrides??={};out.customerCategoryOverrides??={};return out;};
 for(let attempt=0;attempt<attempts;attempt++){
  const latest=await read();if(!latest?.data||!Number.isFinite(latest.version))throw Error('서버 최신 자료를 확인하지 못했습니다.');
  if(!unchanged())throw Error('처리 중 다른 입력이 발생했습니다. 새 입력은 유지하고 이번 처리를 중단했습니다.');
  const b=normalize(base),local=normalize(desired),remote=normalize(latest.data);
  for(const group of ['customerCompletionOverrides','customerCategoryOverrides'])for(const key of Object.keys(local[group])){
   const before=b[group][key]||{},after=local[group][key],current=remote[group][key];if(!current)continue;
   const changed=Object.keys(after).filter(k=>!['at','deletedAt'].includes(k)&&!equal(after[k],before[k]));
   if(changed.length&&changed.every(k=>equal(after[k],current[k])))local[group][key]=current;
  }
  const result=merge(b,local,remote);
  if(result.conflicts.length){const e=Error('같은 고객 또는 연결 자료가 다른 창에서 수정되었습니다. 최신 내용을 확인한 뒤 다시 선택해 주세요.');e.conflicts=result.conflicts;e.latest=latest;e.comparison=result.conflicts.map(path=>{const at=path.indexOf('/'),group=path.slice(0,at),key=path.slice(at+1),find=data=>Array.isArray(data[group])?data[group].find(x=>String(x.id)===key):data[group]?.[key];return {자료:path,처리전:find(b)??'없음',이번요청:find(local)??'삭제',서버최신:find(remote)??'삭제됨'};});throw e;}
  if(equal(result.merged,normalize(latest.data)))return {data:latest.data,version:latest.version,alreadyApplied:true};
  const saved=await write(latest.version,result.merged);
  if(saved?.ok===true)return {data:result.merged,version:saved.version};
 }
 throw Error('다른 창에서 저장이 계속되고 있습니다. 잠시 후 다시 처리해 주세요.');
}
root.LMCustomerRecovery={commit};if(typeof module!=='undefined')module.exports=root.LMCustomerRecovery;
})(typeof window==='undefined'?globalThis:window);
