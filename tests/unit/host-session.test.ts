import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { MirrorDiagnostic } from '../../src/host/session.ts';
import { createPracticeController, publicConditions } from '../../src/host/session.ts';
import type { PracticeMirror } from '../../src/host/mirror.ts';
import { MirrorFault } from '../../src/host/mirror.ts';
import { Session } from '../../src/core/session.ts';
import { evaluate } from '../../src/predicate/index.ts';
import type { World, State, Action } from '../../src/world/types.ts';
import type { VariantRequest } from '../../src/host/protocol.ts';
import { validateWorld } from '../../src/world/schema.ts';
const world = (): World => validateWorld(JSON.parse(readFileSync(new URL('../../examples/worlds/flow-diagram/world.json', import.meta.url), 'utf8')));
const move: Action = { name:'move_step',params:{id:'a',x:200,y:220} };
function fake(initial: State): PracticeMirror & { fail: string | undefined; recovered: number; state: State } {
  const mirror = { state: structuredClone(initial), recovered:0, fail: undefined as string | undefined,
    async apply(transition: {after:State}) { this.state = structuredClone(transition.after); if (this.fail === 'throw') throw new MirrorFault('mirror_timeout','probe timeout'); if (this.fail === 'disagree') this.state.objects.a!.deleted = true; return {ok:true as const,state:structuredClone(this.state),warnings:[]}; },
    async replace(state:State) { this.state=structuredClone(state); return {ok:true as const,state:this.state,warnings:[]}; },
    async recover(state:State) { this.recovered++; this.state=structuredClone(state); },
    async snapshot() { return structuredClone(this.state); }, async png() { return new Uint8Array([137,80,78,71]); }, async close() {},
  }; return mirror;
}
describe('host session transaction',()=>{
 it('commit, undo, reset, variants and replay match an independent Session prefix',async()=>{
  let mirror: ReturnType<typeof fake> | undefined;
  const controller=await createPracticeController(world(),{seed:42,taskId:'T3'},async initial=>mirror=fake(initial));
  const oracle=new Session(world(),42,'T3'); const result=await controller.act({expectedRevision:0,action:move}); assert.equal(result.ok,true); oracle.act(move);
  assert.equal(controller.view().hash,oracle.hash); assert.deepEqual(mirror!.state,oracle.state);
  const undo=await controller.undo({expectedRevision:1}); assert.equal(undo.ok,true); oracle.undo(); assert.equal(controller.view().hash,oracle.hash); assert.equal(controller.view().revision,2);
  assert.equal((await controller.act({expectedRevision:0,action:move})).ok,false);
  assert.equal((await controller.reset({expectedRevision:2,confirmed:true})).ok,true); assert.equal(controller.view().attempt,2);
  const prior=controller.view().variantId; assert.equal((await controller.variant({expectedRevision:3,confirmed:true})).ok,true); assert.notEqual(controller.view().variantId,prior);
  await controller.close();
 });
 it('task and variant require explicit confirmation; rejection preserves progress and hints; task-only keeps seed',async()=>{
  let mirror:ReturnType<typeof fake>|undefined;
  const controller=await createPracticeController(world(),{seed:42,taskId:'T3'},async initial=>mirror=fake(initial));
  try {
    assert.equal((await controller.act({expectedRevision:0,action:move})).ok,true);
    assert.equal((await controller.hint({expectedRevision:1})).ok,true);
    const before=controller.view(); const realBefore=structuredClone(mirror!.state);
    for(const request of [{expectedRevision:2},{expectedRevision:2,taskId:'T2'},{expectedRevision:2,confirmed:false},{expectedRevision:2,confirmed:'true',taskId:'T2'}]) {
      const reply=await controller.variant(request as unknown as VariantRequest);
      assert.equal(reply.ok,false);if(!reply.ok)assert.equal(reply.error.code,'invalid_request');
      assert.deepEqual(controller.view(),before);assert.deepEqual(mirror!.state,realBefore);
    }
    const taskChange=await controller.variant({expectedRevision:2,confirmed:true,taskId:'T2'});assert.equal(taskChange.ok,true);
    const switched=controller.view();assert.equal(switched.seed,before.seed);assert.equal(switched.variantId,before.variantId);assert.equal(switched.task.id,'T2');assert.equal(switched.revision,3);assert.equal(switched.attempt,1,'a new task starts at attempt 1');assert.equal(switched.hintsOpened,0);assert.equal(switched.log.length,0);assert.equal(switched.hash,new Session(world(),42,'T2').hash);assert.deepEqual(mirror!.state,switched.state);
    const freshVariant=await controller.variant({expectedRevision:3,confirmed:true});assert.equal(freshVariant.ok,true);assert.equal(controller.view().task.id,'T2');assert.notEqual(controller.view().variantId,switched.variantId);assert.notEqual(controller.view().seed,switched.seed);
  } finally {await controller.close();}
 });
 for (const failure of ['disagree','throw']) it(`${failure}: poisoned mirror is restored and neither core nor history advances`,async()=>{
  let mirror: ReturnType<typeof fake> | undefined; const records: MirrorDiagnostic[]=[]; const controller=await createPracticeController(world(),{taskId:'T3',onMirrorDiagnostic:record=>{records.push(record);}},async initial=>mirror=fake(initial));
  const before=controller.view(); mirror!.fail=failure;
  const rejected=await controller.act({expectedRevision:0,action:move}); assert.equal(rejected.ok,false); if(!rejected.ok)assert.equal(rejected.error.code,failure==='throw'?'mirror_timeout':'real_tool_disagrees');
  assert.deepEqual(controller.view(),{...before,mirrorHealth:{...before.mirrorHealth,recoveries:1}}); assert.equal(records.length,1); assert.equal(records[0]!.before.hash,before.hash); assert.deepEqual(records[0]!.before.state,before.state); assert.notEqual(records[0]!.predicted.hash,before.hash); assert.equal(records[0]!.action,'move_step'); if(failure==='disagree'){assert.ok(records[0]!.readback); assert.notEqual(records[0]!.readback!.hash,records[0]!.predicted.hash);} else assert.equal(records[0]!.readback,null); assert.deepEqual(mirror!.state,before.state); assert.equal(mirror!.recovered,1); mirror!.fail=undefined;
  assert.equal((await controller.act({expectedRevision:0,action:move})).ok,true); await controller.close();
 });
 it('model-only labels check and mutations as no practice evidence, hints fade and old consequences remain snapshots',async()=>{
  const controller=await createPracticeController(world(),{taskId:'T3',mirror:'off'},async()=>{throw Error('mirror must not start')});
  const action={name:'delete_step',params:{id:'b'}};assert.equal((await controller.act({expectedRevision:0,action})).ok,true); assert.equal(controller.view().history[0]!.consequences[0]!.id,'loose-arrow'); const deleted=controller.view().state.objects.b!; assert.equal(deleted.type,'step'); if(deleted.type==='step') assert.ok(controller.view().history[0]!.description.en.includes(deleted.label));
  const hint=await controller.hint({expectedRevision:1});assert.equal(hint.ok,true);assert.equal(controller.view().hints.length,1);
  const checked=await controller.check({expectedRevision:2});assert.equal(checked.ok,true);if(checked.ok){assert.equal(checked.value.practiceEvidence,false);assert.equal(checked.value.mode,'model-only');assert.deepEqual(checked.value.conditions.map(({met,...condition})=>condition),controller.view().task.conditions);}
  const unmodeled=await controller.act({expectedRevision:2,action:{name:'rotate',params:{}}});assert.equal(unmodeled.ok,false);if(!unmodeled.ok)assert.equal(unmodeled.error.code,'unmodeled');
  await controller.close();
 });
 it('diagnostic storage failure still rolls back the poisoned mirror and preserves named rejection',async()=>{
  let mirror:ReturnType<typeof fake>|undefined; const controller=await createPracticeController(world(),{taskId:'T3',onMirrorDiagnostic:()=>{throw {code:'diagnostic_unavailable'};}},async initial=>mirror=fake(initial)); const before=controller.view(); mirror!.fail='disagree'; const reply=await controller.act({expectedRevision:0,action:move}); assert.equal(reply.ok,false); if(!reply.ok)assert.equal(reply.error.code,'diagnostic_unavailable');assert.deepEqual(controller.view(),{...before,mirrorHealth:{...before.mirrorHealth,recoveries:1}});assert.deepEqual(mirror!.state,before.state);await controller.close();
 });
 it('quantifier decomposition preserves a common witness and uses only the whole public goal',async()=>{
  const input=world(); input.tasks[0]!.goal={op:'exists',type:'step',as:'w',where:{op:'all',args:[{op:'eq',left:{kind:'field',variable:'w',field:'label'},right:{kind:'literal',value:'A'}},{op:'eq',left:{kind:'field',variable:'w',field:'x'},right:{kind:'literal',value:500}}]}};
  input.tasks[0]!.initialState={objects:{f:{id:'f',type:'frame',name:'frame',deleted:false},a:{id:'a',type:'step',frameId:'f',label:'A',x:0,y:0,width:180,height:100,fontFamily:3,deleted:false},b:{id:'b',type:'step',frameId:'f',label:'B',x:500,y:0,width:180,height:100,fontFamily:3,deleted:false}}};
  assert.equal(publicConditions(input.tasks[0]!).length,1);const controller=await createPracticeController(input,{mirror:'off'},async()=>{throw Error('unused')});const reply=await controller.check({expectedRevision:0});assert.equal(reply.ok,true);if(reply.ok){assert.equal(reply.value.passed,false);assert.equal(reply.value.conditions[0]!.met,false);assert.deepEqual(evaluate(input.tasks[0]!.goal,controller.view().state).ok,true);}await controller.close();
 });
 it('full candidate view admission rejects before mirror writes and hint revision changes',async()=>{
  let mirror:ReturnType<typeof fake>|undefined;
  let denied=false; const controller=await createPracticeController(world(),{taskId:'T3',admitView:value=>{ if(denied && value.revision>0)throw {code:'result_too_large',message:'response limit'}; }},async initial=>mirror=fake(initial));
  const before=controller.view();denied=true;
  for(const reply of [await controller.act({expectedRevision:0,action:move}),await controller.hint({expectedRevision:0})]) {assert.equal(reply.ok,false);if(!reply.ok)assert.equal(reply.error.code,'result_too_large');assert.deepEqual(controller.view(),before);assert.deepEqual(mirror!.state,before.state);}
  await controller.close();
 });
 it('public conditions retain two bindings, quote literals and localize booleans',()=>{
  const task=world().tasks[0]!; task.goal={op:'all',args:[{op:'exists',type:'step',as:'left',where:{op:'exists',type:'step',as:'right',where:{op:'all',args:[{op:'eq',left:{kind:'field',variable:'left',field:'label'},right:{kind:'literal',value:'label = true'}},{op:'eq',left:{kind:'field',variable:'left',field:'x'},right:{kind:'field',variable:'right',field:'x'}},{op:'eq',left:{kind:'field',variable:'right',field:'deleted'},right:{kind:'literal',value:false}}]}}},{op:'true'}]};
  const text=publicConditions(task)[0]!.text;assert.ok(text.en.includes('left.label'));assert.ok(text.en.includes('right.horizontal position'));assert.ok(text.en.includes('"label = true"'));assert.ok(text.de.includes('falsch'));assert.ok(text.en.includes('[left]'));assert.ok(text.en.includes('[right]'));
 });

 it('editor requests must match the entire action successor; before divergence and excluded-only gestures remain rejected',async()=>{
  const controller=await createPracticeController(world(),{taskId:'T3',mirror:'off'},async()=>{throw Error('unused');});
  try {
   const before=controller.scene!(), after=structuredClone(before);for(const element of after)if(element.id==='a'||element.containerId==='a'){element.x+=20;element.y+=20;}
   const moved=await controller.editor!({expectedRevision:0,before,after,boundary:'pointerup'});assert.equal(moved.ok,true,JSON.stringify(moved));const oracle=new Session(world(),0,'T3');oracle.act({name:'move_step',params:{id:'a',x:160,y:200}});assert.equal(controller.view().hash,oracle.hash);
   const stale=await controller.editor!({expectedRevision:1,before,after,boundary:'key'});assert.equal(stale.ok,false);if(!stale.ok)assert.equal(stale.error.code,'editor_divergence');
   const committed=controller.view(), raw=controller.scene!(), bent=structuredClone(raw);bent.find(e=>e.id==='ab')!.points=[[0,0],[30,80],[100,0]];
   const unmodeled=await controller.editor!({expectedRevision:1,before:raw,after:bent,boundary:'pointerup'});assert.equal(unmodeled.ok,false);if(!unmodeled.ok)assert.equal(unmodeled.error.code,'unmodeled');assert.deepEqual(controller.view(),committed);
   const mismatched=structuredClone(raw);const rectangle=mismatched.find(e=>e.id==='a')!;rectangle.x+=20;rectangle.width+=10;
   const divergence=await controller.editor!({expectedRevision:1,before:raw,after:mismatched,boundary:'pointerup'});assert.equal(divergence.ok,false);if(!divergence.ok)assert.equal(divergence.error.code,'editor_divergence');assert.deepEqual(controller.view(),committed);
  } finally {await controller.close();}
 });

});
