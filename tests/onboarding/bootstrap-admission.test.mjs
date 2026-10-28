import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyBootstrap } from '../../bootstrap/src/bootstrap.mjs';
import { withProjectionSnapshot } from '../../bootstrap/src/bootstrap-admission.mjs';

for (const force of [false, true]) {
  test(`supported apply rejects missing source admission before writes (force=${force})`, async (t) => {
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-admission-'));
    t.after(() => rm(targetRoot, { recursive: true, force: true }));
    await writeFile(path.join(targetRoot, 'unrelated.txt'), 'Preserve owner bytes.\n');
    await assert.rejects(applyBootstrap({ targetRoot, force }), /source admission/i);
    assert.deepEqual(await readdir(targetRoot), ['unrelated.txt']);
    assert.equal(await readFile(path.join(targetRoot, 'unrelated.txt'), 'utf8'), 'Preserve owner bytes.\n');
  });
}

test('caller booleans and callbacks cannot fabricate source admission', async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-admission-'));
  t.after(() => rm(targetRoot, { recursive: true, force: true }));
  await assert.rejects(applyBootstrap({ targetRoot, force: true,
    verified: true, admitted: true, admission: async () => ({ approved: true }) }), /source admission/i);
  assert.deepEqual(await readdir(targetRoot), []);
});

test('snapshot paths cannot escape to another owned data directory', async (t) => {
  const owned = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-snapshot-boundary-'));
  t.after(() => rm(owned, { recursive: true, force: true }));
  const sentinel = path.join(owned, 'sentinel.txt');
  await writeFile(sentinel, 'Preserve snapshot neighbour.\n');
  await assert.rejects(withProjectionSnapshot([
    { relative: `../${path.basename(owned)}/sentinel.txt`, bytes: Buffer.from('Must not escape.\n') },
  ], async () => assert.fail('invalid snapshot must not reach its operation')), /snapshot path/i);
  assert.equal(await readFile(sentinel, 'utf8'), 'Preserve snapshot neighbour.\n');
});
