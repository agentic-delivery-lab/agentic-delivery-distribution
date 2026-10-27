import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTransaction, JOURNAL_PATH, restoreTransaction, transactionState } from './bootstrap-transaction.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(repositoryRoot, 'manifests/workflow-bundle.json');
const LOCK_RELATIVE_PATH = '.agentic-delivery/distribution.lock.json';
const LOCK_SCHEMA_ID = 'https://github.com/agentic-delivery-lab/agentic-delivery-distribution/blob/main/manifests/consumer-distribution-lock.v1.schema.json';

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
    return { exists: true, content: await readFile(targetPath), fileMode: stats.mode & 0o7777 };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, content: null, fileMode: null };
    throw error;
  }
}

function priorOwnershipLock(content) {
  if (content.length > 4 * 1024 * 1024) throw new Error('Prior consumer lock exceeds the supported ownership bound.');
  let lock;
  try { lock = JSON.parse(content.toString('utf8')); }
  catch { throw new Error('Prior consumer ownership lock is invalid JSON.'); }
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, required, allowed = required) => record(value)
    && required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.includes(key));
  const source = (value, repository) => keys(value, ['repository', 'commit'], ['repository', 'commit', 'contracts'])
    && value.repository === repository && typeof value.commit === 'string' && /^[0-9a-f]{40}$/u.test(value.commit)
    && (!Object.hasOwn(value, 'contracts') || record(value.contracts));
  if (!keys(lock, ['$schema', 'schemaVersion', 'bundleVersion', 'status', 'controlPlane', 'architecture', 'workflowSource', 'files'])
    || lock.$schema !== LOCK_SCHEMA_ID || lock.schemaVersion !== 1
    || typeof lock.bundleVersion !== 'string' || !lock.bundleVersion || lock.bundleVersion.length > 128
    || !['draft', 'released', 'withdrawn'].includes(lock.status)
    || !source(lock.controlPlane, 'agentic-delivery-lab/agentic-delivery')
    || !source(lock.workflowSource, 'agentic-delivery-lab/agentic-delivery')
    || !keys(lock.architecture, ['repository', 'commit', 'contentSha256', 'affectedIdentifiers'])
    || lock.architecture.repository !== 'agentic-delivery-lab/agentic-delivery-architecture'
    || typeof lock.architecture.commit !== 'string' || !/^[0-9a-f]{40}$/u.test(lock.architecture.commit)
    || typeof lock.architecture.contentSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(lock.architecture.contentSha256)
    || !Array.isArray(lock.architecture.affectedIdentifiers) || !lock.architecture.affectedIdentifiers.length
    || lock.architecture.affectedIdentifiers.some((id) => typeof id !== 'string' || !id)
    || !Array.isArray(lock.files) || !lock.files.length || lock.files.length > 1024) throw new Error('Prior consumer ownership lock has an unsupported or invalid contract.');
  const targets = [LOCK_RELATIVE_PATH, JOURNAL_PATH];
  for (const file of lock.files) {
    if (!keys(file, ['source', 'target', 'mode', 'sourceSha256']) || !['managed', 'generated'].includes(file.mode)
      || typeof file.sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(file.sourceSha256)) throw new Error('Prior consumer ownership record is invalid.');
    safeRelativePath(file.source, 'prior source path');
    const target = safeRelativePath(file.target, 'prior target path').toLowerCase();
    if (targets.some((prior) => prior === target || prior.startsWith(`${target}/`) || target.startsWith(`${prior}/`))) throw new Error('Prior consumer lock contains overlapping or reserved target paths.');
    targets.push(target);
  }
  return lock; // Local ownership evidence only; not release/native-identity admission.
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
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, required, allowed = required) => record(value)
    && required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.includes(key));
  const sha = (value, length) => typeof value === 'string'
    && (length === 40 ? /^[0-9a-f]{40}$/u : /^[0-9a-f]{64}$/u).test(value);
  const source = (value, repository, extra = []) => keys(value, ['repository', 'commit', ...extra])
    && value.repository === repository && sha(value.commit, 40);
  const required = ['schemaVersion', 'bundleVersion', 'status', 'controlPlane', 'architecture', 'workflowSource', 'files'];
  if (!keys(manifest, required, [...required, '$schema']) || manifest.schemaVersion !== 1) {
    throw new Error('distribution manifest must use the supported workflow bundle v1 contract.');
  }
  if (typeof manifest.bundleVersion !== 'string' || !manifest.bundleVersion.trim()
    || manifest.bundleVersion.length > 128) errors.push('bundle version must be a nonempty bounded string');
  if (!['draft', 'released'].includes(manifest.status)) errors.push('bundle status must be draft or released; withdrawn bundles cannot be installed');
  if (!source(manifest.controlPlane, 'agentic-delivery-lab/agentic-delivery', ['contracts'])) errors.push('control-plane repository and immutable commit must match the supported source contract');
  const contracts = manifest.controlPlane?.contracts;
  if (!keys(contracts, ['eventEnvelope', 'lifecycle', 'stateMachine'])
    || contracts.eventEnvelope !== 1 || contracts.lifecycle !== '1.0.0' || contracts.stateMachine !== '1.0.0') {
    errors.push('control-plane contract versions must be eventEnvelope 1, lifecycle 1.0.0 and stateMachine 1.0.0');
  }
  if (!source(manifest.architecture, 'agentic-delivery-lab/agentic-delivery-architecture', ['contentSha256', 'affectedIdentifiers'])
    || !sha(manifest.architecture?.contentSha256, 64)) errors.push('Architecture repository, immutable commit and content digest must match the supported source contract');
  const identifiers = manifest.architecture?.affectedIdentifiers;
  if (!Array.isArray(identifiers) || !identifiers.length
    || identifiers.some((id) => typeof id !== 'string' || !id.trim())) errors.push('Architecture affected identifiers must be nonempty strings');
  if (!source(manifest.workflowSource, 'agentic-delivery-lab/agentic-delivery')) errors.push('workflow repository and immutable commit must match the supported source contract');
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 1024
    || manifest.files.some((file) => !keys(file, ['source', 'target', 'mode']) || !['managed', 'generated'].includes(file.mode))) {
    errors.push('workflow bundle files must use the supported source, target and mode contract');
  }
  // Reject malformed structures before path iteration and before reading any
  // source bytes or consumer files. Force replacement cannot bypass this gate.
  if (errors.length) throw new Error(`distribution manifest check failed:\n${errors.join('\n')}`);
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
export async function bootstrapPlan({ distributionRoot = repositoryRoot, targetRoot = process.cwd(), update = false } = {}) {
  if (typeof update !== 'boolean') throw new Error('Managed update must be explicitly true or false.');
  const manifest = await validateBootstrapManifest(distributionRoot);
  const lockPath = await resolveFilePath(targetRoot, LOCK_RELATIVE_PATH, 'consumer lock');
  const priorFile = await existingTarget(lockPath);
  if (update && !priorFile.exists) throw new Error('Managed update requires a prior consumer ownership lock.');
  const prior = update ? priorOwnershipLock(priorFile.content) : null;
  if (update) {
    const history = await transactionState(path.resolve(targetRoot), transactionIo);
    if (history && history.status !== 'committed') throw new Error('Interrupted bootstrap requires explicit recovery before update planning.');
    if (history && history.consumerLockSha256 !== null && history.consumerLockSha256 !== digest(priorFile.content)) throw new Error('Prior consumer ownership lock differs from its committed journal; preserve local metadata changes.');
  }
  const owned = new Map();
  for (const file of prior?.files ?? []) {
    const targetPath = await resolveFilePath(targetRoot, file.target, 'prior owned target');
    const current = await existingTarget(targetPath);
    if (!current.exists || digest(current.content) !== file.sourceSha256) throw new Error(`Managed update found a missing or locally changed prior-owned path: ${file.target}`);
    owned.set(file.target.toLowerCase(), { file, current });
  }
  const entries = [];
  for (const file of manifest.files) {
    const sourcePath = await resolveFilePath(distributionRoot, file.source, `source ${file.source}`);
    const targetPath = await resolveFilePath(targetRoot, file.target, `target ${file.target}`);
    const sourceContent = await regularFile(sourcePath, `source ${file.source}`);
    const target = await existingTarget(targetPath);
    const ownership = owned.get(file.target.toLowerCase());
    if (update && ownership && ownership.file.target !== file.target) throw new Error('Managed update requires explicit migration for case-only target changes.');
    if (update && !ownership && target.exists) throw new Error(`Managed update found an unowned target collision: ${file.target}`);
    const sourceSha256 = digest(sourceContent);
    const targetSha256 = target.exists ? digest(target.content) : null;
    entries.push({
      source: file.source,
      target: file.target,
      mode: file.mode,
      sourceSha256,
      targetSha256,
      targetFileMode: target.fileMode,
      action: !target.exists ? 'create' : targetSha256 === sourceSha256 ? 'unchanged' : update ? 'update' : 'conflict',
    });
  }
  const desired = new Set(manifest.files.map((file) => file.target.toLowerCase()));
  for (const { file, current } of owned.values()) {
    if (!desired.has(file.target.toLowerCase())) entries.push({ ...file, targetSha256: digest(current.content), targetFileMode: current.fileMode, action: 'remove' });
  }
  return { manifest, targetRoot: path.resolve(targetRoot), entries, priorLockSha256: priorFile.exists ? digest(priorFile.content) : null };
}

function lockFor({ manifest, entries }) {
  return {
    $schema: LOCK_SCHEMA_ID,
    schemaVersion: 1,
    bundleVersion: manifest.bundleVersion,
    status: manifest.status,
    controlPlane: manifest.controlPlane,
    architecture: manifest.architecture,
    workflowSource: manifest.workflowSource,
    files: entries.filter((entry) => entry.action !== 'remove').map(({ source, target, mode, sourceSha256 }) => ({ source, target, mode, sourceSha256 })),
  };
}

/**
 * Apply the thin consumer projection. The complete plan is checked for
 * conflicts before the first write. A durable transaction retains exact prior
 * bytes and modes for failure recovery and explicit rollback.
 * Existing files require explicit `force`; the default is safe and
 * idempotent.
 */
export async function applyBootstrap({ distributionRoot = repositoryRoot, targetRoot = process.cwd(), force = false, dryRun = false, update = false } = {}) {
  if (update && force) throw new Error('Choose managed update or reviewed force replacement, not both.');
  const pending = await transactionState(path.resolve(targetRoot), transactionIo);
  if (pending && pending.status !== 'committed') throw new Error('Interrupted bootstrap requires explicit recovery before apply.');
  const plan = await bootstrapPlan({ distributionRoot, targetRoot, update });
  const conflicts = plan.entries.filter((entry) => entry.action === 'conflict');
  if (conflicts.length > 0 && !force) {
    throw new Error(`Bootstrap found local changes in managed files: ${conflicts.map((entry) => entry.target).join(', ')}. Re-run with force=true only after review.`);
  }
  const lock = lockFor(plan);
  const lockPath = await resolveFilePath(plan.targetRoot, LOCK_RELATIVE_PATH, 'consumer lock');
  const existingLock = await existingTarget(lockPath);
  if ((existingLock.exists ? digest(existingLock.content) : null) !== plan.priorLockSha256) throw new Error('Consumer provenance lock changed after planning.');
  const lockContent = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  if (existingLock.exists && digest(existingLock.content) !== digest(lockContent) && !force && !update) {
    throw new Error(`Bootstrap provenance lock ${LOCK_RELATIVE_PATH} differs; review the release change or use force=true.`);
  }
  if (dryRun) return { ...plan, lock, lockPath, applied: false };
  const files = [];
  for (const entry of plan.entries) {
    if (entry.action === 'remove') {
      files.push({ path: entry.target, content: null, expectedSha256: entry.targetSha256, expectedMode: entry.targetFileMode });
      continue;
    }
    const sourcePath = await resolveFilePath(distributionRoot, entry.source, `source ${entry.source}`);
    const content = await regularFile(sourcePath, `source ${entry.source}`);
    if (digest(content) !== entry.sourceSha256) throw new Error(`Bootstrap source changed after planning: ${entry.source}`);
    files.push({ path: entry.target, content, expectedSha256: entry.targetSha256, expectedMode: entry.targetFileMode,
      mode: update && entry.targetFileMode !== null ? entry.targetFileMode : 0o644 });
  }
  files.push({ path: LOCK_RELATIVE_PATH, content: lockContent, expectedSha256: existingLock.exists ? digest(existingLock.content) : null,
    expectedMode: existingLock.fileMode, mode: update && existingLock.exists ? existingLock.fileMode : 0o644 });
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
      if (['--plan', '--apply', '--rollback', '--recover'].filter((mode) => args.has(mode)).length !== 1 || args.has('--force') || args.has('--update')) {
        throw new Error('Choose exactly one bootstrap apply, plan, rollback or recovery mode; restoration cannot use force or update.');
      }
      const result = await (args.has('--recover') ? recoverBootstrap : rollbackBootstrap)({ targetRoot });
      process.stdout.write(result.restored ? 'Restored the previous consumer state.\n' : 'No interrupted bootstrap requires recovery.\n');
    } else if (!args.has('--plan') && !args.has('--apply')) {
      if (args.has('--update')) throw new Error('Managed update requires explicit --plan or --apply mode.');
      const manifest = await checkBootstrap(distributionRoot);
      process.stdout.write(`bootstrap manifest is valid for ${manifest.controlPlane.commit}.\n`);
    } else {
      const result = await applyBootstrap({
        distributionRoot,
        targetRoot,
        force: args.has('--force'),
        update: args.has('--update'),
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
