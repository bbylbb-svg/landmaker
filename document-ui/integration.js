(function(){'use strict';
const photoEndpoint=window.LM_PHOTO_CONFIG?.endpoint||'',endpoint=photoEndpoint.replace(/\/landmaker-photos$/,'/landmaker-documents');
const client=new LMDocuments.DocumentClient({endpoint:endpoint!==photoEndpoint?endpoint:'',getToken:async()=>{await ensureFreshAuth();return authToken;}});
const checkedFiles=new Map(), pendingCells=[];
let activeChecks=0;
function checkVisibleFiles(){
 while(activeChecks<4&&pendingCells.length){
  const cell=pendingCells.shift();
  if(!cell.isConnected)continue;
  activeChecks++;
  const id=cell.dataset.lmSheetFiles;
  const cached=checkedFiles.get(id);
  const request=cached&&cached.until>Date.now()?cached.request:client.api('list',{propertyId:id,trash:false});
  checkedFiles.set(id,{request,until:Date.now()+60000});
  if(checkedFiles.size>256)checkedFiles.delete(checkedFiles.keys().next().value);
  request.then(result=>{
   if(!cell.isConnected)return;
   const files=(result.files||[]).filter(file=>!file.deleted_at&&/^xlsx?$/i.test(file.extension));
   if(!files.length)return;
   const button=document.createElement('button');
   button.type='button';button.className='alt';button.textContent='매물장';
   button.title=files.length===1?files[0].file_name:'첨부 매물장 '+files.length+'개';
   button.onclick=async event=>{
    event.stopPropagation();
    const file=files[0];
    if(files.length!==1||String(file.extension).toLowerCase()!=='xlsx'||!window.LMXlsxEditor){
     window.lmDocumentLaunch(id);return;
    }
    button.disabled=true;
    try{
     const blob=await client.download(id,file);
     if(!cell.isConnected)return;
     await window.LMXlsxEditor.show({blob,file,client,propertyId:id,canEdit:!!result.permissions?.can_edit,onSaved:()=>refreshShortcuts(id)});
    }catch{if(cell.isConnected)window.lmDocumentLaunch(id);}
    finally{button.disabled=false}
   };
   cell.replaceChildren(button);
  }).catch(()=>{checkedFiles.delete(id)}).finally(()=>{activeChecks--;checkVisibleFiles()});
 }
}
const fileObserver=new IntersectionObserver(entries=>{
 for(const {target,isIntersecting} of entries){
  if(!isIntersecting)continue;
  fileObserver.unobserve(target);
  pendingCells.push(target);
 }
 checkVisibleFiles();
});
function refreshShortcuts(id){
 checkedFiles.delete(id);
 for(const cell of document.querySelectorAll('[data-lm-sheet-files]')){
  if(cell.dataset.lmSheetFiles!==id)continue;
  cell.replaceChildren();
  fileObserver.observe(cell);
 }
}

const observedCells=new WeakSet();
window.lmDocumentLaunch=function(id){const d=document.createElement('dialog');d.className='lm-document-dialog';d.dataset.lmDocumentDialog='true';d.innerHTML='<button type="button" data-doc-close>닫기</button><div data-doc-host></div>';document.body.append(d);d.showModal();const cleanup=LMDocuments.mount(d.querySelector('[data-doc-host]'),client,String(id));const timer=setInterval(()=>{if(typeof authToken!=='undefined'&&!authToken)d.close();},1000);d.querySelector('[data-doc-close]').onclick=()=>d.close();d.addEventListener('close',()=>{clearInterval(timer);cleanup();d.remove();refreshShortcuts(String(id));});};
function bind(){for(const cell of document.querySelectorAll('[data-lm-sheet-files]')){if(observedCells.has(cell))continue;observedCells.add(cell);fileObserver.observe(cell);}for(const b of document.querySelectorAll('[data-lm-photo-property]')){const id=b.dataset.lmPhotoProperty;if([...b.parentElement.children].some(x=>x.dataset?.lmDocs===id))continue;const open=document.createElement('button');open.type='button';open.className='alt';open.dataset.lmDocs=id;open.textContent='문서 첨부 · 매물장';b.parentElement.append(open);}const f=document.querySelector('#propertyForm'),id=f?.querySelector('[name=id]')?.value;if(f&&id&&!f.querySelector('[data-lm-docs]')){const b=document.createElement('button');b.type='button';b.dataset.lmDocs=id;b.textContent='문서 첨부 · 매물장';f.querySelector('.lm-property-savebar')?.append(b);}}
document.addEventListener('click',e=>{const b=e.target.closest('[data-lm-docs]');if(b){e.preventDefault();window.lmDocumentLaunch(b.dataset.lmDocs);}});let timer;new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(bind,60);}).observe(document.body,{childList:true,subtree:true});bind();
})();
