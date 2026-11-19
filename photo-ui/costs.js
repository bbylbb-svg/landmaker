/* Public rates only. No account credentials or billing tokens in the browser. */
(function(root){
'use strict';
const GB=1e9,number=v=>v===''||v===null||v===undefined?null:(Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null);
function calculate(u,readings={}){
 const bytes=number(u.bytes)||0,a=number(u.classA)||0,b=number(u.classB)||0;
 const egress=number(readings.naver),supabase=number(readings.supabase);
 return {storageGB:bytes/GB,storageMonthly:bytes/GB*28*1.1,requests:(a/10000*45+b/10000*4)*1.1,transfer:egress===null||egress>5000?null:egress*100*1.1,supabaseRemaining:supabase===null?null:Math.max(0,5-supabase),supabaseOver:supabase===null?null:Math.max(0,supabase-5),storageRemaining:Math.max(0,(u.limits.max_bytes-bytes)/GB),writeRemaining:Math.max(0,u.limits.max_class_a-a),readRemaining:Math.max(0,u.limits.max_class_b-b)};
}
function mount(host,client){
 const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(new Date()),key='lm-photo-billing-reading-v1:'+month;
 const money=v=>v===null?'미확인':v.toLocaleString('ko-KR',{maximumFractionDigits:1})+'원',gb=v=>v===null?'미확인':v.toLocaleString('ko-KR',{maximumFractionDigits:3})+'GB';let usage=null;
 host.innerHTML=`<details class="lm-photo-costs" open><summary>사용량 · 남은 한도 · 예상 비용</summary><p><strong>월 1,400원 고정 요금이 아닙니다.</strong> 네이버클라우드는 저장·요청·인터넷 전송량에 따라 과금됩니다. 아래 앱 제한은 무료 제공량이나 청구 상한이 아닙니다.</p><button type="button" data-cost-refresh>앱 집계 새로고침</button><p data-cost-state role="status">앱 사용량 확인 중…</p><div data-cost-auto></div><details><summary>계정 사용량 입력 및 비용 계산</summary><p>자동 청구 연동 전입니다. 각 서비스 대시보드에서 같은 이용 기간의 누적값을 확인해 입력하세요. 입력값은 이 기기에만 보관되며 직원 간 공유되지 않습니다. 실제 사용량이 늘면 다시 입력해야 합니다.</p><label>대시보드 이용 기간 <input data-period type="text" maxlength="80" placeholder="예: 11월 1일~30일"></label><label>네이버클라우드 인터넷 전송량(GB) <input data-naver type="number" min="0" step="any" placeholder="미확인"></label><label>Supabase 일반 전송량(uncached GB) <input data-supabase type="number" min="0" step="any" placeholder="미확인"></label><button type="button" data-cost-save>확인한 사용량 저장·계산</button><p data-cost-checked></p></details><div data-cost-result></div><p>Supabase Free: 일반 전송 월 5GB, 캐시 전송 별도 5GB. 서로 합쳐 쓸 수 없습니다. 현재 사진 중계는 일반 전송량에도 영향을 줍니다. 무료 한도 초과가 자동 유료 전환을 뜻하지는 않지만 이용이 제한될 수 있습니다.</p><p>네이버 단가(한국 Standard, 부가세 포함): 저장 30.8원/GB·월, 쓰기 49.5원/1만 회, 읽기 4.4원/1만 회, 인터넷 전송 첫 5TB 구간 110원/GB. 2026-11-19 확인. 할인·크레딧·청구 단위 반올림 등은 미반영입니다.</p><p><a href="https://www.ncloud.com/charge/region/ko" target="_blank" rel="noopener noreferrer">네이버 공식 요금</a> · <a href="https://supabase.com/dashboard/org/nppkfqvdvfyolqhomoya/usage" target="_blank" rel="noopener noreferrer">Supabase 계정 사용량</a> · <a href="https://supabase.com/docs/guides/platform/manage-your-usage/egress" target="_blank" rel="noopener noreferrer">Supabase 전송 한도</a></p></details>`;
 const $=s=>host.querySelector(s);let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
 for(const name of ['naver','supabase','period'])$('[data-'+name+']').value=saved[name]??'';
 function render(){
  $('[data-cost-checked]').textContent=saved.at?'수동 확인: '+new Date(saved.at).toLocaleString('ko-KR')+' · '+(saved.period||'이용 기간 미기재'):'계정 사용량 미확인 · 0원으로 간주하지 않습니다.';
  if(!usage)return;const c=calculate(usage,saved);
  $('[data-cost-auto]').textContent=`자동 집계(이 앱 사진 전용): ${usage.count}장 · 예약·보관 포함 ${gb(c.storageGB)} / ${gb(usage.limits.max_bytes/GB)} · 앱 저장 여유 ${gb(c.storageRemaining)} · 이번 달 쓰기 ${usage.classA}회(잔여 ${c.writeRemaining}회) · 읽기 ${usage.classB}회(잔여 ${c.readRemaining}회). 삭제 연결도 원본 보관 중이면 용량에 포함됩니다.`;
  const sup=c.supabaseRemaining===null?'Supabase 잔여 한도: 미확인':`Supabase 일반 전송 잔여 ${gb(c.supabaseRemaining)} / 5GB${c.supabaseOver>0?' · 초과 '+gb(c.supabaseOver)+' · 이용 제한 주의':''} (수동 확인값 기준)`;
  const result=$('[data-cost-result]');result.replaceChildren();
  for(const line of [sup,'Supabase Free 추가 청구: 0원(무료 플랜 유지 시). 현재 플랜·계정 전체 사용량 자동 확인 전입니다.',`네이버 현재 보관량을 한 달 유지할 때 저장료 추정 ${money(c.storageMonthly)} · 이번 달 앱 요청료 추정 ${money(c.requests)} · 입력한 전송량 요금 ${money(c.transfer)}`,c.transfer===null?'네이버 총액: 계산 불가 · 전송량 미확인 또는 5TB 초과 구간. 실제 청구액은 서비스 대시보드에서 확인하세요.':`네이버 참고 합계 ${money(c.storageMonthly+c.requests+c.transfer)} (현재 용량 한 달 유지 가정 + 앱 요청 + 입력 전송량). 이번 달 확정 누적 청구액이 아닙니다.`,'월 1,400원 대비 예상 추가액: '+(c.transfer===null?'미확인':money(Math.max(0,c.storageMonthly+c.requests+c.transfer-1400)))+' · 1,400원은 무료 한도나 약정 요금이 아닙니다.','집계 범위: 사진 앱 요청은 예약·실패를 포함할 수 있어 실제 청구와 다릅니다. 네이버 저장료는 월평균 용량으로 청구되며, 이 화면은 현재 용량으로 추정합니다. Supabase의 다른 DB·인증·전송·함수 사용량과 기타 유료 서비스 비용은 합계에 포함하지 않습니다.']){const p=document.createElement('p');p.textContent=line;result.append(p);}
  result.classList.toggle('is-warning',c.supabaseOver>0);
 }
 $('[data-cost-save]').onclick=()=>{for(const name of ['naver','supabase']){const input=$('[data-'+name+']');if(!input.checkValidity()||(input.value!==''&&number(input.value)===null)){input.reportValidity();return;}}saved={naver:$('[data-naver]').value,supabase:$('[data-supabase]').value,period:$('[data-period]').value,at:new Date().toISOString()};try{localStorage.setItem(key,JSON.stringify(saved));}catch{}render();};
 let alive=true;async function refresh(){const button=$('[data-cost-refresh]');button.disabled=true;try{const u=await client.api('usage');if(!alive)return;if(!u.limits)throw Error('사용량 응답 오류');usage=u;render();$('[data-cost-state]').textContent='앱 집계 확인: '+new Date().toLocaleString('ko-KR')+' · 월별 요청 집계는 서버 UTC 기준';}catch(e){if(alive)$('[data-cost-state]').textContent='앱 사용량 확인 실패 · '+e.message;}finally{if(alive)button.disabled=false;}}
 $('[data-cost-refresh]').onclick=()=>void refresh();render();void refresh();return ()=>{alive=false;};
}
root.LMPhotoCosts={calculate,mount};if(typeof module!=='undefined')module.exports=root.LMPhotoCosts;
})(typeof window==='undefined'?globalThis:window);
