// A real temporary file is written/flushed, then the owner kills this child.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
const target = process.env.BOOTSTRAP_TEST_RENAME_TARGET;
if (!target || !path.isAbsolute(target) || typeof process.send !== 'function') throw new Error('Owned temporary-file target and IPC required.');
const open = fs.promises.open;
fs.promises.open = async (...args) => {
  const handle = await open(...args);
  if (String(args[0]).startsWith(`${target}.tmp-`)) {
    const partial = process.env.BOOTSTRAP_TEST_TEMP_PHASE === 'partial-write';
    const method = partial ? 'writeFile' : 'sync';
    const original = handle[method].bind(handle);
    handle[method] = async (...values) => {
      if (partial) {
        const bytes = Buffer.from(values[0]);
        await original(bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2))));
      } else await original(...values);
      setInterval(() => {}, 1_000);
      process.send({ event: partial ? 'managed-temp-partial' : 'managed-temp-flushed' });
      await new Promise(() => {});
    };
  }
  return handle;
};
syncBuiltinESMExports();
