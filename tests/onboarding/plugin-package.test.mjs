import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePluginPackage } from '../../tools/validate-distribution.mjs';

const namespace = 'io.github.agentic-delivery-lab';
function manifest() {
  return {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'agentic-delivery', version: '0.1.0-draft.7',
    description: 'Manual read-only automation templates.',
    extensions: { [namespace]: {
      schemaVersion: 1, id: 'agentic-delivery', status: 'draft',
      generatedFrom: {}, projections: { automations: 'automations/' },
    } },
  };
}

test('current publisher extracts factory provenance from the standard package', () => {
  const input = manifest();
  assert.deepEqual(validatePluginPackage(input), input.extensions[namespace]);
});

for (const [label, change] of [
  ['legacy flat metadata', (m) => Object.assign(m, m.extensions[namespace])],
  ['unknown standard version', (m) => { m.$schema = m.$schema.replace('1.0.0', '2.0.0'); }],
  ['wrong package name', (m) => { m.name = 'other'; }],
  ['empty version', (m) => { m.version = ''; }],
  ['missing description', (m) => { delete m.description; }],
  ['foreign extension', (m) => { m.extensions['example.org'] = {}; }],
  ['conflicting factory version', (m) => { m.extensions[namespace].version = 'other'; }],
  ['unsupported factory contract', (m) => { m.extensions[namespace].schemaVersion = 2; }],
  ['withdrawn package', (m) => { m.extensions[namespace].status = 'withdrawn'; }],
  ['placeholder projection', (m) => { m.extensions[namespace].projections.skills = 'skills/'; }],
  ['unsafe automation path', (m) => { m.extensions[namespace].projections.automations = '../automations/'; }],
  ['array provenance', (m) => { m.extensions[namespace].generatedFrom = []; }],
]) {
  test(`current publisher rejects ${label}`, () => {
    const input = manifest(); change(input);
    assert.throws(() => validatePluginPackage(input), /unsupported Agent Plugin package/);
  });
}
