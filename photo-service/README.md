# 랜드메이커 비공개 매물 사진 — 개발본

상태: 운영 미적용. Cloudflare/R2 미연결. 운영 Supabase는 구조·상태만 읽었으며 변경하지 않았습니다.

## 확인한 기존 구조 (2026-11-18)

- GitHub `bbylbb-svg/landmaker`, 기준 커밋 `e62b972`.
- Supabase `borshzgpwtuukryiotia`: ACTIVE_HEALTHY, Postgres 17.
- `lm_staff`: 직원 4명, 4명 모두 Supabase Auth와 연결됨.
- 실제 등록 매물은 `lm_cloud_workspace.data.properties` 배열: 조회 당시 78건.
- Access 매물: `lm_import_rows`, 수정본: `lm_access_property_edits`.
- 신규 간편 매물: `lm_new_properties`.
- 기존 비공개 Supabase bucket `lm-intake`는 문서 인식용이며 새 사진 기능과 분리.
- 기존 사진 관리 테이블과 동작하는 사진 갤러리는 확인되지 않았음.

## 구현

`photo-ui/client.js`: 여러 장 선택·촬영, 긴 쪽 최대 1920px JPEG 재인코딩, 700KiB 이하 목표, 360px/75KiB 썸네일, 진행률, 수동 재시도. 파일은 한 장씩 변환하고 원본은 서버에 전송하지 않습니다. 일반적인 300~700KB를 목표로 하며 단순한 그림·작은 사진은 더 작아도 그대로 사용합니다. 압축해도 상한을 넘으면 업로드를 거절합니다. HEIC/HEIF는 해당 브라우저가 디코딩할 수 있을 때만 지원합니다.

`photo-service/image.mjs`: 서버에서도 JPEG 시그니처·크기·해상도 확인 및 EXIF/XMP/IPTC/주석 제거. 임의 파일·1920px 초과 파일 차단. 브라우저 canvas JPEG의 단일 baseline scan을 대상으로 합니다. 원본 자체를 업로드하는 API는 없습니다.

`worker.mjs`: Cloudflare Worker의 비공개 R2 binding. 파일은 Worker 메모리를 잠시 거쳐 R2로 전달되며 랜드메이커 호스팅 서버·Supabase DB·로컬 디스크에는 사진 바이너리를 보관하지 않습니다. 파일 본문은 850KiB 제한. DB 예약 → R2 저장 → 완료 처리를 사용하며 실패한 예약은 2분 후 재시도할 수 있습니다. 미완료 객체는 누락·과금 방지를 위해 용량에 계속 포함하며 자동 영구삭제하지 않습니다.

`schema-proposal.sql`: 기존 테이블과 ID는 유지하고 사진 전용 테이블만 추가. 내용 해시 중복 방지, 매물별 연결(1사진 N매물), 대표사진, 정렬, 광고 승인, 삭제 연결 복원, 직원별 읽기·편집·승인 권한, 감사 기록, 용량·요청량 예약 카운터. 물리 삭제 API와 기존 자료 cascade 삭제는 없습니다. 직원 이름·주소로 권한 또는 매물을 추정하지 않습니다.

`integration.js` + `index.html`: 기존 매물 목록 사진 열, 등록 매물 상세/수정 및 Access 상세에서 갤러리 진입, 화면에 보이는 매물의 대표사진 미리보기, 광고작성에서 승인 사진만 불러오기·개별 다운로드. 임시 URL은 블로그 HTML에 넣지 않으며 사진을 다운로드해 네이버 편집기에 첨부합니다. 다른 매물 연결은 대상 매물 고유 ID 입력 방식입니다.

## 보안

- 서버가 Supabase `/auth/v1/user`로 매 요청 실제 계정을 확인합니다. JWT를 단순 decode하거나 사용자 편집 metadata에 권한을 맡기지 않습니다.
- 직원 권한을 서버 DB에서 매 요청 재확인합니다. 초기 사진 권한은 전원 **없음**이며 운영 승인 후 명시적으로 부여해야 합니다.
- DB 테이블은 RLS 켜짐, anon/authenticated의 직접 접근과 RPC 실행 권한 없음. service_role 전용 SECURITY INVOKER RPC만 사용합니다.
- 사진 임시 접근 URL은 60초 유효, 사용자·매물·사진·사이즈·용도에 묶인 HMAC 서명입니다. URL만 전달해도 열리지 않으며 별도의 같은 직원 Bearer 세션이 필요합니다. 매 조회 때 삭제/광고승인/직원 권한을 재확인합니다.
- R2/Supabase 비밀키는 Worker secret에만 저장. R2 API secret 자체는 Worker binding 사용으로 불필요합니다.
- 사진은 fetch 후 메모리 blob으로 표시, `no-store`, `no-referrer`, 명시적 Origin allowlist. 사진·원본·signed URL을 localStorage/IndexedDB/서비스워커에 저장하지 않습니다.
- 다운로드는 서버에서 광고 승인 여부를 확인하며 다른 매물로 연결하면 승인은 복사하지 않습니다. 삭제/복원도 광고 승인을 해제합니다.
- 표시된 사진의 화면 캡처·직원이 이미 다운로드한 파일의 재공유까지 기술적으로 막을 수는 없습니다. 승인 다운로드에는 내부 사진을 포함하지 않습니다.
- 성공한 사진 조회·다운로드·편집·연결·삭제·복원은 `lm_photo_audit`에 기록됩니다. URL/토큰을 감사 로그에 저장하지 않습니다.

## 무료 범위와 사용량

Cloudflare 공식 R2 Standard 무료 범위: 월 10 GB-month, Class A 100만, Class B 1,000만, 인터넷 송신 무료.
https://developers.cloudflare.com/r2/pricing/

**무료 전용으로 무조건 정지되는 독립 요금제가 아닙니다.** 무료 한도를 넘으면 과금될 수 있고 Workers/Supabase의 별도 한도도 적용됩니다. 유료 전환·결제정보·과금 활성화는 사용자 승인 전 진행하지 않습니다.

앱에는 8GB/월 쓰기 90만/읽기 900만의 보수적인 차단값이 있습니다. 쿼리 카운터는 이 앱이 예약한 R2 put/get만 추적합니다. 다른 앱·Cloudflare 대시보드·실패/재시도 요청·Worker 요청 및 저장공간의 월 평균 청구량을 정확히 대체하지 않습니다. 앱 전용 버킷을 사용하고 Cloudflare 계정 실제 청구량도 확인해야 합니다. 사진만 지우는 자동 R2 lifecycle은 설정하지 않습니다.

## 테스트 환경에서 연결하는 순서

1. 기존 자료를 넣지 않은 별도 Supabase 테스트 프로젝트/로컬 DB를 준비합니다. 유료 개발 브랜치는 자동 생성하지 않습니다. 실제 운영 DB에 schema 파일을 붙여넣지 마세요.
2. 테스트 스키마와 더미 직원·매물(실제 고객/주소/사진 제외)을 만든 후 `schema-proposal.sql`을 적용합니다. 자동 테스트의 `test/database.mjs`가 최소 fixture를 제공합니다.
3. Cloudflare 계정에서 R2 활성 여부와 결제 조건을 먼저 확인합니다. 신규 요금/결제 동의가 생기면 승인이 필요합니다. **`landmaker-photos-staging` 비공개 Standard 버킷**을 생성합니다. `r2.dev`와 공개 custom domain을 모두 비활성화합니다.
4. Cloudflare 배포용 권한은 계정의 해당 Worker/R2 리소스로 좁힙니다. 키를 채팅·브라우저 코드·공개 GitHub에 붙이지 않습니다.
5. `wrangler.jsonc`에 테스트 Supabase URL/publishable key와 정확한 테스트 Origin을 설정합니다. service key와 무작위 32바이트 이상 ticket secret은 `wrangler secret put SUPABASE_SERVICE_KEY`, `wrangler secret put TICKET_SECRET`으로만 입력합니다. CLI 버전/명령 도움말을 먼저 확인하세요. 키는 저장소에 넣지 않습니다.
6. 테스트 직원별 `lm_photo_permissions`의 can_read/can_edit/can_approve를 테스트 DB에서 명시적으로 설정합니다. 승인 담당자를 누구로 할지 운영 설정 전 사용자와 확인합니다.
7. Worker를 테스트 환경에 배포하고 `photo-ui/config.js` endpoint를 해당 **테스트** URL로 설정합니다. 운영 endpoint 기본값은 빈 값이라 연결되지 않습니다.
8. 실제 R2로 업로드/조회/승인 다운로드/삭제 복원/직원 권한 차단을 PC와 실제 휴대폰·태블릿에서 검증합니다. 로그아웃·외부 URL 전달·세션 만료·네트워크 끊김도 확인합니다.
9. 결과 및 SQL/권한 부여 대상/무료 범위 정책을 검토한 후 **운영 DB 변경과 운영 배포에 대한 사용자 승인**을 받아 적용합니다. 이번 작업은 여기까지 자동 진행하지 않습니다.

## 재현 가능한 로컬 테스트

Node 24. `cd photo-service && npm ci && npm test`.

PGlite의 실제 PostgreSQL 엔진에서 SQL을 실행하며 R2는 Map 기반 모의 객체 저장소입니다. 테스트 계정·매물·이미지만 사용합니다. 이는 실제 Cloudflare/Supabase hosted end-to-end 검증의 대체가 아닙니다.

운영 DB 변경 없이 롤백: 이 브랜치/사진 버튼만 제외하면 기존 프로그램이 그대로 동작합니다. 향후 운영 적용 후 문제가 생기면 Worker endpoint를 비활성화하고 사진 객체와 새 테이블은 보존한 채 원인 조사합니다. 기존 매물·소유주 데이터에 대한 삭제/역마이그레이션은 하지 않습니다.

## 계정 연결 후 필요한 정보

- Cloudflare 계정의 R2 활성화 상태와 테스트 버킷 생성 가능 여부
- 비용 조건 확인(과금·유료 전환은 사전 승인)
- 테스트 Supabase 환경 및 테스트 프런트엔드 Origin
- 네 직원의 사진 읽기·편집 권한, 광고 승인 담당자

비밀키는 제공할 대시보드/secret 입력 절차를 통해서만 설정합니다. 채팅에 보내지 마세요.
