import {TAB_SESSION_KEY} from '../../src/player/tab-session.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, type Frame, type Page } from 'playwright';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { startHost } from '../../src/host/server.ts';
import { validateWorld } from '../../src/world/schema.ts';
import { Session } from '../../src/core/session.ts';
import type { HostView, HostReply } from '../../src/host/protocol.ts';
import type { Recording } from '../../src/adapters/excalidraw/recorder-types.ts';
import type { AuthorView } from '../../src/host/author-protocol.ts';
import { TOKEN_HEADER } from '../../src/host/protocol.ts';
async function heldAuthorCredential(page:Page):Promise<string>{
 const held:unknown=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).authorToken,TAB_SESSION_KEY);
 assert.equal(typeof held==='string'&&/^[a-f0-9]{64}$/.test(held),true,'author fixture must use the actual held bootstrap capability');return held as string;
}
async function setup(width=1280,theme:'light'|'dark'='light',localeDelay=0) {
 const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-phase3-'));
 const world=validateWorld(JSON.parse(readFileSync('examples/worlds/flow-diagram/world.json','utf8')));
 const host=await startHost(world,{phase3:true,requireOffline:process.env.PN_REQUIRE_OFFLINE==='1',taskId:'T3',seed:42,localDirectory:directory,tokenDirectory:join(directory,'credentials')});
 const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width,height:1000},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'});
 const external:string[]=[],allowed=new Set([host.origin]);const page=await context.newPage();
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(!allowed.has(url.origin)){external.push(url.href);await route.abort();return;}
  if(url.pathname==='/api/bootstrap'){const response=await route.fetch();const reply=await response.json();if(reply.ok && reply.value.engineOrigin)allowed.add(reply.value.engineOrigin);await route.fulfill({response});return;}if(localeDelay<0&&/\/de-DE-/.test(url.pathname)){await route.abort();return;}if(localeDelay>0&&/\/de-DE-/.test(url.pathname))await new Promise(resolve=>setTimeout(resolve,localeDelay));await route.continue();
 });
 await page.goto(host.url);await page.getByTestId('phase3').waitFor();try{await page.getByTestId('phase3-status').filter({hasText:/ready|bereit/}).waitFor({timeout:10000});}catch(error){console.log('phase3 startup',await page.getByTestId('phase3-status').innerText(),external,page.frames().map(f=>new URL(f.url()).pathname));await browser.close();await host.close();await rm(directory,{recursive:true,force:true});throw error;}
 const get=async<T>(route:string):Promise<T>=>{const credential=route==='author'||route.startsWith('recording?')?await heldAuthorCredential(page):host.token;const reply=await (await fetch(host.origin+'/api/'+route,{headers:{[TOKEN_HEADER]:credential}})).json() as HostReply<T>;if(!reply.ok)throw Error(reply.error.code);assert.equal(reply.ok,true);return reply.value;};
 return{host,world,browser,page,external,get,async close(){await browser.close();await host.close();await rm(directory,{recursive:true,force:true});}};
}
async function engine(page:Page):Promise<Frame>{const handle=await page.getByTestId('real-editor').elementHandle();const frame=await handle!.contentFrame();assert.ok(frame);await frame.waitForFunction(()=>!!(window as unknown as {__pnEditor:unknown}).__pnEditor);return frame;}
async function point(page:Page,frame:Frame,id:string):Promise<{x:number;y:number}>{
 // Engine API/font readiness precedes loading the practice scene. Wait for the
 // actual live target, then cross replace()'s two-frame camera/layout boundary.
 await frame.waitForFunction(id=>(window as unknown as {__pnEditor:{read():Array<{id:string;isDeleted:boolean}>}}).__pnEditor.read().some(e=>e.id===id&&!e.isDeleted),id);
 await frame.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const position=await frame.evaluate(id=>{const tool=(window as unknown as {__pnEditor:{read():Array<{id:string;x:number;y:number;width:number;height:number}>;appState():{scrollX:number;scrollY:number;zoom:{value:number};offsetLeft:number;offsetTop:number}}}).__pnEditor;const e=tool.read().find(e=>e.id===id)!;const s=tool.appState();return{x:(e.x+20+s.scrollX)*s.zoom.value+s.offsetLeft,y:(e.y+20+s.scrollY)*s.zoom.value+s.offsetTop};},id);
 const box=await page.getByTestId('real-editor').boundingBox();assert.ok(box);return{x:box.x+position.x,y:box.y+position.y};
}
async function select(page:Page,frame:Frame,id:string):Promise<void>{const p=await point(page,frame,id);await page.mouse.click(p.x,p.y);}
test('real Excalidraw editor gestures and Board actions reach the same hash; native undo is host-owned',{timeout:60_000},async()=>{
 const f=await setup();try{
  await f.page.getByTestId('language-en').click();await f.page.getByTestId('mode-editor').click();const frame=await engine(f.page);await f.page.getByTestId('phase3-status').filter({hasText:/ready/}).waitFor();
  await f.page.getByTestId('real-editor').scrollIntoViewIfNeeded();
  await select(f.page,frame,'b');const response=f.page.waitForResponse(r=>r.url().endsWith('/api/editor'));await frame.locator('.excalidraw').press('Delete');const reply=await (await response).json();assert.equal(reply.ok,true,JSON.stringify(reply));
  let view=await f.get<HostView>('observe');const oracle=new Session(f.world,42,'T3');oracle.act({name:'delete_step',params:{id:'b'}});assert.equal(view.hash,oracle.hash);assert.equal(view.history.at(-1)?.mirrorConfirmed,true);
  await frame.waitForFunction(()=>(window as unknown as {__pnEditor:{read():Array<{id:string;isDeleted:boolean}>}}).__pnEditor.read().find(e=>e.id==='b')?.isDeleted);
  const undo=f.page.waitForResponse(r=>r.url().endsWith('/api/undo'));await frame.locator('.excalidraw').press('ControlOrMeta+z');assert.equal((await(await undo).json()).ok,true);oracle.undo();view=await f.get<HostView>('observe');assert.equal(view.hash,oracle.hash);assert.equal(view.revision,2);
  await f.page.getByTestId('mode-board').click();await f.page.locator('[data-object-id="b"]').first().click();const deleted=f.page.waitForResponse(r=>r.url().endsWith('/api/act'));await f.page.getByTestId('action-delete').click();assert.equal((await(await deleted).json()).ok,true);oracle.act({name:'delete_step',params:{id:'b'}});assert.equal((await f.get<HostView>('observe')).hash,oracle.hash);
  await f.page.getByTestId('mode-editor').click();await f.page.getByTestId('real-editor').scrollIntoViewIfNeeded();const toolbarUndo=f.page.waitForResponse(r=>r.url().endsWith('/api/undo'));await frame.getByTestId('button-undo').click();assert.equal((await(await toolbarUndo).json()).ok,true);oracle.undo();assert.equal((await f.get<HostView>('observe')).hash,oracle.hash);await frame.waitForFunction(()=>(window as unknown as {__pnEditor:{read():Array<{id:string}>}}).__pnEditor.read().some(e=>e.id==='a'));await select(f.page,frame,'a');
  const beforeUnsupported=await f.get<HostView>('observe'),unsupported=f.page.waitForResponse(r=>r.url().endsWith('/api/editor'));
  await frame.getByTestId('color-top-pick-#e03131').click();const unsupportedReply=await(await unsupported).json();assert.equal(unsupportedReply.ok,false);assert.equal(unsupportedReply.error.code,'unmodeled');
  const unchanged=await f.get<HostView>('observe');assert.equal(unchanged.hash,beforeUnsupported.hash);assert.equal(unchanged.revision,beforeUnsupported.revision);assert.deepEqual(unchanged.log,beforeUnsupported.log);await frame.waitForFunction(()=>(window as unknown as {__pnEditor:{read():Array<{id:string;strokeColor:string}>}}).__pnEditor.read().find(e=>e.id==='a')?.strokeColor==='#1e1e1e');assert.match(await f.page.getByTestId('phase3-status').innerText(),/Not yet modelled.*“Stroke color”.*drawing surface is unchanged/s);assert.deepEqual((await f.page.getByTestId('phase3-status').getAttribute('class'))!.split(/\s+/).sort(),['phase3-status','unmodeled','pn-banner','pn-banner--unknown'].sort());
  assert.deepEqual(f.external,[]);
 }finally{await f.close();}
});
test('author UI captures actual gestures only after explicit start; review, analysis and deletion keep text literal',{timeout:60_000},async()=>{
 const f=await setup();try{
  await f.page.getByTestId('language-en').click();await f.page.getByTestId('mode-author').click();await f.page.getByTestId('author-advanced').locator('summary').first().click();const frame=await engine(f.page);await f.page.getByTestId('record-start').waitFor();
  assert.equal((await f.get<AuthorView>('author')).recording.active,false);
  await f.page.getByTestId('author-load-scene').click();await f.page.getByTestId('record-author').fill('<img src=x onerror=alert(1)>');await f.page.getByTestId('record-source').selectOption('scripted');
  const started=f.page.waitForResponse(r=>r.url().endsWith('/api/record/start'));await f.page.getByTestId('record-start').click();assert.equal((await(await started).json()).ok,true);
  await f.page.getByTestId('real-editor').scrollIntoViewIfNeeded();await select(f.page,frame,'b');const gesture=f.page.waitForResponse(r=>r.url().endsWith('/api/record/gesture'));await frame.locator('.excalidraw').press('Delete');assert.equal((await(await gesture).json()).ok,true);
  const stopped=f.page.waitForResponse(r=>r.url().endsWith('/api/record/stop'));await f.page.getByTestId('record-stop').click();const stop=await(await stopped).json();assert.equal(stop.ok,true,JSON.stringify(stop));const recorded=await f.get<Recording>('recording?id='+encodeURIComponent(stop.value.recordingId));assert.equal(recorded.manifest.demonstration,'scripted');assert.ok(recorded.gestures.length>0);
  await f.page.getByTestId('author-analyze').click();await f.page.getByTestId('author-project').waitFor();const author=await f.get<AuthorView>('author');assert.ok(author.project!.hypotheses.some(h=>h.action==='delete_step'));assert.ok(author.project!.hypotheses.every(h=>h.status!=='confirmed'));assert.match(await f.page.getByTestId('phase3').innerText(),/<img src=x/);assert.equal(await f.page.getByTestId('phase3').locator('img').count(),0);
  await mkdir('.local/phase3-render',{recursive:true});await f.page.locator('.shell-stage').screenshot({path:'.local/phase3-render/author-en-light-1280.png'});
  const candidate=author.project!.hypotheses.find(h=>h.id==='delete-keeps-arrows-v1');assert.ok(candidate);assert.equal(candidate.status,'proposed');
  for(const language of ['en','de'] as const)for(const theme of ['light','dark'] as const){
   await f.page.getByTestId('language-'+language).click();await f.page.getByTestId('theme-select').selectOption(theme);
   const mark=f.page.getByTestId('hypothesis-'+candidate.id).locator('.pn-evidence__mark--hypothesis');assert.equal(await mark.count(),1);assert.equal(await mark.evaluate(el=>getComputedStyle(el).borderStyle),'dashed');
   await f.page.locator('.shell-stage').screenshot({path:`.local/phase3-render/proposals-${language}-${theme}-context.png`});await f.page.locator('.hypothesis.proposed').first().screenshot({path:`.local/phase3-render/hypothesis-${language}-${theme}.png`});
  }
  await f.page.getByTestId('author-load-scene').click();
  const secondStart=f.page.waitForResponse(r=>r.url().endsWith('/api/record/start'));await f.page.getByTestId('record-start').click();assert.equal((await(await secondStart).json()).ok,true);
  await f.page.getByTestId('real-editor').scrollIntoViewIfNeeded();await select(f.page,frame,'b');const secondGesture=f.page.waitForResponse(r=>r.url().endsWith('/api/record/gesture'));await frame.locator('.excalidraw').press('Delete');assert.equal((await(await secondGesture).json()).ok,true);
  const secondStop=f.page.waitForResponse(r=>r.url().endsWith('/api/record/stop'));await f.page.getByTestId('record-stop').click();const newRecording=await(await secondStop).json();assert.equal(newRecording.ok,true);
  await f.page.getByTestId('evidence-'+candidate.id).selectOption(newRecording.value.recordingId);
  const confirmation=f.page.waitForResponse(r=>r.url().endsWith('/api/author/confirm'));await f.page.getByTestId('confirm-'+candidate.id).click();assert.equal((await(await confirmation).json()).ok,true);
  assert.equal((await f.get<AuthorView>('author')).project!.hypotheses.find(h=>h.id===candidate.id)!.status,'confirmed');
  assert.equal(JSON.parse(await f.page.getByTestId('author-project').inputValue()).hypotheses.find((h:{id:string})=>h.id===candidate.id).status,'confirmed');
  for(const language of ['en','de'] as const)for(const theme of ['light','dark'] as const){
   await f.page.getByTestId('language-'+language).click();await f.page.getByTestId('theme-select').selectOption(theme);
   const confirmed=f.page.getByTestId('hypothesis-'+candidate.id);await confirmed.getByText(language==='de'?'Bestätigt':'Confirmed',{exact:true}).waitFor();
   const mark=confirmed.locator('.pn-evidence__mark--confirmed');assert.equal(await mark.count(),1);const accent=await f.page.evaluate(()=>{const probe=document.createElement('span');probe.style.color='var(--pn-color-accent)';document.body.append(probe);const value=getComputedStyle(probe).color;probe.remove();return value;});const fillColor=await mark.evaluate(el=>getComputedStyle(el).backgroundColor);assert.notEqual(fillColor,'rgba(0, 0, 0, 0)');assert.equal(fillColor,accent);assert.equal(await mark.locator('svg path').count()>0,true);
   const observed=f.page.locator('.pn-evidence__mark--observed').first();assert.equal(await observed.evaluate(el=>getComputedStyle(el).borderStyle),'solid');assert.equal(await observed.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');assert.equal(await f.page.locator('.pn-evidence__mark--refuted').first().locator('svg path').getAttribute('d'),'M6 6l12 12M18 6L6 18');
   await f.page.locator('.shell-stage').screenshot({path:`.local/phase3-render/markers-${language}-${theme}-context.png`});
   await confirmed.screenshot({path:`.local/phase3-render/confirmed-${language}-${theme}.png`});
   await f.page.locator('.recording-row').first().screenshot({path:`.local/phase3-render/observed-${language}-${theme}.png`});
   await f.page.locator('.hypothesis.refuted').first().screenshot({path:`.local/phase3-render/refuted-${language}-${theme}.png`});
  }
  await f.page.getByTestId('delete-'+newRecording.value.recordingId).click();const deleteSecond=f.page.waitForResponse(r=>r.url().endsWith('/api/record/delete'));await f.page.getByTestId('record-delete-confirm').click();assert.equal((await(await deleteSecond).json()).ok,true);
  await f.page.getByTestId('delete-'+recorded.manifest.id).click();const deletion=f.page.waitForResponse(r=>r.url().endsWith('/api/record/delete'));await f.page.getByTestId('record-delete-confirm').click();assert.equal((await(await deletion).json()).ok,true);assert.equal((await f.get<AuthorView>('author')).recordings.length,0);
  assert.deepEqual(f.external,[]);
 }finally{await f.close();}
});
for(const width of [1280,320])for(const theme of ['light','dark'] as const)test(`author shell EN/DE ${width}px ${theme} native keyboard and reflow`,{timeout:60_000},async()=>{
 const f=await setup(width,theme);try{
  await f.page.getByTestId('language-de').click();await f.page.getByTestId('theme-select').selectOption(theme);await f.page.getByTestId('mode-author').focus();await f.page.keyboard.press('Enter');await f.page.getByTestId('author-advanced').locator('summary').first().click();await f.page.getByTestId('record-start').waitFor();
  const overflow=await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  const child=await engine(f.page);await child.getByRole('button',{name:'Rückgängig machen',exact:true}).waitFor();if(theme==='dark')await child.locator('.excalidraw.theme--dark').waitFor();
  assert.match(await f.page.getByTestId('phase3').innerText(),/Aufnahme starten/);await f.page.getByTestId('record-author').focus();await f.page.keyboard.press('Tab');assert.equal(await f.page.getByTestId('record-license').evaluate(el=>el===document.activeElement),true);
  await mkdir('.local/phase3-render',{recursive:true});await f.page.locator('.shell-stage').screenshot({path:`.local/phase3-render/author-de-${theme}-${width}.png`});assert.deepEqual(f.external,[]);
 }finally{await f.close();}
});

for(const theme of ['light','dark'] as const)test(`real unsupported stroke color uses hatched provenance in EN/DE ${theme}`,{timeout:60_000},async()=>{
 const f=await setup(1280,theme);try{
  await f.page.getByTestId('mode-editor').click();const frame=await engine(f.page);
  for(const language of ['en','de'] as const){
   await f.page.getByTestId('language-'+language).click();await f.page.getByTestId('real-editor').scrollIntoViewIfNeeded();
   await select(f.page,frame,'a');const before=await f.get<HostView>('observe'),response=f.page.waitForResponse(r=>r.url().endsWith('/api/editor'));
   await frame.getByTestId('color-top-pick-#e03131').click();const reply=await(await response).json();assert.equal(reply.ok,false);assert.equal(reply.error.code,'unmodeled');
   const status=f.page.getByTestId('phase3-status');await status.filter({hasText:language==='en'?'Stroke color':'Linienfarbe'}).waitFor();assert.deepEqual((await status.getAttribute('class'))!.split(/\s+/).sort(),['phase3-status','unmodeled','pn-banner','pn-banner--unknown'].sort());
   assert.match(await status.innerText(),language==='en'?/Not yet modelled.*does not model “Stroke color”.*drawing surface is unchanged.*Use a step or arrow action/s:/Noch nicht modelliert.*„Linienfarbe“ kennt diese Übung nicht.*Zeichenfläche ist unverändert.*Nutze stattdessen eine Schritt- oder Pfeilaktion/s);
   const pattern=await status.evaluate(el=>getComputedStyle(el,'::before').backgroundImage);assert.match(pattern,/linear-gradient/);assert.notEqual(pattern,'none');
   const after=await f.get<HostView>('observe');assert.equal(after.hash,before.hash);assert.equal(after.revision,before.revision);assert.deepEqual(after.log,before.log);assert.deepEqual(after.history,before.history);
   await frame.waitForFunction(()=>(window as unknown as {__pnEditor:{read():Array<{id:string;strokeColor:string}>}}).__pnEditor.read().find(e=>e.id==='a')?.strokeColor==='#1e1e1e');
   await mkdir('.local/phase3-render',{recursive:true});await f.page.locator('.shell-stage').screenshot({path:`.local/phase3-render/unmodeled-${language}-${theme}-context.png`});await status.screenshot({path:`.local/phase3-render/unmodeled-${language}-${theme}.png`});
  }
  assert.deepEqual(f.external,[]);
 }finally{await f.close();}
});

test('delayed local language preserves active recorder, scene and host undo while native controls become usable',{timeout:60_000},async()=>{
 const f=await setup(1280,'light',350);try{
  await f.page.getByTestId('language-de').click();await f.page.getByTestId('theme-select').selectOption('light');await f.page.getByTestId('mode-author').focus();await f.page.keyboard.press('Enter');await f.page.getByTestId('author-advanced').locator('summary').first().click();await f.page.getByTestId('record-start').waitFor();const frame=await engine(f.page);
  try{await frame.getByRole('button',{name:'Rückgängig machen',exact:true}).waitFor({timeout:5000});}catch(error){console.log('locale controls',await frame.getByTestId('button-undo').getAttribute('aria-label'),await frame.evaluate(()=>document.documentElement.lang));throw error;}
  await f.page.getByTestId('author-load-scene').click();const start=f.page.waitForResponse(r=>r.url().endsWith('/api/record/start'));await f.page.getByTestId('record-start').click();assert.equal((await(await start).json()).ok,true);
  await f.page.getByTestId('real-editor').scrollIntoViewIfNeeded();await select(f.page,frame,'b');const gesture=f.page.waitForResponse(r=>r.url().endsWith('/api/record/gesture'));await frame.locator('.excalidraw').press('Delete');assert.equal((await(await gesture).json()).ok,true);
  const beforeAuthor=await f.get<AuthorView>('author'),beforeHost=await f.get<HostView>('observe'),beforeScene=await frame.evaluate(()=>(window as unknown as {__pnEditor:{read():unknown}}).__pnEditor.read());assert.equal(beforeAuthor.recording.gestures,1);assert.equal(beforeAuthor.recording.active,true);
  await f.page.getByTestId('language-en').click();await frame.getByRole('button',{name:'Undo',exact:true}).waitFor({timeout:5000});
  assert.deepEqual(await frame.evaluate(()=>(window as unknown as {__pnEditor:{read():unknown}}).__pnEditor.read()),beforeScene);assert.deepEqual((await f.get<AuthorView>('author')).recording,beforeAuthor.recording);assert.deepEqual(await f.get<HostView>('observe'),beforeHost);
  const stop=f.page.waitForResponse(r=>r.url().endsWith('/api/record/stop'));await f.page.getByTestId('record-stop').click();const stopped=await(await stop).json();assert.equal(stopped.ok,true);assert.equal((await f.get<Recording>('recording?id='+encodeURIComponent(stopped.value.recordingId))).gestures.length,1);
  await f.page.waitForFunction(()=>document.querySelector<HTMLButtonElement>('[data-testid="record-stop"]')?.disabled===true);await f.page.getByTestId('mode-editor').click();try{await f.page.getByTestId('phase3-status').filter({hasText:/ready|bereit/}).waitFor({timeout:5000});}catch(e){console.log('editor transition status',await f.page.getByTestId('phase3-status').innerText());throw e;}assert.equal(await f.page.getByTestId('mode-editor').getAttribute('aria-pressed'),'true');assert.equal(await f.page.getByTestId('mode-author').getAttribute('aria-pressed'),'false');assert.equal(await f.page.evaluate(()=>document.body.dataset.workspace),'editor');assert.equal(await f.page.evaluate(()=>{const r=document.querySelector('[data-testid="real-editor"]')!.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0;}),true);assert.equal(await f.page.evaluate(()=>JSON.parse(sessionStorage.getItem('practonaut.tab-session')!).workspace),'editor');await select(f.page,frame,'b');const deleted=f.page.waitForResponse(r=>r.url().endsWith('/api/editor'));await frame.locator('.excalidraw').press('Delete');assert.equal((await(await deleted).json()).ok,true);
  const history=await f.get<HostView>('observe');assert.equal(history.step,1);await f.page.getByTestId('language-de').click();await frame.getByRole('button',{name:'Rückgängig machen',exact:true}).waitFor({timeout:5000});assert.deepEqual(await f.get<HostView>('observe'),history);
  const undo=f.page.waitForResponse(r=>r.url().endsWith('/api/undo'));await frame.getByTestId('button-undo').click();assert.equal((await(await undo).json()).ok,true);assert.equal((await f.get<HostView>('observe')).hash,beforeHost.hash);assert.deepEqual(f.external,[]);
 }finally{await f.close();}
});

test('missing local locale keeps the previous workspace and does not admit authoring or mutate the host',{timeout:30_000},async()=>{
 const f=await setup(1280,'light',-1);try{
  const before=await f.get<HostView>('observe');await f.page.getByTestId('language-de').click();const cacheBefore=await f.page.evaluate(()=>sessionStorage.getItem('practonaut.tab-session'));await f.page.getByTestId('mode-author').click();
  await f.page.locator('[data-testid="phase3-status"].error').waitFor({timeout:12_000});assert.equal(await f.page.getByTestId('record-start').count(),0);
  assert.equal(await f.page.getByTestId('mode-board').getAttribute('aria-pressed'),'true');assert.equal(await f.page.getByTestId('mode-author').getAttribute('aria-pressed'),'false');assert.equal(await f.page.evaluate(()=>document.body.dataset.workspace),'board');assert.equal(await f.page.evaluate(()=>sessionStorage.getItem('practonaut.tab-session')),cacheBefore);
  assert.deepEqual(await f.get<HostView>('observe'),before);assert.equal((await f.get<AuthorView>('author')).recording.active,false);assert.equal((await f.get<AuthorView>('author')).recordings.length,0);assert.deepEqual(f.external,[]);
 }finally{await f.close();}
});

for(const lostAcknowledgements of [1,2])test(`missing ${lostAcknowledgements} configure acknowledgement(s) preserve the actual scene and stable workspace before retry`,{timeout:45000},async()=>{
 const f=await setup();try{
  // A real Board action makes global Undo meaningful during the pending transition.
  await f.page.locator('[data-object-id="a"]').first().click();await f.page.getByTestId('action-rename').click();await f.page.getByTestId('input-label').fill('Prepared first step');const acted=f.page.waitForResponse(r=>r.url().endsWith('/api/act'));await f.page.getByTestId('action-submit').click();assert.equal((await(await acted).json()).ok,true);assert.equal((await f.get<HostView>('observe')).step,1);
  await f.page.getByTestId('mode-author').click();await f.page.getByTestId('author-advanced').locator('summary').first().click();await f.page.getByTestId('author-load-scene').click();const frame=await engine(f.page);
  const start=f.page.waitForResponse(r=>r.url().endsWith('/api/record/start'));await f.page.getByTestId('record-start').click();assert.equal((await(await start).json()).ok,true);
  await select(f.page,frame,'b');const gesture=f.page.waitForResponse(r=>r.url().endsWith('/api/record/gesture'));await frame.locator('.excalidraw').press('Delete');assert.equal((await(await gesture).json()).ok,true);
  const stop=f.page.waitForResponse(r=>r.url().endsWith('/api/record/stop'));await f.page.getByTestId('record-stop').click();const stopped=(await(await stop).json());assert.equal(stopped.ok,true);const originalRecording=await f.get<Recording>('recording?id='+encodeURIComponent(stopped.value.recordingId));await f.page.waitForFunction(()=>document.querySelector<HTMLButtonElement>('[data-testid="record-stop"]')?.disabled===true);
  const beforeHost=await f.get<HostView>('observe'),beforeAuthor=await f.get<AuthorView>('author'),beforeNative=await frame.evaluate(()=>(window as unknown as {__pnEditor:{read():unknown}}).__pnEditor.read()),cacheBefore=await f.page.evaluate(()=>sessionStorage.getItem('practonaut.tab-session'));
  // Fault at the real engine response boundary. The scene is really configured;
  // only its first acknowledgement is lost, so restoration must undo that change.
  await frame.evaluate(limit=>{const original=MessagePort.prototype.postMessage;let lost=0;MessagePort.prototype.postMessage=function(message:unknown,...rest:unknown[]){if(lost<limit&&message!==null&&typeof message==='object'&&(message as {type?:string}).type==='configured'){lost++;return;}return Reflect.apply(original,this,[message,...rest]);};},lostAcknowledgements);
  await f.page.getByTestId('mode-editor').click();assert.equal(await f.page.getByTestId('mode-author').getAttribute('aria-pressed'),'true');assert.equal(await f.page.locator('.native-editor-scroll').getAttribute('aria-busy'),'true');assert.equal(await f.page.locator('.native-editor-scroll').evaluate(e=>(e as HTMLElement).inert),true);assert.equal(await f.page.evaluate(()=>sessionStorage.getItem('practonaut.tab-session')),cacheBefore);await f.page.locator('body').press('Control+z');assert.deepEqual(await f.get<HostView>('observe'),beforeHost);
  // One voice per failure: a failed change that kept the editor speaks in the banner (with Try again); an unrestored editor in Create speaks only in its panel.
  if(lostAcknowledgements===2)await f.page.locator('[data-testid="engine-state"][data-kind="error"]').waitFor({timeout:23000});else await f.page.locator('[data-testid="phase3-status"].error').waitFor({timeout:23000});assert.equal(await f.page.getByTestId('mode-author').getAttribute('aria-pressed'),'true');assert.equal(await f.page.getByTestId('mode-editor').getAttribute('aria-pressed'),'false');assert.equal(await f.page.evaluate(()=>document.body.dataset.workspace),'author');assert.equal(await f.page.evaluate(()=>sessionStorage.getItem('practonaut.tab-session')),cacheBefore);assert.deepEqual(await f.get<HostView>('observe'),beforeHost);assert.deepEqual(await f.get<AuthorView>('author'),beforeAuthor);// Excalidraw rebuilds the excluded reverse-binding cache when restoring a deleted step. Every other raw field remains exact; the original stored recording is untouched.
  assert.equal(await f.page.locator('.native-editor-scroll').evaluate(e=>(e as HTMLElement).inert),lostAcknowledgements===2);if(lostAcknowledgements===2){assert.equal(await f.page.getByTestId('phase3-status').isVisible(),false,'no banner above the page in Create');assert.match(await f.page.getByTestId('engine-state').innerText(),/The drawing surface did not open.*Your project is kept.*Try again/s);assert.equal(await f.page.getByTestId('native-objects-waiting').isVisible(),true,'the object list makes no claim about a surface that is not open');}else assert.match(await f.page.getByTestId('phase3-status').innerText(),/The drawing surface did not open.*You stay in the current area/s);assert.equal(await f.page.getByTestId('phase3-retry').count(),lostAcknowledgements===2?0:1,'a failed mode change offers Try again; an unrestored editor offers it in its panel');assert.deepEqual(await f.get<Recording>('recording?id='+encodeURIComponent(stopped.value.recordingId)),originalRecording);
  const restoredNative=await frame.evaluate(()=>(window as unknown as {__pnEditor:{read():Array<Record<string,unknown>>}}).__pnEditor.read());const withoutReverseCache=(elements:Array<Record<string,unknown>>)=>elements.map(({boundElements: _derived,...object})=>object);assert.deepEqual(withoutReverseCache(restoredNative),withoutReverseCache(beforeNative as Array<Record<string,unknown>>));
  await f.page.getByTestId('mode-editor').click();await f.page.waitForFunction(()=>document.querySelector('[data-testid="mode-editor"]')?.getAttribute('aria-pressed')==='true');assert.equal(await f.page.locator('.native-editor-scroll').evaluate(e=>(e as HTMLElement).inert),false);assert.deepEqual(await f.get<HostView>('observe'),beforeHost);assert.deepEqual(f.external,[]);
 }finally{await f.close();}
});
