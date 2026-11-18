# 이슈에서 PR까지의 개발 하네스

기준일 2026-10-28. 작은 사용자 흐름 하나를 명세 → 구현 → 실행 증거 → 리뷰로 끝낸다. GitHub에서는 MR을 Pull Request(PR)라고 부른다.

## 책임과 진행 보고

한 에이전트가 아래 책임을 순서대로 맡는다. 별도 에이전트 자동 실행이나 유료 API/클라우드 실행을 구성하지 않는다.

| 책임 | 결과와 보고 시점 |
|---|---|
| 명세·계획 | 현황, GitHub 이슈, F-xx와 수용 기준, 디자인 설명, 작은 구현 계획을 착수 보고 |
| 구현 | 기존 스택으로 데이터/RPC/UI를 연결하고 변경 범위·발견한 차이를 중간 보고 |
| 디자인 검토 | 원본 설명과 PC/모바일 화면을 비교하고 재사용 패턴·남은 차이를 기록 |
| 검증·리뷰 | 적절한 실제 테스트, 실패 원인·수정·재검증, diff/비밀 파일 확인을 보고 |
| 인계 | PR 원격 상태와 이슈 연결을 재조회해 완료 보고, docs/05 갱신 |

통상적인 가역 작업은 계속 진행한다. 차단되는 단계가 생기면 관련 작업만 보류하고 가능한 작업을 수행한다. main 병합·배포는 해당 행동에 대한 사용자 승인 범위 안에서 수행한다. 아래 진행 중 위임은 검증/리뷰 완료 PR의 명시적 병합까지 포함하며 배포는 제외한다.

2026-10-29 사용자는 데스크톱 단계를 제외한 CODEX 개발을 순차 진행하고 각 MR 뒤 보고한 다음 계속하도록 위임했다. 이 진행 중인 작업 범위에서는 검증/리뷰 완료 PR의 명시적 병합과 main 복귀까지 수행하며 매 단계 같은 승인을 재요청하지 않는다. 자동 병합을 켜거나 검증/리뷰를 생략하는 권한이 아니다. 외부 콘솔·운영 배포는 제외한다. 순서/완료 경계는 [순차 개발 기록](14-codex-sequential-plan.md)을 따른다.

## 새 작업 시작

1. `START_HERE.md`, `AGENTS.md`, `docs/05`를 확인한다. 도메인 변경은 docs/01·02, UI 변경은 design/README·docs/08, 실행은 docs/04를 읽는다.
2. GitHub 연결 도구로 기존 이슈·PR을 확인하고 이슈를 등록한다. 수용 기준, 기능 ID, 디자인 참조/설명, 검증 계획을 적는다. `type:*` 1개와 `area:*` 1개 이상을 사용한다. 기능을 여러 분류에서 한꺼번에 구현하지 않는다.
3. 기존 사용자 변경을 보존하고 아래 명령을 실행한다. 이슈 번호는 실제 열린 이슈여야 하며 시작 전에 연결 도구로 확인한다. 스크립트는 원격 이슈 존재 여부를 대신 확인하지 않는다.

```bash
npm run harness:install
npm run task:start -- feat 3 animal-edit
```

`task:start`는 깨끗한 작업 트리·원격 main을 확인하고 fetch 후 `origin/main`에서 새 브랜치를 만든다. 기존 기능 브랜치에서 이어 분기하거나 자동 stash/reset하지 않는다. task 기록 초안을 만든 뒤 수용 기준·참조·검증 계획을 채운다. 설치된 훅 경로가 다르면 덮어쓰지 않고 중단한다.

4. 기능별 구현을 진행한다. 의존하는 PR이 아직 main에 없으면 먼저 그 의존성을 해결하거나 독립 범위로 줄인다. 개발 DB는 초기화하지 않고 새 마이그레이션만 추가한다.
5. 중간 상태는 `harness/tasks/<issue>.json`에 남긴다. 사람이 읽을 설명과 수용 기준으로 결정하고, JSON 체크박스를 완료 근거로 대체하지 않는다.

## 검증·커밋·PR

```bash
npm run harness:check
npm run verify
git add <검토한-파일들>
git diff --cached --check
git commit -m "feat(animals): allow general field editing (#3)"
git push -u origin HEAD
```

- `verify`는 하네스 검사·하네스 회귀·build·unit·DB·media·E2E를 순서대로 실행하고 `.local/harness-verification.json`에 현재 파일 상태의 해시와 실제 결과를 기록한다. DB/사진 QA는 순차 실행한다. 기존 로컬 서비스를 재사용하며 재시작은 docs/04를 따른다.
- 문서만 바꾸는 작업은 `npm run verify -- --docs-only`가 가능하다. 소스·설정·도구 변경이 있으면 거절한다. 실패/건너뜀은 성공으로 표시하지 않는다. 검증 뒤 파일이 바뀌면 push 전에 다시 검증한다.
- pre-commit은 브랜치/이슈 기록·staged 파일·설정/디자인 정책을 검사한다. pre-push는 main·다른 브랜치 전송, 강제 갱신, 미검증 파일 상태, 미완료 디자인 기록을 거절한다. 신규 clone마다 `harness:install`을 실행한다.
- GitHub 연결 도구로 main 대상 PR을 열고 `.github/pull_request_template.md`를 채운다. `Closes #<issue>`, 테스트 결과, 디자인 증거 또는 미해당 이유, 남은 차이를 적는다. draft 여부는 실제 준비 상태를 따른다.
- PR 생성 후 head SHA와 로컬 HEAD, base=main, 변경 파일, 이슈 연결, mergeability를 재조회한다. 이슈는 PR 병합 시 자동 종료되도록 열어 둔다. 자신이 만든 PR을 스스로 승인했다고 기록하지 않는다. 새로운 병합 승인이 없는 통상 작업의 마지막 검토·병합은 사용자에게 맡긴다. 현재 순차 개발 위임 안에서는 최신 head의 검증/리뷰 후 명시적 병합·main 복귀·보고까지 수행한다.

## GitHub 구성과 제한

`.github/repository-settings.json`과 `.github/labels.json`은 실제 적용할 설정의 검토 가능한 기준이다. GitHub 연결 도구에 저장소 설정/라벨 생성 API가 없으면 기존 로컬 인증을 통한 공식 REST API를 사용한다. 비밀값을 출력/저장하지 않는다. 별도 자동화 서비스나 Actions는 사용하지 않는다.

- Issues와 분류 라벨, 기능/버그 이슈 폼, PR 템플릿, CODEOWNERS를 사용한다. CODEOWNERS는 소유권 안내이며 현재 플랜의 강제 리뷰 설정이 아니다. 단독 소유자에게 자기 PR 승인 요청을 보내지 않는다.
- squash merge만 허용하고 PR 제목/본문을 병합 커밋 기본값으로 사용한다. 병합한 작업 브랜치 자동 삭제와 Update branch 버튼을 허용하고 auto-merge는 끈다.
- 저장소는 2026-11-18 사용자 승인으로 공개로 전환했다(과거 "비공개 유지" 기준을 대체). Actions 저장소 권한은 비활성으로 유지한다. 비용 제한 때문에 hosted/self-hosted Actions·Codespaces·유료 보안 기능을 켜지 않는다. 공개 저장소이므로 키·평문 DB·비공개 사진·운영 개인정보는 게시하지 않는다.
- 2026-10-28 rulesets와 main protection 조회는 모두 HTTP 403, `Upgrade to GitHub Pro or make this repository public`를 반환했다(당시 비공개 Free 기록). 2026-11-18 소유자 승인으로 공개로 전환했으나 보호 규칙은 켜지 않았고, 연결된 GitHub 통합 토큰은 protection·Actions 권한 조회에 여전히 403 `Resource not accessible by integration`을 받는다. **서버에서 direct push/리뷰를 강제 차단하지 못한다.** 로컬 훅은 우회 가능하고 GitHub 웹/API에는 적용되지 않는다. PR 검토자가 절차 준수를 확인한다.
- 여러 작업 관리가 필요해지면 GitHub Projects를 기존 계정에서 무료 사용 가능한지 확인해 도입할 수 있다. 현재는 issue label·assignee·PR 링크로 충분하며 중복 상태 보드는 만들지 않는다.

## 인증·환경 복구

이 세션에서는 WSL의 Windows Git Credential Manager가 `git.exe`를 찾지 못했다. 먼저 일회성 helper로 기존 인증을 재사용해 파일럿 fetch/push를 수행했고, 이어 이 저장소의 로컬 `credential.helper`에서 기존 Git for Windows bin을 Windows PATH에 추가하도록 보정해 일반 `git fetch origin`도 검증했다. 전역 설정은 변경하지 않았다. 기존 helper 설정은 무시되는 `.local/git-credential-helper-before.json`에 보존했다. 토큰을 새로 발급하거나 파일에 저장하지 않았다. 임시 helper는 다음 세션의 전제 조건이 아니다. 새 clone/다른 PC에서 인증이 실패하면 GitHub 연결 도구를 사용하거나 그 PC의 기존 Git 인증 경로를 복구한다. 인증 문제를 이유로 저장소 공개 상태를 다시 바꾸지 않는다. 2026-11-18 공개는 소유자가 승인한 별도 결정이며, 인증·보호 우회 수단으로 저장소 공개 여부를 쓰지 않는다.

새 환경의 Docker 권한/브라우저/네트워크 제한과 원격 OAuth·배포 미검증은 구분해서 보고한다. 로컬 실행 증거는 원격 운영 검증이 아니다.

## 공식 지침

저장소 지침의 진입점은 OpenAI의 [AGENTS.md 안내](https://learn.chatgpt.com/docs/agent-configuration/agents-md)를 참고했다. 서버 보호의 플랜 제약은 [GitHub Rulesets 안내](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)와 실제 API 응답으로 확인했다. 이 문서의 task JSON·훅·검증 스크립트는 이 프로젝트의 관례이며 Codex 자체 필수 파일이라고 주장하지 않는다.
