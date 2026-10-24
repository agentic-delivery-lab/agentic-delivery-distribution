import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rm, rmdir, statfs } from 'node:fs/promises';
import path from 'node:path';

// The existing consumer root survives restoration. A journal inside a newly
// created directory could not outlive that directory's cleanup.
export const JOURNAL_PATH = '.agentic-delivery-bootstrap-transaction.json';
const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
// Linux UAPI magic.h: ext2/3/4, Btrfs, XFS, tmpfs and overlayfs.
const LOCAL_FILESYSTEM_TYPES = new Set([0xef53, 0x9123683e, 0x58465342, 0x01021994, 0x794c7630]);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const VALID_BYTES = Symbol('complete journal prefix');
const OBSERVED_BYTES = Symbol('observed journal size');

async function rootIdentity(root) {
  const info = await lstat(root, { bigint: true });
  return { device: String(info.dev), inode: String(info.ino) };
}

async function directoryIdentity(root, relative, io) {
  const boundary = await io.resolveFilePath(root, `${relative}/.boundary-check`, 'owned directory');
  try { return await rootIdentity(path.dirname(boundary)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function snapshot(root, relative, io) {
  const filename = await io.resolveFilePath(root, relative, 'transaction path');
  // Check the actual target/nearest existing ancestor, including child mounts.
  for (let existing = filename; ; existing = path.dirname(existing)) {
    try {
      const filesystem = await statfs(existing);
      if (!LOCAL_FILESYSTEM_TYPES.has(Number(filesystem.type))) throw new Error('Unsupported bootstrap filesystem profile.');
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.uid !== process.getuid()) {
      throw new Error(`Transaction path must be an owned regular file: ${relative}`);
    }
    if (info.size > MAX_JOURNAL_BYTES) throw new Error('Transaction file exceeds the supported size bound.');
    const bytes = await readFile(filename);
    return { content: bytes.toString('base64'), mode: info.mode & 0o7777, sha256: hash(bytes) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function validSnapshot(value) {
  if (value === null) return true;
  if (!value || Object.keys(value).sort().join() !== 'content,mode,sha256'
    || typeof value.content !== 'string' || !Number.isInteger(value.mode) || value.mode < 0 || value.mode > 0o7777) return false;
  const bytes = Buffer.from(value.content, 'base64');
  return bytes.toString('base64') === value.content && hash(bytes) === value.sha256;
}

function same(left, right) {
  return left === null || right === null ? left === right
    : left.sha256 === right.sha256 && left.mode === right.mode && left.content === right.content;
}

function validIdentity(value) {
  return value === null || (value && Object.keys(value).sort().join() === 'device,inode'
    && Object.values(value).every((part) => typeof part === 'string' && /^\d+$/u.test(part)));
}

export async function transactionState(root, io) {
  if (process.platform !== 'linux') throw new Error('Bootstrap transaction recovery requires the local Linux profile.');
  const stored = await snapshot(root, JOURNAL_PATH, io);
  if (stored === null) return null;
  if (stored.mode & 0o077) throw new Error('Bootstrap recovery journal must be private to its owner.');
  const bytes = Buffer.from(stored.content, 'base64');
  const complete = bytes.lastIndexOf(0x0a) + 1;
  let envelope;
  try {
    if (!complete) throw new Error('No complete record');
    // An interrupted append may leave a final partial record. Every complete
    // record must validate; corruption is never silently skipped.
    for (const line of bytes.subarray(0, complete).toString('utf8').split('\n').slice(0, -1)) {
      envelope = JSON.parse(line);
      if (envelope?.schemaVersion !== 1 || Object.keys(envelope).sort().join() !== 'payload,schemaVersion,sha256'
        || !envelope.payload || hash(JSON.stringify(envelope.payload)) !== envelope.sha256) throw new Error('Invalid record');
    }
  }
  catch { throw new Error('Invalid bootstrap recovery journal; preserve it for inspection.'); }
  const data = envelope?.payload;
  if (envelope?.schemaVersion !== 1 || Object.keys(envelope).sort().join() !== 'payload,schemaVersion,sha256'
    || !data || Object.keys(data).sort().join() !== 'createdDirectories,entries,rootIdentity,status,temporaryFiles'
    || hash(JSON.stringify(data)) !== envelope.sha256
    || !['prepared', 'committed', 'restoring'].includes(data.status)
    || JSON.stringify(data.rootIdentity) !== JSON.stringify(await rootIdentity(root))
    || !Array.isArray(data.entries) || data.entries.length === 0 || data.entries.length > 1024
    || !Array.isArray(data.createdDirectories) || data.createdDirectories.length > 4096
    || !Array.isArray(data.temporaryFiles) || data.temporaryFiles.length > 4096) throw new Error('Invalid bootstrap recovery journal.');
  const paths = [];
  for (const entry of data.entries) {
    if (!entry || Object.keys(entry).sort().join() !== 'after,before,path') throw new Error('Invalid bootstrap recovery journal entry.');
    await io.resolveFilePath(root, entry.path, 'journal target path');
    const key = entry.path.toLowerCase();
    if (key === JOURNAL_PATH || paths.some((prior) => prior === key || prior.startsWith(`${key}/`) || key.startsWith(`${prior}/`))
      || !validSnapshot(entry.before) || !validSnapshot(entry.after) || same(entry.before, entry.after)) throw new Error('Invalid bootstrap recovery journal entry.');
    paths.push(key);
  }
  const parents = new Set();
  for (const relative of [...paths, JOURNAL_PATH]) {
    for (let directory = path.posix.dirname(relative); directory !== '.'; directory = path.posix.dirname(directory)) parents.add(directory);
  }
  const directories = new Set();
  for (const directory of data.createdDirectories) {
    if (!directory || Object.keys(directory).sort().join() !== 'identity,path' || !validIdentity(directory.identity)) throw new Error('Invalid journal directory identity.');
    await io.resolveFilePath(root, `${directory.path}/.boundary-check`, 'journal directory path');
    const key = directory.path.toLowerCase();
    if (!parents.has(key) || directories.has(key)) throw new Error('Invalid journal directory ownership.');
    directories.add(key);
  }
  const temporaryPaths = new Set();
  for (const temporary of data.temporaryFiles) {
    if (!temporary || Object.keys(temporary).sort().join() !== 'identity,path' || !validIdentity(temporary.identity)) throw new Error('Invalid journal temporary ownership.');
    await io.resolveFilePath(root, temporary.path, 'owned temporary path');
    if (!data.entries.some((entry) => temporary.path.startsWith(`${entry.path}.tmp-`)
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(temporary.path.slice(entry.path.length + 5)))
      || temporaryPaths.has(temporary.path.toLowerCase())) throw new Error('Invalid journal temporary path.');
    temporaryPaths.add(temporary.path.toLowerCase());
  }
  data[VALID_BYTES] = complete;
  data[OBSERVED_BYTES] = bytes.length;
  return data;
}

async function save(root, payload, io) {
  const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, payload, sha256: hash(JSON.stringify(payload)) })}\n`);
  const prefix = payload[VALID_BYTES] ?? 0;
  if (prefix + bytes.length > MAX_JOURNAL_BYTES) throw new Error('Bootstrap transaction exceeds the supported journal size bound.');
  const filename = await io.resolveFilePath(root, JOURNAL_PATH, 'journal append');
  const handle = await open(filename, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    if ((await handle.stat()).size !== (payload[OBSERVED_BYTES] ?? 0)) throw new Error('Bootstrap journal changed after inspection.');
    await handle.chmod(0o600);
    await handle.truncate(prefix); // Discard only a validated incomplete final append.
    await handle.writeFile(bytes);
    await handle.sync();
  } finally { await handle.close(); }
  await io.syncDirectory(root);
  payload[VALID_BYTES] = payload[OBSERVED_BYTES] = prefix + bytes.length;
}

function temporaryOwnership(root, data, io) {
  return {
    async reserve(relative) {
      data.temporaryFiles.push({ path: relative, identity: null });
      await save(root, data, io);
    },
    async created(relative, identity) {
      data.temporaryFiles.find((record) => record.path === relative).identity = identity;
      await save(root, data, io);
    },
  };
}

async function ownedTemporary(root, record, io) {
  const filename = await io.resolveFilePath(root, record.path, 'owned temporary');
  try {
    const info = await lstat(filename, { bigint: true });
    if (!info.isFile() || info.uid !== BigInt(process.getuid())
      || JSON.stringify({ device: String(info.dev), inode: String(info.ino) }) !== JSON.stringify(record.identity)) {
      throw new Error(`Bootstrap temporary ownership changed or is uncertain: ${record.path}`);
    }
    return filename;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function restoreTransaction(root, { recovery = false } = {}, io) {
  const data = await transactionState(root, io);
  if (data === null) {
    if (recovery) return { restored: false };
    throw new Error('No bootstrap rollback journal exists.');
  }
  if (data.status === 'committed' && recovery) throw new Error('Bootstrap committed successfully; use explicit rollback.');
  if (data.status === 'prepared' && !recovery) throw new Error('Interrupted bootstrap requires explicit recovery.');
  for (const temporary of data.temporaryFiles) await ownedTemporary(root, temporary, io);
  for (const directory of data.createdDirectories) {
    const current = await directoryIdentity(root, directory.path, io);
    if ((current !== null && JSON.stringify(current) !== JSON.stringify(directory.identity))
      || (current === null && directory.identity !== null && data.status !== 'restoring')) {
      throw new Error(`Bootstrap directory ownership changed or is uncertain: ${directory.path}`);
    }
  }
  // Inspect the whole transaction before restoring even its first file.
  for (const entry of data.entries) {
    const current = await snapshot(root, entry.path, io);
    if (!same(current, entry.after) && !(data.status !== 'committed' && same(current, entry.before))) {
      throw new Error(`Bootstrap recovery found intervening local changes: ${entry.path}`);
    }
  }
  data.status = 'restoring';
  await save(root, data, io);
  for (const entry of data.entries) {
    if (same(await snapshot(root, entry.path, io), entry.before)) continue;
    if (entry.before === null) {
      const filename = await io.resolveFilePath(root, entry.path, 'recovery target');
      await rm(filename);
      await io.syncDirectory(path.dirname(filename));
    } else {
      await io.atomicWrite(root, entry.path, Buffer.from(entry.before.content, 'base64'), entry.before.mode, temporaryOwnership(root, data, io));
    }
  }
  for (const temporary of data.temporaryFiles) {
    const filename = await ownedTemporary(root, temporary, io);
    if (filename !== null) {
      await rm(filename);
      await io.syncDirectory(path.dirname(filename));
    }
  }
  for (const directory of [...data.createdDirectories].sort((a, b) => b.path.split('/').length - a.path.split('/').length)) {
    const current = await directoryIdentity(root, directory.path, io);
    if (current === null) continue;
    if (JSON.stringify(current) !== JSON.stringify(directory.identity)) throw new Error(`Bootstrap directory ownership changed: ${directory.path}`);
    const filename = await io.resolveFilePath(root, directory.path, 'owned recovery directory');
    try {
      await rmdir(filename); // Never remove unrelated files or nonempty directories.
      await io.syncDirectory(path.dirname(filename));
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
  }
  // Delete the recovery record only after file restoration and all directory
  // cleanup have either completed or preserved known nonempty directories.
  const journal = await io.resolveFilePath(root, JOURNAL_PATH, 'recovery journal');
  await rm(journal);
  await io.syncDirectory(root);
  return { restored: true, files: data.entries.map((entry) => entry.path) };
}

export async function applyTransaction(root, files, io) {
  const prior = await transactionState(root, io);
  if (prior && prior.status !== 'committed') throw new Error('Interrupted bootstrap requires explicit recovery before apply.');
  const entries = [];
  for (const file of files) {
    const before = await snapshot(root, file.path, io);
    if ((before?.sha256 ?? null) !== file.expectedSha256) throw new Error(`Bootstrap target changed after planning: ${file.path}`);
    const after = { content: file.content.toString('base64'), mode: file.mode ?? 0o644, sha256: hash(file.content) };
    if (before?.sha256 === after.sha256) continue; // Preserve mode and last real rollback baseline on no-op apply.
    entries.push({ path: file.path, before, after });
  }
  if (entries.length === 0) return { changed: false };
  const missing = new Set();
  for (const relative of [...entries.map((entry) => entry.path), JOURNAL_PATH]) {
    for (let directory = path.posix.dirname(relative); directory !== '.'; directory = path.posix.dirname(directory)) {
      await io.resolveFilePath(root, `${directory}/.boundary-check`, 'transaction directory');
      try { await lstat(path.join(root, directory)); }
      catch (error) { if (error.code === 'ENOENT') missing.add(directory); else throw error; }
    }
  }
  const data = { status: 'prepared', rootIdentity: await rootIdentity(root), entries, temporaryFiles: [],
    createdDirectories: [...missing].sort((a, b) => a.split('/').length - b.split('/').length)
      .map((relative) => ({ path: relative, identity: null })) };
  data[VALID_BYTES] = prior?.[VALID_BYTES] ?? 0;
  data[OBSERVED_BYTES] = prior?.[OBSERVED_BYTES] ?? 0;
  // Reserve a conservative full apply+rollback log budget before any mutation.
  const widest = { ...data,
    createdDirectories: data.createdDirectories.map((directory) => ({ ...directory, identity: { device: '9'.repeat(32), inode: '9'.repeat(32) } })),
    temporaryFiles: entries.flatMap((entry) => [0, 1].map(() => ({ path: `${entry.path}.tmp-00000000-0000-0000-0000-000000000000`, identity: { device: '9'.repeat(32), inode: '9'.repeat(32) } }))),
  };
  if ((data[VALID_BYTES] + (Buffer.byteLength(JSON.stringify(widest)) + 512) * (data.createdDirectories.length + 4 * entries.length + 8)) > MAX_JOURNAL_BYTES) {
    throw new Error('Insufficient bounded journal capacity for bootstrap and rollback; preserve or resolve existing rollback data first.');
  }
  // Durable snapshots precede every managed-file mutation, including the lock.
  await save(root, data, io);
  try {
    for (const directory of data.createdDirectories) {
      const boundary = await io.resolveFilePath(root, `${directory.path}/.boundary-check`, 'new owned directory');
      await mkdir(path.dirname(boundary), { mode: 0o755 });
      directory.identity = await directoryIdentity(root, directory.path, io);
      await io.syncDirectory(path.dirname(path.dirname(boundary)));
      await save(root, data, io);
    }
    for (const entry of entries) {
      await io.atomicWrite(root, entry.path, Buffer.from(entry.after.content, 'base64'), entry.after.mode, temporaryOwnership(root, data, io));
    }
    data.status = 'committed';
    await save(root, data, io);
  } catch (error) {
    try { await restoreTransaction(root, { recovery: true }, io); }
    catch (recoveryError) { throw new AggregateError([error, recoveryError], 'Bootstrap failed; durable journal retained, explicit recovery required.'); }
    throw error;
  }
  return { changed: true, journal: JOURNAL_PATH };
}
