import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, realpath, rm, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '../../src/host/server.ts';
import { request as httpRequest } from 'node:http';
import { TOKEN_HEADER } from '../../src/host/protocol.ts';
import { AUTHOR_ROUTES } from '../../src/host/author-protocol.ts';
import type { AuthorView, AuthorPreparedReply, AuthorCompileReply, AuthorLaunchReply } from '../../src/host/author-protocol.ts';
import { readWorldPackage, packWorld } from '../../src/package/index.ts';
import { validateWorld, loadWorldPackage } from '../../src/world/index.ts';
import type { State } from '../../src/world/types.ts';
import { createGestureRecorder } from '../../src/adapters/excalidraw/recorder.ts';
import { toRaw } from '../../src/adapters/excalidraw/raw.ts';
import { observationRef } from '../../src/authoring/project.ts';
import type { Recording } from '../../src/adapters/excalidraw/recorder-types.ts';

// Scripted test observations: hand-specified expected states, never the transition engine.
function demonstration(initial:State) {
  const deleted=structuredClone(initial);deleted.objects.b!.deleted=true;
  if(deleted.objects.ab?.type==='arrow')deleted.objects.ab.to=null;
  if(deleted.objects.bc?.type==='arrow')deleted.objects.bc.from=null;
  const repaired=structuredClone(deleted);if(repaired.objects.ab?.type==='arrow')repaired.objects.ab.to='c';
  const finished=structuredClone(repaired);finished.objects.bc!.deleted=true;
  const recorder=createGestureRecorder();recorder.start(toRaw(initial),true);
  for(const state of [deleted,repaired,finished]){recorder.observe(toRaw(state));recorder.boundary('key');}
  recorder.stop();return recorder;
}

test('guided HTTP authoring persists across a new port and launches only exact validated world into required real-mirror practice', async () => {
  const dir=await mkdtemp(join(await realpath(tmpdir()),'pn-recovery-http-'));
  const world=validateWorld(JSON.parse(await readFile('tests/fixtures/core/world.json','utf8')));
  const options={mirror:'off' as const,phase3:true,tokenDirectory:join(dir,'tokens'),localDirectory:join(dir,'local')};
  let host=await startHost(world,options), childOrigin='';
  let authorToken: string;
  async function bootstrapAuthor(): Promise<void> {
    const response = await fetch(host.origin + '/api/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: host.code }) });
    const reply = await response.json() as { ok: boolean; value: { authorToken: string } };
    assert.equal(response.status, 200); assert.equal(reply.ok, true); assert.equal(typeof reply.value.authorToken, 'string');
    assert.notEqual(reply.value.authorToken, host.token, 'author and practice capabilities must differ'); authorToken = reply.value.authorToken;
  }
  const auth=()=>({[TOKEN_HEADER]:authorToken,'Content-Type':'application/json'});
  async function call<T>(path:string,payload:unknown,headers=auth()):Promise<T>{const response=await fetch(host.origin+path,{method:'POST',headers,body:JSON.stringify(payload)});const result=await response.json() as {ok:boolean;value:T;error?:{code:string;message:string}};assert.equal(result.ok,true,JSON.stringify(result.error));return result.value;}
  async function error(path:string,payload:unknown,headers:Record<string,string>=auth()){const response=await fetch(host.origin+path,{method:'POST',headers,body:JSON.stringify(payload)});return(await response.json() as {error:{code:string}}).error.code;}
  async function view(){return(await(await fetch(host.origin+AUTHOR_ROUTES.observe,{headers:auth()})).json() as {value:AuthorView}).value;}
  try {
    await bootstrapAuthor();
    const before=await view();
    for(const path of [AUTHOR_ROUTES.prepare,AUTHOR_ROUTES.configure,AUTHOR_ROUTES.save,AUTHOR_ROUTES.open,AUTHOR_ROUTES.launch]) {
      assert.equal(await error(path,{}, {'Content-Type':'application/json'}),'token_required');
      assert.equal(await error(path,{}, {...auth(),[TOKEN_HEADER]:host.token}),'author_required');
      assert.equal(await error(path,{}, {...auth(),Origin:'https://foreign.invalid'}),'origin_rejected');
      const hostCode=await new Promise<string>((done,reject)=>{const req=httpRequest(host.origin+path,{method:'POST',headers:{...auth(),Host:'foreign.invalid'}},res=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>done((JSON.parse(Buffer.concat(chunks).toString()) as {error:{code:string}}).error.code));});req.on('error',reject);req.end('{}');});
      assert.equal(hostCode,'host_rejected');
      assert.equal(await error(path,{}, {...auth(),'Content-Type':'text/plain'}),'json_required');
      assert.equal(await error(path,{expectedRevision:0,unknown:true}),'invalid_request');
    }
    assert.deepEqual(await view(),before);
    const projectsUnauthorized=await fetch(host.origin+AUTHOR_ROUTES.projects);assert.equal((await projectsUnauthorized.json() as {error:{code:string}}).error.code,'token_required');
    const projectsOrigin=await fetch(host.origin+AUTHOR_ROUTES.projects,{headers:{...auth(),Origin:'https://foreign.invalid'}});assert.equal((await projectsOrigin.json() as {error:{code:string}}).error.code,'origin_rejected');
    const prepared=await call<AuthorPreparedReply>(AUTHOR_ROUTES.prepare,{expectedRevision:0,title:'Repair the purchasing process',author:'Synthetic author',labels:['Request','Approval','Purchase']});let current=prepared.view;
    assert.equal(current.recording.active,false);assert.ok(current.examples);assert.deepEqual(current.scene,prepared.scene);
    assert.equal(await error(AUTHOR_ROUTES.prepare,{expectedRevision:0,title:'Stale',author:'Synthetic',labels:['A','B','C']}),'stale_base');
    const source=demonstration(current.project!.initialState),ids:string[]=[];
    for(let i=0;i<2;i++) {
      current=await call<AuthorView>(AUTHOR_ROUTES.start,{expectedRevision:current.revision,metadata:{author:'Synthetic author',license:'CC0-1.0',consent:'Self created non-personal scene',demonstration:'scripted'},initial:source.initial,fontsReady:true});
      for(const gesture of source.gestures)current=await call<AuthorView>(AUTHOR_ROUTES.gesture,{expectedRevision:current.revision,gesture});
      const stopped=await call<{view:AuthorView;recordingId:string}>(AUTHOR_ROUTES.stop,{expectedRevision:current.revision});current=stopped.view;ids.push(stopped.recordingId);
      current=await call<AuthorView>(AUTHOR_ROUTES.analyze,{expectedRevision:current.revision});
    }
    const second= (await(await fetch(host.origin+AUTHOR_ROUTES.recording+'?id='+ids[1],{headers:auth()})).json() as {value:Recording}).value;
    for(const [hypothesisId,index] of [['delete-keeps-arrows-v1',0],['reconnect-v1',1],['disconnect-v1',2]] as const)current=await call<AuthorView>(AUTHOR_ROUTES.confirm,{expectedRevision:current.revision,confirmation:{hypothesisId,evidence:observationRef(second,index)}});
    current=await call<AuthorView>(AUTHOR_ROUTES.configure,{expectedRevision:current.revision,intent:{...current.project!.repair!,reviewedExamples:true}});
    assert.equal(current.readiness!.ready,true);current=await call<AuthorView>(AUTHOR_ROUTES.save,{expectedRevision:current.revision});const projectId=current.project!.id;
    // An unproven writer is a conflict, while committed work remains readable and unchanged.
    const savedFile=join(dir,'local','projects',projectId+'.json'),lockFile=join(dir,'local','projects','.projects.lock');
    const committed=await readFile(savedFile);await writeFile(lockFile,'Synthetic legacy writer',{mode:0o600,flag:'wx'});
    try{const conflict=await fetch(host.origin+AUTHOR_ROUTES.save,{method:'POST',headers:auth(),body:JSON.stringify({expectedRevision:current.revision})});assert.equal(conflict.status,409);assert.equal((await conflict.json() as {error:{code:string}}).error.code,'project_store_busy');assert.equal((await view()).revision,current.revision);assert.ok((await view()).savedProjects?.some(p=>p.id===projectId));assert.deepEqual(await readFile(savedFile),committed);}finally{await unlink(lockFile);}

    const previousPort=host.port;await host.close();host=await startHost(world,options);assert.notEqual(host.port,previousPort);await bootstrapAuthor();
    const opened=await call<AuthorPreparedReply>(AUTHOR_ROUTES.open,{expectedRevision:0,projectId});current=opened.view;
    assert.equal(current.readiness!.ready,true);assert.equal(current.recording.active,false);assert.equal(current.project!.hypotheses.filter(h=>h.status==='confirmed').length,3);
    const compiled=await call<AuthorCompileReply>(AUTHOR_ROUTES.compile,{expectedRevision:current.revision});
    assert.equal(await error(AUTHOR_ROUTES.launch,{expectedRevision:current.revision,worldSha256:'a'.repeat(64)}),'compilation_missing');
    const launched=await call<AuthorLaunchReply>(AUTHOR_ROUTES.launch,{expectedRevision:current.revision,worldSha256:compiled.worldSha256});childOrigin=new URL(launched.url).origin;
    assert.notEqual(childOrigin,host.origin);
    const code=new URLSearchParams(new URL(launched.url).hash.slice(1)).get('code');
    const bootstrap=await(await fetch(childOrigin+'/api/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})})).json() as {value:{token:string;view:{mirror:string;practiceEvidence:boolean;task:{title:{en:string}}}}};
    assert.equal(bootstrap.value.view.mirror,'required');assert.equal(bootstrap.value.view.practiceEvidence,true);assert.equal(bootstrap.value.view.task.title.en,'Repair the purchasing process');
    const childText=JSON.stringify(bootstrap.value.view);assert.equal(/checkerFixtures|heldOutSolutions|confirmingEvidence|repair-intent/.test(childText),false);
    const denied=await fetch(childOrigin+AUTHOR_ROUTES.projects,{headers:{[TOKEN_HEADER]:bootstrap.value.token}});assert.equal(denied.status,404);
    const compiledFile=join(dir,'local','author',String(compiled.report.localWorldFile));
    // A different, fully valid world defeats a package-parser-only protection.
    const substituted=loadWorldPackage(await readWorldPackage(await readFile(compiledFile)));
    substituted.tasks[0]!.title={en:'Unapproved substituted exercise',de:'Nicht freigegebene Ersatzübung'};validateWorld(substituted);
    const alternativeSource=join(dir,'alternate-world-source');await mkdir(alternativeSource,{mode:0o700});await writeFile(join(alternativeSource,'world.json'),JSON.stringify(substituted),{mode:0o600});
    const validAlternate=await packWorld(alternativeSource);loadWorldPackage(await readWorldPackage(validAlternate));
    await writeFile(compiledFile,validAlternate,{mode:0o600});
    assert.equal(await error(AUTHOR_ROUTES.launch,{expectedRevision:current.revision,worldSha256:compiled.worldSha256}),'compilation_changed');
    await host.close();await assert.rejects(fetch(childOrigin+'/'));
  } finally { await host.close();await rm(dir,{recursive:true,force:true}); }
});
