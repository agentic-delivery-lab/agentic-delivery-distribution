import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTransaction, JOURNAL_PATH, restoreTransaction, transactionState } from './bootstrap-transaction.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(repositoryRoot, 'manifests/workflow-bundle.json');
const LOCK_RELATIVE_PATH = '.agentic-delivery/distribution.lock.json';

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)
    || !/^[A-Za-z0-9._/-]+$/u.test(value)
    || value.split('/').some((part) => ['', '.', '..'].includes(part) || part.endsWith('.')
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
    throw new Error(`${label} must be a canonical portable relative path without traversal or aliases.`);
  }
  return value;
}

function resolveWithin(root, relative, label) {
  const safe = safeRelativePath(relative, label);
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, safe);
  const relativeToRoot = path.relative(absoluteRoot, resolved);
  if (relativeToRoot === '' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    throw new Error(`${label} escapes its root.`);
  }
  return resolved;
}

/** Reject existing redirected ancestors. Requires a trusted single-writer tree;
 * path-based Node operations do not isolate concurrent hostile renames. */
async function resolveFilePath(root, relative, label) {
  const resolved = resolveWithin(root, relative, label);
  const absoluteRoot = path.resolve(root);
  const rootStats = await lstat(absoluteRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`${label} root violates the directory boundary.`);
  }
  const parent = path.dirname(resolved);
  let directory = path.parse(parent).root;
  for (const segment of parent.slice(directory.length).split(path.sep).filter(Boolean)) {
    directory = path.join(directory, segment);
    try {
      const stats = await lstat(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`${label} has a symbolic-link or non-directory boundary at ${directory}.`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  return resolved;
}

async function regularFile(filePath, label) {
  const stats = await lstat(filePath);
  if (!stats.isFile()) throw new Error(`${label} must be a regular file.`);
  return readFile(filePath);
}

async function existingTarget(targetPath) {
  try {
    const stats = await lstat(targetPath);
    if (stats.isSymbolicLink()) throw new Error(`Refusing to follow symbolic-link target ${targetPath}.`);
    if (!stats.isFile()) throw new Error(`Bootstrap target ${targetPath} is not a regular file.`);
    return { exists: true, content: await readFile(targetPath) };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, content: null };
    throw error;
  }
}

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function atomicWrite(root, relative, content, mode = 0o644, ownership) {
  const filePath = await resolveFilePath(root, relative, `target ${relative}`);
  await existingTarget(filePath);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o755 });
  await resolveFilePath(root, relative, `target ${relative}`);
  const temporaryRelative = `${relative}.tmp-${randomUUID()}`;
  const temporary = await resolveFilePath(root, temporaryRelative, 'temporary target');
  await ownership?.reserve(temporaryRelative);
  let created = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    created = true;
    try {
      const info = await handle.stat({ bigint: true });
      await ownership?.created(temporaryRelative, { device: String(info.dev), inode: String(info.ino) });
      await handle.writeFile(content);
      await handle.chmod(mode);
      await handle.sync();
    } finally { await handle.close(); }
    await rename(temporary, filePath);
    // Persist new ancestor directory entries too, not only the final rename.
    for (let directory = path.dirname(filePath); ; directory = path.dirname(directory)) {
      await syncDirectory(directory);
      if (directory === path.resolve(root)) break;
    }
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}

export async function validateBootstrapManifest(root = repositoryRoot) {
  const input = await resolveFilePath(root, 'manifests/workflow-bundle.json', 'manifest path');
  const manifest = JSON.parse(await regularFile(input, 'manifest'));
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push('workflow bundle schemaVersion must be 1');
  if (!/^[0-9a-f]{40}$/.test(String(manifest.controlPlane?.commit ?? ''))) errors.push('control-plane commit must be immutable');
  if (!/^[0-9a-f]{40}$/.test(String(manifest.architecture?.commit ?? ''))) errors.push('architecture commit must be immutable');
  if (!/^[0-9a-f]{64}$/.test(String(manifest.architecture?.contentSha256 ?? ''))) errors.push('architecture content digest must be immutable');
  if (!Array.isArray(manifest.architecture?.affectedIdentifiers) || manifest.architecture.affectedIdentifiers.length === 0) errors.push('architecture affected identifiers are required');
  if (!/^[0-9a-f]{40}$/.test(String(manifest.workflowSource?.commit ?? ''))) errors.push('workflow source commit must be immutable');
  if (!Array.isArray(manifest.files) || manifest.files.some((file) => !file?.target || !file?.source)) errors.push('workflow bundle files must have source and target');
  const targets = [LOCK_RELATIVE_PATH, JOURNAL_PATH];
  for (const file of manifest.files ?? []) {
    safeRelativePath(file.source, 'source path');
    // ASCII paths and case-folded comparisons conservatively reject aliases
    // even when a consumer uses a case-insensitive filesystem.
    const target = safeRelativePath(file.target, 'target path').toLowerCase();
    if (targets.some((prior) => prior === target || prior.startsWith(`${target}/`) || target.startsWith(`${prior}/`))) {
      errors.push(`overlapping or reserved consumer target path: ${target}`);
    }
    targets.push(target);
  }
  if (errors.length > 0) throw new Error(`distribution manifest check failed:\n${errors.join('\n')}`);
  return manifest;
}

/**
 * Resolve the manifest against a checked-out Distribution repository and a
 * consumer working tree without reading or executing anything outside the
 * declared source and target paths.
 */
export async function bootstrapPlan({ distributionRoot = repositoryRoot, targetRoot = process.cwd() } = {}) {
  const manifest = await validateBootstrapManifest(distributionRoot);
  await resolveFilePath(targetRoot, LOCK_RELATIVE_PATH, 'consumer lock');
  const entries = [];
  for (const file of manifest.files) {
    const sourcePath = await resolveFilePath(distributionRoot, file.source, `source ${file.source}`);
    const targetPath = await resolveFilePath(targetRoot, file.target, `target ${file.target}`);
    const sourceContent = await regularFile(sourcePath, `source ${file.source}`);
    const target = await existingTarget(targetPath);
    const sourceSha256 = digest(sourceContent);
    const targetSha256 = target.exists ? digest(target.content) : null;
    entries.push({
      source: file.source,
      target: file.target,
      mode: file.mode,
      sourceSha256,
      targetSha256,
      action: !target.exists ? 'create' : targetSha256 === sourceSha256 ? 'unchanged' : 'conflict',
    });
  }
  return { manifest, targetRoot: path.resolve(targetRoot), entries };
}

function lockFor({ manifest, entries }) {
  return {
    $schema: 'https://github.com/agentic-delivery-lab/agentic-delivery-distribution/blob/main/manifests/consumer-distribution-lock.v1.schema.json',
    schemaVersion: 1,
    bundleVersion: manifest.bundleVersion,
    status: manifest.status,
    controlPlane: manifest.controlPlane,
    architecture: manifest.architecture,
    workflowSource: manifest.workflowSource,
    files: entries.map(({ source, target, mode, sourceSha256 }) => ({ source, target, mode, sourceSha256 })),
  };
}

/**
 * Apply the thin consumer projection. The complete plan is checked for
 * conflicts before the first write. A durable transaction retains exact prior
 * bytes and modes for failure recovery and explicit rollback.
 * Existing files require explicit `force`; the default is safe and
 * idempotent.
 */
export async function applyBootstrap({ distributionRoot = repositoryRoot, targetRoot = process.cwd(), force = false, dryRun = false } = {}) {
  const pending = await transactionState(path.resolve(targetRoot), transactionIo);
  if (pending && pending.status !== 'committed') throw new Error('Interrupted bootstrap requires explicit recovery before apply.');
  const plan = await bootstrapPlan({ distributionRoot, targetRoot });
  const conflicts = plan.entries.filter((entry) => entry.action === 'conflict');
  if (conflicts.length > 0 && !force) {
    throw new Error(`Bootstrap found local changes in managed files: ${conflicts.map((entry) => entry.target).join(', ')}. Re-run with force=true only after review.`);
  }
  const lock = lockFor(plan);
  const lockPath = await resolveFilePath(plan.targetRoot, LOCK_RELATIVE_PATH, 'consumer lock');
  const existingLock = await existingTarget(lockPath);
  const lockContent = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  if (existingLock.exists && digest(existingLock.content) !== digest(lockContent) && !force) {
    throw new Error(`Bootstrap provenance lock ${LOCK_RELATIVE_PATH} differs; review the release change or use force=true.`);
  }
  if (dryRun) return { ...plan, lock, lockPath, applied: false };
  const files = [];
  for (const entry of plan.entries) {
    const sourcePath = await resolveFilePath(distributionRoot, entry.source, `source ${entry.source}`);
    const content = await regularFile(sourcePath, `source ${entry.source}`);
    if (digest(content) !== entry.sourceSha256) throw new Error(`Bootstrap source changed after planning: ${entry.source}`);
    files.push({ path: entry.target, content, expectedSha256: entry.targetSha256 });
  }
  files.push({ path: LOCK_RELATIVE_PATH, content: lockContent, expectedSha256: existingLock.exists ? digest(existingLock.content) : null });
  const transaction = await applyTransaction(plan.targetRoot, files, transactionIo);
  return { ...plan, lock, lockPath, transaction, applied: true };
}

const transactionIo = { resolveFilePath, atomicWrite, syncDirectory };

export async function rollbackBootstrap({ targetRoot = process.cwd() } = {}) {
  return restoreTransaction(path.resolve(targetRoot), { recovery: false }, transactionIo);
}

export async function recoverBootstrap({ targetRoot = process.cwd() } = {}) {
  return restoreTransaction(path.resolve(targetRoot), { recovery: true }, transactionIo);
}

export async function checkBootstrap(root = repositoryRoot) {
  await access(manifestPath);
  return validateBootstrapManifest(root);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = new Set(process.argv.slice(2));
    const distributionRoot = process.env.AGENTIC_DELIVERY_DISTRIBUTION_ROOT || repositoryRoot;
    const targetRoot = process.env.AGENTIC_DELIVERY_TARGET_ROOT || process.cwd();
    if (args.has('--rollback') || args.has('--recover')) {
      if (['--plan', '--apply', '--rollback', '--recover'].filter((mode) => args.has(mode)).length !== 1 || args.has('--force')) {
        throw new Error('Choose exactly one bootstrap apply, plan, rollback or recovery mode; restoration cannot use force.');
      }
      const result = await (args.has('--recover') ? recoverBootstrap : rollbackBootstrap)({ targetRoot });
      process.stdout.write(result.restored ? 'Restored the previous consumer state.\n' : 'No interrupted bootstrap requires recovery.\n');
    } else if (!args.has('--plan') && !args.has('--apply')) {
      const manifest = await checkBootstrap(distributionRoot);
      process.stdout.write(`bootstrap manifest is valid for ${manifest.controlPlane.commit}.\n`);
    } else {
      const result = await applyBootstrap({
        distributionRoot,
        targetRoot,
        force: args.has('--force'),
        dryRun: args.has('--plan'),
      });
      const conflicts = result.entries.filter((entry) => entry.action === 'conflict').length;
      process.stdout.write(`${result.applied ? 'Applied' : 'Planned'} ${result.entries.length} managed file(s); ${conflicts} conflict(s).\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
