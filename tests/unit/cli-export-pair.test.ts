import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {packWorld,readWorldPackage} from '../../src/package/index.ts';
import {loadWorldPackage} from '../../src/world/index.ts';
import {Session} from '../../src/core/index.ts';
import {toRaw} from '../../src/adapters/excalidraw/raw.ts';
import {buildExportEnvelope,sessionPayloadSha256} from '../../src/host/export-pair.ts';
import {sha256Hex} from '../../src/canonical/index.ts';
import {solution} from '../integration/solutions.ts';

// Synthetic native fixture from the pinned projection, not a claim of a real editor transfer.
async function fixture() {
 const dir=await mkdtemp(join(tmpdir(),'pn-cli-pair-'));
 const bytes=await packWorld('examples/worlds/flow-diagram');
 const world=loadWorldPackage(await readWorldPackage(bytes)),session=new Session(world,42,'T3');
 for(const action of solution(world,42,'T3'))assert.equal(session.act(action).ok,true);
 const native=JSON.stringify({type:'excalidraw',version:2,source:'practonaut',elements:toRaw(session.state),appState:{viewBackgroundColor:'#ffffff'},files:{}});
 const envelope=buildExportEnvelope(session.serialize(),7,native,world.app);
 const paths={world:join(dir,'world.pnworld'),native:join(dir,'native.excalidraw'),pair:join(dir,'pair.json')};
 await writeFile(paths.world,bytes);await writeFile(paths.native,native);await writeFile(paths.pair,envelope.session.utf8);
 const run=(extra:string[]=[])=>spawnSync(process.execPath,['src/cli/main.ts','check',paths.native,'--world',paths.world,'--pair',paths.pair,...extra],{encoding:'utf8',timeout:30_000});
 return {dir,paths,native,envelope,run,close:()=>rm(dir,{recursive:true,force:true})};
}
test('CLI pair derives routing and binds native bytes to independently replayed Session',async()=>{
 const f=await fixture();try{const r=f.run();assert.equal(r.status,0,r.stderr);const value=JSON.parse(r.stdout);assert.equal(value.passed,true);assert.equal(value.binding.kind,'export-pair');assert.equal(value.binding.revision,7);assert.equal(value.binding.nativeSha256,sha256Hex(f.native));
 const manual=spawnSync(process.execPath,['src/cli/main.ts','check',f.paths.native,'--world',f.paths.world,'--seed','42','--task','T3'],{encoding:'utf8'});assert.equal(manual.status,0,manual.stderr);assert.equal(JSON.parse(manual.stdout).binding.kind,'manual-unbound');
 }finally{await f.close();}
});
test('CLI pair rejects byte/routing/schema changes and never echoes unknown manifest data',async()=>{
 const f=await fixture();try{
  const base=JSON.parse(f.envelope.session.utf8);
  const canary='CANARY-PAIR-PRIVATE-DO-NOT-RETURN';
  for(const mutate of [
   (p:any)=>{p.nativeSha256='0'.repeat(64);},
   (p:any)=>{p.sessionSha256='0'.repeat(64);},
   (p:any)=>{p.seed=1;},
   (p:any)=>{p.taskId='T2';},
   (p:any)=>{p.world.version='9.9.9';},
   (p:any)=>{p.revision=-1;},
   (p:any)=>{p.authorCanary=canary;}
  ]){const p=structuredClone(base);mutate(p);await writeFile(f.paths.pair,JSON.stringify(p));const r=f.run();assert.equal(r.status,2,r.stderr);assert.doesNotMatch(r.stderr,new RegExp(canary));assert.match(r.stderr,/checker_invalid|artifact_invalid/);}
  await writeFile(f.paths.pair,f.envelope.session.utf8);
  assert.equal(f.run(['--seed','1']).status,2);
  assert.equal(f.run(['--task','T2']).status,2);
  await writeFile(f.paths.pair,' '.repeat(4*1024*1024+1));assert.equal(f.run().status,2);
 }finally{await f.close();}
});
test('rehashed native and Session forgery cannot turn a checksum pair into action or state proof',async()=>{
 const f=await fixture();try{
  const base=JSON.parse(f.envelope.session.utf8),changed=JSON.parse(f.native);
  changed.elements.find((e:any)=>e.type==='rectangle'&&!e.isDeleted).x+=1;
  const native=JSON.stringify(changed);base.nativeSha256=sha256Hex(native);
  await writeFile(f.paths.native,native);await writeFile(f.paths.pair,JSON.stringify(base));
  const different=f.run();assert.equal(different.status,2,different.stderr);assert.match(different.stderr,/artifact_invalid/);
  await writeFile(f.paths.native,f.native);const forged=JSON.parse(f.envelope.session.utf8);
  forged.session.log[0].action.params.id='absent-object';forged.sessionSha256=sessionPayloadSha256(forged.session);
  await writeFile(f.paths.pair,JSON.stringify(forged));const r=f.run();assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/artifact_invalid|checker_invalid/);
 }finally{await f.close();}
});
