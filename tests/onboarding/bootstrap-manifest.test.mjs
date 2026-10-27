import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyBootstrap } from '../../bootstrap/src/bootstrap.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const invalidManifests = [
  ['foreign controller repository', (m) => { m.controlPlane.repository = 'unrelated/controller'; }],
  ['foreign Architecture repository', (m) => { m.architecture.repository = 'unrelated/architecture'; }],
  ['foreign workflow repository', (m) => { m.workflowSource.repository = 'unrelated/workflows'; }],
  ['array controller commit', (m) => { m.controlPlane.commit = [m.controlPlane.commit]; }],
  ['array Architecture commit', (m) => { m.architecture.commit = [m.architecture.commit]; }],
  ['array workflow commit', (m) => { m.workflowSource.commit = [m.workflowSource.commit]; }],
  ['array content digest', (m) => { m.architecture.contentSha256 = [m.architecture.contentSha256]; }],
  ['unknown lifecycle contract', (m) => { m.controlPlane.contracts.lifecycle = '999.0.0'; }],
  ['unknown event contract', (m) => { m.controlPlane.contracts.eventEnvelope = 999; }],
  ['unknown state-machine contract', (m) => { m.controlPlane.contracts.stateMachine = '999.0.0'; }],
  ['additional contract', (m) => { m.controlPlane.contracts.futureContract = '1.0.0'; }],
  ['withdrawn bundle', (m) => { m.status = 'withdrawn'; }],
  ['unknown bundle status', (m) => { m.status = 'unknown'; }],
  ['non-string bundle version', (m) => { m.bundleVersion = ['0.1.0']; }],
  ['empty bundle version', (m) => { m.bundleVersion = ''; }],
  ['non-string affected identifier', (m) => { m.architecture.affectedIdentifiers = [{}]; }],
  ['empty affected identifier', (m) => { m.architecture.affectedIdentifiers = ['']; }],
  ['unsupported file mode', (m) => { m.files[0].mode = 'execute'; }],
  ['unknown manifest property', (m) => { m.futureAuthority = true; }],
  ['unknown source property', (m) => { m.workflowSource.futureAuthority = true; }],
];

for (const [label, mutate] of invalidManifests) {
  test(`bootstrap rejects ${label} before consumer writes, including force`, async (t) => {
    const owned = await mkdtemp(path.join(os.tmpdir(), 'distribution-manifest-'));
    t.after(() => rm(owned, { recursive: true, force: true }));
    const source = path.join(owned, 'source');
    const consumer = path.join(owned, 'consumer');
    await mkdir(source);
    await mkdir(consumer);
    // Synthetic data only: no Git checkout, dependencies or source executable.
    await cp(path.join(root, 'manifests'), path.join(source, 'manifests'), { recursive: true });
    await cp(path.join(root, 'bootstrap/templates'), path.join(source, 'bootstrap/templates'), { recursive: true });
    await writeFile(path.join(consumer, 'AGENTS.md'), 'Owner instructions.\n');
    const manifestPath = path.join(source, 'manifests/workflow-bundle.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    mutate(manifest);
    await writeFile(manifestPath, JSON.stringify(manifest));
    for (const force of [true, false]) {
      await assert.rejects(applyBootstrap({ distributionRoot: source, targetRoot: consumer, force }), /manifest|contract|repository|bundle|identifier|mode/i);
      assert.deepEqual(await readdir(consumer), ['AGENTS.md']);
      assert.equal(await readFile(path.join(consumer, 'AGENTS.md'), 'utf8'), 'Owner instructions.\n');
    }
  });
}
