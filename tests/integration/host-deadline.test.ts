import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,realpath,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {isDeepStrictEqual} from 'node:util';
import {validateWorld} from '../../src/world/index.ts';
import {createPracticeController} from '../../src/host/session.ts';
import {createProductionMirror} from '../../src/host/mirror.ts';
import {startHost} from '../../src/host/server.ts';
import {TOKEN_HEADER} from '../../src/host/protocol.ts';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
async function world(){const value=validateWorld(JSON.parse(await readFile('tests/fixtures/core/world.json','utf8')));value.app.fontFamilies=[3];for(const object of Object.values(value.initialState.objects))if(object.type==='step')(object as {fontFamily:number}).fontFamily=3;return value;}
function committed(view:any){const {mirrorHealth,...rest}=view;return rest;}
test('a real late mirror write cannot commit after the supplied monotonic deadline',{timeout:30000},async()=>{
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(done=>release=done),ready=new Promise<void>(done=>entered=done);let physical:any,pending:Promise<any>|undefined;
 const controller=await createPracticeController(await world(),{seed:42},async initial=>{const real=await createProductionMirror(initial);return {...real,async apply(transition){const result=await real.apply(transition);physical=await real.snapshot();entered();await gate;return result;}};});
 try{const before=controller.view();pending=controller.act({expectedRevision:0,action:{name:'move_step',params:{id:'a',x:200,y:220}}},{deadline:performance.now()+200});await ready;assert.equal(isDeepStrictEqual(physical,before.state),false);const png=await controller.png();assert.equal(png.ok,false);if(!png.ok)assert.equal(png.error.code,'session_busy');assert.deepEqual(committed(controller.view()),committed(before));await new Promise(done=>setTimeout(done,250));release();const reply=await pending;assert.equal(reply.ok,false);if(!reply.ok)assert.equal(reply.error.code,'mirror_timeout');assert.deepEqual(committed(controller.view()),committed(before));const check=await controller.check({expectedRevision:0});assert.equal(check.ok,true);
 }finally{release();await pending;await controller.close();}
});
test('HTTP body time consumes the transaction budget from request admission',{timeout:15000},async()=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'pn-deadline-'))),host=await startHost(await world(),{mirror:'off',tokenDirectory:directory});
 try{const before=await(await fetch(host.origin+'/api/observe',{headers:{[TOKEN_HEADER]:host.token}})).json();assert.equal(before.ok,true);const body=JSON.stringify({expectedRevision:0,action:{name:'move_step',params:{id:'a',x:200,y:220}}});const start=performance.now();
  const reply:any=await new Promise((resolve,reject)=>{const req=httpRequest(host.origin+'/api/act',{method:'POST',headers:{[TOKEN_HEADER]:host.token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},response=>{const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(chunk));response.once('end',()=>resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));response.once('error',reject);});req.once('error',reject);req.write(body.slice(0,-1));const timer=setTimeout(()=>req.end(body.slice(-1)),5100);req.once('close',()=>clearTimeout(timer));});
  assert.ok(performance.now()-start>=5000);assert.equal(reply.ok,false);if(!reply.ok)assert.equal(reply.error.code,'mirror_timeout');const after=await(await fetch(host.origin+'/api/observe',{headers:{[TOKEN_HEADER]:host.token}})).json();assert.deepEqual(after,before);
 }finally{await host.close();await rm(directory,{recursive:true,force:true});}
});
test('deadline expiration at real core serialization is a timeout, with preserved committed export state',{timeout:30000},async()=>{
 // Private, non-packable race fixture: initialize only the monotonic deadline at
 // the exact serialize boundary. Core traversal, real mirror, catch and recovery
 // are the production code. No kernel mock, clock replacement or public test seam.
 const directory=await mkdtemp(join(tmpdir(),'pn-export-deadline-race-'));
 const sourceUrl=new URL('../../src/host/session.ts',import.meta.url),source=await readFile(sourceUrl,'utf8');
 const site='const data=session.serialize({continue:()=>continues(context)});';
 assert.equal(source.split(site).length,2,'exactly one production serialize boundary');
 const inserted='context.deadline=performance.now()-1;'+site;
 const patched=source.replace(site,inserted).replace(/from '(\.\.?\/[^']+)'/g,(_match,path:string)=>'from '+JSON.stringify(new URL(path,sourceUrl).href));
 const path=join(directory,'session-deadline-race.mts');
 await writeFile(join(directory,'NON_PACKABLE'), 'Private deadline data-initialization fixture\n');
 await writeFile(join(directory,'source-binding.json'),JSON.stringify({source:new URL(sourceUrl).pathname,sourceSha256:createHash('sha256').update(source).digest('hex'),onlyBehavioralInjection:inserted,fixtureSha256:createHash('sha256').update(patched).digest('hex')}));
 await writeFile(path,patched);
 let controller:Awaited<ReturnType<typeof createPracticeController>>|undefined;
 try{
  const module=await import(pathToFileURL(path).href) as typeof import('../../src/host/session.ts');
  controller=await module.createPracticeController(await world(),{seed:42},(initial,app)=>createProductionMirror(initial,undefined,app));
  const before=controller.view(),reply=await controller.export({expectedRevision:0});
  assert.equal(reply.ok,false);if(!reply.ok)assert.equal(reply.error.code,'mirror_timeout');
  assert.deepEqual(committed(controller.view()),committed(before));
  assert.equal((await controller.check({expectedRevision:0})).ok,true,'committed mirror recovery remains usable');
 }finally{await controller?.close();await rm(directory,{recursive:true,force:true});}
});
