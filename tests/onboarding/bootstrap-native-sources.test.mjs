import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { sourceToolEnvironment, verifyNativeGitSource, verifySourceCheckout } from '../../bootstrap/src/bootstrap-native-sources.mjs';

const exec = promisify(execFile);
const repository = 'agentic-delivery-lab/agentic-delivery';
const repositoryId = 1358455028;
test('validation tools receive only explicit runtime environment fields', () => {
  const env = sourceToolEnvironment({ PATH: '/usr/bin', HOME: '/owned', GH_TOKEN: 'fixture-secret',
    GITHUB_TOKEN: 'fixture-secret', OPENAI_API_KEY: 'fixture-secret', SSH_AUTH_SOCK: '/private/agent',
    NODE_OPTIONS: '--import=fixture', NODE_PATH: '/untrusted', GIT_CONFIG_GLOBAL: '/untrusted/config' });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/owned');
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'SSH_AUTH_SOCK', 'NODE_OPTIONS', 'NODE_PATH']) {
    assert.equal(Object.hasOwn(env, name), false);
  }
  assert.notEqual(env.GIT_CONFIG_GLOBAL, '/untrusted/config');
});
async function fixture(t) {
  const container = path.resolve(import.meta.dirname, '../../../agentic-delivery-distribution.worktrees/owned-fixtures');
  await mkdir(container, { recursive: true });
  const root = await mkdtemp(path.join(container, 'native-binding-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = async (...args) => (await exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', root, ...args])).stdout.trim();
  await git('init', '-b', 'main');
  await writeFile(path.join(root, 'tracked.txt'), 'Synthetic native-source binding fixture.\n');
  await git('add', 'tracked.txt');
  await git('-c', 'user.name=Synthetic source fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic source');
  const commit = await git('rev-parse', 'HEAD');
  const tree = await git('rev-parse', 'HEAD^{tree}');
  const responses = {
    metadata: { id: repositoryId, full_name: repository, default_branch: 'main' },
    head: { sha: commit },
    comparison: { status: 'identical', behind_by: 0, base_commit: { sha: commit, commit: { tree: { sha: tree } } }, merge_base_commit: { sha: commit } },
  };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(String(url));
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    const response = String(url).includes('/compare/') ? responses.comparison
      : String(url).includes('/commits/') ? responses.head : responses.metadata;
    return new Response(JSON.stringify(response));
  });
  return { root, repository, repositoryId, commit, tree, responses, requests, git };
}

test('native binding proves canonical numeric identity, accepted ancestry and exact tree', async (t) => {
  const f = await fixture(t);
  const result = await verifyNativeGitSource(f);
  assert.equal(result.repositoryId, repositoryId);
  assert.equal(result.commit, f.commit);
  assert.equal(result.tree, f.tree);
  assert.equal(result.observedDefaultHead, f.commit);
  assert.equal(f.requests.length, 3);
  await assert.doesNotReject(verifySourceCheckout(f.root, f.commit));
});

for (const [label, change] of [
  ['wrong native ID', (f) => { f.responses.metadata.id = 1; }],
  ['wrong canonical name', (f) => { f.responses.metadata.full_name = 'other/repository'; }],
  ['invalid default branch', (f) => { f.responses.metadata.default_branch = '../main'; }],
  ['moving default SHA', (f) => { f.responses.head.sha = 'main'; }],
  ['array default SHA', (f) => { f.responses.head.sha = [f.commit]; }],
  ['diverged source', (f) => { f.responses.comparison.status = 'diverged'; }],
  ['unmerged source', (f) => { f.responses.comparison.status = 'behind'; }],
  ['missing ancestry', (f) => { f.responses.comparison.behind_by = 1; }],
  ['wrong base', (f) => { f.responses.comparison.base_commit.sha = '0'.repeat(40); }],
  ['wrong merge base', (f) => { f.responses.comparison.merge_base_commit.sha = '0'.repeat(40); }],
  ['wrong source tree', (f) => { f.responses.comparison.base_commit.commit.tree.sha = '0'.repeat(40); }],
]) {
  test(`native binding rejects ${label}`, async (t) => {
    const f = await fixture(t); change(f);
    await assert.rejects(verifyNativeGitSource(f), /native source/i);
    assert.equal(await readFile(path.join(f.root, 'tracked.txt'), 'utf8'), 'Synthetic native-source binding fixture.\n');
  });
}

test('caller declarations cannot select a foreign repository or ID', async (t) => {
  const f = await fixture(t);
  for (const overrides of [{ repositoryId: 1 }, { repository: 'other/repository' },
    { repository: 'other/repository', repositoryId: undefined }, { commit: 'main' }]) {
    await assert.rejects(verifyNativeGitSource({ ...f, ...overrides }), /native source/i);
  }
  assert.deepEqual(f.requests, []);
});

test('unknown network or HTTP evidence holds instead of admitting a source', async (t) => {
  const f = await fixture(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Synthetic outage'); });
  await assert.rejects(verifyNativeGitSource(f), /native source/i);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 403 }));
  await assert.rejects(verifyNativeGitSource(f), /native source/i);
});

test('malformed and oversized API responses hold', async (t) => {
  const f = await fixture(t);
  for (const body of ['{invalid', 'x'.repeat(4 * 1024 * 1024 + 1)]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(body));
    await assert.rejects(verifyNativeGitSource(f), /native source/i);
  }
});

test('checkout proof rejects changed, missing or untracked source bytes', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'tracked.txt'), 'Local edit.\n');
  await assert.rejects(verifySourceCheckout(f.root, f.commit), /source checkout/i);
  await rm(path.join(f.root, 'tracked.txt'));
  await assert.rejects(verifySourceCheckout(f.root, f.commit), /source checkout/i);
  await writeFile(path.join(f.root, 'tracked.txt'), 'Synthetic native-source binding fixture.\n');
  await writeFile(path.join(f.root, 'untracked.txt'), 'Untracked source input.\n');
  await assert.rejects(verifySourceCheckout(f.root, f.commit), /source checkout/i);
});

test('tab-containing Git paths cannot hide changed tracked bytes behind an ignored file', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, '.gitignore'), 'ignored.txt\n');
  await writeFile(path.join(f.root, 'ignored.txt'), 'Original bytes.\n');
  await writeFile(path.join(f.root, 'ignored.txt\tother'), 'Original bytes.\n');
  await f.git('add', '.gitignore', 'ignored.txt\tother');
  await f.git('-c', 'user.name=Synthetic source fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic unusual source path');
  const commit = await f.git('rev-parse', 'HEAD');
  await writeFile(path.join(f.root, 'ignored.txt\tother'), 'Changed tracked bytes.\n');
  await assert.rejects(verifySourceCheckout(f.root, commit), /source checkout/i);
});
