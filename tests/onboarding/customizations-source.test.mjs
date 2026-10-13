import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validateCapabilitySourceIdentity, validateDistribution } from '../../tools/validate-distribution.mjs';
import { assertPublicationSourceIdentity } from '../../bootstrap/src/promote-agent-projections.mjs';

test('capabilities v2 requires the explicit current name and unchanged repository ID', () => {
  const lock = { schemaVersion: 2, primitiveRepository: 'agentic-delivery-lab/agentic-delivery-agent-customizations', primitiveRepositoryId: 1380894656 };
  assert.deepEqual(validateCapabilitySourceIdentity(lock), []);
  for (const invalid of [ { ...lock, primitiveRepositoryId: 999999 }, { ...lock, primitiveRepositoryId: undefined },
    { ...lock, primitiveRepositoryId: '1380894656' }, { ...lock, primitiveRepository: 'agentic-delivery-lab/agentic-delivery-primitives' },
    { ...lock, schemaVersion: 3 } ]) {
    assert.ok(validateCapabilitySourceIdentity(invalid).length > 0);
  }
});

test('historical v1 retains its old locator without admitting a new-name downgrade', () => {
  const lock = { schemaVersion: 1, primitiveRepository: 'agentic-delivery-lab/agentic-delivery-primitives' };
  assert.deepEqual(validateCapabilitySourceIdentity(lock), []);
  assert.ok(validateCapabilitySourceIdentity({ ...lock, primitiveRepository: 'agentic-delivery-lab/agentic-delivery-agent-customizations' }).length > 0);
  assert.ok(validateCapabilitySourceIdentity({ ...lock, primitiveRepositoryId: 1380894656 }).length > 0);
});

test('projection ownership cannot migrate an unknown or mismatched source identity', () => {
  const lock = { schemaVersion: 2, canonicalRepository: 'agentic-delivery-lab/agentic-delivery-agent-customizations', canonicalRepositoryId: 1380894656,
    agents: [{ sourceRepository: 'agentic-delivery-lab/agentic-delivery-agent-customizations', sourceRepositoryId: 1380894656 }] };
  assert.doesNotThrow(() => assertPublicationSourceIdentity(lock));
  assert.throws(() => assertPublicationSourceIdentity({ ...lock, canonicalRepositoryId: 999999 }), /identity/);
  assert.throws(() => assertPublicationSourceIdentity({ ...lock, agents: [{ ...lock.agents[0], sourceRepositoryId: 999999 }] }), /identity/);
  assert.throws(() => assertPublicationSourceIdentity({ ...lock, schemaVersion: 1 }), /identity/);
  assert.throws(() => assertPublicationSourceIdentity({ ...lock, schemaVersion: 3 }), /identity/);
  assert.doesNotThrow(() => assertPublicationSourceIdentity({ schemaVersion: 1, canonicalRepository: 'agentic-delivery-lab/agentic-delivery-primitives', agents: [] }));
});

test('Distribution rejects disagreement between current-name source locks before admission', async (t) => {
  const root = path.resolve(import.meta.dirname, '../..');
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'distribution-customizations-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await cp(root, fixture, { recursive: true, filter: file => path.relative(root, file).split(path.sep)[0] !== '.git' });
  await assert.doesNotReject(() => validateDistribution(fixture));
  const file = path.join(fixture, 'manifests/sources.lock.json');
  const lock = JSON.parse(await readFile(file, 'utf8'));
  const source = lock.sources.find(source => source.id === 'primitives');
  source.repositoryId = 999999;
  await writeFile(file, JSON.stringify(lock));
  await assert.rejects(validateDistribution(fixture), /same Customizations repository ID/);
  source.repositoryId = 1380894656;
  source.repository = 'agentic-delivery-lab/agentic-delivery-primitives';
  await writeFile(file, JSON.stringify(lock));
  await assert.rejects(validateDistribution(fixture), /same Primitive source/);
});
