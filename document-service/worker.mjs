import {SupabaseStore,signTicket,verifyTicket} from '../photo-service/worker.mjs';
import {sha256} from '../photo-service/image.mjs';
const MAX=30*1024*1024;
const bad=(status,message)=>{const e=Error(message);e.status=status;throw e;};
export function validateDocument(name,bytes){
 const fileName=String(name||'').normalize('NFC').replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,200),extension=fileName.split('.').pop().toLowerCase();
 if(!['xlsx','xls','pdf','docx','doc','pptx','ppt','hwp','hwpx'].includes(extension))bad(400,'엑셀·PDF·워드·한글·파워포인트 문서만 첨부할 수 있습니다.');
 if(!bytes.length||bytes.length>MAX)bad(413,'문서는 파일당 30MB 이하로 선택하세요.');
 const matches=a=>a.every((v,i)=>bytes[i]===v),zip=matches([0x50,0x4b,3,4]),ole=matches([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),pdf=matches([0x25,0x50,0x44,0x46,0x2d]);
 if(!(extension==='pdf'?pdf:['xlsx','docx','pptx','hwpx'].includes(extension)?zip:ole))bad(400,'파일 내용과 확장자가 맞지 않습니다. 원본 문서를 선택하세요. 암호화된 신형 Office 문서는 지원하지 않습니다.');
 return {fileName,extension};
}
export class DocumentStore extends SupabaseStore {
 async call(uid,action,args={}){const r=await fetch(this.env.SUPABASE_URL+'/rest/v1/rpc/lm_document_dispatch',{method:'POST',headers:{apikey:this.env.SUPABASE_SERVICE_KEY,Authorization:'Bearer '+this.env.SUPABASE_SERVICE_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_user:uid,p_action:action,p_args:args}),signal:AbortSignal.timeout(15000)});if(!r.ok){const e=await r.json().catch(()=>({}));bad({'42501':403,P0002:404,'40001':409,'54000':413}[e.code]||503,{'42501':'문서 접근 권한이 없습니다.',P0002:'매물 또는 문서를 찾을 수 없습니다.','40001':'업로드 진행 중이거나 삭제된 문서입니다. 삭제 목록을 확인하거나 잠시 후 재시도하세요.','54000':'앱 저장·요청 제한에 도달했습니다.'}[e.code]||'문서 기능 연결 준비 중입니다.');}return r.json();}
}
async function body(req,max){if(Number(req.headers.get('content-length'))>max)bad(413,'문서는 파일당 30MB 이하로 선택하세요.');const reader=req.body?.getReader();if(!reader)bad(400,'파일을 선택하세요.');let size=0;const parts=[];for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();bad(413,'파일이 너무 큽니다.');}parts.push(value);}const data=new Uint8Array(size);let at=0;for(const p of parts){data.set(p,at);at+=p.length;}return data;}
export function createDocumentHandler(factory=env=>new DocumentStore(env)){return async(req,env)=>{
 const origin=req.headers.get('Origin'),allowed=(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim());const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};
 if(origin&&!allowed.includes(origin))return new Response('접근할 수 없는 사이트입니다.',{status:403,headers});
 if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Max-Age':'300'});
 const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 try{
  if(!env.TICKET_SECRET||env.TICKET_SECRET.length<32||!env.PHOTOS)bad(503,'문서 저장소 연결 준비 중입니다.');
  const token=req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];if(!token)bad(401,'직원 로그인이 필요합니다.');const store=factory(env),uid=await store.authenticate(token);await store.call(uid,'authorize');
  const url=new URL(req.url),base=(env.API_BASE_PATH||'').replace(/\/$/,''),path=url.pathname.startsWith(base+'/')?url.pathname.slice(base.length):url.pathname;
  if(req.method==='GET'&&path==='/download'){
   const t=await verifyTicket(url.searchParams.get('ticket')||'',env.TICKET_SECRET,uid);if(t.kind!=='document')bad(403,'문서 링크 오류');const d=await store.call(uid,'download',{propertyId:t.propertyId,fileId:t.fileId}),object=await env.PHOTOS.get(d.object_key);if(!object)bad(404,'저장된 문서를 찾을 수 없습니다.');
   return new Response(object.body,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename=\"document\"; filename*=UTF-8''"+encodeURIComponent(d.file_name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()),'Content-Security-Policy':"sandbox; default-src 'none'"}});
  }
  if(req.method!=='POST')bad(405,'지원하지 않는 요청입니다.');
  if(path==='/upload'){
   const bytes=await body(req,MAX+128*1024);let form;try{form=await new Response(bytes,{headers:{'Content-Type':req.headers.get('Content-Type')||''}}).formData();}catch{bad(400,'업로드 형식 오류');}const file=form.get('file'),propertyId=String(form.get('propertyId')||'');if(!(file instanceof Blob)||!propertyId)bad(400,'매물과 문서를 선택하세요.');const content=new Uint8Array(await file.arrayBuffer()),meta=validateDocument(file.name,content),r=await store.call(uid,'reserve',{propertyId,...meta,hash:await sha256(content),bytes:content.length});if(r.ready)return json(r);
   await env.PHOTOS.put(r.object_key,content,{httpMetadata:{contentType:'application/octet-stream'}});return json(await store.call(uid,'complete',{propertyId,fileId:r.fileId,lease:r.lease}));
  }
  if(path!=='/api')bad(404,'요청 경로 오류');let p;try{p=JSON.parse(new TextDecoder().decode(await body(req,32*1024)));}catch(e){if(e.status)throw e;bad(400,'요청 형식 오류');}const {action,...args}=p||{};
  if(!['list','usage','ticket','delete','restore'].includes(action))bad(400,'지원하지 않는 문서 작업입니다.');
  if(action==='ticket'){await store.call(uid,'checkDownload',args);const ticket=await signTicket({kind:'document',uid,propertyId:args.propertyId,fileId:args.fileId,exp:Math.floor(Date.now()/1000)+60},env.TICKET_SECRET);return json({url:url.origin+base+'/download?ticket='+ticket,expiresIn:60});}
  return json(await store.call(uid,action,args));
 }catch(e){return json({error:e.status?e.message:'문서 처리에 실패했습니다. 잠시 후 재시도하세요.'},e.status||503);}
};}
