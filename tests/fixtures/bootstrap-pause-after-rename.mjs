// Test-only process interruption boundary: production still performs the rename.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

const target = process.env.BOOTSTRAP_TEST_RENAME_TARGET;
if (!target || !path.isAbsolute(target) || typeof process.send !== 'function') {
  throw new Error('The interruption fixture requires its owned absolute target and IPC channel.');
}

const rename = fs.promises.rename;
let paused = false;
fs.promises.rename = async (...args) => {
  const result = await rename(...args);
  if (!paused && path.resolve(String(args[1])) === target) {
    paused = true;
    // Retain the process until the owning test kills it; no timer-based race.
    const hold = setInterval(() => {}, 1_000);
    process.send({ event: 'managed-file-renamed', target });
    await new Promise(() => {});
    clearInterval(hold);
  }
  return result;
};
syncBuiltinESMExports();
