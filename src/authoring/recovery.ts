import type { RecordedGesture, Recording } from '../adapters/excalidraw/recorder-types.ts';
import { projectSnapshot, validateRecording } from '../adapters/excalidraw/recorder.ts';
import { canonicalJson } from '../canonical/index.ts';
import type { Action, Localized, Predicate, State, Task, Value } from '../world/types.ts';
import { validateState } from '../world/schema.ts';
import type { AuthorProject } from './types.ts';
import type { CompileReadiness, ObservationSummary, RepairExamples, RepairIntent } from './recovery-types.ts';
import { AuthoringError, analyzeRecordings, confirmHypothesis, createAuthorProject, observationRef, validateAuthorProject, verifiedObservations, hasExcludedSource } from './project.ts';
import { hasIncidentArrow, observationAction, RULE_TEMPLATES } from './templates.ts';

const words = (en:string,de:string):Localized=>({en,de});
const literal = (value:string|number|boolean|null):Value=>({kind:'literal',value});
const field = (variable:string,name:string):Value=>({kind:'field',variable,field:name});
const equals = (left:Value,value:string|number|boolean|null):Predicate=>({op:'eq',left,right:literal(value)});
const exists = (type:'step'|'arrow',id:string):Predicate=>({op:'exists',type,as:'object',where:equals(field('object','id'),id)});
const count = (type:'step'|'arrow',n:number):Predicate=>equals({kind:'count',type,as:'object',where:{op:'true'}},n);
const REQUIRED = ['delete-keeps-arrows-v1','reconnect-v1','disconnect-v1'] as const;

/** Self-created prepared content. No runtime or handwritten reference world supplies it. */
export function prepareRepairProject(input:{id:string;title:string|Localized;author:string;labels:[string,string,string]}):AuthorProject {
  const project=createAuthorProject(); project.id=input.id; project.authors=[input.author];
  const title=typeof input.title==='string'?words(input.title,input.title):input.title;
  // Allocate readable new-scene boxes before recording; retained projects are never resized.
  const wordWidth=Math.min(2000,Math.max(280,...input.labels.flatMap(label=>label.split(/\s+/u).map(word=>Array.from(word).length*12+32))));
  // A label that just fits on one line touches the box edges (estimate 12 units a character; Cascadia
  // renders slightly narrower). Such boxes get narrower instead, so the label wraps at a word boundary
  // with 24 units each side and the scene stays as small (and its zoom as large) as before.
  const tight=(w:number):boolean=>input.labels.some(label=>{const full=Array.from(label).length*12;return full>w-48&&full<=w+8;});
  const narrow=Math.max(...input.labels.flatMap(label=>label.split(/\s+/u).map(word=>Array.from(word).length*12+48)));
  const width=tight(wordWidth)&&!tight(narrow)?narrow:wordWidth;
  project.initialState={objects:{frame:{id:'frame',type:'frame',deleted:false,name:'Process'},
    a:{id:'a',type:'step',deleted:false,frameId:'frame',label:input.labels[0],x:100,y:180,width,height:100,fontFamily:3},
    b:{id:'b',type:'step',deleted:false,frameId:'frame',label:input.labels[1],x:100+width+80,y:180,width,height:100,fontFamily:3},
    c:{id:'c',type:'step',deleted:false,frameId:'frame',label:input.labels[2],x:100+2*(width+80),y:180,width,height:100,fontFamily:3},
    ab:{id:'ab',type:'arrow',deleted:false,frameId:'frame',from:'a',to:'b'},
    bc:{id:'bc',type:'arrow',deleted:false,frameId:'frame',from:'b',to:'c'}}};
  project.notes='Prepared three-step scene, task intention, solution recipes and independently specified checker examples. Demonstrations must separately evidence all executable rules.';
  return configureRepairProject(project,{schema:'practonaut.repair-intent/1',title,
    removedStepId:'b',predecessorId:'a',successorId:'c',reviewedExamples:false,
    cases:[{id:'original',labels:input.labels,offset:{x:0,y:0}},{id:'shifted',labels:[...input.labels],offset:{x:40,y:60}}]});
}

/** This builder is deliberately bounded to the prepared A → B → C repair pilot. */
export function configureRepairProject(raw:AuthorProject,intent:RepairIntent):AuthorProject {
  const project=validateAuthorProject({...raw,repair:intent});
  if(intent.predecessorId!=='a'||intent.removedStepId!=='b'||intent.successorId!=='c')throw new AuthoringError('repair_intent_invalid','the prepared pilot removes the middle step and retains the first and last steps');
  for(const [id,from,to] of [['ab','a','b'],['bc','b','c']]) {
    const arrow=project.initialState.objects[id!];
    if(arrow?.type!=='arrow'||arrow.deleted||arrow.from!==from||arrow.to!==to)throw new AuthoringError('repair_intent_invalid','prepared repair requires the original two connections');
  }
  // Variant labels belong to practice cases. The recorded author scene keeps its original names.
  project.variants=intent.cases.map(c=>({id:c.id,labels:{first:c.labels[0],middle:c.labels[1],last:c.labels[2]},insertPosition:0,layoutOffset:c.offset}));
  const initialState=structuredClone(project.initialState);
  for(const [i,id] of ['a','b','c'].entries()){const step=initialState.objects[id];if(step?.type==='step')step.label=['{{first}}','{{middle}}','{{last}}'][i]!;}
  const goal:Predicate={op:'all',args:[{op:'not',arg:exists('step','b')},exists('step','a'),exists('step','c'),count('step',2),count('arrow',1),
    {op:'exists',type:'arrow',as:'connection',where:{op:'all',args:[equals(field('connection','from'),'a'),equals(field('connection','to'),'c')]}}]};
  const task:Task={id:'repair-flow',title:intent.title,
    prompt:words('Remove “{{middle}}”. Connect “{{first}}” directly to “{{last}}”, keeping both steps and exactly one attached arrow.','Entferne „{{middle}}“. Verbinde „{{first}}“ direkt mit „{{last}}“. Beide Schritte und genau ein verbundener Pfeil sollen bleiben.'),
    initialState,goal,
    hints:[words('Removing a step can leave arrows behind. Look at both arrow ends.','Beim Entfernen eines Schritts können Pfeile zurückbleiben. Prüfe beide Pfeilenden.'),
      words('Keep either existing arrow, attach its loose end to the remaining step, and remove the other arrow.','Behalte einen der vorhandenen Pfeile, verbinde sein loses Ende mit dem verbleibenden Schritt und entferne den anderen Pfeil.')],
    errorClasses:[{id:'middle-remains',category:'accepted_but_violates_goal',when:exists('step','b'),explanation:words('The middle step is still present. Remove it to shorten the process.','Der mittlere Schritt ist noch vorhanden. Entferne ihn, um den Ablauf zu verkürzen.')},
      {id:'extra-arrow',category:'accepted_but_violates_goal',when:{op:'gt',left:{kind:'count',type:'arrow',as:'arrow',where:{op:'true'}},right:literal(1)},explanation:words('More than one arrow remains. Keep the direct connection and remove the spare arrow.','Es bleibt mehr als ein Pfeil. Behalte die direkte Verbindung und entferne den überflüssigen Pfeil.')},
      {id:'loose-arrow',category:'accepted_but_violates_goal',when:{op:'exists',type:'arrow',as:'arrow',where:{op:'any',args:[equals(field('arrow','from'),null),equals(field('arrow','to'),null)]}},explanation:words('An arrow has a loose end. Attach the arrow you keep to the remaining step.','Ein Pfeil hat ein loses Ende. Verbinde den Pfeil, den du behältst, mit dem verbleibenden Schritt.')} ]};
  const recipe:Action[]=[{name:'delete_step',params:{id:'b'}},{name:'reconnect_end',params:{id:'ab',end:'end',target:'c'}},{name:'disconnect',params:{id:'bc'}}];
  project.tasks=[{task,solutions:Object.fromEntries(intent.cases.map(c=>[c.id,structuredClone(recipe)]))}];
  project.heldOutTasks=[]; project.heldOutSolutions={};
  const examples=repairExamples(project)!;
  project.checkerFixtures=[{taskId:task.id,kind:'reference',state:examples.reference,expected:true},
    {taskId:task.id,kind:'alternative',state:examples.alternative,expected:true},{taskId:task.id,kind:'near-miss',state:examples.nearMiss,expected:false}];
  return validateAuthorProject(project);
}

/** Expected results are independently authored assignments, never Session/apply output. */
export function repairExamples(project:AuthorProject):RepairExamples|undefined {
  if(!project.repair)return undefined;
  const reference=structuredClone(project.initialState),alternative=structuredClone(project.initialState),nearMiss=structuredClone(project.initialState);
  for(const state of [reference,alternative,nearMiss])state.objects.b!.deleted=true;
  if(reference.objects.ab?.type==='arrow'){reference.objects.ab.from='a';reference.objects.ab.to='c';}
  if(reference.objects.bc?.type==='arrow'){reference.objects.bc.deleted=true;reference.objects.bc.from=null;reference.objects.bc.to=null;}
  if(alternative.objects.bc?.type==='arrow'){alternative.objects.bc.from='a';alternative.objects.bc.to='c';}
  if(alternative.objects.ab?.type==='arrow'){alternative.objects.ab.deleted=true;alternative.objects.ab.from=null;alternative.objects.ab.to=null;}
  if(nearMiss.objects.ab?.type==='arrow')nearMiss.objects.ab.to='c';
  if(nearMiss.objects.bc?.type==='arrow')nearMiss.objects.bc.from=null;
  for(const state of [reference,alternative,nearMiss])validateState(state);
  return {reference,alternative,nearMiss,origin:'prepared-independent-examples'};
}

export function compileReadiness(project:AuthorProject|null):CompileReadiness {
  const missing:CompileReadiness['missing']=[];
  const add=(code:string,en:string,de:string,step:CompileReadiness['missing'][number]['step'])=>missing.push({code,message:words(en,de),step});
  if(!project){add('project_missing','Start a named repair exercise.','Beginne eine benannte Reparaturübung.','task');return{ready:false,missing};}
  if(!project.recordingIds.length)add('observations_missing','Record the three changes in the real editor.','Nimm die drei Änderungen im echten Editor auf.','record');
  const required:readonly string[]=project.repair?REQUIRED:[];
  for(const id of required){const h=project.hypotheses.find(h=>h.id===id),t=RULE_TEMPLATES.find(t=>t.id===id)!;
    if(h?.status!=='confirmed'||!h.proposedFrom.length||!h.confirmingEvidence.length||h.refutingEvidence.length)add(`rule_missing_${id}`,`Still needs valid evidence: ${t.explanation.en}`,`Noch gültig zu belegen: ${t.explanation.de}`,'evidence');}
  if(!required.length&&!project.hypotheses.some(h=>h.status==='confirmed'&&h.proposedFrom.length&&h.confirmingEvidence.length&&!h.refutingEvidence.length))add('rules_missing','Confirm at least one observed rule with new evidence.','Bestätige mindestens eine beobachtete Regel mit neuer Evidenz.','evidence');
  if(!project.tasks.length)add('tasks_missing','Define the exercise goal.','Lege das Übungsziel fest.','task');
  if(!project.variants.length)add('variants_missing','Add at least one practice case.','Ergänze mindestens einen Übungsfall.','task');
  if(project.repair&&!project.repair.reviewedExamples)add('examples_unreviewed','Review the two valid results and the near miss.','Prüfe die zwei gültigen Ergebnisse und den Beinahe-Treffer.','task');
  for(const task of [...project.tasks,...project.heldOutTasks.map(task=>({task,solutions:project.heldOutSolutions?.[task.id]??{}}))]){
    for(const variant of project.variants)if(!task.solutions[variant.id])add('solution_missing',`A solution is missing for “${task.task.title.en}”, case “${variant.id}”.`,`Für „${task.task.title.de}“, Fall „${variant.id}“, fehlt eine Lösung.`,'task');
    for(const kind of ['alternative','near-miss'] as const)if(!project.checkerFixtures?.some(f=>f.taskId===task.task.id&&f.kind===kind))add('checker_example_missing',`Independent ${kind} example missing for “${task.task.title.en}”.`,`Für „${task.task.title.de}“ fehlt ein unabhängiges ${kind==='alternative'?'gültiges Alternativergebnis':'Beinahe-Treffer-Ergebnis'}.`,'task');
  }
  return{ready:missing.length===0,missing};
}

/** Historical labels, not the currently edited scene, name the recording's objects. */
export function summarizeObservation(raw:Recording,gesture:RecordedGesture):ObservationSummary {
  const recording=validateRecording(raw),stored=recording.gestures.find(g=>g.index===gesture.index);
  if(!stored||canonicalJson(stored)!==canonicalJson(gesture))throw new AuthoringError('evidence_missing','gesture does not belong to the recording');
  const ref=observationRef(recording,gesture.index),before=projectSnapshot(gesture.before),after=projectSnapshot(gesture.after);
  const result:ObservationSummary={ref,title:words('Unsupported change','Nicht unterstützte Änderung'),consequences:[],eligibleFor:[],before:before.ok?before.state:{objects:{}},after:after.ok?after.state:{objects:{}}};
  if(!before.ok||!after.ok){result.excludedReason='unsupported';result.consequences=[words('This change cannot be represented by the supported process diagram.','Diese Änderung lässt sich nicht als unterstütztes Prozessdiagramm darstellen.')];return result;}
  const family=observationAction(before.state,after.state);
  const name=(id:string|null,en=false):string=>{const o=id?before.state.objects[id]??after.state.objects[id]:undefined;return o?.type==='step'?o.label:en?'an unconnected end':'ein loses Ende';};
  const changed=Object.values(before.state.objects).filter(o=>canonicalJson(o)!==canonicalJson(after.state.objects[o.id]??null));
  const step=family==='delete_step'?changed.find(o=>o.type==='step'&&!o.deleted&&after.state.objects[o.id]?.deleted):changed.find(o=>o.type==='step'),arrow=changed.find(o=>o.type==='arrow');
  if(family==='delete_step'&&step?.type==='step'){
    result.title=words(`Removed “${step.label}”`,`„${step.label}“ entfernt`);
    const incident=Object.values(before.state.objects).filter(o=>o.type==='arrow'&&!o.deleted&&(o.from===step.id||o.to===step.id));
    const removed=changed.filter(o=>o.type==='step'&&!o.deleted&&after.state.objects[o.id]?.deleted);
    if(removed.length>1)result.title=words(`Removed ${removed.map(o=>o.type==='step'?o.label:'').join(', ')}`,`Schritte entfernt: ${removed.map(o=>o.type==='step'?o.label:'').join(', ')}`);
    const remaining=Object.values(after.state.objects).filter(o=>o.type==='step'&&!o.deleted).map(o=>o.type==='step'?o.label:'').join(', ');
    result.consequences.push(words(`Remaining steps: ${remaining||'none'}.`,`Verbleibende Schritte: ${remaining||'keine'}.`));
    for(const a of incident)if(a.type==='arrow'){const successor=after.state.objects[a.id];result.consequences.push(successor?.deleted?words(`The arrow from ${name(a.from,true)} to ${name(a.to,true)} was removed.`,`Der Pfeil von ${name(a.from)} zu ${name(a.to)} wurde entfernt.`):words(`The arrow from ${name(a.from,true)} to ${name(a.to,true)} remains with a loose end.`,`Der Pfeil von ${name(a.from)} zu ${name(a.to)} bleibt mit losem Ende erhalten.`));}
    if(!incident.length)result.consequences.push(words('No arrow was attached. This case cannot distinguish what happens to attached arrows.','Es war kein Pfeil verbunden. Dieser Fall unterscheidet das Verhalten verbundener Pfeile nicht.'));
  }else if(family==='disconnect'&&arrow?.type==='arrow'){
    result.title=words(`Removed the arrow from ${name(arrow.from,true)} to ${name(arrow.to,true)}`,`Pfeil von ${name(arrow.from)} zu ${name(arrow.to)} entfernt`);
    result.consequences.push(words('The steps remain; this arrow no longer connects them.','Die Schritte bleiben; dieser Pfeil verbindet sie nicht mehr.'));
  }else if(family==='reconnect_end'&&arrow?.type==='arrow'){
    const successor=after.state.objects[arrow.id];if(successor?.type==='arrow'){
      result.title=words('Reconnected an arrow end','Pfeilende neu verbunden');
      result.consequences.push(words(`The arrow now connects ${name(successor.from,true)} to ${name(successor.to,true)}.`,`Der Pfeil verbindet jetzt ${name(successor.from)} mit ${name(successor.to)}.`));}
  }else if(family==='rename_step'&&step?.type==='step'){
    const successor=after.state.objects[step.id];if(successor?.type==='step')result.title=words(`Renamed “${step.label}” to “${successor.label}”`,`„${step.label}“ in „${successor.label}“ umbenannt`);
    result.consequences.push(words('Position and connections remain.','Position und Verbindungen bleiben erhalten.'));
  }else if(family==='move_step'&&step?.type==='step'){
    result.title=words(`Moved “${step.label}”`,`„${step.label}“ verschoben`);result.consequences.push(words('Its label and connections remain.','Beschriftung und Verbindungen bleiben erhalten.'));
  }else if(family==='add_step'){
    const added=Object.values(after.state.objects).find(o=>!before.state.objects[o.id]&&o.type==='step');
    result.title=words(`Created “${added?.type==='step'?added.label:'a step'}”`,`„${added?.type==='step'?added.label:'Schritt'}“ erstellt`);
    result.consequences.push(words('Existing objects remain.','Die vorhandenen Objekte bleiben erhalten.'));
  }else if(family==='connect'){
    const added=Object.values(after.state.objects).find(o=>!before.state.objects[o.id]&&o.type==='arrow');if(added?.type==='arrow')result.title=words(`Connected ${name(added.from,true)} to ${name(added.to,true)}`,`${name(added.from)} mit ${name(added.to)} verbunden`);
    result.consequences.push(words('A new arrow connects the two steps.','Ein neuer Pfeil verbindet die beiden Schritte.'));
  }
  if(gesture.quarantined||recording.manifest.status==='quarantined')result.excludedReason='quarantined';
  else if(gesture.unmodeled.length)result.excludedReason='unmodeled';
  else{result.eligibleFor=RULE_TEMPLATES.filter(t=>t.matches(before.state,after.state)&&(t.action!=='delete_step'||hasIncidentArrow(before.state,after.state))).map(t=>t.id);if(!result.eligibleFor.length){result.excludedReason='unsupported';result.consequences.push(words('This complete change is not eligible to confirm a supported rule.','Diese vollständige Änderung eignet sich nicht zur Bestätigung einer unterstützten Regel.'));}}
  return result;
}

/** Restore authority from sources; persistent status words themselves grant nothing. */
export function revalidateAuthorProject(raw:AuthorProject,recordings:Recording[]):AuthorProject {
  const project=validateAuthorProject(raw),sources=recordings.map(validateRecording);
  if(sources.length!==project.recordingIds.length||new Set(sources.map(r=>r.manifest.id)).size!==sources.length||sources.some(r=>!project.recordingIds.includes(r.manifest.id)))throw new AuthoringError('provenance_missing','project source recordings differ from saved project');
  const observed=verifiedObservations(sources),find=(ref:AuthorProject['hypotheses'][number]['proposedFrom'][number])=>observed.find(o=>canonicalJson(o.ref)===canonicalJson(ref));
  const hypotheses=project.hypotheses.map(h=>{
    const template=RULE_TEMPLATES.find(t=>t.id===h.template)!;
    for(const ref of [...h.proposedFrom,...h.confirmingEvidence,...h.refutingEvidence])if(!find(ref))throw new AuthoringError('evidence_missing','saved evidence is missing, altered, unmodeled or quarantined');
    for(const ref of [...h.proposedFrom,...h.confirmingEvidence]){const o=find(ref)!;if(!template.matches(o.before,o.after))throw new AuthoringError('evidence_disagrees','saved observation disagrees with the rule');}
    for(const ref of h.confirmingEvidence)if(h.proposedFrom.some(p=>p.recordingId===ref.recordingId))throw new AuthoringError('confirmation_requires_new_observation','confirmation requires a separate saved recording');
    return{...h,status:'proposed' as const,confirmingEvidence:[],refutingEvidence:[]};
  });
  const analysis=analyzeRecordings(sources,{hypotheses,questions:[]});
  let restored:AuthorProject={...project,...analysis};
  if(hasExcludedSource(sources)) {
    // Preserve historical confirmations as citations, while withholding execution.
    for(const old of project.hypotheses) restored.hypotheses.find(h=>h.id===old.id)!.confirmingEvidence=structuredClone(old.confirmingEvidence);
    return validateAuthorProject(restored);
  }
  for(const old of project.hypotheses){
    const current=restored.hypotheses.find(h=>h.id===old.id)!;
    if(current.status==='refuted'){current.confirmingEvidence=structuredClone(old.confirmingEvidence);continue;}
    for(const evidence of old.confirmingEvidence)restored=confirmHypothesis(restored,{hypothesisId:old.id,evidence},sources);
  }
  return validateAuthorProject(restored);
}
