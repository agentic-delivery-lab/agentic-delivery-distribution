import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(repositoryRoot, 'manifests/workflow-bundle.json');

export async function validateBootstrapManifest(root = repositoryRoot) {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifests/workflow-bundle.json'), 'utf8'));
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push('workflow bundle schemaVersion must be 1');
  if (!/^[0-9a-f]{40}$/.test(String(manifest.controlPlane?.commit ?? ''))) errors.push('control-plane commit must be immutable');
  if (!/^[0-9a-f]{40}$/.test(String(manifest.workflowSource?.commit ?? ''))) errors.push('workflow source commit must be immutable');
  if (!Array.isArray(manifest.files) || manifest.files.some((file) => !file?.target || !file?.source)) errors.push('workflow bundle files must have source and target');
  for (const file of manifest.files ?? []) {
    if (file.target.includes('..') || file.target.startsWith('/')) errors.push(`unsafe consumer target: ${file.target}`);
  }
  if (errors.length > 0) throw new Error(`distribution manifest check failed:\n${errors.join('\n')}`);
  return manifest;
}

export async function checkBootstrap(root = repositoryRoot) {
  await access(manifestPath);
  return validateBootstrapManifest(root);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = await checkBootstrap(process.argv[2] ?? repositoryRoot);
    process.stdout.write(`bootstrap manifest is valid for ${manifest.controlPlane.commit}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
