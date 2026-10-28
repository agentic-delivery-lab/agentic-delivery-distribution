import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBootstrap as applyProjection, checkBootstrap, recoverBootstrap, rollbackBootstrap } from './bootstrap-projection.mjs';
import { admitBootstrapSources, requireSourceRoots, withProjectionSnapshot } from './bootstrap-admission.mjs';
export { bootstrapPlan, checkBootstrap, recoverBootstrap, rollbackBootstrap, validateBootstrapManifest } from './bootstrap-projection.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function applyBootstrap(options = {}) {
  options = { ...options };
  if (!options.dryRun) options.sourceRoots = requireSourceRoots(options.sourceRoots);
  const preview = await applyProjection({ ...options, dryRun: true });
  if (options.dryRun) return { ...preview, sourceAdmission: 'not-evaluated' };
  const admitted = await admitBootstrapSources({ distributionRoot: options.distributionRoot ?? repositoryRoot,
    sourceRoots: options.sourceRoots });
  const result = await withProjectionSnapshot(admitted.data, (snapshot) => applyProjection({
    ...options, distributionRoot: snapshot,
  }));
  return { ...result, sourceAdmission: admitted.proof };
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
        sourceRoots: {
          controlPlaneRoot: process.env.AGENTIC_DELIVERY_CONTROL_PLANE_ROOT,
          architectureRoot: process.env.AGENTIC_DELIVERY_ARCHITECTURE_ROOT,
          primitivesRoot: process.env.AGENTIC_DELIVERY_CUSTOMIZATIONS_ROOT,
        },
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
