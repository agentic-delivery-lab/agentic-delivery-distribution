import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { applyBootstrap } from '../../bootstrap/src/bootstrap.mjs';
import { validateBootstrapSources, VALIDATION_SOURCE_COMMIT } from '../../bootstrap/src/bootstrap-admission.mjs';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const sourceRoots = {
  controlPlaneRoot: process.env.BOOTSTRAP_CONTROL_PLANE_ROOT ?? path.resolve(root, '../agentic-delivery'),
  architectureRoot: process.env.BOOTSTRAP_ARCHITECTURE_ROOT ?? path.resolve(root, '../agentic-delivery-architecture'),
  primitivesRoot: process.env.BOOTSTRAP_CUSTOMIZATIONS_ROOT ?? path.resolve(root, '../agentic-delivery-primitives'),
};
async function git(directory, ...args) {
  return (await exec('git', ['--no-replace-objects', '--no-lazy-fetch', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', directory, ...args])).stdout.trim();
}

async function fixture(t, { corruptDigest = false, corruptWorkflow = false } = {}) {
  const callerRoots = { ...sourceRoots };
  const container = path.resolve(root, '../agentic-delivery-distribution.worktrees/owned-fixtures');
  await mkdir(container, { recursive: true });
  const owned = await mkdtemp(path.join(container, 'source-admission-'));
  t.after(() => rm(owned, { recursive: true, force: true }));
  const distributionRoot = path.join(owned, 'distribution');
  const targetRoot = path.join(owned, 'consumer');
  await mkdir(distributionRoot); await mkdir(targetRoot);
  await writeFile(path.join(targetRoot, 'unrelated.txt'), 'Preserve owner bytes.\n');
  for (const relative of ['manifests', 'bootstrap/templates', 'packages/agent-plugin']) {
    await mkdir(path.dirname(path.join(distributionRoot, relative)), { recursive: true });
    await cp(path.join(root, relative), path.join(distributionRoot, relative), { recursive: true });
  }
  if (corruptDigest) {
    const filename = path.join(distributionRoot, 'manifests/capabilities.lock.json');
    const value = JSON.parse(await readFile(filename, 'utf8')); value.contentSha256 = '0'.repeat(64);
    await writeFile(filename, JSON.stringify(value));
  }
  if (corruptWorkflow) {
    const filename = path.join(distributionRoot, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-quality.yml');
    const bundle = JSON.parse(await readFile(path.join(distributionRoot, 'manifests/workflow-bundle.json'), 'utf8'));
    const bytes = (await readFile(filename, 'utf8')).replace(/(uses: [^\n]+@)[0-9a-f]{40}/, '$1' + '0'.repeat(40));
    await writeFile(filename, bytes + `\n# @${bundle.workflowSource.commit}\n`);
  }
  await git(distributionRoot, 'init', '-b', 'main');
  await git(distributionRoot, 'add', '.');
  await git(distributionRoot, '-c', 'user.name=Synthetic source fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic Distribution projection data');
  const repositories = {
    'agentic-delivery-lab/agentic-delivery-distribution': [1380894705, distributionRoot],
    'agentic-delivery-lab/agentic-delivery': [1358455028, sourceRoots.controlPlaneRoot],
    'agentic-delivery-lab/agentic-delivery-architecture': [1380894616, sourceRoots.architectureRoot],
    'agentic-delivery-lab/agentic-delivery-agent-customizations': [1380894656, sourceRoots.primitivesRoot],
  };
  const faults = {};
  // Mock only the REST transport. Actual Git integrity, canonical validator,
  // producer tools/digests and immutable snapshot projection run unchanged.
  // This synthetic Distribution commit is not native hosting/adoption proof.
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (faults.mutateCallerRoots) {
      delete faults.mutateCallerRoots;
      callerRoots.controlPlaneRoot = path.join(owned, 'absent-caller-change');
    }
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://api.github.com');
    const parts = parsed.pathname.split('/'); const repository = parts.slice(2, 4).join('/');
    const [id, directory] = repositories[repository];
    if (parts.length === 4) return Response.json({ id: faults.repositoryId ?? id, full_name: repository, default_branch: 'main' });
    if (parts[4] === 'commits') return Response.json({ sha: await git(directory, 'rev-parse', 'HEAD') });
    assert.equal(parts[4], 'compare');
    const [commit, head] = parts[5].split('...');
    await git(directory, 'merge-base', '--is-ancestor', commit, head);
    return Response.json({ status: commit === head ? 'identical' : 'ahead', behind_by: 0,
      base_commit: { sha: commit, commit: { tree: { sha: await git(directory, 'rev-parse', `${commit}^{tree}`) } } },
      merge_base_commit: { sha: commit } });
  });
  return { distributionRoot, targetRoot, sourceRoots: callerRoots, faults };
}

test('source validation reuses the exact accepted public tool with real producer digests', async (t) => {
  const f = await fixture(t);
  f.faults.mutateCallerRoots = true;
  const result = await validateBootstrapSources(f);
  assert.equal(result.graph.status, 'passed');
  assert.equal(result.graph.validationScope, 'public-distribution');
  assert.equal(result.proof.sources.at(-1).commit, VALIDATION_SOURCE_COMMIT);
  assert.ok(result.releaseStatuses.includes('draft'));
  assert.deepEqual(await readdir(f.targetRoot), ['unrelated.txt']);
});

test('draft source validation cannot approve supported apply, including force and caller flags', async (t) => {
  const f = await fixture(t);
  for (const force of [false, true]) {
    await assert.rejects(applyBootstrap({ ...f, force, admitted: true, verified: true }), /requires released/i);
    assert.deepEqual(await readdir(f.targetRoot), ['unrelated.txt']);
    assert.equal(await readFile(path.join(f.targetRoot, 'unrelated.txt'), 'utf8'), 'Preserve owner bytes.\n');
  }
});

test('wrong observed native ID holds supported force apply without consumer writes', async (t) => {
  const f = await fixture(t); f.faults.repositoryId = 1;
  await assert.rejects(applyBootstrap({ ...f, force: true }), /native source/i);
  assert.deepEqual(await readdir(f.targetRoot), ['unrelated.txt']);
});

test('wrong producer digest holds supported force apply without consumer writes', async (t) => {
  const f = await fixture(t, { corruptDigest: true });
  await assert.rejects(applyBootstrap({ ...f, force: true }), /Capabilities Primitive digest/);
  assert.deepEqual(await readdir(f.targetRoot), ['unrelated.txt']);
});

test('wrong actual workflow pin holds force apply despite a matching comment', async (t) => {
  const f = await fixture(t, { corruptWorkflow: true });
  await assert.rejects(applyBootstrap({ ...f, force: true }), /consumer workflow must separate/i);
  assert.deepEqual(await readdir(f.targetRoot), ['unrelated.txt']);
});
