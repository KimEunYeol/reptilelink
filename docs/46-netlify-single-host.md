# Netlify Free 단독 호스팅 전환 (#79)

앱 호스팅은 **Netlify Free 하나**로 구성한다. Supabase의 전용 서울 프로젝트 `suuemuqwjwbddbjevvmg`는 기존 DB·Auth·private Storage로 유지한다. Cloudflare 준비 기록은 docs45의 당시 증거이며, Netlify 교체 검증 후 운영 요청 경로에서 제외한다. 770.kr은 문서 참고에만 사용하며 DNS·도메인과 무관하다. 홈페이지 문의처는 `770_official@naver.com`, Google 내부 설정은 사용자 본인 계정이다.

## 비용 조건과 실제 계정

2026-10-30 로그인한 Netlify `gimeunyeol` 팀에서 Free, 300/300 credits, 저장된 결제수단 없음, 기존 프로젝트 0개를 관측했다. [공식 요금표](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)의 Free는 월 $0·300 credits 고정 한도이며 자동 충전을 제공하지 않는다. 한도 초과 시 사이트가 일시 중지될 수 있다. **초과 과금 방지와 무중단 가동은 다른 조건**이며, 무료 한도가 무제한 트래픽을 보장하지 않는다.

생산 배포 1회 15 credits, 전송 1GB 20 credits, 요청 10,000회 2 credits인 현재 공식 기준을 배포 직전에 실제 잔여량과 대조한다. 카드·체험판·업그레이드·유료 부가 기능·AI·자동 충전은 추가하지 않는다. Supabase도 Free를 유지한다. 약관·플랜이 이후 변경되면 재확인하며 현재 조건을 영구 요금 보장으로 표현하지 않는다.

최종 주소는 소유권 확인 뒤 `reptilelink`를 포함한 무료 `netlify.app` 주소로 확정한다. `reptilelink.netlify.app`은 아직 미예약 후보이며 실제 이름 충돌 확인 전 확보했다고 쓰지 않는다. 도메인 구매·770 연결은 하지 않는다.

## 연결부와 빌드

`netlify/edge-functions/reptilelink.ts`는 기존 `worker/index.ts`의 fetch를 그대로 호출한다. Netlify의 서버 환경 변수와 표준 Request/Response, `context.next(request)`를 정적 자산 continuation으로 연결한다. 기능·RPC·공개 DTO·DB schema·사진 접근 계약·제품 화면은 변경하지 않는다. [공식 Edge API](https://docs.netlify.com/build/edge-functions/api/)와 [요청 순서](https://docs.netlify.com/resources/troubleshooting/request-chain/)에 따라 API·공개·인증·관리 경로를 Edge에서 먼저 처리하고 나머지는 SPA fallback을 사용한다. 캐시 opt-in은 하지 않는다.

`npm run build`는 WSL에서 타입 검사·Vite 정적 빌드·esbuild 서버 번들을 만든다. esbuild는 기존 설치 버전 0.28.2를 직접 고정 의존성으로 명시했다. [생성 모듈 지침](https://docs.netlify.com/build/edge-functions/create-integration/)에 맞춰 npm 및 확장자 없는 저장소 import를 단일 ESM으로 묶는다. 생성 서버 코드는 공개 dist 밖의 ignored `.netlify/edge-functions-generated`에 둔다. 비밀값을 번들에 삽입하지 않으며 실행 중 `Netlify.env`로 읽는다. 기존 Cloudflare 설정과 로컬 환경 파일은 덮어쓰지 않는다.

## 실제 로컬 증거와 한계

- `npm run test:netlify`: 실제 loopback Auth 계정 2개·DB·private Storage를 사용한 51개 검사를 통과했다. 소유자/타인/익명 권한, Origin 거절, 미설정 503, 인증 no-store/no-referrer, 실제 WebP 바이트/hash, 공개 HTML의 같은 호스트 메타, 비공개 404, 탈퇴 후 Storage 파일 제거·기존 토큰 차단을 검사했다. 임시 QA 계정만 정리했고 기존 Storage 개수는 유지했다.
- 같은 검사에 docs45의 CC0 웹 게코 사진을 입력해 실제 변환·Storage 업로드/검증·접근·탈퇴 후 실파일 제거까지 다시 통과했다. 원본은 공개 저장소에 올리지 않았다.
- `npx --yes netlify-cli@27.16.0 build --offline --context dev`: 로컬 빌드와 Netlify Deno/eszip 패키징을 통과했다. 첫 시도의 확장자 없는 import 실패를 서버 단일 번들로 해결했다. 클라우드 빌드를 사용하지 않았다.
- 공식 CLI가 설치한 실제 Deno 실행 파일로 생성 번들을 실행하고 loopback DB에 연결한 5개 검사도 통과했다. 첫 실행의 선택적 HMAC 환경 읽기 권한 누락은 격리 테스트의 해당 변수 읽기만 허용해 수정했다. DB·서비스 네트워크 제한은 유지했다.

위 테스트의 Netlify 환경/정적 continuation은 테스트 대역이다. 실제 Netlify 배포·정적 fallback·전역 캐시·Google 인증 검증을 대체하지 않는다. 전체 고정 검증 결과는 해당 commit의 `.local/harness-verification.json`과 PR의 실제 실행 결과로 확인한다. 문서만 검사해 런타임 변경을 통과 처리하지 않는다. 비공개 로그는 `.local/netlify-79`에 보존한다.

## 첫 전체 검증 실패와 독립 수정

초기 source `2d24f9a`는 build/단위/DB/미디어 통과 뒤 E2E220/221로 실패했다. 사진 예약 응답 손실 재시도 중 단조 시간 +106.373ms 동안 호스트 wall clock -1339ms가 trace에 기록됐고 앱은 의도대로 만료 보호를 적용했다. 실패 증거는 비공개 경로에 보존했다.

독립 #80/PR81에서 해당 사진 복구 테스트의 Date만 고정했고, 실제 monotonic timer·DB 시각·Storage/UUID 검사와 제품의 역행/만료 거절은 유지했다. 표적27개/경계단위3개와 고정 source fdae4c8의 build+1421 전체 검사가 2026-10-30T08:32:04.163Z 통과했다. 명시 병합한 clean main5a806d2와 검증 트리07160c5 일치를 확인하고 #79를 그 최신 기반으로 rebase했다. 이 #79의 새 전체 검증은 별도 실제 보고서로 확인하며 이전 실패를 성공으로 바꾸지 않는다.

## 배포 및 전환 순서

1. WSL CLI 인증과 Free 팀/잔여량을 확인하고 무료 사이트 이름을 확보한다. Git 연결·자동 배포·클라우드 빌드·AI 실행을 켜지 않는다.
2. 최신 HEAD의 전체 verify·직접 리뷰·PR·expected-HEAD 명시 병합과 깨끗한 main/트리 일치를 확인한다.
3. 실제 소유한 운영 origin에 맞춰 production 전용 서버 변수를 준비한다. `SUPABASE_SECRET_KEY`와 새 `ANALYTICS_HMAC_KEY`는 서버에만 전달하며 값·CLI 토큰·세션을 채팅/Git/로그에 노출하지 않는다. Free 기본 범위와 production context를 사용한다. Free 기본 범위에는 Functions가 포함되지만 Functions-only 세부 범위 지정은 유료 기능이므로 요청하지 않는다. 서버 변수는 공개 앱 변수로 전달하지 않으며 클라우드 빌드·Forms·signed proxy·snippet 주입을 켜지 않는다. 유료 Secrets Controller를 활성화하지 않는다. public URL/publishable key·문의 이메일만 Vite에 전달하고 fixture 인증은 끈다. Google flag는 실제 provider 준비 뒤 켠다.
4. 기존 로컬 환경 파일을 덮어쓰지 않는 격리 production 환경으로 WSL에서 빌드하고 고정 CLI의 `deploy --no-build --prod`로 로컬 산출물을 업로드한다. 먼저 CLI help로 실제 옵션·사이트 식별자를 확인한다. 서버 번들·키가 정적 공개 경로에서 다운로드되지 않는지 검사한다.
5. 확보한 Netlify URL의 7폭/직접 URL·없는 공개/사진/API 404·익명 401·Origin·인증 캐시·문의/fixture 부재를 확인한다. 그 후에만 Supabase Site URL/정확한 앱 callback을 변경한다. Google callback은 Supabase Auth callback이다.
6. 확정 정책의 새 불변 버전·published·동의/재동의, 초대/승인·실제 Google 성공/취소/오류·로그아웃·회원/사진/탈퇴·소규모 성능을 별도 실제 증거로 확인한다. 사용자 실사용 계정을 탈퇴 시험에 쓰지 않는다.
7. Netlify가 교체 역할을 실제로 수행함을 확인한 뒤 렙타일링크의 Cloudflare 준비 호스트를 운영 경로에서 제외한다. 다른 서비스와 Supabase는 보존한다. 배포 commit/version/URL·Free 사용량과 남은 항목을 #62에 기록한다.

현재 Netlify CLI 인증·최종 이름 확보/배포, Google 웹 클라이언트 생성/provider 연결, 운영자 신원/정책 확정·회원 개방/실제 원격 회원 검증은 별도 미완료다. #69 원격 백업·Free 복구 프로젝트 시험도 미완료이며 로컬 28파일 복구 성공으로 대체하지 않는다. 최종 출시 결정은 사용자에게 남긴다.
