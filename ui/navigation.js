/* Explicit navigation may leave an editor only after its recovery copy is verified. */
(function(){'use strict';
function preserveProperty(){
 const form=document.querySelector('#propertyForm');if(!form||!window.lmPropertyDraftDirty)return true;
 clearTimeout(lmPropertyDraftTimer);const started=Date.now();
 try{lmCapturePropertyDraft();const draft=JSON.parse(localStorage.getItem(LM_PROPERTY_DRAFT_KEY)||'null');const fields=[...form.querySelectorAll('input,select,textarea,[contenteditable="true"]')].filter(el=>!['file','button','submit'].includes(el.type)).map(el=>({name:el.name||'',type:el.type||'',html:el.hasAttribute('contenteditable'),value:el.hasAttribute('contenteditable')?el.innerHTML:el.value,checked:!!el.checked}));
  if(!draft||draft.at<started||JSON.stringify(draft.fields)!==JSON.stringify(fields))throw Error('입력내용의 복구 사본을 확인하지 못했습니다.');
 }catch(e){alert('매물 입력내용을 임시 보관하지 못해 이동을 중단했습니다. 현재 화면은 유지됩니다. 전체매물에 저장하거나 복구자료를 확인해 주세요.');return false;}
 window.lmPropertyDraftDirty=false;return true;
}
document.addEventListener('click',e=>{
 const b=e.target.closest?.('#nav button[data-nav]');if(!b)return;
 e.preventDefault();e.stopImmediatePropagation();
 if(lmFormDirty&&document.querySelector('#customerForm')&&!confirm('고객정보를 아직 저장하지 않았습니다. 입력 내용을 버리고 이동할까요?'))return;
 const hadDraft=!!window.lmPropertyDraftDirty;if(!preserveProperty())return;
 lmFormDirty=false;tab=b.dataset.nav;editing=null;window.lmShowPropertyForm=tab==='properties';if(tab==='quickCustomer'||tab==='quickProperty')editing={quickMode:tab==='quickProperty'?'property':'customer'};
 close();render();document.body.classList.remove('lm-mobile-nav-open');document.getElementById('lmMobileMenu')?.setAttribute('aria-expanded','false');if(hadDraft)showSaveStatus('수정 내용은 이 기기에 임시 보관했습니다. 같은 매물을 다시 열면 복원할 수 있습니다. 서버 저장은 전체매물에 저장을 눌러 주세요.',false);
},true);
})();
