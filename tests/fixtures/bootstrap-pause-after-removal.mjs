// Test-only interruption after a real unlink/rmdir, before its caller resumes.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

const target = process.env.BOOTSTRAP_TEST_REMOVE_TARGET;
const kind = process.env.BOOTSTRAP_TEST_REMOVE_KIND;
if (!target || !path.isAbsolute(target) || !['directory', 'journal', 'file'].includes(kind) || typeof process.send !== 'function') throw new Error('Owned removal target, kind and IPC required.');
const method = kind === 'directory' ? 'rmdir' : 'rm';
const remove = fs.promises[method];
fs.promises[method] = async (...args) => {
  const result = await remove(...args);
  if (path.resolve(String(args[0])) === target) {
    setInterval(() => {}, 1_000);
    process.send({ event: `${kind}-removed` });
    await new Promise(() => {});
  }
  return result;
};
syncBuiltinESMExports();
