import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, readFile, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRepairProject, configureRepairProject } from '../../src/authoring/recovery.ts';
import { createAuthorController } from '../../src/host/author-controller.ts';
import { createProjectStore } from '../../src/host/project-store.ts';
import { snapshotElements } from '../../src/adapters/excalidraw/recorder.ts';
import { createRecordingStore } from '../../src/recordings/store.ts';
import { makeRecording } from './recorder-fixture.ts';

test('changing variant names preserves the authored starting scene', () => {
  const project=prepareRepairProject({id:'original',title:'Original scene',author:'Synthetic author',labels:['First original','Middle original','Last original']});
  const before=structuredClone(project.initialState);
  const intent=structuredClone(project.repair!);intent.cases[0]!.labels=['Variant first','Variant middle','Variant last'];
  const updated=configureRepairProject(project,intent);
  assert.deepEqual(updated.initialState,before);
  assert.deepEqual(updated.variants[0]!.labels,{first:'Variant first',middle:'Variant middle',last:'Variant last'});
});

test('only named system metadata is ignored, and corrupt project deletion preserves other files',async()=>{
  const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-project-delete-'));
  try{
    const store=createProjectStore(directory);
    await store.save(prepareRepairProject({id:'healthy',title:'Healthy',author:'Synthetic',labels:['A','B','C']}));
    await writeFile(join(directory,'.DS_Store'),'synthetic metadata',{mode:0o600});
    await writeFile(join(directory,'damaged.json'),'{damaged',{mode:0o600});
    await store.save(prepareRepairProject({id:'second',title:'Second',author:'Synthetic',labels:['A','B','C']}));
    assert.deepEqual((await store.catalog()).ignoredEntries,[{name:'.DS_Store',code:'os_metadata'}]);
    await store.delete('damaged');
    await assert.rejects(stat(join(directory,'damaged.json')),{code:'ENOENT'});
    assert.equal((await store.read('healthy')).id,'healthy');
    assert.equal(await readFile(join(directory,'.DS_Store'),'utf8'),'synthetic metadata');
    await symlink(join(directory,'healthy.json'),join(directory,'linked.json'));
    await store.delete('linked');
    await assert.rejects(stat(join(directory,'linked.json')),{code:'ENOENT'});
    await assert.rejects(store.delete('../healthy'),{code:'project_id_invalid'});
    assert.equal((await store.read('healthy')).id,'healthy');
    await writeFile(join(directory,'unknown.txt'),'not an allowed metadata name',{mode:0o600});
    await assert.rejects(store.save(prepareRepairProject({id:'third',title:'Third',author:'Synthetic',labels:['A','B','C']})),{code:'project_store_unsafe'});
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('saved recording references require explicit project deletion before recording deletion',async()=>{
  const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-recording-references-'));
  const controller=await createAuthorController(directory);
  try{
    const recording=makeRecording();recording.manifest.id='r-00000000000000000000000000000001';await createRecordingStore(join(directory,'recordings')).save(recording);
    const store=createProjectStore(join(directory,'projects'));
    const dependent=prepareRepairProject({id:'dependent',title:'Dependent',author:'Synthetic',labels:['A','B','C']});dependent.recordingIds=[recording.manifest.id];await store.save(dependent);
    await store.save(prepareRepairProject({id:'independent',title:'Independent',author:'Synthetic',labels:['A','B','C']}));
    const original=await readFile(join(directory,'recordings',recording.manifest.id+'.json'));
    await writeFile(join(directory,'projects','damaged.json'),'{damaged',{mode:0o600});
    let view=await controller.view();
    await assert.rejects(controller.delete(recording.manifest.id,view.revision),(error:unknown)=>(error as {code:string}).code==='recording_in_use'&&/damaged, dependent/.test((error as Error).message));
    assert.deepEqual(await readFile(join(directory,'recordings',recording.manifest.id+'.json')),original);
    view=await controller.deleteProject({expectedRevision:view.revision,projectId:'damaged'});
    await assert.rejects(controller.delete(recording.manifest.id,view.revision),{code:'recording_in_use'});
    view=await controller.deleteProject({expectedRevision:view.revision,projectId:'dependent'});
    view=await controller.delete(recording.manifest.id,view.revision);
    assert.equal(view.recordings.length,0);assert.deepEqual(view.savedProjects?.map(p=>p.id),['independent']);
    assert.equal((await store.read('independent')).id,'independent');
  }finally{await controller.close();await rm(directory,{recursive:true,force:true});}
});

test('unreadable recordings are named without blocking healthy author work after restart',async()=>{
  const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-recording-catalog-'));
  let controller=await createAuthorController(directory);
  try{
    const recording=makeRecording();recording.manifest.id='r-00000000000000000000000000000002';
    await createRecordingStore(join(directory,'recordings')).save(recording);
    await writeFile(join(directory,'recordings','r-00000000000000000000000000000003.json'),'{unreadable',{mode:0o600});
    await writeFile(join(directory,'recordings','.DS_Store'),'synthetic metadata',{mode:0o600});
    await controller.close();controller=await createAuthorController(directory);
    let view=await controller.view();assert.deepEqual(view.recordings.map(r=>r.id),[recording.manifest.id]);
    assert.deepEqual(view.unavailableRecordings,[{id:'.DS_Store',code:'recording_store_metadata'},{id:'r-00000000000000000000000000000003',code:'recording_store_invalid'}]);
    view=await controller.analyze(view.revision);assert.deepEqual(view.project?.recordingIds,[recording.manifest.id]);
    const prepared=await controller.prepare({expectedRevision:view.revision,title:'Healthy new exercise',author:'Synthetic',labels:['A','B','C']});assert.ok(prepared.view.project);
    assert.equal(await readFile(join(directory,'recordings','r-00000000000000000000000000000003.json'),'utf8'),'{unreadable');
    assert.equal(await readFile(join(directory,'recordings','.DS_Store'),'utf8'),'synthetic metadata');
  }finally{await controller.close();await rm(directory,{recursive:true,force:true});}
});

test('damaged entries are isolated in the catalog without deletion, while reads remain fail closed', async () => {
  const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-store-isolation-'));
  try {
    const store=createProjectStore(directory);
    await store.save(prepareRepairProject({id:'healthy',title:'Healthy',author:'Synthetic author',labels:['A','B','C']}));
    await writeFile(join(directory,'broken.json'),'{broken',{mode:0o600});
    await symlink(join(directory,'healthy.json'),join(directory,'unsafe.json'));
    const catalog=await (store as unknown as {catalog():Promise<{projects:Array<{id:string}>,unavailable:Array<{id:string,code:string}>}>}).catalog();
    assert.deepEqual(catalog.projects.map(p=>p.id),['healthy']);
    assert.deepEqual(catalog.unavailable,[{id:'broken',code:'project_integrity'},{id:'unsafe',code:'project_store_unsafe'}]);
    assert.equal(await readFile(join(directory,'broken.json'),'utf8'),'{broken');
    await assert.rejects(store.read('broken'),{code:'project_integrity'});
    await assert.rejects(store.read('unsafe'),{code:'project_store_unsafe'});
    assert.equal((await store.read('healthy')).id,'healthy');
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('corruption cannot block restarting, opening a healthy project or preparing another',async()=>{
  const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-author-corrupt-'));
  let controller=await createAuthorController(directory);
  try{
    let prepared=await controller.prepare({expectedRevision:0,title:'Healthy author project',author:'Synthetic author',labels:['A','B','C']});
    const projectId=prepared.view.project!.id;
    await controller.save(prepared.view.revision);
    await writeFile(join(directory,'projects','broken.json'),'{broken',{mode:0o600});
    await controller.close();controller=await createAuthorController(directory);
    let view=await controller.view();
    assert.equal(view.savedProjects?.[0]?.id,projectId);
    assert.deepEqual(view.unavailableProjects,[{id:'broken',code:'project_integrity'}]);
    prepared=await controller.open({expectedRevision:view.revision,projectId});
    assert.equal(prepared.view.project?.id,projectId);
    prepared=await controller.prepare({expectedRevision:prepared.view.revision,title:'Another author project',author:'Synthetic author',labels:['First','Middle','Last']});
    await controller.start({expectedRevision:prepared.view.revision,initial:snapshotElements(prepared.scene),fontsReady:true,metadata:{author:'Synthetic author',license:'CC0-1.0',consent:'Synthetic local recording permission',demonstration:'scripted'}});
    view=await controller.view();assert.equal(view.recording.active,true);
    await controller.stop({expectedRevision:view.revision});
    view=await controller.view();await controller.analyze(view.revision);
    assert.equal(await readFile(join(directory,'projects','broken.json'),'utf8'),'{broken');
  }finally{await controller.close();await rm(directory,{recursive:true,force:true});}
});
