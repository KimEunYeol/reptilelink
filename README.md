# 렙타일링크

파충류 브리더가 개체와 사진을 관리하고 자신의 공개 페이지로 공유하는 모바일 우선 웹 서비스.

- GitHub: https://github.com/KimEunYeol/reptilelink (비공개)
- 기준 작업 디렉토리: WSL `/home/eykim/projects/reptilelink`
- 현재 구현: **첫 사용자 흐름의 로컬 Auth·DB·사진·공개 페이지**
- 운영 배포·Google OAuth 연결은 아직 수행하지 않았다. 유료 서비스·결제수단·클라우드 리소스도 활성화하지 않았다.

## 로컬 실행

WSL에서 Node 24와 실행 중인 Docker Engine이 필요하다.

```bash
cd ~/projects/reptilelink
npm ci
npm run local:start
npm run local:seed
npm run build
npm run dev:all
```

- 개발 앱: http://localhost:5173
- 빌드 앱·공개 HTML·Worker API: http://localhost:8787
- 로컬 Supabase API: http://127.0.0.1:56321
- 로그인 화면에서 **테스트 브리더로 로그인** → 프로필 생성 → 개체 등록 → 페이지 공개.
- 로컬 테스트 로그인은 개발 서버와 loopback Supabase에서만 표시한다. 빌드 결과에는 표시하지 않는다.
- `npm run local:seed`는 로컬 전용 테스트 사용자를 생성한다. 이 계정이나 기본 로컬 키를 운영에 사용하지 않는다.
- `npm run dev:all`은 앱과 Worker를 함께 실행한다. 종료는 Ctrl+C, 백엔드 종료는 `npm run local:stop`.

자세한 준비·재시작·테스트 방법은 [로컬 개발 안내](docs/04-local-development.md)를 참고한다.

## 검증

```bash
npm run build
npm test
npm run test:db
npm run test:media
npm run test:e2e
```

`test:media`와 `test:e2e`는 로컬 백엔드·앱·Worker가 필요하다. Playwright 브라우저가 없다면 WSL에서 `npx playwright install chromium`을 먼저 실행한다. DB 검사는 전용 QA 계정의 테스트 개체를 정리하므로 개발 사용자 데이터와 분리한다. 테스트·마이그레이션의 재현 결과는 [진행 기록](docs/05-implementation-status.md)에 남긴다.

## 명세

1. [기능 명세](docs/01-functional-spec.md)
2. [데이터 구조와 접근 권한](docs/02-data-model.md)
3. [무료 개발·배포 계획](docs/03-free-development-plan.md)
4. [로컬 개발 안내](docs/04-local-development.md)
5. [구현 범위·검증·남은 작업](docs/05-implementation-status.md)

## 비용·보안 기준

- WSL에서 개발·빌드·테스트한다. 추가 지출 0원, 결제수단 등록·유료 체험·종량 과금 활성화 금지.
- 무료 한도 초과는 제한·중지로 처리한다. 자동 유료 전환·유료 AI API·GitHub Actions·Codespaces는 사용하지 않는다.
- 원격 배포는 실제 계정의 Free 여부를 확인한 다음 별도 단계에서 진행한다.
- 비공개 버킷과 검증된 짧은 서명 URL로 사진을 제공한다. 공개 테이블은 RLS와 명시적인 권한을 적용한다.
- 환경 파일·키·덤프·업로드·테스트 trace는 Git에서 제외한다. 브라우저에는 publishable key만 포함한다.
- Figma는 연결 도구 또는 허용된 공유 웹 링크로 확인한다. 데스크톱 Figma 직접 조작 금지.
