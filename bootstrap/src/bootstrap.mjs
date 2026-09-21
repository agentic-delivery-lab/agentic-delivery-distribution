import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(repositoryRoot, 'manifests/workflow-bundle.json');
const LOCK_RELATIVE_PATH = '.agentic-delivery/distribution.lock.json';

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)
    || value.split(/[\\/]/u).some((part) => part === '..')) {
    throw new Error(`${label} must be a non-empty relative path without parent traversal.`);
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

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o755 });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, content, { mode: 0o644, flag: 'wx' });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function validateBootstrapManifest(root = repositoryRoot) {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifests/workflow-bundle.json'), 'utf8'));
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push('workflow bundle schemaVersion must be 1');
  if (!/^[0-9a-f]{40}$/.test(String(manifest.controlPlane?.commit ?? ''))) errors.push('control-plane commit must be immutable');
  if (!/^[0-9a-f]{40}$/.test(String(manifest.architecture?.commit ?? ''))) errors.push('architecture commit must be immutable');
  if (!/^[0-9a-f]{64}$/.test(String(manifest.architecture?.contentSha256 ?? ''))) errors.push('architecture content digest must be immutable');
  if (!Array.isArray(manifest.architecture?.affectedIdentifiers) || manifest.architecture.affectedIdentifiers.length === 0) errors.push('architecture affected identifiers are required');
  if (!/^[0-9a-f]{40}$/.test(String(manifest.workflowSource?.commit ?? ''))) errors.push('workflow source commit must be immutable');
  if (!Array.isArray(manifest.files) || manifest.files.some((file) => !file?.target || !file?.source)) errors.push('workflow bundle files must have source and target');
  for (const file of manifest.files ?? []) {
    if (file.target.includes('..') || file.target.startsWith('/')) errors.push(`unsafe consumer target: ${file.target}`);
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
  const entries = [];
  for (const file of manifest.files) {
    const sourcePath = resolveWithin(distributionRoot, file.source, `source ${file.source}`);
    const targetPath = resolveWithin(targetRoot, file.target, `target ${file.target}`);
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
 * conflicts before the first write, making a failed bootstrap non-partial.
 * Existing files require explicit `force`; the default is safe and
 * idempotent.
 */
export async function applyBootstrap({ distributionRoot = repositoryRoot, targetRoot = process.cwd(), force = false, dryRun = false } = {}) {
  const plan = await bootstrapPlan({ distributionRoot, targetRoot });
  const conflicts = plan.entries.filter((entry) => entry.action === 'conflict');
  if (conflicts.length > 0 && !force) {
    throw new Error(`Bootstrap found local changes in managed files: ${conflicts.map((entry) => entry.target).join(', ')}. Re-run with force=true only after review.`);
  }
  const lock = lockFor(plan);
  const lockPath = resolveWithin(plan.targetRoot, LOCK_RELATIVE_PATH, 'consumer lock');
  const existingLock = await existingTarget(lockPath);
  const lockContent = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  if (existingLock.exists && digest(existingLock.content) !== digest(lockContent) && !force) {
    throw new Error(`Bootstrap provenance lock ${LOCK_RELATIVE_PATH} differs; review the release change or use force=true.`);
  }
  if (dryRun) return { ...plan, lock, lockPath, applied: false };
  for (const entry of plan.entries) {
    if (entry.action === 'unchanged') continue;
    const sourcePath = resolveWithin(distributionRoot, entry.source, `source ${entry.source}`);
    const targetPath = resolveWithin(plan.targetRoot, entry.target, `target ${entry.target}`);
    await atomicWrite(targetPath, await regularFile(sourcePath, `source ${entry.source}`));
  }
  await atomicWrite(lockPath, lockContent);
  return { ...plan, lock, lockPath, applied: true };
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
    if (!args.has('--plan') && !args.has('--apply')) {
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
