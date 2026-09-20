import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function validateDistribution(repositoryRoot = root) {
  const errors = [];
  const bundle = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/workflow-bundle.json'), 'utf8'));
  if (bundle.schemaVersion !== 1 || bundle.status !== 'draft') errors.push('workflow bundle must be schemaVersion 1 draft');
  if (!/^[0-9a-f]{40}$/.test(bundle.controlPlane?.commit ?? '')) errors.push('control-plane commit must be immutable');
  if (!/^[0-9a-f]{40}$/.test(bundle.architecture?.commit ?? '')) errors.push('architecture commit must be immutable');
  if (!Array.isArray(bundle.architecture?.affectedIdentifiers) || bundle.architecture.affectedIdentifiers.length === 0 || bundle.architecture.affectedIdentifiers.some((id) => typeof id !== 'string' || id.length === 0)) errors.push('architecture affected identifiers are required');
  if (!/^[0-9a-f]{40}$/.test(bundle.workflowSource?.commit ?? '')) errors.push('workflow source commit must be immutable');
  for (const file of bundle.files ?? []) {
    if (file.target.startsWith('/') || file.target.includes('..')) errors.push(`unsafe target path: ${file.target}`);
    if (!file.source || !file.target) errors.push('bundle entries require source and target');
  }
  const sources = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/sources.lock.json'), 'utf8'));
  if (sources.schemaVersion !== 1 || sources.status !== 'draft') errors.push('source lock must be schemaVersion 1 draft');
  const unverified = (sources.sources ?? []).filter((source) => source.verified !== true);
  if (unverified.length === 0) errors.push('draft source lock must retain an explicit unverified entry until release promotion');
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
  const lockedWorkflow = (sources.sources ?? []).find((source) => source.id === 'distribution-workflow');
  if (!lockedWorkflow || lockedWorkflow.commit !== bundle.workflowSource?.commit) errors.push('workflow bundle and source lock must pin the same workflow source commit');
  const consumerWorkflow = await readFile(path.join(repositoryRoot, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-quality.yml'), 'utf8');
  if (!consumerWorkflow.includes(`@${bundle.workflowSource?.commit}`) || !consumerWorkflow.includes(`controller_commit: ${controlPlaneCommit}`)) errors.push('consumer workflow must separate workflow source and Control Plane pins');
  const architectureWorkflow = await readFile(path.join(repositoryRoot, 'bootstrap/templates/consumer/.github/workflows/agentic-delivery-architecture-review.yml'), 'utf8');
  if (!architectureWorkflow.includes(`@${bundle.workflowSource?.commit}`) || !architectureWorkflow.includes(`architecture_commit: ${bundle.architecture?.commit}`) || !architectureWorkflow.includes(`affected_identifiers: '${JSON.stringify(bundle.architecture?.affectedIdentifiers)}'`)) errors.push('architecture review workflow must pin workflow source, Architecture, and affected identifiers separately');
  const feature = JSON.parse(await readFile(path.join(repositoryRoot, 'features/src/agentic-delivery/devcontainer-feature.json'), 'utf8'));
  if (feature.options?.controlPlaneCommit?.default !== controlPlaneCommit) errors.push('Dev Container Feature must default to the workflow bundle Control Plane commit');
  const plugin = JSON.parse(await readFile(path.join(repositoryRoot, 'packages/agent-plugin/plugin.json'), 'utf8'));
  if (plugin.schemaVersion !== 1 || plugin.status !== 'draft') errors.push('Agent Plugin manifest must be schemaVersion 1 draft');
  if (!/^[0-9a-f]{40}$/.test(plugin.generatedFrom?.primitiveSourceCommit ?? '')) errors.push('Agent Plugin must pin the Primitive source commit');
  if (!/^[0-9a-f]{40}$/.test(plugin.generatedFrom?.architectureCommit ?? '')) errors.push('Agent Plugin must pin the Architecture commit');
  if (errors.length > 0) throw new Error(`distribution validation failed:\n${errors.join('\n')}`);
  return { files: bundle.files.length, sources: sources.sources.length };
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
