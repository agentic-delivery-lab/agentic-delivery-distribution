import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { workflowProjectionErrors } from '../../bootstrap/src/bootstrap-workflow-contract.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const bundle = JSON.parse(await readFile(path.join(root, 'manifests/workflow-bundle.json'), 'utf8'));
const quality = await readFile(path.join(root, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-quality.yml'), 'utf8');
const architecture = await readFile(path.join(root, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-architecture-review.yml'), 'utf8');

test('declared reusable workflow fields match their selected source/runtime pins', () => {
  assert.deepEqual(workflowProjectionErrors(bundle, quality, architecture), []);
});

test('comments cannot conceal a wrong actual quality workflow source pin', () => {
  const wrong = quality.replace(/(uses: [^\n]+@)[0-9a-f]{40}/, '$1' + '0'.repeat(40))
    + `\n# @${bundle.workflowSource.commit}\n`;
  assert.ok(workflowProjectionErrors(bundle, wrong, architecture).length);
});

test('comments cannot conceal a wrong actual controller pin', () => {
  const wrong = quality.replace(/controller_commit: [0-9a-f]{40}/, 'controller_commit: ' + '0'.repeat(40))
    + `\n# controller_commit: ${bundle.controlPlane.commit}\n`;
  assert.ok(workflowProjectionErrors(bundle, wrong, architecture).length);
});

test('comments cannot conceal a wrong actual Architecture workflow source pin', () => {
  const wrong = architecture.replace(/(uses: [^\n]+@)[0-9a-f]{40}/, '$1' + '0'.repeat(40))
    + `\n# @${bundle.workflowSource.commit}\n`;
  assert.ok(workflowProjectionErrors(bundle, quality, wrong).length);
});
