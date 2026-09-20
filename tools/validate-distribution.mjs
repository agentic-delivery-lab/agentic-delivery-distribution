import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function validateDistribution(repositoryRoot = root) {
  const errors = [];
  const bundle = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/workflow-bundle.json'), 'utf8'));
  if (bundle.schemaVersion !== 1 || bundle.status !== 'draft') errors.push('workflow bundle must be schemaVersion 1 draft');
  if (!/^[0-9a-f]{40}$/.test(bundle.controlPlane?.commit ?? '')) errors.push('control-plane commit must be immutable');
  for (const file of bundle.files ?? []) {
    if (file.target.startsWith('/') || file.target.includes('..')) errors.push(`unsafe target path: ${file.target}`);
    if (!file.source || !file.target) errors.push('bundle entries require source and target');
  }
  const sources = JSON.parse(await readFile(path.join(repositoryRoot, 'manifests/sources.lock.json'), 'utf8'));
  if (sources.schemaVersion !== 1 || sources.status !== 'draft') errors.push('source lock must be schemaVersion 1 draft');
  const unverified = (sources.sources ?? []).filter((source) => source.verified !== true);
  if (unverified.length === 0) errors.push('draft source lock must retain an explicit unverified entry until release promotion');
  const plugin = JSON.parse(await readFile(path.join(repositoryRoot, 'packages/agent-plugin/plugin.json'), 'utf8'));
  if (plugin.schemaVersion !== 1 || plugin.status !== 'draft') errors.push('Agent Plugin manifest must be schemaVersion 1 draft');
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
