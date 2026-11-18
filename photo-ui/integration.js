(function(){
'use strict';
const config=window.LM_PHOTO_CONFIG||{},client=new LMPrivatePhotos.PhotoClient({endpoint:config.endpoint,getToken:async()=>{await ensureFreshAuth();return authToken;}});
function clearOnLogout(){for(const d of document.querySelectorAll('[data-lm-photo-dialog]'))d.close();for(const [b,u] of coverURLs){URL.revokeObjectURL(u);b.replaceChildren(document.createTextNode('사진'));delete b.dataset.coverLoaded;}coverURLs.clear();}
let previousToken='';setInterval(()=>{const t=typeof authToken==='undefined'?'':authToken;if(previousToken&&!t)clearOnLogout();previousToken=t;},1000);
window.lmPhotoLaunch=function(propertyId,{adsOnly=false}={}){
 const dialog=document.createElement('dialog');dialog.className='lm-photo-dialog';dialog.dataset.lmPhotoDialog='true';const close=document.createElement('button');close.type='button';close.textContent='사진 창 닫기';const host=document.createElement('div');dialog.append(close,host);document.body.append(dialog);dialog.showModal();const cleanup=LMPrivatePhotos.mount(host,client,String(propertyId),{adsOnly});let cleaned=false;dialog.addEventListener('close',()=>{if(cleaned)return;cleaned=true;cleanup();dialog.remove();});close.onclick=()=>dialog.close();
};
window.lmPhotoAttachAds=function(propertyId){
 const target=document.getElementById('lmAdSelected');if(!target)return;let button=document.getElementById('lmAdApprovedPhotos');if(!button){button=document.createElement('button');button.id='lmAdApprovedPhotos';button.type='button';button.textContent='광고 승인 사진 불러오기 · 다운로드';target.after(button);}button.onclick=()=>window.lmPhotoLaunch(propertyId,{adsOnly:true});
};
document.addEventListener('click',e=>{const b=e.target.closest('[data-lm-photo-property]');if(!b)return;e.preventDefault();e.stopPropagation();window.lmPhotoLaunch(b.dataset.lmPhotoProperty);},true);
function bindForm(){const f=document.querySelector('#propertyForm');if(!f||f.querySelector('[data-photo-form]'))return;const propertyId=f.querySelector('[name=id]')?.value;const box=document.createElement('details');box.dataset.photoForm='true';const title=document.createElement('summary');title.textContent='매물 사진 · 업로드 / 갤러리';box.append(title);f.append(box);if(!propertyId){const p=document.createElement('p');p.textContent='매물을 공동 서버에 저장한 뒤 다시 열면 사진을 연결할 수 있습니다.';box.append(p);return;}const b=document.createElement('button');b.type='button';b.textContent='이 매물 사진 열기';b.onclick=()=>window.lmPhotoLaunch(propertyId);box.append(b);}
let coverTimer;const coverURLs=new Map();let coverRunning=false,coverAgain=false;
async function covers(){
 if(coverRunning){coverAgain=true;return;}coverRunning=true;
 try{
  for(const [b,u] of coverURLs){if(!b.isConnected){URL.revokeObjectURL(u);coverURLs.delete(b);}}
  if(!config.endpoint||typeof authToken==='undefined'||!authToken)return;
  const buttons=[...document.querySelectorAll('[data-lm-photo-property]:not([data-cover-loaded])')].filter(b=>b.getBoundingClientRect().top<innerHeight+400).slice(0,100);if(!buttons.length)return;
  buttons.forEach(b=>b.dataset.coverLoaded='pending');
  try{const found=await client.api('covers',{propertyIds:[...new Set(buttons.map(b=>b.dataset.lmPhotoProperty))]});
   for(const b of buttons){if(!b.isConnected)continue;const p=found.find(x=>x.propertyId===b.dataset.lmPhotoProperty);if(!p){b.dataset.coverLoaded='empty';continue;}try{const blob=await client.media(p.propertyId,p.assetId,'thumb');if(!b.isConnected)continue;const u=URL.createObjectURL(blob),img=document.createElement('img');img.className='lm-photo-cover';img.alt='대표 사진';img.src=u;b.replaceChildren(img);coverURLs.set(b,u);b.dataset.coverLoaded='yes';}catch{b.textContent='사진 재조회';b.dataset.coverLoaded='error';}}
  }catch{buttons.forEach(b=>{delete b.dataset.coverLoaded;});}
 }finally{coverRunning=false;if(coverAgain){coverAgain=false;clearTimeout(coverTimer);coverTimer=setTimeout(covers,150);}}
}
new MutationObserver(()=>{bindForm();clearTimeout(coverTimer);coverTimer=setTimeout(covers,150);}).observe(document.body,{childList:true,subtree:true});
document.addEventListener('scroll',()=>{clearTimeout(coverTimer);coverTimer=setTimeout(covers,150);},true);
bindForm();
})();
