import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { publicConditions, createPracticeController } from '../../src/host/session.ts';
import { prepareRepairProject, repairExamples } from '../../src/authoring/recovery.ts';
import { evaluate } from '../../src/predicate/index.ts';
import { validateWorld } from '../../src/world/index.ts';
import { generateVariant } from '../../src/world/variant.ts';
import type { Predicate, Task } from '../../src/world/types.ts';

const project = () => prepareRepairProject({ id:'conditions-test',title:'Shorten a process',author:'Synthetic',labels:['Request','Approval','Purchase'] });
function namedTask():Task {const p=project(),task=structuredClone(p.tasks[0]!.task);task.initialState=structuredClone(p.initialState);return task;}
function passes(predicate:Predicate,state:NonNullable<Task['initialState']>):boolean {const result=evaluate(predicate,state);assert.equal(result.ok,true);return result.ok&&result.value;}

test('repair conditions name visible steps and exact outcomes in EN/DE while preserving the original predicates',()=>{
  const task=namedTask(),original=structuredClone(task),conditions=publicConditions(task);
  assert.deepEqual(conditions.map(c=>c.text.en),['Remove “Approval”.','Keep “Request” in the process.','Keep “Purchase” in the process.','Exactly 2 steps remain.','Exactly 1 arrow remains.','An arrow connects “Request” directly to “Purchase”.']);
  assert.deepEqual(conditions.map(c=>c.text.de),['Entferne „Approval“.','Behalte „Request“ im Ablauf.','Behalte „Purchase“ im Ablauf.','Genau 2 Schritte bleiben erhalten.','Genau 1 Pfeil bleibt erhalten.','Ein Pfeil verbindet „Request“ direkt mit „Purchase“.']);
  assert.deepEqual(conditions.map(c=>c.predicate),task.goal.op==='all'?task.goal.args:[task.goal]);assert.deepEqual(task,original);
  for(const condition of conditions)assert.equal(/\[(?:object|connection)\]|\b(?:object|connection)\.|"[abc]"/.test(condition.text.en+condition.text.de),false);
  const examples=repairExamples(project())!;
  for(const state of [examples.reference,examples.alternative])assert.equal(conditions.every(c=>passes(c.predicate,state)),true);
  assert.equal(conditions.every(c=>passes(c.predicate,examples.nearMiss)),false);assert.equal(conditions.every(c=>passes(c.predicate,task.initialState!)),false);
  assert.deepEqual(publicConditions(task).map(c=>({id:c.id,text:c.text})),conditions.map(c=>({id:c.id,text:c.text})));
});

test('condition labels come from the selected variant and remain identical in exercise and result feedback',async()=>{
  const p=project(),base=validateWorld(JSON.parse(readFileSync('tests/fixtures/core/world.json','utf8')));
  base.app.fontFamilies=[1,3];base.tasks=[structuredClone(p.tasks[0]!.task)];base.initialState=structuredClone(p.initialState);base.variants.cases=[{id:'night',labels:{first:'Intake',middle:'Audit',last:'Archive'},insertPosition:0,layoutOffset:{x:40,y:60}}];
  const variant=generateVariant(base,0),conditions=publicConditions(variant.tasks[0]!);
  assert.equal(conditions[0]!.text.en,'Remove “Audit”.');assert.equal(conditions[1]!.text.de,'Behalte „Intake“ im Ablauf.');assert.ok(conditions[5]!.text.en.includes('Archive'));assert.equal(JSON.stringify(conditions.map(c=>c.text)).includes('{{'),false);
  const controller=await createPracticeController(base,{mirror:'off'},async()=>{throw Error('not used');});
  try {
    const view=controller.view(),checked=await controller.check({expectedRevision:view.revision});assert.equal(checked.ok,true);if(checked.ok){assert.deepEqual(checked.value.conditions.map(({met,...condition})=>condition),view.task.conditions);assert.equal(checked.value.passed,false);}
    for(const action of [{name:'delete_step',params:{id:'b'}},{name:'reconnect_end',params:{id:'ab',end:'end',target:'c'}}])assert.equal((await controller.act({expectedRevision:controller.view().revision,action})).ok,true);
    const nearMiss=await controller.check({expectedRevision:controller.view().revision});assert.equal(nearMiss.ok,true);if(nearMiss.ok){assert.equal(nearMiss.value.passed,false);assert.deepEqual(nearMiss.value.conditions.map(({met,...condition})=>condition),view.task.conditions);assert.equal(nearMiss.value.conditions[4]!.met,false);}
    assert.equal((await controller.act({expectedRevision:controller.view().revision,action:{name:'disconnect',params:{id:'bc'}}})).ok,true);
    const success=await controller.check({expectedRevision:controller.view().revision});assert.equal(success.ok,true);if(success.ok){assert.equal(success.value.passed,true);assert.deepEqual(success.value.conditions.map(({met,...condition})=>condition),view.task.conditions);assert.ok(success.value.conditions.every(c=>c.met));}
  }
  finally {await controller.close();}
});

test('mixed quantifier variables, extra constraints and filtered counts keep the exact fallback instead of claiming the repair pattern',()=>{
  const task=namedTask(),arrow=structuredClone(task.goal.op==='all'?task.goal.args[5]!:task.goal);
  assert.equal(arrow.op,'exists');if(arrow.op!=='exists'||arrow.where.op!=='all')throw Error('fixture');
  const mixed=structuredClone(arrow);if(mixed.op==='exists'&&mixed.where.op==='all'){const second=mixed.where.args[1]!;if(second.op==='eq'&&second.left.kind==='field')second.left.variable='other';}
  const extra=structuredClone(arrow);if(extra.op==='exists'&&extra.where.op==='all')extra.where.args.push({op:'true'});
  const filtered:Predicate={op:'eq',left:{kind:'count',type:'step',as:'selected',where:{op:'eq',left:{kind:'field',variable:'selected',field:'label'},right:{kind:'literal',value:'Request'}}},right:{kind:'literal',value:2}};
  task.goal={op:'all',args:[mixed,extra,filtered]};const texts=publicConditions(task).map(c=>c.text);
  assert.ok(texts[0]!.en.includes('other.end step'));assert.ok(texts[0]!.en.includes('[connection]'));
  assert.equal(texts.some(t=>t.en.startsWith('An arrow connects')),false);assert.equal(texts[2]!.en.startsWith('Exactly 2 steps remain'),false);assert.ok(texts[2]!.en.includes('selected.label'));assert.ok(texts[2]!.de.includes('Beschriftung'));
});

test('two different arrow witnesses cannot satisfy the narrated single-arrow connection requirement',()=>{
  const task=namedTask(),condition=publicConditions(task)[5]!,state=structuredClone(task.initialState!);
  if(state.objects.ab?.type==='arrow')state.objects.ab.to=null;if(state.objects.bc?.type==='arrow')state.objects.bc.from=null;
  assert.equal(passes(condition.predicate,state),false);assert.equal(condition.text.en,'An arrow connects “Request” directly to “Purchase”.');
  if(state.objects.ab?.type==='arrow')state.objects.ab.to='c';assert.equal(passes(condition.predicate,state),true);
});

test('unknown, unresolved or duplicate visible names retain inspectable identity conditions',()=>{
  const task=namedTask();if(task.initialState!.objects.b?.type==='step')task.initialState!.objects.b.label='{{middle}}';
  assert.ok(publicConditions(task)[0]!.text.en.includes('object.identity'));
  if(task.initialState!.objects.b?.type==='step')task.initialState!.objects.b.label='Request';assert.ok(publicConditions(task)[0]!.text.en.includes('object.identity'));
});

function preparedTask(seed=42):Task {
  const world=generateVariant(validateWorld(JSON.parse(readFileSync('examples/worlds/flow-diagram/world.json','utf8'))),seed);
  return world.tasks.find(t=>t.id==='T3')!;
}
function preparedSuccess(task:Task):NonNullable<Task['initialState']> {
  const state=structuredClone(task.initialState!);
  state.objects.b!.deleted=true;state.objects.bc!.deleted=true;
  if(state.objects.ab?.type!=='arrow')throw Error('fixture');state.objects.ab.to='c';return state;
}
function preparedNodes(task:Task){
  const root=task.goal;if(root.op!=='exists'||root.where.op!=='all')throw Error('fixture');
  const last=root.where.args[1]!;if(last.op!=='exists'||last.where.op!=='all')throw Error('fixture');
  const body=last.where.args[1]!;if(body.op!=='all')throw Error('fixture');
  const global=body.args[0]!,arrow=body.args[1]!;if(global.op!=='all'||arrow.op!=='exists'||arrow.where.op!=='all')throw Error('fixture');
  return {root,last,body,global,arrow,arrowWhere:arrow.where,rootWhere:root.where};
}

test('prepared T3 narrates the whole actual finite goal without mutating or splitting its quantified predicate',()=>{
  const task=preparedTask(),original=structuredClone(task),conditions=publicConditions(task);assert.equal(conditions.length,1);const condition=conditions[0]!;
  assert.deepEqual(condition.predicate,task.goal);assert.equal(condition.predicate,task.goal);assert.deepEqual(task,original);
  assert.equal(condition.text.en,'The result has exactly two steps labelled “Collect draft” and “Publish draft”, connected in that direction by exactly one arrow. Both steps and the arrow belong to the starting frame “Draft flow”. A frame named “Draft flow” must also exist.');
  assert.equal(condition.text.de,'Im Ergebnis gibt es genau zwei Schritte mit den Beschriftungen „Collect draft“ und „Publish draft“ und genau einen Pfeil, der diese beiden Schritte in dieser Richtung verbindet. Beide Schritte und der Pfeil gehören zum Ausgangsrahmen „Draft flow“. Außerdem muss ein Rahmen mit dem Namen „Draft flow“ vorhanden sein.');
  assert.ok(condition.formalText?.en.includes('[s0]'));assert.ok(condition.formalText?.en.includes('edge.start step = s0.identity'));assert.ok(condition.formalText?.de.includes('frame.Name'));
  assert.equal(passes(condition.predicate,task.initialState!),false);assert.equal(passes(condition.predicate,preparedSuccess(task)),true);
});

test('prepared narrative preserves live counts, arrow direction, starting-frame identity and independent named-frame witness',()=>{
  const task=preparedTask(),condition=publicConditions(task)[0]!,solved=preparedSuccess(task);
  const near=structuredClone(solved);near.objects.bc!.deleted=false;if(near.objects.bc?.type==='arrow')near.objects.bc.from=null;assert.equal(passes(condition.predicate,near),false);
  const reversed=structuredClone(solved);if(reversed.objects.ab?.type==='arrow'){reversed.objects.ab.from='c';reversed.objects.ab.to='a';}assert.equal(passes(condition.predicate,reversed),false);
  const renamed=structuredClone(solved);if(renamed.objects['flow-frame']?.type==='frame')renamed.objects['flow-frame'].name='Renamed original';assert.equal(passes(condition.predicate,renamed),false);
  renamed.objects.anotherFrame={id:'anotherFrame',type:'frame',deleted:false,name:'Draft flow'};assert.equal(passes(condition.predicate,renamed),true);
  const moved=structuredClone(solved);moved.objects.otherFrame={id:'otherFrame',type:'frame',deleted:false,name:'Other frame'};for(const id of ['a','c','ab']){const o=moved.objects[id]!;if(o.type==='step'||o.type==='arrow')o.frameId='otherFrame';}assert.equal(passes(condition.predicate,moved),false);
  const missingFrame=structuredClone(solved);if(missingFrame.objects.ab?.type==='arrow')missingFrame.objects.ab.frameId='missing';const invalid=evaluate(condition.predicate,missingFrame);assert.equal(invalid.ok,false);if(!invalid.ok)assert.equal(invalid.error.code,'checker_invalid');
  // Dead extra objects are not counted. Original step identities are not checked.
  const replaced=structuredClone(solved);replaced.objects.b!.deleted=false;replaced.objects.a!.deleted=true;if(replaced.objects.b?.type==='step')replaced.objects.b.label='Collect draft';if(replaced.objects.ab?.type==='arrow')replaced.objects.ab.from='b';assert.equal(passes(condition.predicate,replaced),true);
  assert.ok(condition.text.en.includes('labelled'));assert.equal(condition.text.en.includes('Keep'),false);assert.equal(condition.text.en.includes('Remove'),false);
});

test('prepared recognizer rejects added, omitted, filtered, mismatched and captured constraints rather than dropping clauses',()=>{
  const fallback=(task:Task)=>{const c=publicConditions(task)[0]!;assert.equal(c.formalText,undefined);assert.ok(c.text.en.startsWith('there is a step'));assert.deepEqual(c.predicate,task.goal);};
  let task=preparedTask();preparedNodes(task).global.args.push({op:'false'});fallback(task);
  task=preparedTask();preparedNodes(task).global.args.splice(3,1);fallback(task);
  task=preparedTask();const count=preparedNodes(task).global.args[0]!;if(count.op==='eq'&&count.left.kind==='count')count.left.where={op:'false'};fallback(task);
  task=preparedTask();const wrongCount=preparedNodes(task).global.args[1]!;if(wrongCount.op==='eq')wrongCount.right={kind:'literal',value:2};fallback(task);
  task=preparedTask();const frame=preparedNodes(task).arrowWhere.args[2]!;if(frame.op==='eq')frame.right={kind:'literal',value:'anotherFrame'};fallback(task);
  task=preparedTask();const end=preparedNodes(task).arrowWhere.args[1]!;if(end.op==='eq'&&end.left.kind==='field')end.left.variable='other';fallback(task);
  task=preparedTask();const capture=preparedNodes(task);capture.last.as=capture.root.as;fallback(task);
  task=preparedTask();const from=preparedNodes(task).arrowWhere.args[0]!;if(from.op==='eq'&&from.right.kind==='field')from.right.variable='s1';fallback(task);
});

test('consistent binder renaming preserves narration and its complete evaluator authority',()=>{
  const task=preparedTask(),source=JSON.stringify(task.goal),renamed=JSON.parse(source.replaceAll('"s0"','"startWitness"').replaceAll('"s1"','"endWitness"').replaceAll('"edge"','"arrowWitness"')) as Predicate;task.goal=renamed;
  const condition=publicConditions(task)[0]!;assert.ok(condition.formalText);assert.ok(condition.formalText.en.includes('startWitness'));assert.equal(passes(condition.predicate,preparedSuccess(task)),true);assert.equal(condition.text.en,publicConditions(preparedTask())[0]!.text.en);
});

test('prepared text uses actual instantiated variants and declines ambiguous or unresolved initial references',()=>{
  const world=validateWorld(JSON.parse(readFileSync('examples/worlds/flow-diagram/world.json','utf8')));
  const seen=new Set<string>();for(let seed=0;seed<128;seed++){const variant=generateVariant(world,seed),task=variant.tasks.find(t=>t.id==='T3')!,condition=publicConditions(task)[0]!;seen.add(condition.text.en);assert.ok(condition.formalText);assert.equal(condition.text.en.includes('{{'),false);assert.equal(passes(condition.predicate,preparedSuccess(task)),true);}
  assert.equal(seen.size,3);
  const fallback=(task:Task)=>assert.equal(publicConditions(task)[0]!.formalText,undefined);
  let task=preparedTask();if(task.initialState!.objects.b?.type==='step')task.initialState!.objects.b.label='Collect draft';fallback(task);
  task=preparedTask();if(task.initialState!.objects.b?.type==='step')task.initialState!.objects.b.label=' Collect  draft ';fallback(task);
  task=preparedTask();task.initialState!.objects.duplicateFrame={id:'duplicateFrame',type:'frame',deleted:false,name:'Draft flow'};fallback(task);
  task=preparedTask();task.initialState!.objects.duplicateFrame={id:'duplicateFrame',type:'frame',deleted:false,name:' Draft  flow '};fallback(task);
  task=preparedTask();task.initialState!.objects['flow-frame']!.deleted=true;fallback(task);
  task=preparedTask();const first=preparedNodes(task).rootWhere.args[0]!;if(first.op==='eq')first.right={kind:'literal',value:'{{first}}'};fallback(task);
});

test('prepared task and result retain identical readable and formal condition data on failure and success',async()=>{
  const world=validateWorld(JSON.parse(readFileSync('examples/worlds/flow-diagram/world.json','utf8'))),controller=await createPracticeController(world,{mirror:'off',seed:42,taskId:'T3'},async()=>{throw Error('not used');});
  try{const initial=controller.view(),failed=await controller.check({expectedRevision:initial.revision});assert.equal(failed.ok,true);if(failed.ok){assert.equal(failed.value.passed,false);assert.deepEqual(failed.value.conditions.map(({met,...c})=>c),initial.task.conditions);assert.equal(failed.value.conditions.length,1);}
  for(const action of [{name:'reconnect_end',params:{id:'ab',end:'end',target:'c'}},{name:'disconnect',params:{id:'bc'}},{name:'delete_step',params:{id:'b'}}])assert.equal((await controller.act({expectedRevision:controller.view().revision,action})).ok,true);
  const success=await controller.check({expectedRevision:controller.view().revision});assert.equal(success.ok,true);if(success.ok){assert.equal(success.value.passed,true);assert.deepEqual(success.value.conditions.map(({met,...c})=>c),initial.task.conditions);assert.ok(success.value.conditions[0]!.met);}
  }finally{await controller.close();}
});
