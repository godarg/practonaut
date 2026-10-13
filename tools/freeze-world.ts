// Trusted authoring script, never bundled into a pnworld. Solvability witnesses live in tests.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { canonicalJson, sha256Hex } from "../src/canonical/index.ts";
import type { World, State, Predicate, Value, Task, Localized, ActionName, ActionNameV1, EffectKind } from "../src/world/types.ts";
import { validateWorld, selectVariant } from "../src/world/index.ts";
import { Session } from "../src/core/index.ts";
import { checkState, validateCheckerData } from "../src/checker/index.ts";
import { solution } from "../tests/integration/solutions.ts";
const text = (en:string,de:string):Localized => ({en,de});
const lit = (value:string|number|null):Value => ({kind:"literal",value});
const field = (variable:string, f:string):Value => ({kind:"field",variable,field:f});
const eq = (left:Value,right:Value):Predicate => ({op:"eq",left,right});
const all = (...args:Predicate[]):Predicate => ({op:"all",args});
const count = (type:"step"|"arrow",n:number):Predicate => eq({kind:"count",type,as:"o",where:{op:"true"}},lit(n));
export function chainGoal(labels:string[]):Predicate {
 let p:Predicate = all(count("step",labels.length), count("arrow",labels.length-1),
  {op:"every",type:"step",as:"step",where:eq(field("step","frameId"),lit("flow-frame"))},
  {op:"exists",type:"frame",as:"frame",where:eq(field("frame","name"),lit("{{process}}"))});
 const arrows:Predicate[]=[];
 for(let i=0;i<labels.length-1;i++) arrows.push({op:"exists",type:"arrow",as:"edge",where:all(eq(field("edge","from"),field("s"+i,"id")),eq(field("edge","to"),field("s"+(i+1),"id")),eq(field("edge","frameId"),lit("flow-frame")))});
 p=all(p,...arrows);
 for(let i=labels.length-1;i>=0;i--) p={op:"exists",type:"step",as:"s"+i,where:all(eq(field("s"+i,"label"),lit(labels[i]!)),p)};
 return p;
}
export const loose:Predicate = {op:"exists",type:"arrow",as:"edge",where:{op:"any",args:[eq(field("edge","from"),lit(null)),eq(field("edge","to"),lit(null))]}};
function state(labels:string[]):State {
 const objects:State["objects"]={"flow-frame":{id:"flow-frame",type:"frame",deleted:false,name:"{{process}}"}};
 labels.forEach((label,i)=>{let id=["a","b","c"][i]!;objects[id]={id,type:"step",deleted:false,frameId:"flow-frame",label,x:100+i*240,y:160,width:180,height:100,fontFamily:3};if(i>0){let prev=["a","b","c"][i-1]!,edge=prev+id;objects[edge]={id:edge,type:"arrow",deleted:false,frameId:"flow-frame",from:prev,to:id};}});
 return {objects};
}
const labels=["{{first}}","{{middle}}","{{last}}"];
const goals=[chainGoal(labels),chainGoal(["{{order0}}","{{order1}}","{{order2}}","{{order3}}"]),chainGoal([labels[0]!,labels[2]!])];
const tasks:Task[]=[
 {id:"T1",title:text("Build the flow","Ablauf aufbauen"),prompt:text("Build {{process}} with exactly three labeled steps in its frame: {{first}} → {{middle}} → {{last}}. Use two arrows, each bound at both ends. Keep each label attached to its box.","Baue {{process}} mit genau drei beschrifteten Schritten im zugehörigen Frame auf: {{first}} → {{middle}} → {{last}}. Verbinde sie mit zwei Pfeilen, die an beiden Enden angebunden sind. Jede Beschriftung bleibt ihrer Box zugeordnet."),initialState:state([]),goal:goals[0]!,hints:[text("A flow needs one labeled step per activity and a directed arrow between consecutive steps.","Ein Ablauf braucht einen beschrifteten Schritt je Tätigkeit und einen gerichteten Pfeil zwischen aufeinanderfolgenden Schritten."),text("Add the three steps inside {{process}}. Attach each label to its box, then connect neighboring steps in the required order.","Lege die drei Schritte in {{process}} an. Ordne jeder Box ihre Beschriftung zu und verbinde benachbarte Schritte in der geforderten Reihenfolge."),text("Create {{first}}, {{middle}} and {{last}}. Bind one arrow from {{first}} to {{middle}} and one from {{middle}} to {{last}}.","Lege {{first}}, {{middle}} und {{last}} an. Binde einen Pfeil von {{first}} an {{middle}} und einen weiteren von {{middle}} an {{last}}.")],errorClasses:[]},
 {id:"T2",title:text("Insert a step","Schritt einfügen"),prompt:text("Insert {{inserted}} in gap {{insertPosition}} of the existing flow. Gap 1 is between {{first}} and {{middle}}; gap 2 is between {{middle}} and {{last}}. The final flow includes the three original activities and the inserted activity. The result has four steps and three bound arrows in this order: {{order0}} → {{order1}} → {{order2}} → {{order3}}.","Füge {{inserted}} in Lücke {{insertPosition}} des bestehenden Ablaufs ein. Lücke 1 liegt zwischen {{first}} und {{middle}}, Lücke 2 zwischen {{middle}} und {{last}}. Der endgültige Ablauf umfasst die drei bisherigen Tätigkeiten und die eingefügte Tätigkeit. Das Ergebnis hat vier Schritte und drei angebundene Pfeile in dieser Reihenfolge: {{order0}} → {{order1}} → {{order2}} → {{order3}}."),initialState:state(labels),goal:goals[1]!,hints:[text("Inserting a step splits one connection into two: an arrow into the new step and an arrow out of it.","Beim Einfügen wird eine Verbindung in zwei geteilt: einen Pfeil zum neuen Schritt und einen Pfeil von dort zum nächsten Schritt."),text("Keep the old arrow attached to its source. Move its target to {{inserted}}, then connect {{inserted}} to the old target.","Lass den bisherigen Pfeil an seinem Ausgangsschritt angebunden. Binde sein Ziel an {{inserted}} um und verbinde {{inserted}} mit dem bisherigen Zielschritt."),text("Add {{inserted}}. For gap 1, redirect {{first}} → {{middle}} to {{inserted}}, then connect {{inserted}} → {{middle}}. For gap 2, redirect {{middle}} → {{last}} to {{inserted}}, then connect {{inserted}} → {{last}}.","Lege {{inserted}} an. Für Lücke 1: Binde das Ziel des Pfeils {{first}} → {{middle}} an {{inserted}} um und verbinde {{inserted}} → {{middle}}. Für Lücke 2: Binde das Ziel des Pfeils {{middle}} → {{last}} an {{inserted}} um und verbinde {{inserted}} → {{last}}.")],errorClasses:[]},
 {id:"T3",title:text("Remove a step and close the chain","Schritt entfernen und Kette schließen"),prompt:text("Remove {{middle}} from the existing flow. Leave exactly two steps, {{first}} → {{last}}, connected by one arrow bound at both ends. Remove any redundant arrows.","Entferne {{middle}} aus dem bestehenden Ablauf. Übrig bleiben genau zwei Schritte, {{first}} → {{last}}, verbunden durch einen Pfeil, der an beiden Enden angebunden ist. Entferne überflüssige Pfeile."),initialState:state(labels),goal:goals[2]!,hints:[text("Deleting a step detaches its arrow ends. Close the remaining flow and remove the redundant connection.","Beim Löschen eines Schritts lösen sich die angebundenen Pfeilenden. Schließe den verbleibenden Ablauf und entferne die überflüssige Verbindung."),text("Redirect the incoming arrow to {{last}}. Remove the arrow that starts at {{middle}} before deleting the step.","Binde den eingehenden Pfeil an {{last}} um. Entferne den Pfeil, der bei {{middle}} beginnt, bevor du den Schritt löschst."),text("Reconnect the end of {{first}} → {{middle}} to {{last}}. Remove the entire {{middle}} → {{last}} arrow, then delete {{middle}}.","Binde das Ziel des Pfeils {{first}} → {{middle}} an {{last}} um. Entferne den gesamten Pfeil {{middle}} → {{last}} und lösche danach {{middle}}.")],errorClasses:[]}
];
// The consequence wording is reviewed against the recorded real UI deletion before freezing.
for(const task of tasks) task.errorClasses=[{id:"loose-arrow",category:"accepted_but_violates_goal",when:loose,explanation:text("At least one arrow end is detached from a step. Deleting a step in Excalidraw leaves its arrows visible in their old positions, with those ends detached. Reconnect the loose ends or remove arrows you no longer need.","Mindestens ein Pfeilende ist nicht an einen Schritt angebunden. Beim Löschen eines Schritts zeigt Excalidraw dessen Pfeile weiter an ihren bisherigen Positionen; die betroffenen Enden sind gelöst. Binde die losen Enden an vorhandene Schritte oder entferne nicht mehr benötigte Pfeile.")}];
const parameters={
 add_step:{frameId:{type:"id"},label:{type:"string",max:4096},x:{type:"integer",min:-100000,max:100000},y:{type:"integer",min:-100000,max:100000},width:{type:"integer",min:60,max:2000},height:{type:"integer",min:40,max:2000},fontFamily:{type:"integer",min:3,max:3}},
 rename_step:{id:{type:"id"},label:{type:"string",max:4096}},move_step:{id:{type:"id"},x:{type:"integer",min:-100000,max:100000},y:{type:"integer",min:-100000,max:100000}},
 connect:{frameId:{type:"id"},from:{type:"id"},to:{type:"id"}},reconnect_end:{id:{type:"id"},end:{type:"end"},target:{type:"id"}},disconnect:{id:{type:"id"}},delete_step:{id:{type:"id"}}
} as const;
const effects:Record<ActionNameV1,EffectKind[]>={add_step:["create_step"],rename_step:["set_label"],move_step:["set_position"],connect:["create_arrow"],reconnect_end:["set_endpoint"],disconnect:["disconnect_arrow"],delete_step:["tombstone_step","detach_incident_arrows"]};
export function buildWorld(evidence:Record<string,{run:string;case:string;sha256:string}>):World {
 const names=Object.keys(parameters) as ActionNameV1[];
 const surfaces=[{first:"Receive request",middle:"Approve request",last:"Archive request",inserted:"Check details",process:"Request flow"},{first:"Anfrage annehmen",middle:"Anfrage freigeben",last:"Anfrage ablegen",inserted:"Angaben prüfen",process:"Anfrageprozess"},{first:"Collect draft",middle:"Review draft",last:"Publish draft",inserted:"Check sources",process:"Draft flow"}];
 const rules=names.map(name=>({id:name,action:name,status:"confirmed" as const,preconditions:[],effects:effects[name],evidence:[evidence[name]!]}));
 if(evidence.delete_incident)rules.find(r=>r.action==="delete_step")!.evidence.push(evidence.delete_incident);
 if(evidence.delete_ui)rules.find(r=>r.action==="delete_step")!.evidence.push(evidence.delete_ui);
 return {schema:"practonaut.world/1",id:"flow-diagram",version:"1.0.0",app:{adapterId:"excalidraw",versionRange:"0.18.1",fontFamilies:[3],excludedAttributes:{seed:"App randomness",versionNonce:"App randomness",version:"App revision counter",updated:"App timestamp",index:"App order key",arrowGeometry:"Derived from bindings; checked independently on export",textGeometry:"Font metrics; checked independently on export",boundElements:"Reverse binding cache; checked for integrity",frameGeometry:"Outside the declared semantic set"}},units:{x:"pixel × 1",y:"pixel × 1",width:"pixel × 1",height:"pixel × 1"},objectTypes:[{type:"frame",attributes:{id:"id",deleted:"boolean",name:"string"}},{type:"step",attributes:{id:"id",deleted:"boolean",frameId:"id",label:"string",x:"integer",y:"integer",width:"integer",height:"integer",fontFamily:"integer"}},{type:"arrow",attributes:{id:"id",deleted:"boolean",frameId:"id",from:"nullable-id",to:"nullable-id"}}],initialState:state([]),actions:names.map(name=>({name,parameters:parameters[name],preconditions:[]})),rules,tasks,variants:{generator:"finite-seeded-v1",cases:surfaces.flatMap((s,i)=>[1,2].map(insertPosition=>{const order=insertPosition===1?[s.first,s.inserted,s.middle,s.last]:[s.first,s.middle,s.inserted,s.last];return {id:`case-${i}-${insertPosition}`,labels:{...s,order0:order[0]!,order1:order[1]!,order2:order[2]!,order3:order[3]!},insertPosition,layoutOffset:{x:i*20,y:insertPosition*20}};}))},provenance:{authors:["Practonaut contributors"],adapterVersion:"1.0.0",appVersion:"0.18.1",compileToolVersion:"0.0.0",recordings:[]},rights:{license:"CC0-1.0",assets:[],recordings:[]}};
}
// CLI intentionally waits for actual saved evidence; no invented confirmation.
if(process.argv[1]?.endsWith("freeze-world.ts")){
 const evidencePath="tests/adapter/evidence/conformance.json";
 if(!existsSync(evidencePath)) throw new Error("Conformance evidence is required before freezing");
 const bytes=readFileSync(evidencePath);const parsed=JSON.parse(bytes.toString()) as {app:string;react:string;networkAttempts:number;runs:Array<{case:string;hash:string;render:{ok:boolean}}>};
 const refs:Record<string,{run:string;case:string;sha256:string}>={};
 if(parsed.app!=="@excalidraw/excalidraw@0.18.1"||parsed.react!=="18.3.1"||parsed.networkAttempts!==0)throw new Error("Conformance runtime or offline condition differs");
 for(const name of Object.keys(parameters)) {
  const runs=parsed.runs.filter(r=>r.case===name||r.case.startsWith(name+"-"));
  if(runs.length<3||runs.some(r=>!r.render.ok))throw new Error(`Missing passing conformance for ${name}`);
  const caseId=runs[0]!.case;const repeated=runs.filter(r=>r.case===caseId);
  if(repeated.length<3||new Set(repeated.map(r=>r.hash)).size!==1)throw new Error(`Nonidentical conformance for ${name}`);
  refs[name]={run:evidencePath,case:caseId,sha256:sha256Hex(bytes)};
 }
 const deletion=parsed.runs.filter(r=>r.case==="real-ui-delete-loose-arrow");
 if(deletion.length<3||deletion.some(r=>r.render.ok)||new Set(deletion.map(r=>r.hash)).size!==1)throw new Error("Real deletion consequence lacks repeated red evidence");
 const apiDeletion=parsed.runs.filter(r=>r.case==="real-api-delete-loose-arrow");
 if(apiDeletion.length<3||apiDeletion.some(r=>r.render.ok)||new Set(apiDeletion.map(r=>r.hash)).size!==1)throw new Error("API deletion with incident arrows lacks repeated red evidence");
 refs.delete_incident={run:evidencePath,case:"real-api-delete-loose-arrow",sha256:sha256Hex(bytes)};
 refs.delete_ui={run:evidencePath,case:"real-ui-delete-loose-arrow",sha256:sha256Hex(bytes)};
 const world=validateWorld(buildWorld(refs));
 const checker=validateCheckerData(JSON.parse(readFileSync("examples/worlds/flow-diagram.check/checker.json","utf8")),world);
 const reached=new Set<string>();
 for(let seed=0;seed<1000&&reached.size<world.variants.cases.length;seed++){
  const variant=selectVariant(world,seed);if(reached.has(variant.id))continue;reached.add(variant.id);
  for(const task of world.tasks){const session=new Session(world,seed,task.id);
   for(const action of solution(world,seed,task.id)){const result=session.act(action);if(!result.ok)throw new Error(`Unsolvable ${variant.id}/${task.id}: ${result.error.code}`);}
   if(!session.checkReplay().ok||!checkState(world,session.state,{seed,taskId:task.id,bundle:checker}).passed)throw new Error(`Witness failed for ${variant.id}/${task.id}`);
  }
 }
 if(reached.size!==world.variants.cases.length)throw new Error("Bounded seed search did not reach every variant");
 writeFileSync("examples/worlds/flow-diagram/world.json",canonicalJson(world)+"\n");
 console.log("Frozen flow-diagram from measured conformance",sha256Hex(bytes));
}
