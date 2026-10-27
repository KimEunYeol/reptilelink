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
- Read docs/05 before selecting work. The next slice is animal general-field editing, not all of F-03. Production OAuth and free deployment remain unverified.
- Add new migrations for database changes. Do not replay the initial migration or database/schema.sql against an already migrated database.
- Update docs/05 with observed results and unresolved gaps. Do not merge main or deploy remotely without user authorization for that step.
