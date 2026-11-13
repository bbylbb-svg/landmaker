// Read-only VWorld land lookup. The platform must keep verify_jwt=true.
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json; charset=utf-8'};
const respond=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:cors});
const decode=(s:string)=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
function extract(xml:string,tag:string){const m=xml.match(new RegExp('<(?:[\\w-]+:)?'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?'+tag+'>','i'));return m?decode(m[1].trim()):''}
function parseLand(xml:string,pnu:string){
 const code=extract(xml,'exceptionCode')||extract(xml,'errorCode')||extract(xml,'resultCode')||extract(extract(xml,'error'),'code');
 const detail=extract(xml,'exceptionText')||extract(xml,'errorMsg')||extract(xml,'resultMsg')||extract(extract(xml,'error'),'text');
 if(code&&!['00','0','NORMAL_SERVICE'].includes(code))return {status:502,body:{success:false,stage:'upstream',code,error:'브이월드 API 오류',detail}};
 const matches=[...xml.matchAll(/<(?:[\w-]+:)?ladfrlVOList(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w-]+:)?ladfrlVOList>/gi)].map(m=>m[0]);
 const entry=matches.find(row=>extract(row,'pnu')===pnu)||'';
 if(!entry){
  if(matches.length)return {status:502,body:{success:false,stage:'parse',error:'요청 필지와 API 응답의 PNU가 다릅니다.'}};
  if(/<html\b|<!doctype\s+html/i.test(xml))return {status:502,body:{success:false,stage:'upstream',error:'브이월드가 토지정보 대신 HTML을 반환했습니다.'}};
  if(detail||/<(?:[\w-]+:)?(?:error|ServiceException|ExceptionReport)\b/i.test(xml))return {status:502,body:{success:false,stage:'upstream',error:'브이월드 API 오류',detail}};
  if(extract(xml,'totalCount')==='0')return {status:404,body:{success:false,stage:'result',error:'해당 PNU의 토지정보가 없습니다.'}};
  return {status:502,body:{success:false,stage:'parse',error:'브이월드 응답 형식을 확인할 수 없습니다.'}};
 }
 const areaText=extract(entry,'lndpclAr'),area=areaText===''?NaN:Number(areaText);
 const category=extract(entry,'lndcgrCodeNm');
 if(!category||!Number.isFinite(area)||area<=0)return {status:502,body:{success:false,stage:'parse',error:'지목 또는 면적이 비어 있어 자동입력을 중단했습니다.'}};
 return {status:200,body:{success:true,land:{pnu,address:extract(entry,'ldCodeNm'),lotNumber:extract(entry,'mnnmSlno'),landCategory:category,areaSqm:area,areaPyeong:Math.round(area/3.305785*100)/100,ownershipType:extract(entry,'posesnSeCodeNm'),updatedAt:extract(entry,'lastUpdtDt')}}};
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return respond({success:false,error:'POST only'},405);
 const key=Deno.env.get('VWORLD_API_KEY')?.trim();if(!key)return respond({success:false,stage:'configuration',error:'VWORLD_API_KEY 미등록'},500);
 const redact=(s:string)=>s.replaceAll(key,'[REDACTED]').replaceAll(encodeURIComponent(key),'[REDACTED]').replace(/(?:serviceKey|key)=[^&\s<>"']*/gi,'key=[REDACTED]');
 let pnu='',query='';try{const body=await req.json();pnu=String(body.pnu??'');query=body.action==='search'?String(body.query??'').trim():''}catch{return respond({success:false,error:'JSON 오류'},400)}
 if(query){
  if(query.length<3||query.length>120)return respond({success:false,error:'시군구·읍면동·지번을 3~120자로 입력하세요.'},400);
  const url=new URL('https://api.vworld.kr/req/search');
  for(const [k,v]of Object.entries({service:'search',request:'search',version:'2.0',type:'address',category:'parcel',format:'json',crs:'EPSG:4326',query,size:'20',page:'1',key,domain:Deno.env.get('VWORLD_DOMAIN')||'https://bbylbb-svg.github.io'}))url.searchParams.set(k,v);
  let client:Deno.HttpClient|undefined;
  try{
   client=Deno.createHttpClient({http2:false});
   const res=await fetch(url,{client,signal:AbortSignal.timeout(15000)});
   if(!res.ok)return respond({success:false,error:'브이월드 지번검색 HTTP 오류',upstreamStatus:res.status},502);
   const data=await res.json(),r=data.response;
   if(r?.status==='NOT_FOUND')return respond({success:true,items:[]});
   if(r?.status!=='OK')return respond({success:false,error:'브이월드 지번검색 오류',detail:redact(String(r?.error?.text||r?.error?.message||'응답 형식 확인 필요'))},502);
   const raw=Array.isArray(r.result?.items)?r.result.items:[];
   const items=raw.map((z:any)=>({pnu:String(z.id||''),address:String(z.address?.parcel||'')})).filter((z:any)=>/^\d{19}$/.test(z.pnu)&&z.address);
   if(raw.length&&!items.length)return respond({success:false,error:'지번검색 결과에 필지번호가 없어 선택을 중단했습니다.'},502);
   return respond({success:true,items});
  }catch{return respond({success:false,error:'브이월드 지번검색 연결 실패 또는 응답시간 초과'},502)}finally{client?.close()}
 }
 if(!/^\d{19}$/.test(pnu))return respond({success:false,error:'19자리 PNU 필요'},400);
 const url=new URL('https://api.vworld.kr/ned/data/ladfrlList');
 for(const [k,v]of Object.entries({pnu,format:'xml',numOfRows:'10',pageNo:'1',key,domain:Deno.env.get('VWORLD_DOMAIN')||'https://bbylbb-svg.github.io'}))url.searchParams.set(k,v);
 let client:Deno.HttpClient|undefined;
 try{
  client=Deno.createHttpClient({http2:false});
  const upstream=await fetch(url,{client,headers:{Accept:'application/xml, text/xml'},signal:AbortSignal.timeout(15000)});
  const xml=await upstream.text();
  if(!upstream.ok)return respond({success:false,stage:'http',upstreamStatus:upstream.status,error:'브이월드 HTTP 오류'},502);
  const result=parseLand(xml,pnu);
  // Do not return raw provider responses, URLs, or secrets to clients or logs.
  const safe=JSON.parse(redact(JSON.stringify({...result.body,upstreamStatus:upstream.status})));
  console.info(JSON.stringify({lookup:'land',status:result.status,upstreamStatus:upstream.status,stage:'stage' in result.body?result.body.stage:'success',code:'code' in result.body?result.body.code:undefined}));
  return respond(safe,result.status);
 }catch{return respond({success:false,stage:'network',error:'외부 API 연결 실패 또는 응답시간 초과'},502)}finally{client?.close()}
});

