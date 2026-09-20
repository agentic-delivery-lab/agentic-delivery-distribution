import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { validateBootstrapManifest } from '../../bootstrap/src/bootstrap.mjs';
import { validateDistribution } from '../../tools/validate-distribution.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('distribution bundle is thin, pinned, and draft until source promotion', async () => {
  const result = await validateDistribution(root);
  assert.deepEqual(result, { files: 2, sources: 2 });
});

test('bootstrap manifest is idempotent-contract input, not a control plane', async () => {
  const manifest = await validateBootstrapManifest(root);
  assert.equal(manifest.controlPlane.repository, 'agentic-delivery-lab/agentic-delivery');
  assert.equal(manifest.files.every((file) => file.mode === 'managed'), true);
});
