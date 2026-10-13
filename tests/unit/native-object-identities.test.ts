import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAuthorProject,confirmHypothesis,compileProject,observationRef,validateAuthorProject} from '../../src/authoring/index.ts';
import {validateRecording,projectSnapshot} from '../../src/adapters/excalidraw/recorder.ts';
import {toRaw} from '../../src/adapters/excalidraw/raw.ts';
import {Session} from '../../src/core/session.ts';
import {checkState,checkSubmission,parseExcalidraw,validateSubmissionState,checkerDataFromBundle} from '../../src/checker/index.ts';
import {readWorldPackage,readCheckerBundle} from '../../src/package/reader.ts';
import {validateState,validateWorld,validatePredicate} from '../../src/world/schema.ts';
import type {Recording,SemanticSnapshot} from '../../src/adapters/excalidraw/recorder-types.ts';
import type {State,Task} from '../../src/world/types.ts';
// Handwritten raw successor truth: one bound text changes, object identity does not.
function scene(objectId:string,label:string):SemanticSnapshot{return {elements:{
 '-frame':{id:'-frame',type:'frame',attributes:{isDeleted:false,frameId:null,name:'Own process'}},
 [objectId]:{id:objectId,type:'rectangle',attributes:{isDeleted:false,frameId:'-frame',x:10,y:20,width:180,height:80}},
 [objectId+':text']:{id:objectId+':text',type:'text',attributes:{isDeleted:false,frameId:'-frame',containerId:objectId,originalText:label,fontFamily:3}},
}};}
function recording(id:string,objectId:string,before:string,after:string):Recording{return validateRecording({manifest:{schema:'practonaut.recording/1',id,createdAt:'2026-10-04T00:00:00Z',stoppedAt:'2026-10-04T00:01:00Z',appVersion:'0.18.1',adapterVersion:'1.0.0',coalescingVersion:'excalidraw-gesture-v1',author:'Synthetic identity fixture',license:'CC0-1.0',consent:'Own synthetic data',demonstration:'scripted',status:'review'},initial:scene(objectId,before),gestures:[{index:0,boundary:'key',before:scene(objectId,before),after:scene(objectId,after),events:[{kind:'set',id:objectId+':text',field:'originalText',before,after}],unmodeled:[],quarantined:false,quarantineReasons:[]}]});}
for(const objectId of ['-NativeStep','_NativeStep'])test('native identity '+objectId+' survives evidence, compilation, execution and independent native checking',async()=>{
 const a=recording('proposal',objectId,'Before','Observed'),b=recording('confirmation',objectId,'Other','Confirmed'),originals=JSON.stringify([a,b]);
 const projected=projectSnapshot(a.initial);assert.equal(projected.ok,true);
 let project=createAuthorProject([a]);assert.throws(()=>confirmHypothesis(project,{hypothesisId:'rename-step-v1',evidence:observationRef(a,0)},[a]),/confirmation_requires_new_observation/);
 project=confirmHypothesis(project,{hypothesisId:'rename-step-v1',evidence:observationRef(b,0)},[a,b]);
 const task:Task={id:'rename',title:{en:'Rename',de:'Umbenennen'},prompt:{en:'Set the target name.',de:'Setze den Zielnamen.'},goal:{op:'exists',type:'step',as:'s',where:{op:'eq',left:{kind:'field',variable:'s',field:'label'},right:{kind:'literal',value:'Target'}}},hints:[{en:'Rename the step.',de:'Benenne den Schritt um.'}],errorClasses:[]};
 const solution=[{name:'rename_step' as const,params:{id:objectId,label:'Target'}}];project.tasks=[{task,solutions:{default:solution}}];project.heldOutTasks=[{...task,id:'heldout'}];project.heldOutSolutions={heldout:{default:solution}};
 project.variants[0]!.labels={[objectId]:'Before'};
 const right=structuredClone(project.initialState),step=right.objects[objectId]!;assert.equal(step.type,'step');if(step.type==='step')step.label='Target';const alternate=structuredClone(right);const alternateStep=alternate.objects[objectId]!;if(alternateStep.type==='step')alternateStep.x=100;
 project.checkerFixtures=['rename','heldout'].flatMap(taskId=>[{taskId,kind:'reference' as const,state:right,expected:true},{taskId,kind:'alternative' as const,state:alternate,expected:true},{taskId,kind:'near-miss' as const,state:project.initialState,expected:false}]);
 const compiled=compileProject({project,recordings:[a,b]}),worldPackage=await readWorldPackage(compiled.worldBytes),checkerPackage=await readCheckerBundle(compiled.checkerBytes);
 assert.equal(worldPackage.manifest.world.id,compiled.world.id);assert.equal(checkerDataFromBundle(checkerPackage,compiled.world).fixtures.length,6);
 const runtime=new Session(compiled.world,0,'rename');assert.equal(runtime.act(solution[0]!).ok,true);assert.equal(runtime.checkReplay().ok,true);const actual=runtime.state;assert.equal(checkState(compiled.world,actual,{taskId:'rename'}).passed,true);
 assert.deepEqual(validateSubmissionState(actual),actual);const exported=JSON.stringify({type:'excalidraw',version:2,files:{},elements:toRaw(actual)});assert.deepEqual(JSON.parse(JSON.stringify(parseExcalidraw(exported))),actual);assert.equal(checkSubmission(compiled.world,exported,{taskId:'rename'}).passed,true);
 assert.equal(JSON.stringify([a,b]),originals);assert.equal(compiled.report.demonstrationsPerRule['rename-step-v1'],2);
 const badMetadata=structuredClone(compiled.world);badMetadata.tasks[0]!.id='-task';assert.throws(()=>validateWorld(badMetadata));badMetadata.tasks[0]!.id='rename';badMetadata.id='_world';assert.throws(()=>validateWorld(badMetadata));assert.throws(()=>validatePredicate({op:'exists',type:'step',as:'-binder',where:{op:'true'}}));
});
test('semantic object domain retains reserved-key, character, identity and reference refusals',()=>{
 for(const bad of ['', 'x'.repeat(65),'../escape','a:b','a.b','a b','__proto__','prototype','constructor']){
  const state={objects:Object.fromEntries([[bad,{id:bad,type:'frame',name:'Own frame',deleted:false}]])};assert.throws(()=>validateState(state));assert.throws(()=>validateSubmissionState(state));
 }
 const state:State={objects:{'-frame':{id:'-different',type:'frame',name:'Frame',deleted:false}}};assert.throws(()=>validateState(state),/key differs/);assert.throws(()=>validateSubmissionState(state),/mismatch/);
 const missing:State={objects:{'_step':{id:'_step',type:'step',frameId:'-absent',label:'Step',x:0,y:0,width:100,height:80,fontFamily:3,deleted:false}}};assert.throws(()=>validateState(missing),/missing live frame/);assert.throws(()=>validateSubmissionState(missing),/missing live frame/);
});

test('repair intention addresses native object identities while keeping project metadata bounded',()=>{
 let project=createAuthorProject([recording('proposal','_NativeStep','Before','After')]);
 const center=structuredClone(project.initialState.objects._NativeStep!);assert.equal(center.type,'step');
 project.initialState.objects['-Previous']={...center,id:'-Previous'};project.initialState.objects['_Next']={...center,id:'_Next'};
 project.repair={schema:'practonaut.repair-intent/1',title:{en:'Own repair',de:'Eigene Änderung'},removedStepId:'_NativeStep',predecessorId:'-Previous',successorId:'_Next',reviewedExamples:false,cases:[{id:'default',labels:['Before','Review','After'],offset:{x:0,y:0}}]};
 assert.equal(validateAuthorProject(project).repair?.predecessorId,'-Previous');
 project.recordingIds=['_recording'];assert.throws(()=>validateAuthorProject(project),/author_project_invalid/);
});
for(const arrowId of ['-NativeArrow','_NativeArrow'])test('native created arrow '+arrowId+' proposes and confirms from two complete recorded successors',()=>{
 const before=scene('StartStep','Start');before.elements.EndStep={id:'EndStep',type:'rectangle',attributes:{isDeleted:false,frameId:'-frame',x:300,y:20,width:180,height:80}};before.elements['EndStep:text']={id:'EndStep:text',type:'text',attributes:{isDeleted:false,frameId:'-frame',containerId:'EndStep',originalText:'End',fontFamily:3}};
 const after=structuredClone(before);const arrow={id:arrowId,type:'arrow',attributes:{isDeleted:false,frameId:'-frame',start:'StartStep',end:'EndStep'}};after.elements[arrowId]=arrow;
 const a=recording('proposal','StartStep','Start','Changed');a.initial=before;a.gestures=[{index:0,boundary:'pointerup',before,after,events:[{kind:'create',element:arrow}],unmodeled:[],quarantined:false,quarantineReasons:[]}];
 const b=structuredClone(a);b.manifest.id='confirmation';const original=JSON.stringify([a,b]);validateRecording(a);validateRecording(b);
 const projected=projectSnapshot(after);assert.equal(projected.ok,true);const project=createAuthorProject([a]);assert.equal(project.hypotheses.find(h=>h.id==='connect-v1')?.status,'proposed');
 const confirmed=confirmHypothesis(project,{hypothesisId:'connect-v1',evidence:observationRef(b,0)},[a,b]);assert.equal(confirmed.hypotheses.find(h=>h.id==='connect-v1')?.status,'confirmed');assert.equal(JSON.stringify([a,b]),original);
});
