// Interrupt a real partial commit-record append after all managed writes.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
const target = process.env.BOOTSTRAP_TEST_JOURNAL_TARGET;
if (!target || !path.isAbsolute(target) || typeof process.send !== 'function') throw new Error('Owned journal target and IPC required.');
const open = fs.promises.open;
fs.promises.open = async (...args) => {
  const handle = await open(...args);
  if (path.resolve(String(args[0])) === target) {
    const write = handle.writeFile.bind(handle);
    handle.writeFile = async (data, ...rest) => {
      const bytes = Buffer.from(data);
      if (JSON.parse(bytes.toString('utf8')).payload.status === 'committed') {
        await write(bytes.subarray(0, Math.floor(bytes.length / 2)));
        setInterval(() => {}, 1_000);
        process.send({ event: 'journal-append-partial' });
        await new Promise(() => {});
      }
      return write(data, ...rest);
    };
  }
  return handle;
};
syncBuiltinESMExports();
