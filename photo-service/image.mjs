// JPEG-only re-encoding path. No original image is ever uploaded.
export function cleanJPEG(input, maxEdge = 1920, maxBytes = 720 * 1024) {
 const a = new Uint8Array(input);
 if(a.length > maxBytes || a.length < 10 || a[0] !== 255 || a[1] !== 216) throw Error('JPEG 크기 또는 형식 오류');
 const out=[a.slice(0,2)]; let p=2, width=0,height=0,scan=false;
 while(p<a.length){
  if(a[p]!==255) throw Error('JPEG 구조 오류');
  const start=p++; while(a[p]===255)p++;
  const marker=a[p++];
  if(marker===0xd9) break;
  if(marker===0x00 || marker===0xd8 || marker>=0xd0&&marker<=0xd7)throw Error('JPEG 마커 오류');
  if(p+2>a.length)throw Error('잘린 JPEG');
  const length=a[p]*256+a[p+1], end=p+length;
  if(length<2||end>a.length)throw Error('잘린 JPEG');
  if([0xc0,0xc1,0xc2].includes(marker)){
   if(length<8)throw Error('JPEG 크기 오류');height=a[p+3]*256+a[p+4];width=a[p+5]*256+a[p+6];
  }
  if(marker===0xda){
   // Require an EOI and reject appended payloads after the final EOI.
   let e=a.length-2;if(a[e]!==255||a[e+1]!==217)throw Error('JPEG 종료 오류');
   // Canvas JPEG is baseline; metadata may not be inserted after the scan begins.
   for(let i=end;i<e;i++)if(a[i]===255){const m=a[++i];if(m!==0 && m!==255 && !(m>=0xd0&&m<=0xd7))throw Error('지원하지 않는 JPEG 스캔');}
   out.push(a.slice(start));scan=true;break;
  }
  // Strip EXIF/GPS, XMP, IPTC, comments and all application markers except JFIF.
  if(!(marker>=0xe1&&marker<=0xef)&&marker!==0xfe)out.push(a.slice(start,end));
  p=end;
 }
 if(!scan||!width||!height||Math.max(width,height)>maxEdge)throw Error('사진 해상도 오류');
 const bytes=new Uint8Array(out.reduce((n,x)=>n+x.length,0));let pos=0;for(const x of out){bytes.set(x,pos);pos+=x.length;}
 return {bytes,width,height};
}
export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
