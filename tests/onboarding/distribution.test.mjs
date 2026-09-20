import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { applyBootstrap, bootstrapPlan, validateBootstrapManifest } from '../../bootstrap/src/bootstrap.mjs';
import { validateDistribution } from '../../tools/validate-distribution.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('distribution bundle is thin, pinned, and draft until source promotion', async () => {
  const result = await validateDistribution(root);
  assert.deepEqual(result, { files: 3, sources: 4 });
});

test('bootstrap manifest is idempotent-contract input, not a control plane', async () => {
  const manifest = await validateBootstrapManifest(root);
  assert.equal(manifest.controlPlane.repository, 'agentic-delivery-lab/agentic-delivery');
  assert.equal(manifest.architecture.repository, 'agentic-delivery-lab/agentic-delivery-architecture');
  assert.deepEqual(manifest.architecture.affectedIdentifiers, ['urn:agentic-delivery:architecture:authority']);
  assert.notEqual(manifest.workflowSource.commit, manifest.controlPlane.commit);
  assert.equal(manifest.files.every((file) => file.mode === 'managed'), true);
  const plugin = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(path.join(root, 'packages/agent-plugin/plugin.json'), 'utf8')));
  assert.equal(plugin.generatedFrom.primitiveSourceCommit, '78cceeda1c6d7ceeddd4cf3f392836284a0216f8');
  assert.equal(plugin.generatedFrom.architectureCommit, '3690baa97cf0b9b1b188b7adf289e063c3f92004');
});

test('consumer workflow delegates only to the secret-free pinned contract workflow', async () => {
  const workflow = await import('node:fs/promises').then(({ readFile }) => readFile(path.join(root, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-quality.yml'), 'utf8'));
  assert.ok(workflow.includes('/.github/workflows/agentic-delivery-quality.yml@3db6b25f5e7a5eb41ba248f2a1396714d1e19150'));
  assert.ok(workflow.includes('controller_commit: b160ae8826330ce280c41108e9459550c399e8c6'));
  assert.ok(!workflow.includes('secrets:'));
  const architectureWorkflow = await import('node:fs/promises').then(({ readFile }) => readFile(path.join(root, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-architecture-review.yml'), 'utf8'));
  assert.ok(architectureWorkflow.includes('/.github/workflows/agentic-delivery-architecture-review.yml@3db6b25f5e7a5eb41ba248f2a1396714d1e19150'));
  assert.ok(architectureWorkflow.includes('architecture_commit: 3690baa97cf0b9b1b188b7adf289e063c3f92004'));
  assert.ok(architectureWorkflow.includes("affected_identifiers: '[\"urn:agentic-delivery:architecture:authority\"]'"));
});

test('bootstrap projects only declared files, records provenance, and is idempotent', async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-consumer-'));
  t.after(() => rm(targetRoot, { recursive: true, force: true }));

  const planned = await bootstrapPlan({ distributionRoot: root, targetRoot });
  assert.equal(planned.entries.length, 3);
  assert.ok(planned.entries.every((entry) => entry.action === 'create'));

  const applied = await applyBootstrap({ distributionRoot: root, targetRoot });
  assert.equal(applied.applied, true);
  const lock = JSON.parse(await readFile(path.join(targetRoot, '.agentic-delivery/distribution.lock.json'), 'utf8'));
  assert.match(lock.$schema, /consumer-distribution-lock\.v1\.schema\.json$/);
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.files.length, 3);
  const second = await applyBootstrap({ distributionRoot: root, targetRoot });
  assert.ok(second.entries.every((entry) => entry.action === 'unchanged'));
});

test('bootstrap preflights conflicts and requires explicit force before overwrite', async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-consumer-conflict-'));
  t.after(() => rm(targetRoot, { recursive: true, force: true }));
  await applyBootstrap({ distributionRoot: root, targetRoot });
  const managed = path.join(targetRoot, '.github/workflows/agentic-delivery-quality.yml');
  await writeFile(managed, 'local change\n');
  await assert.rejects(
    applyBootstrap({ distributionRoot: root, targetRoot }),
    /local changes in managed files/,
  );
  assert.equal(await readFile(managed, 'utf8'), 'local change\n');
  await applyBootstrap({ distributionRoot: root, targetRoot, force: true });
  assert.notEqual(await readFile(managed, 'utf8'), 'local change\n');
});
