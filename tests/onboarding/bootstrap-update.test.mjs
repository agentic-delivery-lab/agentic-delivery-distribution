// Projection/transaction tests use the mechanics layer, not source admission.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import * as bootstrap from '../../bootstrap/src/bootstrap-projection.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const lockPath = '.agentic-delivery/distribution.lock.json';
const journalPath = '.agentic-delivery-bootstrap-transaction.json';
const originalBytes = Buffer.from('Original consumer instructions.\n');

// These are synthetic source bundles, not admitted release identities. Copy no
// checkout metadata, dependencies, executable bootstrap code or other sources.
async function copyBundle(destination) {
  await mkdir(path.join(destination, 'bootstrap'), { recursive: true });
  await cp(path.join(repositoryRoot, 'bootstrap/templates'), path.join(destination, 'bootstrap/templates'), { recursive: true });
  await cp(path.join(repositoryRoot, 'manifests'), path.join(destination, 'manifests'), { recursive: true });
}

async function snapshot(root) {
  const result = {};
  async function visit(relative = '') {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      const key = relative ? `${relative}/${name}` : name;
      const info = await lstat(path.join(root, key));
      assert.ok(info.isDirectory() || info.isFile(), 'Only fixture directories and regular files are expected');
      result[key] = { directory: info.isDirectory(), mode: info.mode & 0o7777 };
      if (info.isDirectory()) await visit(key);
      else result[key].bytes = (await readFile(path.join(root, key))).toString('base64');
    }
  }
  await visit();
  return result;
}

async function fixture(t, { install = true } = {}) {
  const owned = await mkdtemp(path.join(os.tmpdir(), 'distribution-update-'));
  t.after(() => rm(owned, { recursive: true, force: true }));
  const sourceA = path.join(owned, 'source-a');
  const sourceB = path.join(owned, 'source-b');
  const targetRoot = path.join(owned, 'consumer');
  await copyBundle(sourceA);
  await copyBundle(sourceB);
  await mkdir(targetRoot);
  await writeFile(path.join(targetRoot, 'AGENTS.md'), originalBytes, { mode: 0o600 });
  await writeFile(path.join(targetRoot, 'unrelated.txt'), 'Unrelated owner data.\n');
  const original = await snapshot(targetRoot);
  if (install) await bootstrap.applyBootstrap({ distributionRoot: sourceA, targetRoot, force: true });
  const manifest = JSON.parse(await readFile(path.join(sourceB, 'manifests/workflow-bundle.json'), 'utf8'));
  const retired = manifest.files.pop();
  const agents = manifest.files.find((file) => file.target === 'AGENTS.md');
  const nextAgents = Buffer.from('Synthetic update B consumer instructions.\n');
  await writeFile(path.join(sourceB, agents.source), nextAgents);
  const added = { source: 'bootstrap/templates/consumer/.github/workflows/synthetic-added.yml', target: '.github/workflows/synthetic-added.yml', mode: 'managed' };
  const addedBytes = Buffer.from('# Synthetic update fixture only\nname: synthetic-added\n');
  await writeFile(path.join(sourceB, added.source), addedBytes);
  manifest.files.push(added);
  manifest.bundleVersion = '0.1.0-test-update-b';
  await writeFile(path.join(sourceB, 'manifests/workflow-bundle.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { sourceA, sourceB, targetRoot, original, manifest, retired, added, addedBytes, nextAgents };
}

async function rejectWithoutWrites(state, options = {}) {
  const before = await snapshot(state.targetRoot);
  await assert.rejects(bootstrap.applyBootstrap({ distributionRoot: state.sourceB, targetRoot: state.targetRoot, update: true, ...options }));
  assert.deepEqual(await snapshot(state.targetRoot), before, 'Rejected update must preserve the complete consumer tree and journal');
}

test('managed update replaces clean owned files, retires clean paths and preserves permissions and unrelated data', async (t) => {
  const state = await fixture(t);
  await chmod(path.join(state.targetRoot, 'AGENTS.md'), 0o640);
  const result = await bootstrap.applyBootstrap({ distributionRoot: state.sourceB, targetRoot: state.targetRoot, update: true });
  assert.equal(result.applied, true);
  assert.deepEqual(await readFile(path.join(state.targetRoot, 'AGENTS.md')), state.nextAgents);
  assert.equal((await lstat(path.join(state.targetRoot, 'AGENTS.md'))).mode & 0o777, 0o640);
  assert.deepEqual(await readFile(path.join(state.targetRoot, state.added.target)), state.addedBytes);
  await assert.rejects(lstat(path.join(state.targetRoot, state.retired.target)), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(state.targetRoot, 'unrelated.txt'), 'utf8'), 'Unrelated owner data.\n');
  const lock = JSON.parse(await readFile(path.join(state.targetRoot, lockPath), 'utf8'));
  assert.equal(lock.bundleVersion, state.manifest.bundleVersion);
  assert.deepEqual(lock.files.map((file) => file.target).sort(), state.manifest.files.map((file) => file.target).sort());
});

test('update dry-run classifies replacement and retirement without writes', async (t) => {
  const state = await fixture(t);
  const before = await snapshot(state.targetRoot);
  const plan = await bootstrap.applyBootstrap({ distributionRoot: state.sourceB, targetRoot: state.targetRoot, update: true, dryRun: true });
  assert.equal(plan.applied, false);
  assert.equal(plan.entries.find((entry) => entry.target === 'AGENTS.md')?.action, 'update');
  assert.equal(plan.entries.find((entry) => entry.target === state.retired.target)?.action, 'remove');
  assert.equal(plan.entries.find((entry) => entry.target === state.added.target)?.action, 'create');
  assert.deepEqual(await snapshot(state.targetRoot), before);
});

test('update rollback restores the exact prior installation and journal, retaining its own rollback baseline', async (t) => {
  const state = await fixture(t);
  const installationA = await snapshot(state.targetRoot);
  assert.ok(installationA[journalPath]?.bytes, 'Initial installation must retain a live rollback journal');
  await bootstrap.applyBootstrap({ distributionRoot: state.sourceB, targetRoot: state.targetRoot, update: true });
  await bootstrap.rollbackBootstrap({ targetRoot: state.targetRoot });
  assert.deepEqual(await snapshot(state.targetRoot), installationA, 'Rollback B must restore exact A bytes, modes, directories, lock and journal');
  await bootstrap.rollbackBootstrap({ targetRoot: state.targetRoot });
  assert.deepEqual(await snapshot(state.targetRoot), state.original, 'Restored A journal must still restore the original pre-installation state');
});

test('update requires a prior consumer lock even when proposed files would be unchanged', async (t) => {
  const state = await fixture(t);
  await rm(path.join(state.targetRoot, lockPath));
  await rejectWithoutWrites(state, { distributionRoot: state.sourceA });
});

test('update and force cannot be combined', async (t) => {
  const state = await fixture(t);
  await rejectWithoutWrites(state, { force: true });
});

test('an edited valid-looking prior lock cannot claim and retire unrelated consumer data', async (t) => {
  const state = await fixture(t);
  const filename = path.join(state.targetRoot, lockPath);
  const lock = JSON.parse(await readFile(filename, 'utf8'));
  lock.files.push({ source: 'bootstrap/templates/consumer/unrelated.txt', target: 'unrelated.txt', mode: 'managed',
    sourceSha256: createHash('sha256').update(await readFile(path.join(state.targetRoot, 'unrelated.txt'))).digest('hex') });
  await writeFile(filename, JSON.stringify(lock));
  await rejectWithoutWrites(state);
});

test('legacy ownership locks without journals update and roll back without inventing older history', async (t) => {
  const state = await fixture(t);
  // Model the old published bootstrap's v1 lock; it never retained a journal.
  await rm(path.join(state.targetRoot, journalPath));
  const legacyA = await snapshot(state.targetRoot);
  await bootstrap.applyBootstrap({ distributionRoot: state.sourceB, targetRoot: state.targetRoot, update: true });
  await bootstrap.rollbackBootstrap({ targetRoot: state.targetRoot });
  assert.deepEqual(await snapshot(state.targetRoot), legacyA);
  await assert.rejects(bootstrap.rollbackBootstrap({ targetRoot: state.targetRoot }), /No bootstrap rollback journal/);
});

for (const change of ['edited retained', 'missing retained', 'edited retired', 'missing retired']) {
  test(`update rejects ${change} prior-owned path without writes`, async (t) => {
    const state = await fixture(t);
    const target = change.endsWith('retired') ? state.retired.target : 'AGENTS.md';
    if (change.startsWith('missing')) await rm(path.join(state.targetRoot, target));
    else await writeFile(path.join(state.targetRoot, target), 'Intervening owner edit.\n');
    await rejectWithoutWrites(state);
  });
}

for (const matching of [false, true]) {
  test(`update rejects an unowned new-path collision with ${matching ? 'matching' : 'different'} proposed bytes`, async (t) => {
    const state = await fixture(t);
    await writeFile(path.join(state.targetRoot, state.added.target), matching ? state.addedBytes : 'Unowned consumer content.\n');
    await rejectWithoutWrites(state);
  });
}

for (const corruption of ['invalid JSON', 'unsupported schema', 'invalid hash', 'unsafe path', 'case alias', 'duplicate path', 'overlapping path', 'foreign repository', 'array commit', 'invalid architecture digest', 'unknown root property']) {
  test(`update rejects prior lock with ${corruption} without writes`, async (t) => {
    const state = await fixture(t);
    const filename = path.join(state.targetRoot, lockPath);
    const lock = JSON.parse(await readFile(filename, 'utf8'));
    if (corruption === 'unsupported schema') lock.schemaVersion = 999;
    if (corruption === 'invalid hash') lock.files[0].sourceSha256 = 'not-a-sha256';
    if (corruption === 'unsafe path') lock.files[0].target = '../outside.txt';
    if (corruption === 'case alias') lock.files.push({ ...lock.files[0], target: 'agents.md' });
    if (corruption === 'duplicate path') lock.files.push({ ...lock.files[0] });
    if (corruption === 'overlapping path') lock.files.push({ ...lock.files[0], target: 'AGENTS.md/nested' });
    if (corruption === 'foreign repository') lock.controlPlane.repository = 'unrelated/foreign';
    if (corruption === 'array commit') lock.controlPlane.commit = [lock.controlPlane.commit];
    if (corruption === 'invalid architecture digest') lock.architecture.contentSha256 = 'invalid';
    if (corruption === 'unknown root property') lock.unrecognizedOwnership = true;
    await writeFile(filename, corruption === 'invalid JSON' ? '{invalid\n' : `${JSON.stringify(lock, null, 2)}\n`);
    await rejectWithoutWrites(state, { distributionRoot: state.sourceA });
  });
}

test('CLI plans a managed update but refuses apply without source admission', async (t) => {
  const state = await fixture(t);
  const run = promisify(execFile);
  const command = (args) => run(process.execPath, [path.join(repositoryRoot, 'bootstrap/src/bootstrap.mjs'), ...args], {
    cwd: state.targetRoot,
    timeout: 10_000,
    env: { ...process.env, AGENTIC_DELIVERY_TARGET_ROOT: state.targetRoot, AGENTIC_DELIVERY_DISTRIBUTION_ROOT: state.sourceB },
  });
  const before = await snapshot(state.targetRoot);
  assert.match((await command(['--plan', '--update'])).stdout, /Planned/);
  assert.deepEqual(await snapshot(state.targetRoot), before);
  await assert.rejects(command(['--apply', '--update']), /source admission/i);
  assert.deepEqual(await snapshot(state.targetRoot), before);
  await bootstrap.applyBootstrap({ distributionRoot: state.sourceB, targetRoot: state.targetRoot, update: true });
  assert.deepEqual(await readFile(path.join(state.targetRoot, 'AGENTS.md')), state.nextAgents);
  await assert.rejects(lstat(path.join(state.targetRoot, state.retired.target)), { code: 'ENOENT' });
  await bootstrap.rollbackBootstrap({ targetRoot: state.targetRoot });
  assert.deepEqual(await snapshot(state.targetRoot), before);
});

async function killAfterBoundary({ fixtureName, event, env, operation, options }) {
  const moduleUrl = pathToFileURL(path.join(repositoryRoot, 'bootstrap/src/bootstrap-projection.mjs')).href;
  const child = spawn(process.execPath, ['--import', path.join(repositoryRoot, 'tests/fixtures', fixtureName), '--input-type=module', '-e',
    `const b = await import(${JSON.stringify(moduleUrl)}); await b[${JSON.stringify(operation)}](${JSON.stringify(options)});`], {
    env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => { diagnostics = (diagnostics + data).slice(-8192); });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`No interruption boundary: ${diagnostics}`)), 10_000);
      function finish(error) {
        clearTimeout(timer); child.off('message', message); child.off('exit', ended); child.off('error', failed);
        if (error) reject(error); else resolve();
      }
      const message = (value) => { if (value?.event === event) finish(); };
      const ended = () => finish(new Error(`Child exited before boundary: ${diagnostics}`));
      const failed = (error) => finish(error);
      child.on('message', message); child.once('exit', ended); child.once('error', failed);
    });
    assert.equal(child.kill('SIGKILL'), true);
    assert.equal((await exited).signal, 'SIGKILL');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (child.pid !== undefined) await exited;
  }
}

test('interrupted update after real retirement recovers exact A and its live rollback baseline', { timeout: 20_000 }, async (t) => {
  const state = await fixture(t);
  const installationA = await snapshot(state.targetRoot);
  await killAfterBoundary({
    fixtureName: 'bootstrap-pause-after-removal.mjs', event: 'file-removed', operation: 'applyBootstrap',
    env: { BOOTSTRAP_TEST_REMOVE_TARGET: path.join(state.targetRoot, state.retired.target), BOOTSTRAP_TEST_REMOVE_KIND: 'file' },
    options: { distributionRoot: state.sourceB, targetRoot: state.targetRoot, update: true },
  });
  await assert.rejects(lstat(path.join(state.targetRoot, state.retired.target)), { code: 'ENOENT' });
  await bootstrap.recoverBootstrap({ targetRoot: state.targetRoot });
  assert.deepEqual(await snapshot(state.targetRoot), installationA);
  await bootstrap.rollbackBootstrap({ targetRoot: state.targetRoot });
  assert.deepEqual(await snapshot(state.targetRoot), state.original);
});

test('SIGKILL after final journal shrink leaves exact A and its original rollback usable', { timeout: 20_000 }, async (t) => {
  const state = await fixture(t);
  const installationA = await snapshot(state.targetRoot);
  await bootstrap.applyBootstrap({ distributionRoot: state.sourceB, targetRoot: state.targetRoot, update: true });
  await killAfterBoundary({
    fixtureName: 'bootstrap-pause-after-journal-truncate.mjs', event: 'prior-journal-restored', operation: 'rollbackBootstrap',
    env: { BOOTSTRAP_TEST_JOURNAL_TARGET: path.join(state.targetRoot, journalPath) }, options: { targetRoot: state.targetRoot },
  });
  assert.deepEqual(await snapshot(state.targetRoot), installationA);
  await assert.rejects(bootstrap.recoverBootstrap({ targetRoot: state.targetRoot }), /committed|rollback/);
  assert.deepEqual(await snapshot(state.targetRoot), installationA);
  await bootstrap.rollbackBootstrap({ targetRoot: state.targetRoot });
  assert.deepEqual(await snapshot(state.targetRoot), state.original);
});
