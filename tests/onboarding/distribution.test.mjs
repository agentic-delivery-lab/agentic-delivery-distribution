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
  assert.equal(plugin.generatedFrom.primitiveSourceCommit, 'b43a4e340c377193342153f2760df495c7b346fc');
  assert.equal(plugin.generatedFrom.architectureCommit, '3690baa97cf0b9b1b188b7adf289e063c3f92004');
});

test('consumer workflow delegates only to the secret-free pinned contract workflow', async () => {
  const workflow = await import('node:fs/promises').then(({ readFile }) => readFile(path.join(root, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-quality.yml'), 'utf8'));
  assert.ok(workflow.includes('/.github/workflows/agentic-delivery-quality.yml@3db6b25f5e7a5eb41ba248f2a1396714d1e19150'));
  assert.ok(workflow.includes('controller_commit: 564a35fd798e75800a3bf15223afb8bd87d59581'));
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
