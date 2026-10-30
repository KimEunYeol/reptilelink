# Netlify Free 단독 호스팅 전환 (#79)

앱 호스팅은 **Netlify Free 하나**로 구성한다. Supabase의 전용 서울 프로젝트 `suuemuqwjwbddbjevvmg`는 기존 DB·Auth·private Storage로 유지한다. Cloudflare 준비 기록은 docs45의 당시 증거이며, Netlify 교체 검증 후 운영 요청 경로에서 제외한다. 770.kr은 문서 참고에만 사용하며 DNS·도메인과 무관하다. 홈페이지 문의처는 `770_official@naver.com`, Google 내부 설정은 사용자 본인 계정이다.

## 최신 실제 공개 배포 (#85, 2026-10-30 KST)

- 운영 주소는 **https://reptilelink.netlify.app**이다. main959e2549c4628805c37f522b5486d2d19fe56983의 로컬 production 산출물을 공식 CLI27.16.0의 deploy --no-build --prod로 업로드했다. 배포 version6ae461b7fe048afa4a082df9, published2026-10-30T09:22:04.036Z(18:22KST), production ready/실제 Edge Functions 포함을 확인했다. Git 연결·Actions·클라우드 빌드는 없다. 최초 --context 병용은 로컬 옵션검사에서 거절됐고 옵션을 바로잡아 배포했다.
- 사용자가 해당 Supabase 서버키/새 HMAC의 Netlify production secret 전달을 명시 승인한 뒤 완료했다. 앞선 자동검토 거절은 승인 전 미실행 기록이며 현재 차단 사유가 아니다. 두 값은 production만/is_secret=true이고 실제 값이 공개31파일에 없음을 검사했다. 로컬 환경파일 해시는 보존했다. 키·세션·토큰·HMAC 값을 로그/Git/브라우저에 싣지 않았다.
- 사용자 공개 전환 직전 승인 후 **Production Public / Deploy Previews Private**를 저장했다. 최초401은 Netlify 신규 팀의 플랫폼 비공개 보호였고 공개 후 게스트 검증이 통과했다. 앱 인증/초대/RLS는 그대로이며 Google 연결 전이라 로그인 버튼은 비활성이다. Free의 Powered by Netlify 배지는 유지한다. 배지 숨김은 유료이므로 요청하지 않는다.
- 실제 운영 URL의 HTTP20개와 홈/로그인 각7폭(320/360/390/450/768/1440/1920), 총14뷰에서 넘침0을 확인했다. health200·없는 공개/사진404·익명 업로드401·770 Origin403·직접 URL/인증 no-store/no-referrer·해시 자산 immutable·fixture부재·서버소스 비노출을 검사했다. health5회 왕복80~84ms는 **CPU 측정이 아니다**. Google/승인회원/실제 운영 Storage·탈퇴·부하·원격복구는 미검증이다.
- 새로고침한 실제 billing 화면(18:44KST)은 Free 월$0·카드 없음·생산배포1회15credits·**285/300 잔여**·AI/compute0이다. CLI account capabilities의 used0/sites0은 배포 뒤 UI 실제15/1과 불일치해 잔여량 근거로 쓰지 않는다. Free 고정 한도·자동충전 불가를 유지하며 소진 시 중지를 허용한다.
- Supabase Site URL을 https://reptilelink.netlify.app, 허용 복귀를 그 /auth/callback 하나로 적용했다. 사전 diff의2필드만 push하고 사후 변경0, 다른15개 원격 필드/값의 동일함을 확인했다. Google redirect는 별개인 https://suuemuqwjwbddbjevvmg.supabase.co/auth/v1/callback이다. 가입/쓰기/통계와 Google provider는 중지 상태다.
- Google 웹 client Create 직전 사용자 확인과 실제 운영주체/개인정보 담당자명·최종 정책/권리가 남아 있다. Google 앱은 External/Testing이며 test user0, 브랜딩의 홈페이지/정책 URL 미설정으로 앱 게시가 비활성이다. 770 도메인은 없다. 확인되지 않은 후보를 게시하거나 Google 로그인을 켜지 않는다.
- 앱의 현재 요청 경로와 Supabase 복귀 설정은 Netlify만 사용한다. Cloudflare 임시 준비 프로젝트는 아직 삭제하지 않았으며 docs45의 역사적 증거다. 완전한 회원 흐름 검증 뒤 전용 임시 자원의 철거를 확인해야 한다. 770 DNS/기존 gain-music-club은 변경하지 않았다.
- 로컬18:17 정상 Cron 성공으로 앞서714건 대기는 정리됐다. 후속 관측54건의 가장 오래된 정리 자격18:20:14는 그 Cron 이후이므로 신규 정상 시간 대기로 구분한다. 전역 cleanup/reset/DB 재시작은 없다. 18:32 새 암호화 journal과 기존 archive의 격리 복구32테이블·28실파일128184B·28decode·networknone/Cronoff·RLS/원시권한거절을 통과했다. 로컬5173/8787의 프로세스 부재를 확인해 표준 dev:all로 재시작했고 서비스/Storage/백업 진단은 통과, 새 영수증 대기만 attention이다. 원격 복구 #69는 미완료다.

비밀값 없는 실제 보고서는 ignored .local/netlify-79의 deploy-result-final.log, production-build-result.json, environment-metadata.json, public-checks.json, billing-after-deploy-ui.json, auth-url-verified.json, post-cron-local-restore.json, restarted-local-doctor.json에 보존한다. 공개 URL 검증과 로컬 복구·회원 출시를 구분한다.

## 배포 전 관측 기록 (#83, 아래 내용은 당시 상태)

- #80/PR81: 시계 격리 source fdae4c8의 전체1421 통과·명시 병합 main5a806d2·clean/tree07160c5 일치. #79/PR82: 최종 source1d069a의 build+1472(19/77/1121/34/221) 전체 통과(17:52:55KST), 정확 HEAD/16파일/mergeability 확인·명시 병합 main dc9e09b·clean/tree3cf4340 일치.
- 사용자 CLI 로그인 완료 후 실제 계정 Free·300중 사용0·accumulate_overages=false·pro_trial=false·기존사이트0을 확인했다. 이름 reptilelink, site id c2125a54-71be-478c-9a9b-4d24a87783fd, 주소 https://reptilelink.netlify.app을 생성했다. **주소 등록 완료·앱은 아직 미게시**다. Git 연결/클라우드 빌드/도메인 구매/770 DNS 변경은 없다.
- Free 실제 권한에서 env_var_secrets=true, env_var_scopes=false를 확인했다. 포함된 비밀 환경변수 기능을 쓰되 유료 세부 Functions-only 범위나 플랜 변경을 요청하지 않는다.
- Supabase 서버키와 새 HMAC를 해당 Netlify production secret으로 보내려는 명령은 자동 승인 검토가 민감정보의 Netlify 목적지 전송이 구체적으로 승인되지 않았다는 이유로 거절했다. **명령 전체가 실행되지 않아 키를 조회·전송하지 않았다.** 해당 데이터/목적지를 명시해 사용자 승인을 요청 중이며 우회하지 않는다.
- 독립 공개값 전용 WSL production 빌드는31파일·fixture=false/Google=false·로컬 환경 해시 보존·공개 변수 허용목록/서버키 패턴 부재 검사를 통과했다. 이 빌드는 서버 비밀값을 읽지 않았고 아직 외부 업로드하지 않았다. Google client 생성 직전 확인과 실제 운영주체명/개인정보 담당자명·정책 확정도 대기다.
- 모든 실제 테스트 뒤 새 로컬 암호화 백업/최신 journal과 격리 복구를 완료했다. 32테이블·28실파일128184B·28decode·networknone/Cronoff·원시/ledger 접근 거절/RLS를 확인했다. 기존 파일과 분리 키를 보존했으며 원격 복구 #69를 대체하지 않는다.
- 현재 doctor는 서비스·loopback·실제 Storage/백업 인증 통과, DB는 영수증714건 대기로 attention이다. 18:02KST 관측에서 마지막 정상 Cron은17:17:00.030 종료, 가장 오래된 현재 영수증 정리 자격은17:17:00.231이었다. 이전 오래된 대기는 없어졌고 새 자격은 Cron 이후다. 계정·개체·사진 정리 대기는0. 다음 정규 Cron은18:17 예정이며 관측 전 성공으로 표시하지 않는다. 전역 cleanup/reset은 없다.

## 비용 조건과 실제 계정

최초 사이트 생성 전 2026-10-30 로그인한 Netlify `gimeunyeol` 팀에서 Free, 300/300 credits, 저장된 결제수단 없음, 기존 프로젝트 0개를 관측했다. [공식 요금표](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)의 Free는 월 $0·300 credits 고정 한도이며 자동 충전을 제공하지 않는다. 한도 초과 시 사이트가 일시 중지될 수 있다. **초과 과금 방지와 무중단 가동은 다른 조건**이며, 무료 한도가 무제한 트래픽을 보장하지 않는다.

생산 배포 1회 15 credits, 전송 1GB 20 credits, 요청 10,000회 2 credits인 현재 공식 기준을 배포 직전에 실제 잔여량과 대조한다. 카드·체험판·업그레이드·유료 부가 기능·AI·자동 충전은 추가하지 않는다. Supabase도 Free를 유지한다. 약관·플랜이 이후 변경되면 재확인하며 현재 조건을 영구 요금 보장으로 표현하지 않는다.

현재 최종 공개 주소는 https://reptilelink.netlify.app이다. 아래는 생성 당시의 결정 기준이다. 최종 주소는 소유권 확인 뒤 `reptilelink`를 포함한 무료 `netlify.app` 주소로 확정한다. `reptilelink.netlify.app` 이름은 실제 생성으로 확보했으며 앱 업로드/운영 검증 완료와는 구분한다. 도메인 구매·770 연결은 하지 않는다.

## 연결부와 빌드

`netlify/edge-functions/reptilelink.ts`는 기존 `worker/index.ts`의 fetch를 그대로 호출한다. Netlify의 서버 환경 변수와 표준 Request/Response, `context.next(request)`를 정적 자산 continuation으로 연결한다. 기능·RPC·공개 DTO·DB schema·사진 접근 계약·제품 화면은 변경하지 않는다. [공식 Edge API](https://docs.netlify.com/build/edge-functions/api/)와 [요청 순서](https://docs.netlify.com/resources/troubleshooting/request-chain/)에 따라 API·공개·인증·관리 경로를 Edge에서 먼저 처리하고 나머지는 SPA fallback을 사용한다. 캐시 opt-in은 하지 않는다.

`npm run build`는 WSL에서 타입 검사·Vite 정적 빌드·esbuild 서버 번들을 만든다. esbuild는 기존 설치 버전 0.28.2를 직접 고정 의존성으로 명시했다. [생성 모듈 지침](https://docs.netlify.com/build/edge-functions/create-integration/)에 맞춰 npm 및 확장자 없는 저장소 import를 단일 ESM으로 묶는다. 생성 서버 코드는 공개 dist 밖의 ignored `.netlify/edge-functions-generated`에 둔다. 비밀값을 번들에 삽입하지 않으며 실행 중 `Netlify.env`로 읽는다. 기존 Cloudflare 설정과 로컬 환경 파일은 덮어쓰지 않는다.

## 실제 로컬 증거와 한계

- `npm run test:netlify`: 실제 loopback Auth 계정 2개·DB·private Storage를 사용한 51개 검사를 통과했다. 소유자/타인/익명 권한, Origin 거절, 미설정 503, 인증 no-store/no-referrer, 실제 WebP 바이트/hash, 공개 HTML의 같은 호스트 메타, 비공개 404, 탈퇴 후 Storage 파일 제거·기존 토큰 차단을 검사했다. 임시 QA 계정만 정리했고 기존 Storage 개수는 유지했다.
- 같은 검사에 docs45의 CC0 웹 게코 사진을 입력해 실제 변환·Storage 업로드/검증·접근·탈퇴 후 실파일 제거까지 다시 통과했다. 원본은 공개 저장소에 올리지 않았다.
- `npx --yes netlify-cli@27.16.0 build --offline --context dev`: 로컬 빌드와 Netlify Deno/eszip 패키징을 통과했다. 첫 시도의 확장자 없는 import 실패를 서버 단일 번들로 해결했다. 클라우드 빌드를 사용하지 않았다.
- 공식 CLI가 설치한 실제 Deno 실행 파일로 생성 번들을 실행하고 loopback DB에 연결한 5개 검사도 통과했다. 첫 실행의 선택적 HMAC 환경 읽기 권한 누락은 격리 테스트의 해당 변수 읽기만 허용해 수정했다. DB·서비스 네트워크 제한은 유지했다.

위 로컬 테스트의 Netlify 환경/정적 continuation은 테스트 대역이다. 상단 #85의 실제 게스트 검증과 구분하며 Google 인증·실제 회원 검증을 대체하지 않는다. 전체 고정 검증 결과는 해당 commit의 `.local/harness-verification.json`과 PR의 실제 실행 결과로 확인한다. 문서만 검사해 런타임 변경을 통과 처리하지 않는다. 비공개 로그는 `.local/netlify-79`에 보존한다.

## 첫 전체 검증 실패와 독립 수정

초기 source `2d24f9a`는 build/단위/DB/미디어 통과 뒤 E2E220/221로 실패했다. 사진 예약 응답 손실 재시도 중 단조 시간 +106.373ms 동안 호스트 wall clock -1339ms가 trace에 기록됐고 앱은 의도대로 만료 보호를 적용했다. 실패 증거는 비공개 경로에 보존했다.

독립 #80/PR81에서 해당 사진 복구 테스트의 Date만 고정했고, 실제 monotonic timer·DB 시각·Storage/UUID 검사와 제품의 역행/만료 거절은 유지했다. 표적27개/경계단위3개와 고정 source fdae4c8의 build+1421 전체 검사가 2026-10-30T08:32:04.163Z 통과했다. 명시 병합한 clean main5a806d2와 검증 트리07160c5 일치를 확인하고 #79를 그 최신 기반으로 rebase했다. 이 #79의 새 전체 검증은 별도 실제 보고서로 확인하며 이전 실패를 성공으로 바꾸지 않는다.

## 배포 및 전환 절차 (완료 여부는 상단 #85 참조)

1. WSL CLI 인증과 Free 팀/잔여량을 확인하고 무료 사이트 이름을 확보한다. Git 연결·자동 배포·클라우드 빌드·AI 실행을 켜지 않는다.
2. 최신 HEAD의 전체 verify·직접 리뷰·PR·expected-HEAD 명시 병합과 깨끗한 main/트리 일치를 확인한다.
3. 실제 소유한 운영 origin에 맞춰 production 전용 서버 변수를 준비한다. `SUPABASE_SECRET_KEY`와 새 `ANALYTICS_HMAC_KEY`는 서버에만 전달하며 값·CLI 토큰·세션을 채팅/Git/로그에 노출하지 않는다. Free 기본 범위와 production context를 사용한다. Free 기본 범위에는 Functions가 포함되지만 Functions-only 세부 범위 지정은 유료 기능이므로 요청하지 않는다. 서버 변수는 공개 앱 변수로 전달하지 않으며 클라우드 빌드·Forms·signed proxy·snippet 주입을 켜지 않는다. 유료 Secrets Controller를 활성화하지 않는다. public URL/publishable key·문의 이메일만 Vite에 전달하고 fixture 인증은 끈다. Google flag는 실제 provider 준비 뒤 켠다.
4. 기존 로컬 환경 파일을 덮어쓰지 않는 격리 production 환경으로 WSL에서 빌드하고 고정 CLI의 `deploy --no-build --prod`로 로컬 산출물을 업로드한다. 먼저 CLI help로 실제 옵션·사이트 식별자를 확인한다. 서버 번들·키가 정적 공개 경로에서 다운로드되지 않는지 검사한다.
5. 확보한 Netlify URL의 7폭/직접 URL·없는 공개/사진/API 404·익명 401·Origin·인증 캐시·문의/fixture 부재를 확인한다. 그 후에만 Supabase Site URL/정확한 앱 callback을 변경한다. Google callback은 Supabase Auth callback이다.
6. 확정 정책의 새 불변 버전·published·동의/재동의, 초대/승인·실제 Google 성공/취소/오류·로그아웃·회원/사진/탈퇴·소규모 성능을 별도 실제 증거로 확인한다. 사용자 실사용 계정을 탈퇴 시험에 쓰지 않는다.
7. Netlify가 교체 역할을 실제로 수행함을 확인한 뒤 렙타일링크의 Cloudflare 준비 호스트를 운영 경로에서 제외한다. 다른 서비스와 Supabase는 보존한다. 배포 commit/version/URL·Free 사용량과 남은 항목을 #62에 기록한다.

Netlify CLI 인증·이름 확보·실제 앱 공개 배포·게스트 URL 검증·정확한 Supabase 복귀 URL 적용은 완료했다. Google 웹 클라이언트 생성/provider 연결, 운영자 신원/정책 확정·회원 개방/실제 원격 회원 검증은 별도 미완료다. #69 원격 백업·Free 복구 프로젝트 시험도 미완료이며 로컬 28파일 복구 성공으로 대체하지 않는다. 최종 출시 결정은 사용자에게 남긴다.

Netlify Edge의 공식 한도는 요청당 CPU50ms(IO 대기 제외), 메모리512MB, 압축 번들20MB, 응답 헤더 제한40초다. [공식 한도](https://docs.netlify.com/build/edge-functions/limits/)와 실제 사용을 별도로 확인한다. 현재 HTTP 왕복만으로 CPU 한도 충족을 단정하지 않는다. [공개/미리보기 분리](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)와 [Free 배지](https://docs.netlify.com/manage/projects/powered-by-netlify-badge/)는 실제 저장한 상태를 따른다.
