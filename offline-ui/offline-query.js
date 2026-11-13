(function(root){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x));
 function split(text){const out=[];let start=0,depth=0,quote=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'&&text[i-1]!=='\\')quote=!quote;if(!quote){if(c==='(')depth++;if(c===')')depth--;if(c===','&&depth===0){out.push(text.slice(start,i));start=i+1}}}out.push(text.slice(start));return out.filter(Boolean)}
 const field=(row,key)=>key.split(/->>?/).reduce((v,k)=>v?.[k.replace(/^"|"$/g,'')],row);
 const text=v=>typeof v==='object'?JSON.stringify(v):String(v??'');
 function test(row,key,expression){
  let neg=false,e=String(expression);if(e.startsWith('not.')){neg=true;e=e.slice(4)}
  const p=e.indexOf('.'),op=e.slice(0,p),raw=e.slice(p+1),v=field(row,key);let result;
  switch(op){
   case 'eq':result=String(v??'')===raw;break;
   case 'neq':result=String(v??'')!==raw;break;
   case 'is':result=raw==='null'?v==null:raw==='true'?v===true:raw==='false'?v===false:false;break;
   case 'in':result=split(raw.replace(/^\(|\)$/g,'')).map(x=>x.replace(/^"|"$/g,'')).includes(String(v??''));break;
   case 'like':case 'ilike':{const escaped=raw.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/[%*]/g,'.*').replace(/_/g,'.');result=new RegExp('^'+escaped+'$',op==='ilike'?'iu':'u').test(text(v));break}
   case 'gt':case 'gte':case 'lt':case 'lte':{const a=typeof v==='number'?v:String(v??''),b=typeof v==='number'?Number(raw):raw;result=op==='gt'?a>b:op==='gte'?a>=b:op==='lt'?a<b:a<=b;break}
   case 'cs':{let q;try{q=JSON.parse(raw)}catch{q=raw}result=text(v).toLowerCase().includes(text(q).toLowerCase());break}
   default:throw Error('PC 검색에서 지원하지 않는 조건: '+op);
  }return neg?!result:result;
 }
 function group(row,expression,kind){const terms=split(String(expression).replace(/^\(|\)$/g,''));const check=term=>{if(term.startsWith('or('))return group(row,term.slice(2),'or');if(term.startsWith('and('))return group(row,term.slice(3),'and');const p=term.indexOf('.');if(p<1)throw Error('검색 조건을 확인해 주세요.');return test(row,term.slice(0,p),term.slice(p+1))};return kind==='or'?terms.some(check):terms.every(check)}
 function select(rows,params={},paginate=true){
  let out=rows.filter(row=>Object.entries(params).every(([key,value])=>{if(['select','order','limit','offset','on_conflict'].includes(key))return true;if(key==='or'||key==='and')return group(row,value,key);return test(row,key,value)}));
  if(params.order){const rules=split(params.order).map(s=>{const [key,direction,...flags]=s.split('.');return {key,desc:direction==='desc',nullLast:flags.includes('nullslast')||(!flags.includes('nullsfirst')&&direction!=='desc')}});out=out.slice().sort((a,b)=>{for(const rule of rules){const x=field(a,rule.key),y=field(b,rule.key);if(x==null||y==null){if(x==null&&y==null)continue;return x==null?(rule.nullLast?1:-1):(rule.nullLast?-1:1)}const c=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'ko',{numeric:false});if(c)return rule.desc?-c:c}return 0})}
  if(paginate){const offset=Math.max(0,Number(params.offset)||0),limit=params.limit==null?out.length:Math.max(0,Number(params.limit)||0);out=out.slice(offset,offset+limit)}
  return out;
 }
 function rpc(tables,name,body={}){
  const q=String(body.p_query||'').trim().toLowerCase(),offset=Math.max(0,Number(body.p_offset)||0),limit=Math.max(1,Math.min(1000,Number(body.p_limit)||30));let rows;
  if(name==='lm_search_access_customers'){rows=(tables.lm_import_rows||[]).filter(r=>['고객매매','고객임대'].includes(r.source_table)&&(!q||JSON.stringify(r.original_data).toLowerCase().includes(q)));rows=select(rows,{order:'source_table.asc,source_row_number.asc'},false)}
  else if(name==='lm_search_onenote_pages'){const digits=q.replace(/\D/g,'');rows=(tables.lm_onenote_pages||[]).filter(r=>{const value=(String(r.title||'')+' '+String(r.body_text||'')).toLowerCase();return (!body.p_section||r.section===body.p_section)&&(!q||value.includes(q)||(digits.length>=4&&value.replace(/\D/g,'').includes(digits)))});rows=select(rows,{order:'page_created_at.desc.nullslast'},false)}
  else throw Error('이 검색은 온라인 연결이 필요합니다: '+name);
  return rows.slice(offset,offset+limit);
 }
 const api={select,rpc,split,clone};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LMOfflineQuery=api;
})(typeof window!=='undefined'?window:this);
