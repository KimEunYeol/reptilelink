# 로컬 암호화 백업과 격리 복구 (#52)

기준 main74764c1의 새 이슈 브랜치다. 앱 화면/Worker UI와 design/97개 원본은 변경하지 않는다. 추가 지출0원, 외부 자원/콘솔/운영 배포 없이 기존 개발DB와 파일/볼륨을 보존한다.

## 실행과 보관

`npm run local:backup -- create`는 기본 `/home/eykim/projects/.reptilelink-backups`에 암호화 archive(.rlbk)와 별도 journal(.rljr)을 만든다. 32바이트 키는 다른 `/home/eykim/projects/.reptilelink-backup-keys/backup-v1.key`에만 있다. 디렉터리0700/파일0600·동일UID·심볼릭링크/하드링크 거절·Git/프로젝트 밖을 검사한다. 키와 archive를 같은 곳에 복사하지 않는다. 키를 잃으면 복호화할 수 없으며 기존 archive가 있는데 키가 없으면 새 키를 자동생성하지 않는다. 키/평문SQL/계정정보/실제사진은 Git·로그·웹에 넣지 않는다.

```bash
npm run local:backup -- create
npm run local:backup -- journal
npm run local:backup -- inspect /absolute/path/UUID.rlbk
npm run local:backup -- check /absolute/path/UUID.rlbk /absolute/path/UUID.rljr
npm run local:backup -- prune
```

check는 실행 때 새 journal을 요구한다. journal은15분 이내이고 archive 이후이며 같은 epoch/시작시각이어야 한다. archive는7일 이내와 현재 checkout의 모든 migration 파일 SHA 일치가 필수다. 구버전 복구는 그 백업 당시 검토된 정확한 checkout/도구를 별도 준비해야 한다. SQL을 임의로 편집하거나 migration 검사를 우회하지 않는다.

AES-256-GCM(매번 새96bit nonce/128bit tag, 형식 magic도 AAD)으로 gzip JSON 전체를 인증한다. 인증 tag 완료 뒤에만 압축해제/JSON 해석/복구 컨테이너/SQL 실행을 한다. 해제512MiB·SQL64MiB·실파일256MiB·4096개·각 파일512KiB를 넘으면 실패한다. 완료 journal을 먼저 원자적으로 게시한 뒤 완성 archive를 원자적으로 게시한다. 부분 작업은 완료 archive 이름을 갖지 않는다. 매 create 또는 수동 prune이 인증된 동일 store 소유UUID/파일이름/7일 경계를 확인한 archive/journal만 삭제한다. 검증불가 파일은 보존하고 수를 보고한다. 자동 백업·정리 데몬은 설치하지 않았으므로 CLI를 실행하지 않은 기간의 물리 삭제를 약속하지 않는다. 키는 보관 정리 대상이 아니다.

## DB와 실제 파일의 일관성

readonly repeatable-read 세션의 exported snapshot을 유지해 pre/post schema·앱 데이터·파일 목록/등록 SHA·테이블 수를 수집한다. 권한 역할 dump는 전후 비교한다(pg_dump의 무작위 restrict 토큰만 비교에서 제외). 앱 api/private/public 데이터와 실제 역할/회원권/소유권/ACL/RLS를 보존한다. Auth는 UUID/is_anonymous만 앵커로 복구하며 비밀번호/실제 Auth 이메일/metadata/identity/세션/MFA/OAuth 데이터는 제외한다. Vault 정의는 확장 생성용이고 Vault 데이터는 제외한다. pg_dump --create를 사용하지 않아 원본 DB의 JWT 설정을 내보내지 않는다. 환경키·알려진 실제 로컬 API/JWT 비밀의 평문 혼입도 거절한다.

Storage는 버킷/객체의 최소 projection과 실제 바이트를 묶는다. create-only인 객체를 다운로드해 크기/SHA를 계산하고 등록된 ready SHA/크기를 대조한다. ready 객체가 없어졌거나 변경됐으면 실패한다. 파일 복사 중 삭제는 HTTP 실패/누락 검증으로 거절한다. DB snapshot 이후의 계정 상태는 별도 최신 journal로 재적용한다. 모든 새 수정/새 파일을 무중단 증분 복구하는 시스템은 아니다. 격리 파일명은 `SHA256(bucket+NUL+원본path).bin`이며 원본 path를 파일시스템 경로로 실행/추출하지 않는다.

## 탈퇴·현재 상태와 격리

private.account_withdrawals는 Auth FK 없이 요청/완료시각과 UUID만 남긴다. 수용/완료와 같은 트랜잭션이며 RLS/일반 실행 권한 회수로 보호한다. recovery_settings의 epoch는 최초 도입 기준이다. 완료7일 뒤500/SKIPLOCKED로 정리하며 진행 탈퇴는 보존한다. 기존 단일 시간 Cron의 영수증 루프에 합쳐 drain 종료 조건만 확장했고 별도 상시 작업은 없다. 정상 물리 정리는 다음 시간 실행까지 지연될 수 있다. 새 CLI schema20261030020039와 별도 seed/Cron 데이터20261030020114로 기록했다. CLI가 만든 빈 placeholder만 제거하고 스키마 파일의 중복 EOF 공백만 정리했으며 기존 적용 migration을 의미 변경/재실행하지 않았다. database/schema.sql은 검토 snapshot으로만 추가하며 실행하지 않는다.

journal에는 현재 계정 UUID/상태/공개 여부·내구 탈퇴 UUID/시각·전역 쓰기/가입/통계 중지상태만 넣는다. 현재 Auth에서 사라진 백업 UUID도 탈퇴처럼 제외한다. 복구할 때 기존 탈퇴 함수/파일 예산 정리를 사용해 탈퇴를 다시 적용하며 해당 소유자 파일은 처음부터 물리 복구하지 않는다. 정지/비공개 및 전역 중지 플래그를 최신 journal 값으로 적용한다. 새 journal 이후 미내보낸 변경은 재구성할 수 없다. 최신 journal을 만들 수 없으면 작업을 중단한다.

복구는 이미 캐시된 PG17.11.0.006 이미지의 UUID·소유label 컨테이너뿐이다. network none/포트 없음/읽기전용 root/비루트UID/tmpfs·cap drop/no new privileges·메모리/CPU/PID 제한으로 격리하고 Cron은 SQL 실행 전부터 off다. 원본과 같은 bootstrap superuser(supabase_admin)로 원래 역할/GRANTED BY를 복구하고 전체 역할 속성·회원권을 대조한다. 원본 postgres는 NOSUPERUSER를 유지한다. 새 isolated DB와 해시 이름의 파일만 복구하고 finally에서 검증된 자기 컨테이너만 제거한다. 실패 시 실제 개발 DB를 reset하거나 기존 볼륨/컨테이너를 제거하지 않는다.

앱 테이블 수·실제 소유자/타인/익명 공개 RPC·raw 거절/RLS·역할/ACL과 파일 재읽기 SHA, Chromium의 실제 WebP decode/canvas 픽셀 읽기/크기를 검사한다. 결과는 계속 quarantined다. 전체 Supabase Auth/Storage API 서비스와 공급업체 계정/Google 로그인/실제 웹을 다시 연결하는 절차는 데스크톱의 별도 검증이며 이 check가 운영 재해복구를 완료한 것은 아니다.

## 근거와 실제 검증

[PostgreSQL17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)의 snapshot/역할 별도 원칙과 [Supabase backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)의 역할·schema·데이터 및 별도 Storage 경계를 확인했다. [Node24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html)의 인증 암호 API를 실제 설치된24.19에서 검증한다.

초기 수집의 컬럼명 오류, pg_dump restrict 난수로 인한 역할 비교 오류, bootstrap 역할을 다르게 만든 GRANTED BY 오류, Vault 확장 schema 누락, Auth 생성 열을 포함한 INSERT 오류는 실패로 관측해 수정했다. QA save_design 검사의6개 SNS 계약 오류도 수정했다. 사용자 데이터/볼륨을 초기화해 숨기지 않았다. 기본 복구는 실제28파일/128184B·32테이블·28개 WebP 디코드와 권한 검사에 통과했다. 최종 회귀/전체 고정 verify와 정확한 HEAD 리뷰/명시병합 증거는 task·PR·로컬 검증 보고서에 기록한다. 이후53에서 운영 진단과 데스크톱 인계만 마감한다.

첫 전체검증은220/221 브라우저 통과이며 기존 사진편집 QA afterEach의 물리정리에서 CLEANUP_PENDING 1건이 관측돼 실패 처리했다. 저장/재적용 검사는 통과했고 실패 trace의 자기 신규자산만 정리했다. 1초 전 now() 조정에 의존하던 QA lease를 clock_timestamp()의5분 전으로 명확히 옮겼다. 운영 lease/코드는 바꾸지 않으며 원인을 단정하거나 실패를 성공으로 합산하지 않는다. 표적/고정전체를 재검증한다.
