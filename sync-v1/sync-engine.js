(function(root){
 'use strict';
 const groups=['customers','properties','records','schedules','transactions','ownership','quick','auditLog','propertyGroups'];
 const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
 const stable=x=>JSON.stringify(x===undefined?null:x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
 const equal=(a,b)=>stable(a)===stable(b);
 function diff(before,after){
  const changes=[];
  for(const group of groups){
   const map=arr=>{const m=new Map();for(const row of arr||[]){if(!row||row.id==null||m.has(String(row.id)))throw Error('중복 또는 없는 자료번호: '+group);m.set(String(row.id),row)}return m};
   const b=map(before[group]),a=map(after[group]);
   for(const rid of new Set([...b.keys(),...a.keys()]))if(!equal(b.get(rid),a.get(rid))){if(group==='auditLog'&&!a.has(rid))continue;changes.push({target:'core',collection:group,record_id:rid,before:clone(b.get(rid)??null),after:clone(a.get(rid)??null)})}
  }
  const maps=['customerCompletionOverrides','customerCategoryOverrides'];
  for(const group of maps){const b=before[group]||{},a=after[group]||{};for(const rid of new Set([...Object.keys(b),...Object.keys(a)]))if(!equal(b[rid],a[rid]))changes.push({target:'map',collection:group,record_id:rid,before:clone(b[rid]??null),after:clone(a[rid]??null)})}
  for(const k of new Set([...Object.keys(before),...Object.keys(after)]))if(!groups.includes(k)&&!maps.includes(k)&&!equal(before[k],after[k]))throw Error('이 항목은 오프라인 저장을 지원하지 않습니다: '+k);
  return changes;
 }
 function apply(state,op){
  if(op.target==='core'){state[op.collection]=(state[op.collection]||[]).filter(x=>String(x.id)!==op.record_id);if(op.after!==null)state[op.collection].push(clone(op.after))}
  else if(op.target==='map'){state[op.collection]??={};if(op.after===null)delete state[op.collection][op.record_id];else state[op.collection][op.record_id]=clone(op.after)}
  else if(op.target==='table'){state.archives??={tables:{}};state.archives.tables??={};const key=tableKeys[op.collection];if(!key)throw Error('지원하지 않는 자료');state.archives.tables[op.collection]=(state.archives.tables[op.collection]||[]).filter(x=>String(x[key])!==op.record_id);if(op.after!==null)state.archives.tables[op.collection].push(clone(op.after))}
  return state;
 }
 const tableKeys={lm_access_customer_profiles:'import_row_id',lm_access_property_edits:'source_id',lm_onenote_customer_profiles:'source_page_id',lm_onenote_edits:'source_page_id',lm_access_customer_consultations:'id',lm_new_properties:'id'};
 function merge(b,l,r,path=''){
  if(equal(l,b))return {value:clone(r),conflicts:[]};if(equal(r,b)||equal(l,r))return {value:clone(l),conflicts:[]};
  const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
  if(obj(b)&&obj(l)&&obj(r)){const value={},conflicts=[];for(const k of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){if(['updatedAt','updatedBy','updated_at','updated_by'].includes(k)){value[k]=clone(l[k]??r[k]);continue}const m=merge(b[k],l[k],r[k],path+'/'+k);if(m.value!==undefined)value[k]=m.value;conflicts.push(...m.conflicts)}return {value,conflicts}}
  return {value:clone(r),conflicts:[path]};
 }
 const api={groups,clone,equal,diff,apply,merge,tableKeys};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LMSyncEngine=api;
})(typeof window!=='undefined'?window:this);
