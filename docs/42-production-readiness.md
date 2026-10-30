# 무료 운영 기반 준비 결과 (#68)

최신 실행 상태는 [Netlify 단독 호스팅](46-netlify-single-host.md)과 [이슈62](https://github.com/KimEunYeol/reptilelink/issues/62)를 따른다. 아래 과거 시각의 관측/명령은 당시 기록이며 현재 대상에 그대로 재실행하지 않는다. 앱은 Netlify Free 하나로 전환하고 Supabase는 유지한다.

reptilelink.netlify.app 이름은 확보했지만 앱은 아직 미업로드다. 아래 workers.dev Auth 설정은 이전 준비값이며 실제 Netlify 서버/콜백 확인 후에만 바꾼다. 서버 키의 Netlify 전달은 명시적 목적지 승인을 요청 중이며 거절된 명령은 실행되지 않았다.
2026-10-30 KST 관측 기록이다. 전체 출시 작업은 [이슈 #62](https://github.com/KimEunYeol/reptilelink/issues/62), 자료 양식과 실행 순서는 [docs/41](41-desktop-execution-checklist.md)에서 관리한다. 운영자료·Google OAuth·공개 배포·원격 복구는 아직 미완료다.

## 확인한 운영 기반

| 대상 | 실제 결과 |
|---|---|
| Supabase | 조직 Free, 생성 견적 월 0원. 전용 reptilelink / `suuemuqwjwbddbjevvmg` / 서울 `ap-northeast-2` / ACTIVE_HEALTHY |
| DB 이력 | main `5838c5d`의 migration 37개를 공식 CLI로 dry-run 후 적용. 로컬·원격의 원래 버전 일치 |
| DB 권한 | 앱 테이블 32개 모두 RLS 활성. anon/authenticated에 앱 테이블 직접 권한 없음. private schema 비노출 |
| 사진 버킷 | private `animal-media`, WebP만 허용, 객체당 225,280바이트(220KiB). 현재 객체 0개 |
| 정리 Cron | 활성 1개, `reptilelink-activity-retention`, `17 * * * *`(매시 17분). 등록과 실제 실행 성공은 별도로 확인 |
| 출시 전 상태 | 쓰기·가입·통계 플래그 false. 정책은 unconfigured, 사용자·프로필·초대 목록 0건 |
| Cloudflare | 현재 Workers Free US$0. Worker/Pages 프로젝트 0개, 오늘 요청 0/100,000. 화면의 CPU 한도는 요청당 10ms |
| 인증 | 사용자가 Cloudflare 이메일 확인과 WSL Supabase/Wrangler 로그인을 완료했고 실제 CLI 접근을 확인 |
| 예상 주소 | `https://reptilelink.nianosrep.workers.dev` — 계정 서브도메인에서 정한 **미배포 주소** |

원격 DB는 전체 13,227,699바이트, 앱 관계는 933,888바이트로 관측했다. 기존 `gain-music-club` 프로젝트와 로컬 DB·파일·환경 키·dist를 보존했다. 결제수단·유료 플랜·체험판·Actions·클라우드 빌드를 추가하지 않았다. 기존 결제정보 유무를 추정하지는 않는다.

## 적용 설정과 실제 원격 검사

로컬 `supabase/config.toml`을 수정하거나 복사해 올리지 않았다. WSL `.local/production-preflight-62/supabase-config`의 별도 부분 설정에서 아래 선언값만 diff 검토 후 적용했다.

```toml
[api]
schemas = ["public", "api"]
max_rows = 100
[auth]
site_url = "https://reptilelink.nianosrep.workers.dev"
additional_redirect_urls = ["https://reptilelink.nianosrep.workers.dev/auth/callback"]
enable_signup = false
enable_anonymous_sign_ins = false
[auth.email]
enable_signup = false
[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/api/before_user_created"
[storage]
file_size_limit = "220KiB"
```

재조회에서 적용할 차이는 0개였다. 선언하지 않은 MFA·메일 확인·OTP·풀러·벡터 설정 8개는 원격 값을 유지했다. 신규 테이블 자동 노출 설정은 이 diff에서 확인되지 않았으므로 별도 적용했다고 주장하지 않는다.

출시 전 중지를 위해 원격 쓰기·가입·통계 플래그를 각각 짧은 트랜잭션에서 true→false로 바꿨다. 변경 전 값은 WSL 비공개 기록에 보존했다. migration에는 운영 정책·로컬 fixture·실제 사진을 추가하지 않았고, seed/Vault/검토용 전체 schema SQL도 실행하지 않았다.

실제 익명 HTTPS 요청에서 다음을 확인했다.

- `policy_context`: HTTP 200, mode=unconfigured, version/digest=null, accepted=false.
- private schema 요청: HTTP 406/PGRST106으로 거절.
- Auth settings: HTTP 200, 가입 차단, Google/email provider 비활성.

Hook은 Auth 관리자 실행 권한이 있고 anon에는 없다. DBA로 호출한 미초대 이벤트는 403을 반환했다. 관리형 DB의 `supabase_auth_admin` 역할 전환은 거절됐으므로 해당 역할의 실제 호출 성공이나 OAuth 통합을 검증했다고 기록하지 않는다.

보안 advisor는 INFO 24개(RLS 활성·정책 없음)를 반환했다. RPC 전용 테이블과 직접 권한 철회를 대조했으며, 반환 결과에 WARN/ERROR는 없었다. 이는 전체 보안 감사 완료를 뜻하지 않는다. [해당 advisor 안내](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## 로컬 빌드·원본 비교·검증 결과

실제 공개 Supabase URL/publishable key, Google=true, fixture=false로 기존 dist와 분리한 production 빌드를 만들었다. 문의 이메일은 미설정이다. tsc/Vite 빌드와 서버 비밀·로컬 키의 번들 부재, 기존 환경 파일 해시 보존을 확인했다. Worker dry-run도 assets 37개·gzip 279.69KiB로 통과했다. 업로드·Worker·원격 secret 생성은 하지 않았다.

별도 loopback 미리보기에서는 fixture 로그인 버튼 0개와 Google 버튼 활성 상태를 확인했다. 실제 OAuth 버튼을 실행하지 않았으며, 확인 후 직접 시작한 4174 서버만 종료했다.

로컬 메인·로그인·문의와 관리 6화면을 320/360/390/450/768/1440/1920px에서 캡처했다. 63개 캡처의 가로 넘침과 이미지 실패는 0건이다. 원본 보드의 PC 공통 설명(0,8400,5000,1000)과 디자인 열(1950,1200,1200,4400), 관련 PC/m 화면을 직접 대조했다. ‘메인 외 본문은 모바일과 같은 크기/레이아웃, 상세 팝업은 모바일 기준’ 설명을 적용 기준으로 확인했다.

대표 화면의 비교 중 모바일 아바타 등록·삭제 버튼이 원본과 달리 아래로 내려가는 차이를 찾아 [이슈 #70](https://github.com/KimEunYeol/reptilelink/issues/70)으로 분리했다. 이후 #70에서 같은 옆배치를 소스에 적용하고 실제7폭/관련26흐름을 검증했다. 이후 PR74에서 source f16a76d의 고정 전체 build+1,421검사를 15:26:39 KST에 통과하고 main9477a49로 병합했다. [배치 수정 기록](44-mobile-avatar-layout.md). 정확한 폰트·자산 배포 권리와 모든 팝업/미저장/실패 상태의 최종 시각 비교는 남아 있다. 캡처는 ignored `artifacts/desktop-preflight-62`에 보관한다.

새 로컬 암호화 백업·최신 journal과 networknone/Cronoff 격리 복구는 32테이블·실파일 28개/128,184바이트·WebP 디코드 28개·권한 검사에 통과했다. 원격 복구 증거로 사용하지 않는다.

**전체 `npm run verify`는 실패했다.** build·하네스 19·단위 77·DB/Worker 1,070·미디어 34는 통과했고, 브라우저는 220/221이었다. 완료는 2026-10-30 14:21:00 KST, source HEAD는 `5838c5d`다. 만료 목록의 최신 조회가 실패한 뒤 스위치가 활성화되는 결함을 [이슈 #71](https://github.com/KimEunYeol/reptilelink/issues/71)로 분리했다. 이후 PR73에서 수정하고 source b807a040의 고정 전체 build+1,421개를 14:49:43 KST에 통과해 main 3cfb2ae로 병합했다. 초기 실패는 과거 관측으로 보존한다. 실패 로그·trace·full report는 비공개 경로에 보존했다. 이번 문서 변경의 docs-only 검사는 실패한 기능 전체 검사를 대체하지 않는다.

## 남은 작업과 재개 기준

1. #71/PR73과 #70/PR74는 각각 고정 전체검사·최신diff 리뷰·명시적 squash 후 병합됐다. 최종 기능 main9477a49와 검증 source f16a76d의 파일트리 d438985가 일치한다.
2. 실제 운영 주체·공개 문의 이메일·확정 약관/개인정보 본문·보관/삭제/백업 방침·자산 권리·검증용 Google 계정/사진을 확보한다. 미제공 자료는 창작·게시하지 않는다.
3. 확정 자료로 새 불변 정책 버전/published와 Google provider·초대/승인을 구성한다. Google callback은 Supabase Auth callback, 앱 복귀 URL은 workers.dev의 `/auth/callback`으로 구분한다.
4. 검증한 main과 자료로 production 빌드·원격 secret/Worker 배포 후 실제 URL의 OAuth·권한·사진·공유 HTML·탈퇴 실물 정리·CPU/egress를 검증한다. 현재 예상 주소를 배포 URL로 보고하지 않는다.
5. [이슈 #69](https://github.com/KimEunYeol/reptilelink/issues/69)에서 운영 전용 암호화 백업·별도 키·최신 탈퇴 journal과 Free 원격 복구의 Auth/Storage/API·실제 계정/사진 복구를 구현·검증한다. 로컬 도구의 loopback 제한을 풀지 않는다.

검증 전에는 가입·쓰기·통계를 자동 재개하지 않는다. 문제가 있으면 중지 상태를 유지하고 코드는 보완 PR, DB는 새 migration으로 수정한다. 이력 삭제·전체 schema 재실행·reset·다른 프로젝트 변경은 하지 않는다. 기본 백업 담당은 사용자이며 일일 실행/7일 보관·최신 journal·키 보관 절차를 실제 운영 방침으로 확정해야 한다. 자동 데몬은 설치하지 않았다. #62/#69는 실제 증거가 확보될 때까지 유지하고 출시 판단은 사용자에게 남긴다.

추가 원격 관측: 단일 Cron의 2026-10-30 14:17:00 KST 실행 성공을 확인했다. Google 콘솔의 기존 My First Project는 OAuth 미구성이며 새 OAuth 앱/client나 유료 리소스는 만들지 않았다. 대상 운영 주체/권리 자료와 검증용 계정이 확정된 뒤 구성한다.

## 최종 로컬 보존 확인 (2026-10-30 15:29~15:30 KST)

최신 기능 main9477a49에서 별도 production 빌드·Worker dry-run을 다시 통과했다. assets37개/Worker gzip279.69KiB이며 실제 업로드/배포는 없다. 로컬 환경파일 해시 보존과 서버/로컬 키의 브라우저번들 부재를 확인했다.

새 암호화 archive/별도키/최신journal의 격리복구는32테이블·28실파일/128,184B·28WebP디코드·원시권한거절/RLS·networknone/Cronoff를 통과했다. 보관검사는 미검증/만료파일0이며 자동데몬은 없다. doctor의 설정/loopback/서비스/Storage·백업인증은 통과했지만 영수증 정리대기1건으로 attention이다. 해당 건의 정리자격 발생15:28:18은 최근 정상 단일Cron15:17:00 이후였다. 다음16:17은 예정이며 실제배출 완료로 추정하지 않는다. 전역cleanup/reset은 실행하지 않았다. 실제 결과는 비공개 `.local/profile-70`과 #62에 기록했다.

Windows 최종목록은 README·실행기·기존.git이며 두 안내파일의 SHA256은 정리시 기록과 일치했다. 기존 원본/DB/28사진/키·타서비스를 보존했다. 정책/권리·Google실계정·공개배포·원격CPU/egress·#69 운영백업/실제원격복구는 여전히 미완료다.
