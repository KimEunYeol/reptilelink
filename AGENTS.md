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

- Start with `START_HERE.md`, then docs/01, docs/02, docs/03 and docs/05. IDE setup is in docs/06; the first scoped task is in prompts/first-task.md.
- Keep the existing stack and accepted D-01~D-08 decisions. Follow specification → one user flow → data/RPC/UI → meaningful verification → status documentation.
- Use local Codex with the existing ChatGPT entitlement. Never switch to API-key billing, buy credits or delegate cloud work when a limit is reached; stop until the allowance resets.
- Preserve user changes and local data. Use `codex/` branches; do not reset the local database or remove volumes as a routine startup or migration step.
- Read docs/05 and current GitHub issue/PR state before selecting work. General-field editing (#3 / PR #5), collection order/public batch apply (#6 / PR #7), management-shell design alignment (#8 / PR #9), and photo editing/recovery (#10 / PR #11) are merged; do not reimplement them. Animal deletion (#12 / PR #13) is merged. Growth records/private notes/public opt-in (#14 / PR #15) are merged at ded76b7. External links (#16 / PR #17) are merged at3c6773e. SNS (#18 / PR #19) is merged at966d0c3. Schedules (#20 / PR #21) are merged at d9087bf. Unified profile text/SNS (#22 / PR #23) is merged at d7d24e2. Profile/cover media and themes (#24 / PR #25) are merged at c389ecb. Account withdrawal (#26 / PR #27) is merged at f876752. Comments/reports (#28 / PR #29) are merged at6ff2d2b. Profile likes are tracked in #30; inspect its PR before follow-up work. Production OAuth and free deployment remain unverified.
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
