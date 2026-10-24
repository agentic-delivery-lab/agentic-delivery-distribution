import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { appendFile, chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as bootstrap from '../../bootstrap/src/bootstrap.mjs';

const distributionRoot = path.resolve(import.meta.dirname, '../..');
const lockRelative = '.agentic-delivery/distribution.lock.json';
const journalRelative = '.agentic-delivery-bootstrap-transaction.json';
const originalAgents = Buffer.from([35, 32, 79, 119, 110, 101, 114, 10, 0, 255, 10]);
const unrelatedBytes = Buffer.from('Unrelated consumer-owned file; preserve exactly.\n');

async function fixture(t, { priorLock = false } = {}) {
  const owned = await mkdtemp(path.join(os.tmpdir(), 'distribution-recovery-'));
  const targetRoot = path.join(owned, 'consumer');
  // Registered before initialization; also restores fixture-only denial permissions.
  t.after(async () => {
    await chmod(path.join(targetRoot, '.github/workflows'), 0o755).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await rm(owned, { recursive: true, force: true });
  });
  await mkdir(targetRoot);
  await writeFile(path.join(targetRoot, 'AGENTS.md'), originalAgents);
  await chmod(path.join(targetRoot, 'AGENTS.md'), 0o640);
  await writeFile(path.join(targetRoot, 'unrelated.txt'), unrelatedBytes);
  const manifest = await bootstrap.validateBootstrapManifest(distributionRoot);
  let previousLock = null;
  if (priorLock) {
    const preview = await bootstrap.applyBootstrap({ distributionRoot, targetRoot, force: true, dryRun: true });
    previousLock = Buffer.from(`${JSON.stringify({ ...preview.lock, bundleVersion: '0.0.1' }, null, 4)}\n\n`);
    await mkdir(path.join(targetRoot, '.agentic-delivery'), { recursive: true });
    await writeFile(path.join(targetRoot, lockRelative), previousLock);
    await chmod(path.join(targetRoot, lockRelative), 0o600);
  }
  return { targetRoot, manifest, previousLock };
}

async function assertAbsent(filename) {
  await assert.rejects(lstat(filename), { code: 'ENOENT' });
}

async function assertOriginal({ targetRoot, manifest, previousLock }) {
  assert.deepEqual(await readFile(path.join(targetRoot, 'AGENTS.md')), originalAgents);
  assert.equal((await lstat(path.join(targetRoot, 'AGENTS.md'))).mode & 0o777, 0o640);
  assert.deepEqual(await readFile(path.join(targetRoot, 'unrelated.txt')), unrelatedBytes);
  for (const entry of manifest.files) {
    if (entry.target !== 'AGENTS.md') await assertAbsent(path.join(targetRoot, entry.target));
  }
  if (previousLock === null) await assertAbsent(path.join(targetRoot, lockRelative));
  else {
    assert.deepEqual(await readFile(path.join(targetRoot, lockRelative)), previousLock);
    assert.equal((await lstat(path.join(targetRoot, lockRelative))).mode & 0o777, 0o600);
  }
}

// Include recovery state and file modes: a rejected operation must make no writes.
async function snapshot(directory) {
  const result = {};
  async function visit(current, relative = '') {
    for (const name of (await readdir(current)).sort()) {
      const filename = path.join(current, name);
      const key = relative ? `${relative}/${name}` : name;
      const info = await lstat(filename);
      assert.ok(info.isDirectory() || info.isFile(), 'Fixture tree contains only directories and regular files');
      result[key] = { directory: info.isDirectory(), mode: info.mode & 0o777 };
      if (info.isDirectory()) await visit(filename, key);
      else result[key].bytes = (await readFile(filename)).toString('base64');
    }
  }
  await visit(directory);
  return result;
}

function requiredApi(name) {
  assert.equal(typeof bootstrap[name], 'function', `bootstrap must export ${name}({ targetRoot })`);
  return bootstrap[name];
}

test('unsupported filesystem type rejects bootstrap before changing consumer state', async (t) => {
  const state = await fixture(t);
  const before = await snapshot(state.targetRoot);
  const moduleUrl = pathToFileURL(path.join(distributionRoot, 'bootstrap/src/bootstrap.mjs')).href;
  await assert.rejects(promisify(execFile)(process.execPath, [
    '--import', path.join(distributionRoot, 'tests/fixtures/bootstrap-unsupported-filesystem.mjs'), '--input-type=module', '-e',
    `const b = await import(${JSON.stringify(moduleUrl)}); await b.applyBootstrap(${JSON.stringify({ distributionRoot, targetRoot: state.targetRoot, force: true })});`,
  ], { env: { ...process.env, BOOTSTRAP_TEST_FS_TARGET: state.targetRoot } }), /unsupported.*filesystem|filesystem.*profile/i);
  assert.deepEqual(await snapshot(state.targetRoot), before);
});

test('forced bootstrap rollback restores exact prior bytes, modes, lock and absent managed files', async (t) => {
  const state = await fixture(t, { priorLock: true });
  const before = await snapshot(state.targetRoot);
  await bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true });
  assert.notDeepEqual(await readFile(path.join(state.targetRoot, 'AGENTS.md')), originalAgents);
  await requiredApi('rollbackBootstrap')({ targetRoot: state.targetRoot });
  await assertOriginal(state);
  assert.deepEqual(await snapshot(state.targetRoot), before);
});

test('idempotent second apply retains the first installation rollback baseline', async (t) => {
  const state = await fixture(t, { priorLock: true });
  await bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true });
  const installed = await readFile(path.join(state.targetRoot, lockRelative));
  await bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot });
  assert.deepEqual(await readFile(path.join(state.targetRoot, lockRelative)), installed);
  await requiredApi('rollbackBootstrap')({ targetRoot: state.targetRoot });
  await assertOriginal(state);
});

test('rolling back a changed later installation restores the preceding live rollback journal', async (t) => {
  const state = await fixture(t);
  await bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true });
  const installedA = await snapshot(state.targetRoot);
  const sourceB = path.join(path.dirname(state.targetRoot), 'synthetic-release-B');
  await cp(path.join(distributionRoot, 'bootstrap/templates'), path.join(sourceB, 'bootstrap/templates'), { recursive: true });
  await cp(path.join(distributionRoot, 'manifests'), path.join(sourceB, 'manifests'), { recursive: true });
  const manifestPath = path.join(sourceB, 'manifests/workflow-bundle.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.bundleVersion = '0.1.0-synthetic-B';
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(path.join(sourceB, 'bootstrap/templates/consumer/AGENTS.md'), 'Synthetic second release.\n');
  await bootstrap.applyBootstrap({ distributionRoot: sourceB, targetRoot: state.targetRoot, force: true });
  await requiredApi('rollbackBootstrap')({ targetRoot: state.targetRoot });
  assert.deepEqual(await snapshot(state.targetRoot), installedA);
  await requiredApi('rollbackBootstrap')({ targetRoot: state.targetRoot });
  await assertOriginal(state);
});

test('later filesystem permission failure automatically restores earlier managed changes', {
  skip: process.platform === 'win32' || process.getuid?.() === 0
    ? 'A real POSIX EACCES fixture requires a non-root account' : false,
}, async (t) => {
  const state = await fixture(t);
  const workflows = path.join(state.targetRoot, '.github/workflows');
  await mkdir(workflows, { recursive: true });
  await chmod(workflows, 0o555);
  // Confirm that this host actually enforces the intended failure boundary.
  await assert.rejects(writeFile(path.join(workflows, 'permission-probe'), 'fixture'), { code: 'EACCES' });
  await assert.rejects(bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true }));
  await assertOriginal(state);
});

test('rollback rejects an intervening local edit before changing any file', async (t) => {
  const state = await fixture(t);
  await bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true });
  // Edit a later entry, so a rollback must preflight all entries before restoring AGENTS.
  const later = state.manifest.files.at(-1).target;
  await writeFile(path.join(state.targetRoot, later), 'User edit after bootstrap; do not overwrite.\n');
  const before = await snapshot(state.targetRoot);
  await assert.rejects(requiredApi('rollbackBootstrap')({ targetRoot: state.targetRoot }));
  assert.deepEqual(await snapshot(state.targetRoot), before);
});

test('rollback rejects a later permission change before restoring any earlier file', async (t) => {
  const state = await fixture(t);
  await bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true });
  await chmod(path.join(state.targetRoot, state.manifest.files.at(-1).target), 0o600);
  const before = await snapshot(state.targetRoot);
  await assert.rejects(requiredApi('rollbackBootstrap')({ targetRoot: state.targetRoot }), /local changes/);
  assert.deepEqual(await snapshot(state.targetRoot), before);
});

test('rollback preserves unrelated new files inside bootstrap-created directories', async (t) => {
  const state = await fixture(t);
  await bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true });
  const unrelated = path.join(state.targetRoot, '.github/workflows/user-owned.yml');
  await writeFile(unrelated, unrelatedBytes);
  await requiredApi('rollbackBootstrap')({ targetRoot: state.targetRoot });
  await assertOriginal(state);
  assert.deepEqual(await readFile(unrelated), unrelatedBytes);
});

test('rollback holds when created parent directories have been replaced', async (t) => {
  const state = await fixture(t);
  await bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true });
  const originalDirectory = path.join(path.dirname(state.targetRoot), 'retained-original-github');
  await rename(path.join(state.targetRoot, '.github'), originalDirectory);
  await cp(originalDirectory, path.join(state.targetRoot, '.github'), { recursive: true });
  const before = await snapshot(state.targetRoot);
  await assert.rejects(requiredApi('rollbackBootstrap')({ targetRoot: state.targetRoot }), /directory|ownership|identity/);
  assert.deepEqual(await snapshot(state.targetRoot), before);
  assert.ok((await lstat(originalDirectory)).isDirectory());
});

test('recovery refuses to undo a successfully committed installation', async (t) => {
  const state = await fixture(t);
  await bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true });
  assert.equal((await lstat(path.join(state.targetRoot, journalRelative))).mode & 0o077, 0);
  const before = await snapshot(state.targetRoot);
  await assert.rejects(requiredApi('recoverBootstrap')({ targetRoot: state.targetRoot }), /committed|rollback/);
  assert.deepEqual(await snapshot(state.targetRoot), before);
});

test('corrupt recovery journal holds normal apply and explicit recovery without writes', async (t) => {
  const state = await fixture(t);
  await mkdir(path.join(state.targetRoot, '.agentic-delivery'), { recursive: true });
  await writeFile(path.join(state.targetRoot, journalRelative), '{invalid interrupted journal\n');
  await chmod(path.join(state.targetRoot, journalRelative), 0o600);
  const before = await snapshot(state.targetRoot);
  await assert.rejects(bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true }));
  assert.deepEqual(await snapshot(state.targetRoot), before);
  await assert.rejects(requiredApi('recoverBootstrap')({ targetRoot: state.targetRoot }));
  assert.deepEqual(await snapshot(state.targetRoot), before);
});

test('a corrupt complete appended record holds rollback without changing consumer state', async (t) => {
  const state = await fixture(t);
  await bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true });
  await appendFile(path.join(state.targetRoot, journalRelative), '{"invalid":"complete record"}\n');
  const before = await snapshot(state.targetRoot);
  await assert.rejects(requiredApi('rollbackBootstrap')({ targetRoot: state.targetRoot }), /journal/);
  assert.deepEqual(await snapshot(state.targetRoot), before);
});

for (const { operation, pause } of [
  { operation: 'applyBootstrap', pause: 'rename' },
  { operation: 'applyBootstrap', pause: 'temp-flush' },
  { operation: 'applyBootstrap', pause: 'partial-write' },
  { operation: 'applyBootstrap', pause: 'journal-append' },
  { operation: 'rollbackBootstrap', pause: 'rename' },
  { operation: 'rollbackBootstrap', pause: 'temp-flush' },
  { operation: 'rollbackBootstrap', pause: 'partial-write' },
  { operation: 'rollbackBootstrap', pause: 'directory-removal' },
  { operation: 'rollbackBootstrap', pause: 'journal-removal' },
]) {
test(`SIGKILL during ${operation} at ${pause} preserves recoverable or completed prior state`, {
  skip: process.platform === 'win32' ? 'This fixture requires POSIX SIGKILL semantics' : false,
  timeout: 20_000,
}, async (t) => {
  const state = await fixture(t, { priorLock: true });
  const priorState = await snapshot(state.targetRoot);
  if (operation === 'rollbackBootstrap') await bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true });
  const moduleUrl = pathToFileURL(path.join(distributionRoot, 'bootstrap/src/bootstrap.mjs')).href;
  const fixtureName = ['temp-flush', 'partial-write'].includes(pause) ? 'temp-flush' : pause === 'rename' ? 'rename' : 'removal';
  const preload = path.join(distributionRoot, pause === 'journal-append' ? 'tests/fixtures/bootstrap-pause-during-journal-append.mjs' : `tests/fixtures/bootstrap-pause-after-${fixtureName}.mjs`);
  const args = operation === 'applyBootstrap' ? { distributionRoot, targetRoot: state.targetRoot, force: true } : { targetRoot: state.targetRoot };
  const child = spawn(process.execPath, ['--import', preload, '--input-type=module', '-e',
    `const bootstrap = await import(${JSON.stringify(moduleUrl)}); await bootstrap[${JSON.stringify(operation)}](${JSON.stringify(args)});`], {
    env: { ...process.env, BOOTSTRAP_TEST_RENAME_TARGET: path.join(state.targetRoot, 'AGENTS.md'),
      BOOTSTRAP_TEST_REMOVE_TARGET: path.join(state.targetRoot, pause === 'directory-removal' ? '.github/workflows' : journalRelative),
      BOOTSTRAP_TEST_TEMP_PHASE: pause,
      BOOTSTRAP_TEST_JOURNAL_TARGET: path.join(state.targetRoot, journalRelative),
      BOOTSTRAP_TEST_REMOVE_KIND: pause === 'directory-removal' ? 'directory' : 'journal' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => { diagnostics = (diagnostics + data).slice(-8_192); });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No managed rename was observed: ${diagnostics}`)), 8_000);
      const finish = (error) => {
        clearTimeout(timer);
        child.off('message', message);
        child.off('error', failed);
        child.off('exit', ended);
        if (error) reject(error); else resolve();
      };
      const message = (value) => {
        if (value?.event === ({ rename: 'managed-file-renamed', 'temp-flush': 'managed-temp-flushed', 'partial-write': 'managed-temp-partial', 'journal-append': 'journal-append-partial', 'directory-removal': 'directory-removed', 'journal-removal': 'journal-removed' })[pause]) finish();
      };
      const failed = (error) => finish(error);
      const ended = () => finish(new Error(`Child exited before the interruption boundary: ${diagnostics}`));
      child.on('message', message);
      child.once('error', failed);
      child.once('exit', ended);
    });
    const beforeRename = ['temp-flush', 'partial-write'].includes(pause);
    const expectOriginal = operation === 'applyBootstrap' ? beforeRename : !beforeRename;
    if (expectOriginal) assert.deepEqual(await readFile(path.join(state.targetRoot, 'AGENTS.md')), originalAgents);
    else assert.notDeepEqual(await readFile(path.join(state.targetRoot, 'AGENTS.md')), originalAgents);
    assert.equal(child.kill('SIGKILL'), true);
    assert.equal((await exited).signal, 'SIGKILL');
    if (pause === 'journal-removal') {
      await assertOriginal(state);
      await requiredApi('recoverBootstrap')({ targetRoot: state.targetRoot });
      assert.deepEqual(await snapshot(state.targetRoot), priorState);
      return;
    }
    // Durability must precede the managed rename, not follow successful apply.
    assert.ok((await readFile(path.join(state.targetRoot, journalRelative))).length > 0);
    const interrupted = await snapshot(state.targetRoot);
    await assert.rejects(bootstrap.applyBootstrap({ distributionRoot, targetRoot: state.targetRoot, force: true }));
    assert.deepEqual(await snapshot(state.targetRoot), interrupted);
    await requiredApi('recoverBootstrap')({ targetRoot: state.targetRoot });
    await assertOriginal(state);
    assert.deepEqual(await snapshot(state.targetRoot), priorState);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (child.pid !== undefined) await exited;
  }
});
}
