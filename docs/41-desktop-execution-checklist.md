# 운영 실행 체크리스트와 자료 입력 (#66 / 외부 #62)

2026-10-30 KST 사용자 승인 계획의 실행 기준이다. 실제 개발은 WSL `/home/eykim/projects/reptilelink`에서만 수행한다. [데스크톱 인계](40-gpt-desktop-handoff.md)의 과거 관측값과 현재 결과를 구분한다. 코드·DB·운영 도구 변경은 독립 이슈/최신 main 브랜치/전체검사/리뷰/PR로 진행하고, 문서만 바꾸면 docs-only 검사를 사용한다.

## 현재 확정값과 자료 대기

- 추가 지출0원·단일 에이전트·기존 데이터/키/타 서비스 보존. 결제/체험/유료API/Actions/클라우드 빌드 금지.
- 기존 gain-music-club은 보존했다. 전용 Supabase Free 서울 suuemuqwjwbddbjevvmg를 생성하고 원래37 migration·RLS/private bucket/Hook·단일 Cron을 구성했다. 운영 가입·쓰기·통계는 중지다.
- 앱 호스팅은 Netlify Free 하나를 선택했다. 실제 Free/300 credits 사용0·초과누적 불가·카드 없음과 CLI 인증을 확인하고 https://reptilelink.netlify.app 이름을 확보했다. 앱 업로드는 서버 비밀값 전달 승인 대기다. Cloudflare 임시 호스트는 Netlify 교체 검증 후 운영 경로에서 제외한다. 770은 문서 참고만 허용하며 도메인/DNS와 무관하다. 도메인 구매는 하지 않는다.
- 홈페이지 문의 770_official@naver.com, 사용자 본인 Google 계정의 내부 사용, 770 약관 참고와 CC0 웹 검증사진 사용은 지정됐다. 미게시 정책 후보를 준비했고 실제 운영주체/개인정보 담당자명과 최종 확인·실제 Google 로그인 검증은 대기다. 770의 회사 신원이나 preview 본문을 운영자료로 복제하지 않는다.
- 실제 외부 설정/배포는 사용자 승인 범위에 포함된다. 자료/접근이 필요한 해당 단계만 대기하며, 계획 승인이나 문서 작성으로 완료 처리하지 않는다.

## 실행 순서와 완료 증거

| 단계 | 수행/완료 증거 | 현재 상태 |
|---|---|---|
| 1 안내/Windows 정리 | 현행 README/시작안내/구형계약의 역사표시, 비공개 파일해시·고유증거 보존·Windows README/실행기/.git만 잔존 | 실제 파일검사 통과: README/실행기/.git 잔존, 캡처4개 해시보존; PR67 병합/최종 3항목·해시 재확인 |
| 2 로컬 보존/진단 | 실제 Git/doctor·Cron/정리대기 원인·새 암호화 백업/최신journal/격리check 결과 | 새 로컬 암호화 백업/최신journal·32테이블/28파일128184B·28decode·networknone/Cronoff 복구/백업인증 통과; 현재 영수증714건 대기로 attention, 상세 docs46 |
| 3 원본 비교/권리 | 보드설명·원본 PC/m·같은 상태/폭의 실행캡처·차이 이슈·자산별 권리 | 9화면7폭 구조검사/대표원본 비교; 차이 #70/PR74 수정·7폭/전체검사 통과; 권리/전체상태 미확인 |
| 4 무료 자원/DB | 계정/조직·Free/슬롯/비용·project ref·migration 이력·RLS/private bucket/예산/단일Cron·Hook·가입차단 | Free 전용project/37 migration·32 RLS테이블·private bucket/단일Cron·Hook 구성 확인; 상세 docs42 |
| 5 정책/OAuth | 확정 새 불변정책/published·실제초대/승인·Google callback/앱복귀 분리·성공/취소/오류/로그아웃/재동의 | 후보/문의 지정 완료; Google client 생성 직전 확인·운영주체명/정책 확정·실제 OAuth 검증 대기 |
| 6 운영 빌드/배포 | 검증main SHA·production 빌드·원격secret/공개VITE 분리·fixture비활성·배포version/URL | Netlify 연결 PR82/full1472 통과·이름 확보·공개값 production31파일 빌드 통과; 서버키 전달 승인/앱 업로드 대기 |
| 7 운영 기능/성능 | 소유자/타인/익명·사진·공개HTML/메타/404·탈퇴Auth/Storage 실물정리·CPU/전송량실측 | 임시 Pages 익명7폭/경계·CPU5표본은 당시 docs45; 최종 Netlify 실제 URL·회원 검증 미완료 |
| 8 원격 백업/복구 | 전용 도구·대상ref확인·암호화DB/실파일·별도키·최신journal·격리Free복구의Auth/Storage/API/권한 | 독립 #69 생성, 도구미구현·원격미검증 |
| 9 출시판단 | 모든 증거·남은차이·rollback/운영책임/주기·사용자 결정 | 대기; 이슈62 유지 |

실제 결과는 [이슈62](https://github.com/KimEunYeol/reptilelink/issues/62)에 KST 시각·환경·대상/commit/version·수행/미수행·가린 증거·비용·다음 작업을 기록한다. 이 표는 실행 체크리스트이며 실시간 상태보드가 아니다. 링크된 이슈의 최신 결과를 우선한다.

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

- Google redirect URI는 전용 Supabase Auth callback이다. 최종 Supabase Site URL/허용복귀 URL은 https://reptilelink.netlify.app과 그 /auth/callback을 목표로 한다. 현재 이전 workers.dev 설정을 유지하며 실제 새 서버 검증 후 적용한다. 와일드카드 복귀 URL은 추가하지 않는다.
- 브라우저에는 VITE_SUPABASE_URL/PUBLISHABLE_KEY·확정 VITE_SUPPORT_EMAIL·VITE_LOCAL_AUTH=false만 전달한다. Google flag는 실제 provider 준비 후에만 true로 하며 현재 공개 빌드는 false다. 기존 로컬 환경 파일은 보존한다.
- 서버 SUPABASE_SECRET_KEY/새 ANALYTICS_HMAC_KEY의 Netlify production secret 전달은 자동 승인 검토의 민감정보 목적지 승인 거절로 아직 실행되지 않았다. 사용자 명시 승인을 받은 뒤 진행한다. Free의 env_var_secrets=true/env_var_scopes=false를 확인했으며 유료 전환은 없다. URL/publishable key/APP_ORIGIN은 실제 운영 대상과 맞추고 로컬 키/환경 파일을 통째로 복사하지 않는다.
- migration은 승인한 최신main의 이력을 비교해 미적용 항목만 적용한다. 전체 schema.sql/로컬auth/테스트사진/preview본문을 운영에 복제하지 않는다. 신규 대상은 외부접근 전 RLS/Hook/쓰기·가입제한을 확인한다.
- 검증은 초대없음/대기/승인·소유자/타인/익명, OAuth 오류/복귀/재동의·주요관리흐름·공개HTML/404/서명사진·캐시/탈퇴실물정리를 포함한다. 소규모 CPU/egress 측정과 실제 무료 계정 확인을 분리한다.
- 원격 백업은 별도이슈/도구로 대상ref·암호화/별도키·정책/탈퇴journal을 검증한다. 기존 local:backup/doctor의loopback차단을 풀거나 로컬격리검사를 원격복구로 보고하지 않는다. Free복구슬롯이 없으면 해당검증은 미완료다.

## Windows 진입 폴더 정리

Windows/OneDrive는 최신 안내와 실행기만 유지하고 `.git`은 보존한다. 중복 docs/초기 `.bootstrap`/일회성 scripts/구형 첫작업 안내는 검토 후 제거한다. 구형 캡처4개는 초기 구현의 역사적 증거로 WSL의 ignored artifacts에 해시 대조 후 보존한다. 승인된 현재 디자인으로 사용하지 않는다.

파일별 원래 해시·크기·삭제/보존판단과 semantic diff는 WSL `.local/windows-cleanup-66`의 비공개 기록이다. 삭제 때 실제 절대경로·reparse/link와 최신해시를 검사하고 정해진 목록 밖은 건드리지 않는다. 원본97PNG/실제DB/Storage/백업·키는 삭제 대상이 아니다.

실제 2026-10-30 운영 준비 관측값과 초기검사 실패/후속71·70의 수정·전체통과/병합 결과는 [docs42](42-production-readiness.md)를 따른다. 운영 백업/원격 복구는 독립 [이슈69](https://github.com/KimEunYeol/reptilelink/issues/69)로 미완료 상태다.
