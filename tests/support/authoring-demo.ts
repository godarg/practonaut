/** Scripted UI demonstrations; self-created CC0 scene, no reference-world/rule imports. */
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createRecordingStore } from '../../src/recordings/store.ts';
import { toRaw } from '../../src/adapters/excalidraw/raw.ts';
import { validateRecording, projectSnapshot } from '../../src/adapters/excalidraw/recorder.ts';
import type { Recording, RecordedGesture } from '../../src/adapters/excalidraw/recorder-types.ts';
import { COALESCING_VERSION } from '../../src/adapters/excalidraw/recorder-types.ts';
import { createAuthorProject, analyzeRecordings, confirmHypothesis, observationRef, compileProject, RULE_TEMPLATES } from '../../src/authoring/index.ts';
import { canonicalJson, sha256Hex } from '../../src/canonical/index.ts';
import { readWorldPackage, readCheckerBundle } from '../../src/package/reader.ts';
import { validateWorld } from '../../src/world/schema.ts';
import { Session } from '../../src/core/session.ts';
import { startHost } from '../../src/host/server.ts';
import { TOKEN_HEADER } from '../../src/host/protocol.ts';
import type { State, ActionNameV1, Action, Predicate, Task, CheckerFixture } from '../../src/world/types.ts';

const scene:State={objects:{
 f:{id:'f',type:'frame',deleted:false,name:'Demonstration workbench'},
 a:{id:'a',type:'step',deleted:false,frameId:'f',label:'Prepare',x:300,y:300,width:180,height:100,fontFamily:3},
 b:{id:'b',type:'step',deleted:false,frameId:'f',label:'Review',x:650,y:300,width:180,height:100,fontFamily:3},
 c:{id:'c',type:'step',deleted:false,frameId:'f',label:'Archive',x:1000,y:300,width:180,height:100,fontFamily:3},
 ab:{id:'ab',type:'arrow',deleted:false,frameId:'f',from:'a',to:'b'},
 bc:{id:'bc',type:'arrow',deleted:false,frameId:'f',from:'b',to:'c'},
}};
const names:ActionNameV1[]=['rename_step','move_step','delete_step','disconnect','add_step','connect','reconnect_end'];
async function canvasPoint(page:Page,id:string,part:'center'|'corner'|'bottom'|'arrow-middle'|'arrow-end'|'left'):Promise<{x:number;y:number}>{
 return page.evaluate(({id,part})=>{const api=(window as unknown as {__demo:{api:{getSceneElements():Array<{id:string;x:number;y:number;width:number;height:number;points?:number[][]}>;getAppState():{zoom:{value:number};scrollX:number;scrollY:number;offsetLeft:number;offsetTop:number}}}}).__demo.api;const e=api.getSceneElements().find(e=>e.id===id);if(!e)throw Error('Native target is absent: '+id);let x=e.x+e.width/2,y=e.y+e.height/2;if(part==='corner'){x=e.x+30;y=e.y+25;}if(part==='bottom')y=e.y+e.height+2;if(part==='left')x=e.x-4;if(part==='arrow-middle'||part==='arrow-end'){const p=e.points?.at(-1);if(!p)throw Error('Native arrow has no endpoint');const fraction=part==='arrow-middle'?.5:1;x=e.x+p[0]!*fraction;y=e.y+p[1]!*fraction;}const s=api.getAppState();return{x:(x+s.scrollX)*s.zoom.value+s.offsetLeft,y:(y+s.scrollY)*s.zoom.value+s.offsetTop};},{id,part});
}
async function gesture(page:Page,name:ActionNameV1):Promise<void>{
 await page.waitForFunction('window.__demo.api.getAppState().width === innerWidth && window.__demo.api.getAppState().height === innerHeight',{},{timeout:5000});
 await page.mouse.click(1450,850);const a=await canvasPoint(page,'a','corner');
 if(name==='rename_step') {const p=await canvasPoint(page,'a','center');await page.mouse.dblclick(p.x,p.y);await page.locator('textarea').waitFor({state:'visible'});await page.locator('textarea').fill('Prepared');await page.keyboard.press('Escape');}
 else if(name==='move_step'){await page.mouse.click(a.x,a.y);await page.keyboard.press('Shift+ArrowDown');}
 else if(name==='delete_step'){const p=await canvasPoint(page,'b','corner');await page.mouse.click(p.x,p.y);await page.keyboard.press('Delete');}
 else if(name==='disconnect'){const p=await canvasPoint(page,'bc','arrow-middle');await page.mouse.click(p.x,p.y);await page.keyboard.press('Delete');}
 else if(name==='add_step'){
  await page.mouse.click(a.x,a.y);
  try{await page.waitForFunction('window.__demo.api.getAppState().selectedElementIds.a === true',{},{timeout:5000});}
  catch{throw new Error('Native duplication was not attempted: the intended step was not selected.');}
  await page.keyboard.press('ControlOrMeta+d'); // Excalidraw duplicates with Cmd on macOS, Ctrl elsewhere
  // The key boundary waits two animation frames after keyup; when frames arrive late the 120 ms quiet
  // timer closes the same gesture first (issue #8). Both are completed gestures with identical events.
  try{await page.waitForFunction(()=>{
   const demo=(window as unknown as {__demo:{api:{getSceneElements():Array<{type:string;isDeleted:boolean}>};recorder:{gestures:RecordedGesture[]}}}).__demo;
   return demo.api.getSceneElements().filter(e=>e.type==='rectangle'&&!e.isDeleted).length===4&&demo.recorder.gestures.some(g=>['key','quiet'].includes(g.boundary)&&g.events.filter(e=>e.kind==='create'&&e.element.type==='rectangle').length===1&&Object.values(g.after.elements).filter(e=>e.type==='rectangle'&&!e.attributes.isDeleted).length===4);
  },{},{timeout:5000});}
  catch{throw new Error('Native duplication did not produce one additional step and a completed recorded keyboard gesture.');}
  return;
 }
 else if(name==='connect'){
  await page.keyboard.press('a');await page.waitForFunction('window.__demo.api.getAppState().activeTool.type === "arrow"',{},{timeout:5000});const start=await canvasPoint(page,'a','bottom'),end=await canvasPoint(page,'c','bottom');await page.mouse.move(start.x,start.y);await page.mouse.down();
  // Eight samples, like a real drag: the held pointer keeps pauses between them inside one gesture.
  await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up();await page.waitForFunction(()=>{const api=(window as unknown as {__demo:{api:{getAppState():{activeTool:{type:string}};getSceneElements():Array<{id:string;type:string;isDeleted:boolean;startBinding?:{elementId:string}|null;endBinding?:{elementId:string}|null}>}}}).__demo.api;return api.getAppState().activeTool.type==='selection'&&api.getSceneElements().some(e=>e.type==='arrow'&&!e.isDeleted&&!['ab','bc'].includes(e.id)&&e.startBinding?.elementId==='a'&&e.endBinding?.elementId==='c');},{},{timeout:5000});await page.keyboard.press('Escape');
 }
 else {const mid=await canvasPoint(page,'ab','arrow-middle');await page.mouse.click(mid.x,mid.y);
  // The endpoint handle exists only once the arrow is selected; pressing earlier drags the whole arrow (a stray, unmodeled gesture on a loaded runner).
  await page.waitForFunction('window.__demo.api.getAppState().selectedElementIds.ab === true',{},{timeout:5000});const endpoint=await canvasPoint(page,'ab','arrow-end'),target=await canvasPoint(page,'c','left');await page.mouse.move(endpoint.x,endpoint.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:8});await page.mouse.up();await page.keyboard.press('Escape');}
 try{await page.waitForFunction(name=>{
 const gs=(window as unknown as {__demo:{recorder:{gestures:RecordedGesture[]}}}).__demo.recorder.gestures;
 return gs.some(g=>g.events.some(e=>name==='rename_step'?e.kind==='set'&&e.id==='a:text'&&e.field==='originalText'&&e.after==='Prepared':name==='move_step'?e.kind==='set'&&e.id==='a'&&e.field==='y':name==='delete_step'?e.kind==='set'&&e.id==='b'&&e.field==='isDeleted'&&e.after===true:name==='disconnect'?e.kind==='set'&&e.id==='bc'&&e.field==='isDeleted'&&e.after===true:name==='connect'?e.kind==='create'&&e.element.type==='arrow'&&e.element.attributes.start==='a'&&e.element.attributes.end==='c':e.kind==='set'&&e.id==='ab'&&e.field==='end'&&e.after==='c'));
 },name,{timeout:5000});}catch{throw new Error('Native '+name+' did not reach its expected completed recorded gesture.');}
}
const lit=(value:string|number|null)=>({kind:'literal' as const,value});
const field=(variable:string,name:string)=>({kind:'field' as const,variable,field:name});
const eq=(left:ReturnType<typeof field>,value:string|number|null):Predicate=>({op:'eq',left,right:lit(value)});
const objectGoal=(type:'step'|'arrow',id:string,condition:Predicate):Predicate=>({op:'exists',type,as:'o',where:{op:'all',args:[eq(field('o','id'),id),condition]}});
const title=(en:string,de:string)=>({en,de});
function task(id:string,goal:Predicate):Task{return {id,title:title(id,id),prompt:title('Perform the demonstrated change.','Führe die vorgeführte Änderung aus.'),goal:{op:'all',args:[{op:'exists',type:'frame',as:'frame',where:eq(field('frame','id'),'f')},goal]},hints:[title('Review the observation and its confirmed rule.','Prüfe die Beobachtung und ihre bestätigte Regel.')],errorClasses:[]};}
function taskData(name:ActionNameV1):{task:Task;action:Action;reference:State}{
 const reference=structuredClone(scene);let action:Action,goal:Predicate;
 switch(name){
 case 'rename_step':{action={name,params:{id:'a',label:'Prepared'}};if(reference.objects.a?.type==='step')reference.objects.a.label='Prepared';goal=objectGoal('step','a',eq(field('o','label'),'Prepared'));break;}
 case 'move_step':{action={name,params:{id:'a',x:300,y:305}};if(reference.objects.a?.type==='step')reference.objects.a.y=305;goal=objectGoal('step','a',eq(field('o','y'),305));break;}
 case 'delete_step':{action={name,params:{id:'b'}};reference.objects.b!.deleted=true;if(reference.objects.ab?.type==='arrow')reference.objects.ab.to=null;if(reference.objects.bc?.type==='arrow')reference.objects.bc.from=null;goal={op:'not',arg:{op:'exists',type:'step',as:'o',where:eq(field('o','id'),'b')}};break;}
 case 'disconnect':{action={name,params:{id:'bc'}};if(reference.objects.bc?.type==='arrow'){reference.objects.bc.deleted=true;reference.objects.bc.from=null;reference.objects.bc.to=null;}goal={op:'not',arg:{op:'exists',type:'arrow',as:'o',where:eq(field('o','id'),'bc')}};break;}
 case 'reconnect_end':{action={name,params:{id:'ab',end:'end',target:'c'}};if(reference.objects.ab?.type==='arrow')reference.objects.ab.to='c';goal=objectGoal('arrow','ab',eq(field('o','to'),'c'));break;}
 case 'connect':{action={name,params:{frameId:'f',from:'a',to:'c'}};reference.objects.extra={id:'extra',type:'arrow',deleted:false,frameId:'f',from:'a',to:'c'};goal={op:'eq',left:{kind:'count',type:'arrow',as:'o',where:{op:'true'}},right:lit(3)};break;}
 case 'add_step':{action={name,params:{frameId:'f',label:'Prepare',x:310,y:310,width:180,height:100,fontFamily:3}};reference.objects.extra={id:'extra',type:'step',deleted:false,frameId:'f',label:'Prepare',x:310,y:310,width:180,height:100,fontFamily:3};goal={op:'eq',left:{kind:'count',type:'step',as:'o',where:{op:'true'}},right:lit(4)};break;}
 }
 return {task:task('demo-'+name,goal),action,reference};
}
export async function runPhase3Demo(output=resolve('.local/phase3-demo-output'), recordingDirectory=join(output,'recordings')) {
 const begun=performance.now();await mkdir(output,{recursive:true});const browserFiles=join(output,'browser');await mkdir(browserFiles,{recursive:true});
 // This standalone legacy harness must finish native font measurement and center
 // bound labels before recording, just as the production engine/editor prepare
 // scenes. The diagnosed seed y=305 was moved to the measured center y=338 by
 // opening text edit alone; that real y-only event must never be filtered out.
 // Boundary wiring mirrors src/adapters/excalidraw/editor-browser.jsx: a pointerdown first closes a
 // pending terminal boundary, then marks the pointer as held so the 120 ms quiet timer cannot split a
 // drag that pauses on a loaded runner (issue #8). Without that call a pause mid-drag became an
 // extra, unmodeled gesture here although the production editor records one gesture.
 const bridge=`import React from'react';import{createRoot}from'react-dom/client';import{Excalidraw,restoreElements,CaptureUpdateAction}from'@excalidraw/excalidraw';import'@excalidraw/excalidraw/index.css';import{createGestureRecorder}from${JSON.stringify(resolve('src/adapters/excalidraw/recorder.ts'))};window.EXCALIDRAW_ASSET_PATH='/';const recorder=createGestureRecorder();window.__demo={api:null,recorder,trace:[],capture(stage){this.trace.push(JSON.parse(JSON.stringify({stage,at:performance.now(),elements:this.api.getSceneElementsIncludingDeleted(),appState:{width:this.api.getAppState().width,height:this.api.getAppState().height,activeTool:this.api.getAppState().activeTool,editingTextElement:this.api.getAppState().editingTextElement}})))},async start(raw){clearPendingBoundary();await document.fonts.load('20px Cascadia');await document.fonts.ready;const restored=restoreElements(raw,null,{repairBindings:true,refreshDimensions:true});const byId=new Map(restored.map(e=>[e.id,e]));for(const e of restored)if(e.type==='text'&&e.containerId){const box=byId.get(e.containerId);if(box){e.x=box.x+(box.width-e.width)/2;e.y=box.y+(box.height-e.height)/2;}}this.api.updateScene({elements:restored,captureUpdate:CaptureUpdateAction.NEVER,appState:{currentItemFontFamily:3,scrollX:0,scrollY:0}});const deadline=performance.now()+5000;await new Promise((resolve,reject)=>{const ready=()=>{const state=this.api.getAppState(),els=this.api.getSceneElementsIncludingDeleted(),byId=new Map(els.map(e=>[e.id,e]));const centered=els.filter(e=>e.type==='text'&&e.containerId&&!e.isDeleted).every(e=>{const box=byId.get(e.containerId);return box&&e.x===box.x+(box.width-e.width)/2&&e.y===box.y+(box.height-e.height)/2;});if(document.fonts.check('20px Cascadia')&&state.width===innerWidth&&state.height===innerHeight&&centered)resolve();else if(performance.now()>=deadline)reject(Error('Native prepared fonts, viewport or text centering unavailable'));else requestAnimationFrame(ready);};ready();});recorder.start(this.api.getSceneElementsIncludingDeleted(),document.fonts.check('20px Cascadia'));this.capture('recording-start')},finish(){clearPendingBoundary();if(recorder.active)recorder.observe(this.api.getSceneElementsIncludingDeleted());recorder.stop();return{initial:recorder.initial,gestures:recorder.gestures}}};for(const type of ['pointerdown','pointerup','dblclick','keydown','keyup','input'])document.addEventListener(type,event=>{window.__demo.capture(type+'-capture');queueMicrotask(()=>window.__demo.capture(type+'-microtask'));},true);let pendingBoundary,boundaryGeneration=0;function clearPendingBoundary(){pendingBoundary=undefined;boundaryGeneration++;}function flushPendingBoundary(){if(!pendingBoundary)return;const kind=pendingBoundary;clearPendingBoundary();if(recorder.active)recorder.observe(window.__demo.api.getSceneElementsIncludingDeleted());recorder.boundary(kind);}function terminalBoundary(kind){pendingBoundary=kind;const generation=++boundaryGeneration;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(generation===boundaryGeneration)flushPendingBoundary();}));}document.addEventListener('pointerdown',()=>{flushPendingBoundary();if(recorder.active)recorder.pointerDown();},true);document.addEventListener('keydown',flushPendingBoundary,true);document.addEventListener('pointerup',()=>terminalBoundary('pointerup'));document.addEventListener('keyup',()=>terminalBoundary('key'));createRoot(document.getElementById('root')).render(React.createElement(Excalidraw,{excalidrawAPI:api=>window.__demo.api=api,onChange:els=>recorder.observe(els),initialData:{appState:{currentItemFontFamily:3}},UIOptions:{canvasActions:{loadScene:false,saveToActiveFile:false}}}));`;
 await build({stdin:{contents:bridge,resolveDir:resolve('.'),sourcefile:'phase3-demo.jsx'},outdir:browserFiles,entryNames:'demo',bundle:true,splitting:true,format:'esm',conditions:['production'],minify:true,loader:{'.woff2':'file'},define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({headless:true}), recordings:Recording[]=[], attempts:Array<{action:ActionNameV1;repetition:number;gestures:number;unmodeled:number;templates:string[];error?:string;diagnostics?:unknown}>=[],confirmationFailures:Array<{hypothesis:string;error:string}>=[];
 const store=createRecordingStore(recordingDirectory);
 // A demo fixture store is isolated from the author's production .local/recordings.
 // Remove only this script's previous synthetic recordings before producing replacements.
 for(const manifest of await store.list())if(manifest.id.startsWith('demo-') && manifest.author==='Practonaut scripted UI demonstration' && manifest.consent==='Self-created CC0 scene with no personal content; local scripted demonstration')await store.delete(manifest.id);
 try{
  for(const name of names)for(let repetition=1;repetition<=2;repetition++){
   const context=await browser.newContext({viewport:{width:1600,height:1000},serviceWorkers:'block'}),denied:string[]=[];
   let page:Page|undefined,nativeBefore:unknown;
   await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='http://demo.invalid'||url.pathname.includes('..')){denied.push(url.href);await route.abort();return;}
    if(url.pathname==='/'){await route.fulfill({body:'<!doctype html><html><head><link rel="stylesheet" href="/demo.css"><style>@font-face{font-family:Cascadia;src:url(/fonts/Cascadia/CascadiaCode-Regular.woff2)}html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script type="module" src="/demo.js"></script></body></html>',contentType:'text/html'});return;}
    try{const base=url.pathname.startsWith('/fonts/')?resolve('.local/engine'):browserFiles;const bytes=await readFile(join(base,url.pathname.slice(1)));await route.fulfill({body:bytes,contentType:({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'} as Record<string,string>)[extname(url.pathname)]??'application/octet-stream'});}catch{denied.push(url.href);await route.abort();}});
   try{
    page=await context.newPage();await page.goto('http://demo.invalid');await page.waitForFunction('window.__demo?.api');await page.evaluate('window.__demo.start('+JSON.stringify(toRaw(scene))+')');
    const createdAt=new Date().toISOString();nativeBefore=await page.evaluate('window.__demo.api.getSceneElementsIncludingDeleted()');await gesture(page,name);const nativeAfter=await page.evaluate('window.__demo.api.getSceneElementsIncludingDeleted()');const recorded=await page.evaluate('window.__demo.finish()') as Pick<Recording,'initial'|'gestures'>;await writeFile(join(output,`${name}-${repetition}-native-input.json`),JSON.stringify({nativeBefore,nativeAfter,trace:await page.evaluate('window.__demo.trace')},null,2)+'\n');
    if(denied.length)throw new Error('Unexpected network attempts: '+denied.length);
    const recording=validateRecording({manifest:{schema:'practonaut.recording/1',id:`demo-${name}-${Date.now()}-${repetition}`,createdAt,stoppedAt:new Date().toISOString(),appVersion:'0.18.1',adapterVersion:'1.0.0',coalescingVersion:COALESCING_VERSION,author:'Practonaut scripted UI demonstration',license:'CC0-1.0',consent:'Self-created CC0 scene with no personal content; local scripted demonstration',demonstration:'scripted',status:recorded.gestures.some(g=>g.quarantined)?'quarantined':'review'},...recorded});
    const analysis=analyzeRecordings([recording]);const templates=analysis.hypotheses.filter(h=>h.status==='proposed').map(h=>h.id);
    const expected=RULE_TEMPLATES.find(t=>t.action===name)?.id;
    // An unmodeled gesture blocks every later confirmation; name what it changed so a failed run says why.
    const stray=recording.gestures.filter(g=>g.unmodeled.length).map(g=>({index:g.index,boundary:g.boundary,unmodeled:g.unmodeled,events:g.events,quarantineReasons:g.quarantineReasons}));
    const diagnostics=stray.length&&!(expected&&!templates.includes(expected))?{stray}:expected&&!templates.includes(expected)?{expectedTemplate:expected,gestures:recording.gestures.map(g=>({index:g.index,boundary:g.boundary,events:g.events,unmodeled:g.unmodeled,quarantineReasons:g.quarantineReasons,before:projectSnapshot(g.before),after:projectSnapshot(g.after)}))}:undefined;
    if(diagnostics)await writeFile(join(output,`${name}-${repetition}-diagnostics.json`),JSON.stringify({...diagnostics,nativeBefore,nativeAfter},null,2)+'\n');
    attempts.push({action:name,repetition,gestures:recording.gestures.length,unmodeled:recording.gestures.reduce((n,g)=>n+g.unmodeled.length,0),templates,...(diagnostics?{diagnostics}:{})});
    await page.screenshot({path:join(output,`${name}-${repetition}.png`)});await store.save(recording);recordings.push(recording);
   }catch(error){
    // Failure snapshots are retained separately and never admitted as successful
    // demonstrations. Diagnostic capture failure is explicit, not empty evidence.
    const diagnostics=page?await page.evaluate('({trace:window.__demo?.trace,nativeAfter:window.__demo?.api?.getSceneElementsIncludingDeleted(),partialGestures:window.__demo?.recorder.gestures})').catch(captureError=>({captureError:String(captureError)})):{captureError:'Native page was not created'};
    await writeFile(join(output,`${name}-${repetition}-native-error.json`),JSON.stringify({nativeBefore,error:error instanceof Error?error.message:String(error),diagnostics},null,2)+'\n');
    attempts.push({action:name,repetition,gestures:0,unmodeled:0,templates:[],error:error instanceof Error?error.message:String(error),diagnostics});
   }
   finally{await context.close();await writeFile(join(output,'attempts.json'),JSON.stringify(attempts,null,2)+'\n');}
  }
  const proposals=recordings.filter(r=>r.manifest.id.endsWith('-1'));let project=createAuthorProject(proposals);project.id='flow-diagram';project.version='0.1.0';project.recordingIds=recordings.map(r=>r.manifest.id);project.initialState=scene;
  for(const h of project.hypotheses){if(h.status!=='proposed')continue;const template=RULE_TEMPLATES.find(t=>t.id===h.template)!;
   const evidence=recordings.filter(r=>r.manifest.id.endsWith('-2')).flatMap(r=>r.gestures.map(g=>({recording:r,gesture:g}))).find(({gesture:g})=>{const before=projectSnapshot(g.before),after=projectSnapshot(g.after);return !g.quarantined&&!g.unmodeled.length&&before.ok&&after.ok&&template.matches(before.state,after.state);});
   if(evidence){try{project=confirmHypothesis(project,{hypothesisId:h.id,evidence:observationRef(evidence.recording,evidence.gesture.index)},recordings);}catch(error){confirmationFailures.push({hypothesis:h.id,error:error instanceof Error?error.message:String(error)});}}
  }
  const confirmed=project.hypotheses.filter(h=>h.status==='confirmed');if(!confirmed.length)throw new Error('No recorded template could be confirmed: '+JSON.stringify({attempts,confirmationFailures}));
  for(const name of names.filter(name=>!confirmed.some(h=>h.action===name)))project.questions.push({id:`q-scripted-${name}`,hypothesisIds:[],text:title(`No ${name} rule was confirmed from this UI observation.`,`Aus dieser UI-Beobachtung wurde keine Regel für ${name} bestätigt.`),demonstration:title('Repeat the operation and inspect every changed native field; retain any effect outside the executable vocabulary as an open question.','Wiederhole die Aktion und prüfe jedes veränderte native Feld; erhalte Effekte außerhalb des ausführbaren Vokabulars als offene Frage.'),status:'open',answeredBy:[]});
  project.variants=[{id:'plain',labels:{},insertPosition:1,layoutOffset:{x:0,y:0}},{id:'offset',labels:{},insertPosition:2,layoutOffset:{x:30,y:0}}];project.tasks=[];const fixtures:CheckerFixture[]=[];
  for(const h of confirmed){const data=taskData(h.action as ActionNameV1);project.tasks.push({task:data.task,solutions:{plain:[data.action],offset:[data.action]}});const alt=structuredClone(data.reference);if(alt.objects.c?.type==='step')alt.objects.c.x+=50;
   fixtures.push({taskId:data.task.id,kind:'reference',state:data.reference,expected:true},{taskId:data.task.id,kind:'alternative',state:alt,expected:true},{taskId:data.task.id,kind:'near-miss',state:scene,expected:false});}
  const rename=confirmed.some(h=>h.action==='rename_step');
  if(rename){const data=taskData('rename_step');data.task.id='heldout-name';data.task.goal=objectGoal('step','c',eq(field('o','label'),'Archived'));const hiddenAction:Action={name:'rename_step',params:{id:'c',label:'Archived'}};const ref=structuredClone(scene);if(ref.objects.c?.type==='step')ref.objects.c.label='Archived';const alt=structuredClone(ref);if(alt.objects.a?.type==='step')alt.objects.a.y+=30;
   project.heldOutTasks=[data.task];project.heldOutSolutions={'heldout-name':{plain:[hiddenAction],offset:[hiddenAction]}};fixtures.push({taskId:data.task.id,kind:'reference',state:ref,expected:true},{taskId:data.task.id,kind:'alternative',state:alt,expected:true},{taskId:data.task.id,kind:'near-miss',state:scene,expected:false});}
  project.checkerFixtures=fixtures;await writeFile(join(output,'project.author.json'),canonicalJson(project)+'\n');await writeFile(join(output,'confirmation-failures.json'),JSON.stringify(confirmationFailures,null,2)+'\n');const compiled=compileProject({project,recordings});const worldPackage=await readWorldPackage(compiled.worldBytes);await readCheckerBundle(compiled.checkerBytes);
  const worldFile=worldPackage.files.get('world.json');if(!worldFile)throw new Error('World file missing');const world=validateWorld(JSON.parse(worldFile.data.toString()));
  await writeFile(join(output,'flow-diagram.pnworld'),compiled.worldBytes);await writeFile(join(output,'flow-diagram.pncheck'),compiled.checkerBytes);await writeFile(join(output,'project.author.json'),canonicalJson(project)+'\n');
  const core=new Session(world,0,world.tasks[0]!.id);const taskEntry=project.tasks[0]!;for(const action of taskEntry.solutions[core.world.variants.cases[0]!.id]??taskEntry.solutions.plain!){const result=core.act(action);if(!result.ok)throw new Error(result.error.code);}
  const host=await startHost(world,{seed:0,taskId:world.tasks[0]!.id,tokenDirectory:join(output,'host'),localDirectory:output});
  let playerLoaded=false,hostedMirrorConfirmed=false,hostedResultPassed=false;
  try{const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto(host.url);await page.waitForSelector('[data-testid="board"]');playerLoaded=true;
    const headers={[TOKEN_HEADER]:host.token,'Content-Type':'application/json'};
    const observed=await fetch(host.origin+'/api/observe',{headers}).then(r=>r.json()) as {ok:boolean;value:{revision:number;variantId:string}};
    if(!observed.ok)throw new Error('Compiled host observation failed');let revision=observed.value.revision;
    for(const action of taskEntry.solutions[observed.value.variantId]!) {
      const reply=await fetch(host.origin+'/api/act',{method:'POST',headers,body:JSON.stringify({expectedRevision:revision,action})}).then(r=>r.json()) as {ok:boolean;value?:{mirrorConfirmed:boolean;view:{revision:number}};error?:{code:string}};
      if(!reply.ok||!reply.value?.mirrorConfirmed)throw new Error('Compiled mirrored action failed: '+reply.error?.code);
      revision=reply.value.view.revision;hostedMirrorConfirmed=true;
    }
    const checked=await fetch(host.origin+'/api/check',{method:'POST',headers,body:JSON.stringify({expectedRevision:revision})}).then(r=>r.json()) as {ok:boolean;value?:{passed:boolean;practiceEvidence:boolean}};
    if(!checked.ok||!checked.value?.passed||!checked.value.practiceEvidence)throw new Error('Compiled mirrored result check failed');hostedResultPassed=true;
    await page.waitForTimeout(100);await page.screenshot({path:join(output,'compiled-player.png')});await page.close();
  }finally{await host.close();}
  const report={schema:'practonaut.phase3-demo/1',demonstration:'scripted',createdAt:new Date().toISOString(),durationMs:Math.round(performance.now()-begun),attempts,confirmationFailures,confirmedRules:compiled.report.ruleIds,missingActions:names.filter(name=>!confirmed.some(h=>h.action===name)),...compiled.report,worldSha256:sha256Hex(compiled.worldBytes),checkerSha256:sha256Hex(compiled.checkerBytes),coreReplay:core.checkReplay().ok,playerLoaded,hostedMirrorConfirmed,hostedResultPassed,humanExpertDemonstration:'OPEN',humanCompetenceTransfer:'UNKNOWN'};
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
 }finally{await browser.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){runPhase3Demo().then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});}
