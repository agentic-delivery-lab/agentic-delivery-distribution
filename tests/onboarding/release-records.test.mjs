import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {validateDistribution,validatePluginPackage} from '../../tools/validate-distribution.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const records=[['bundle','manifests/workflow-bundle.json'],['sources','manifests/sources.lock.json'],
  ['capabilities','manifests/capabilities.lock.json'],['automations','manifests/automation-projections.lock.json'],
  ['plugin','packages/agent-plugin/plugin.json']];
const namespace='io.github.agentic-delivery-lab';
async function fixture(t,status='released') {
  const directory=await mkdtemp(path.join(os.tmpdir(),'distribution-release-record-data-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  // Data only. No source checkout, .git, implementation or dependencies copied.
  for(const relative of ['manifests','.devcontainer','bootstrap/templates','packages/agent-plugin']) {
    await mkdir(path.dirname(path.join(directory,relative)),{recursive:true});
    await cp(path.join(root,relative),path.join(directory,relative),{recursive:true});
  }
  const values={};
  for(const [id,relative]of records) {
    const value=JSON.parse(await readFile(path.join(directory,relative),'utf8'));
    (id==='plugin'?value.extensions[namespace]:value).status=status;
    values[id]=value;
    await writeFile(path.join(directory,relative),JSON.stringify(value));
  }
  return {directory,values,async save(id){await writeFile(path.join(directory,records.find(([key])=>key===id)[1]),JSON.stringify(values[id]));}};
}

test('publisher validates coherent released candidate data without promoting current draft records',async(t)=>{
  const f=await fixture(t);
  assert.deepEqual(await validateDistribution(f.directory),{files:3,sources:6,automationTemplates:2});
  assert.equal(JSON.parse(await readFile(path.join(root,records[0][1]),'utf8')).status,'draft');
});
test('standard plugin reader accepts released candidate metadata',async(t)=>{
  const f=await fixture(t);
  assert.equal(validatePluginPackage(f.values.plugin).status,'released');
});
for(const status of ['draft','released']) for(const [id]of records.slice(1)) {
  test(`${status} publisher rejects mixed ${id} lifecycle`,async(t)=>{
    const f=await fixture(t,status);
    (id==='plugin'?f.values[id].extensions[namespace]:f.values[id]).status=status==='draft'?'released':'draft';
    await f.save(id);
    await assert.rejects(validateDistribution(f.directory),/status|publication state/i);
  });
}
for(const [id]of records) test(`publisher rejects withdrawn ${id}`,async(t)=>{
  const f=await fixture(t);
  (id==='plugin'?f.values[id].extensions[namespace]:f.values[id]).status='withdrawn';await f.save(id);
  await assert.rejects(validateDistribution(f.directory));
});
for(const sourceId of ['devcontainer-base-ubuntu-24.04','control-plane','architecture','primitives','distribution-workflow','source-validation']) {
  test(`released candidate rejects unverified ${sourceId}`,async(t)=>{
    const f=await fixture(t);f.values.sources.sources.find(s=>s.id===sourceId).verified=false;await f.save('sources');
    await assert.rejects(validateDistribution(f.directory),/unverified|validation tool source/i);
  });
}
for(const name of ['Dockerfile','devcontainer.json']) test(`base-image pin in a comment cannot conceal changed ${name}`,async(t)=>{
  const f=await fixture(t,'draft');const expected=f.values.sources.sources[0];
  const wrong='mcr.microsoft.com/devcontainers/base:ubuntu-24.04@sha256:'+'0'.repeat(64);
  const value=name==='Dockerfile'?`FROM ${wrong}\n# ${expected.reference}@${expected.digest}\n`:
    JSON.stringify({image:wrong,description:`${expected.reference}@${expected.digest}`});
  await writeFile(path.join(f.directory,'.devcontainer',name),value);
  await assert.rejects(validateDistribution(f.directory),/locked base.image/i);
});

test('released candidate rejects an array that coerces to a valid image digest',async(t)=>{
  const f=await fixture(t);const base=f.values.sources.sources[0];base.digest=[base.digest];await f.save('sources');
  await assert.rejects(validateDistribution(f.directory),/locked base.image digest/);
});
