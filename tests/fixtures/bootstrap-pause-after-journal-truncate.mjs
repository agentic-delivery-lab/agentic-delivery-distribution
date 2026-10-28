// Pause after the real final shrink restores a previous committed journal.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
const target = process.env.BOOTSTRAP_TEST_JOURNAL_TARGET;
if (!target || !path.isAbsolute(target) || typeof process.send !== 'function') throw new Error('Owned journal target and IPC required.');
const open = fs.promises.open;
fs.promises.open = async (...args) => {
  const handle = await open(...args);
  if (path.resolve(String(args[0])) === target) {
    const truncate = handle.truncate.bind(handle);
    handle.truncate = async (length) => {
      const previous = (await handle.stat()).size;
      const result = await truncate(length);
      if (length > 0 && length < previous) {
        setInterval(() => {}, 1_000);
        process.send({ event: 'prior-journal-restored' });
        await new Promise(() => {});
      }
      return result;
    };
  }
  return handle;
};
syncBuiltinESMExports();
