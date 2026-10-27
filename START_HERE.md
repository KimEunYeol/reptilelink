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
AGENTS.md와 prompts/first-task.md를 읽고, 거기에 정의된 첫 작업을 진행해. 기존 명세와 추가 지출 0원 조건을 지키고 WSL에서 개체 정보 수정 기능을 구현·검증해.
```

이번 목표는 **F-03 개체 정보 수정**이다. 삭제·사진 교체·성장 기록·실제 OAuth·클라우드 배포는 후속 작업이다. 설계부터 다시 시작하거나 이미 구현된 기능을 중복 개발하지 않는다.

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
