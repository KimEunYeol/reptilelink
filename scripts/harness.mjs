import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInventory } from './design-inventory.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
const branchPattern = /^codex\/(feat|fix|chore|docs|design)\/([1-9]\d*)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const json = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const split = text => text.split('\0').filter(Boolean);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const isUI = path => /^(src\/.*\.(tsx|jsx|css|svg|png|jpe?g|webp|avif|gif)$|worker\/index\.ts$|index\.html$|public\/)/.test(path);
export const isDocsOnly = paths => paths.every(path => /^(docs\/|prompts\/|harness\/tasks\/)|(^|\/)[^/]+\.md$/.test(path));

export function validatePaths(paths) {
  for (const path of paths) {
    assert(!/(^|\/)(\.env(?:\..*)?|\.dev\.vars(?:\..*)?|auth\.json|credentials(?:\.json)?|[^/]+\.pem)$/.test(path) || path === '.env.example', `Secret/config file forbidden: ${path}`);
    assert(!/^(\.github\/workflows\/|artifacts\/|test-results\/|playwright-report\/|\.local\/|node_modules\/)/.test(path), `Generated/paid workflow path forbidden: ${path}`);
  }
}

export function validateTask(task, branch, paths, ready = false, hasReference = path => existsSync(resolve(root, path))) {
  const match = branch.match(branchPattern);
  assert(match, 'Use codex/<feat|fix|chore|docs|design>/<issue>-<slug>; main commits are forbidden.');
  assert(task.issue === Number(match[2]) && task.branch === branch, 'Task issue/branch mismatch.');
  assert(task.issueUrl === `https://github.com/KimEunYeol/reptilelink/issues/${task.issue}`, 'Task must link its GitHub issue.');
  assert(/^[a-f0-9]{40}$/.test(task.baseSha), 'Task must record the fetched main base SHA.');
  assert(nonempty(task.scope) && task.acceptance?.length && task.acceptance.every(nonempty), 'Scope and acceptance criteria are required.');
  assert(task.plan?.length && task.plan.every(nonempty), 'A concrete implementation/verification plan is required.');
  assert(task.design && typeof task.design.applicable === 'boolean', 'Design applicability is required.');
  if (paths.some(isUI)) assert(task.design.applicable, 'UI changes cannot mark design not applicable.');
  if (task.design.applicable) {
    assert(task.design.references?.length && task.design.references.every(path => path.startsWith('design/') && path.endsWith('.png') && !path.split('/').includes('..') && hasReference(path)), 'Existing design PNG references are required.');
    assert(task.design.references.includes('design/렙타일링크_디자인.png'), 'Inspect and reference the whole board explanation.');
    assert(nonempty(task.design.notes), 'Record board explanation location, text and behavior.');
    if (ready) {
      assert(task.design.review?.status === 'passed' && nonempty(task.design.review.summary), 'Design comparison must pass before push.');
      assert(task.design.evidence?.length && task.design.evidence.every(nonempty), 'Record actual responsive/interaction evidence.');
    }
  } else assert(nonempty(task.design.reason), 'Explain why design does not apply.');
  if (ready) assert(task.status === 'verified', 'Task must be verified before push.');
}

export function fingerprint(cwd = root) {
  const paths = [...new Set(split(git(['ls-files', '-co', '--exclude-standard', '-z'], cwd)))].sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    const full = resolve(cwd, path);
    let stat;
    try { stat = lstatSync(full); }
    catch (error) {
      // Hash the resulting file state: staging a verified deletion must not change it.
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    hash.update(`${path}\0${stat.mode & 0o777}\0`);
    hash.update(stat.isSymbolicLink() ? readlinkSync(full) : readFileSync(full));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function validatePush(input, branch, head, ancestor) {
  const updates = input.trim().split('\n').filter(Boolean);
  assert(updates.length > 0, 'Missing pre-push ref updates.');
  for (const update of updates) {
    const [localRef, localSha, remoteRef, remoteSha] = update.trim().split(/\s+/);
    assert(remoteRef === `refs/heads/${branch}` && ["HEAD", `refs/heads/${branch}`].includes(localRef) && localSha === head, 'Only the current task branch HEAD may be pushed; main/deletion/other refs are forbidden.');
    if (remoteSha !== '0'.repeat(40)) assert(ancestor(remoteSha, localSha), 'Non-fast-forward push is forbidden; fetch and inspect the remote branch.');
  }
}

const fullCommands = ['harness:check', 'test:harness', 'build', 'test', 'test:db', 'test:media', 'test:e2e'];
export function validateEvidence(report, digest, paths) {
  assert(report.status === 'passed' && report.fingerprint === digest, 'Missing/stale local verification; run npm run verify.');
  assert(['full', 'docs'].includes(report.scope), 'Unknown verification scope.');
  assert(report.scope === 'full' || isDocsOnly(paths), 'Runtime/harness/tooling changes require full verification.');
  const required = report.scope === 'full' ? fullCommands : ['harness:check'];
  assert(required.every(command => report.results?.some(result => result.command === `npm run ${command}` && result.passed === true)), 'Incomplete verification results; run npm run verify.');
}

function current() {
  const branch = git(['branch', '--show-current']);
  const match = branch.match(branchPattern);
  assert(match, 'Start a scoped issue branch with npm run task:start.');
  const task = json(`harness/tasks/${match[2]}.json`);
  const paths = split(git(['diff', '--name-only', '-z', `${task.baseSha}...HEAD`]));
  paths.push(...split(git(['diff', 'HEAD', '--name-only', '-z'])), ...split(git(['ls-files', '--others', '--exclude-standard', '-z'])));
  validateTask(task, branch, paths);
  assert(spawnSync('git', ['merge-base', '--is-ancestor', task.baseSha, 'HEAD'], { cwd: root }).status === 0, 'Recorded main base must be an ancestor of HEAD.');
  assert(spawnSync('git', ['merge-base', '--is-ancestor', task.baseSha, 'origin/main'], { cwd: root }).status === 0, 'Recorded base must belong to origin/main.');
  return { branch, task, paths: [...new Set(paths)] };
}

function check(mode) {
  const context = current();
  checkInventory(root);
  validatePaths(split(git(['ls-files', '-z'])));
  if (mode === 'pre-commit') {
    const paths = split(git(['diff', '--cached', '--name-only', '-z']));
    validatePaths(paths);
    validateTask(context.task, context.branch, paths);
    // Inspect staged bytes too: working-tree checks alone can miss a staged deletion or stale record.
    const stagedTask = JSON.parse(git(['show', `:harness/tasks/${context.task.issue}.json`]));
    validateTask(stagedTask, context.branch, paths, false, path => spawnSync('git', ['cat-file', '-e', `:${path}`], { cwd: root }).status === 0);
    assert(stagedTask.baseSha === context.task.baseSha, 'Staged task base differs from the working record.');
    const stagedInventory = JSON.parse(git(['show', ':design/inventory.json']));
    const stagedPngs = split(git(['ls-files', '-z', '--', 'design'])).filter(path => path.endsWith('.png')).sort();
    assert(JSON.stringify(stagedPngs) === JSON.stringify(stagedInventory.map(entry => entry.path)), 'Staged design files differ from the staged inventory.');
    for (const entry of stagedInventory) {
      const bytes = execFileSync('git', ['show', `:${entry.path}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
      assert(bytes.length === entry.bytes && createHash('sha256').update(bytes).digest('hex') === entry.sha256, `Staged design source mismatch: ${entry.path}`);
    }
    assert(spawnSync('git', ['diff', '--cached', '--check'], { cwd: root, stdio: 'inherit' }).status === 0, 'Staged whitespace check failed.');
  } else validatePaths(context.paths);
  return context;
}

function start(args) {
  const [type, issue, slug] = args;
  const branch = `codex/${type}/${issue}-${slug}`;
  assert(args.length === 3 && Number.isSafeInteger(Number(issue)) && /^[1-9]\d*$/.test(issue??'') && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug??'') && branchPattern.test(branch), 'Usage: npm run task:start -- <feat|fix|chore|docs|design> <issue> <slug>');
  assert(!git(['status', '--porcelain']), 'Preserve existing changes; task:start requires a clean working tree.');
  execFileSync('git', ['fetch', 'origin', 'main'], { cwd: root, stdio: 'inherit' });
  const baseSha = git(['rev-parse', 'origin/main']);
  assert(spawnSync('git', ['cat-file', '-e', `origin/main:harness/tasks/${issue}.json`], { cwd: root, stdio: 'ignore' }).status !== 0, 'This issue already has a task record on main; inspect it or create a new issue.');
  execFileSync('git', ['switch', '--no-track', '-c', branch, 'origin/main'], { cwd: root, stdio: 'inherit' });
  mkdirSync(resolve(root, 'harness/tasks'), { recursive: true });
  writeFileSync(resolve(root, `harness/tasks/${issue}.json`), JSON.stringify({
    issue: Number(issue), issueUrl: `https://github.com/KimEunYeol/reptilelink/issues/${issue}`, branch, baseSha,
    scope: '', acceptance: [], plan: [], status: 'planned',
    design: { applicable: true, references: ['design/렙타일링크_디자인.png'], notes: '', review: { status: 'pending', summary: '' }, evidence: [] },
  }, null, 2) + '\n');
  console.log('Task created. Fill scope, acceptance, plan and design evidence before implementation.');
}

function install() {
  const old = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  assert(!old || old === '.githooks', `Existing hooksPath ${old}; inspect it before changing hooks.`);
  // Respect inherited/global hooks too.
  const effective = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  assert(!effective || effective === '.githooks', `Inherited hooksPath ${effective}; inspect before changing hooks.`);
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: root });
  console.log('Repo-local hooks installed. Hooks are bypassable; PR review remains required.');
}

function verify(docsOnly) {
  const { paths } = check();
  assert(!docsOnly || isDocsOnly(paths), '--docs-only cannot validate runtime, harness or tooling changes.');
  const commands = docsOnly ? ['harness:check'] : fullCommands;
  const before = fingerprint();
  const results = [];
  mkdirSync(resolve(root, '.local'), { recursive: true });
  // Invalidate any old successful evidence before executing checks.
  const report = { status: 'running', scope: docsOnly ? 'docs' : 'full', fingerprint: before, results };
  writeFileSync(resolve(root, '.local/harness-verification.json'), JSON.stringify(report, null, 2) + '\n');
  for (const command of commands) {
    const result = spawnSync('npm', ['run', command], { cwd: root, stdio: 'inherit' });
    results.push({ command: `npm run ${command}`, passed: result.status === 0 });
    if (result.status !== 0) break;
  }
  report.status = results.length === commands.length && results.every(result => result.passed) && fingerprint() === before ? 'passed' : 'failed';
  report.completedAt = new Date().toISOString();
  writeFileSync(resolve(root, '.local/harness-verification.json'), JSON.stringify(report, null, 2) + '\n');
  assert(report.status === 'passed', 'Verification failed or files changed during verification. Inspect results and rerun.');
  console.log('Verification passed; local evidence recorded for this file state.');
}

function main([command, ...args]) {
  if (command === 'start') return start(args);
  if (command === 'install') return install();
  if (command === 'verify') return verify(args.includes('--docs-only'));
  const context = check(command);
  if (command === 'pre-push') {
    validatePush(readFileSync(0, 'utf8'), context.branch, git(['rev-parse', 'HEAD']), (older, newer) => spawnSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd: root }).status === 0);
    assert(!git(['status', '--porcelain']), 'Push requires a clean working tree.');
    validateTask(context.task, context.branch, context.paths, true);
    const report = json('.local/harness-verification.json');
    validateEvidence(report, fingerprint(), context.paths);
  }
  console.log('Harness checks passed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`Harness: ${error.message}`); process.exitCode = 1; }
}
