import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VALIDATION_SOURCE_COMMIT } from '../bootstrap/src/bootstrap-admission.mjs';
import { workflowProjectionErrors } from '../bootstrap/src/bootstrap-workflow-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

// Validate this publisher's supported subset, not every upstream plugin feature.
// Historical flat packages remain readable by the Control Plane release reader.
export function validatePluginPackage(manifest) {
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const exactKeys = (value, keys) => record(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
  const namespace = 'io.github.agentic-delivery-lab';
  const projection = manifest?.extensions?.[namespace];
  if (!exactKeys(manifest, ['$schema', 'name', 'version', 'description', 'extensions'])
    || manifest.$schema !== 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
    || manifest.name !== 'agentic-delivery'
    || typeof manifest.version !== 'string' || !manifest.version.trim()
    || typeof manifest.description !== 'string' || !manifest.description.trim()
    || !exactKeys(manifest.extensions, [namespace])
    || !exactKeys(projection, ['schemaVersion', 'id', 'status', 'generatedFrom', 'projections'])
    || projection.schemaVersion !== 1 || projection.id !== manifest.name || !['draft', 'released'].includes(projection.status)
    || !record(projection.generatedFrom)
    || !exactKeys(projection.projections, ['automations'])
    || projection.projections.automations !== 'automations/') {
    throw new Error('unsupported Agent Plugin package: expected the standard 1.0 manual-automation projection with draft or released status');
  }
  return projection;
}

export function validateCapabilitySourceIdentity(lock) {
  if (lock?.schemaVersion === 1) {
    return lock.primitiveRepository === 'agentic-delivery-lab/agentic-delivery-primitives'
      && !Object.hasOwn(lock, 'primitiveRepositoryId') ? [] : ['historical capabilities v1 source identity is invalid'];
  }
  if (lock?.schemaVersion === 2) {
    return lock.primitiveRepository === 'agentic-delivery-lab/agentic-delivery-agent-customizations'
      && lock.primitiveRepositoryId === 1380894656 ? [] : ['capabilities v2 source identity must be the current Customizations name and repository ID 1380894656'];
  }
  return ['capabilities lock schemaVersion must be supported (1 or 2)'];
}

export async function validateDistribution(repositoryRoot = root) {
  const errors = [];
  const bundle = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/workflow-bundle.json'), 'utf8'));
  if (bundle.schemaVersion !== 1 || !['draft', 'released'].includes(bundle.status)) errors.push('workflow bundle must be schemaVersion 1 with draft or released status');
  if (!/^[0-9a-f]{40}$/.test(bundle.controlPlane?.commit ?? '')) errors.push('control-plane commit must be immutable');
  if (!/^[0-9a-f]{40}$/.test(bundle.architecture?.commit ?? '')) errors.push('architecture commit must be immutable');
  if (!/^[0-9a-f]{64}$/.test(bundle.architecture?.contentSha256 ?? '')) errors.push('architecture content digest must be immutable');
  if (!Array.isArray(bundle.architecture?.affectedIdentifiers) || bundle.architecture.affectedIdentifiers.length === 0 || bundle.architecture.affectedIdentifiers.some((id) => typeof id !== 'string' || id.length === 0)) errors.push('architecture affected identifiers are required');
  if (!/^[0-9a-f]{40}$/.test(bundle.workflowSource?.commit ?? '')) errors.push('workflow source commit must be immutable');
  for (const file of bundle.files ?? []) {
    if (file.target.startsWith('/') || file.target.includes('..')) errors.push(`unsafe target path: ${file.target}`);
    if (!file.source || !file.target) errors.push('bundle entries require source and target');
    try {
      const sourceStats = await lstat(path.join(repositoryRoot, file.source));
      if (!sourceStats.isFile()) errors.push(`bundle source is not a regular file: ${file.source}`);
    } catch (error) {
      errors.push(`bundle source cannot be read: ${file.source} (${error.message})`);
    }
  }
  try {
    const lockSchema = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/consumer-distribution-lock.v1.schema.json'), 'utf8'));
    if (lockSchema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || lockSchema.title !== 'Agentic Delivery consumer distribution lock v1') {
      errors.push('consumer distribution lock schema is not self-identifying');
    }
  } catch (error) {
    errors.push(`consumer distribution lock schema cannot be read: ${error.message}`);
  }
  const sources = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/sources.lock.json'), 'utf8'));
  if (sources.schemaVersion !== 1 || sources.status !== bundle.status) errors.push('source lock status must match the bundle publication state');
  const validationSources = sources.sources?.filter((source) => source.id === 'source-validation') ?? [];
  if (validationSources.length !== 1 || validationSources[0].kind !== 'git'
    || validationSources[0].repository !== 'agentic-delivery-lab/agentic-delivery'
    || validationSources[0].repositoryId !== 1358455028
    || validationSources[0].commit !== VALIDATION_SOURCE_COMMIT || validationSources[0].verified !== true) {
    errors.push('source lock must pin the accepted public validation tool source');
  }
  const unverified = (sources.sources ?? []).filter((source) => source.verified !== true);
  if (sources.status === 'released' && unverified.length > 0) errors.push('released source lock must not contain unverified sources');
  const base = (sources.sources ?? []).find((source) => source.id === 'devcontainer-base-ubuntu-24.04');
  const dockerfile = await readFile(path.join(repositoryRoot, '.devcontainer/Dockerfile'), 'utf8');
  const devcontainer = JSON.parse(await readFile(path.join(repositoryRoot, '.devcontainer/devcontainer.json'), 'utf8'));
  if (!base || base.kind !== 'container-image' || base.reference !== 'mcr.microsoft.com/devcontainers/base:ubuntu-24.04') {
    errors.push('locked base-image source must identify the supported Ubuntu 24.04 Dev Container image');
  }
  if ((base?.verified === true || base?.digest != null)
    && (typeof base?.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(base.digest))) {
    errors.push('locked base-image digest must be immutable');
  }
  const lockedImage = base?.reference + (base?.digest ? `@${base.digest}` : '');
  // The supported Dockerfile is one FROM declaration; comments or unrelated
  // JSON values cannot substitute for the actual image selected by the client.
  if (dockerfile.trim() !== `FROM ${lockedImage}` || devcontainer.image !== lockedImage) {
    errors.push('Dev Container image and Dockerfile must use the exact locked base-image reference and digest');
  }
  const controlPlaneCommit = bundle.controlPlane?.commit;
  const lockedControlPlane = (sources.sources ?? []).find((source) => source.id === 'control-plane');
  if (!lockedControlPlane || lockedControlPlane.commit !== controlPlaneCommit) errors.push('workflow bundle and source lock must pin the same Control Plane commit');
  const lockedArchitecture = (sources.sources ?? []).find((source) => source.id === 'architecture');
  if (!lockedArchitecture || lockedArchitecture.commit !== bundle.architecture?.commit) errors.push('workflow bundle and source lock must pin the same Architecture commit');
  const capabilities = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/capabilities.lock.json'), 'utf8'));
  const capabilityVersion = [1, 2].includes(capabilities.schemaVersion) ? capabilities.schemaVersion : null;
  errors.push(...validateCapabilitySourceIdentity(capabilities));
  if (capabilityVersion !== null) {
    const capabilitiesSchema = JSON.parse(await readFile(path.join(repositoryRoot, `manifests/capabilities-lock.v${capabilityVersion}.schema.json`), 'utf8'));
    if (capabilities.$schema !== `./capabilities-lock.v${capabilityVersion}.schema.json`
      || capabilitiesSchema.title !== `Agentic Delivery capabilities lock v${capabilityVersion}`) errors.push('capabilities lock must identify its local schema');
  }
  if (capabilities.status !== bundle.status) errors.push('capabilities lock status must match the bundle publication state');
  if (!/^urn:agentic-delivery:primitive-release:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(capabilities.primitiveRelease ?? '')) errors.push('capabilities lock primitive release is invalid');
  if (!/^[0-9a-f]{40}$/.test(capabilities.sourceCommit ?? '') || !/^[0-9a-f]{64}$/.test(capabilities.contentSha256 ?? '')) errors.push('capabilities lock must pin Primitive source commit and content digest');
  const lockedPrimitives = (sources.sources ?? []).find((source) => source.id === 'primitives');
  if (!lockedPrimitives || lockedPrimitives.commit !== capabilities.sourceCommit || lockedPrimitives.repository !== capabilities.primitiveRepository) errors.push('source lock and capabilities lock must pin the same Primitive source');
  if (capabilityVersion === 2 && lockedPrimitives?.repositoryId !== capabilities.primitiveRepositoryId) errors.push('source lock and capabilities lock must bind the same Customizations repository ID');
  const lockedWorkflow = (sources.sources ?? []).find((source) => source.id === 'distribution-workflow');
  if (!lockedWorkflow || lockedWorkflow.commit !== bundle.workflowSource?.commit) errors.push('workflow bundle and source lock must pin the same workflow source commit');
  const consumerWorkflow = await readFile(path.join(repositoryRoot, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-quality.yml'), 'utf8');
  const architectureWorkflow = await readFile(path.join(repositoryRoot, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-architecture-review.yml'), 'utf8');
  errors.push(...workflowProjectionErrors(bundle, consumerWorkflow, architectureWorkflow));
  const plugin = validatePluginPackage(JSON.parse(await readFile(path.join(repositoryRoot, 'packages/agent-plugin/plugin.json'), 'utf8')));
  if (plugin.status !== bundle.status) errors.push('Agent Plugin status must match the bundle publication state');
  if (!/^[0-9a-f]{40}$/.test(plugin.generatedFrom?.primitiveSourceCommit ?? '')) errors.push('Agent Plugin must pin the Primitive source commit');
  if (!/^[0-9a-f]{40}$/.test(plugin.generatedFrom?.architectureCommit ?? '')) errors.push('Agent Plugin must pin the Architecture commit');
  if (plugin.generatedFrom?.primitiveRelease !== capabilities.primitiveRelease || plugin.generatedFrom?.primitiveSourceCommit !== capabilities.sourceCommit || plugin.generatedFrom?.primitiveContentSha256 !== capabilities.contentSha256) errors.push('Agent Plugin and capabilities lock must pin the same Primitive release and digest');
  if (plugin.generatedFrom?.architectureCommit !== bundle.architecture?.commit || plugin.generatedFrom?.architectureContentSha256 !== bundle.architecture?.contentSha256) errors.push('Agent Plugin and workflow bundle must pin the same Architecture release and digest');
  if (plugin.generatedFrom?.controlPlaneCommit !== bundle.controlPlane?.commit) errors.push('Agent Plugin and workflow bundle must pin the same Control Plane release');
  const automationLock = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/automation-projections.lock.json'), 'utf8'));
  const automationSchema = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/automation-projections-lock.v1.schema.json'), 'utf8'));
  if (automationSchema.title !== 'Agentic Delivery automation projections lock v1') errors.push('automation projection lock schema is not self-identifying');
  if (automationLock.schemaVersion !== 1 || automationLock.status !== bundle.status) errors.push('automation projection lock must be schemaVersion 1 with the bundle publication status');
  if (automationLock.canonicalRepository !== 'agentic-delivery-lab/agentic-delivery') errors.push('automation projection lock canonical repository is invalid');
  if (!SHA1.test(automationLock.sourceCommit ?? '')) errors.push('automation projection lock sourceCommit must be immutable');
  if (automationLock.projectionRepository !== 'agentic-delivery-lab/agentic-delivery-distribution') errors.push('automation projection lock projection repository is invalid');
  if (!/^urn:agentic-delivery:distribution:[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(automationLock.projectionRelease ?? '')) errors.push('automation projection lock release is invalid');
  const automationIds = new Set();
  const automationTargets = [];
  for (const template of automationLock.templates ?? []) {
    const prefix = `automation projection ${template?.id ?? '<missing>'}`;
    if (!template || typeof template !== 'object' || Array.isArray(template)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/.test(template.id ?? '') || automationIds.has(template.id)) errors.push(`${prefix} id must be unique and lowercase`);
    automationIds.add(template.id);
    if (!/^automations\/templates\/[a-z0-9.-]+\.automation\.md$/.test(template.sourcePath ?? '')) errors.push(`${prefix} sourcePath is invalid`);
    if (!/^packages\/agent-plugin\/automations\/[a-z0-9.-]+\.automation\.md$/.test(template.targetPath ?? '') || template.targetPath.includes('..')) errors.push(`${prefix} targetPath is invalid`);
    if (template.sourceRef !== automationLock.sourceCommit) errors.push(`${prefix} sourceRef must equal the lock sourceCommit`);
    if (!SHA256.test(template.contentSha256 ?? '')) errors.push(`${prefix} contentSha256 must be a SHA-256 digest`);
    if (!Array.isArray(template.compatibilityTargets) || template.compatibilityTargets.length === 0) errors.push(`${prefix} compatibilityTargets must be non-empty`);
    automationTargets.push(template.targetPath);
    try {
      const projected = await readFile(path.join(repositoryRoot, template.targetPath), 'utf8');
      if (sha256(projected) !== template.contentSha256) errors.push(`${prefix} content hash does not match the projection`);
      if (!projected.startsWith('---\nversion: 1\n') || !projected.includes(`id: ${template.id}\n`) || !projected.includes('kind: manual')) errors.push(`${prefix} projection does not retain the supported manual automation format`);
      if (/\.github-private|secrets:|permissions:|enabled:|workspace:/i.test(projected)) errors.push(`${prefix} projection contains a client-local or private-surface setting`);
    } catch (error) {
      errors.push(`${prefix} target cannot be read: ${error.message}`);
    }
  }
  let actualAutomationTargets = [];
  try {
    actualAutomationTargets = (await readdir(path.join(repositoryRoot, 'packages/agent-plugin/automations'), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.automation.md'))
      .map((entry) => `packages/agent-plugin/automations/${entry.name}`)
      .sort();
  } catch (error) {
    errors.push(`automation projection directory cannot be read: ${error.message}`);
  }
  if (JSON.stringify(actualAutomationTargets) !== JSON.stringify([...automationTargets].sort())) errors.push('automation projection lock does not match the Agent Plugin automation files');
  if (plugin.generatedFrom?.automationSourceCommit !== automationLock.sourceCommit) errors.push('Agent Plugin and automation projection lock must pin the same source commit');
  if (plugin.projections?.automations !== 'automations/') errors.push('Agent Plugin automation projection path is invalid');
  if (errors.length > 0) throw new Error(`distribution validation failed:\n${errors.join('\n')}`);
  return { files: bundle.files.length, sources: sources.sources.length, automationTemplates: automationIds.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await validateDistribution(process.argv[2] ?? root);
    process.stdout.write(`distribution validation passed: ${result.files} bundle files, ${result.sources} sources.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
