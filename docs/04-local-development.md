# 로컬 개발 안내

## 1. 확인한 환경

2026-10-27 확인: Ubuntu-24.04 / WSL2, 사용자 eykim, Node v24.19.0, npm 11.17.0, Git 2.43.0.

Docker Desktop 연동 클라이언트만 있고 WSL 엔진이 없어 Ubuntu의 오픈소스 `docker.io`와 관련 패키지를 설치했다. WSL native Docker Engine 29.1.3을 사용하며 별도 유료 구독을 활성화하지 않았다. 프로젝트 밖의 기존 파일·다른 프로젝트·Docker Desktop 데이터를 삭제하지 않았다.

소스는 `/home/eykim/projects/reptilelink`, Git 원격은 `https://github.com/KimEunYeol/reptilelink.git`다. Git 인증은 기존 Windows 자격증명 관리자를 이 저장소에서만 재사용한다. 토큰을 새로 발급하거나 저장소 파일에 기록하지 않았다.

## 2. 첫 실행

```bash
cd ~/projects/reptilelink
npm ci
npm run local:start
npm run local:seed
npm run build
npm run dev:all
```

Supabase CLI와 런타임은 package-lock.json으로 고정한다. 초기 DB는 `supabase/migrations/`에서 자동 구성된다. `database/schema.sql`은 검토용 원본으로, 이미 마이그레이션이 적용된 DB에 다시 실행하는 명령이 아니다.

개발 앱 5173, Worker 8787, Supabase API 56321, DB 56322, 개발 메일함 56324를 사용한다. Docker 네트워크 `reptilelink-local`의 host binding은 127.0.0.1이다. 포트 포워딩·공인 터널을 만들지 않는다.

`local:start`는 내부 로컬 상태에서 `.env.local`과 `.dev.vars`를 생성한다. 전자는 브라우저용 publishable key, 후자는 로컬 Worker 전용 특권 키를 포함하며 둘 다 Git에서 제외한다. 키 값을 터미널에 복사해 게시하거나 `.env.example`에 채워 커밋하지 않는다.

첫 방문: http://localhost:5173/auth/login → 테스트 브리더로 로그인 → 프로필 → 개체 사진·이름 → 공개 설정.

소스 코드를 바꾸면 Vite가 갱신한다. Worker가 제공하는 빌드 화면·공개 HTML을 확인하려면 `npm run build`로 dist를 최신으로 만든다.

## 3. 테스트 계정

| 계정 | 용도 |
|---|---|
| breeder-a@reptilelink.test | 첫 사용자·화면 검증 |
| breeder-b@reptilelink.test | 다른 브리더 |
| qa-owner@reptilelink.test | DB·한도·업로드 QA 전용 |
| qa-other@reptilelink.test | 타인 접근 차단 QA 전용 |
| pending@reptilelink.test | 승인 대기 권한 확인 |

이 주소는 실제 메일 계정이 아닌 로컬 fixture다. 비밀번호는 로컬 fixture 코드에서만 정의한 테스트 값이다. 운영 계정으로 사용하지 않는다. 정상 계정을 사용하는 외부 Google OAuth를 검증했다는 의미도 아니다.

`test:db`는 QA 계정 두 개의 테스트 개체를 정리한 후 실행한다. QA 계정에 실제 데이터를 넣지 않는다. 테스트 결과의 ‘도리’와 브리더 소개·도마뱀 일러스트는 검증용 자료다.

## 4. DB 변경·초기화

- 개발 SQL은 로컬 DB에서 반복 검증한 뒤 Supabase CLI로 마이그레이션을 생성한다.
- 현재 CLI의 `db query --file`은 여러 문장을 prepared statement로 실행할 수 없는 문제가 있어, 초기 스키마는 Docker 내부 psql의 단일 트랜잭션으로 적용했다.
- 검증 후 `supabase db pull ... --local --schema public,private,api`로 초기 마이그레이션을 생성했다. 스키마 diff에 없는 프로젝트 예산 행과 비공개 버킷 생성 SQL을 마이그레이션에 포함했다.
- 빈 로컬 DB에서 마이그레이션을 다시 적용하고 테스트 계정을 재생성해 재현성을 확인한다.

아래 명령은 **이 프로젝트의 로컬 DB 데이터를 초기화**한다. 실제 자료를 넣은 뒤에는 백업 없이 실행하지 않는다.

```bash
npm run local:reset
```

초기화 명령에 `--network-id reptilelink-local`을 유지해야 한다. 생략하면 재생성한 DB만 다른 Docker 네트워크에 붙어 Auth·Storage가 DB를 찾지 못할 수 있다.

## 5. 검증·정리

```bash
npm run build
npm test
npm run test:db
npm run test:media
npm run test:e2e
npm run local:cleanup
```

- 단위 검사: 입력·오류 메시지·업로드 파일 바이트 구조.
- DB 검사: 실제 로컬 Auth 세션, RLS, 소유권, 중복 요청, 편집 버전, 개체·업로드 한도.
- 미디어 검사: 타인·비인증 업로드, 서명 토큰 덮어쓰기, 잘못된 파일, 실패 정리.
- 브라우저 검사: 프로필부터 사진 포함 개체·공개 페이지까지, 새로고침, 비공개 전환, production 빌드의 테스트 로그인 제외.
- 만료 업로드 정리는 로컬 백엔드에서만 실행하며 실제 파일 제거 후 바이트를 반환한다.
- `local:cleanup`은 기한이 지난 파일 정리 후 파일이 없는 개체 삭제 작업도 완료한다. 전체 대기 배치를 변경하는 운영 명령이므로 화면 확인이나 QA 시작 용도로 실행하지 않는다. 새 개체 삭제 QA는 해당 실행이 만든 개체·파일 ID만 정리하며 DB/미디어/E2E를 순서대로 실행한다. 화면의 ‘정리 다시 확인’은 본인의 선택한 삭제 작업만 재시도한다.

브라우저 캡처는 `artifacts/`, 실패 trace는 `test-results/`에 저장하고 Git에서 제외한다. 개발 로그와 기본 로컬 키가 들어갈 수 있는 상태 출력도 커밋하지 않는다.

## 6. 재시작·종료

- 프런트·Worker: `npm run dev:all`, 종료 Ctrl+C.
- 백엔드: `npm run local:start`, 종료 `npm run local:stop`.
- Docker 엔진이 멈췄다면 WSL에서 기존 서비스 상태를 확인해 시작한다. 다른 프로젝트의 컨테이너를 일괄 삭제하거나 prune하지 않는다.
- 로컬 Supabase가 일부 서비스만 실행 중이면 이 프로젝트를 `local:stop` 후 `local:start`로 재시작한다. DB가 손상됐다고 가정해 바로 초기화하지 않는다.
- 소스·DB·사진은 서로 다른 데이터다. DB dump만으로 사진이 백업됐다고 간주하지 않는다.

## 7. 운영 배포 이전 조건

실제 무료 조직·OAuth 계정·약관·초대 Hook 설정·운영 secret·Worker CPU 측정·복구 절차를 검증해야 한다. 현재 로컬 설정에는 개발용 메일/fixture와 임시 동의 버전이 있으므로 그대로 운영에 복제하지 않는다. 유료 옵션·결제수단이 요구되면 진행하지 않는다.

## 원본 인증·안내 로컬 확인 (#38)

/help는 실제문의채널이없으면 준비상태의원본폼을보여준다. 실제공개연락처를확인한뒤 VITE_SUPPORT_EMAIL을설정하면 사용자가메일앱에서직접발송할초안을연결한다. 이값은공개연락처이며비밀키가아니다. 자동접수/SMTP/API/메일발송을구성하지않았고외부앱동작/실제수신은데스크톱에서확인한다. local:env는기존추가환경값을보존한다. 약관·개인정보본문은현재개발확인용이며실제운영자료와버전연결/재동의#46은별도이다.

인증/온보딩/관리HTML은로컬Worker에서no-store/no-referrer를검사한다. assets.run_worker_first는해당경로와기존api/u에만적용하며assets/CSS/JS는직접제공한다. 운영배포/공급업체OAuth를검증했다는뜻이아니다.
