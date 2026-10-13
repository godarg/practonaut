import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm, lstat, readFile, writeFile, readdir, symlink, unlink, link, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuthorController } from '../../src/host/author-controller.ts';
import { createProjectStore } from '../../src/host/project-store.ts';
import { prepareRepairProject } from '../../src/authoring/recovery.ts';
import { canonicalJson, sha256Hex } from '../../src/canonical/index.ts';
import { makeRecording } from './recorder-fixture.ts';

const request = { expectedRevision: 0, title: 'Shorten the purchasing flow', author: 'Synthetic author', labels: ['Request', 'Approval', 'Purchase'] as [string,string,string] };
async function temp() { return mkdtemp(join(await realpath(tmpdir()), 'pn-recovery-host-')); }
test('a named draft survives close and restart without recording, IDs stay private, no compilation authority is stored', async () => {
  const dir = await temp(); let controller = await createAuthorController(dir);
  try {
    let reply = await controller.prepare(request);
    assert.match(reply.view.project!.id, /^repair-[a-f0-9]{32}$/);
    assert.equal(reply.scene.length > 0, true);
    assert.equal(reply.view.recording.active, false);
    const id = reply.view.project!.id;
    const saved = await controller.save(reply.view.revision);
    assert.equal(saved.savedProjects?.[0]?.title.de, request.title);
    const path = join(dir,'projects',id+'.json');
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
    assert.equal((await lstat(join(dir,'projects'))).mode & 0o777, 0o700);
    assert.deepEqual((await readdir(join(dir,'projects'))), [id+'.json']);
    await controller.close(); controller = await createAuthorController(dir);
    assert.equal((await controller.view()).project, null);
    assert.equal((await controller.view()).savedProjects?.[0]?.id, id);
    reply = await controller.open({ expectedRevision: 0, projectId: id });
    assert.equal(reply.view.project?.repair?.title.de, request.title);
    assert.equal(reply.view.recording.active, false);
    assert.equal(reply.view.readiness?.ready, false);
    await assert.rejects(controller.compiledWorld(reply.view.revision,'a'.repeat(64)), /Compile the current/);
    const updated = await controller.configure({expectedRevision:reply.view.revision,intent:{...reply.view.project!.repair!,title:{en:'Changed',de:'Geändert'},reviewedExamples:true}});
    await controller.save(updated.revision);
    await controller.close(); controller = await createAuthorController(dir);
    const opened = await controller.open({expectedRevision:0,projectId:id});
    assert.equal(opened.view.project?.repair?.title.de,'Geändert');
  } finally { await controller.close(); await rm(dir,{recursive:true,force:true}); }
});

test('project reads/writes reject traversal, symlink, hardlink, permissions, forged envelope and stale locks without unsafe cleanup', async () => {
  const dir = await temp(); const path = join(dir,'projects'), store = createProjectStore(path);
  const project = prepareRepairProject({id:'test-project',title:'Test',author:'Synthetic',labels:['A','B','C']});
  try {
    await assert.rejects(store.read('../outside'), /identifier/);
    await store.save(project); const file = join(path,'test-project.json');
    const original = await readFile(file);
    await chmod(file,0o644); await assert.rejects(store.read(project.id), /unsafe/); await chmod(file,0o600);
    const hard = join(dir,'hard'); await link(file,hard); await assert.rejects(store.save(project), /unsafe/); await unlink(hard);
    await unlink(file); const outside = join(dir,'outside'); await writeFile(outside,original,{mode:0o600}); await symlink(outside,file);
    await assert.rejects(store.save(project), /safe|unsafe/); assert.deepEqual(await readFile(outside),original); await unlink(file);
    await writeFile(file,original,{mode:0o600});
    const altered = JSON.parse(original.toString()); altered.project.notes='altered'; await writeFile(file,JSON.stringify(altered));
    await assert.rejects(store.read(project.id), /digest/); await writeFile(file,original);
    const lock = join(path,'.projects.lock'); await writeFile(lock,'existing owner',{mode:0o600});
    await assert.rejects(store.save(project), /Another writer/); assert.equal(await readFile(lock,'utf8'),'existing owner'); await unlink(lock);
    assert.deepEqual(await readFile(file),original);
    assert.deepEqual(await readdir(path),['test-project.json']);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('saved project revalidation rejects an invented source even with a freshly matching envelope digest', async () => {
  const dir = await temp(); const controller = await createAuthorController(dir);
  try {
    const prepared = await controller.prepare(request); const saved = await controller.save(prepared.view.revision);
    const file = join(dir,'projects',saved.project!.id+'.json'); const envelope = JSON.parse(await readFile(file,'utf8'));
    envelope.project.recordingIds=['r-missing']; envelope.sha256=sha256Hex(canonicalJson(envelope.project)); await writeFile(file,canonicalJson(envelope));
    const before = await controller.view();
    await assert.rejects(controller.open({expectedRevision:before.revision,projectId:saved.project!.id}), /source recording/);
    assert.deepEqual(await controller.view(),before);
  } finally { await controller.close(); await rm(dir,{recursive:true,force:true}); }
});

test('unrelated deletion preserves a prepared project; related deletion keeps historical evidence visible and invalidates readiness', async () => {
  const dir = await temp(); const controller = await createAuthorController(dir);
  async function capture() { const fixture=makeRecording();let v=await controller.view();v=await controller.start({expectedRevision:v.revision,metadata:{author:'Synthetic',license:'CC0-1.0',consent:'Synthetic self created',demonstration:'scripted'},initial:fixture.initial,fontsReady:true});v=await controller.gesture({expectedRevision:v.revision,gesture:fixture.gestures[0]!});return controller.stop({expectedRevision:v.revision}); }
  try {
    const unrelated = await capture(); let prepared=await controller.prepare({...request,expectedRevision:unrelated.view.revision});
    const related=await capture(); let analyzed=await controller.analyze(related.view.revision);
    const hypotheses=structuredClone(analyzed.project!.hypotheses),projectId=analyzed.project!.id;
    analyzed=await controller.delete(unrelated.recordingId,analyzed.revision); assert.equal(analyzed.project!.id,projectId);
    analyzed=await controller.delete(related.recordingId,analyzed.revision);
    assert.equal(analyzed.project!.id,projectId);assert.deepEqual(analyzed.project!.hypotheses,hypotheses);
    assert.equal(analyzed.readiness!.ready,false);assert.ok(analyzed.readiness!.missing.some(m=>m.code==='project_source_missing'));
    await assert.rejects(controller.save(analyzed.revision),/source recording/);
  } finally { await controller.close();await rm(dir,{recursive:true,force:true}); }
});

test('persistent project count budget fails before writes and does not damage previously saved work', async () => {
  const dir=await temp(),store=createProjectStore(join(dir,'projects'));
  try {
    for(let i=0;i<32;i++)await store.save(prepareRepairProject({id:'project-'+i,title:'Project '+i,author:'Synthetic',labels:['A','B','C']}));
    const original=await readFile(join(dir,'projects','project-0.json'));
    await assert.rejects(store.save(prepareRepairProject({id:'overflow',title:'Overflow',author:'Synthetic',labels:['A','B','C']})),/budget/);
    assert.equal((await store.list()).length,32);assert.deepEqual(await readFile(join(dir,'projects','project-0.json')),original);
    assert.equal((await readdir(join(dir,'projects'))).some(name=>name.startsWith('.')),false);
    const updated=prepareRepairProject({id:'project-0',title:'Updated at count limit',author:'Synthetic',labels:['A','B','C']});await store.save(updated);
    assert.equal((await store.read('project-0')).repair?.title.en,'Updated at count limit');
  } finally {await rm(dir,{recursive:true,force:true});}
});
