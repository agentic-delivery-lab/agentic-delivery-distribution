// Simulate only the reported filesystem type; production still runs statfs.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
const target = process.env.BOOTSTRAP_TEST_FS_TARGET;
if (!target || !path.isAbsolute(target)) throw new Error('Owned filesystem fixture target required.');
const statfs = fs.promises.statfs;
fs.promises.statfs = async (...args) => {
  const result = await statfs(...args);
  if (path.resolve(String(args[0])) === target) result.type = 0x6969; // Linux NFS_SUPER_MAGIC.
  return result;
};
syncBuiltinESMExports();
