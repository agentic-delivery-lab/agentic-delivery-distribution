import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const run = promisify(execFile);

async function fixture(t) {
  const target = await mkdtemp(path.join(os.tmpdir(), 'distribution-cli-'));
  t.after(() => rm(target, { recursive: true, force: true }));
  await writeFile(path.join(target, 'AGENTS.md'), 'Original consumer instructions.\n');
  await chmod(path.join(target, 'AGENTS.md'), 0o600);
  return {
    target,
    command: (args, source = root) => run(process.execPath, [path.join(root, 'bootstrap/src/bootstrap.mjs'), ...args], {
      cwd: target,
      env: { ...process.env, AGENTIC_DELIVERY_TARGET_ROOT: target, AGENTIC_DELIVERY_DISTRIBUTION_ROOT: source },
    }),
  };
}

test('existing bootstrap CLI rolls back without requiring the Distribution checkout as an input', async (t) => {
  const { target, command } = await fixture(t);
  assert.match((await command(['--apply', '--force'])).stdout, /Applied/);
  assert.match((await command(['--rollback'], path.join(target, 'absent-source'))).stdout, /Restored/);
  assert.equal(await readFile(path.join(target, 'AGENTS.md'), 'utf8'), 'Original consumer instructions.\n');
  assert.equal((await lstat(path.join(target, 'AGENTS.md'))).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(target), ['AGENTS.md']);
  assert.match((await command(['--recover'], path.join(target, 'absent-source'))).stdout, /No interrupted bootstrap/);
});

test('CLI refuses mixed or forced restoration modes before any consumer changes', async (t) => {
  const { target, command } = await fixture(t);
  await mkdir(path.join(target, 'unrelated'));
  for (const args of [['--rollback', '--force'], ['--recover', '--apply'], ['--recover', '--rollback']]) {
    await assert.rejects(command(args), /exactly one|cannot use force/);
    assert.deepEqual((await readdir(target)).sort(), ['AGENTS.md', 'unrelated']);
    assert.equal(await readFile(path.join(target, 'AGENTS.md'), 'utf8'), 'Original consumer instructions.\n');
  }
});
