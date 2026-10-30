# 로컬 운영 진단과 데스크톱 인계 (#53)

최신 실행 상태는 [Netlify 단독 호스팅](46-netlify-single-host.md)과 [이슈62](https://github.com/KimEunYeol/reptilelink/issues/62)를 따른다. 아래 과거 시각의 관측/명령은 당시 기록이며 현재 대상에 그대로 재실행하지 않는다. 앱은 https://reptilelink.netlify.app에 Netlify Free 단독으로 공개 배포했고 Supabase는 유지한다. Google/정책·실제 회원/원격복구는 남아 있다. 최신 로컬 Cron/서비스 복구·암호화 journal/28실파일 복구는 docs46의 #85를 따른다.
새 GPT 데스크톱 대화의 첫 문서는 [재개·개발현황 인계](40-gpt-desktop-handoff.md)다. 이 문서는 상세 운영 참고서이며, #53/PR63은 최종1421개·정확ba89e32 재리뷰/보완 뒤 maindd37386으로 병합·종료됐다. 아래 착수/실패/재검증 서술은 당시 기록이다.

#52/PR61은 build1402개·정확2d96f6f 코드리뷰completed/지적0·명시적 squash 병합·이슈종료·clean main c1e04b8/검증트리22e30bf 일치로 완료했다. 같은 main에서 독립53을 시작했다. 추가지출0원·단일에이전트·기존5계정/파일/볼륨 보존, 제품 UI/design 원본97PNG 변경 없음이다.

## 로컬에서 실행

```bash
cd /home/eykim/projects/reptilelink
npm run local:start
npm run dev:all
# 별도 터미널
npm run local:doctor
```

이미 실행 중이면 start/dev:all을 중복 실행하지 않는다. doctor는 읽기전용이다. 서비스 시작/중지, SQL UPDATE/cleanup, 자동백업, 원격 API/콘솔 연결을 대신 실행하지 않는다. `passed`/종료0은 현재 로컬 점검의 통과이며 `attention`/종료1은 실패·미확인·대기·운영중지 중 하나다. 오류 항목은 이름과 고정 코드로만 내보내며 SQL/키/사용자 이름·이메일·UUID/사진 경로·본문은 출력하지 않는다.

| 점검 | 실제 검사와 통과 기준 |
|---|---|
| config | `.env.local`/`.dev.vars` 단일 일반파일·동일UID·0600, loopback URL·일치한 실제 로컬 publishable/secret, VITE 비밀명/알려진 비밀값·secret키/서비스JWT 거절. fixture 로그인은 DEV+loopback에만 허용 |
| publishedPorts | 프로젝트 Supabase 컨테이너의 **유효 NetworkSettings.Ports**가127.0.0.1/::1. 빈 HostConfig.HostIp를 외부 노출로 오판하지 않음 |
| frontend/worker | redirect를 따라가지 않는 실제 loopback HTTP, 프런트 HTML/Worker health. 원격 URL/userinfo/query/fragment·HTTPS 우회 입력 거절 |
| database | 실제 앱 테이블 총크기/프로필수·DB 이력과 checkout migration 일치·Storage 사용량과 예산 카운터 일치·영수증/계정/통계 한도·쓰기/가입/통계 상태·현재 정책 준비/모드 |
| Cron/보관/작업 | 활성1개·17분 스케줄·activity/analytics/receipt/withdrawal·4COMMIT 구성, 최근 성공70분 이내·최근실패없음·실행중2분 초과거절. media/delete/withdrawal·영수증·활동/통계 정리대기 집계. 대기/한도도달/중지 상태는 attention |
| storage | 현재 객체의 실제 다운로드 바이트/크기·ready 등록 SHA 확인. 각512KiB·전체256MiB·4096파일 제한, ready 누락/변경 거절. SQL 목록만으로 물리 파일 정상 판정하지 않음 |
| backups | 별도 비공개 키/경로·archive/journal 인증·migration/파일 SHA·7일 보관·24h 이내 최신 백업/15분 journal·epoch·현재 계정/탈퇴/공개/중지 상태 일치. 변조/불완전 `.partial-*`/미검증/기한초과 파일은 자동삭제 대신 attention |

설정 키의 공개/서버용 분류는 진단이며 Google 인증 성공이나 JWT 서명 감사를 대체하지 않는다. 로컬 앱 DB 크기는 관리형 Auth/Storage/provider DB 전체 용량이 아니다. 실제 무료 계정/원격 전송량·CPU는 별도 데스크톱 실측이다. [Docker bridge 기본 게시주소](https://docs.docker.com/engine/network/drivers/bridge/#default-host-binding-address)와 실제 프로젝트 네트워크의127.0.0.1 기본값을 대조했다.

## 실패 원인별 대응

| 진단/현상 | 확인과 재시도 순서 |
|---|---|
| HTTP/DB/컨테이너 미실행 | 현재 프로세스·이 프로젝트 컨테이너를 확인한 뒤 local:start/dev:all. 코드/DB손상으로 단정해 reset/전체 Docker prune 하지 않음 |
| EXPOSED_PORT/비로컬 URL | 서비스를 외부에 사용하지 않고 local-start의 전용 network/유효 포트를 확인. 다른 네트워크를 임의 제거하지 않음. 확인된 이 프로젝트 서비스만 보존 재시작 |
| CONFIG_NOT_PRIVATE/KEY_MISMATCH/BROWSER_SECRET | 값을 출력하지 않고 파일 소유/0600·실제 로컬 키를 확인. local:env는 기존 추가설정을 보존함. 수정 후 Vite/Worker 재시작, build/doctor로 재확인. 브라우저 번들 노출은 실제 키 교체/영향 확인 필요 |
| CRON_ATTENTION | 해당 job의 상태/시간/구성을 제한적으로 확인. 같은 이름 Cron을 중복 추가하지 않음. 최근실패나 오래된 성공은 원인을 해결한 뒤 정상 실행 성공으로 확인 |
| CLEANUP_PENDING/ready파일 누락 | 소유자의 화면 재확인/계정의 정리 다시 시도. 운영 lease를 줄이거나 실제 파일이 남았는데 카운터만 줄이지 않음. `local:cleanup -- --account UUID`는 선택 계정 작업, 인자 없는 local:cleanup은 모든 만료/삭제 작업을 바꾸므로 상태검사용으로 실행하지 않음 |
| BUDGET_ATTENTION/SERVICE_PAUSED | 실제 한도/카운터·쓰기/가입/통계 플래그를 확인하고 원래 운영 중지를 존중. 비용/카드/유료기능을 켜서 우회하지 않음. 큰 파일/기존 사용자를 임의 삭제하지 않음 |
| JOURNAL_CURRENT_STATE_CHANGED/STALE | 계정/탈퇴/공개/중지 변경 뒤 `npm run local:backup -- journal`. 최신 DB를 읽을 수 없으면 새 사실을 추정하지 않고 중단 |
| BACKUP_STALE/RETENTION_OVERDUE/INCOMPLETE/UNVERIFIED | `local:backup -- create`, 인증된 자체 파일만 `local:backup -- prune`. 변조/키불일치/불완전 파일은 이름을 보고 삭제하지 말고 본인 생성/실패 증거를 확인. 새 백업을 inspect/check한 뒤 doctor |
| migration 불일치/복구 SQL 실패 | 현재 branch/main·정확한 백업 시점의 checkout/해시와 새 migration 이력을 확인. 이미 적용한 SQL 수정·초기SQL 재실행·실DB reset 금지. 복구는 docs/38의 격리 check로 재현 |

현재 source 중지 플래그 변경은 읽기전용 진단에 포함하지 않는다. 운영자가 장애 억제를 결정한 경우 통계 중지와 프로젝트 쓰기/가입 중지를 **각각 짧은 별도 트랜잭션**으로 적용한다. 아래는 명시적 운영 변경의 입력 지점이며 이 작업에서는 실행하지 않았다.

```sql
UPDATE private.analytics_settings SET enabled=false WHERE id=1;
```

```sql
UPDATE private.project_budget SET writes_enabled=false,admission_open=false WHERE id=1;
```

변경 전 값을 별도 비공개 기록에 남기고 재개는 실제 용량/무료한도·정리·동의·인증/파일 상태와 원래 값을 확인한 뒤 결정한다. 중지 중 읽기/축소·탈퇴 예외는 기존 명세를 따른다. 전역 데이터를 자동 숨김/삭제하지 않는다. 코드 롤백은 알려진 검증 커밋에서 새 issue/최신main 브랜치→검증→PR로 되돌리며 source revert가 DB/파일을 되돌리지 않는다는 점을 확인한다. DB는 새 보완 migration으로 해결하고 격리 복구를 실제 서비스에 덮어쓰는 명령은 제공하지 않는다.

## 백업 키·정책 버전

기본 백업/키는 docs/38의 별도0700 경로에 있다. 키는0600 바이너리 파일로만 보관하고 터미널/클립보드/이슈/번들로 출력하지 않는다. 기존 키를 덮어쓰거나 삭제하면 과거 archive를 읽을 수 없으므로 교체 시 새 비공개 보관·키 경로를 선택해 `createBackup({root,keyRoot})`로 새 기준을 만들고 같은 옵션의 `restoreCheck`/`doctor`로 검증한 뒤 운영 경로 전환을 결정한다. 이 API는 #52/53의 임시 별도경로 검사에서 실제 검증했다. 기존 묶음은 원래 키와 분리해 접근을 제한하고 해당 store/key의 `pruneOwned`로 인증된7일 경계만 정리한다. 현재 CLI는 기본 경로만 사용하므로 임의 경로를 기본으로 가장하지 않는다. 키 노출/공급업체 secret 교체는 새 키/새 백업 검증·영향범위 확인과 데스크톱 secret 재설정까지 필요하다.

정책은 현재 `preview/local-preview-v1`이며 운영본문이 아니다. 사용자 확정 이용약관/개인정보 본문과 연락처를 받으면 docs/31에 따라 새 immutable version/is_preview=false를 등록하고 settings의 published/required_version을 바꾼다. 같은 버전의 내용을 UPDATE/DELETE하지 않는다. 현재 동의 지문/양 필수확인·기존회원 /onboarding 재동의를 검사하며 편집 초안을 유지한다. 과거 버전으로의 되돌림도 정책 담당자의 결정과 실제 본문/동의 영향 검토가 필요하며 코드 배포의 자동 부수효과로 바꾸지 않는다.

## 데스크톱에서 수행할 순서

아래는 **미수행** 목록이다. 외부 콘솔/실제 사용자 자료가 필요한 항목만 [데스크톱 이슈 #62](https://github.com/KimEunYeol/reptilelink/issues/62)에 남기며 실제 증거를 채운다.

1. 계정/비용: 실제 Google/Supabase/Cloudflare 계정과 조직·Free 상태·기존 자원/전송량/Workers CPU·카드/자동과금/시험판 미사용을 확인한다. 현재 계정 한도로 불가능하면 생성을 멈추고 설계를 조정한다. 로컬 사용량을 원격 무료 상태 증거로 쓰지 않는다.
2. 자료/권리: 실제 운영 주체·문의 이메일·이용약관/개인정보 본문·수집/보관/삭제 방침·원본 폰트/이미지/브랜드 배포 권리를 확인한다. 원본 예시 회사/이메일/TEAM770을 운영자료로 복사하지 않는다. VITE_SUPPORT_EMAIL은 확정 공개 연락처이며 사용자 메일앱 초안의 실제 전송/수신을 확인한다.
3. Supabase: 빈 운영DB의 승인된 migration/초기 설정·private bucket·RLS/역할·초대 allowlist/Hook·Google provider를 구성하고 실제 확인한다. 로컬 auth 사용자·fixture 비밀번호·preview 문서·API/HMAC 키·테스트사진/이메일을 운영에 복제하지 않는다. 이미 이력이 있는 운영DB에 초기 SQL을 재실행하지 않는다.
4. Google OAuth: provider 콘솔의 callback URI는 **운영 Supabase Auth callback**, Supabase의 사이트/허용 복귀 URL은 **실제 앱의 `/auth/callback`**이다. 서로 같은 값으로 가정하지 않는다. 허용 origin/테스트사용자·동의화면·client ID/secret을 실제 콘솔 자료로 확인한다. client secret은 provider 설정에만 보관한다.
5. Cloudflare: 검증한 main을 기준으로 기존 Worker+dist assets/run_worker_first 구성을 무료 자원에 연결한다. 서버 전용 SUPABASE_SECRET_KEY/ANALYTICS_HMAC_KEY는 원격 secret, SUPABASE_URL/PUBLISHABLE_KEY/APP_ORIGIN은 실제 환경과 일치시키고 브라우저 VITE에는 공개 값만 넣는다. production은 VITE_GOOGLE_AUTH=true, 로컬 fixture flag는 끈다. 새 HMAC 키는 안전하게 생성하고 같은 환경에서 안정적으로 유지한다.
6. 실제 URL: 무료 주소/지정 domain·HTTPS·canonical origin·OAuth 복귀/로그아웃·초대 없는 가입거절/가입승인·필수 재동의·소유자/타인/익명·실제사진·공개 HTML/공유메타·숨김404·탈퇴실물정리/재시도·Worker CPU/전송량·캐시/개인정보를 실제 브라우저/계정으로 검증한다. desktop에서 design/ 원본 설명·PC/m와 실행 화면, 폰트/권리/native컨트롤도 최종 대조한다.
7. 출시 결정: 실제 검사·배포 버전·무료 계정 증거·알려진 차이/복구·rollback·운영 백업 소유자/실행주기·최신 탈퇴 journal 절차를 기록하고 사용자가 출시를 결정한다. 원격 Auth/Storage/API 재연결/재해복구는 이 로컬 격리 실험과 별도 검증이다.

공식 연결 지점: [Supabase Google 로그인](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Supabase 사용량](https://supabase.com/docs/guides/platform/manage-your-usage), [Workers 요금/한도](https://developers.cloudflare.com/workers/platform/pricing/), [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/). 실제 계정의 현재 한도·옵션은 콘솔에서 다시 확인한다.

## 실제 마감 증거

read-only doctor는 유효 loopback6컨테이너/게시3포트·Storage28/128184B·ready누락0·Cron1/최근성공·backlog0·preview정책·인증된 기본백업/최신journal을 확인했다. 앱 테이블 총물리 크기 약12.97MB(검사시점)·영수증16800/100000·프로필3/10은 관측값이며 운영 비용/전체 managedDB 용량을 추정 완료한 것은 아니다. #52 main에서 실제 별도 기본 백업/키를 생성했고32테이블·28파일/28실디코드·권한 통과 후 자기 격리 컨테이너가 제거됐다.

하네스 인자 실수로 생성된 빈 branch/task를 발견했다. 원래main/사용자작업을 보존해 올바른53 기록으로 바로잡았고, 이제 정확3인자·양의 안전한 issue 정수·slug 검사를 **fetch/branch 생성 전**에 수행한다. 실제 임시 Git 저장소에서 잘못된 issue/누락/추가/unsafe 정수 인자가 branch/파일을 바꾸지 않는 검사를 기존 통합회귀에 추가했다. 첫 doctor 쿼리의 존재하지 않는 policy 함수 오류는 attention으로 관측 후 실제 immutable policy 테이블 계약으로 수정했다.

암호화 임시 store/실제 로컬 API·새 QA로 진단16개, URL/비밀파일/키분류·Cron/예산/대기 경계 단위3개, 기존 하네스12/백업암호4개가 통과했다. 실제 Storage 접속실패/원격 URL 사전거절·키권한·현재 상태와 journal 불일치·오래됨/epoch/7일보관·변조/부분파일·자체보관정리·실제 탈퇴대기attention→정리후passed를 확인했다. 실제 키/UUID/파일경로/SQL이 report에 없음을 검사한다. 최종 고정 전체verify·정확HEAD리뷰/명시병합/main·이슈/검증트리·최신doctor 증거는 task/PR·로컬보고서로 확인한다.

현재 task 기록31개 중53 이전30개는 verified이며, main의 단계별 병합 이력과 GitHub 열린 이슈를 대조했다. #52 종료 이후 남은 로컬 이슈53은 이 PR에서 마감하고 별도 외부 이슈62는 미수행으로 유지한다. 역사적 문서의 당시 계획을 재착수 근거로 쓰지 않도록 docs/05 상단 표/남은순서·START_HERE/AGENTS도 실제 현재상태로 갱신했다.

PR63의 P2 리뷰에서7일보관 archive를 모두 복호화해 배열에 유지하는 메모리 문제가 지적됐다. 실제 별도 암호 store에 기존28파일/SQL을 포함한24MiB 시험 payload archive7개를 추가한192MiB 힙 프로세스에서 HEAP_LIMIT 종료를 재현했다. core dump는 금지하고 stderr 원문 대신 고정 오류 코드만 기록했다. 이제 각 파일을 하나씩 인증해 숫자 생성시각·파일명·개수만 유지하고 최신 archive만 다시 인증/검증한다. 파싱한 JSON의 짧은 문자열조차 큰 backing string을 붙잡지 않게 반복문 사이에는 복호화된 문자열/SQL/base64를 보존하지 않는다. 같은192MiB/8archive 검사와 기존 진단을 포함한16개가 통과했다. 최초1420개 전체결과를 새 파일 상태의 증거로 쓰지 않고 보완 뒤 고정전체/정확새HEAD 리뷰를 다시 수행한다.

메모리 보완 뒤 전체 재검증에서는 기존 영수증9건이 다음 시간 Cron을 기다리는 시각에 도달해 doctor가 정확히 CLEANUP_PENDING을 반환했고, 테스트의‘기존대기0/항상passed’가정 때문에 실패했다. 원래 데이터/영수증을 prune하거나 경고를 숨기지 않았다. 이제 비DB 점검과 쓰기/가입/통계/정책 준비는 통과를 요구하되 실제 기존 정리대기는 attention으로 보존하고, 새 QA의 account job이 기준+1→원래 기준으로 복귀하는지 확인한다. 같은16개가 통과했으며 최종 전체는 다시 고정해 검증한다. 최종진단에 남는 정상 보관대기는 실제 개수/다음 Cron과 함께 보고한다.

다음 전체 실행은 기존 일정QA의1초 전 영수증 만료 조건에서 REQUEST_EXPIRED 기대가 실패했다. 운영수명/함수는 바꾸지 않고 그QA가 만든 한 영수증만 clock_timestamp 기준5분 전으로 옮기며 실제 my_schedules.server_now보다4분 이상 과거임을 확인한다. 추가 검사 작성 중 psql UPDATE 태그를 날짜로 읽은 오류도 단일SELECT의 양수 epoch 숫자로 수정했다. 일정65개가 통과했고 실패 로그를 보존한 채 마지막 고정전체를 재실행한다.
