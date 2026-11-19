# 네이버클라우드 매물 사진 연결

상태: 연결 코드 구현·로컬 테스트 완료, 계정/버킷/비밀키 미연결. 운영 미적용.

## 구성

- 사진 저장: 네이버클라우드 Object Storage 한국 리전, 비공개 Standard 버킷.
- 사진 API: 기존 Supabase 프로젝트의 Edge Function `landmaker-photos`. 이 함수는 바이너리를 잠시 메모리에서 검사·전달할 뿐 DB나 함수 파일시스템에 원본을 보관하지 않습니다.
- 사진 목록·직원 권한·광고 승인·로그: 새 사진 전용 Supabase 테이블. 기존 매물 ID/주소/소유주를 변경하지 않습니다.
- 클라이언트: 기존 `photo-ui` 유지. API endpoint는 배포 검증 전까지 비활성 상태.
- Cloudflare 계정, R2, 별도 가상서버는 이 구성에 필요하지 않습니다. Supabase 함수 실행량/트래픽/로그/DB 용량의 별도 한도 및 과금은 적용될 수 있습니다.

## 계정에서 필요한 설정

1. https://www.ncloud.com/ 에서 계정을 만들고 로그인합니다. 가입 약관·본인 확인·결제수단·서비스 신청 동의는 사용자 본인이 확인합니다.
2. 콘솔의 Object Storage에서 **한국 리전**을 선택합니다.
3. 테스트용 버킷 이름: `landmaker-photos-test-<고유문자>`. 이름이 이미 사용 중이면 다른 고유문자를 붙입니다. 공개 권한/정적 웹 호스팅은 켜지 않습니다.
4. 버킷과 객체 모두 비공개로 둡니다. 공개 ACL을 추가하지 않습니다. 이 어댑터도 PUT마다 `x-amz-acl: private`을 보냅니다.
5. 저장소 접근용 최소 권한 계정/인증키를 준비합니다. 대상 버킷에서 사진 PUT/GET만 필요하며 버킷 삭제·권한 변경·영구 객체 삭제는 앱에 필요하지 않습니다. 실제 네이버 권한설정 지원 범위는 콘솔에서 확인 후 제한합니다.
6. 인증키는 채팅·스크린샷·공개 저장소로 보내지 않고, Supabase의 함수 Secret 입력 경로에 직접 설정합니다.

### 서버 Secret 이름

- `NCLOUD_PHOTO_ACCESS_KEY`
- `NCLOUD_PHOTO_SECRET_KEY`
- `NCLOUD_PHOTO_BUCKET`
- `LM_PHOTO_TICKET_SECRET`: 무작위 32바이트 이상
- `LM_PHOTO_ALLOWED_ORIGINS`: 허용할 정확한 프런트엔드 Origin 목록. 개발용과 운영용을 분리합니다.

Supabase의 기본 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 Edge Function 서버에서만 읽습니다. 운영 키를 테스트 함수에 무단 복사하지 않습니다.

## 구현 파일

- `ncloud-storage.mjs`: 한국 endpoint `https://kr.object.ncloudstorage.com`, `kr-standard` 리전, S3 SigV4 서버 서명, private ACL, no-store, 경로 검증, 외부 redirect 차단. GET/PUT만 제공하고 삭제 API는 제공하지 않습니다.
- `supabase/functions/landmaker-photos/index.ts`: Supabase 함수 실행 진입점. URL 경로 `/functions/v1/landmaker-photos`를 유지하며 기존 사진 API 핸들러에 연결합니다.
- `schema-proposal.sql`: 신규 사진 테이블과 서버 전용 RPC 제안. 실제 적용 전 테스트 환경에서 검증하고 운영 DB 변경은 별도 승인받습니다.

## 보안상 주의

- 브라우저에 네이버 Access/Secret 키를 넣지 않습니다. 사진 조회 URL에 이 키를 넣지 않습니다.
- Supabase 함수 게이트웨이 JWT 검증 설정은 실제 배포 시 현재 문서를 확인합니다. 게이트웨이 검증 유무와 별개로 함수는 매 요청 Supabase Auth getUser와 직원 권한을 검증합니다.
- URL만 공유해서 사진을 열 수 없습니다. 60초 서명 링크와 동일 직원의 유효한 로그인 세션이 함께 있어야 합니다.
- 네이버 파일을 직접 다운로드하는 공개 URL이나 외부 공개 버킷을 사용하지 않습니다.
- 사진이 연결 해제되어도 물리 객체는 보존합니다. 자동 삭제 lifecycle은 설정하지 않습니다.

## 비용

네이버 Object Storage는 무료 요금제가 아니라 저장량·요청 수·인터넷 송신량에 따라 요금이 발생합니다. 선택한 한국 리전·상품의 공식 요금표를 서비스 신청 직전 확인합니다.

기존 예시의 저장 1GB·월 28원, 쓰기 1만 회 45원, 읽기 1만 회 4원, 인터넷 송신 1GB 100원은 부가세 별도의 사용량 단가입니다. 사진 수만으로 전체 월 요금을 확정할 수 없습니다. Supabase 함수 비용은 별도입니다.

앱의 8GB/쓰기90만/읽기900만 차단값은 초기 애플리케이션 안전장치이며 네이버 무료 한도를 뜻하지 않습니다. 실제 네이버 청구서와 인터넷 전송량을 대시보드에서 확인해야 합니다. 예산 알림은 실제 지원 기능 확인 후 설정하고, 자동으로 절대 과금되지 않는다고 보장하지 않습니다.

## 연결 후 진행 순서

1. 별도 테스트 DB·더미 직원/매물·비공개 테스트 버킷 연결
2. 실제 업로드→조회→광고승인→다운로드→연결삭제→복원 검증
3. 비로그인·권한없는 직원·만료/변조 URL·외부 Origin 차단 검증
4. PC·휴대폰·태블릿의 실제 이미지 변환/카메라/네트워크 재시도 확인
5. 결과 보고 후 운영 DB 변경 승인, 운영 버킷·함수 설정 및 배포

## 참고 공식 문서

https://api.ncloud-docs.com/docs/storage-objectstorage
https://guide.ncloud-docs.com/docs/objectstorage-spec
https://www.ncloud.com/charge/region/ko
