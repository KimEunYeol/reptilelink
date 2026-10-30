# VS Code WSL에서 이어서 시작하기

기준 저장소는 **Ubuntu-24.04의 `/home/eykim/projects/reptilelink`**다. Windows/OneDrive 폴더에는 초기 문서와 준비 파일이 있으므로 실제 개발은 이 WSL 저장소에서 이어간다.

## 1. 프로젝트 열기

WSL 터미널에서:

```bash
cd ~/projects/reptilelink
code . START_HERE.md prompts/first-task.md
```

VS Code 왼쪽 아래에 `WSL: Ubuntu-24.04`가 보여야 한다. 터미널의 `pwd`는 `/home/eykim/projects/reptilelink`, `command -v node`는 Linux 경로여야 한다.

## 2. Codex 열기

Codex 사이드바가 자동으로 열린다. 보이지 않으면 `Ctrl+Shift+P` → `Codex: Open Codex Sidebar`를 실행한다. **로컬 작업**을 선택하고 현재 ChatGPT 계정을 사용한다. 로그인 화면이 나오면 `Sign in with ChatGPT`를 선택한다. API key·크레딧 구매·클라우드 작업은 선택하지 않는다. 포함된 사용 한도에 도달하면 중지하고 한도 갱신 후 재개한다.

WSL CLI의 ChatGPT 로그인은 준비 시 확인했다. 확장의 로그인 화면까지 실제 새 작업을 실행해 검증한 것은 아니므로 IDE에서 재로그인을 요구하면 직접 완료한다. 전역 설정·인증 파일을 복사하거나 덮어쓰지 않았다.

## 3. 첫 메시지 보내기

Codex에 아래 문장을 보낸다. 전체 작업 지시는 파일에 저장되어 있다.

```text
AGENTS.md와 docs/07-agentic-workflow.md, prompts/first-task.md를 읽고 진행해. 기능 이슈를 먼저 만들고 최신 main에서 새 브랜치로 시작해. 디자인은 design/ 원본의 설명과 PC·모바일 화면을 확인하고 그대로 따라. 로컬 검증 후 main 대상 PR까지 만들고 중간보고해. 추가 지출은 0원이야.
```

개체 일반 정보 수정(#3 / PR #5), 목록 순서·공개 일괄 적용(#6 / PR #7), 관리 공통 영역 정비(#8 / PR #9), 사진 교체·삭제·복구(#10 / PR #11)는 main에 병합됐다. 개체 삭제(#12 / PR #13)도 main에 병합됐다. 성장 기록·비공개 메모·공개 동의(#14 / PR #15)도 main ded76b7에 병합됐다. 외부 링크(#16 / PR #17)도 main3c6773e에 병합됐다. SNS(#18 / PR #19)도 main966d0c3에 병합됐다. 일정(#20 / PR #21)도 main d9087bf에 병합됐다. 프로필 텍스트·SNS 단일 적용(#22 / PR #23)도 main d7d24e2에 병합됐다. 프로필/배경 이미지·테마(#24 / PR #25)도 main c389ecb에 병합됐다. 계정 탈퇴·정리 #26 / PR #27도 main f876752에 병합됐다. 댓글·신고 #28 / PR #29도 main6ff2d2b에 병합됐다. 프로필 좋아요 #30 / PR #31도 main79e5436에 병합됐다. 받은 알림/읽음 #32 / PR #33도 main984e82e에 병합됐다. 실제 조회수 #34 / PR #35도 main0a02a2f에 병합됐다. 원본 차이 감사 #2 / PR #41은 main352b596에 병합됐다. 공개 경계 #36 / PR #43은 main0b2b6c4에 병합됐다. 삭제대기 탈퇴 보완 #42 / PR #44는 maindf800b7에 병합됐다. 메인/공통 #37 / PR #45는 main88fdc6f에 병합됐다. 인증/기본정보/안내 #38 / PR47은 main49f92ea에 병합됐다. 동의버전/재동의 #46 / PR48은 main35655f6에 병합됐다. 공개#39/PR50은 main8095cef에 병합됐다. 사용자승인부모/입양일#49/PR54은 main12b308a에 병합됐다. 공통#40/PR55는 main24d4027에 병합됐다. 공개초점#58/PR59는 main660b099에 병합됐다. 사진복구#56/PR57은 maincf1721f에 병합됐다. 요청영수증/만료#51/PR60은 main74764c1에 병합됐다. 백업/격리복구#52/PR61은 mainc1e04b8에 병합됐고 실제 기본 백업·28파일 격리복구도 통과했다. 마지막 운영진단/인계#53의 실제PR/검증보고서와 docs/39를 확인한다. 로컬 미리보기만 local:policy-preview로 준비하며 실제 운영 문서/게시는 데스크톱 입력이다. 항상 docs/05와 실제 GitHub 이슈/PR을 먼저 확인해 완료된 기능을 중복 구현하지 않는다. 이후 단계도 독립 이슈/브랜치로 진행한다. 외부 OAuth·Cloudflare 웹 콘솔 설정은 사용자가 지정한 데스크톱 단계다.

새 clone에서는 먼저 `npm run harness:install`을 실행한다. 실제 열린 이슈를 확인한 뒤 `npm run task:start -- <type> <이슈번호> <작업-slug>`로 최신 main에서 시작한다. 선행 기능이 필요하면 먼저 main 병합 여부를 확인한다. 전체 절차는 [개발 하네스](docs/07-agentic-workflow.md), 원본 설명/화면 일치 기준은 [디자인 계약](docs/08-design-contract.md)에 있다.

## 4. 앱을 직접 실행하려면

현재 서버가 실행 중이면 기존 `http://localhost:5173`을 사용한다. 포트가 사용 중일 때 다른 포트로 우회하거나 기존 프로세스를 무작정 종료하지 않는다.

재시작할 때:

```bash
cd ~/projects/reptilelink
npm run local:start
npm run build
npm run dev:all
```

의존성이 없는 새 체크아웃에서는 먼저 `npm ci`, 로컬 테스트 계정이 없으면 `npm run local:seed`를 실행한다. `local:reset`은 데이터를 초기화하므로 일반 시작 절차에 포함하지 않는다.

`Ctrl+Shift+P` → `Tasks: Run Task`에서도 `Reptilelink:` 작업을 선택할 수 있다. 개발 서버 작업은 로컬 백엔드 시작 → 빌드 → 앱·Worker 실행 순서다. 서버 종료는 해당 터미널의 `Ctrl+C`다. DB·업로드·브라우저 검사의 전제 조건은 [로컬 안내](docs/04-local-development.md)를 확인한다.

## 읽을 문서

- [프로젝트·비용·보안 지침](AGENTS.md)
- [기능 명세](docs/01-functional-spec.md), [데이터 구조](docs/02-data-model.md)
- [무료 개발·배포 계획](docs/03-free-development-plan.md)
- [실행 안내](docs/04-local-development.md), [구현 상태](docs/05-implementation-status.md)
- [IDE 설정·인계 기록](docs/06-vscode-codex-setup.md)
- [이슈·브랜치·검증·PR 하네스](docs/07-agentic-workflow.md)
- [디자인 원본 안내](design/README.md), [디자인 계약](docs/08-design-contract.md)

## 로컬 운영/데스크톱 전환

읽기전용 상태는 `npm run local:doctor`, 암호화 백업/별도키·최신journal/격리복구는 [docs/38](docs/38-encrypted-backup-restore.md), 실패별 재시도·중지/rollback·정책/키·실제 외부설정 체크리스트는 [docs/39](docs/39-local-operations-handoff.md)를 따른다. 로컬 통과를 Google OAuth/무료 운영 계정/원격 배포 완료로 보고하지 않는다.

데스크톱 외부 설정·자료·출시 미검증 항목은 [이슈62](https://github.com/KimEunYeol/reptilelink/issues/62)와 [운영/인계서](docs/39-local-operations-handoff.md)로 추적한다. 로컬 검증/병합과 외부 출시를 구분한다.
