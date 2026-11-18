import {cleanJPEG,sha256} from './image.mjs';
const encoder=new TextEncoder();
class Failure extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(s,m)=>{throw new Failure(s,m)};
function base64(bytes){return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
function unbase64(s){return Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
async function key(secret){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signTicket(data,secret){const body=base64(encoder.encode(JSON.stringify(data)));return body+'.'+base64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(body))));}
export async function verifyTicket(ticket,secret,uid,now=Date.now()){
 try{const [body,sig,extra]=ticket.split('.');if(extra||!body||!sig)throw Error();if(!await crypto.subtle.verify('HMAC',await key(secret),unbase64(sig),encoder.encode(body)))throw Error();const d=JSON.parse(new TextDecoder().decode(unbase64(body)));if(d.uid!==uid||!Number.isInteger(d.exp)||d.exp<=Math.floor(now/1000)||d.exp>Math.floor(now/1000)+60)throw Error();return d;}catch{fail(403,'사진 링크가 만료되었거나 권한이 없습니다.');}
}
export class SupabaseStore {
 constructor(env){this.env=env;}
 async authenticate(token){
  const r=await fetch(this.env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:this.env.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
  if(!r.ok)fail(401,'직원 로그인이 필요합니다.');const u=await r.json();if(!u.id||u.is_anonymous)fail(401,'직원 로그인이 필요합니다.');return u.id;
 }
 async call(uid,action,args={}){
  const r=await fetch(this.env.SUPABASE_URL+'/rest/v1/rpc/lm_photo_dispatch',{method:'POST',headers:{apikey:this.env.SUPABASE_SERVICE_KEY,Authorization:'Bearer '+this.env.SUPABASE_SERVICE_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_user:uid,p_action:action,p_args:args}),signal:AbortSignal.timeout(15000)});
  if(!r.ok){const e=await r.json().catch(()=>({}));if(e.code==='42501')fail(403,'사진 접근 권한이 없습니다.');if(e.code==='P0002')fail(404,'매물 또는 사진을 찾을 수 없습니다.');if(e.code==='40001')fail(409,'다른 작업이 진행 중입니다. 잠시 후 다시 시도하세요.');if(e.code==='54000')fail(413,'설정된 사진 저장·요청 한도에 도달했습니다.');fail(503,'사진 자료 처리 실패. 다시 시도하세요.');}
  return r.json();
 }
}
async function limitedBody(req,limit){
 const declared=Number(req.headers.get('Content-Length'));if(declared>limit)fail(413,'파일이 너무 큽니다.');
 const reader=req.body?.getReader();if(!reader)fail(400,'요청 본문이 없습니다.');let size=0;const parts=[];
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail(413,'파일이 너무 큽니다.');}parts.push(value);}
 const data=new Uint8Array(size);let offset=0;for(const p of parts){data.set(p,offset);offset+=p.length;}return data;
}
export function createHandler(storeFactory=env=>new SupabaseStore(env)){
 return async function handle(req,env){
  const origin=req.headers.get('Origin'),allowed=(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  const headers={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  if(origin && !allowed.includes(origin))return new Response('접근할 수 없는 사이트입니다.',{status:403,headers});
  if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Max-Age':'300'});
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json'}});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  try{
   if(!env.TICKET_SECRET||env.TICKET_SECRET.length<32||!env.PHOTOS)fail(503,'사진 저장소 연결 준비 중입니다.');
   if(!['GET','POST'].includes(req.method))fail(405,'지원하지 않는 요청입니다.');
   const token=req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];if(!token)fail(401,'직원 로그인이 필요합니다.');
   const store=storeFactory(env),uid=await store.authenticate(token);await store.call(uid,'authorize');
   const url=new URL(req.url);
   if(req.method==='GET'&&url.pathname==='/media'){
    const t=await verifyTicket(url.searchParams.get('ticket')||'',env.TICKET_SECRET,uid);
    if(!['full','thumb'].includes(t.variant)||!['view','download'].includes(t.purpose))fail(400,'사진 요청 오류');
    const photo=await store.call(uid,'media',{propertyId:t.propertyId,assetId:t.assetId,purpose:t.purpose,variant:t.variant});
    // Audit and request allowance are committed BEFORE reading any R2 bytes.
    const object=await env.PHOTOS.get(t.variant==='thumb'?photo.thumb_key:photo.object_key);
    if(!object)fail(404,'저장된 사진을 찾을 수 없습니다.');
    return new Response(object.body,{headers:{...headers,'Content-Type':'image/jpeg','Content-Disposition':(t.purpose==='download'?'attachment':'inline')+'; filename="landmaker-'+t.assetId+'.jpg"'}});
   }
   if(req.method!=='POST')fail(404,'요청 경로 오류');
   if(url.pathname==='/upload'){
    const bytes=await limitedBody(req,850*1024);let form;
    try{form=await new Response(bytes,{headers:{'Content-Type':req.headers.get('Content-Type')||''}}).formData();}catch{fail(400,'업로드 형식 오류');}
    const propertyId=String(form.get('propertyId')||'');const full=form.get('full'),thumb=form.get('thumb');
    if(!propertyId||!(full instanceof Blob)||!(thumb instanceof Blob))fail(400,'매물과 사진을 선택하세요.');
    let image,small;try{image=cleanJPEG(await full.arrayBuffer());small=cleanJPEG(await thumb.arrayBuffer(),360,80*1024);}catch(e){fail(400,e.message);}
    const hash=await sha256(image.bytes),reservation=await store.call(uid,'reserve',{propertyId,hash,thumbHash:await sha256(small.bytes),bytes:image.bytes.length,thumbBytes:small.bytes.length,width:image.width,height:image.height});
    if(reservation.ready)return json(reservation);
    try{
     await env.PHOTOS.put(reservation.object_key,image.bytes,{httpMetadata:{contentType:'image/jpeg',cacheControl:'no-store'}});
     await env.PHOTOS.put(reservation.thumb_key,small.bytes,{httpMetadata:{contentType:'image/jpeg',cacheControl:'no-store'}});
     return json(await store.call(uid,'complete',{propertyId,assetId:reservation.assetId,lease:reservation.lease}));
    }catch(error){
     // Retain the reservation and any objects for safe retry/reconciliation; no destructive cleanup.
     throw error;
    }
   }
   if(url.pathname!=='/api')fail(404,'요청 경로 오류');
   let payload;try{payload=JSON.parse(new TextDecoder().decode(await limitedBody(req,32*1024)));}catch(e){if(e instanceof Failure)throw e;fail(400,'요청 형식 오류');}
   const {action,...args}=payload||{};
   if(!['list','update','reorder','link','unlink','restore','usage','covers','ticket'].includes(action))fail(400,'지원하지 않는 사진 작업입니다.');
   if(action==='ticket'){
    if(!['full','thumb'].includes(args.variant)||!['view','download'].includes(args.purpose))fail(400,'사진 요청 오류');
    await store.call(uid,'checkMedia',args);
    const ticket=await signTicket({uid,propertyId:args.propertyId,assetId:args.assetId,variant:args.variant,purpose:args.purpose,exp:Math.floor(Date.now()/1000)+60},env.TICKET_SECRET);
    return json({url:url.origin+'/media?ticket='+ticket,expiresIn:60});
   }
   return json(await store.call(uid,action,args));
  }catch(error){return json({error:error instanceof Failure?error.message:'사진 처리에 실패했습니다. 잠시 후 다시 시도하세요.'},error.status||503);}
 };
}
export default {fetch:createHandler()};
