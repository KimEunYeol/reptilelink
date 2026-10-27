# VS Code WSL · Codex 인계

준비일: 2026-10-28. 기준 경로: Ubuntu-24.04 `/home/eykim/projects/reptilelink`.

## 확인한 환경

- VS Code 1.143.1, Windows WSL 확장 `ms-vscode-remote.remote-wsl` 1.104.6.
- WSL 설치 확장 `openai.chatgpt` 26.1021.22027. 실행 중인 원격 확장 호스트가 Linux Codex `app-server`를 사용함을 확인했다.
- WSL Codex CLI 0.164.0. `codex login status`: `Logged in using ChatGPT`.
- Node 24.19.0, npm 11.17.0, Docker Engine 29.1.3. 로컬 앱 5173과 Worker health 8787에서 HTTP 200 확인.
- ripgrep을 WSL에 추가했다. 기존 확장·인증·전역 설정을 덮어쓰지 않았다.

## 프로젝트에 적용한 설정

- `.vscode/settings.json`: Codex 사이드바 자동 열기, Linux bash 터미널, LF, 빌드/의존성 디렉토리의 검색·감시 제외.
- `.vscode/extensions.json`: 공식 WSL/Codex 확장 권장 목록.
- `.vscode/tasks.json`: 로컬 백엔드·빌드·개발 서버·검사 작업. 자동 실행과 배포 작업은 없다. `Ctrl+Shift+B`는 빌드다.
- `.codex/config.toml`: ChatGPT 인증, workspace-write sandbox, on-request 승인. 프로젝트를 신뢰한 뒤 적용되는 프로젝트 설정이다. 모델과 전역 MCP/인증 정보는 고정하거나 복사하지 않는다.
- `AGENTS.md`: 기존 기능·데이터·비용 규칙을 유지하고 문서 읽기 순서, 변경·검증·인계 절차를 연결했다.
- `prompts/first-task.md`: F-03 중 **개체 일반 정보 수정** 한 흐름의 목표·수용 기준·작업 순서.

Codex 설정은 비용을 전부 통제하는 결제 차단기가 아니다. ChatGPT 인증을 사용하더라도 포함 한도가 적용된다. 한도 소진 시 API key·추가 크레딧으로 전환하지 않는다. 외부 리소스·결제 활성화를 하지 않는 규칙은 AGENTS와 작업 프롬프트에서도 유지한다.

## 열기와 인증

```bash
cd ~/projects/reptilelink
code . START_HERE.md prompts/first-task.md
```

`WSL: Ubuntu-24.04` 표시와 Linux 경로를 확인한다. Codex 사이드바의 로컬 작업에서 시작한다. 로그인 요구 시 사용자가 `Sign in with ChatGPT`로 완료한다. CLI 로그인과 Linux 확장 호스트 실행은 확인했지만, 인계용 IDE에서 새 AI 작업을 실행해 성공 응답을 받은 것까지 검증하지는 않았다. 준비 과정에서 AI 사용량을 추가로 소비하는 시험 요청은 보내지 않았다.

프로젝트 신뢰 확인이 나오면 경로와 파일을 검토해 이 프로젝트에 대해서만 판단한다. 보안 확인을 자동 우회하거나 전체 디렉토리를 신뢰 대상으로 등록하지 않았다.

기존 Windows 전용 WSL 전환 설정을 추측해서 넣지 않았다. 이 설치에서는 Remote WSL 창과 Linux 확장 호스트를 직접 사용한다. 확장의 `cliExecutable` 개발용 설정도 변경하지 않았다.

## 개발 방법과 다음 순서

명세 기준 개발(SDD)을 기반으로 작은 사용자 흐름을 끝까지 구현한다: **명세/수용 기준 확인 → 필요한 데이터 변경 → RPC/API → 화면 → 실제 권한/브라우저 검증 → 진행 문서**. 문서 전체를 다시 설계하거나 모든 미구현 기능을 한 작업에 합치지 않는다.

1. 이번 첫 작업: 개체 일반 정보 수정·선택 생일·충돌/권한/취소 검증.
2. 후속: 개체 삭제와 파일 정리·사진 교체/삭제·영역별 적용/취소와 정렬.
3. 단계 A 보완 후 실제 무료 계정 조건·Google OAuth·가입 제한 Hook·무료 배포를 검증.
4. 이후 단계 B 관리 기능, 단계 C 방문자/운영 기능. 자세한 우선순위는 기존 01~05 문서를 따른다.

P0/P1과 단계 A 전체가 완료된 상태는 아니다. 첫 사용자 흐름의 로컬 기반이 구현되어 있고, 원격 인증·무료 배포·나머지 기능은 남아 있다. 기존 01~03 설계 문서는 이 IDE 준비에서 변경하지 않았다.

## 공식 근거

- [Codex IDE](https://learn.chatgpt.com/docs/ide)
- [Codex IDE 설정](https://learn.chatgpt.com/docs/ide/settings)
- [WSL에서 VS Code 실행](https://learn.chatgpt.com/docs/windows/wsl)
- [인증 방식](https://learn.chatgpt.com/docs/auth)
- [프로젝트 설정 참조](https://learn.chatgpt.com/docs/config-file/config-reference)
