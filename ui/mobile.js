/* Keep the existing controls and handlers; group secondary tools on small screens. */
(()=>{
 const info=document.getElementById('authInfo');if(!info)return;
 const tools=document.createElement('details');tools.id='lmMobileTools';
 const summary=document.createElement('summary');summary.textContent='저장·연결 상태';tools.append(summary);info.append(tools);
 const primary=new Set(['lmManualSync','authStaffName','authLogout','lmMobileTools']);
 function group(){for(const node of [...info.children])if(!primary.has(node.id))tools.append(node);}
 group();new MutationObserver(group).observe(info,{childList:true});
})();
