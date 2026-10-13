// SOURCE_ONLY proposal. NOT_RUN: no syntax/import/build/browser validation.
// Independent observable contract: real static module requests, real public
// Host/Player, genuine Retry click. Never a native import/save/C3 acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {chromium,type Browser,type Page,type Frame} from 'playwright-core';
import {startHost} from '../../../src/host/server.ts';
import {validateWorld} from '../../../src/world/schema.ts';
import {TOKEN_HEADER} from '../../../src/host/protocol.ts';
import {closeBrowser,bounded,BROWSER_BOUNDS} from '../../../src/adapters/excalidraw/bounded.ts';

const OUT=process.env.PN_INITIAL_EDITOR_DEADLINE_EVIDENCE;
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
// Observation grace is not a product deadline change: timer delivery is subject
// to the browser event loop. Reject measurements with excessive delivery lag.
const OBSERVE_MS=12_000,MAX_DELIVERY_LAG_MS=1500;
type Fault='hold'|'reject'|'late-ready'|'before-deadline'|'repeat-hold';
type Workspace='board'|'editor'|'author';
async function save(id:string,row:unknown){if(OUT){await mkdir(OUT,{recursive:true});await writeFile(join(OUT,id+'.raw.original.json'),JSON.stringify(row,null,2)+'\n',{flag:'wx',mode:0o600});}else console.log(JSON.stringify({scope:'OWNED_SYNTHETIC_INITIAL_BOOT_DIAGNOSTIC_NOT_ACCEPTANCE',id,row}));}
// Error objects are retained unchanged in memory. Evidence/stderr records use
// only diagnostic hashes, because navigation failures can contain private URLs.
type Failures={hasPrimary:boolean;primary?:unknown;secondary:unknown[]};
const failures=():Failures=>({hasPrimary:false,secondary:[]});
const diagnostic=(error:unknown)=>{let name='unknown',text='unreadable error diagnostic';try{name=error instanceof Error?error.name:typeof error;text=String(error);}catch{}return{name,diagnosticSHA256:sha(text)};};
function emitBinding(state:Failures,row:any,binding:unknown):void{
 try{console.error(JSON.stringify(binding));}catch(error){state.secondary.push(error);(row.stderrIO??(row.stderrIO=[])).push({phase:'synchronous-diagnostic-stderr',...diagnostic(error)});}
}
function retainPrimary(state:Failures,row:any,error:unknown,phase:string):void{
 if(state.hasPrimary)return;
 state.hasPrimary=true;state.primary=error;row.originalFailure={phase,...diagnostic(error)};
 // Synchronous primary binding precedes evidence, observation and cleanup I/O.
 emitBinding(state,row,{id:row.id,kind:'ORIGINAL_FAILURE_FIRST',...row.originalFailure});
}
async function secondary(state:Failures,row:any,phase:string,fn:()=>Promise<unknown>|unknown,kind='cleanup'):Promise<void>{
 const records=row[kind]??(row[kind]=[]),record:any={phase,status:'STARTED'};records.push(record);
 try{await fn();record.status='COMPLETE';}
 catch(error){state.secondary.push(error);record.status='ERROR';Object.assign(record,diagnostic(error));emitBinding(state,row,{id:row.id,kind:'SECONDARY_FAILURE',...record});}
}
async function finish(id:string,row:any,state:Failures,operations:Array<{phase:string;kind?:string;run:()=>Promise<unknown>|unknown}>):Promise<void>{
 for(const operation of operations)await secondary(state,row,operation.phase,operation.run,operation.kind);
 // The saved immutable row includes STARTED for this very write; completion is
// not retroactively inserted. If wx/I/O fails, prior stderr and Throwable remain.
 await secondary(state,row,'exclusive-evidence-save',()=>save(id,row),'evidenceIO');
 if(state.hasPrimary){if(state.secondary.length)throw new AggregateError([state.primary,...state.secondary],'Original initial-editor failure followed by secondary evidence/cleanup failures');throw state.primary;}
 if(state.secondary.length)throw new AggregateError(state.secondary,'Initial-editor secondary evidence/cleanup failures');
}
// Actual current-iframe Port events, never body.dataset alone. This is passive
// diagnostic observation; old callback replay does not emit these Port events.
async function recovered(page:Page,workspace:Workspace,configured:boolean):Promise<{frame:Frame;evidence:unknown}>{
 const started=performance.now();
 await page.waitForFunction(({workspace,configured})=>{
  const w=window as any,p=w.__initialProbe,iframe=document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]');
  if(!iframe||!p)return false;
  const callback=p.callbacks.filter((r:any)=>r.source===iframe.contentWindow).at(-1);if(!callback)return false;
  const messages=p.messages.filter((r:any)=>r.index===callback.index),ready=messages.find((r:any)=>r.type==='ready'&&r.fontsReady===true);
  const configureEnd=!configured||messages.some((r:any)=>r.type==='configured'&&r.fontsReady===true&&r.at>=ready?.at);
  const button=document.querySelector<HTMLButtonElement>('[data-testid=mode-editor]'),state=document.querySelector<HTMLElement>('[data-testid=engine-state]');
  return !!ready&&configureEnd&&button?.disabled===false&&iframe.parentElement?.getAttribute('aria-busy')==='false'&&iframe.parentElement?.inert===false&&state?.hidden===true&&document.body.dataset.workspace===workspace;
 },{workspace,configured},{timeout:OBSERVE_MS});
 const frame=await currentFrame(page),remaining=OBSERVE_MS-(performance.now()-started);assert(remaining>0,'recovery observation budget exhausted');
 await frame.waitForFunction(()=>{const w=window as any;return typeof w.__pnEditor?.read==='function'&&typeof w.__pnEditor?.appState==='function'&&document.getElementById('root')?.inert===false;},undefined,{timeout:remaining});
 const evidence=await page.evaluate(()=>{
  const p=(window as any).__initialProbe,iframe=document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]')!,callback=p.callbacks.filter((r:any)=>r.source===iframe.contentWindow).at(-1);
  return{kind:'ACTUAL_CURRENT_PORT_STRICT_READY_CONFIGURE_END',portIndex:callback.index,messages:p.messages.filter((r:any)=>r.index===callback.index),disabled:document.querySelector<HTMLButtonElement>('[data-testid=mode-editor]')!.disabled,ariaBusy:iframe.parentElement!.getAttribute('aria-busy'),workspace:document.body.dataset.workspace};
 });
 return{frame,evidence};
}

async function currentFrame(page:Page):Promise<Frame>{const handle=await page.getByTestId('real-editor').elementHandle();assert(handle);const frame=await handle.contentFrame();assert(frame);return frame;}

// Passive observers retain native handler/callback identity. Two clearly labelled
// negative controls below replay an old callback / old source MessageEvent. They
// are transport counterexamples, not genuine advertisements or user success.
async function observers(page:Page){await page.context().addInitScript(()=>{
 const w=window as any;w.__initialProbe={messages:[],ports:[],callbacks:[],closes:[],events:[],documents:[],frames:[],ui:[]};
 const p=w.__initialProbe,channel=MessageChannel,close=MessagePort.prototype.close;
 const descriptor=Object.getOwnPropertyDescriptor(MessagePort.prototype,'onmessage')!;
 const indices=new WeakMap<MessagePort,number>();
 w.MessageChannel=class extends channel{constructor(){super();const index=p.ports.length;indices.set(this.port1,index);p.ports.push({index,at:performance.now()});const accepted=this.port1;
  Object.defineProperty(accepted,'onmessage',{configurable:true,set(handler:any){p.callbacks.push({index,port:accepted,handler,source:document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]')?.contentWindow});descriptor.set!.call(accepted,handler);},get(){return descriptor.get!.call(accepted);}});
  accepted.addEventListener('message',event=>p.messages.push({index,type:event.data?.type,fontsReady:event.data?.fontsReady===true,knownFontFailure:event.data?.type==='error'&&event.data?.id===undefined&&event.data?.message==='Engine fonts are not ready',at:performance.now()}));
 }};
 MessagePort.prototype.close=function(){const index=indices.get(this);if(index!==undefined)p.closes.push({index,at:performance.now()});return close.call(this);};
 addEventListener('message',event=>{if(event.data?.type==='practonaut-engine-ready/1')p.messages.push({advertisement:true,sourceIsCurrent:event.source===document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]')?.contentWindow,origin:event.origin,at:performance.now()});});
 for(const type of ['keydown','keyup','paste','drop','copy','cut'])addEventListener(type,event=>p.events.push({event,type,at:performance.now()}),true);
 addEventListener('DOMContentLoaded',()=>{p.documents.push({timeOrigin:performance.timeOrigin,pathname:location.pathname,hasQuery:location.search!==''});});
  let lastFrame:HTMLIFrameElement|undefined,lastKind:string|undefined;
  new MutationObserver(()=>{const frame=document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]');if(frame&&frame!==lastFrame){lastFrame=frame;p.frames.push({frame,source:frame.contentWindow,src:frame.getAttribute('src'),at:performance.now()});}const state=document.querySelector<HTMLElement>('[data-testid=engine-state]'),kind=state?.dataset.kind;if(kind!==lastKind){lastKind=kind;p.ui.push({kind,at:performance.now(),hidden:state?.hidden});}}).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['src','data-kind','hidden']});
});}

async function open(language:'en'|'de',fault:Fault,workspace:Workspace,row:any,state:Failures){
 let directory:string|undefined;
 let host:Awaited<ReturnType<typeof startHost>>|undefined,browser:Browser|undefined;
 let moduleRelease:()=>void=()=>{},fontRelease:()=>void=()=>{};
 const timers=new Set<ReturnType<typeof setTimeout>>();Object.assign(row,{language,fault,workspace,requests:[],responses:[],faults:[]});
 let closing:Promise<void>|undefined;
 const close=()=>closing??=(async()=>{
  await secondary(state,row,'release-held-module-and-font',()=>{moduleRelease();fontRelease();for(const timer of timers)clearTimeout(timer);});
  if(browser)await secondary(state,row,'normal-close-browser',()=>closeBrowser(browser!));
  if(host)await secondary(state,row,'close-owned-host',()=>host!.close());
  if(directory)await secondary(state,row,'remove-owned-directory',()=>rm(directory!,{recursive:true,force:true}));
 })();
 try{
  directory=await mkdtemp(join(await realpath(tmpdir()),'pn-initial-editor-'));
  const worldBytes=await readFile('examples/worlds/flow-diagram/world.json');row.worldBinding={bytes:worldBytes.length,sha256:sha(worldBytes)};
  browser=await chromium.launch({headless:true,chromiumSandbox:true});row.browser=browser.version();
  host=await startHost(validateWorld(JSON.parse(worldBytes.toString('utf8'))),{phase3:true,taskId:'T3',seed:42,localDirectory:directory,tokenDirectory:join(directory,'credentials')});
  const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();await observers(page);
  // Locate the single actual Excalidraw dynamic module dependency from the
  // emitted editor entry bytes, not a guessed chunk name or replaced body.
  const editorBytes=await readFile(resolve('.local/engine/editor.js'));
  const candidates=[...editorBytes.toString('utf8').matchAll(/import\(["'](\.\/prod-[^"']+\.js)["']\)/g)].map(match=>match[1]!);
  assert.equal(candidates.length,1,'exactly one actual dynamic prod import must be measurable');
  const modulePath='/'+candidates[0]!.slice(2),moduleBytes=await readFile(join('.local/engine',modulePath.slice(1)));
  row.dynamicModule={entryBytes:editorBytes.length,entrySHA256:sha(editorBytes),pathname:modulePath,bytes:moduleBytes.length,sha256:sha(moduleBytes)};
  const allowed=new Set([host.origin]);let editorOrigin='',generation=0,faultEnabled=workspace==='board',firstFaultGeneration=1,moduleSeen=false;
  let heldModule=new Promise<void>(done=>{moduleRelease=done;}),heldFont=new Promise<void>(done=>{fontRelease=done;});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(!allowed.has(url.origin)){row.faults.push({type:'unexpected-origin',pathname:url.pathname});await route.abort();return;}
   if(url.origin===host!.origin&&url.pathname==='/api/bootstrap'){
    const response=await route.fetch(),data=await response.json();if(data.ok&&data.value.engineOrigin){editorOrigin=data.value.engineOrigin;allowed.add(editorOrigin);}await route.fulfill({response});return;
   }
   if(url.origin!==editorOrigin){await route.continue();return;}
   if(url.pathname==='/editor.html'&&request.isNavigationRequest()){generation++;row.requests.push({type:'document',generation,at:performance.now(),pathname:url.pathname,hasQuery:url.search!==''});}
   const thisGeneration=generation;row.requests.push({type:request.resourceType(),generation:thisGeneration,pathname:url.pathname,at:performance.now()});
   if(url.pathname===modulePath&&faultEnabled&&thisGeneration>=firstFaultGeneration){
    const relative=thisGeneration-firstFaultGeneration;
    if(relative===0||(fault==='repeat-hold'&&relative===1)){
     assert.equal(url.search,'');moduleSeen=true;row.faults.push({type:fault==='reject'?'module-rejected':'module-held',generation:thisGeneration,at:performance.now(),pathname:url.pathname});
     if(fault==='reject'){await route.abort('failed');return;}
     if(fault==='before-deadline'||fault==='late-ready'){const timer=setTimeout(moduleRelease,fault==='late-ready'?6000:500)/* late-ready: the ~2 MB module must evaluate and advertise before the 10 s deadline; 8.5 s left too little on this machine */;timers.add(timer);}
     await heldModule;row.faults.push({type:'module-released',generation:thisGeneration,at:performance.now()});
     // Fulfil exact previously bound module bytes. No rewritten JS, no metadata.
     await route.fulfill({status:200,contentType:'text/javascript',body:moduleBytes});return;
    }
   }
   if(faultEnabled&&fault==='late-ready'&&thisGeneration===firstFaultGeneration&&url.pathname.includes('/fonts/Excalifont/')){
    row.faults.push({type:'font-held-after-real-import',generation:thisGeneration,at:performance.now(),pathname:url.pathname});await heldFont;
   }
   await route.continue();
  });
  // SSE/API bodies are never drained. Only finite static response metadata.
  page.on('response',response=>{const u=new URL(response.url());if(u.origin===editorOrigin)row.responses.push({pathname:u.pathname,status:response.status(),at:performance.now()});});
  await page.goto(host.url,{waitUntil:'domcontentloaded'});await page.getByTestId('language-'+language).click();
  const observe=async()=>page.evaluate(async header=>{
   const session=JSON.parse(sessionStorage.getItem('practonaut.tab-session')!);
   const get=async(path:string,credential:string)=>{const reply=await (await fetch('/api/'+path,{headers:{[header]:credential}})).json();if(!reply.ok)throw Error(reply.error.code);return reply.value;};
   const w=window as any;if(!w.__initialCapabilities){const token=session.token,authorToken=session.authorToken;w.__initialCapabilities=()=>{const current=JSON.parse(sessionStorage.getItem('practonaut.tab-session')!);return current.token===token&&current.authorToken===authorToken;};}
   return{host:await get('observe',session.token),author:await get('author',session.authorToken),scene:await get('editor/scene',session.token),workspace:session.workspace,capabilitiesUnchanged:w.__initialCapabilities()};
  },TOKEN_HEADER);
  if(workspace!=='board'){
   await page.getByTestId('mode-'+workspace).waitFor({state:'visible',timeout:OBSERVE_MS});await page.waitForFunction(mode=>!document.querySelector<HTMLButtonElement>('[data-testid=mode-'+mode+']')!.disabled,workspace,{timeout:OBSERVE_MS});await page.getByTestId('mode-'+workspace).click();
   await page.waitForFunction(mode=>JSON.parse(sessionStorage.getItem('practonaut.tab-session')!).workspace===mode,workspace,{timeout:OBSERVE_MS});
   row.beforeReload=await observe();row.beforeReloadNative=await native(await currentFrame(page));row.capabilityComparisonScope='Same Parent document through iframe Retry; full Parent fixture reload is outside this boolean comparator';faultEnabled=true;firstFaultGeneration=generation+1;await page.reload({waitUntil:'domcontentloaded'});
  }
  const before=await observe();const frame=await currentFrame(page);
  return{page,frame,row,before,observe,close,editorOrigin,moduleSeen:()=>moduleSeen,generation:()=>generation,firstFaultGeneration:()=>firstFaultGeneration,release:()=>moduleRelease(),releaseFonts:()=>fontRelease(),disarm:()=>{faultEnabled=false;},newHeldModule:()=>{heldModule=new Promise<void>(done=>{moduleRelease=done;});},browser};
 }catch(error){retainPrimary(state,row,error,'partial-open');await close();throw error;}
}

async function ui(page:Page){return page.evaluate(()=>{const state=document.querySelector<HTMLElement>('[data-testid=engine-state]')!,frame=document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]')!,p=(window as any).__initialProbe;return{kind:state.dataset.kind,hidden:state.hidden,text:state.innerText,retryVisible:!!state.querySelector('[data-testid=engine-retry]'),editorDisabled:document.querySelector<HTMLButtonElement>('[data-testid=mode-editor]')!.disabled,workspace:document.body.dataset.workspace,sandbox:frame.getAttribute('sandbox'),src:frame.getAttribute('src'),nativeInert:frame.parentElement!.inert,ports:p.ports,messages:p.messages,closes:p.closes,frames:p.frames.map((item:any)=>({src:item.src,at:item.at})),states:p.ui};});}
async function native(frame:Frame){return frame.evaluate(()=>{const w=window as any;return{timeOrigin:performance.timeOrigin,pathname:location.pathname,hasQuery:location.search!=='',inert:document.getElementById('root')!.inert,apiPresent:!!w.__pnEditor,elements:w.__pnEditor?.read()??null,appState:w.__pnEditor?.appState()??null,events:w.__initialProbe.events.map((r:any)=>({type:r.type,key:r.event.key,trusted:r.event.isTrusted,defaultPrevented:r.event.defaultPrevented,target:r.event.target?.tagName})),faces:[...document.fonts].filter(face=>face.family==='Excalifont'||face.family==='Cascadia').map(face=>({family:face.family,status:face.status,unicodeRange:face.unicodeRange}))};});}
function preserved(actual:any,expected:any){assert.deepEqual(actual.host,expected.host);assert.deepEqual(actual.author,expected.author);assert.deepEqual(actual.scene,expected.scene);assert.equal(actual.workspace,expected.workspace);assert.equal(actual.capabilitiesUnchanged,true);}
function boundedFailure(row:any,failed:any){const docs=row.requests.filter((r:any)=>r.type==='document'),start=docs.at(-1)!.at,error=failed.states.filter((r:any)=>r.kind==='error').at(-1);assert(error,'observable error state required');
 // Node route times and browser performance clocks differ. Their values are raw
 // evidence only; use browser frame-insertion time for the delivery lag bound.
 const mount=failed.frames.at(-1);assert(mount);const elapsed=error.at-mount.at;row.deadlineObservation={elapsedFromFrameObservationMs:elapsed,nodeNavigationObservedAt:start,graceMs:MAX_DELIVERY_LAG_MS,clockLimit:'frame MutationObserver is after src assignment, not an exact timer-start oracle'};assert(elapsed>=9500&&elapsed<=10_000+MAX_DELIVERY_LAG_MS,'initial deadline delivery outside preregistered observation window');}

for(const language of ['en','de'] as const)for(const fault of ['hold','reject','late-ready','before-deadline','repeat-hold'] as const)test(`initial-editor ${language}-${fault}: real module boundary and genuine recovery`,{timeout:45_000,},async()=>{
 const id='initial-'+language+'-'+fault;let f:Awaited<ReturnType<typeof open>>|undefined;const row:any={id,status:'STARTED_NOT_ACCEPTANCE'},state=failures();
 try{
  f=await open(language,fault,'board',row,state);Object.assign(row,f.row);row.before=f.before;
  if(fault==='before-deadline'){
   await f.page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('[data-testid=mode-editor]')!.disabled,undefined,{timeout:OBSERVE_MS});row.ready=await ui(f.page);row.nativeReady=await native(f.frame);assert.equal(row.ready.kind,'loading');assert.equal(row.ready.hidden,true);assert.equal(row.ready.nativeInert,false);preserved(await f.observe(),f.before);
   // Wait for the original 10s bound without modifying product clocks/timers.
   await f.page.evaluate(()=>new Promise(done=>setTimeout(done,10_200)));row.afterOriginalDeadline=await ui(f.page);assert.equal(row.afterOriginalDeadline.editorDisabled,false);assert.equal(row.afterOriginalDeadline.hidden,true);return;
  }
  await f.page.waitForFunction(()=>document.querySelector<HTMLElement>('[data-testid=engine-state]')?.dataset.kind==='error',undefined,{timeout:OBSERVE_MS});row.failed=await ui(f.page);row.nativeFailed=await native(f.frame);row.failedState=await f.observe();assert(f.moduleSeen());
  assert.equal(row.failed.hidden,false);assert.equal(row.failed.retryVisible,true);assert.equal(row.failed.editorDisabled,true);assert.equal(row.failed.nativeInert,true);assert.equal(row.failed.sandbox,'allow-scripts allow-same-origin');boundedFailure(row,row.failed);
  assert(row.failed.text.includes(language==='en'?'The drawing surface did not open':'Zeichenfläche nicht geöffnet'));assert(row.failed.text.includes(language==='en'?'Your project is kept.':'Dein Projekt bleibt erhalten.'));preserved(row.failedState,f.before);
  if(fault==='hold'||fault==='reject')assert.equal(row.failed.ports.length,0,'original import boundary is before advertisement/Port');
  if(fault==='late-ready')assert(row.failed.ports.length>=1,'real accepted port must exist before late font readiness');
  if(fault==='late-ready'){
   // Measured (relaunch W2): fonts released after the Player's 10 s deadline do not make the timed-out
   // document ready, even after its own 8 s font bootstrap has run out (one face stays unloaded; cause not
   // isolated). fonts-ready.js lets only the bounded promise release input, so the document stays inert,
   // the Player stays failed and Retry below builds a fresh, working document. Waiting past the bootstrap
   // deadline keeps this from passing merely because the bootstrap has not finished yet.
   f.release();f.releaseFonts();await f.page.waitForTimeout(9_000);row.lateNative=await native(f.frame);row.afterLateFonts=await ui(f.page);
   assert.equal(row.lateNative.inert,true,'a late font load cannot reopen the timed-out document');assert.equal(row.afterLateFonts.kind,'error');assert.equal(row.afterLateFonts.editorDisabled,true);preserved(await f.observe(),f.before);
  }
  if(fault==='hold'){
   f.release();f.releaseFonts();await f.frame.waitForFunction(()=>!!(window as any).__pnEditor&&!document.getElementById('root')!.inert,undefined,{timeout:OBSERVE_MS});row.realLateNativeReady=await native(f.frame);row.afterRealLateReady=await ui(f.page);assert.equal(row.afterRealLateReady.kind,'error');assert.equal(row.afterRealLateReady.editorDisabled,true);assert.deepEqual(row.realLateNativeReady.elements,[]);preserved(await f.observe(),f.before);
  }
  await f.page.evaluate(()=>{const p=(window as any).__initialProbe;p.oldSource=document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]')!.contentWindow;p.oldCallbacks=p.callbacks.slice();});
  if(fault==='repeat-hold'){f.release();f.newHeldModule();}else f.disarm();
  const previousFrame=f.frame;await f.page.getByTestId('engine-retry').click();
  if(fault==='repeat-hold'){
   await f.page.waitForFunction(()=>document.querySelector<HTMLElement>('[data-testid=engine-state]')?.dataset.kind==='error',undefined,{timeout:OBSERVE_MS});row.secondFailure=await ui(f.page);assert.equal(f.generation(),2);preserved(await f.observe(),f.before);assert.equal(previousFrame.isDetached(),true);return;
  }
  await f.page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('[data-testid=mode-editor]')!.disabled,undefined,{timeout:OBSERVE_MS});const fresh=await currentFrame(f.page);row.after=await f.observe();row.afterUI=await ui(f.page);row.nativeAfter=await native(fresh);
  assert.equal(previousFrame.isDetached(),true);assert.equal(f.generation(),2);assert.equal(row.afterUI.hidden,true);assert.equal(row.afterUI.nativeInert,false);assert.equal(row.nativeAfter.pathname,'/editor.html');assert.equal(row.nativeAfter.hasQuery,false);assert.equal(row.nativeAfter.inert,false);assert.deepEqual(row.nativeAfter.elements,[]);preserved(row.after,f.before);
  const faces=row.nativeAfter.faces.filter((face:any)=>face.family==='Excalifont');assert.equal(faces.length,7);assert(faces.every((face:any)=>face.status==='loaded'));
  // Explicit non-user transport negative controls: exact observed old WindowProxy
  // and actual captured old callbacks, no Scene write/response success forcing.
  row.countercontrols=await f.page.evaluate(origin=>{const p=(window as any).__initialProbe,before=p.ports.length;
   dispatchEvent(new MessageEvent('message',{source:p.oldSource,origin,data:{type:'practonaut-engine-ready/1'}}));
   const afterOldSource=p.ports.length;
   for(const item of p.oldCallbacks){item.handler.call(item.port,new MessageEvent('message',{data:{type:'ready',fontsReady:true}}));item.handler.call(item.port,new MessageEvent('message',{data:{type:'error',message:'Engine fonts are not ready'}}));}
   dispatchEvent(new MessageEvent('message',{source:window,origin,data:{type:'practonaut-engine-ready/1'}}));
   dispatchEvent(new MessageEvent('message',{source:document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]')!.contentWindow,origin:'https://invalid.example',data:{type:'practonaut-engine-ready/1'}}));
   return{kind:'INJECTED_TRANSPORT_NEGATIVES_NOT_NATIVE_SUCCESS',before,afterOldSource,afterWrongSourceOrigin:p.ports.length,oldCallbacks:p.oldCallbacks.length};
  },f.editorOrigin);
  assert.equal(row.countercontrols.afterOldSource,row.countercontrols.before);assert.equal(row.countercontrols.afterWrongSourceOrigin,row.countercontrols.before);if(fault==='late-ready')assert(row.countercontrols.oldCallbacks>=1);row.afterCounterUI=await ui(f.page);assert.equal(row.afterCounterUI.hidden,true,'old terminal callback cannot fail the current successful document');assert.equal(row.afterCounterUI.editorDisabled,false);preserved(await f.observe(),f.before);assert.deepEqual((await native(fresh)).elements,row.nativeAfter.elements);
 }catch(error){row.status='ERROR_OR_ASSERTION';row.errorDiagnosticSHA256=diagnostic(error).diagnosticSHA256;retainPrimary(state,row,error,'test-body');}
 finally{await finish(id,row,state,f?[{phase:'final-ui-observation',kind:'evidenceIO',run:async()=>{row.finalUI=await ui(f!.page);}},{phase:'final-public-state-observation',kind:'evidenceIO',run:async()=>{row.finalState=await f!.observe();}},{phase:'bind-final-route-records',kind:'evidenceIO',run:()=>{row.finalFaults=f!.row.faults;row.finalRequests=f!.row.requests;}},{phase:'owned-resources',run:()=>f!.close()}]:[]);}
});

// A restored scene is rebuilt from the host's committed state, so Excalidraw draws fresh values for
// the attributes the adapter declares non-semantic (EXCLUDED_ATTRIBUTES: random seed/versionNonce,
// edit counter, timestamp, order key). Byte identity of those values was never a product promise.
const NON_SEMANTIC=['seed','versionNonce','version','updated','index'];
function semanticScene(elements:any[]):any[]{return (elements??[]).map(element=>Object.fromEntries(Object.entries(element).filter(([key])=>!NON_SEMANTIC.includes(key))));}
for(const workspace of ['editor','author'] as const)for(const language of ['en','de'] as const)test(`initial-editor restored-${workspace}-${language}: module reject keeps whole prior state`,{timeout:45_000},async()=>{
 const id='initial-restored-'+workspace+'-'+language,row:any={id,status:'NOT_ACCEPTANCE'},state=failures();let f:Awaited<ReturnType<typeof open>>|undefined;
 try{f=await open(language,'reject',workspace,row,state);Object.assign(row,f.row);row.before=f.before;await f.page.waitForFunction(()=>document.querySelector<HTMLElement>('[data-testid=engine-state]')?.dataset.kind==='error',undefined,{timeout:OBSERVE_MS});row.failed=await f.observe();preserved(row.failed,f.before);preserved(row.failed,row.beforeReload);assert.equal(row.failed.workspace,workspace);f.disarm();const previousFrame=f.frame;await f.page.getByTestId('engine-retry').click();const recovery=await recovered(f.page,workspace,true);row.recoveryReady=recovery.evidence;assert.equal(previousFrame.isDetached(),true);row.after=await f.observe();preserved(row.after,f.before);row.native=await native(recovery.frame);assert.deepEqual(semanticScene(row.native.elements),semanticScene(row.beforeReloadNative.elements),'previous native scene restored; only the adapter\'s declared non-semantic attributes may differ');row.geometryComparedSeparately={before:row.beforeReloadNative.appState,after:row.native.appState};}
 catch(error){row.errorDiagnosticSHA256=diagnostic(error).diagnosticSHA256;retainPrimary(state,row,error,'restored-test-body');}finally{await finish(id,row,state,f?[{phase:'bind-final-route-records',kind:'evidenceIO',run:()=>{row.finalRequests=f!.row.requests;}},{phase:'owned-resources',run:()=>f!.close()}]:[]);}
});

test('initial-editor isolated actual static entry: trusted early keys remain captured before real module resolution',{timeout:25_000},async()=>{
 const row:any={id:'initial-early-input',attribution:'Actual static Editor route/headers. Isolated child-entry input control, NOT actual Player mounting/Port/User acceptance.'},state=failures();let f:Awaited<ReturnType<typeof open>>|undefined,child:Page|undefined;
 try{
  f=await open('en','hold','board',row,state);Object.assign(row,{dynamicModule:f.row.dynamicModule});child=await f.page.context().newPage();let release:()=>void=()=>{};const held=new Promise<void>(done=>{release=done;});
  await child.route('**'+f.row.dynamicModule.pathname,async route=>{row.request={pathname:new URL(route.request().url()).pathname,at:performance.now()};await held;await route.continue();});
  // Original parent fragment points at real Host; this isolated top-level child
  // deliberately has no authorized parent Port, and no fabricated ready success.
  await child.goto(f.editorOrigin+'/editor.html#parent='+encodeURIComponent(new URL(f.page.url()).origin),{waitUntil:'commit'});
  await child.waitForFunction(()=>document.getElementById('root')?.inert===true,undefined,{timeout:5000});await child.mouse.click(120,120);await child.keyboard.press('t');await child.keyboard.type('EARLY_OWNED_TEXT');await child.keyboard.press('Tab');
  row.held=await child.evaluate(()=>{const p=(window as any).__initialProbe;return{inert:document.getElementById('root')!.inert,apiPresent:!!(window as any).__pnEditor,events:p.events.map((r:any)=>({type:r.type,key:r.event.key,trusted:r.event.isTrusted,defaultPrevented:r.event.defaultPrevented}))};});
  assert.equal(row.held.apiPresent,false);assert.equal(row.held.inert,true);assert(row.held.events.some((event:any)=>event.type==='keydown'&&event.key==='t'&&event.trusted));assert(row.held.events.filter((event:any)=>event.type==='keydown'&&event.key!=='Tab').every((event:any)=>event.defaultPrevented));assert(row.held.events.filter((event:any)=>event.key==='Tab').every((event:any)=>event.defaultPrevented===false));
  f.disarm();release();await child.waitForFunction(()=>!!(window as any).__pnEditor&&!document.getElementById('root')!.inert,undefined,{timeout:OBSERVE_MS});row.after=await child.evaluate(()=>(window as any).__pnEditor.read());assert.deepEqual(row.after,[],'early input cannot appear as a delayed native scene');
 }catch(error){row.errorDiagnosticSHA256=diagnostic(error).diagnosticSHA256;retainPrimary(state,row,error,'early-input-test-body');}finally{await finish(row.id,row,state,[...(child?[{phase:'close-owned-child-page',run:()=>bounded(child!.close(),BROWSER_BOUNDS.graceful)}]:[]),...(f?[{phase:'owned-resources',run:()=>f!.close()}]:[])]);}
});
