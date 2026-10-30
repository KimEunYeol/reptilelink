# Reptilelink working rules

- Canonical checkout: WSL `~/projects/reptilelink`. Run tools, installs, builds and tests in WSL.
- Additional spending must remain zero. Never enable paid plans, trials, metered products, payment methods, AI APIs, cloud builds or GitHub Actions without an explicit change to this constraint.
- Read docs/01-functional-spec.md and docs/02-data-model.md before changing domain behavior.
- Local test identities and password sign-in are loopback development fixtures only. Production uses explicitly configured OAuth; never silently bypass authentication.
- Enable RLS on exposed tables. Do not put secrets in VITE_ variables, logs, browser code or commits.
- DB writes use explicit transactional commands, ownership checks and quotas. Keep private notes and file metadata out of public DTOs.
- Figma desktop automation is forbidden; use the connector or explicitly authorized shared web links.
- Run `npm run build`, `npm test`, `npm run test:db` and relevant Playwright flows. Never claim remote OAuth/deployment verified when only local fixtures were tested.
- Do not spawn parallel agents unless the user explicitly requests them.

## IDE handoff and workflow

- Start with `START_HERE.md`, then docs/01, docs/02, docs/03 and docs/05. IDE setup is in docs/06; prompts/first-task.md is historical. Current desktop execution starts at docs/40 and docs/41.
- Keep the existing stack and accepted D-01~D-08 decisions. Follow specification → one user flow → data/RPC/UI → meaningful verification → status documentation.
- Use local Codex with the existing ChatGPT entitlement. Never switch to API-key billing, buy credits or delegate cloud work when a limit is reached; stop until the allowance resets.
- Preserve user changes and local data. Use `codex/` branches; do not reset the local database or remove volumes as a routine startup or migration step.
- Read docs/05 and current GitHub issue/PR state before selecting work. General-field editing (#3 / PR #5), collection order/public batch apply (#6 / PR #7), management-shell design alignment (#8 / PR #9), and photo editing/recovery (#10 / PR #11) are merged; do not reimplement them. Animal deletion (#12 / PR #13) is merged. Growth records/private notes/public opt-in (#14 / PR #15) are merged at ded76b7. External links (#16 / PR #17) are merged at3c6773e. SNS (#18 / PR #19) is merged at966d0c3. Schedules (#20 / PR #21) are merged at d9087bf. Unified profile text/SNS (#22 / PR #23) is merged at d7d24e2. Profile/cover media and themes (#24 / PR #25) are merged at c389ecb. Account withdrawal (#26 / PR #27) is merged at f876752. Comments/reports (#28 / PR #29) are merged at6ff2d2b. Profile likes #30 / PR #31 are merged at79e5436. Notifications/read #32 / PR #33 are merged at984e82e. Page views #34 / PR #35 are merged at0a02a2f. Source audit #2 / PR #41 is merged at352b596. Public boundary #36 / PR #43 is merged at0b2b6c4. Pending-animal withdrawal #42 / PR #44 is merged atdf800b7. Source main/common #37 / PR #45 is merged at88fdc6f. Source auth/account/help #38 / PR #47 are merged at49f92ea. Policy version/renewal #46 / PR #48 are merged at35655f6. Source public/Worker #39 / PR #50 are merged at8095cef. User-approved parents/adoption #49 / PR #54 are merged at12b308a; common #40 / PR #55 is merged at24d4027. Public focus #58 / PR #59 is merged at660b099. Media recovery #56 / PR #57 is merged atcf1721f; receipt retention #51 / PR #60 is merged at74764c1; encrypted backups/isolated restore #52 / PR #61 is merged atc1e04b8; local doctor/handoff #53 is the final CODEX closure. Desktop-only console/OAuth/deploy/materials remain external; use docs/39. Required documents are immutable server versions; local-policy-preview prepares only loopback development instructions. Never publish operating policies or replace old version content without the supplied desktop materials. Production OAuth and free deployment remain unverified.
- Add new migrations for database changes. Do not replay the initial migration or database/schema.sql against an already migrated database.
- Update docs/05 with observed results and unresolved gaps. Do not merge main or deploy remotely without user authorization for that step.
- Active user delegation (2026-10-29): complete the remaining CODEX/local development sequentially, report after each PR/MR, then continue the next stage. This includes reviewing/fixing and explicitly merging each verified PR, followed by a clean main checkout; do not ask the same merge permission again. Follow docs/14-codex-sequential-plan.md. This delegation excludes external console configuration/deployment, paid work, parallel agents, and unverifiable completion claims.

## Agentic development contract

- Use [docs/07-agentic-workflow.md](docs/07-agentic-workflow.md) for every scoped task. One agent performs specification, implementation, design review and verification in sequence; these are responsibilities, not permission to spawn agents.
- Register a GitHub issue before implementation. Fetch `origin/main`, then create a new `codex/<feat|fix|chore|docs|design>/<issue>-<slug>` branch from it for each category/feature. Never branch a new feature from the previous feature branch. Use `npm run task:start -- <type> <issue> <slug>` after confirming the issue exists.
- Keep a concrete plan, acceptance criteria, design references and results in `harness/tasks/<issue>.json`. Report at discovery, harness/implementation completion, verification and PR completion; report material blockers promptly. Continue authorized reversible work without repeated confirmation.
- **The sole visual source is `design/`.** Read [design/README.md](design/README.md) and [docs/08-design-contract.md](docs/08-design-contract.md), inspect the whole board's explanation text and the relevant desktop/mobile images before editing UI. Match both the written behavior and the screen. No invented layouts, branding, illustrations or new visual direction; additions must reuse demonstrated patterns. Missing/conflicting evidence must be recorded and resolved before dependent UI work.
- Do not treat the existing UI or handcrafted `Gecko` illustration as approved design. Existing gaps are tracked separately; they are not permission for new invention. Preserve accepted D-01~D-08 behavior; record conflicts with old design text explicitly rather than silently undoing those decisions.
- Install repo-local hooks with `npm run harness:install`. Run `npm run harness:check` and `npm run verify` before push. `verify -- --docs-only` is permitted only for documentation-only work, never runtime/harness/tooling changes. UI changes require design evidence and human-readable review in the task record.
- Use a main-targeted GitHub Pull Request (the GitHub equivalent of MR), the PR template, `Closes #<issue>`, type/area labels and actual local test results. Inspect the remote head/base, issue link, changed files and mergeability after creation. Keep the issue open until merge. No direct main push, force push, self-approval, auto-merge, paid CI or deployment.
- Local hooks and recorded review are bypassable safeguards. Private-repository server branch protection is unavailable on the current plan (403 confirmed 2026-10-28); never claim server enforcement. See docs/07 for the settings audit and recovery procedure.

## Local operations

- Use `npm run local:doctor` for read-only status before recovery/cleanup. attention is not success; it includes intentional pause/backlog/unknown. Do not run global cleanup/reset to obtain a green report.
- Use docs/38 for private encrypted backups/separate keys/latest journal/isolated restore; docs/39 for incidents and desktop handoff. Never publish source keys, fixtures or preview policies remotely. After account/withdrawal/publication/stop-state changes create a fresh journal before claiming recovery readiness.
- Maintain the issue → latest-main branch → spec/data/design → implementation → fixed full verify → latest-HEAD completed review/fixes → explicit expected-HEAD merge → closed issue/clean main/verified tree/report workflow for future changes. The current sequential user delegation authorizes these merges; external deployment remains separate.

데스크톱 외부 설정·자료·출시 미검증 항목은 [이슈62](https://github.com/KimEunYeol/reptilelink/issues/62)와 [운영/인계서](docs/39-local-operations-handoff.md)로 추적한다. 로컬 검증/병합과 외부 출시를 구분한다.

## Active desktop execution delegation (2026-10-30)

- The user explicitly approved docs/41 execution through external configuration/deployment/verification at zero additional cost. This supersedes the older desktop-excluded scope for this plan only; verified PR merges remain authorized.
- Work in the canonical WSL checkout. Windows folder cleanup is limited to the approved README/launcher-only result, preserving its .git and any unique evidence in ignored WSL records.
- Create a dedicated Free Supabase project in Seoul after current zero-cost/slot checks; preserve gain-music-club. Use Netlify Free alone for the final app host as clarified below, with no domain purchase or DNS changes; the earlier Cloudflare preparation is historical.
- The user supplied 770.kr as document reference, the website inquiry address and permission for web verification photos. Candidate policies and a CC0 photo are prepared; operator identity/final policy and rights details remain unconfirmed. Do not invent facts or publish unconfirmed candidates. Continue independent preparation; record actual results in issue62.

## Current launch clarification (2026-10-30)

- Latest user direction: 770.kr is reference material only, never the service domain. Its pending Cloudflare custom-domain association was removed; do not change its DNS or use its subdomains. No domain purchases. Use a free provider hostname containing reptilelink and no dev for the eventual public frontend.
- Latest email clarification: 770_official@naver.com is the website inquiry address only. Google project/OAuth administration uses the user's own currently signed-in Google account; a Google account for the Naver address is not required. The user wants one hosting provider and zero spending risk: use Netlify Free alone for the app, keeping the existing Supabase DB/Auth/Storage. The observed Free account has a hard credit limit, no auto recharge and no saved card; do not enable paid features. Netlify browser login is complete; WSL CLI authentication and final hostname ownership must be verified separately.
- docs46 records current Netlify preparation: CLI authentication and reptilelink.netlify.app name ownership are verified, but app upload/OAuth/member release are incomplete. docs45 is historical Cloudflare preparation. Candidate policy documents are not published or confirmed operator identity. Keep admission paused until actual policy/auth prerequisites are resolved.

- Current hosting adapter/runbook and observed Free limits are in [docs/46-netlify-single-host.md](docs/46-netlify-single-host.md). Earlier Cloudflare preparation is historical, not the chosen final architecture. Retire its production path only after the Netlify replacement is verified.

- Netlify Free environment variables use the default scopes; granular Functions-only scope and paid Secrets Controller are not assumed. Use production contextual values, explicit public-only Vite inputs and no cloud builds/Forms/proxy/snippet injection. Verify server values are absent from public assets.

- Observation at issue83: automatic review rejected sending SUPABASE_SECRET_KEY and a new HMAC to the Netlify production environment because destination-specific sensitive-data consent was missing; the command did not execute. A specific user request is pending. Do not work around that rejection. If a later session message explicitly authorizes that exact transfer, honor it without asking again. Continue public-only/read-only preparation meanwhile.
