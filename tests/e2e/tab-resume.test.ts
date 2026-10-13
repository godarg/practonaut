import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startHost} from '../../src/host/server.ts';
import {validateWorld} from '../../src/world/schema.ts';
import {TOKEN_HEADER} from '../../src/host/protocol.ts';
import {TAB_SESSION_KEY} from '../../src/player/tab-session.ts';
import type {AuthorView} from '../../src/host/author-protocol.ts';
import type {HostReply} from '../../src/host/protocol.ts';
import type {Recording} from '../../src/adapters/excalidraw/recorder-types.ts';
import {replayGesture} from '../../src/adapters/excalidraw/recorder.ts';

test('same-tab reload resumes a saved author project while a fresh tab and isolated editor have no credential',{timeout:90_000},async()=>{
 const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-tab-resume-'));
 const world=validateWorld(JSON.parse(await readFile('examples/worlds/flow-diagram/world.json','utf8')));
 const host=await startHost(world,{phase3:true,taskId:'T3',seed:42,mirror:'required',localDirectory:directory,tokenDirectory:join(directory,'credentials')});
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({serviceWorkers:'block'}),allowed=new Set([host.origin]),external:string[]=[];
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(!allowed.has(u.origin)){external.push(u.origin+u.pathname);await route.abort();return;}if(['/api/bootstrap','/api/resume'].includes(u.pathname)){const response=await route.fetch(),reply=await response.json();if(reply.ok&&reply.value.engineOrigin)allowed.add(reply.value.engineOrigin);await route.fulfill({response});}else await route.continue();});
 try{
  const page=await context.newPage();await page.goto(host.url);await page.waitForFunction(key=>!!JSON.parse(sessionStorage.getItem(key)??'null')?.authorToken,TAB_SESSION_KEY);const authorCredential=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).authorToken as string,TAB_SESSION_KEY);assert.ok(authorCredential);await page.getByTestId('mode-author').click();
  await page.getByTestId('recovery-title').fill('Reloadable author exercise');await page.getByTestId('recovery-author').fill('Synthetic local test');await page.getByTestId('recovery-prepare').click();await page.getByTestId('recovery-start').waitFor();
  if(!await page.locator('[data-stage=build]').evaluate(e=>(e as HTMLDetailsElement).open))await page.locator('[data-stage=build]>summary').click();
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/author/save'));await page.getByTestId('recovery-save').click();assert.equal((await(await saved).json()).ok,true);
  await page.getByTestId('language-de').click();await page.getByTestId('theme-select').selectOption('dark');
  const before=await(await fetch(host.origin+'/api/author',{headers:{[TOKEN_HEADER]:authorCredential}})).json();assert.equal(before.ok,true);const projectId=before.value.project.id;
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key)!==null,TAB_SESSION_KEY),true);assert.equal(await page.evaluate(()=>localStorage.length),0);
  const resumed=page.waitForResponse(r=>r.url().endsWith('/api/resume'));await page.reload();assert.equal((await(await resumed).json()).ok,true);await page.getByTestId('recovery-start').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'),'de');assert.equal(await page.getByTestId('theme-select').inputValue(),'dark');assert.equal(await page.getByTestId('mode-author').getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByTestId('recovery-title').inputValue(),'Reloadable author exercise');
  const after=await(await fetch(host.origin+'/api/author',{headers:{[TOKEN_HEADER]:authorCredential}})).json();assert.equal(after.value.project.id,projectId);assert.equal(after.value.recording.active,false);
  const frame=await(await page.getByTestId('real-editor').elementHandle())!.contentFrame();assert.ok(frame);
  assert.equal(await frame.evaluate(key=>sessionStorage.getItem(key)===null,TAB_SESSION_KEY),true);
  assert.equal(await frame.evaluate(()=>{try{void parent.document;return false;}catch{return true;}}),true);
  assert.equal(await frame.evaluate(async({origin,credential})=>{try{await fetch(origin+'/api/resume',{headers:{'X-Practonaut-Token':credential}});return false;}catch{return true;}},{origin:host.origin,credential:host.token}),true);
  const fresh=await context.newPage();await fresh.goto(host.origin);await fresh.locator('.shell-message').waitFor();assert.equal(await fresh.getByTestId('board').count(),0);assert.equal(await fresh.evaluate(key=>sessionStorage.getItem(key),TAB_SESSION_KEY),null);
  await page.evaluate(key=>{const value=JSON.parse(sessionStorage.getItem(key)!);value.token='0'.repeat(64);sessionStorage.setItem(key,JSON.stringify(value));},TAB_SESSION_KEY);
  const invalid=page.waitForResponse(r=>r.url().endsWith('/api/resume'));await page.reload();assert.equal((await(await invalid).json()).error.code,'token_invalid');assert.equal(await page.getByTestId('board').count(),0);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),TAB_SESSION_KEY),null);
  assert.deepEqual(external,[]);
 }finally{await browser.close();await host.close();await rm(directory,{recursive:true,force:true});}
});

test('storage-blocked browser can use explicit bootstrap but cannot silently authorise a reload',{timeout:60_000},async()=>{
 const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-tab-denied-'));
 const world=validateWorld(JSON.parse(await readFile('examples/worlds/flow-diagram/world.json','utf8')));
 const host=await startHost(world,{taskId:'T3',mirror:'required',tokenDirectory:join(directory,'credentials')});const browser=await chromium.launch({headless:true});
 try{const context=await browser.newContext();await context.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('Storage blocked','SecurityError');}}));const page=await context.newPage();await page.goto(host.url);await page.getByTestId('board').waitFor();assert.match(await page.locator('body').innerText(),/blocks tab storage|blockiert den Tabspeicher/);await page.reload();await page.locator('.shell-message').waitFor();assert.equal(await page.getByTestId('board').count(),0);assert.match(await page.locator('.shell-message').innerText(),/[Ss]ession|Sitzung/);}finally{await browser.close();await host.close();await rm(directory,{recursive:true,force:true});}
});

test('reload during explicit native recording retains completed gestures and does not restart the new editor recorder',{timeout:90_000},async()=>{
 const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-tab-active-recording-'));
 const world=validateWorld(JSON.parse(await readFile('examples/worlds/flow-diagram/world.json','utf8')));
 const host=await startHost(world,{phase3:true,taskId:'T3',seed:42,mirror:'required',localDirectory:directory,tokenDirectory:join(directory,'credentials')});
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),allowed=new Set([host.origin]),external:string[]=[];
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(!allowed.has(u.origin)){external.push(u.origin+u.pathname);await route.abort();return;}if(['/api/bootstrap','/api/resume'].includes(u.pathname)){const response=await route.fetch(),reply=await response.json();if(reply.ok&&reply.value.engineOrigin)allowed.add(reply.value.engineOrigin);await route.fulfill({response});}else await route.continue();});
 let authorCredential='';
 const observe=async()=>{const reply=await(await fetch(host.origin+'/api/author',{headers:{[TOKEN_HEADER]:authorCredential}})).json() as HostReply<AuthorView>;assert.ok(reply.ok,JSON.stringify(reply));return reply.value;};
 try{
  const page=await context.newPage();let submittedGestures=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/record/gesture')submittedGestures++;});
  await page.goto(host.url);await page.waitForFunction(key=>!!JSON.parse(sessionStorage.getItem(key)??'null')?.authorToken,TAB_SESSION_KEY);authorCredential=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).authorToken as string,TAB_SESSION_KEY);assert.ok(authorCredential);await page.getByTestId('mode-author').click();await page.getByTestId('recovery-title').fill('Interrupted native demonstration');await page.getByTestId('recovery-author').fill('Synthetic reload probe');
  for(const[index,label]of ['Receive synthetic request','Review synthetic request','Send synthetic response'].entries())await page.getByTestId('recovery-label-'+index).fill(label);
  await page.getByTestId('recovery-prepare').click();await page.getByTestId('recovery-start').waitFor();
  await page.getByTestId('recovery-consent').check();await page.getByTestId('recovery-source').selectOption('scripted');const started=page.waitForResponse(r=>r.url().endsWith('/api/record/start'));await page.getByTestId('recovery-start').click();assert.equal((await(await started).json()).ok,true);assert.equal((await observe()).recording.active,true);
  const nativeDelete=async(label:string)=>{
   await page.getByTestId('real-editor').scrollIntoViewIfNeeded();const frame=await(await page.getByTestId('real-editor').elementHandle())!.contentFrame();assert.ok(frame);await frame.waitForFunction('window.__pnEditor');
   const point=await frame.evaluate(label=>{type Element={id:string;type:string;originalText?:string;containerId?:string;x:number;y:number;isDeleted:boolean};const editor=(window as unknown as {__pnEditor:{read():Element[];appState():{scrollX:number;scrollY:number;zoom:{value:number};offsetLeft:number;offsetTop:number}}}).__pnEditor,raw=editor.read(),text=raw.find(e=>e.type==='text'&&e.originalText===label&&!e.isDeleted);if(!text)throw Error('Visible native label missing');const step=raw.find(e=>e.id===text.containerId);if(!step)throw Error('Native label has no step');const s=editor.appState();return{id:step.id,x:(step.x+20+s.scrollX)*s.zoom.value+s.offsetLeft,y:(step.y+20+s.scrollY)*s.zoom.value+s.offsetTop};},label);
   const bounds=await page.getByTestId('real-editor').boundingBox();assert.ok(bounds);await page.mouse.click(bounds.x+point.x,bounds.y+point.y);await page.keyboard.press('Delete');await frame.waitForFunction(id=>(window as unknown as {__pnEditor:{read():Array<{id:string;isDeleted:boolean}>}}).__pnEditor.read().find(e=>e.id===id)?.isDeleted,point.id);return point.id;
  };
  const completed=page.waitForResponse(r=>r.url().endsWith('/api/record/gesture'));const removedStep=await nativeDelete('Review synthetic request');assert.equal((await(await completed).json()).ok,true);const before=await observe();assert.equal(before.recording.gestures,1);assert.equal(submittedGestures,1);
  const resumed=page.waitForResponse(r=>r.url().endsWith('/api/resume'));await page.reload();assert.equal((await(await resumed).json()).ok,true);
  const interrupted=page.getByText('Recording was on when the page reloaded. Completed changes are kept; only a change that was still unfinished at the reload can be missing. Stop and review this recording; recording does not restart on its own.',{exact:true});await interrupted.waitFor();assert.equal(await interrupted.isVisible(),true);assert.equal(await page.getByTestId('recovery-stop-visible').isEnabled(),true);assert.equal(await page.getByTestId('recovery-start').isEnabled(),false);
  const afterReload=await observe();assert.equal(afterReload.recording.active,true);assert.equal(afterReload.recording.gestures,1);assert.equal(afterReload.project!.id,before.project!.id);
  // This is a genuine native edit in the fresh iframe. Host recording remains
  // interrupted; stopping flushes any erroneous automatic recorder before our
  // final exact count assertion, so a mere timer delay cannot mask restart.
  await nativeDelete('Send synthetic response');const stopped=page.waitForResponse(r=>r.url().endsWith('/api/record/stop'));await page.getByTestId('recovery-stop-visible').click();const stopReply=await(await stopped).json();assert.equal(stopReply.ok,true,JSON.stringify(stopReply));
  const after=await observe();assert.equal(after.recording.active,false);assert.equal(after.recordings.length,1);assert.equal(submittedGestures,1,'new iframe must not submit an automatically started recording');
  const persisted=await(await fetch(host.origin+'/api/recording?id='+encodeURIComponent(after.recordings[0]!.id),{headers:{[TOKEN_HEADER]:authorCredential}})).json() as HostReply<Recording>;assert.ok(persisted.ok,JSON.stringify(persisted));assert.equal(persisted.value.gestures.length,1);const retained=persisted.value.gestures[0]!;assert.deepEqual(replayGesture(retained),retained.after);assert.equal(retained.after.elements[removedStep]!.attributes.isDeleted,true);assert.ok(retained.events.some(event=>event.kind==='set'&&event.id===removedStep&&event.field==='isDeleted'&&event.after===true));
  assert.equal(await page.locator('[data-stage=review]').evaluate(element=>(element as HTMLDetailsElement).open),true);await page.getByTestId('recovery-analyze').waitFor();assert.equal(await interrupted.count(),0);assert.deepEqual(external,[]);
 }finally{await browser.close();await host.close();await rm(directory,{recursive:true,force:true});}
});
