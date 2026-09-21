import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { applyBootstrap, bootstrapPlan, validateBootstrapManifest } from '../../bootstrap/src/bootstrap.mjs';
import { promoteAgentProjections, promotionPlan } from '../../bootstrap/src/promote-agent-projections.mjs';
import { validateDistribution } from '../../tools/validate-distribution.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('distribution bundle is thin, pinned, and draft until source promotion', async () => {
  const result = await validateDistribution(root);
  assert.deepEqual(result, { files: 3, sources: 5 });
  const manifest = JSON.parse(await readFile(path.join(root, 'manifests/workflow-bundle.json'), 'utf8'));
  assert.equal(manifest.bundleVersion, '0.1.0-draft.11');
});

test('bootstrap manifest is idempotent-contract input, not a control plane', async () => {
  const manifest = await validateBootstrapManifest(root);
  assert.equal(manifest.controlPlane.repository, 'agentic-delivery-lab/agentic-delivery');
  assert.equal(manifest.architecture.repository, 'agentic-delivery-lab/agentic-delivery-architecture');
  assert.equal(manifest.architecture.contentSha256, '341bc5e446446af71893135eedb52b520c37162929f3ac6af2e74a494e6014ea');
  assert.deepEqual(manifest.architecture.affectedIdentifiers, ['urn:agentic-delivery:architecture:authority']);
  assert.notEqual(manifest.workflowSource.commit, manifest.controlPlane.commit);
  assert.equal(manifest.files.every((file) => file.mode === 'managed'), true);
  const plugin = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(path.join(root, 'packages/agent-plugin/plugin.json'), 'utf8')));
  assert.equal(plugin.generatedFrom.primitiveSourceCommit, '51e94992c5f39c59046f752e0cf6cff2ed3fff32');
  assert.equal(plugin.generatedFrom.primitiveContentSha256, '36a7e7e95a89ee00288f08a30ac41e4166e11516165e93af47b342026ce894d0');
  assert.equal(plugin.generatedFrom.architectureCommit, '2bfe92c8c641a2258d4393a37785c793d8a46c48');
  assert.equal(plugin.generatedFrom.architectureContentSha256, '341bc5e446446af71893135eedb52b520c37162929f3ac6af2e74a494e6014ea');
});

test('consumer workflow delegates only to the secret-free pinned contract workflow', async () => {
  const workflow = await import('node:fs/promises').then(({ readFile }) => readFile(path.join(root, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-quality.yml'), 'utf8'));
  assert.ok(workflow.includes('/.github/workflows/agentic-delivery-quality.yml@c3d0d2c7be0a68ca9d6ae83174f8ebae754826f4'));
  assert.ok(workflow.includes('controller_commit: 81fa558aad0f998876bc29871080f2380b2c8582'));
  assert.ok(!workflow.includes('secrets:'));
  assert.match(workflow, /jobs:\n  control-plane-contract:\n    uses:/);
  assert.match(workflow, /    with:\n      controller_commit:/);
  const architectureWorkflow = await import('node:fs/promises').then(({ readFile }) => readFile(path.join(root, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-architecture-review.yml'), 'utf8'));
  assert.ok(architectureWorkflow.includes('/.github/workflows/agentic-delivery-architecture-review.yml@c3d0d2c7be0a68ca9d6ae83174f8ebae754826f4'));
  assert.ok(architectureWorkflow.includes('architecture_commit: 2bfe92c8c641a2258d4393a37785c793d8a46c48'));
  assert.ok(architectureWorkflow.includes("affected_identifiers: '[\"urn:agentic-delivery:architecture:authority\"]'"));
  assert.match(architectureWorkflow, /jobs:\n  architecture:\n    uses:/);
  assert.match(architectureWorkflow, /    with:\n      architecture_commit:/);
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
  assert.equal(lock.architecture.contentSha256, '341bc5e446446af71893135eedb52b520c37162929f3ac6af2e74a494e6014ea');
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

test('bootstrap leaves repository-local CI workflows independent', async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-consumer-local-ci-'));
  t.after(() => rm(targetRoot, { recursive: true, force: true }));
  const localWorkflow = path.join(targetRoot, '.github/workflows/repository-ci.yml');
  const localContent = `name: repository-ci\n\non:\n  push:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo local-ci\n`;
  await mkdir(path.dirname(localWorkflow), { recursive: true });
  await writeFile(localWorkflow, localContent);

  const result = await applyBootstrap({ distributionRoot: root, targetRoot });

  assert.equal(await readFile(localWorkflow, 'utf8'), localContent);
  assert.ok(result.entries.every((entry) => entry.target !== '.github/workflows/repository-ci.yml'));
});

test('agent promotion creates a provenance-complete projection and replaces only owned stale files', async (t) => {
  const primitiveRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-primitives-'));
  const privateRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-delivery-private-'));
  t.after(() => Promise.all([
    rm(primitiveRoot, { recursive: true, force: true }),
    rm(privateRoot, { recursive: true, force: true }),
  ]));
  await mkdir(path.join(primitiveRoot, 'agents/copilot'), { recursive: true });
  await mkdir(path.join(primitiveRoot, 'manifests'), { recursive: true });
  await writeFile(path.join(primitiveRoot, 'manifests/primitive-release.json'), JSON.stringify({
    schemaVersion: 1,
    releaseId: 'urn:agentic-delivery:primitive-release:0.1.0-draft.1',
    version: '0.1.0-draft.1',
    status: 'draft',
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    capabilityPolicyVersion: '1.0.0',
  }));
  const source = `---\nname: example-reviewer\ndescription: Read-only example reviewer\ntools: [codebase]\n---\n\n<!-- agentic-primitive: {"id":"example-reviewer","adrs":["ADR-0018"],"domains":["agentic-delivery-control-plane"]} -->\n\nReview the approved change.\n`;
  await writeFile(path.join(primitiveRoot, 'agents/copilot/example-reviewer.agent.md'), source);
  await mkdir(path.join(privateRoot, 'agents'), { recursive: true });
  await mkdir(path.join(privateRoot, 'provenance'), { recursive: true });
  await writeFile(path.join(privateRoot, 'provenance/agents.lock.json'), JSON.stringify({
    schemaVersion: 1,
    canonicalRepository: 'agentic-delivery-lab/agentic-delivery-primitives',
    agents: [],
  }));

  const planned = await promotionPlan({ primitiveRoot, privateRoot, promotedAt: '2026-09-21T12:00:00Z' });
  assert.deepEqual(planned.actions.map((action) => action.action), ['create']);
  const promoted = await promoteAgentProjections({ primitiveRoot, privateRoot, promotedAt: '2026-09-21T12:00:00Z' });
  assert.equal(promoted.applied, true);
  const lock = JSON.parse(await readFile(path.join(privateRoot, 'provenance/agents.lock.json'), 'utf8'));
  assert.equal(lock.agents[0].primitiveId, 'urn:agentic-delivery:primitive:example-reviewer');
  assert.equal(lock.agents[0].sourceRef, lock.agents[0].sourceCommit);
  assert.equal(await readFile(path.join(privateRoot, 'agents/example-reviewer.agent.md'), 'utf8'), source);

  await writeFile(path.join(privateRoot, 'agents/stale.agent.md'), '---\nname: stale\ndescription: Stale\ntools: [codebase]\n---\n');
  const staleLock = { ...lock, agents: [{
    primitiveId: 'urn:agentic-delivery:primitive:stale',
    agentId: 'stale',
    targetPath: 'agents/stale.agent.md',
    sourceRepository: 'agentic-delivery-lab/agentic-delivery-primitives',
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    sourceRef: '0123456789abcdef0123456789abcdef01234567',
    contentSha256: '0'.repeat(64),
    governingAdrs: ['urn:agentic-delivery:adr:0018'],
    toolPolicyVersion: '1.0.0',
    promotionRelease: 'urn:agentic-delivery:primitive-release:0.1.0-draft.1',
    promotedAt: '2026-09-21T12:00:00Z',
    compatibilityTargets: ['github-copilot'],
  }] };
  await writeFile(path.join(privateRoot, 'provenance/agents.lock.json'), JSON.stringify(staleLock));
  await assert.rejects(promoteAgentProjections({ primitiveRoot, privateRoot }), /Agent projection conflicts/);
});
