// SOURCE_ONLY PROPOSAL. Not imported, typechecked or run before Root authorizes a private candidate.
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {type Browser,type BrowserContext,type Page,type Frame} from 'playwright-core';
import {launchBrowser} from '../support/browser.ts';
import {startHost} from '../../src/host/server.ts';
import {validateWorld} from '../../src/world/schema.ts';
import {TOKEN_HEADER,type RunningHost,type HostReply,type HostView} from '../../src/host/protocol.ts';
import type {AuthorView} from '../../src/host/author-protocol.ts';
import {TAB_SESSION_KEY} from '../../src/player/tab-session.ts';
import {bounded,BROWSER_BOUNDS,closeBrowser} from '../../src/adapters/browser/bounded.ts';

type Language='en'|'de';
type CaseId='practice-author-enabled'|'author'|'practice-resume-only'|'cached-loss-without-parent-reload'|'active-author';
type PortEvent={type:string;fontsReady:boolean;knownFontError:boolean;at:number;timeOrigin:number};
type Probe={posts:PortEvent[];incoming:PortEvent[];clicks:{trusted:boolean;at:number}[];cacheGuardArmed?:boolean};
type NativeApi={read():Record<string,unknown>[];appState():Record<string,unknown>};
type FontDescriptor={family:string;style:string;weight:string;unicodeRange:string;status:string};
const CASES:readonly CaseId[]=['practice-author-enabled','author','practice-resume-only','cached-loss-without-parent-reload','active-author'];
const FONT='/fonts/Excalifont/Excalifont-Regular-623ccf21b21ef6b3a0d87738f77eb071.woff2';
const OBSERVE_MS=10_000,SETUP_MS=30_000,ARM_MS=60_000;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeError=(error:unknown)=>({name:error instanceof Error?error.name:'NonError',messageSHA256:digest(String(error))});
function passiveProbe():void{
 const own=window as Window&{__p1Retry?:Probe};
 const probe:Probe={posts:[],incoming:[],clicks:[]};own.__p1Retry=probe;
 const message=(value:unknown):PortEvent=>{const v=value as Record<string,unknown>|null;return{type:typeof v?.type==='string'&&['ready','error','retry-font-bootstrap','start'].includes(v.type)?v.type:'OTHER',fontsReady:v?.fontsReady===true,knownFontError:v?.type==='error'&&v.id===undefined&&v.message==='Engine fonts are not ready',at:performance.now(),timeOrigin:performance.timeOrigin};};
 const start=MessagePort.prototype.start,post=MessagePort.prototype.postMessage,seen=new WeakSet<MessagePort>();
 MessagePort.prototype.start=function(){if(!seen.has(this)){seen.add(this);this.addEventListener('message',event=>probe.incoming.push(message(event.data)));}return start.call(this);};
 MessagePort.prototype.postMessage=function(value:unknown,...rest:unknown[]){probe.posts.push(message(value));return Reflect.apply(post,this,[value,...rest]);};
 if(window===top)window.addEventListener('click',event=>{if(event.target instanceof Element&&event.target.closest('[data-testid=engine-retry]'))probe.clicks.push({trusted:event.isTrusted,at:performance.now()});},true);
}
// Only existing modeled content fields are compared across a real document restore.
// All complete raw elements and metadata differences are separately retained; no SceneIdentity PASS.
function modeledContent(elements:Record<string,unknown>[]):unknown[]{return elements.map(e=>[e.id,e.type,e.isDeleted,e.frameId,e.seed,e.x,e.y,e.width,e.height,e.containerId,e.originalText??e.text,e.fontFamily,e.name,e.startBinding,e.endBinding]);}
async function runCase(t:TestContext,language:Language,id:CaseId):Promise<void>{
 const started=performance.now(),deadline=started+ARM_MS;
 const evidence=await mkdtemp(join(await realpath(tmpdir()),'pn-p1-regression-evidence-'));
 const raw:Record<string,unknown>={language,id,state:'NOTREACHED',productFontMs:8000,productRetryMs:10000,ownArmMs:ARM_MS,psHeaderInventory:true,ownAcceptance:false,sceneIdentity:false};
 let directory:string|undefined,host:RunningHost|undefined,browser:Browser|undefined,context:BrowserContext|undefined,page:Page|undefined,closing=false,faulting=false,engineOrigin='',firstFailure:unknown;
 const constructors=new Set<Promise<unknown>>();
 const authorRequests:{method:string;at:number}[]=[],recordRequests:{pathname:string;method:string;at:number}[]=[],documents:{generation:number;queryAbsent:boolean;at:number}[]=[],faults:{generation:number;at:number}[]=[],external:boolean[]=[];
 const remaining=(bound:number)=>Math.max(1,Math.min(bound,deadline-performance.now()));
 async function stage<T>(promise:Promise<T>):Promise<T>{let abort:(()=>void)|undefined;try{if(t.signal.aborted)throw new Error('OWN_TEST_ABORTED');return await Promise.race([promise,new Promise<never>((_,reject)=>{abort=()=>reject(new Error('OWN_TEST_ABORTED'));t.signal.addEventListener('abort',abort,{once:true});})]);}finally{if(abort)t.signal.removeEventListener('abort',abort);}}
 async function wx(name:string,value:unknown):Promise<void>{await writeFile(join(evidence,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
 async function frame():Promise<Frame>{const handle=await stage(page!.getByTestId('real-editor').elementHandle());assert.ok(handle);const actual=await stage(handle.contentFrame());assert.ok(actual);return actual;}
 async function hostView():Promise<HostView>{const response=await fetch(host!.origin+'/api/observe',{headers:{[TOKEN_HEADER]:host!.token},signal:AbortSignal.any([t.signal,AbortSignal.timeout(OBSERVE_MS)]),cache:'no-store'});const reply=await response.json() as HostReply<HostView>;assert.equal(response.status,200);assert.ok(reply.ok);return reply.value;}
 async function snapshot():Promise<{host:HostView;native:{timeOrigin:number;elements:Record<string,unknown>[];appState:Record<string,unknown>|null;inert:boolean|null;fonts:FontDescriptor[];cascadia:boolean};ui:{workspace:string|null;probe:Probe;authorPresent:boolean;practicePresent:boolean;sessionMatches:boolean;cardText:string|null;kind:string|null}}>{
  const view=await hostView(),child=await frame();
  const native=await stage(child.evaluate(()=>{const own=window as Window&{__pnEditor?:NativeApi};return{timeOrigin:performance.timeOrigin,elements:own.__pnEditor?.read()??[],appState:own.__pnEditor?.appState()??null,inert:document.getElementById('root')?.inert??null,fonts:[...document.fonts].filter(f=>f.family==='Excalifont'||f.family==='Cascadia').map(f=>({family:f.family,style:f.style,weight:f.weight,unicodeRange:f.unicodeRange,status:f.status})),cascadia:document.fonts.check('20px Cascadia')};}));
  const ui=await stage(page!.evaluate(({key,session})=>{const own=window as Window&{__p1Retry?:Probe},cache=JSON.parse(sessionStorage.getItem(key)||'null') as Record<string,unknown>|null;return{workspace:document.body.dataset.workspace??null,probe:own.__p1Retry!,authorPresent:!!cache&&Object.hasOwn(cache,'authorToken'),practicePresent:typeof cache?.token==='string',sessionMatches:cache?.sessionId===session,cardText:document.querySelector<HTMLElement>('[data-testid=engine-state]')?.innerText??null,kind:document.querySelector<HTMLElement>('[data-testid=engine-state]')?.dataset.kind??null};},{key:TAB_SESSION_KEY,session:view.sessionId}));
  return{host:view,native,ui};
 }
 async function authorView():Promise<AuthorView>{return await stage(page!.evaluate(async key=>{const held=JSON.parse(sessionStorage.getItem(key)!) as {authorToken:string};if(!held.authorToken)throw new Error('ACTUAL_AUTHOR_CAPABILITY_MISSING');const response=await fetch('/api/author',{headers:{'X-Practonaut-Token':held.authorToken},cache:'no-store'});const reply=await response.json() as HostReply<AuthorView>;if(response.status!==200||!reply.ok)throw new Error('ACTUAL_AUTHOR_OBSERVE_FAILED');return reply.value;},TAB_SESSION_KEY));}
 try{
  directory=await mkdtemp(join(await realpath(tmpdir()),'pn-p1-regression-runtime-'));
  const world=validateWorld(JSON.parse(await readFile('examples/worlds/flow-diagram/world.json','utf8')));
  const hostCreation=startHost(world,{phase3:true,mirror:'required',taskId:'T3',seed:42,localDirectory:directory,tokenDirectory:join(directory,'credentials')}).then(async value=>{host=value;if(closing)await value.close();return value;});constructors.add(hostCreation);void hostCreation.finally(()=>constructors.delete(hostCreation)).catch(()=>{});await stage(hostCreation);
  const browserCreation=launchBrowser({headless:true,timeout:BROWSER_BOUNDS.launch,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false}).then(async value=>{browser=value;if(closing)await closeBrowser(value);return value;});constructors.add(browserCreation);void browserCreation.finally(()=>constructors.delete(browserCreation)).catch(()=>{});await stage(browserCreation);
  context=await stage(browser!.newContext({viewport:{width:1280,height:900},colorScheme:'light',reducedMotion:'reduce',serviceWorkers:'block'}));await stage(context.addInitScript(passiveProbe));page=await stage(context.newPage());
  const allowed=new Set([host!.origin]);
  page.on('request',request=>{const u=new URL(request.url());if(u.origin===host!.origin&&u.pathname==='/api/author')authorRequests.push({method:request.method(),at:performance.now()});if(u.origin===host!.origin&&u.pathname.startsWith('/api/record/'))recordRequests.push({pathname:u.pathname,method:request.method(),at:performance.now()});});
  await stage(context.route('**/*',async route=>{const request=route.request(),u=new URL(request.url());if(!allowed.has(u.origin)){external.push(true);await route.abort('blockedbyclient');return;}
   if(u.origin===host!.origin&&(u.pathname==='/api/bootstrap'||u.pathname==='/api/resume')){const response=await route.fetch({timeout:OBSERVE_MS}),reply=await response.json() as {ok:boolean;value?:{engineOrigin?:string;authorEnabled?:boolean;view?:HostView}};if(reply.ok&&reply.value?.engineOrigin){const candidate=new URL(reply.value.engineOrigin);assert.equal(candidate.protocol,'http:');assert.equal(candidate.hostname,'127.0.0.1');assert.equal(candidate.search+candidate.hash,'');engineOrigin=candidate.origin;allowed.add(engineOrigin);}if(u.pathname==='/api/resume')raw.resumePublicProjection={ok:reply.ok,status:response.status(),authorEnabled:reply.value?.authorEnabled,view:reply.value?.view,engineOriginPresent:!!reply.value?.engineOrigin};await route.fulfill({response});return;}
   if(u.origin===engineOrigin&&u.pathname==='/editor.html'&&request.isNavigationRequest())documents.push({generation:documents.length+1,queryAbsent:u.search==='',at:performance.now()});
   if(faulting&&u.origin===engineOrigin&&u.pathname===FONT){faults.push({generation:documents.length,at:performance.now()});await route.abort('failed');return;}await route.continue();
  }));
  await stage(page.goto(host!.url,{waitUntil:'domcontentloaded',timeout:SETUP_MS}));await stage(page.getByTestId('board').waitFor({timeout:SETUP_MS}));await stage(page.waitForFunction(()=>{const button=document.querySelector<HTMLButtonElement>('[data-testid=mode-author]');return !!button&&!button.disabled;},undefined,{timeout:SETUP_MS}));
  await stage(page.getByTestId('language-'+language).click({timeout:OBSERVE_MS}));await stage(page.waitForFunction(lang=>document.documentElement.lang===lang,language,{timeout:OBSERVE_MS}));
  if(id==='author'||id==='active-author'){
   await stage(page.getByTestId('mode-author').click({timeout:OBSERVE_MS}));await stage(page.waitForFunction(()=>document.body.dataset.workspace==='author',undefined,{timeout:OBSERVE_MS}));
   await stage(page.getByTestId('recovery-title').fill(language==='en'?'P1 retry source control':'P1 Retry Quellenkontrolle'));await stage(page.getByTestId('recovery-author').fill('Local regression fixture'));await stage(page.getByTestId('recovery-prepare').click({timeout:OBSERVE_MS}));
   await stage(page.waitForFunction(()=>{const start=document.querySelector<HTMLButtonElement>('[data-testid=recovery-start]');return !!start&&!start.disabled;},undefined,{timeout:OBSERVE_MS}));
   if(id==='active-author'){await stage(page.getByTestId('recovery-consent').check({timeout:OBSERVE_MS}));await stage(page.getByTestId('recovery-source').selectOption('scripted',{timeout:OBSERVE_MS}));const recordingStarted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/record/start',{timeout:OBSERVE_MS});await stage(page.getByTestId('recovery-start').click({timeout:OBSERVE_MS}));assert.equal((await stage(recordingStarted)).status(),200);assert.equal((await authorView()).recording.active,true);}
  }
  const initial=await snapshot();raw.initial=initial;assert.equal(initial.host.seed,42);assert.equal(initial.host.task.id,'T3');assert.equal(initial.ui.authorPresent,true);assert.equal(initial.ui.practicePresent,true);
  if(id==='practice-resume-only'||id==='cached-loss-without-parent-reload'){
   raw.cacheLoss=await stage(page.evaluate(key=>{const original=JSON.parse(sessionStorage.getItem(key)!) as Record<string,unknown>;if(typeof original.authorToken!=='string'||typeof original.token!=='string'||original.authorToken===original.token)throw new Error('CACHE_LOSS_PRECONDITION');const expected={...original};delete expected.authorToken;sessionStorage.setItem(key,JSON.stringify(expected));const actual=JSON.parse(sessionStorage.getItem(key)!) as Record<string,unknown>;return{onlyAuthorDeleted:JSON.stringify(actual)===JSON.stringify(expected),retainedFieldsExact:Object.keys(expected).every(k=>JSON.stringify(actual[k])===JSON.stringify(original[k])),practiceCredentialInlineExact:actual.token===original.token,workspaceInlineExact:actual.workspace===original.workspace};},TAB_SESSION_KEY));assert.ok(Object.values(raw.cacheLoss as Record<string,boolean>).every(Boolean));
  }
  faulting=true;
  if(id==='practice-resume-only'){await stage(page.reload({waitUntil:'domcontentloaded',timeout:SETUP_MS}));await stage(page.getByTestId('board').waitFor({timeout:OBSERVE_MS}));}
  else{const child=await frame();await stage(child.evaluate(origin=>{if(location.pathname!=='/editor.html'||location.search!=='')throw new Error('OWN_EDITOR_ROUTE_MISMATCH');history.replaceState(null,'',location.pathname+'#parent='+encodeURIComponent(origin));location.reload();},host!.origin));}
  await stage(page.waitForFunction(()=>document.querySelector<HTMLElement>('[data-testid=engine-state]')?.dataset.kind==='error',undefined,{timeout:OBSERVE_MS}));
  const before=await snapshot();raw.beforeRetry=before;assert.ok(faults.length>0);assert.equal(documents.length,2);assert.ok(documents.every(d=>d.queryAbsent));assert.notEqual(before.native.timeOrigin,initial.native.timeOrigin);assert.ok(before.ui.probe.incoming.some(event=>event.knownFontError));assert.equal(before.native.inert,true);assert.match(before.ui.cardText??'',language==='en'?/Your project is kept\./:/Dein Projekt bleibt erhalten\./);
  assert.deepEqual(before.host,initial.host);assert.equal(before.ui.authorPresent,id!=='practice-resume-only'&&id!=='cached-loss-without-parent-reload');
  const originalAuthor=id==='author'||id==='active-author'?await authorView():undefined;raw.authorBefore=originalAuthor;
  faulting=false;const requestStart=authorRequests.length,documentStart=documents.length,recordStart=recordRequests.length;
  // Lexical-only cache comparison: retained credential values never leave this Browser evaluation.
  const cacheComparison=page.evaluate(({key,block})=>{const own=window as Window&{__p1Retry?:Probe},before=sessionStorage.getItem(key);own.__p1Retry!.cacheGuardArmed=true;return new Promise<{exact:boolean}>((resolve,reject)=>{const deadline=setTimeout(()=>{clearInterval(check);reject(new Error('CACHE_OBSERVER_NOTREACHED'));},10000);const check=setInterval(()=>{const p=own.__p1Retry!,click=p.clicks.at(-1);if(!click)return;const ready=p.incoming.some(m=>m.type==='ready'&&m.fontsReady&&m.at>=click.at);const failed=block&&document.querySelector<HTMLElement>('[data-testid=phase3-status]')?.innerText.includes(document.documentElement.lang==='de'?'Stoppe zuerst':'Stop recording');if(ready||failed){clearInterval(check);clearTimeout(deadline);resolve({exact:sessionStorage.getItem(key)===before});}},20);});},{key:TAB_SESSION_KEY,block:id==='active-author'});
  void cacheComparison.catch(()=>{});await stage(page.waitForFunction(()=>(window as Window&{__p1Retry?:Probe}).__p1Retry?.cacheGuardArmed===true,undefined,{timeout:OBSERVE_MS}));
  await stage(page.getByTestId('engine-retry').click({timeout:OBSERVE_MS}));
  if(id==='active-author')await stage(page.getByTestId('phase3-status').filter({hasText:language==='en'?'Stop recording before switching.':'Stoppe zuerst die Aufnahme.'}).waitFor({timeout:OBSERVE_MS}));
  else await stage(page.waitForFunction(()=>{const probe=(window as Window&{__p1Retry?:Probe}).__p1Retry!,click=probe.clicks.at(-1);return !!click&&probe.incoming.some(m=>m.type==='ready'&&m.fontsReady&&m.at>=click.at);},undefined,{timeout:OBSERVE_MS}));
  // Freeze actual Parent-author counts before a fixture's own after-Author observation.
  const actualAuthorDuringRetry=authorRequests.slice(requestStart);raw.authorDuringRetry=actualAuthorDuringRetry;
  const after=await snapshot();raw.afterRetry=after;raw.cacheComparison=await stage(cacheComparison);raw.documents=documents;raw.fontFaults=faults;raw.authorRequests=authorRequests;raw.recordRequests=recordRequests;raw.external=external;raw.recorderActivePractice='UNOBSERVED';
  assert.deepEqual(after.host,before.host);assert.equal(after.ui.sessionMatches,true);assert.equal((raw.cacheComparison as {exact:boolean}).exact,true);assert.equal(after.ui.workspace,before.ui.workspace);assert.equal(after.ui.authorPresent,before.ui.authorPresent);assert.equal(after.ui.practicePresent,true);assert.equal(external.length,0);assert.equal(recordRequests.length,recordStart);assert.equal(after.ui.probe.posts.filter(m=>m.type==='start').length,before.ui.probe.posts.filter(m=>m.type==='start').length);assert.equal(after.ui.probe.clicks.length,1);assert.equal(after.ui.probe.clicks[0]!.trusted,true);
  if(id==='practice-resume-only'){assert.equal(actualAuthorDuringRetry.length,0);assert.equal((raw.resumePublicProjection as {authorEnabled:boolean}).authorEnabled,false);}else assert.ok(actualAuthorDuringRetry.some(r=>r.method==='GET'),'author-enabled Parent retains real Author precheck even with cache-only credential loss');
  if(id==='active-author'){assert.equal(documents.length,documentStart);assert.equal(after.native.timeOrigin,before.native.timeOrigin);assert.equal(after.ui.probe.posts.filter(m=>m.type==='retry-font-bootstrap').length,0);assert.deepEqual(after.native.elements,before.native.elements);assert.equal(after.native.inert,true);const actualAuthorAfter=await authorView();raw.authorAfter=actualAuthorAfter;assert.deepEqual(actualAuthorAfter,originalAuthor);assert.equal(actualAuthorAfter.recording.active,true);raw.state='MEASURED_ACTIVE_RECORDING_BLOCKED_CONTROL';}
  else{
   assert.equal(documents.length,documentStart+1);assert.notEqual(after.native.timeOrigin,before.native.timeOrigin);assert.equal(after.ui.probe.posts.filter(m=>m.type==='retry-font-bootstrap').length,1);assert.equal(after.native.inert,false);const faces=after.native.fonts.filter(f=>f.family==='Excalifont');assert.equal(faces.length,7);assert.ok(faces.every(f=>f.status==='loaded'&&f.weight==='400'&&f.style==='normal'));assert.equal(after.native.cascadia,true);
   if(id==='author'){await stage(page.waitForFunction(()=>document.querySelector<HTMLElement>('.native-editor-scroll')?.getAttribute('aria-busy')==='false',undefined,{timeout:OBSERVE_MS}));const restored=await snapshot();raw.afterExistingConfigure=restored;assert.deepEqual(modeledContent(restored.native.elements),modeledContent(initial.native.elements));raw.fullRawNativeMetadataKept=true;const actualAuthorAfter=await authorView();raw.authorAfter=actualAuthorAfter;assert.deepEqual(actualAuthorAfter,originalAuthor);assert.equal(actualAuthorAfter.recording.active,false);}else assert.deepEqual(after.native.elements,before.native.elements);
   raw.state='MEASURED_CONTEXTUAL_RETRY_RECOVERY';
  }
  await writeFile(join(evidence,'after-retry.original.png'),await stage(page.screenshot({fullPage:true,timeout:OBSERVE_MS})),{flag:'wx',mode:0o600});
 }catch(error){firstFailure=error;raw.firstFailure=safeError(error);try{await wx('first-failure.original.json',raw);}catch(ioError){raw.firstFailureRecordGap=safeError(ioError);}}
 finally{
  closing=true;faulting=false;const cleanupErrors:unknown[]=[];
  try{await bounded(Promise.allSettled([...constructors]),remaining(BROWSER_BOUNDS.launch));}catch(error){cleanupErrors.push(safeError(error));}
  try{if(context)await bounded(context.close(),remaining(BROWSER_BOUNDS.graceful));}catch(error){cleanupErrors.push(safeError(error));}
  try{if(browser)await bounded(closeBrowser(browser),remaining(BROWSER_BOUNDS.graceful+BROWSER_BOUNDS.forced));}catch(error){cleanupErrors.push(safeError(error));}
  try{if(host)await bounded(host.close(),remaining(12_000));}catch(error){cleanupErrors.push(safeError(error));}
  if(directory&&cleanupErrors.length===0)try{await rm(directory,{recursive:true,force:true});}catch(error){cleanupErrors.push(safeError(error));}
  raw.cleanupErrors=cleanupErrors;raw.elapsedMs=performance.now()-started;
  try{await wx('case-result.original.json',raw);}catch(error){raw.finalRecordGap=safeError(error);try{process.stderr.write(JSON.stringify({language,id,firstFailure:raw.firstFailure??null,secondaryEvidenceError:raw.finalRecordGap,resourceFailure:true})+'\n');}catch{}firstFailure??=error;}
  t.diagnostic('Own P1 evidence directory: '+evidence);
  if(cleanupErrors.length)firstFailure??=new Error('OWN_RESOURCE_CLEANUP_NOT_CONFIRMED');
  if(performance.now()>deadline)firstFailure??=new Error('OWN_60S_END_TO_END_BOUND_EXCEEDED');
 }
 if(firstFailure)throw firstFailure;
}
for(const language of ['en','de'] as const)for(const id of CASES)test(`P1 contextual genuine font retry: ${language}/${id}`,{timeout:ARM_MS},async t=>{await runCase(t,language,id);});
