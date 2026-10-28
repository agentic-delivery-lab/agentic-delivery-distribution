// Projection/transaction tests use the mechanics layer, not source admission.
import assert from 'node:assert/strict';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyBootstrap, bootstrapPlan } from '../../bootstrap/src/bootstrap-projection.mjs';

const distributionRoot = path.resolve(import.meta.dirname, '../..');

async function fixture(t) {
  const owned = await mkdtemp(path.join(os.tmpdir(), 'distribution-path-boundary-'));
  t.after(() => rm(owned, { recursive: true, force: true }));
  const consumer = path.join(owned, 'consumer');
  const outside = path.join(owned, 'outside');
  await mkdir(consumer);
  await mkdir(outside);
  return { owned, consumer, outside };
}

test('rejects a symbolic-link parent before any consumer file is installed', async (t) => {
  const { consumer, outside } = await fixture(t);
  await symlink(outside, path.join(consumer, '.github'), 'dir');
  await assert.rejects(applyBootstrap({ targetRoot: consumer }), /symbolic-link|directory boundary/i);
  await assert.rejects(lstat(path.join(consumer, 'AGENTS.md')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(outside, 'workflows')), { code: 'ENOENT' });
});

test('rejects a symbolic-link provenance directory before consumer writes', async (t) => {
  const { consumer, outside } = await fixture(t);
  await symlink(outside, path.join(consumer, '.agentic-delivery'), 'dir');
  await assert.rejects(applyBootstrap({ targetRoot: consumer }), /symbolic-link|directory boundary/i);
  await assert.rejects(lstat(path.join(consumer, 'AGENTS.md')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(outside, 'distribution.lock.json')), { code: 'ENOENT' });
});

test('rejects a symbolic-link source ancestor without reading redirected content', async (t) => {
  const { owned, consumer, outside } = await fixture(t);
  const source = path.join(owned, 'source');
  await mkdir(source);
  await cp(path.join(distributionRoot, 'manifests'), path.join(source, 'manifests'), { recursive: true });
  await mkdir(path.join(source, 'bootstrap'));
  await cp(path.join(distributionRoot, 'bootstrap/templates'), outside, { recursive: true });
  await symlink(outside, path.join(source, 'bootstrap/templates'), 'dir');
  await assert.rejects(bootstrapPlan({ distributionRoot: source, targetRoot: consumer }), /symbolic-link|directory boundary/i);
});

test('rejects a redirected manifest directory', async (t) => {
  const { owned, consumer, outside } = await fixture(t);
  const source = path.join(owned, 'source');
  await mkdir(source);
  await cp(path.join(distributionRoot, 'manifests'), outside, { recursive: true });
  await symlink(outside, path.join(source, 'manifests'), 'dir');
  await assert.rejects(bootstrapPlan({ distributionRoot: source, targetRoot: consumer }), /symbolic-link|directory boundary/i);
});

test('rejects aliased or duplicate targets and provenance-lock collisions before writes', async (t) => {
  const { owned, consumer } = await fixture(t);
  const source = path.join(owned, 'source');
  await cp(path.join(distributionRoot, 'bootstrap'), path.join(source, 'bootstrap'), { recursive: true });
  await cp(path.join(distributionRoot, 'manifests'), path.join(source, 'manifests'), { recursive: true });
  const manifestPath = path.join(source, 'manifests/workflow-bundle.json');
  const original = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const target of ['agents.md', '.AGENTIC-DELIVERY/DISTRIBUTION.LOCK.JSON', 'AGENTS.md', './AGENTS.md', 'nested//AGENTS.md', '.agentic-delivery/distribution.lock.json', 'AGENTS.md/child', 'AGENTS.md.', 'nested/CON.txt', 'nested/é.txt']) {
    const manifest = structuredClone(original);
    manifest.files.push({ ...manifest.files[0], target });
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(applyBootstrap({ distributionRoot: source, targetRoot: consumer }), /path|target|overlap/i);
    await assert.rejects(lstat(path.join(consumer, 'AGENTS.md')), { code: 'ENOENT' });
  }
});
