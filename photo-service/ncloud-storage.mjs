// NAVER Cloud Object Storage, path-style S3 API / AWS Signature Version 4.
// Access keys remain server-only; no public ACL and no external presigned bucket URL.
import {sha256} from './image.mjs';
const enc=new TextEncoder();
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
async function hmac(key,message){const k=await crypto.subtle.importKey('raw',typeof key==='string'?enc.encode(key):key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return crypto.subtle.sign('HMAC',k,enc.encode(message));}
function segment(s){return encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());}
export class NcloudStorage {
 constructor({accessKey,secretKey,bucket,fetcher=fetch,clock=()=>new Date()}){
  if(!accessKey||!secretKey||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket||''))throw Error('네이버클라우드 저장소 설정이 필요합니다.');
  this.accessKey=accessKey;this.secretKey=secretKey;this.bucket=bucket;this.fetcher=fetcher;this.clock=clock;
 }
 async request(method,key,body,metadata={}){
  if(!/^photos\/[a-f0-9-]+\/(full|thumb)\.jpg$/.test(key))throw Error('사진 저장 경로 오류');
  const host='kr.object.ncloudstorage.com',path='/'+segment(this.bucket)+'/'+key.split('/').map(segment).join('/');
  const timestamp=this.clock().toISOString().replace(/[:-]|\.\d{3}/g,''),date=timestamp.slice(0,8),payload=await sha256(body||new Uint8Array());
  const headers={'host':host,'x-amz-content-sha256':payload,'x-amz-date':timestamp};
  if(method==='PUT'){headers['content-type']=metadata.contentType||'image/jpeg';headers['cache-control']='no-store';headers['x-amz-acl']='private';}
  const names=Object.keys(headers).sort(),signed=names.join(';'),canonical=names.map(k=>k+':'+headers[k].trim()+'\n').join('');
  const request=[method,path,'',canonical,signed,payload].join('\n'),scope=date+'/kr-standard/s3/aws4_request';
  const message=['AWS4-HMAC-SHA256',timestamp,scope,await sha256(enc.encode(request))].join('\n');
  const keyDate=await hmac('AWS4'+this.secretKey,date),keyRegion=await hmac(keyDate,'kr-standard'),keyService=await hmac(keyRegion,'s3'),keySigning=await hmac(keyService,'aws4_request');
  headers.authorization='AWS4-HMAC-SHA256 Credential='+this.accessKey+'/'+scope+', SignedHeaders='+signed+', Signature='+hex(await hmac(keySigning,message));
  // Fetch supplies Host and Content-Length. Never redirect signed requests to another origin.
  delete headers.host;
  const response=await this.fetcher('https://'+host+path,{method,headers,...(body?{body}:{}),redirect:'error',signal:AbortSignal.timeout(25000)});
  if(response.status===404&&method==='GET')return null;
  if(!response.ok)throw Error('비공개 사진 저장소 요청 실패 ('+response.status+')');
  return response;
 }
 async put(key,bytes,options={}){await this.request('PUT',key,bytes,options.httpMetadata);}
 async get(key){const response=await this.request('GET',key);return response?{body:response.body}:null;}
}
