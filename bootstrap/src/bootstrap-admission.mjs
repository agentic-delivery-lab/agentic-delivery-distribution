import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sourceGit, sourceToolEnvironment, verifyNativeGitSource, verifySourceCheckout } from './bootstrap-native-sources.mjs';
import { workflowProjectionErrors } from './bootstrap-workflow-contract.mjs';

// Validation tooling is a separate source role; this does not repin runtime.
export const VALIDATION_SOURCE_COMMIT = 'd81f1d8095802ab06a96555c4f08396545ad05b6';
const CONTROL_PLANE = 'agentic-delivery-lab/agentic-delivery';
const exec = promisify(execFile);

export function requireSourceRoots(roots) {
  if (!roots || typeof roots !== 'object' || Array.isArray(roots)
    || ['controlPlaneRoot', 'architectureRoot', 'primitivesRoot'].some((key) => typeof roots[key] !== 'string' || !roots[key])) {
    throw new Error('Bootstrap source admission requires explicit Control Plane, Architecture and Customizations roots.');
  }
  return Object.freeze({ controlPlaneRoot: roots.controlPlaneRoot,
    architectureRoot: roots.architectureRoot, primitivesRoot: roots.primitivesRoot });
}

async function projectionData(root, commit) {
  const entries = (await sourceGit(root, 'ls-tree', '-rz', '--full-tree', commit)).toString().split('\0').filter(Boolean);
  const data = [];
  let size = 0;
  for (const entry of entries) {
    const separator = entry.indexOf('\t');
    const header = entry.slice(0, separator);
    const relative = entry.slice(separator + 1);
    if (!['manifests/', 'bootstrap/templates/', 'packages/agent-plugin/'].some((prefix) => relative?.startsWith(prefix))) continue;
    const [mode, type, oid] = header.split(' ');
    if (!['100644', '100755'].includes(mode) || type !== 'blob'
      || !/^[A-Za-z0-9._/-]+$/.test(relative)
      || relative.split('/').some((part) => ['', '.', '..'].includes(part))) throw new Error('Unsupported projection source entry.');
    const bytes = await sourceGit(root, 'cat-file', 'blob', oid);
    size += bytes.length;
    if (size > 32 * 1024 * 1024 || data.length >= 2000) throw new Error('Projection snapshot exceeds supported bounds.');
    data.push({ relative, bytes });
  }
  return data;
}

export async function withProjectionSnapshot(data, operation) {
  // Data only: no source checkout, .git, dependencies or executed scripts.
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-bootstrap-projection-'));
  try {
    for (const { relative, bytes } of data) {
      if (typeof relative !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(relative)
        || relative.split('/').some((part) => ['', '.', '..'].includes(part)) || !Buffer.isBuffer(bytes)) {
        throw new Error('Unsupported projection snapshot path or bytes.');
      }
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true, mode: 0o700 });
      await writeFile(path.join(root, relative), bytes, { mode: 0o600 });
    }
    return await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function document(data, relative) {
  const entry = data.find((item) => item.relative === relative);
  if (!entry) throw new Error(`Missing immutable source document: ${relative}`);
  return JSON.parse(entry.bytes.toString('utf8'));
}

/** Native source/provenance validation; deliberately separate from release readiness. */
export async function validateBootstrapSources({ distributionRoot, sourceRoots }) {
  sourceRoots = requireSourceRoots(sourceRoots);
  try {
    const commit = (await sourceGit(distributionRoot, 'rev-parse', 'HEAD')).toString().trim();
    await verifySourceCheckout(distributionRoot, commit);
    const distribution = await verifyNativeGitSource({ root: distributionRoot,
      repository: 'agentic-delivery-lab/agentic-delivery-distribution', repositoryId: 1380894705, commit });
    const data = await projectionData(distributionRoot, commit);
    const bundle = document(data, 'manifests/workflow-bundle.json');
    const lock = document(data, 'manifests/sources.lock.json');
    const capabilities = document(data, 'manifests/capabilities.lock.json');
    const text = (relative) => {
      const value = data.find((item) => item.relative === relative);
      if (!value) throw new Error(`Missing immutable workflow projection: ${relative}`);
      return value.bytes.toString('utf8');
    };
    const projectionErrors = workflowProjectionErrors(bundle,
      text('bootstrap/templates/consumer/.github/workflows/agentic-delivery-quality.yml'),
      text('bootstrap/templates/consumer/.github/workflows/agentic-delivery-architecture-review.yml'));
    if (projectionErrors.length) throw new Error(projectionErrors.join('\n'));
    const roles = [
      ['control-plane', sourceRoots.controlPlaneRoot, CONTROL_PLANE, 1358455028, bundle.controlPlane?.commit],
      ['architecture', sourceRoots.architectureRoot, 'agentic-delivery-lab/agentic-delivery-architecture', 1380894616, bundle.architecture?.commit],
      ['primitives', sourceRoots.primitivesRoot, 'agentic-delivery-lab/agentic-delivery-agent-customizations', 1380894656, capabilities.sourceCommit],
      ['distribution-workflow', sourceRoots.controlPlaneRoot, CONTROL_PLANE, 1358455028, bundle.workflowSource?.commit],
      ['source-validation', sourceRoots.controlPlaneRoot, CONTROL_PLANE, 1358455028, VALIDATION_SOURCE_COMMIT],
    ];
    const sources = [];
    for (const [id, root, repository, repositoryId, sourceCommit] of roles) {
      const matches = lock.sources?.filter((source) => source.id === id) ?? [];
      if (matches.length !== 1 || matches[0].kind !== 'git' || matches[0].repository !== repository
        || matches[0].repositoryId !== repositoryId || matches[0].commit !== sourceCommit || matches[0].verified !== true) {
        throw new Error(`Source lock does not bind the supported ${id} role.`);
      }
      sources.push(await verifyNativeGitSource({ root, repository, repositoryId, commit: sourceCommit }));
    }
    // Execute only the accepted canonical tool checkout. The lockfile and all
    // tracked code/data must match; installation of its dependencies is explicit.
    await verifySourceCheckout(sourceRoots.controlPlaneRoot, VALIDATION_SOURCE_COMMIT);
    const moduleUrl = pathToFileURL(path.join(sourceRoots.controlPlaneRoot, 'scripts/validate-release-chain.mjs')).href;
    const result = await withProjectionSnapshot(data, async (snapshot) => {
      const script = `import {readFile} from 'node:fs/promises';
        const tool = await import(${JSON.stringify(moduleUrl)});
        const graph = await tool.validateDistributionReleaseChain(${JSON.stringify({ ...sourceRoots, distributionRoot: snapshot })});
        const plugin = tool.distributionPluginProjection(JSON.parse(await readFile(${JSON.stringify(path.join(snapshot, 'packages/agent-plugin/plugin.json'))}, 'utf8')));
        process.stdout.write(JSON.stringify({graph, pluginStatus: plugin.status}));`;
      const env = sourceToolEnvironment();
      const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', script], {
        env, timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true,
      });
      return JSON.parse(stdout);
    });
    const { graph } = result;
    if (graph?.status !== 'passed' || graph.validationScope !== 'public-distribution') {
      throw new Error('Canonical public validation returned an unsupported result.');
    }
    await verifySourceCheckout(sourceRoots.controlPlaneRoot, VALIDATION_SOURCE_COMMIT);
    await verifySourceCheckout(distributionRoot, commit);
    const architecture = JSON.parse((await sourceGit(sourceRoots.architectureRoot, 'show', `${bundle.architecture.commit}:architecture/generated/architecture-release.json`)).toString());
    const primitives = JSON.parse((await sourceGit(sourceRoots.primitivesRoot, 'show', `${capabilities.sourceCommit}:manifests/primitive-release.json`)).toString());
    return { data, graph, proof: { distribution, sources },
      releaseStatuses: [bundle.status, lock.status, capabilities.status, architecture.status, primitives.status,
        document(data, 'manifests/automation-projections.lock.json').status,
        result.pluginStatus] };
  } catch (error) {
    throw new Error(`Bootstrap source admission failed: ${error.message}`);
  }
}

export async function admitBootstrapSources(options) {
  const result = await validateBootstrapSources(options);
  if (result.releaseStatuses.some((status) => status !== 'released')) {
    throw new Error('Bootstrap source admission requires released producer and Distribution records; draft metadata cannot approve consumer writes.');
  }
  return result;
}
