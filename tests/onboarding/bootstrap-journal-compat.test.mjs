import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, lstat, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import * as bootstrap from '../../bootstrap/src/bootstrap.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const historicalCommit = 'd76e00f51861d8fbae4605a4720192c7de8b659f';
const journalRelative = '.agentic-delivery-bootstrap-transaction.json';
const run = promisify(execFile);

async function snapshot(root) {
  const result = {};
  async function visit(relative = '') {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      const key = relative ? `${relative}/${name}` : name;
      const info = await lstat(path.join(root, key));
      assert.ok(info.isDirectory() || info.isFile(), 'Owned fixture contains only directories and regular files');
      result[key] = { directory: info.isDirectory(), mode: info.mode & 0o7777 };
      if (info.isDirectory()) await visit(key);
      else result[key].bytes = (await readFile(path.join(root, key))).toString('base64');
    }
  }
  await visit();
  return result;
}

async function fixture(t) {
  const owned = await mkdtemp(path.join(os.tmpdir(), 'distribution-journal-compat-'));
  t.after(() => rm(owned, { recursive: true, force: true }));
  await chmod(owned, 0o700);
  const historicalRoot = path.join(owned, 'historical-source');
  const sourceB = path.join(owned, 'synthetic-source-b');
  const targetRoot = path.join(owned, 'consumer');
  for (const source of [historicalRoot, sourceB]) {
    await mkdir(path.join(source, 'bootstrap/src'), { recursive: true });
    await cp(path.join(repositoryRoot, 'bootstrap/templates'), path.join(source, 'bootstrap/templates'), { recursive: true });
    await cp(path.join(repositoryRoot, 'manifests'), path.join(source, 'manifests'), { recursive: true });
  }
  // Execute the actual immutable predecessor implementation, not synthetic
  // journal records. This copies two own-project blobs, never a Git checkout.
  for (const relative of ['bootstrap/src/bootstrap.mjs', 'bootstrap/src/bootstrap-transaction.mjs']) {
    const { stdout } = await run('git', ['--no-lazy-fetch', '--no-replace-objects', 'show', `${historicalCommit}:${relative}`], {
      cwd: repositoryRoot, encoding: 'buffer', maxBuffer: 1024 * 1024, timeout: 10_000,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    await writeFile(path.join(historicalRoot, relative), stdout);
  }
  await mkdir(targetRoot);
  await writeFile(path.join(targetRoot, 'AGENTS.md'), 'Original pre-A consumer instructions.\n', { mode: 0o600 });
  await writeFile(path.join(targetRoot, 'unrelated.txt'), 'Preserve unrelated owner data.\n');
  const original = await snapshot(targetRoot);
  const manifestPath = path.join(sourceB, 'manifests/workflow-bundle.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.bundleVersion = '0.1.0-synthetic-compat-b';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const agents = manifest.files.find((entry) => entry.target === 'AGENTS.md');
  await writeFile(path.join(sourceB, agents.source), 'Synthetic B for actual predecessor compatibility.\n');
  const historicalCli = path.join(historicalRoot, 'bootstrap/src/bootstrap.mjs');
  const env = { ...process.env, AGENTIC_DELIVERY_DISTRIBUTION_ROOT: historicalRoot, AGENTIC_DELIVERY_TARGET_ROOT: targetRoot };
  return { targetRoot, sourceB, original, historicalCli, env };
}

async function assertActualLegacyJournal(targetRoot) {
  const bytes = await readFile(path.join(targetRoot, journalRelative));
  const frames = bytes.toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.ok(frames.length > 0);
  for (const frame of frames) {
    assert.equal(frame.schemaVersion, 1);
    assert.equal(Object.hasOwn(frame.payload, 'priorJournalBytes'), false);
    assert.equal(Object.hasOwn(frame.payload, 'consumerLockSha256'), false);
  }
  return bytes;
}

async function installActualPredecessor(state) {
  assert.match((await run(process.execPath, [state.historicalCli, '--apply', '--force'], {
    cwd: state.targetRoot, env: state.env, timeout: 10_000,
  })).stdout, /Applied/);
  await assertActualLegacyJournal(state.targetRoot);
}

test('current update and rollback preserve an actual d76e00f schema-1 journal byte-for-byte', { timeout: 30_000 }, async (t) => {
  const state = await fixture(t);
  await installActualPredecessor(state);
  const installationA = await snapshot(state.targetRoot);
  await bootstrap.applyBootstrap({ distributionRoot: state.sourceB, targetRoot: state.targetRoot, update: true });
  const versions = (await readFile(path.join(state.targetRoot, journalRelative), 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line).schemaVersion);
  assert.ok(versions.includes(1) && versions.includes(2), 'Keep original records and append the explicitly versioned new format');
  await bootstrap.rollbackBootstrap({ targetRoot: state.targetRoot });
  assert.deepEqual(await snapshot(state.targetRoot), installationA, 'Restore the exact historical journal, lock, bytes, modes and layout');
  await assertActualLegacyJournal(state.targetRoot);
  await bootstrap.rollbackBootstrap({ targetRoot: state.targetRoot });
  assert.deepEqual(await snapshot(state.targetRoot), state.original);
});

test('current rollback restores a real d76e00f installation to its pre-A state', { timeout: 30_000 }, async (t) => {
  const state = await fixture(t);
  await installActualPredecessor(state);
  await bootstrap.rollbackBootstrap({ targetRoot: state.targetRoot });
  assert.deepEqual(await snapshot(state.targetRoot), state.original);
});

test('current recovery restores an actual d76e00f process interrupted after its real managed rename', { timeout: 30_000 }, async (t) => {
  const state = await fixture(t);
  const child = spawn(process.execPath, [
    '--import', path.join(repositoryRoot, 'tests/fixtures/bootstrap-pause-after-rename.mjs'),
    state.historicalCli, '--apply', '--force',
  ], {
    cwd: state.targetRoot,
    env: { ...state.env, BOOTSTRAP_TEST_RENAME_TARGET: path.join(state.targetRoot, 'AGENTS.md') },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => { diagnostics = (diagnostics + data).slice(-8192); });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Historical child never reached managed rename: ${diagnostics}`)), 10_000);
      function finish(error) {
        clearTimeout(timer);
        child.off('message', message); child.off('exit', ended); child.off('error', failed);
        if (error) reject(error); else resolve();
      }
      const message = (value) => { if (value?.event === 'managed-file-renamed') finish(); };
      const ended = () => finish(new Error(`Historical child exited before rename: ${diagnostics}`));
      const failed = (error) => finish(error);
      child.on('message', message); child.once('exit', ended); child.once('error', failed);
    });
    assert.notEqual(await readFile(path.join(state.targetRoot, 'AGENTS.md'), 'utf8'), 'Original pre-A consumer instructions.\n');
    await assertActualLegacyJournal(state.targetRoot);
    assert.equal(child.kill('SIGKILL'), true);
    assert.equal((await exited).signal, 'SIGKILL');
    await bootstrap.recoverBootstrap({ targetRoot: state.targetRoot });
    assert.deepEqual(await snapshot(state.targetRoot), state.original);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (child.pid !== undefined) await exited;
  }
});

test('recovery resumes a version-2 restoring record with no recorded legacy lock hash', { timeout: 30_000 }, async (t) => {
  const state = await fixture(t);
  await installActualPredecessor(state);
  // Only this owned fixture discards its first journal to model a pre-journal
  // installation. The actual historical repair then records only changed AGENTS.
  await rm(path.join(state.targetRoot, journalRelative));
  const editedAgents = 'Owner instructions before the historical force repair.\n';
  await writeFile(path.join(state.targetRoot, 'AGENTS.md'), editedAgents);
  const beforeRepair = await snapshot(state.targetRoot);
  await installActualPredecessor(state);
  const legacyFrames = (await assertActualLegacyJournal(state.targetRoot)).toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(legacyFrames.at(-1).payload.entries.map((entry) => entry.path), ['AGENTS.md'], 'Historical no-op lock must not acquire invented journal metadata');

  const child = spawn(process.execPath, [
    '--import', path.join(repositoryRoot, 'tests/fixtures/bootstrap-pause-after-rename.mjs'),
    path.join(repositoryRoot, 'bootstrap/src/bootstrap.mjs'), '--rollback',
  ], {
    cwd: state.targetRoot,
    env: { ...state.env, BOOTSTRAP_TEST_RENAME_TARGET: path.join(state.targetRoot, 'AGENTS.md') },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => { diagnostics = (diagnostics + data).slice(-8192); });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Rollback never reached managed rename: ${diagnostics}`)), 10_000);
      function finish(error) {
        clearTimeout(timer);
        child.off('message', message); child.off('exit', ended); child.off('error', failed);
        if (error) reject(error); else resolve();
      }
      const message = (value) => { if (value?.event === 'managed-file-renamed') finish(); };
      const ended = () => finish(new Error(`Rollback exited before rename: ${diagnostics}`));
      const failed = (error) => finish(error);
      child.on('message', message); child.once('exit', ended); child.once('error', failed);
    });
    assert.equal(await readFile(path.join(state.targetRoot, 'AGENTS.md'), 'utf8'), editedAgents);
    assert.equal(child.kill('SIGKILL'), true);
    assert.equal((await exited).signal, 'SIGKILL');
    const frames = (await readFile(path.join(state.targetRoot, journalRelative), 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line));
    const latest = frames.at(-1);
    assert.equal(latest.schemaVersion, 2);
    assert.equal(latest.payload.status, 'restoring');
    assert.equal(latest.payload.consumerLockSha256, null);
    await bootstrap.recoverBootstrap({ targetRoot: state.targetRoot });
    assert.deepEqual(await snapshot(state.targetRoot), beforeRepair, 'Restore exact pre-repair bytes, modes, lock and absence of a journal');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (child.pid !== undefined) await exited;
  }
});
