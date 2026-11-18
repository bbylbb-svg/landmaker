// NAVER storage deployment entry. No files are saved in the Edge Function filesystem.
import {createHandler} from '../../../photo-service/worker.mjs';
import {NcloudStorage} from '../../../photo-service/ncloud-storage.mjs';
const handler=createHandler();
Deno.serve(async(request:Request)=>{
 try{
  const env={
   SUPABASE_URL:Deno.env.get('SUPABASE_URL'),
   SUPABASE_PUBLISHABLE_KEY:Deno.env.get('SUPABASE_ANON_KEY'),
   SUPABASE_SERVICE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
   TICKET_SECRET:Deno.env.get('LM_PHOTO_TICKET_SECRET'),
   ALLOWED_ORIGINS:Deno.env.get('LM_PHOTO_ALLOWED_ORIGINS')||'',
   API_BASE_PATH:'/functions/v1/landmaker-photos',
   PHOTOS:new NcloudStorage({accessKey:Deno.env.get('NCLOUD_PHOTO_ACCESS_KEY'),secretKey:Deno.env.get('NCLOUD_PHOTO_SECRET_KEY'),bucket:Deno.env.get('NCLOUD_PHOTO_BUCKET')})
  };
  return await handler(request,env);
 }catch{return new Response(JSON.stringify({error:'사진 저장소 연결 준비 중입니다.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
});
