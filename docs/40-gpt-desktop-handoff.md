# GPT 데스크톱 작업 재개·개발현황 인계

작성일: 2026-10-30 KST. 기능 개발 기준 main은 `dd373860e07b31aa453bc7b5e608a1444bb022ce`([PR #63](https://github.com/KimEunYeol/reptilelink/pull/63) 병합)다. 이후 문서 변경의 main SHA는 달라질 수 있으므로 재개할 때 현재 원격 main을 확인한다. 이 문서는 새 GPT 데스크톱 대화에 프로젝트를 인계하기 위한 시작점이며, 기존 구현을 다시 개발하는 요청이 아니다.

- 저장소: [KimEunYeol/reptilelink](https://github.com/KimEunYeol/reptilelink) — 비공개, 승인된 GitHub 연결로 접근한다.
- 실제 개발 위치: WSL `/home/eykim/projects/reptilelink`. Windows/OneDrive의 초기 복사본을 개발 기준으로 삼지 않는다.
- 후속 실행 이슈: [#62 실제 무료 운영·OAuth·콘솔·운영자료/권리·출시 검증](https://github.com/KimEunYeol/reptilelink/issues/62).
- 이번 인계 문서 이슈: [#64](https://github.com/KimEunYeol/reptilelink/issues/64). 문서 작성은 외부 설정·배포를 실행한 것으로 기록하지 않는다.

## 현재 승인된 실행 계획

최신 사용자 지시는 **Netlify Free 단독 앱 호스팅 + 기존 Supabase DB/Auth/Storage**다. 770.kr은 문서 참고만 허용하며 서비스 도메인/DNS에 사용하지 않는다. 무료 제공 주소에는 reptilelink를 포함하고 dev는 넣지 않는다. 홈페이지 문의는770_official@naver.com, Google 내부 설정은 사용자 본인 계정을 사용한다. 카드·유료/체험·자동 충전·클라우드 빌드·Actions·병렬 에이전트는 사용하지 않는다.

실행 순서와 남은 자료는 [docs41](41-desktop-execution-checklist.md), 최신 단독 호스팅 계약·실제 검사/실패·Free 제약은 [docs46](46-netlify-single-host.md), 실제 배포·회원/복구 완료 여부는 [이슈62](https://github.com/KimEunYeol/reptilelink/issues/62)를 확인한다. 아래 과거 관측과 기능 마감 이력은 당시 증거로 보존하며 현재 최종 운영 완료로 해석하지 않는다.

## 1. 개발현황

| 영역 | 완료한 CODEX 범위 | 데스크톱에서 남은 확인 |
|---|---|---|
| 제품 기능 | 프로필/공개주소·개체 등록/편집/삭제·사진/부모사진·입양일·목록 적용/순서·성장기록/비공개 메모·링크/SNS·일정 | 실제 운영 계정과 배포 URL에서 최종 흐름 확인 |
| 방문자·계정 | 댓글/신고·좋아요·알림/읽음·조회수·승인/초대·필수 동의/재동의·계정 탈퇴/실물 정리/실패 재시도 | 실제 Google OAuth/초대 Hook·운영 문서/승인·공급업체 세션/탈퇴 확인 |
| 디자인 | `design/` 원본97PNG·전체 보드 설명을 기준으로 메인/인증/관리/공개/Worker 정비 및 반응형·키보드 검사 | 원본 PC/m와 실제 실행 화면 최종 대조·정확한 폰트/자산 배포 권리 확인 |
| 로컬 인프라 | React/TypeScript/Vite/Tailwind, 로컬 Worker, Supabase Auth/DB/Storage, RLS/트랜잭션 RPC·용량/남용 제한·단일 Cron 구성 | 운영 Supabase/Cloudflare 계정·프로젝트·실제 무료 한도·CPU/전송량·배포/도메인 |
| 운영·복구 | 24h 명령/영수증 보관·암호화 DB/실제 Storage 백업·최신 journal·격리 복구·읽기전용 doctor·장애 대응 문서 | 운영 백업 소유자/주기·키 보관·운영 Auth/Storage/API 재연결과 원격 복구 검증 |

사용자가 승인한 부·모 개체/입양일 확장도 #49/PR54에서 완료했다. 기능별 이슈/PR·검증 기록은 [개발현황](05-implementation-status.md)에 있다. 기능 마감 시 task31개가 verified였으며 #52/PR61·#53/PR63은 종료/병합됐다. 이번 문서 작업64는 별도 문서 변경이다.

최종 기능 검증은 **build +1,421개**(하네스/암호/진단19·단위77·DB/Worker/복구/진단1,070·미디어34·브라우저221)다. 검증 source는 `ba89e3282eada1c2b987d54c2424461aa2b529b9`, tree는 `1369c97750424e123fa9566bc127f65116fd1abe`, 완료시각은 **2026-10-30 12:59:04 KST**다. 해당 HEAD의 코드 재리뷰 완료/지적0·기존 지적 해결 후 main으로 명시적 squash 병합했다. 문서 전용 변경의 검사와 이 기능 전체 검사 기록을 구분한다.

기능 마감 뒤 main에서 새 암호화 백업/별도 키/최신 journal을 생성하고, 네트워크/포트/Cron이 차단된 임시 DB에서 **32테이블·실제 파일28개·28개 WebP 디코드·권한**을 확인했다. 기존5계정·qa-owner개체20개를 보존했고 새 QA 계정/계정·개체 삭제 작업/임시 복구 컨테이너는0건이었다. 이것은 운영 OAuth·배포·원격 재해복구 완료의 증거가 아니다.

## 2. 가장 먼저 확인할 접근 범위

데스크톱에서 새 대화를 열었다는 이유만으로 이전 대화·WSL 폴더·로컬 서버·로그인된 콘솔을 읽을 수 있다고 가정하지 않는다. ChatGPT의 로컬 파일/앱/브라우저 접근은 실제 제공 도구와 계정/기기/워크스페이스 권한에 따라 달라진다. 현재 세션에서 아래 접근을 각각 읽기전용으로 확인한다. [공식 OpenAI 문서: 로컬 접근과 권한](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-local-security).

| 접근 대상 | 확인할 내용 | 접근이 없을 때 |
|---|---|---|
| GitHub | 이 저장소의 main 문서·이슈62·PR63을 실제로 읽을 수 있는가 | 승인된 연결을 확인하거나 아래 최소 문서를 사용자에게 전달받음. 비공개 저장소를 공개로 바꾸지 않음 |
| WSL 파일/실행 도구 | 실제 `/home/eykim/projects/reptilelink`의 위치·branch·변경 상태를 읽을 수 있는가 | 사용자가 WSL에서 실행/확인한 결과를 전달하거나 CODEX에서 필요한 변경을 수행 |
| 로컬 웹 | `http://localhost:5173` 앱과 `http://127.0.0.1:8787/api/health`에 실제 접근 가능한가 | 원래 컴퓨터/서버에서 열어 확인. 별도 실행 환경의 localhost를 같은 서버로 간주하지 않음 |
| 외부 콘솔 | Google/Supabase/Cloudflare의 정확한 계정·조직·프로젝트를 확인할 수 있는가 | 해당 세션에서 로그인/접근을 사용자가 완료하고 대상 확인. 접근 전 결과를 추정하지 않음 |

접근 불가 시 전달할 최소 자료는 **이 문서, AGENTS.md, docs/05, docs/39, 이슈62 내용**이다. 디자인 비교에는 관련 `design/` 원본 PC/m PNG와 전체 보드 설명, 동일 상태/폭의 실행 캡처도 필요하다. 경로만 적힌 문서는 이미지 자체의 전달을 대신하지 않는다. 키·토큰·`.env.local`·`.dev.vars`·인증 파일·DB/실제사진 백업·로컬 fixture 개인정보를 대화/첨부/Git에 복사하지 않는다. GitHub clone만으로 비공개 로컬 DB/사진/백업/키가 복원되지 않는다.

## 3. 문서 읽는 순서

1. 이 문서와 [AGENTS.md](../AGENTS.md): 현재 범위·비용0원·데이터 보존·GitHub/디자인 규칙.
2. [docs/05 개발현황](05-implementation-status.md)와 [이슈62](https://github.com/KimEunYeol/reptilelink/issues/62): 완료/미수행과 실제 이력. 과거 날짜별 미완료 기록을 현재 상태로 오해하지 않는다.
3. [docs/39 운영·외부 설정 순서](39-local-operations-handoff.md): 실패 원인별 대응·키/정책·실제 설정 연결점.
4. [docs/31 정책 버전](31-policy-version-renewal.md), [docs/38 백업/격리 복구](38-encrypted-backup-restore.md).
5. 변경 대상의 [기능명세](01-functional-spec.md)·[데이터모델](02-data-model.md)·[실행안내](04-local-development.md).
6. 디자인 작업 전 [design/README.md](../design/README.md)·[디자인 계약](08-design-contract.md)·실제 원본 PNG. 새 그림/창/브랜딩을 창작하지 않고 보드 설명과 PC/m를 함께 대조한다.

## 4. 로컬 시작·운영 상태 재확인

기존 WSL 환경을 사용할 때 먼저 읽기전용으로 확인한다.

```bash
cd /home/eykim/projects/reptilelink
git status --short --branch
git rev-parse HEAD
npm run local:doctor
```

이 명령의 결과를 데스크톱에서 직접 읽지 못하면 사용자가 WSL에서 실행한 결과를 기준으로 삼는다. 미커밋 변경이 있으면 보존하고 무조건 pull/switch/reset하지 않는다. 원격 갱신과 차이를 확인한 뒤, 깨끗한 main에서만 `git fetch origin main`·`git merge --ff-only origin/main`으로 갱신한다. 서버가 이미 실행 중이면 중복 기동하지 않는다. 꺼진 경우만 [로컬 실행안내](04-local-development.md)에 따라 local:start/build/dev:all을 수행한다. DB reset·볼륨 삭제·초기 SQL 재실행은 시작 절차가 아니다.

**이번 재확인 시점: 2026-10-30 13:08 KST.** 구성/유효 loopback 포트/프런트·Worker 응답/실제 Storage28개128,184바이트/백업 인증은 통과했다. DB 진단은 기존 영수증18건의 보관 정리 대기로 `DOCTOR_CLEANUP_PENDING`·`attention`이었다. 계정/개체/파일 정리 대기·ready파일 누락은0, 활성 Cron은1개/최근성공이었다. 다음 예정 시각은 당시 13:17 KST였다. **이 수치와 예정 시각은 관측 기록이며, 지금 정리가 완료됐다는 뜻이 아니다.** 재개 시 새 doctor/실행 결과로 갱신한다.

현재 정책은 `preview/local-preview-v1`이고 실제 운영 본문이 아니다. 백업은 최근7일 보관, 진단의 최신 백업 기준24h·복구 journal15분/현재 상태 일치 조건을 가진다. 시간이 지나거나 계정/탈퇴/공개·중지 상태가 바뀌면 doctor가 다시 주의 상태를 낼 수 있다. 원인을 확인하고 docs/38·39의 새 백업/journal 절차를 따르며, 녹색 보고서를 만들려고 전역 cleanup을 실행하거나 lease를 줄이지 않는다. 자동 백업/journal 데몬은 설치하지 않았다.

## 5. 데스크톱 후속 작업과 완료 증거

작업 상세는 이슈62를 기준으로 하나씩 진행한다. 읽기전용 조사와 자료 정리는 바로 진행하고, 외부 변경은 정확한 대상 계정/서비스·무료 상태·변경 예정값·확인 방법을 준비해 해당 세션의 사용자 승인 범위 안에서 수행한다. 이미 구체적으로 승인한 같은 범위를 반복 확인하지 않는다. 계정/권한 제약이나 비용이 확인되면 그 사실을 보고하고 진행 범위를 조정한다.

| 순서 | 수행할 작업 | 기록할 완료 증거 |
|---|---|---|
| 1 | 계정/조직·기존 서비스·실제 Free 상태/용량/전송/CPU·사용 가능한 접근 확인 | 계정·프로젝트 식별 정보, 확인시각/실제 한도/추가비용0원 여부. 키/개인정보는 가림 |
| 2 | 운영 주체·문의 이메일·이용약관/개인정보 본문·폰트/이미지/브랜드 권리 확인 | 사용자 확정 자료/권리 근거, 미제공 항목. 예시 회사/TEAM770을 실제 운영정보로 사용하지 않음 |
| 3 | 원본 디자인과 현재 로컬 화면 최종 비교 | 원본 파일/보드 설명 위치·화면/상태/폭·일치/차이·승인 필요 여부. 원본 밖 창작 없음 |
| 4 | 운영 Supabase의 DB 이력/설정·private bucket·RLS·초대 allowlist/Hook·Google provider 구성 | 대상·적용 버전/설정·소유자/타인/익명·허용/차단 테스트. 로컬 fixture/키/preview 자료를 운영에 복제하지 않음 |
| 5 | Google OAuth 동의/허용 URL·실제 로그인/취소/오류/로그아웃/복귀·재동의 확인 | 실제 URL/환경·동작 결과. Google의 callback은 **Supabase Auth callback**, 앱 `/auth/callback`은 **Supabase 허용 복귀 URL**로 구분 |
| 6 | Cloudflare Worker+dist assets·실제 환경변수/secret·무료 주소/선택 domain 연결·배포 | 배포 commit/version/URL·서버용 비밀과 공개 VITE 구분·정적/Worker 라우팅·fixture 로그인 비활성 확인 |
| 7 | 실제 URL에서 기능·공개 HTML/공유메타·사진/권한·탈퇴 실물정리·성능/egress·복구 확인 | 실제 운영 점검 결과/소규모 실측·남은 차이·rollback/복구·백업 담당자/주기·출시 판단 |

서버 전용 값은 SUPABASE_SECRET_KEY/ANALYTICS_HMAC_KEY, 공개/환경 값은 SUPABASE_URL/PUBLISHABLE_KEY/APP_ORIGIN 등이다. production 브라우저에는 공개 VITE 값만 넣고 Google 표시를 활성화하며 로컬 fixture flag는 끈다. `.dev.vars`를 그대로 원격 secret으로 복제하지 않는다. 운영본 공개 연락처는 `VITE_SUPPORT_EMAIL`, 운영 약관/개인정보는 새 immutable policy version/published 설정으로 연결한다. 실제 설정값·발급/게시·세부 절차는 docs/31·39와 현재 공식 안내/콘솔을 대조한다.

## 6. 코드 수정이 필요하면 CODEX로 돌려보내기

데스크톱에서 발견한 차이는 재현 경로·원본 근거/기대 결과·실제 결과·상태/폭·확인 환경을 적어 기능별 새 이슈로 나눈다. 코드/DB 수정은 기존 WSL 저장소에서 **최신 main의 새 codex 브랜치 → task/명세·모델 → 구현 → 원본 비교/실제 검사 → PR 리뷰·보완 → 승인된 명시병합 → clean main** 순서로 진행한다. 이슈62는 실제 외부 검증이 끝날 때까지 열어 둔다.

문서만 바꾸면 docs-only 검증, 앱/DB/Worker/하네스/도구를 바꾸면 전체 `npm run verify`가 필요하다. 로컬 훅은 우회 가능한 보조 수단이고 현재 비공개 Free 저장소의 서버 branch protection을 활성화했다고 주장하지 않는다. main 직접 push·force push·자기 승인·auto-merge·Actions·유료 API/클라우드 빌드·병렬 에이전트는 기존 계약에 따라 사용하지 않는다.

## 7. 새 GPT 데스크톱 대화에 붙여 넣을 시작 지시문

```text
reptilelink 프로젝트의 데스크톱 후속 작업을 이어서 진행해.
먼저 GitHub KimEunYeol/reptilelink의 main에서 docs/40-gpt-desktop-handoff.md,
AGENTS.md, docs/05-implementation-status.md, docs/39-local-operations-handoff.md와
열린 이슈 #62를 실제로 읽어. 읽지 못한 자료/접근은 확인되지 않았다고 표시해.

CODEX 기능 개발은 PR63/main dd37386을 기준으로 완료했고 최종 기능검사1421개가 통과했어.
현재 main은 문서 병합으로 달라질 수 있으니 실제 원격 상태를 다시 확인해.
개체/사진/부모·입양일/성장/링크/SNS/일정/댓글/좋아요/알림/통계/탈퇴/복구를 재구현하지 마.
로컬 WSL 위치는 /home/eykim/projects/reptilelink이고,
새 세션이 이 폴더/localhost/기존 로그인에 접근 가능하다고 가정하지 마.

처음에는 접근 가능한 저장소·로컬 화면·콘솔의 정확한 계정/조직·실제 무료 상태를
읽기전용으로 확인하고 개발완료/외부미수행/자료필요 항목을 정리해.
이후 운영자료·권리/폰트와 design/ 원본 설명·PC/m 대조,
Supabase/Google OAuth/Cloudflare/원격secret·배포/도메인·실제 URL 검증을
이슈62 순서대로 진행해. 외부 변경 전에는 대상/변경값/결과확인 방법을 준비해
사용자가 구체적으로 승인한 범위 안에서 수행하고 이미 승인한 범위는 반복 질문하지 마.

추가지출은0원이야. 결제/시험판/유료API/Actions/유료빌드/병렬에이전트를 켜지 마.
키·토큰·인증파일·백업·fixture 개인정보를 채팅/Git/브라우저번들에 복사하지 마.
운영정책은 현재preview이므로 사용자 확정본문/연락처/권리자료 없이 창작·게시하지 마.
디자인의 유일한 시각 기준은 reptilelink/design 원본이야. 새 시각방향/그림을 창작하지 마.
기존DB/파일/볼륨을 보존하고 reset·초기SQL재실행·전역cleanup으로 상태를 맞추지 마.

각 단계마다 실제 수행/미수행·확인시각·가린 증거·남은 차이를 이슈62에 기록하고 중간보고해.
코드 수정이 필요하면 재현/원본근거를 정리해 CODEX의 새 이슈·main브랜치·검증·PR로 돌려보내.
마지막에는 실제 배포 URL/버전·OAuth/권한/사진/탈퇴·무료한도/CPU·복구 결과와
출시 판단에 필요한 남은 항목을 보고해. 로컬 검사를 운영 검증으로 대체하지 마.
```

## 8. 작업 결과 기록 양식

이슈62의 해당 항목에 다음 형식을 반복해서 남긴다. 실제 확인한 항목만 체크하고, 비밀값/개인정보가 보이는 캡처는 첨부하지 않는다.

```text
확인시각(KST):
작업 단계 / 환경(local·preview·production):
대상 계정·조직·프로젝트 / commit·배포 version:
목적과 변경 전 상태:
실제 수행한 변경 / 수행하지 않은 항목과 이유:
확인 경로·역할(소유자·타인·익명)·화면폭·기대/실제 결과:
증거 링크(비밀값/개인정보 가림):
무료 한도·CPU/전송량·추가지출 확인:
남은 차이·코드 수정 이슈·다음 작업:
rollback/복구 기준:
```

실제 운영 자료/외부 설정·배포·원격 검증이 끝나야 이슈62와 출시 판단을 마감한다. 이 인계 문서의 작성/병합은 해당 항목을 완료 처리하는 근거가 아니다.
