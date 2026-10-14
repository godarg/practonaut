import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';import {isDeepStrictEqual} from 'node:util';
import {validateWorld} from '../../src/world/index.ts';import {createPracticeController} from '../../src/host/session.ts';import {createProductionMirror} from '../../src/host/mirror.ts';import {parseExcalidraw} from '../../src/checker/excalidraw.ts';import {parseExportPair} from '../../src/host/export-pair.ts';import {sha256Hex,canonicalJson} from '../../src/canonical/index.ts';import {HOST_LIMITS} from '../../src/host/limits.ts';
const world=async()=>validateWorld(JSON.parse(await readFile('examples/worlds/flow-diagram/world.json','utf8')));
function committed(view:ReturnType<Awaited<ReturnType<typeof createPracticeController>>['view']>){const {mirrorHealth,...rest}=view;return rest;}
test('exact current export binds opaque Unicode bytes, independent native read-back and one unchanged revision',{timeout:30000},async()=>{
 const w=await world();const a=w.tasks.find(task=>task.id==='T3')!.initialState!.objects.a;assert.ok(a?.type==='step');a.label='Ähre 🚀';let produced='',fault:'none'|'wrong'|'large'='none';
 const controller=await createPracticeController(w,{seed:42,taskId:'T3'},async initial=>{const real=await createProductionMirror(initial);return {...real,async exportNative(context){produced=await real.exportNative!(context);if(fault==='wrong'){const value=JSON.parse(produced);value.elements.find((element:{type:string})=>element.type==='text').text='Wrong native label';value.elements.find((element:{type:string})=>element.type==='text').originalText='Wrong native label';return JSON.stringify(value);}return fault==='large'?produced+' '.repeat(HOST_LIMITS.replyBytes):produced;}};});
 try{
  const before=controller.view(),reply=await controller.export({expectedRevision:before.revision});assert.equal(reply.ok,true);if(!reply.ok)return;
  assert.equal(reply.value.native.utf8,produced);assert.equal(reply.value.native.sha256,sha256Hex(produced));assert.equal(reply.value.session.sha256,sha256Hex(reply.value.session.utf8));assert.ok(reply.value.native.utf8.includes('Ähre 🚀'));assert.equal(canonicalJson(parseExcalidraw(produced)),canonicalJson(before.state));
  const pair=parseExportPair(reply.value.session.utf8,w,produced);assert.equal(pair.revision,before.revision);assert.equal(pair.session.hash,before.hash);assert.equal(pair.hash,before.hash);assert.deepEqual(pair.world,pair.session.world);assert.equal(pair.seed,pair.session.seed);assert.equal(pair.taskId,pair.session.taskId);assert.deepEqual(controller.view(),before);
  for(const marker of ['http://practonaut.invalid','127.0.0.1','token','/Users/','pn-real-client','PN_PRIVATE'])assert.equal(reply.value.native.utf8.includes(marker),false);
  for(const mutate of [(value:any)=>value.nativeSha256='0'.repeat(64),(value:any)=>value.sessionSha256='0'.repeat(64),(value:any)=>value.seed++, (value:any)=>value.extra=true,(value:any)=>value.revision=Number.MAX_SAFE_INTEGER+1]){const value=JSON.parse(reply.value.session.utf8);mutate(value);assert.throws(()=>parseExportPair(JSON.stringify(value),w,produced),/binding is invalid/);}
  const stale=await controller.export({expectedRevision:999});assert.equal(stale.ok,false);if(!stale.ok)assert.equal(stale.error.code,'stale_base');
  fault='wrong';const wrong=await controller.export({expectedRevision:before.revision});assert.equal(wrong.ok,false);if(!wrong.ok)assert.equal(wrong.error.code,'real_tool_disagrees');assert.deepEqual(committed(controller.view()),committed(before));
  await mkdir('.local/native-export',{recursive:true});const invalid=JSON.parse(produced);invalid.elements.find((element:{type:string})=>element.type==='text').text='Wrong native label';await writeFile('.local/native-export/rejected-native.excalidraw',JSON.stringify(invalid));
  fault='large';const large=await controller.export({expectedRevision:before.revision});assert.equal(large.ok,false);if(!large.ok)assert.equal(large.error.code,'result_too_large');assert.deepEqual(committed(controller.view()),committed(before));
 }finally{await controller.close();}
});
test('late successful native mirror write is rolled back while all mirror reads stay locked',{timeout:30000},async()=>{
 const w=await world();let released!:()=>void,entered!:()=>void;const gate=new Promise<void>(done=>released=done),ready=new Promise<void>(done=>entered=done);let physical=structuredClone(w.initialState);
 const controller=await createPracticeController(w,{seed:42,taskId:'T3'},async initial=>{const real=await createProductionMirror(initial);return {...real,async apply(transition){const result=await real.apply(transition);physical=await real.snapshot();entered();await gate;return result;}};});
 try{const before=controller.view(),deadline=performance.now()+3000,pending=controller.act({expectedRevision:before.revision,action:{name:'move_step',params:{id:'a',x:200,y:220}}},{deadline});await ready;
  assert.equal(isDeepStrictEqual(physical,before.state),false);for(const reply of [await controller.png(),await controller.check({expectedRevision:before.revision}),await controller.export({expectedRevision:before.revision})]){assert.equal(reply.ok,false);if(!reply.ok)assert.equal(reply.error.code,'session_busy');}
  assert.deepEqual(committed(controller.view()),committed(before));// The real write must finish before the deadline (slower runners need more than 200 ms) and is held past it.
  await new Promise(done=>setTimeout(done,Math.max(0,deadline-performance.now())+250));released();const reply=await pending;assert.equal(reply.ok,false);if(!reply.ok)assert.equal(reply.error.code,'mirror_timeout');assert.deepEqual(committed(controller.view()),committed(before));const exported=await controller.export({expectedRevision:before.revision});assert.equal(exported.ok,true);if(exported.ok)assert.equal(canonicalJson(parseExcalidraw(exported.value.native.utf8)),canonicalJson(before.state));
 }finally{released();await controller.close();}
});
test('model-only mode refuses the entire export pair without changing the committed session',async()=>{
 const controller=await createPracticeController(await world(),{mirror:'off',seed:42,taskId:'T1'},async()=>{throw Error('No mirror is allowed');});try{const before=controller.view(),reply=await controller.export({expectedRevision:0});assert.equal(reply.ok,false);if(!reply.ok)assert.equal(reply.error.code,'mirror_unavailable');assert.deepEqual(controller.view(),before);}finally{await controller.close();}
});
test('world/2 export: a library task with a tombstone binds its native drawing through the tolerant parser, and check --pair accepts it',{timeout:120000},async()=>{
 const {nativeMatchesState}=await import('../../src/host/export-pair.ts');
 const {packWorld,readWorldPackage}=await import('../../src/package/index.ts');const {loadWorldPackage}=await import('../../src/world/index.ts');const {spawnSync}=await import('node:child_process');const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {realpathSync}=await import('node:fs');
 const w=loadWorldPackage(await readWorldPackage(await packWorld('tasks/excalidraw/world')));const controller=await createPracticeController(w,{seed:1,taskId:'remove-step'},initial=>createProductionMirror(initial));
 const dir=await mkdtemp(join(realpathSync(tmpdir()),'pn-export-v2-'));
 try{
  const start=controller.view();const acted=await controller.act({expectedRevision:start.revision,action:{name:'delete_step',params:{id:'b'},baseStep:start.step}});assert.equal(acted.ok,true);
  const view=controller.view();assert.equal(Object.values(view.state.objects).some(object=>object.deleted),true,'the session keeps a tombstone');
  const reply=await controller.export({expectedRevision:view.revision});assert.equal(reply.ok,true,JSON.stringify(reply));if(!reply.ok)return;
  assert.equal(nativeMatchesState(w.schema,reply.value.native.utf8,view.state),true);
  const changed=JSON.parse(reply.value.native.utf8);{const text=changed.elements.find((element:{type:string;isDeleted:boolean})=>element.type==='text'&&!element.isDeleted);text.text='Not the label';text.originalText='Not the label';}
  assert.equal(nativeMatchesState(w.schema,JSON.stringify(changed),view.state),false,'a different live drawing does not bind');
  assert.equal(nativeMatchesState(w.schema,'{"type":"excalidraw"',view.state),false);
  await writeFile(join(dir,'library.pnworld'),await packWorld('tasks/excalidraw/world'));await writeFile(join(dir,'result.excalidraw'),reply.value.native.utf8);await writeFile(join(dir,'result.session.json'),reply.value.session.utf8);
  const cli=(...args:string[])=>spawnSync(process.execPath,['src/cli/main.ts','check',join(dir,'result.excalidraw'),'--world',join(dir,'library.pnworld'),...args],{encoding:'utf8'});
  const checked=cli('--pair',join(dir,'result.session.json'));assert.equal(checked.status,0,checked.stderr);assert.equal(JSON.parse(checked.stdout).passed,true);
  await writeFile(join(dir,'result.excalidraw'),JSON.stringify(changed));const refused=cli('--pair',join(dir,'result.session.json'));assert.notEqual(refused.status,0);
 }finally{await controller.close();await rm(dir,{recursive:true,force:true});}
});
