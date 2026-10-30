# 운영 실행 체크리스트와 자료 입력 (#66 / 외부 #62)

2026-10-30 KST 사용자 승인 계획의 실행 기준이다. 실제 개발은 WSL `/home/eykim/projects/reptilelink`에서만 수행한다. [데스크톱 인계](40-gpt-desktop-handoff.md)의 과거 관측값과 현재 결과를 구분한다. 코드·DB·운영 도구 변경은 독립 이슈/최신 main 브랜치/전체검사/리뷰/PR로 진행하고, 문서만 바꾸면 docs-only 검사를 사용한다.

## 현재 실제 운영 (2026-10-31 KST, #91)

**[실제 운영·백업 인계](48-live-operations-handoff.md)**를 먼저 읽는다. 운영 주소는 https://reptilelink.netlify.app이다. 실제 본인 Google 로그인·초대/승인·v1 필수동의·비공개 공간·개체/사진 저장·새로고침/재로그인과 관리 화면 6개 접근을 확인했다. Google OAuth 앱은 Production이며 초대 Hook·승인·10명 한도를 유지한다.

별도 Free 복구본의 실제 Google·실파일·API 재연결과 승인된 복사본 탈퇴·파일 제거·기존 토큰401을 확인했다. 복사된 cleanup 기한1개는 target에서만 통제 만료했다. 만료 전 동일 signed URL과 실제 source 회원의 post-backup 탈퇴/journal 통합은 미검증이다. 복구 Google와 가입은 다시 닫고 임시 서버를 종료했으며 원본은 보존했다.

공개 문의 770_official@naver.com/개인정보 담당자 고경윤과 내부 Google 관리를 구분한다. 770.kr은 운영 도메인·DNS와 무관하다. 실제 Free/카드 없음/270/300 잔여를 확인했고 추가 지출은 0원이다. 수동 일일 백업·7일 보관·별도 키·변경 후/복구 직전 최신 journal은 docs47/48을 따른다. 자동 데몬은 없다. 모든 타회원 흐름·CPU·브랜드 권리·임시 Cloudflare 철거·사용자의 최종 출시 판단은 #62에 남긴다.

아래 이전 시점의 미완료·수치·실패 기록은 당시 관측이며 현재 상태와 구분한다.

## 실행 결과와 남은 범위

| 단계 | 실제 완료 | 남은 범위 |
|---|---|---|
| 안내/Windows | 초기 정리 PR67·고유 증거 보존·정확한 README/실행기/.git 세 항목; #91 현행 연결 | 수정 전후 해시·연결 감사는 WSL 비공개 기록 |
| 로컬 보존 | 기존 자료·32테이블/28실파일 암호화 백업/격리 복구·정상 Cron 확인, 전역 cleanup 없음 | 최종 doctor attention은 원인별 기록 |
| 디자인/권리 | 원본97PNG 설명·PC/m 대표 비교·9화면7폭, #71/#70 수정 | 모든 상태·브랜드 권리 확인 |
| Free/DB | 전용 서울 Supabase/37 migration·32 RLS테이블/private bucket/단일Cron·초대Hook | 실제 무료 한도 지속 확인 |
| 정책/OAuth | v1 immutable/published/본문 일치·본인 동의·Google Production·실제 초대/승인/재로그인 | 타실회원·오류/취소/재동의 전체 조합 |
| 배포 | Netlify main71f9bc3/version6ae4a79b; Google=true/fixture=false; 운영공개/preview비공개 | 배포마다 검증·Free 조건 확인 |
| 실사용/성능 | 비공개 개체1·사진2파일 저장/조회·6관리화면·익명 경계·대표7폭 | 원격 기능 전수·타회원·CPU/전송량 |
| 백업/복구 | #69 도구/전체검사·실제 Google/파일/API 원격 복구·승인 복사본 탈퇴/토큰401 | source 회원 post-backup탈퇴/journal 통합·만료전 동일signedURL |
| 운영/출시 | 기본 사용자·일일 수동 백업/7일·별도 키·최신 journal·자동 데몬 없음 | 증거/잔여 검토 후 사용자 최종 출시 결정 |

## 운영자료 입력 양식

아직 없으면 `미정`으로 남긴다. 공개 정보만 이 문서/이슈에 기록하고 개인 이메일·테스트계정·계약서 원문은 비공개 경로로 관리한다. 비밀번호/키/토큰/인증파일은 채팅·Git에 보내지 않는다.

| 입력 | 제공/확인할 내용 | 기본 처리 |
|---|---|---|
| 운영주체/표시명 | 실제 운영자/단체명·서비스명, 사업자라면 공개할 실제 사업정보 | 예시 회사/TEAM770 사용 금지 |
| 문의 이메일 | 서비스에 공개할 수 있고 실제 수신 가능한 주소 | 770_official@naver.com 지정·공개 빌드 반영; 수신은 사용자가 확인 |
| 이용약관 | 가입/초대승인·서비스/금지행위·게시물권리·제한/탈퇴 기준을 담은 확정본문과 버전/적용일 | 사용자 확정 전 창작/게시하지 않음 |
| 개인정보 | 실제 수집정보/목적·보관/삭제·처리업체/국외처리·권리행사창구를 확인한 확정본문 | 실제 Google/Supabase/Netlify 처리와 대조; 법적완성을 주장하지 않음 |
| 자산권리 | 로고·브랜드·폰트·이미지별 출처/라이선스·웹배포/임베딩 허용근거 | CC0 검증사진 권리/해시 확인·별도 글꼴 파일/외부 글꼴 배포 없음; 원본 브랜드/시안 권리는 구분 |
| 검증계정/사진 | 테스트에 사용할 Google 계정이메일·역할·사용허락 사진 | 사용자가 허용한 CC0 웹 사진은 실제 로컬 변환/Storage/탈퇴 제거 확인; Google 실계정과 운영 탈퇴 시험은 별도, 로컬fixture 복제 금지 |
| 백업/운영책임 | 책임자·실행가능시간·보관/탈퇴반영·키보관·장애연락 | 기본담당 사용자, 일일백업/7일보관·변경후 최신journal, 자동데몬 없음; 실제운영확정 필요 |

정책은 새 immutable version/is_preview=false와 settings published/required_version으로 연결한다. 기존 본문 UPDATE/DELETE 대신 새 버전을 등록한다. [정책버전](31-policy-version-renewal.md)과 [운영인계](39-local-operations-handoff.md)를 따른다.

## 설정 계약과 검증 경계

- Google redirect URI는 전용 Supabase Auth callback이다. 최종 Supabase Site URL/허용복귀 URL은 https://reptilelink.netlify.app과 그 /auth/callback을 목표로 한다. 실제 새 서버 검증 후 해당2필드만 적용했고 사후차이0/다른15필드 동일을 확인했다. 와일드카드 복귀 URL은 추가하지 않는다.
- 브라우저에는 VITE_SUPABASE_URL/PUBLISHABLE_KEY·확정 VITE_SUPPORT_EMAIL·VITE_LOCAL_AUTH=false만 전달한다. 현재 공개 빌드는 실제 provider 검증 후 Google=true이며 fixture=false다. 기존 로컬 환경 파일은 보존한다.
- 서버 SUPABASE_SECRET_KEY/새 ANALYTICS_HMAC_KEY는 사용자의 목적지 명시 승인 후 Netlify production secret으로 저장하고 공개31파일에 실제값 부재를 확인했다. 앞선 자동검토 거절 명령은 미실행이었고 후속 승인으로 해소됐다. Free의 env_var_secrets=true/env_var_scopes=false를 확인했으며 유료 전환은 없다. URL/publishable key/APP_ORIGIN은 실제 운영 대상과 맞추고 로컬 키/환경 파일을 통째로 복사하지 않는다.
- migration은 승인한 최신main의 이력을 비교해 미적용 항목만 적용한다. 전체 schema.sql/로컬auth/테스트사진/preview본문을 운영에 복제하지 않는다. 신규 대상은 외부접근 전 RLS/Hook/쓰기·가입제한을 확인한다.
- 검증은 초대없음/대기/승인·소유자/타인/익명, OAuth 오류/복귀/재동의·주요관리흐름·공개HTML/404/서명사진·캐시/탈퇴실물정리를 포함한다. 소규모 CPU/egress 측정과 실제 무료 계정 확인을 분리한다.
- 원격 백업은 별도이슈/도구로 대상ref·암호화/별도키·정책/탈퇴journal을 검증한다. 기존 local:backup/doctor의loopback차단을 풀거나 로컬격리검사를 원격복구로 보고하지 않는다. Free복구슬롯이 없으면 해당검증은 미완료다.

## Windows 진입 폴더 정리

Windows/OneDrive는 최신 안내와 실행기만 유지하고 `.git`은 보존한다. 중복 docs/초기 `.bootstrap`/일회성 scripts/구형 첫작업 안내는 검토 후 제거한다. 구형 캡처4개는 초기 구현의 역사적 증거로 WSL의 ignored artifacts에 해시 대조 후 보존한다. 승인된 현재 디자인으로 사용하지 않는다.

파일별 원래 해시·크기·삭제/보존판단과 semantic diff는 WSL `.local/windows-cleanup-66`의 비공개 기록이다. 삭제 때 실제 절대경로·reparse/link와 최신해시를 검사하고 정해진 목록 밖은 건드리지 않는다. 원본97PNG/실제DB/Storage/백업·키는 삭제 대상이 아니다.

실제 2026-10-30 운영 준비 관측값과 초기검사 실패/후속71·70의 수정·전체통과/병합 결과는 [docs42](42-production-readiness.md)를 따른다. 운영 백업/원격 복구의 실제 결과와 한계는 [이슈69](https://github.com/KimEunYeol/reptilelink/issues/69) 및 [최종 인계](48-live-operations-handoff.md)를 따른다.
