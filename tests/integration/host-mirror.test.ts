import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createPracticeSession } from '../../src/host/session.ts';
import { Session } from '../../src/core/session.ts';
import { validateWorld } from '../../src/world/schema.ts';
import type { Action } from '../../src/world/types.ts';
import { MIRROR_LATENCY_TARGET_MS } from '../../src/host/mirror.ts';
test('real pinned mirror confirms all seven actions, undo/reset and PNG, every prefix equals independent replay',async()=>{
 const world=validateWorld(JSON.parse(readFileSync(new URL('../../examples/worlds/flow-diagram/world.json',import.meta.url),'utf8'))); const controller=await createPracticeSession(world,{seed:42,taskId:'T3'}); const oracle=new Session(world,42,'T3');
 try {
  const actions:Action[]=[{name:'add_step',params:{frameId:'flow-frame',label:'Extra',x:820,y:180,width:180,height:100,fontFamily:3}},{name:'rename_step',params:{id:'a',label:'Changed'}},{name:'move_step',params:{id:'a',x:120,y:240}},{name:'connect',params:{frameId:'flow-frame',from:'a',to:'c'}},{name:'reconnect_end',params:{id:'ab',end:'start',target:'c'}},{name:'disconnect',params:{id:'bc'}},{name:'delete_step',params:{id:'b'}}];
  const latencies:number[]=[];
  for(const action of actions){const revision=controller.view().revision;const result=await controller.act({expectedRevision:revision,action});assert.equal(result.ok,true,JSON.stringify(result));oracle.act(action);assert.equal(controller.view().hash,oracle.hash);assert.equal(oracle.checkReplay().ok,true);if(result.ok){assert.equal(result.value.mirrorConfirmed,true);latencies.push(result.value.latencyMs);assert.ok(result.value.latencyMs<MIRROR_LATENCY_TARGET_MS,`step latency ${result.value.latencyMs}`);}}
  const png=await controller.png();assert.equal(png.ok,true);if(png.ok)assert.deepEqual(Array.from(png.value.slice(0,8)),[137,80,78,71,13,10,26,10]);
  assert.equal((await controller.undo({expectedRevision:7})).ok,true);oracle.undo();assert.equal(controller.view().hash,oracle.hash);
  assert.equal((await controller.reset({expectedRevision:8,confirmed:true})).ok,true);oracle.reset();assert.equal(controller.view().hash,oracle.hash);
  console.log(JSON.stringify({measurement:'host-mirror-step-latency-ms',latencies,target:MIRROR_LATENCY_TARGET_MS}));
 }finally{await controller.close();}
});
