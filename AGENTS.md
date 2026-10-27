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
