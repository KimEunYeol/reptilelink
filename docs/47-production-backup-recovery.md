# 운영 전용 암호화 백업과 격리 복구 (#69)

현재 source는 suuemuqwjwbddbjevvmg, 복구 전용 대상은 berprfddzalsotnrxpdb / reptilelink-recovery-verification이다. 기존 gain-music-club과 local:backup/doctor의 loopback 제한은 변경하지 않는다. 이 문서는 새 운영 도구의 계약이며 로컬 성공이나 빈 DB 복구를 실제 Google 회원·사진의 복구 완료로 표시하지 않는다.

## 현재 수행 증거와 남은 검증

아래 항목은 실계정 연결 이전의 초기 구현 관측이다. 이후 실제 로그인·정책 게시 상태는 마지막 최신 기반·실회원 절을 따른다.

- 기존 은열 Free 조직의 실제 생성 견적 월$0과 계정 plan free를 확인했다. 복구 대상의 Auth0/Storage0/앱테이블0을 읽기 전용으로 확인한 뒤 가입/Google을 비활성화했다. 고정 main의 원래37 migration을 별도 ref로 dry-run/순서대로 적용했고 source link를 보존했다. schema.sql/fixture/preview seed를 적용하지 않았다.
- 운영 source에 TLS verify-full과 공식 Supabase CA를 사용해 읽기 전용 repeatable-read exported snapshot을 만들고 schema·앱 데이터·Auth users/identities·메타데이터를 같은 snapshot으로 수집했다. source 사용자/사진0의 백업·최신journal을 별도 키로 인증 암호화·재인증했다.
- 별도 원격 대상에 빈 source의32테이블을 복구하고 RLS/원시권한거절/세션0·가입/쓰기/통계/Cron중지를 확인했다. 아직 실제 Google 회원/실제 원격 사진/브라우저 재연결 증거는 없다.
- 네트워크 없는 자기 격리 컨테이너에서 합성 Auth identity·부모사진 FK 순환·정지/비공개·백업 후 탈퇴·비어 있지 않은 대상 거절을 검사하는4개 회귀가 통과했다. 합성 Google 자료는 원격에 생성하지 않았고 실제 Google 로그인으로 보고하지 않는다.
- 대상/연결·TLS·파일손상/누락·migration·세션데이터 제외·journal/탈퇴·암호형식·보관정리와 CLI restore 경로를 검사하는8개 안전 회귀가 통과했다. 전체 검증은 고정 소스의 실제 report/PR로 확인한다. 문서의 수치나 task 상태로 통과를 대체하지 않는다.
- Google client 생성 직전 확인과 실제 운영자/개인정보 담당자·정책 확정이 대기다. source는 가입/쓰기/통계중지, provider 비활성을 유지한다. #69와 #62는 실제 증거가 확보될 때까지 유지한다.

## WSL 실행

WSL /home/eykim/projects/reptilelink의 정상 Supabase CLI 로그인과 캐시된 PG17.11.0.006 이미지가 필요하다. 비밀번호/CLI access token을 추출하거나 명령행에 넘기지 않는다. 공식 CLI dry-run이 제공하는 임시 DB 연결5변수만 메모리에서 읽고 ref/서울 session pooler/5432/postgres DB를 검사한다. 연결 값은 컨테이너 표준입력으로만 전달하고 Docker Config.Env/OS 명령행/파일/로그에는 넣지 않는다.

    npm run production:backup -- create suuemuqwjwbddbjevvmg
    npm run production:backup -- journal suuemuqwjwbddbjevvmg
    npm run production:backup -- inspect suuemuqwjwbddbjevvmg /absolute/private/UUID.rlbk
    npm run production:backup -- restore suuemuqwjwbddbjevvmg /absolute/private/UUID.rlbk /absolute/private/UUID.rljr berprfddzalsotnrxpdb
    npm run production:backup -- prune suuemuqwjwbddbjevvmg

create는 source 읽기만 한다. restore는 고정한 별도 ref와 실제 CLI 프로젝트의 이름/조직/리전/건강상태를 다시 검사한다. 운영 ref/기존 타서비스/다른 ref를 거절한다. 새 복구 대상은 실행 직전 Free/추가비용0을 별도로 확인하며, 도구가 플랜·카드·유료 기능을 바꾸지 않는다. 대상을 바꿀 때는 새 이슈/검증/PR로 보호 목록과 운영 기록을 갱신한다.

archive/journal은 /home/eykim/projects/.reptilelink-production-backups, 키는 다른 .reptilelink-production-backup-keys의 backup-v1.key다. 기존 암호화 사전 스냅샷과 키를 보존한다. 0700/0600·동일UID·symlink/hardlink/Git/프로젝트 내부 거절·원자적 게시·AES-256-GCM 인증 후 해석을 기존 암호 모듈에서 재사용한다. format은 production 전용이며 로컬 백업과 혼용하지 않는다.

## 일관성·Auth·파일

읽기 전용 exported MVCC snapshot을 유지한 동일 DB에서 모든 dump와 계정/객체/테이블 수/FK/앱 트리거 메타데이터를 수집한다. 정상 쓰기와 동시에 읽을 수 있으나 snapshot 동안의 schema 변경이나 파일 삭제/크기·해시 불일치는 실패한다. 고정 migration 파일 SHA/원래 원격 버전37을 대조한다. 도구 HEAD·dirty 여부·도구 파일 SHA도 기록하며 현재 checkout을 배포 commit으로 가장하지 않는다.

Auth는 실제 users/Google identities를 별도 dump로 보관한다. 세션·refresh token·MFA·flow state·Vault·Google client secret·서버 API 키/HMAC는 포함하지 않는다. 복구에서 Google 계정에 붙은 비밀번호 해시와 남은 확인/재설정/변경 토큰도 지우고 새로 인증하도록 한다. Google만 지원하는 초기 운영 계약이므로 다른 provider는 거절한다. 단순 UUID 앵커만으로 Google 재접속 검증을 주장하지 않는다.

private Storage의 실제 파일은 API로 받고 원본 path를 파일시스템 경로로 실행/추출하지 않는다. SHA256(bucket+NUL+path) ID·실바이트·길이/등록 SHA를 인증 archive에 넣는다. 한 파일512KiB·최대4096개/총256MiB·SQL각64MiB·압축해제512MiB 제한을 지킨다. 복구는 private WebP 버킷에 create-only 업로드 후 실제 바이트를 재다운로드해 검증한다. 사진 디코드/웹 표시와 사용자/타인/익명 권한은 실제 원격 검증 단계에서 별도로 확인한다.

CA는 공식 콘솔의 HTTPS 다운로드 주소 https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt 이며 공개 인증서 SHA256은700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7이다. 컨테이너 임시 경로에서 이 CA로 verify-full을 강제한다. 시스템 신뢰 저장소나 운영 DB의 SSL 강제 설정을 바꾸지 않는다. pooler 연결의 클라이언트 TLS 검증과 DB에서 관측되는 pooler→DB 내부 연결은 구분한다.

## 복구 중 보호와 원복

암호 인증/형식/기한/migration/최신journal/대상검사 후에만 외부 변경을 시작한다. 대상 Auth 가입·모든 provider가 꺼져 있고 사용자/프로필/Storage가0이며 migration이 일치해야 한다. Auth/Storage 테이블을 잠그고 같은 트랜잭션 안에서 비어 있음을 다시 검사한다.

기존 Auth 생성 트리거는 유지한다. Auth users/identities를 먼저 넣고 그 트리거가 만든 초기 account_state만 앱 원본 데이터를 넣기 전에 정리한다. 부모사진 같은 정상 FK 순환과 입력 순서용 앱 트리거가 bulk import를 막으므로, 복구 전용 대상의 앱 테이블 FK만 잠시 지연 검사로 바꾸고 목록이 일치한 앱 USER 트리거만 트랜잭션 내에서 중지한다. RLS/Auth 트리거/내부 FK 트리거/서버 권한은 해제하지 않는다. 모든 FK를 즉시 검증하고 원래 deferrability와 앱 트리거 상태로 되돌린 뒤 최신 상태를 적용한다. 중간 SQL 실패는 트랜잭션 전체가 rollback된다.

처음 replica 설정은 관리형 postgres 권한으로 거절됐다. 그 권한을 부여하지 않고 위 방식으로 수정했다. Cron 직접 UPDATE도 허용되지 않아 기존 cron.alter_job으로 대체했다. 이메일 provider 차단 뒤 콘솔/원격 diff와 오래된 HTTP 응답이 달라 캐시를 구분한 Auth 설정 요청으로 실제 비활성 상태를 확인했다. 도구는 매번 fresh 설정 응답으로 모든 provider 차단을 요구한다. 초기 CLI의 순환 import 중단은 별도 CLI 진입점으로 수정하고 회귀에 포함했다. 테스트 seed의 생성열 삽입과 부모사진 두 변형 누락도 실제 계약에 맞춰 수정했다. 실패 로그를 성공으로 덮어쓰지 않는다.

## 최신 journal·공개·탈퇴·운영 절차

journal은15분 이내·archive 이후·같은 epoch여야 한다. 현재 Auth에서 사라진 백업 계정과 명시 탈퇴/삭제진행 계정은 제외하고 기존 정리 함수를 통해 DB에서 제거하며 해당 파일은 처음부터 업로드하지 않는다. 현재 pending/suspended/deleting 상태를 존중한다.

복구본은 가입·쓰기·통계·Cron을 중지하고 프로필/개체/성장 공개를 모두 끈다. 백업 이후 개별 숨김이나 공개 동의 변경을 자동으로 되살리지 않는다. journal의 source 설정은 증거로 보존하되 자동으로 운영을 재개하거나 공개하지 않는다. 최신 삭제·숨김·신고 처리와 상태를 대조하고 운영자/계정 소유자가 공개 대상을 검토한 뒤 별도 승인 절차로 재개한다. 이 도구는 백업 이후 새 게시물/수정 전체를 증분 재구성하지 않는다.

기본 담당은 사용자이며 일일 백업·7일 보관을 수동 실행한다. 계정/탈퇴/공개/중지 변경 후와 복구 직전 새 journal을 만든다. prune/create 때 인증된 동일 store/ref/id의7일 경과 파일만 정리하고 잘못된/미인증/미래 파일은 남긴다. 별도 자동 데몬은 없다. 키는 보관 정리 대상이 아니며 archive와 분리해 보관한다. 키가 없거나 journal을 인증할 수 없으면 복구를 진행하지 않는다.

Storage 업로드/네트워크/후속 확인이 실패하면 DB는 이미 commit됐을 수 있다. 대상은 계속 비공개/중지/새 로그인 차단 상태로 두며 source로 전환하지 않는다. 복구 대상에 사용자나 파일이 있으면 재실행을 거절하므로 일반 reset/전역cleanup으로 강행하지 않는다. 실패 대상의 검사·검증용 데이터 처리 또는 새0원 대상을 별도 확인하고 최신 백업/journal로 재시도한다.

최종 완료에는 실제 Google 계정/사진으로 source와 별도 대상에서 Auth/API 재연결·권한·탈퇴·토큰 차단과 공개 상태 보존을 확인한 증거가 필요하다. 빈 원격 DB/오프라인 합성 회귀만으로 #69를 닫지 않는다.

## 최신 기반·실회원 상태

#87/PR89는 프로필 사진 응답손실 재시도 중 WSL 벽시계 역행(단조+134.431ms/벽시계-1542.158ms)을 검사 Date만 고정해 격리하고, 고정 전체verify/E2E221·정확HEAD병합을 통과했다. #69의 이전 full2회 실패 기록은 보존했으며 최신 main71f9bc3(#88정책v1게시 포함)에 반영 후 새 고정 full을 수행한다.

현재 운영 Netlify version6ae4a79b1485f6e33851bd3f(main71f9bc3)에서 실제 본인 Google 로그인·초대연결·pending→active 승인·사용자 승인한v1필수동의·비공개 프로필생성과 관리화면 접근을 확인했다. Auth signup은 사용자 별도 승인으로 초대Hook 제한 지속허용,10명한도·Google만사용을 유지한다. 앞선32테이블/사용자0/실파일0 원격복구는 당시 초기 빈snapshot 증거이며, 현재 실회원/실제사진의 원격 Auth·Storage·API 재연결 증거를 대신하지 않는다. 본인의 새 실사용 계정은 원본 탈퇴시험에 사용하지 않는다. 자동데몬/운영복구 완료로 체크하지 않는다.
