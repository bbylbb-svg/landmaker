/* Private photo UI: no images, tokens, signed links or original files in localStorage. */
(function(root){
'use strict';
const MAX=700*1024;
function dimensions(width,height,edge){const ratio=Math.min(1,edge/Math.max(width,height));return {width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio))};}
async function encode(file,edge,maxBytes){
 if(file.size>40*1024*1024)throw Error('원본은 40MB 이하로 선택하세요.');
 if(!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type))throw Error('JPEG·PNG·WebP 사진을 선택하세요. HEIC는 기기 지원이 필요합니다.');
 let bitmap;try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw Error('이 사진은 기기에서 변환할 수 없습니다. JPEG로 저장 후 선택하세요.');}
 try{
  const {width,height}=dimensions(bitmap.width,bitmap.height,edge),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('사진 변환을 지원하지 않습니다.');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);
  let blob;for(const quality of [.9,.84,.78,.72,.65,.58,.50,.42,.35]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(!blob)throw Error('사진 변환 실패');if(blob.size<=maxBytes)break;}
  if(blob.size>maxBytes)throw Error('1920px 사진의 용량을 줄이지 못했습니다. 다른 사진을 선택하세요.');
  canvas.width=1;canvas.height=1;return blob;
 }finally{bitmap.close();}
}
async function compress(file){return {full:await encode(file,1920,MAX),thumb:await encode(file,360,75*1024)};}
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class PhotoClient {
 constructor({endpoint,getToken}){this.endpoint=endpoint?.replace(/\/$/,'');this.getToken=getToken;}
 async token(){if(!this.endpoint)throw Error('사진 저장소 연결 전입니다. 테스트 서버 설정이 필요합니다.');if(!/^https:\/\//.test(this.endpoint)&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(this.endpoint))throw Error('사진 서버 주소 오류');const t=await this.getToken();if(!t)throw Error('온라인 직원 로그인이 필요합니다.');return t;}
 async api(action,args={}){const token=await this.token(),r=await fetch(this.endpoint+'/api',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action,...args}),cache:'no-store',referrerPolicy:'no-referrer'});const data=await r.json();if(!r.ok)throw Error(data.error||'사진 요청 실패');return data;}
 async media(propertyId,assetId,variant='full',purpose='view'){
  const t=await this.api('ticket',{propertyId,assetId,variant,purpose}),token=await this.token();
  const u=new URL(t.url);if(u.origin!==new URL(this.endpoint).origin)throw Error('사진 서버 응답 주소 오류');
  const r=await fetch(t.url,{headers:{Authorization:'Bearer '+token},cache:'no-store',referrerPolicy:'no-referrer'});if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.error||'사진 조회 실패');}return r.blob();
 }
 async upload(propertyId,compressed,onProgress=()=>{}){
  const token=await this.token();const form=new FormData();form.append('propertyId',propertyId);form.append('full',compressed.full,'photo.jpg');form.append('thumb',compressed.thumb,'thumb.jpg');
  return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',this.endpoint+'/upload');xhr.timeout=90000;xhr.setRequestHeader('Authorization','Bearer '+token);xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};xhr.onerror=()=>reject(Error('네트워크 오류 · 재시도하세요.'));xhr.ontimeout=()=>reject(Error('시간 초과 · 잠시 후 재시도하세요.'));xhr.onload=()=>{let j;try{j=JSON.parse(xhr.responseText);}catch{reject(Error('사진 서버 응답 오류'));return;}if(xhr.status>=200&&xhr.status<300)resolve(j);else reject(Error(j.error||'업로드 실패'));};xhr.send(form);});
 }
}
function mount(host,client,propertyId,{adsOnly=false}={}){
 const urls=new Set();let photos=[],permissions={},queue=[],busy=false,alive=true,trash=false,lightbox=null;let generation=0;
 host.innerHTML=`<section class="lm-photos"><h3>${adsOnly?'광고용 승인 사진':'매물 사진'}</h3><p class="muted">직원 전용 비공개 갤러리 · 사진을 선택하면 자동으로 저장됩니다.</p><div data-controls><label>갤러리에서 여러 장 선택<input data-pick disabled type="file" accept="image/*" multiple></label><label>카메라로 촬영<input data-camera disabled type="file" accept="image/*" capture="environment"></label></div><div class="row"><button data-refresh type="button">사진 새로고침</button><button data-trash type="button" class="alt">삭제한 사진 보기</button><button data-usage type="button" class="alt">저장 용량</button></div><p data-status role="status"></p><div data-queue></div><div class="lm-photo-grid" data-grid></div></section>`;
 const $=q=>host.querySelector(q),status=t=>{if(alive)$('[data-status]').textContent=t;};
 if(adsOnly){$('[data-controls]').hidden=true;$('[data-trash]').hidden=true;}
 function revoke(){for(const u of urls)URL.revokeObjectURL(u);urls.clear();}
 function blobURL(blob){const u=URL.createObjectURL(blob);urls.add(u);return u;}
 async function download(p){const blob=await client.media(propertyId,p.asset_id,'full','download');if(!alive)return;const u=blobURL(blob),a=document.createElement('a');a.href=u;a.download='광고사진-'+p.asset_id+'.jpg';a.click();setTimeout(()=>{URL.revokeObjectURL(u);urls.delete(u);},10000);}
 async function show(i){
  if(!photos.length)return;const p=photos[i];if(p.deleted_at)return;const active=photos.map((p,i)=>({p,i})).filter(x=>!x.p.deleted_at),activeAt=active.findIndex(x=>x.i===i);
  if(lightbox)lightbox.remove();const dialog=document.createElement('dialog');lightbox=dialog;dialog.className='lm-photo-lightbox';dialog.innerHTML='<div class="row"><button data-prev type="button">← 이전</button><button data-next type="button">다음 →</button><button data-close type="button">닫기</button></div><p data-caption></p><img alt="선택 매물 확대 사진">';document.body.append(dialog);dialog.querySelector('[data-caption]').textContent=(activeAt+1)+' / '+active.length;dialog.showModal();
  dialog.querySelector('[data-close]').onclick=()=>{dialog.close();dialog.remove();};dialog.querySelector('[data-prev]').onclick=()=>void show(active[(activeAt+active.length-1)%active.length].i);dialog.querySelector('[data-next]').onclick=()=>void show(active[(activeAt+1)%active.length].i);dialog.onkeydown=e=>{if(e.key==='ArrowLeft')dialog.querySelector('[data-prev]').click();if(e.key==='ArrowRight')dialog.querySelector('[data-next]').click();};
  try{const b=await client.media(propertyId,p.asset_id);if(alive&&dialog.isConnected)dialog.querySelector('img').src=blobURL(b);}catch(e){dialog.querySelector('[data-caption]').textContent=e.message;}
 }
 async function mutate(action,args){if(busy)return;busy=true;try{await client.api(action,{propertyId,...args});await refresh();}catch(e){status(e.message);}finally{busy=false;}}
 async function refresh(){
  const ticket=++generation;status('사진 조회 중…');try{
   const result=await client.api('list',{propertyId,adsOnly,trash});if(!alive||ticket!==generation)return;
   revoke();photos=result.photos;permissions=result.permissions;const disabled=!permissions.can_edit;
   for(const el of host.querySelectorAll('[data-controls] input'))el.disabled=disabled;
   $('[data-grid]').innerHTML=photos.map((p,i)=>`<article data-id="${safe(p.asset_id)}"><button type="button" data-enlarge="${i}" ${p.deleted_at?'disabled':''}><img alt="매물 사진 ${i+1}" loading="lazy"><span>${p.is_cover?'★ 대표사진 · ':''}${p.ad_approved?'광고 승인':'내부용'}${p.deleted_at?' · 삭제됨':''}</span></button><div class="row">${p.deleted_at?`<button data-act="restore" ${disabled?'disabled':''}>복원</button>`:`${adsOnly?'':`<button data-act="cover" ${disabled?'disabled':''}>대표</button><button data-act="up" ${disabled?'disabled':''}>앞으로</button><button data-act="down" ${disabled?'disabled':''}>뒤로</button><button data-act="approve" ${!permissions.can_approve?'disabled':''}>${p.ad_approved?'광고 승인 취소':'광고 승인'}</button><button data-act="link" ${disabled?'disabled':''}>다른 매물 연결</button><button data-act="unlink" class="danger" ${disabled?'disabled':''}>삭제</button>`}${p.ad_approved?'<button data-act="download">광고 사진 다운로드</button>':''}`}</div></article>`).join('');
   status(photos.length?photos.length+'장 · 사진을 누르면 확대됩니다.':'등록된 사진이 없습니다.');
   // Sequential reads avoid a burst of R2 and database requests on mobile.
   for(const p of photos){if(!alive||ticket!==generation)break;if(p.deleted_at)continue;try{const b=await client.media(propertyId,p.asset_id,'thumb');if(!alive||ticket!==generation)break;const img=$('[data-id="'+p.asset_id+'"] img');if(img)img.src=blobURL(b);}catch(e){if(ticket===generation)status(e.message);}}
  }catch(e){status(e.message);}
 }
 function drawQueue(){if(!alive)return;$('[data-queue]').innerHTML=queue.map((q,i)=>`<p>${safe(q.name)} · ${safe(q.status)} <progress max="100" value="${q.progress}"></progress> ${q.failed?`<button data-retry="${i}" type="button">재시도</button>`:''}</p>`).join('');}
 async function run(q){q.failed=false;q.status='사진 변환 중';q.progress=0;drawQueue();try{q.compressed??=await compress(q.file);q.file=null;q.status='업로드 중';drawQueue();await client.upload(propertyId,q.compressed,n=>{q.progress=n;drawQueue();});q.status='저장 완료';q.progress=100;q.compressed=null;}catch(e){q.failed=true;q.status=e.message;}drawQueue();}
 async function select(files){if(busy)return;busy=true;try{for(const file of [...files]){const q={file,name:file.name,status:'대기',progress:0};queue.push(q);await run(q);}await refresh();}finally{busy=false;}}
 $('[data-pick]').onchange=e=>{const fs=[...e.target.files];e.target.value='';void select(fs);};$('[data-camera]').onchange=e=>{const fs=[...e.target.files];e.target.value='';void select(fs);};
 $('[data-queue]').onclick=async e=>{const b=e.target.closest('[data-retry]');if(!b||busy)return;busy=true;try{await run(queue[+b.dataset.retry]);await refresh();}finally{busy=false;}};
 $('[data-grid]').onclick=async e=>{
  const enlarge=e.target.closest('[data-enlarge]');if(enlarge){void show(+enlarge.dataset.enlarge);return;}
  const b=e.target.closest('[data-act]');if(!b||b.disabled||busy)return;const aid=b.closest('[data-id]').dataset.id,p=photos.find(x=>x.asset_id===aid),act=b.dataset.act;
  if(act==='download'){try{await download(p);}catch(e){status(e.message);}return;}
  if(act==='cover')return mutate('update',{assetId:aid,cover:true});
  if(act==='approve')return mutate('update',{assetId:aid,adApproved:!p.ad_approved});
  if(act==='link'){const target=prompt('연결할 다른 매물의 고유 ID를 입력하세요.');if(target?.trim()){try{await client.api('link',{propertyId:target.trim(),sourcePropertyId:propertyId,assetId:aid});status('다른 매물에 연결했습니다. 광고 승인은 별도로 필요합니다.');}catch(e){status(e.message);}}return;}
  if(act==='unlink'&&!confirm('이 매물의 사진 연결을 삭제할까요? 원본은 보관되며 복원할 수 있습니다.'))return;
  if(['unlink','restore'].includes(act))return mutate(act,{assetId:aid});
  if(['up','down'].includes(act)){const ids=photos.filter(x=>!x.deleted_at).map(x=>x.asset_id),at=ids.indexOf(aid),next=at+(act==='up'?-1:1);if(next<0||next>=ids.length)return;[ids[at],ids[next]]=[ids[next],ids[at]];return mutate('reorder',{assetIds:ids});}
 };
 $('[data-refresh]').onclick=()=>void refresh();$('[data-trash]').onclick=()=>{trash=!trash;$('[data-trash]').textContent=trash?'현재 사진 보기':'삭제한 사진 보기';void refresh();};
 $('[data-usage]').onclick=async()=>{try{const u=await client.api('usage');status(`사진 ${u.count}장 · 예약 포함 ${(u.bytes/1e9).toFixed(3)}GB / ${(u.limits.max_bytes/1e9).toFixed(1)}GB · 이번 달 쓰기 ${u.classA}/${u.limits.max_class_a} · 읽기 ${u.classB}/${u.limits.max_class_b} · ${u.scope}`);}catch(e){status(e.message);}};
 void refresh();return ()=>{alive=false;++generation;revoke();lightbox?.remove();queue=[];};
}
root.LMPrivatePhotos={PhotoClient,mount,compress,dimensions};
if(typeof module!=='undefined')module.exports=root.LMPrivatePhotos;
})(typeof window==='undefined'?globalThis:window);
