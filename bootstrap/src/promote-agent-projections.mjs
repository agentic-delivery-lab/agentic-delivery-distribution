import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distributionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AGENT_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.agent\.md$/;
const SHA1 = /^[0-9a-f]{40}$/i;
const ADR_URI = /^urn:agentic-delivery:adr:[a-z0-9-]+$/;
const PRIMITIVE_URI = /^urn:agentic-delivery:primitive:[a-z0-9-]+$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const LOCK_PATH = 'provenance/agents.lock.json';

function digest(source) { return createHash('sha256').update(source, 'utf8').digest('hex'); }

function safeRelative(root, relative, label) {
  if (typeof relative !== 'string' || relative.length === 0 || path.isAbsolute(relative)
    || relative.split(/[\\/]/u).some((part) => part === '..')) throw new Error(`${label} must be a safe relative path.`);
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, relative);
  const relativeToRoot = path.relative(absoluteRoot, resolved);
  if (relativeToRoot === '' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) throw new Error(`${label} escapes its root.`);
  return resolved;
}

async function regularFile(filePath, label) {
  const stats = await lstat(filePath);
  if (!stats.isFile()) throw new Error(`${label} must be a regular file.`);
  return readFile(filePath, 'utf8');
}

function parseTools(value) {
  const raw = value?.trim();
  if (!raw || !raw.startsWith('[') || !raw.endsWith(']')) return [];
  return raw.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function parseAgent(source, file) {
  const lines = source.split(/\r?\n/u);
  if (lines[0] !== '---') throw new Error(`${file} must start with YAML frontmatter.`);
  const closing = lines.findIndex((line, index) => index > 0 && line === '---');
  if (closing < 0) throw new Error(`${file} has no closing frontmatter delimiter.`);
  const frontmatter = Object.fromEntries(lines.slice(1, closing).flatMap((line) => {
    const match = /^(name|description|tools):\s*(.*)$/u.exec(line);
    return match ? [[match[1], match[2]]] : [];
  }));
  const agentId = String(frontmatter.name ?? '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(agentId)) throw new Error(`${file} frontmatter name must be lowercase kebab-case.`);
  if (!String(frontmatter.description ?? '').trim()) throw new Error(`${file} frontmatter description is required.`);
  if (parseTools(frontmatter.tools).length === 0) throw new Error(`${file} frontmatter tools must be an explicit non-empty list.`);
  const marker = /<!--\s*agentic-primitive:\s*(\{[\s\S]*?\})\s*-->/u.exec(source);
  if (!marker) throw new Error(`${file} must contain an agentic-primitive metadata block.`);
  let metadata;
  try { metadata = JSON.parse(marker[1]); } catch (error) { throw new Error(`${file} primitive metadata is invalid JSON: ${error.message}`); }
  const primitiveId = String(metadata.id ?? '').startsWith('urn:')
    ? String(metadata.id)
    : `urn:agentic-delivery:primitive:${String(metadata.id ?? '')}`;
  if (!PRIMITIVE_URI.test(primitiveId)) throw new Error(`${file} metadata id must identify a primitive.`);
  const governingAdrs = (Array.isArray(metadata.adrs) ? metadata.adrs : []).map((adr) => {
    const text = String(adr);
    if (ADR_URI.test(text)) return text;
    return `urn:agentic-delivery:adr:${text.replace(/^ADR-/iu, '').toLowerCase()}`;
  });
  if (governingAdrs.length === 0 || governingAdrs.some((adr) => !ADR_URI.test(adr))) throw new Error(`${file} metadata adrs must be non-empty ADR identifiers.`);
  const compatibilityTargets = Array.isArray(metadata.compatibilityTargets) && metadata.compatibilityTargets.length > 0
    ? metadata.compatibilityTargets.map(String)
    : ['github-copilot'];
  return { agentId, primitiveId, governingAdrs, compatibilityTargets };
}

async function loadRelease(primitiveRoot) {
  const release = JSON.parse(await regularFile(path.join(primitiveRoot, 'manifests/primitive-release.json'), 'primitive release'));
  if (release.schemaVersion !== 1 || !SHA1.test(release.sourceCommit ?? '') || !SEMVER.test(release.capabilityPolicyVersion ?? '') || typeof release.releaseId !== 'string' || !release.releaseId) {
    throw new Error('Primitive release must contain an immutable source commit, release ID, and SemVer capability policy.');
  }
  return release;
}

async function loadLock(privateRoot) {
  try { return JSON.parse(await regularFile(path.join(privateRoot, LOCK_PATH), 'publication lock')); }
  catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, canonicalRepository: 'agentic-delivery-lab/agentic-delivery-primitives', agents: [] };
    throw error;
  }
}

async function sourceAgents(primitiveRoot) {
  const directory = path.join(primitiveRoot, 'agents/copilot');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const agents = [];
  for (const entry of entries.filter((item) => item.isFile() && AGENT_FILE.test(item.name)).sort((left, right) => left.name.localeCompare(right.name))) {
    const sourcePath = `agents/copilot/${entry.name}`;
    const source = await regularFile(path.join(primitiveRoot, sourcePath), sourcePath);
    agents.push({ sourcePath, source, ...parseAgent(source, sourcePath) });
  }
  return agents;
}

export async function promotionPlan({ primitiveRoot, privateRoot, promotedAt = new Date().toISOString() } = {}) {
  if (!primitiveRoot || !privateRoot) throw new Error('promotion requires primitiveRoot and privateRoot.');
  const release = await loadRelease(primitiveRoot);
  const source = await sourceAgents(primitiveRoot);
  const agents = source.map((agent) => ({
    primitiveId: agent.primitiveId,
    agentId: agent.agentId,
    targetPath: `agents/${agent.agentId}.agent.md`,
    sourceRepository: 'agentic-delivery-lab/agentic-delivery-primitives',
    sourceCommit: release.sourceCommit.toLowerCase(),
    sourceRef: release.sourceCommit.toLowerCase(),
    contentSha256: digest(agent.source),
    governingAdrs: agent.governingAdrs,
    toolPolicyVersion: release.capabilityPolicyVersion,
    promotionRelease: release.releaseId,
    promotedAt,
    compatibilityTargets: agent.compatibilityTargets,
    source: agent.source,
  }));
  const ids = new Set();
  for (const agent of agents) {
    if (ids.has(agent.agentId)) throw new Error(`duplicate organization agent ${agent.agentId}`);
    ids.add(agent.agentId);
  }
  const oldLock = await loadLock(privateRoot);
  const oldByPath = new Map((oldLock.agents ?? []).map((record) => [record.targetPath, record]));
  const newByPath = new Map(agents.map((agent) => [agent.targetPath, agent]));
  const actions = [];
  for (const agent of agents) {
    const targetPath = safeRelative(privateRoot, agent.targetPath, `target ${agent.targetPath}`);
    let current = null;
    try { current = await regularFile(targetPath, agent.targetPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const currentHash = current === null ? null : digest(current);
    actions.push({ targetPath: agent.targetPath, action: currentHash === null ? 'create' : currentHash === agent.contentSha256 ? 'unchanged' : 'conflict' });
  }
  for (const [targetPath, oldRecord] of oldByPath) {
    if (newByPath.has(targetPath)) continue;
    const absolute = safeRelative(privateRoot, targetPath, `stale target ${targetPath}`);
    let current;
    try { current = await regularFile(absolute, targetPath); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    actions.push({ targetPath, action: digest(current) === oldRecord.contentSha256 ? 'remove' : 'stale-conflict' });
  }
  const lock = {
    $schema: 'https://github.com/agentic-delivery-lab/agentic-delivery/blob/main/schemas/agent-publication-lock.v1.schema.json',
    schemaVersion: 1,
    canonicalRepository: 'agentic-delivery-lab/agentic-delivery-primitives',
    agents: agents.map(({ source, ...record }) => record),
  };
  return { primitiveRoot: path.resolve(primitiveRoot), privateRoot: path.resolve(privateRoot), agents, actions, lock };
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o755 });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o644 });
    await rename(temporary, filePath);
  } finally { await rm(temporary, { force: true }); }
}

export async function promoteAgentProjections({ primitiveRoot, privateRoot, promotedAt, force = false, dryRun = false } = {}) {
  const plan = await promotionPlan({ primitiveRoot, privateRoot, promotedAt });
  const conflicts = plan.actions.filter((action) => action.action === 'conflict' || action.action === 'stale-conflict');
  if (conflicts.length > 0 && !force) throw new Error(`Agent projection conflicts require review: ${conflicts.map((action) => action.targetPath).join(', ')}.`);
  if (dryRun) return { ...plan, applied: false };
  for (const agent of plan.agents) {
    const action = plan.actions.find((candidate) => candidate.targetPath === agent.targetPath);
    if (action?.action === 'unchanged') continue;
    await atomicWrite(safeRelative(plan.privateRoot, agent.targetPath, `target ${agent.targetPath}`), agent.source);
  }
  for (const action of plan.actions.filter((candidate) => candidate.action === 'remove')) await rm(safeRelative(plan.privateRoot, action.targetPath, `stale target ${action.targetPath}`));
  await atomicWrite(path.join(plan.privateRoot, LOCK_PATH), `${JSON.stringify(plan.lock, null, 2)}\n`);
  return { ...plan, applied: true };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const args = new Set(process.argv.slice(2));
    const primitiveRoot = process.env.AGENTIC_DELIVERY_PRIMITIVES_ROOT || path.resolve(distributionRoot, '../agentic-delivery-primitives');
    const privateRoot = process.env.AGENTIC_DELIVERY_PRIVATE_ROOT || path.resolve(distributionRoot, '../.github-private');
    if (!args.has('--plan') && !args.has('--apply')) throw new Error('Usage: --plan or --apply [--force].');
    const result = await promoteAgentProjections({ primitiveRoot, privateRoot, force: args.has('--force'), dryRun: args.has('--plan') });
    process.stdout.write(`${result.applied ? 'Promoted' : 'Planned'} ${result.agents.length} organization agent projection(s).\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
