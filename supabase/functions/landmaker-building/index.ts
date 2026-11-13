import { createClient } from "npm:@supabase/supabase-js@2";
const API_BASE = "https://apis.data.go.kr/1613000/BldRgstHubService";
const METHODS: Record<string,string> = { title:"getBrTitleInfo", basic:"getBrBasisOulnInfo", floor:"getBrFlrOulnInfo", area:"getBrExposPubuseAreaInfo", lots:"getBrAtchJibunInfo", sewage:"getBrWclfInfo" };
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
const failureMessage=(code:string)=>code==='05'?'공공데이터 제공기관 연결 지연입니다. 잠시 후 다시 조회해 주세요.':'공공데이터 제공기관이 오류를 반환했습니다.';
// Gateway errors may arrive as JSON or XML, including with HTTP 200.
function gatewayCode(raw:string,result:any):string{
 const header=result?.OpenAPI_ServiceResponse?.cmmMsgHeader || result?.response?.header;
 const candidate=header?.returnReasonCode ?? header?.resultCode ?? raw.match(/<(?:\w+:)?returnReasonCode>\s*([^<]+)\s*</i)?.[1];
 const code=String(candidate??'').trim();return /^[A-Z0-9_ -]{1,40}$/i.test(code)?code:'';
}
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'POST 요청만 허용합니다.'},405);
 try{
  let key=(Deno.env.get('BUILDING_API_KEY')||'').trim();
  if(/%[0-9a-f]{2}/i.test(key)){try{key=decodeURIComponent(key)}catch{/* retain configured value */}}
  if(!key)return json({error:'API 인증키가 등록되지 않았습니다.'},500);
  const sbUrl=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY');
  if(!sbUrl||!anon)return json({error:'Supabase 인증 환경변수가 없습니다.'},500);
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  const {data:{user},error}=await createClient(sbUrl,anon).auth.getUser(token);
  if(error||!user)return json({error:'로그인이 필요합니다.'},401);
  let body;try{body=await req.json()}catch{return json({error:'요청 본문을 확인하세요.'},400)}
  if(!body||typeof body!=='object')return json({error:'요청 본문을 확인하세요.'},400);
  const type=String(body.type||'title'),method=METHODS[type],pageNo=Number(body.pageNo??1);
  if(!method)return json({error:'지원하지 않는 조회 유형입니다.'},400);
  if(!Number.isSafeInteger(pageNo)||pageNo<1||pageNo>100)return json({error:'조회 페이지는 1~100이어야 합니다.'},400);
  const sigunguCd=String(body.sigunguCd||''),bjdongCd=String(body.bjdongCd||''),bun=String(body.bun||'0').padStart(4,'0'),ji=String(body.ji||'0').padStart(4,'0'),platGbCd=String(body.platGbCd??'0');
  if(!/^\d{5}$/.test(sigunguCd)||!/^\d{5}$/.test(bjdongCd)||!/^\d{4}$/.test(bun)||!/^\d{4}$/.test(ji)||!['0','1','2'].includes(platGbCd))return json({error:'법정동 코드 또는 지번 형식을 확인하세요.'},400);
  const url=new URL(`${API_BASE}/${method}`);
  for(const [k,v]of Object.entries({serviceKey:key,sigunguCd,bjdongCd,platGbCd,bun,ji,numOfRows:'100',pageNo:String(pageNo),_type:'json'}))url.searchParams.set(k,v);
  for(let attempt=1;attempt<=2;attempt++){
   let response:Response,raw:string;
   try{response=await fetch(url.toString(),{signal:AbortSignal.timeout(15000)});raw=await response.text()}
   catch{
    // Never expose/log exception text: fetch errors can contain the secret URL.
    if(attempt<2){await new Promise(r=>setTimeout(r,500));continue}
    console.error('building upstream connection failed',JSON.stringify({method,attempt}));
    return json({success:false,error:'공공데이터 API 연결 또는 응답 시간이 초과되었습니다.',resultCode:'NETWORK_TIMEOUT',attempts:attempt},502);
   }
   let result:any;try{result=JSON.parse(raw)}catch{/* inspect XML error envelope below */}
   const code=gatewayCode(raw,result),providerError=!!code&&!['0','00'].includes(code);
   const retry=[502,503,504].includes(response.status)||code==='05';
   if((!response.ok||providerError)&&retry&&attempt<2){await new Promise(r=>setTimeout(r,500));continue}
   if(!response.ok||providerError){
    console.error('building upstream failed',JSON.stringify({method,status:response.status,code:code||'HTTP_ERROR',attempt}));
    return json({success:false,error:'건축물대장 제공기관 조회 실패',upstreamStatus:response.status,resultCode:code||'HTTP_ERROR',resultMsg:failureMessage(code),attempts:attempt},502);
   }
   // Missing/malformed bodies are failures, never a successful empty result.
   const data=result?.response?.body;
   if(!data||typeof data!=='object'||(!('items'in data)&&!('totalCount'in data)))return json({success:false,error:'공공데이터 API 응답 형식을 확인할 수 없습니다.',upstreamStatus:response.status,resultCode:'INVALID_RESPONSE',attempts:attempt},502);
   return json({success:true,type,data,attempts:attempt});
  }
  return json({success:false,error:'공공데이터 API 재시도에 실패했습니다.'},502);
 }catch{return json({success:false,error:'조회 처리 실패',message:'인증 또는 공공데이터 API 연결을 확인하세요.'},500)}
});

