import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, isDocsOnly, validateEvidence, validatePaths, validatePush, validateTask } from '../scripts/harness.mjs';
import { inventory, checkInventory } from '../scripts/design-inventory.mjs';

const branch = 'codex/feat/3-animal-edit';
const sha = 'a'.repeat(40);
const task = () => ({ issue: 3, issueUrl: 'https://github.com/KimEunYeol/reptilelink/issues/3', branch,
  baseSha: sha, scope: 'Edit animal', acceptance: ['Save survives reload'], plan: ['Implement and verify'], status: 'verified',
  design: { applicable: true, references: ['design/렙타일링크_디자인.png', 'design/마이페이지-개체관리-m.png'],
    notes: 'Board animal section: item save and list apply differ.', review: { status: 'passed', summary: 'Compared desktop/mobile and save behavior.' }, evidence: ['390px/1440px screenshots and keyboard check'] } });
const valid = value => validateTask(value, branch, ['src/App.tsx'], true, () => true);

test('accepts a scoped issue task with reviewed design evidence', () => valid(task()));
test('rejects main and mismatched issue links', () => {
  assert.throws(() => validateTask(task(), 'main', []), /codex/);
  assert.throws(() => valid({ ...task(), issue: 4 }), /mismatch/);
  assert.throws(() => valid({ ...task(), issueUrl: 'https://example.com/3' }), /GitHub issue/);
});
test('UI cannot opt out of design; non-UI work needs a reason', () => {
  const value = { ...task(), design: { applicable: false, reason: 'Tooling only' } };
  assert.throws(() => valid(value), /cannot mark design/);
  assert.throws(() => validateTask(value, branch, ['src/assets/logo.svg']), /cannot mark design/);
  validateTask(value, branch, ['scripts/harness.mjs'], true);
  assert.throws(() => validateTask({ ...value, design: { applicable: false } }, branch, []), /Explain/);
});
test('requires real PNG references, board explanation and completed review', () => {
  const value = task();
  assert.throws(() => validateTask(value, branch, [], true, () => false), /Existing design/);
  for (const patch of [{ references: ['design/other.png'] }, { notes: '' }, { references: ['design/../secret.png'] }, { review: { status: 'blocked', summary: 'Not inspected' } }, { evidence: [] }]) {
    assert.throws(() => valid({ ...value, design: { ...value.design, ...patch } }));
  }
});
test('staged source files reject secrets, generated artifacts and Actions workflows', () => {
  for (const path of ['.env.local', '.dev.vars', 'nested/credentials.json', 'auth.json', 'test-results/x.zip', '.github/workflows/ci.yml']) assert.throws(() => validatePaths([path]));
  validatePaths(['.env.example', 'src/App.tsx', 'design/로그인.png']);
});
test('documentation-only mode cannot skip runtime or harness validation', () => {
  assert.equal(isDocsOnly(['docs/07.md', 'AGENTS.md', 'harness/tasks/3.json']), true);
  for (const path of ['src/styles.css', 'scripts/harness.mjs', '.githooks/pre-push', 'package.json', 'design/inventory.json']) assert.equal(isDocsOnly([path]), false);
});
test('push guard allows task branch and rejects main, deletion, other ref and stale HEAD', () => {
  const line = `refs/heads/${branch} ${sha} refs/heads/${branch} ${'0'.repeat(40)}`;
  validatePush(line, branch, sha, () => true);
  validatePush(line.replace(`refs/heads/${branch} `, 'HEAD '), branch, sha, () => true);
  for (const bad of [line.replace(`refs/heads/${branch} ${'0'.repeat(40)}`, `refs/heads/main ${'0'.repeat(40)}`), `(delete) ${'0'.repeat(40)} refs/heads/${branch} ${sha}`, line.replace(sha, 'b'.repeat(40)), line.replace(`refs/heads/${branch} `, 'refs/heads/other ')]) assert.throws(() => validatePush(bad, branch, sha, () => true));
  assert.throws(() => validatePush('', branch, sha, () => true), /Missing/);
});
test('push guard rejects non-fast-forward updates even when force was requested', () => {
  const line = `refs/heads/${branch} ${sha} refs/heads/${branch} ${'b'.repeat(40)}`;
  assert.throws(() => validatePush(line, branch, sha, () => false), /Non-fast-forward/);
});
test('push evidence rejects stale files, incomplete results, failed checks and insufficient scope', () => {
  const commands = ['harness:check', 'test:harness', 'build', 'test', 'test:db', 'test:media', 'test:e2e'];
  const report = { status: 'passed', fingerprint: 'current', scope: 'full', results: commands.map(command => ({ command: `npm run ${command}`, passed: true })) };
  validateEvidence(report, 'current', ['scripts/harness.mjs']);
  assert.throws(() => validateEvidence(report, 'changed', []), /stale/);
  assert.throws(() => validateEvidence({ ...report, results: [] }, 'current', []), /Incomplete/);
  assert.throws(() => validateEvidence({ ...report, status: 'failed' }, 'current', []), /stale/);
  assert.throws(() => validateEvidence({ ...report, scope: 'docs' }, 'current', ['src/App.tsx']), /full verification/);
});
test('design inventory detects changed bytes, missing PNGs and unexpected additions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reptilelink-design-'));
  try {
    mkdirSync(join(dir, 'design'));
    const sample = readFileSync(new URL('../design/Group 1000004870.png', import.meta.url));
    const path = join(dir, 'design/source.png');
    writeFileSync(path, sample);
    writeFileSync(join(dir, 'design/inventory.json'), JSON.stringify(inventory(dir)));
    checkInventory(dir);
    writeFileSync(path, Buffer.concat([sample, Buffer.from('changed')]));
    assert.throws(() => checkInventory(dir), /mismatch/);
    writeFileSync(path, sample);
    writeFileSync(join(dir, 'design/extra.png'), sample);
    assert.throws(() => checkInventory(dir), /mismatch/);
    unlinkSync(join(dir, 'design/extra.png'));
    unlinkSync(path);
    assert.throws(() => checkInventory(dir), /mismatch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('fingerprint detects content changes, ignores evidence and stays stable across staging/committing deletion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reptilelink-fingerprint-'));
  try {
    execFileSync('git', ['init', '-q', dir]);
    writeFileSync(join(dir, '.gitignore'), '.local/\n');
    writeFileSync(join(dir, 'source.txt'), 'original');
    execFileSync('git', ['-C', dir, 'add', '.']);
    execFileSync('git', ['-C', dir, '-c', 'user.name=Harness Fixture', '-c', 'user.email=harness@reptilelink.test', 'commit', '-qm', 'initial fixture']);
    const original = fingerprint(dir);
    mkdirSync(join(dir, '.local'));
    writeFileSync(join(dir, '.local/report.json'), '{}');
    assert.equal(fingerprint(dir), original);
    writeFileSync(join(dir, 'source.txt'), 'changed');
    assert.notEqual(fingerprint(dir), original);
    writeFileSync(join(dir, 'source.txt'), 'original');
    assert.equal(fingerprint(dir), original);
    writeFileSync(join(dir, 'new.txt'), 'new');
    assert.notEqual(fingerprint(dir), original);
    unlinkSync(join(dir, 'new.txt'));
    unlinkSync(join(dir, 'source.txt'));
    assert.notEqual(fingerprint(dir), original);
    const deleted = fingerprint(dir);
    execFileSync('git', ['-C', dir, 'add', '-u']);
    assert.equal(fingerprint(dir), deleted);
    execFileSync('git', ['-C', dir, '-c', 'user.name=Harness Fixture', '-c', 'user.email=harness@reptilelink.test', 'commit', '-qm', 'stage verified deletion']);
    assert.equal(fingerprint(dir), deleted);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('task:start fetches main, preserves dirty work and installs hooks without replacing existing hooks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reptilelink-task-start-'));
  const seed = join(dir, 'seed');
  const remote = join(dir, 'remote.git');
  const clone = join(dir, 'clone');
  const runGit = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const run = (...args) => spawnSync(process.execPath, [join(clone, 'scripts/harness.mjs'), ...args], { cwd: clone, encoding: 'utf8' });
  try {
    mkdirSync(seed);
    runGit(seed, 'init', '-q', '-b', 'main');
    mkdirSync(join(seed, 'scripts'));
    for (const script of ['harness.mjs', 'design-inventory.mjs']) copyFileSync(new URL(`../scripts/${script}`, import.meta.url), join(seed, 'scripts', script));
    writeFileSync(join(seed, 'package.json'), '{"type":"module"}\n');
    mkdirSync(join(seed, 'harness/tasks'), { recursive: true });
    writeFileSync(join(seed, 'harness/tasks/9.json'), '{"scope":"existing user record"}\n');
    runGit(seed, 'add', '.');
    runGit(seed, '-c', 'user.name=Harness Fixture', '-c', 'user.email=harness@reptilelink.test', 'commit', '-qm', 'fixture main');
    execFileSync('git', ['clone', '-q', '--bare', seed, remote]);
    execFileSync('git', ['clone', '-q', remote, clone]);
    runGit(clone, 'switch', '-qc', 'previous-feature');
    writeFileSync(join(clone, 'user-work.txt'), 'preserve');
    assert.notEqual(run('start', 'feat', '3', 'animal-edit').status, 0);
    assert.equal(readFileSync(join(clone, 'user-work.txt'), 'utf8'), 'preserve');
    assert.equal(runGit(clone, 'branch', '--show-current'), 'previous-feature');
    unlinkSync(join(clone, 'user-work.txt'));
    assert.notEqual(run('start', 'feat', '9', 'existing').status, 0);
    assert.equal(runGit(clone, 'branch', '--show-current'), 'previous-feature');
    assert.equal(JSON.parse(readFileSync(join(clone, 'harness/tasks/9.json'), 'utf8')).scope, 'existing user record');
    const started = run('start', 'feat', '3', 'animal-edit');
    assert.equal(started.status, 0, started.stderr);
    assert.equal(runGit(clone, 'branch', '--show-current'), branch);
    assert.equal(runGit(clone, 'rev-parse', 'HEAD'), runGit(clone, 'rev-parse', 'origin/main'));
    const record = JSON.parse(readFileSync(join(clone, 'harness/tasks/3.json'), 'utf8'));
    assert.equal(record.baseSha, runGit(clone, 'rev-parse', 'origin/main'));
    assert.equal(record.issue, 3);
    runGit(clone, 'config', 'core.hooksPath', 'existing-hooks');
    assert.notEqual(run('install').status, 0);
    assert.equal(runGit(clone, 'config', 'core.hooksPath'), 'existing-hooks');
    runGit(clone, 'config', '--unset', 'core.hooksPath');
    assert.equal(run('install').status, 0);
    assert.equal(runGit(clone, 'config', 'core.hooksPath'), '.githooks');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
