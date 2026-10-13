import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { mkdtemp, realpath, rm, mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuthorController } from '../../src/host/author-controller.ts';
import { createProjectStore } from '../../src/host/project-store.ts';
import { prepareRepairProject, revalidateAuthorProject } from '../../src/authoring/recovery.ts';
import { observationRef } from '../../src/authoring/project.ts';
import { canonicalJson, sha256Hex } from '../../src/canonical/index.ts';
import { createGestureRecorder, projectSnapshot, validateRecording } from '../../src/adapters/excalidraw/recorder.ts';
import { toRaw } from '../../src/adapters/excalidraw/raw.ts';
import type { AuthorView } from '../../src/host/author-protocol.ts';
import type { Recording } from '../../src/adapters/excalidraw/recorder-types.ts';
import type { State } from '../../src/world/types.ts';

async function temp(){return mkdtemp(join(await realpath(tmpdir()),'pn-project-recovery-'));}
function demonstration(initial:State){
  const deleted=structuredClone(initial);deleted.objects.b!.deleted=true;if(deleted.objects.ab?.type==='arrow')deleted.objects.ab.to=null;if(deleted.objects.bc?.type==='arrow')deleted.objects.bc.from=null;
  const reconnected=structuredClone(deleted);if(reconnected.objects.ab?.type==='arrow')reconnected.objects.ab.to='c';
  const finished=structuredClone(reconnected);finished.objects.bc!.deleted=true;
  const recorder=createGestureRecorder();recorder.start(toRaw(initial),true);for(const state of [deleted,reconnected,finished]){recorder.observe(toRaw(state));recorder.boundary('key');}recorder.stop();return recorder;
}
async function compiled(dir:string){
  const controller=await createAuthorController(dir);let view=(await controller.prepare({expectedRevision:0,title:'Shorten a process',author:'Synthetic author',labels:['Request','Approval','Purchase']})).view;
  const source=demonstration(view.project!.initialState);const ids:string[]=[];
  for(let i=0;i<2;i++){view=await controller.start({expectedRevision:view.revision,metadata:{author:'Synthetic author',license:'CC0-1.0',consent:'Self-created synthetic fixture',demonstration:'scripted'},initial:source.initial,fontsReady:true});for(const gesture of source.gestures)view=await controller.gesture({expectedRevision:view.revision,gesture});const stopped=await controller.stop({expectedRevision:view.revision});view=stopped.view;ids.push(stopped.recordingId);view=await controller.analyze(view.revision);}
  const second=await controller.read(ids[1]!);for(const [hypothesisId,index] of [['delete-keeps-arrows-v1',0],['reconnect-v1',1],['disconnect-v1',2]] as const)view=await controller.confirm({expectedRevision:view.revision,confirmation:{hypothesisId,evidence:observationRef(second,index)}});
  view=await controller.configure({expectedRevision:view.revision,intent:{...view.project!.repair!,reviewedExamples:true}});
  return{controller,view,result:await controller.compile(view.revision),ids};
}
async function appendCounterexample(dir:string,id:string){
  const file=join(dir,'recordings',id+'.json');const envelope=JSON.parse(await readFile(file,'utf8')) as {recording:Recording;sha256:string};
  const before=projectSnapshot(envelope.recording.gestures.at(-1)!.after);assert.equal(before.ok,true);if(!before.ok)throw Error('fixture');
  const after=structuredClone(before.state);after.objects.a!.deleted=true;if(after.objects.ab?.type==='arrow'){after.objects.ab.deleted=true;after.objects.ab.from=null;after.objects.ab.to=null;}
  const rawBefore=toRaw(before.state),rawAfter=toRaw(after);for(const frame of rawAfter.filter(e=>e.type==='frame'))Object.assign(frame,rawBefore.find(e=>e.id===frame.id)!);
  const recorder=createGestureRecorder();recorder.start(rawBefore,true);recorder.observe(rawAfter);recorder.boundary('key');recorder.stop();
  const additional={...recorder.gestures[0]!,index:envelope.recording.gestures.length};assert.equal(additional.quarantined,false,JSON.stringify(additional.quarantineReasons));assert.deepEqual(additional.unmodeled,[]);assert.deepEqual(additional.before,envelope.recording.gestures.at(-1)!.after);
  envelope.recording.gestures.push(additional);validateRecording(envelope.recording);envelope.sha256=sha256Hex(canonicalJson(envelope.recording));await writeFile(file,canonicalJson(envelope),{mode:0o600});return envelope.recording;
}

test('saving a project invalidates its compilation capability until a fresh compilation',async()=>{
  const dir=await temp();const fixture=await compiled(dir);
  try {assert.equal((await fixture.controller.compiledWorld(fixture.view.revision,fixture.result.worldSha256)).id,fixture.view.project!.id);const saved=await fixture.controller.save(fixture.view.revision);await assert.rejects(fixture.controller.compiledWorld(saved.revision,fixture.result.worldSha256),/Compile the current/);const fresh=await fixture.controller.compile(saved.revision);assert.equal((await fixture.controller.compiledWorld(saved.revision,fresh.worldSha256)).id,saved.project!.id);}
  finally{await fixture.controller.close();await rm(dir,{recursive:true,force:true});}
});

test('an added valid counterexample demotes source authority and blocks an unchanged hash-valid cached world',async()=>{
  const dir=await temp();const fixture=await compiled(dir);
  try {const changed=await appendCounterexample(dir,fixture.ids[1]!);const restored=revalidateAuthorProject(fixture.view.project!,[await fixture.controller.read(fixture.ids[0]!),changed]);assert.equal(restored.hypotheses.find(h=>h.id==='delete-keeps-arrows-v1')!.status,'refuted');assert.ok(restored.hypotheses.find(h=>h.id==='delete-keeps-arrows-v1')!.refutingEvidence.length);await assert.rejects(fixture.controller.compiledWorld(fixture.view.revision,fixture.result.worldSha256),/changed|current project|revalidat/);await assert.rejects(fixture.controller.compiledWorld(fixture.view.revision,fixture.result.worldSha256),/Compile the current/);}
  finally{await fixture.controller.close();await rm(dir,{recursive:true,force:true});}
});

test('a safe orphan pending file cannot make committed projects disappear and remains bounded in the write budget',async()=>{
  const dir=await temp(),store=createProjectStore(join(dir,'projects')),project=prepareRepairProject({id:'committed',title:'Saved work',author:'Synthetic',labels:['A','B','C']});
  try {await store.save(project);await writeFile(join(dir,'projects','.pending-'+'a'.repeat(32)),'partial interrupted write',{mode:0o600});assert.equal((await store.list())[0]!.id,'committed');assert.equal((await store.read('committed')).repair?.title.en,'Saved work');await store.save({...project,notes:'continued'});assert.equal((await store.read('committed')).notes,'continued');}
  finally{await rm(dir,{recursive:true,force:true});}
});

test('after a real writer death committed projects remain readable and an unproven lock is never removed',async()=>{
  const dir=await temp(),path=join(dir,'projects'),store=createProjectStore(path),project=prepareRepairProject({id:'committed',title:'Saved work',author:'Synthetic',labels:['A','B','C']});
  try {
    await store.save(project);
    const script=join(dir,'interrupted-writer.mjs');await writeFile(script,`import {open} from 'node:fs/promises';import {constants} from 'node:fs';import {join} from 'node:path';const directory=process.argv[2];const lock=await open(join(directory,'.projects.lock'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);const pending=await open(join(directory,'.pending-'+ 'b'.repeat(32)),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await pending.writeFile('partial');await pending.sync();process.send('pending-fsynced');setInterval(()=>{},1000);`,{mode:0o600});
    const child=fork(script,[path],{stdio:['ignore','ignore','ignore','ipc']});
    try {await new Promise<void>((done,reject)=>{child.once('message',message=>{assert.equal(message,'pending-fsynced');done();});child.once('error',reject);});const exited=new Promise<{signal:NodeJS.Signals|null}>((done)=>child.once('exit',(_code,signal)=>done({signal})));child.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');}
    finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
    assert.equal((await store.list())[0]!.id,'committed');assert.equal((await store.read('committed')).id,'committed');const before=await lstat(join(path,'.projects.lock'));await assert.rejects(store.save(project),/other|Another|interrupted/);assert.equal((await lstat(join(path,'.projects.lock'))).ino,before.ino);
  } finally{await rm(dir,{recursive:true,force:true});}
});

async function deadWriter(directory:string,nonce:string):Promise<number>{
  const script=join(directory,'..','dead-writer-'+nonce+'.mjs');
  await writeFile(script,`import {open} from 'node:fs/promises';import {constants} from 'node:fs';import {join} from 'node:path';const path=process.argv[2];const handle=await open(join(path,'.projects.lock'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await handle.writeFile(JSON.stringify({schema:'practonaut.project-lock/1',pid:process.pid,nonce:'${nonce}'}));await handle.sync();const pending=await open(join(path,'.pending-'+ '${nonce}'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await pending.writeFile('incomplete new revision');await pending.sync();process.send('ready');setInterval(()=>{},1000);`,{mode:0o600});
  const child=fork(script,[directory],{stdio:['ignore','ignore','ignore','ipc']});
  try {
    await new Promise<void>((done,reject)=>{child.once('message',message=>{assert.equal(message,'ready');done();});child.once('error',reject);});
    const pid=child.pid!;const exited=new Promise<NodeJS.Signals|null>(done=>child.once('exit',(_code,signal)=>done(signal)));child.kill('SIGKILL');assert.equal(await exited,'SIGKILL');return pid;
  } finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
}
test('only one nonce-exclusive cleaner may recover a proved-dead own-uid writer; concurrent saves preserve committed data',async()=>{
  const dir=await temp(),path=join(dir,'projects'),project=prepareRepairProject({id:'committed',title:'Before crash',author:'Synthetic',labels:['A','B','C']}),store=createProjectStore(path);
  try {
    await store.save(project);const nonce='c'.repeat(32),pid=await deadWriter(path,nonce);assert.throws(()=>process.kill(pid,0),(error:unknown)=>(error as NodeJS.ErrnoException).code==='ESRCH');
    const results=await Promise.allSettled([createProjectStore(path).save({...project,notes:'first recovery'}),createProjectStore(path).save({...project,notes:'second recovery'})]);
    assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(results.filter(r=>r.status==='rejected').every(r=>r.status==='rejected'&&['project_store_busy','project_store_unsafe'].includes((r.reason as {code:string}).code)),true);
    assert.ok(['first recovery','second recovery'].includes((await store.read('committed')).notes));
    const entries=await readdir(path);assert.equal(entries.includes('.projects.lock'),false);assert.equal(entries.some(name=>name.startsWith('.recovery-')),false);assert.equal(entries.includes('.pending-'+nonce),true);
    await store.save({...project,notes:'normal later continuation'});assert.equal((await store.read('committed')).notes,'normal later continuation');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('live owners and interrupted cleaner claims are preserved while committed projects stay readable',async()=>{
  const dir=await temp(),path=join(dir,'projects'),store=createProjectStore(path),project=prepareRepairProject({id:'committed',title:'Saved',author:'Synthetic',labels:['A','B','C']});
  try {
    await store.save(project);const lock=join(path,'.projects.lock');await writeFile(lock,canonicalJson({schema:'practonaut.project-lock/1',pid:process.pid,nonce:'d'.repeat(32)}),{mode:0o600});const live=await lstat(lock);
    const liveBytes=await readFile(lock);let denied:unknown;try{await store.save(project);}catch(error){denied=error;}
    let ownerAlive=true;try{process.kill(process.pid,0);}catch{ownerAlive=false;}
    const afterLock=await lstat(lock).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
    const lockUnchanged=afterLock?.ino===live.ino&&Boolean((await readFile(lock).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return Buffer.alloc(0);throw error;})).equals(liveBytes));
    assert.deepEqual({rejectedCode:(denied as {code?:string}|undefined)?.code,ownerAlive,lockUnchanged},{rejectedCode:'project_store_busy',ownerAlive:true,lockUnchanged:true});
    assert.equal((await store.list())[0]!.id,'committed');
    const {unlink}=await import('node:fs/promises');await unlink(lock);const nonce='e'.repeat(32);await deadWriter(path,nonce);const old=await readFile(lock),oldStat=await lstat(lock);
    const claimed=join(path,'.recovery-'+nonce+'.claim');await writeFile(claimed,'interrupted cleaner',{mode:0o600});const ownedClaim=await lstat(claimed);
    await assert.rejects(store.save(project),/already claimed|interrupted/);assert.deepEqual(await readFile(lock),old);assert.equal((await lstat(lock)).ino,oldStat.ino);assert.equal((await lstat(claimed)).ino,ownedClaim.ino);assert.equal((await store.read('committed')).id,'committed');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('relative store paths are frozen at creation and cannot follow a later current-directory change',async()=>{
  const dir=await temp(),old=process.cwd();
  try {
    await mkdir(join(dir,'first'));await mkdir(join(dir,'second'));process.chdir(join(dir,'first'));const store=createProjectStore('projects');
    const project=prepareRepairProject({id:'committed',title:'First directory',author:'Synthetic',labels:['A','B','C']});await store.save(project);
    process.chdir(join(dir,'second'));assert.equal((await store.read('committed')).repair!.title.en,'First directory');await store.save({...project,notes:'still in first'});assert.equal((await readdir(join(dir,'second'))).length,0);
  }finally{process.chdir(old);await rm(dir,{recursive:true,force:true});}
});

test('a replacement live-writer inode and unsafe pending links cannot be recovered as the crashed owner',async()=>{
  const dir=await temp(),path=join(dir,'projects'),store=createProjectStore(path),project=prepareRepairProject({id:'committed',title:'Saved',author:'Synthetic',labels:['A','B','C']});
  try {
    await store.save(project);await deadWriter(path,'f'.repeat(32));const lock=join(path,'.projects.lock'),old=await lstat(lock);
    const {unlink,symlink,link}=await import('node:fs/promises');
    // Keep the dead writer's inode allocated, so the replacement cannot reuse its number (Linux file
    // systems hand a freed inode number out again at once).
    await link(lock,join(dir,'dead-writer-lock'));await unlink(lock);await writeFile(lock,canonicalJson({schema:'practonaut.project-lock/1',pid:process.pid,nonce:'1'.repeat(32)}),{mode:0o600});const replacement=await lstat(lock),bytes=await readFile(lock);assert.notEqual(replacement.ino,old.ino);
    await assert.rejects(store.save(project),/Another writer/);assert.equal((await lstat(lock)).ino,replacement.ino);assert.deepEqual(await readFile(lock),bytes);
    await unlink(lock);const pending=join(path,'.pending-'+'2'.repeat(32)),outside=join(dir,'outside');await writeFile(outside,'untouched',{mode:0o600});await symlink(outside,pending);assert.equal((await store.list())[0]!.id,'committed');assert.equal((await store.read('committed')).id,'committed');await assert.rejects(store.save(project),/safe/);assert.equal(await readFile(outside,'utf8'),'untouched');await unlink(pending);
    await link(outside,pending);assert.equal((await store.list())[0]!.id,'committed');await assert.rejects(store.save(project),/safe/);assert.equal(await readFile(outside,'utf8'),'untouched');
  }finally{await rm(dir,{recursive:true,force:true});}
});
