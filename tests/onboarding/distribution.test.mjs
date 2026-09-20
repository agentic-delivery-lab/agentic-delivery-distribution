import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { validateBootstrapManifest } from '../../bootstrap/src/bootstrap.mjs';
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
});

test('consumer workflow delegates only to the secret-free pinned contract workflow', async () => {
  const workflow = await import('node:fs/promises').then(({ readFile }) => readFile(path.join(root, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-quality.yml'), 'utf8'));
  assert.ok(workflow.includes('/.github/workflows/agentic-delivery-quality.yml@6b7b464ba04eab82116e86c41824b61eb355e2c9'));
  assert.ok(workflow.includes('controller_commit: b160ae8826330ce280c41108e9459550c399e8c6'));
  assert.ok(!workflow.includes('secrets:'));
  const architectureWorkflow = await import('node:fs/promises').then(({ readFile }) => readFile(path.join(root, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-architecture-review.yml'), 'utf8'));
  assert.ok(architectureWorkflow.includes('/.github/workflows/agentic-delivery-architecture-review.yml@6b7b464ba04eab82116e86c41824b61eb355e2c9'));
  assert.ok(architectureWorkflow.includes('architecture_commit: 6ba3c1bfd7f2709d5070cb5c8155e2dea984f5b4'));
  assert.ok(architectureWorkflow.includes("affected_identifiers: '[\"urn:agentic-delivery:architecture:authority\"]'"));
});
