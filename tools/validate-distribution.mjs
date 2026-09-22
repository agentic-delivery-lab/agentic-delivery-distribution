import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function validateDistribution(repositoryRoot = root) {
  const errors = [];
  const bundle = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/workflow-bundle.json'), 'utf8'));
  if (bundle.schemaVersion !== 1 || bundle.status !== 'draft') errors.push('workflow bundle must be schemaVersion 1 draft');
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
  if (sources.schemaVersion !== 1 || sources.status !== 'draft') errors.push('source lock must be schemaVersion 1 draft');
  const unverified = (sources.sources ?? []).filter((source) => source.verified !== true);
  if (sources.status === 'released' && unverified.length > 0) errors.push('released source lock must not contain unverified sources');
  const base = (sources.sources ?? []).find((source) => source.id === 'devcontainer-base-ubuntu-24.04');
  const baseFiles = [
    await readFile(path.join(repositoryRoot, '.devcontainer/Dockerfile'), 'utf8'),
    await readFile(path.join(repositoryRoot, '.devcontainer/devcontainer.json'), 'utf8'),
  ];
  if (!base || !base.reference || baseFiles.some((source) => !source.includes(base.reference))) errors.push('devcontainer files must use the locked base-image reference');
  if (base?.verified === true && !/sha256:[0-9a-f]{64}$/.test(base.digest ?? '')) errors.push('verified base image must have an immutable digest');
  const controlPlaneCommit = bundle.controlPlane?.commit;
  const lockedControlPlane = (sources.sources ?? []).find((source) => source.id === 'control-plane');
  if (!lockedControlPlane || lockedControlPlane.commit !== controlPlaneCommit) errors.push('workflow bundle and source lock must pin the same Control Plane commit');
  const lockedArchitecture = (sources.sources ?? []).find((source) => source.id === 'architecture');
  if (!lockedArchitecture || lockedArchitecture.commit !== bundle.architecture?.commit) errors.push('workflow bundle and source lock must pin the same Architecture commit');
  const capabilities = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/capabilities.lock.json'), 'utf8'));
  const capabilitiesSchema = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/capabilities-lock.v1.schema.json'), 'utf8'));
  if (capabilities.$schema !== './capabilities-lock.v1.schema.json' || capabilitiesSchema.title !== 'Agentic Delivery capabilities lock v1') errors.push('capabilities lock must identify its local schema');
  if (capabilities.schemaVersion !== 1 || capabilities.status !== 'draft') errors.push('capabilities lock must be schemaVersion 1 draft');
  if (capabilities.primitiveRepository !== 'agentic-delivery-lab/agentic-delivery-primitives') errors.push('capabilities lock primitive repository is invalid');
  if (!/^urn:agentic-delivery:primitive-release:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(capabilities.primitiveRelease ?? '')) errors.push('capabilities lock primitive release is invalid');
  if (!/^[0-9a-f]{40}$/.test(capabilities.sourceCommit ?? '') || !/^[0-9a-f]{64}$/.test(capabilities.contentSha256 ?? '')) errors.push('capabilities lock must pin Primitive source commit and content digest');
  const lockedPrimitives = (sources.sources ?? []).find((source) => source.id === 'primitives');
  if (!lockedPrimitives || lockedPrimitives.commit !== capabilities.sourceCommit || lockedPrimitives.repository !== capabilities.primitiveRepository) errors.push('source lock and capabilities lock must pin the same Primitive source');
  const lockedWorkflow = (sources.sources ?? []).find((source) => source.id === 'distribution-workflow');
  if (!lockedWorkflow || lockedWorkflow.commit !== bundle.workflowSource?.commit) errors.push('workflow bundle and source lock must pin the same workflow source commit');
  const consumerWorkflow = await readFile(path.join(repositoryRoot, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-quality.yml'), 'utf8');
  if (!consumerWorkflow.includes(`@${bundle.workflowSource?.commit}`) || !consumerWorkflow.includes(`controller_commit: ${controlPlaneCommit}`)) errors.push('consumer workflow must separate workflow source and Control Plane pins');
  if (!/^jobs:\n  control-plane-contract:\n    uses: agentic-delivery-lab\/agentic-delivery\/\.github\/workflows\/agentic-delivery-quality\.yml@[0-9a-f]{40}\n    with:\n      controller_commit: [0-9a-f]{40}\n/m.test(consumerWorkflow)) errors.push('consumer quality workflow must be structurally valid reusable-workflow YAML');
  const architectureWorkflow = await readFile(path.join(repositoryRoot, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-architecture-review.yml'), 'utf8');
  if (!architectureWorkflow.includes(`@${bundle.workflowSource?.commit}`) || !architectureWorkflow.includes(`architecture_commit: ${bundle.architecture?.commit}`) || !architectureWorkflow.includes(`affected_identifiers: '${JSON.stringify(bundle.architecture?.affectedIdentifiers)}'`)) errors.push('architecture review workflow must pin workflow source, Architecture, and affected identifiers separately');
  if (!/^jobs:\n  architecture:\n    uses: agentic-delivery-lab\/agentic-delivery\/\.github\/workflows\/agentic-delivery-architecture-review\.yml@[0-9a-f]{40}\n    with:\n      architecture_commit: [0-9a-f]{40}\n      affected_identifiers: '[^']+'\n/m.test(architectureWorkflow)) errors.push('architecture review workflow must be structurally valid reusable-workflow YAML');
  const feature = JSON.parse(await readFile(path.join(repositoryRoot, 'features/src/agentic-delivery/devcontainer-feature.json'), 'utf8'));
  if (feature.options?.controlPlaneCommit?.default !== controlPlaneCommit) errors.push('Dev Container Feature must default to the workflow bundle Control Plane commit');
  const plugin = JSON.parse(await readFile(path.join(repositoryRoot, 'packages/agent-plugin/plugin.json'), 'utf8'));
  if (plugin.schemaVersion !== 1 || plugin.status !== 'draft') errors.push('Agent Plugin manifest must be schemaVersion 1 draft');
  if (!/^[0-9a-f]{40}$/.test(plugin.generatedFrom?.primitiveSourceCommit ?? '')) errors.push('Agent Plugin must pin the Primitive source commit');
  if (!/^[0-9a-f]{40}$/.test(plugin.generatedFrom?.architectureCommit ?? '')) errors.push('Agent Plugin must pin the Architecture commit');
  if (plugin.generatedFrom?.primitiveRelease !== capabilities.primitiveRelease || plugin.generatedFrom?.primitiveSourceCommit !== capabilities.sourceCommit || plugin.generatedFrom?.primitiveContentSha256 !== capabilities.contentSha256) errors.push('Agent Plugin and capabilities lock must pin the same Primitive release and digest');
  if (plugin.generatedFrom?.architectureCommit !== bundle.architecture?.commit || plugin.generatedFrom?.architectureContentSha256 !== bundle.architecture?.contentSha256) errors.push('Agent Plugin and workflow bundle must pin the same Architecture release and digest');
  if (plugin.generatedFrom?.controlPlaneCommit !== bundle.controlPlane?.commit) errors.push('Agent Plugin and workflow bundle must pin the same Control Plane release');
  const automationLock = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/automation-projections.lock.json'), 'utf8'));
  const automationSchema = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/automation-projections-lock.v1.schema.json'), 'utf8'));
  if (automationSchema.title !== 'Agentic Delivery automation projections lock v1') errors.push('automation projection lock schema is not self-identifying');
  if (automationLock.schemaVersion !== 1 || !['draft', 'released', 'withdrawn'].includes(automationLock.status)) errors.push('automation projection lock must be schemaVersion 1 with a supported status');
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
