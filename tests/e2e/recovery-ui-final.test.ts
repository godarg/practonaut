import {TAB_SESSION_KEY} from '../../src/player/tab-session.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,rm,realpath,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startHost} from '../../src/host/server.ts';
import {validateWorld} from '../../src/world/schema.ts';
import {TOKEN_HEADER,type HostReply} from '../../src/host/protocol.ts';
import type {AuthorView} from '../../src/host/author-protocol.ts';
const artifacts='.local/recovery-ui-final-renders';
async function setup(){
 const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-ui-final-'));
 const world=validateWorld(JSON.parse(readFileSync('examples/worlds/flow-diagram/world.json','utf8')));
 const host=await startHost(world,{phase3:true,taskId:'T3',seed:42,localDirectory:directory,tokenDirectory:join(directory,'credentials')});
 const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();const allowed=new Set([host.origin]),external:string[]=[];
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(!allowed.has(url.origin)){external.push(url.origin);await route.abort();return;}if(url.pathname==='/api/bootstrap'){const response=await route.fetch(),reply=await response.json();if(reply.ok&&reply.value.engineOrigin)allowed.add(reply.value.engineOrigin);await route.fulfill({response});}else await route.continue();});
 await page.goto(host.url);await page.getByTestId('phase3-status').filter({hasText:/ready/}).waitFor();await mkdir(artifacts,{recursive:true});
 const assetBinding=await Promise.all(['/player.js','/player.css','/tokens.css'].map(async path=>{const response=await page.request.get(host.origin+path);assert.equal(response.status(),200);return {file:path,sha256:createHash('sha256').update(await response.body()).digest('hex')};}));
 const author=async()=>{const held:unknown=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).authorToken,TAB_SESSION_KEY);assert.equal(typeof held==='string'&&/^[a-f0-9]{64}$/.test(held)&&held!==host.token,true,'author fixture must use the actual distinct capability held by its legitimate tab');const reply=await(await fetch(host.origin+'/api/author',{headers:{[TOKEN_HEADER]:held as string}})).json() as HostReply<AuthorView>;if(!reply.ok)throw Error(reply.error.code);assert.equal(reply.ok,true);return reply.value;};
 return {page,host,author,external,assetBinding,async close(){await browser.close();await host.close();await rm(directory,{recursive:true,force:true});}};
}
test('readable default goal stays one verdict; all desktop drawing objects are visible at readable scale',{timeout:60000},async()=>{
 const f=await setup(),ledger:unknown[]=[];try{
  for(const language of ['en','de'] as const)for(const theme of ['light','dark'])for(const width of [1024,1280,1440,320]){
   await f.page.setViewportSize({width,height:1000});await f.page.getByTestId('language-'+language).click();await f.page.getByTestId('theme-select').selectOption(theme);
   const goal=f.page.locator('.goal-list>li');assert.equal(await goal.count(),1);assert.match(await goal.locator('.condition-status').innerText(),language==='en'?/not checked yet/i:/noch nicht geprüft/i);assert.equal(await goal.locator('details').count(),0,'no disclosure under the condition');assert.equal(await f.page.getByTestId('formal-switch').getAttribute('aria-pressed'),'false');assert.equal(await goal.getByTestId('goal-formal').count(),0);assert.doesNotMatch(await goal.locator('p').first().innerText(),/\[s0\]|flow-frame|\.frameId/);
   const measurements=await f.page.evaluate(()=>{const region=document.querySelector('.board-scroll')!,r=region.getBoundingClientRect(),svg=document.querySelector('.board-svg')!,drawing=svg.getBoundingClientRect();return {bodyOverflow:document.documentElement.scrollWidth>innerWidth,clientWidth:region.clientWidth,scrollWidth:region.scrollWidth,drawingWidth:drawing.width,region:{left:r.left,right:r.right},nodes:[...svg.querySelectorAll('.step-box')].map(e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,visible:b.left>=r.left-1&&b.right<=r.right+1};}),font:[...svg.querySelectorAll('.step-label')].map(e=>Number.parseFloat(getComputedStyle(e).fontSize)*drawing.width/svg.getAttribute('viewBox')!.split(' ').map(Number)[2]!)};});assert.equal(measurements.bodyOverflow,false);assert.equal(measurements.nodes.length,3);if(width>=1024){assert.equal(measurements.nodes.every(n=>n.visible),true,JSON.stringify({width,...measurements}));assert.ok(measurements.font.every(size=>size>=13),JSON.stringify(measurements));}else{assert.equal(await f.page.locator('.board-scroll').getAttribute('tabindex'),'0');assert.match(await f.page.locator('.board-scroll').getAttribute('aria-label')??'',/scroll|scrollen|horizontal verschieben/);}
   const file=join(artifacts,`entry-${language}-${theme}-${width}.png`);await f.page.screenshot({path:file,fullPage:true});ledger.push({language,theme,width,measurements,file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});
  }
  assert.deepEqual(f.external,[]);await writeFile(join(artifacts,'entry-ledger.json'),JSON.stringify({assets:f.assetBinding,states:ledger},null,2));
 }finally{await f.close();}
});
test('prepared native labels retain whole words and mobile recording stop stays reachable beside the drawing',{timeout:60000},async()=>{
 const f=await setup(),ledger:unknown[]=[];try{
  await f.page.getByTestId('mode-author').click();await f.page.getByTestId('recovery-author').fill('Scripted render test');
  for(const language of ['en','de'] as const)for(const theme of ['light','dark']){
   await f.page.setViewportSize({width:320,height:568});await f.page.getByTestId('language-'+language).click();await f.page.getByTestId('theme-select').selectOption(theme);const labels=language==='de'?['Text sammeln','Text prüfen','Text veröffentlichen']:['Collect draft','Review draft','Publish draft'];
   if(!await f.page.locator('[data-stage=plan]').evaluate(e=>(e as HTMLDetailsElement).open))await f.page.locator('[data-stage=plan]>summary').click();await f.page.getByTestId('recovery-title').fill('Whole words '+language+theme);for(let i=0;i<3;i++)await f.page.getByTestId('recovery-label-'+i).fill(labels[i]!);const prepare=f.page.waitForResponse(r=>r.url().endsWith('/api/author/prepare'));await f.page.getByTestId('recovery-prepare').click();assert.equal((await(await prepare).json()).ok,true);await f.page.waitForFunction(()=>document.querySelector('[data-testid=recovery-status]')?.textContent!=='Working locally…'&&document.querySelector('[data-testid=recovery-status]')?.textContent!=='Lokale Verarbeitung…');
   const frame=await(await f.page.getByTestId('real-editor').elementHandle())!.contentFrame();assert.ok(frame);await frame.waitForFunction(()=>!!(window as unknown as {__pnEditor:unknown}).__pnEditor);await frame.waitForFunction(({language,theme})=>document.documentElement.lang===(language==='de'?'de-DE':'en')&&document.querySelector('.excalidraw')?.classList.contains('theme--dark')===(theme==='dark'),{language,theme});
   const native=await frame.evaluate(()=>(window as unknown as {__pnEditor:{read():Array<{id:string;type:string;text?:string;originalText?:string;width:number}>}}).__pnEditor.read().filter(e=>e.type==='text').map(e=>({id:e.id,text:e.text!,original:e.originalText!,width:e.width})));
   await f.page.setViewportSize({width:1280,height:1000});await f.page.getByTestId('recovery-go-editor').click();const desktopFile=join(artifacts,`native-${language}-${theme}-1280.png`);await f.page.locator('.native-editor-scroll').screenshot({path:desktopFile});ledger.push({stage:'prepared',language,theme,width:1280,native,file:desktopFile,sha256:createHash('sha256').update(readFileSync(desktopFile)).digest('hex')});await f.page.setViewportSize({width:320,height:568});
   for(const label of labels){const text=native.find(e=>e.original===label);assert.ok(text);for(const word of label.split(/\s+/u))assert.ok(text.text.split(/\s+/u).includes(word),JSON.stringify(text));}assert.equal((await f.author()).recording.active,false);
   await f.page.getByTestId('recovery-go-editor').click();assert.equal(await f.page.locator('.native-editor-scroll').evaluate(e=>document.activeElement===e),true);const visible=await f.page.getByTestId('real-editor').evaluate(e=>{const r=e.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;});assert.equal(visible,true);
   const before=await frame.evaluate(()=>(window as unknown as {__pnEditor:{read():unknown}}).__pnEditor.read());
   for(const position of ['left','middle','right'] as const){await f.page.locator('.native-editor-scroll').evaluate((e,p)=>{e.scrollLeft=p==='left'?0:p==='middle'?(e.scrollWidth-e.clientWidth)/2:e.scrollWidth;},position);const file=join(artifacts,`native-${language}-${theme}-${position}-320.png`);await f.page.screenshot({path:file});ledger.push({stage:'prepared',language,theme,width:320,position,native,file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});}
   assert.deepEqual(await frame.evaluate(()=>(window as unknown as {__pnEditor:{read():unknown}}).__pnEditor.read()),before);
   await f.page.getByTestId('recovery-consent').check();await f.page.getByTestId('recovery-source').selectOption('scripted');const start=f.page.waitForResponse(r=>r.url().endsWith('/api/record/start'));await f.page.getByTestId('recovery-start').click();assert.equal((await(await start).json()).ok,true);await f.page.getByTestId('recovery-go-editor').click();const stop=f.page.getByTestId('recovery-stop-visible');await f.page.waitForFunction(()=>{const b=document.querySelector<HTMLButtonElement>('[data-testid=recovery-stop-visible]');return !!b&&!b.disabled;},undefined,{timeout:10_000});const rect=await stop.boundingBox();assert.ok(rect&&rect.y>=0&&rect.y+rect.height<=568);assert.equal(await stop.isEnabled(),true);
   // At the editor the bar sticks under the app bar, never over it; at rest (top of the page) no visible text lies under it (ER-04).
   assert.ok(rect.y>=await f.page.locator('.shell-bar').evaluate(e=>Math.floor(e.getBoundingClientRect().bottom)),'the recording bar sits below the app bar');
   const under=await f.page.evaluate(()=>{scrollTo(0,0);const bar=document.querySelector('.create-recording-bar')!.getBoundingClientRect(),hits:string[]=[];const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);for(let n=walk.nextNode();n;n=walk.nextNode()){const el=n.parentElement;if(!n.textContent?.trim()||!el||el.closest('.create-recording-bar,.shell-bar,.sr-only'))continue;const r=document.createRange();r.selectNodeContents(n);for(const b of r.getClientRects())if(b.width&&b.bottom>bar.top&&b.top<bar.bottom&&b.right>bar.left&&b.left<bar.right)hits.push(n.textContent.trim());}return hits;});assert.deepEqual(under,[],`${language} ${theme}: text under the recording bar at rest`);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const file=join(artifacts,`active-${language}-${theme}-320.png`);await f.page.screenshot({path:file});ledger.push({stage:'active',language,theme,width:320,stopRect:rect,file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});const stopped=f.page.waitForResponse(r=>r.url().endsWith('/api/record/stop'));await stop.click();assert.equal((await(await stopped).json()).ok,true);await f.page.getByTestId('recovery-stop-visible').waitFor({state:'detached'});assert.equal((await f.author()).recording.active,false);assert.equal((await f.author()).recording.gestures,0);
   if(language==='de'){if(!await f.page.locator('[data-stage=plan]').evaluate(e=>(e as HTMLDetailsElement).open))await f.page.locator('[data-stage=plan]>summary').click();await f.page.getByTestId('recovery-label-2').fill('Datenschutzfolgenabschätzung');const compound=f.page.waitForResponse(r=>r.url().endsWith('/api/author/prepare'));await f.page.getByTestId('recovery-prepare').click();assert.equal((await(await compound).json()).ok,true);await f.page.waitForFunction(()=>document.querySelector('[data-testid=recovery-status]')?.textContent!=='Lokale Verarbeitung…');await f.page.getByTestId('recovery-go-editor').click();const compoundNative=await frame.evaluate(()=>(window as unknown as {__pnEditor:{read():Array<{type:string;text?:string;originalText?:string}>}}).__pnEditor.read().find(e=>e.originalText==='Datenschutzfolgenabschätzung'));assert.ok(compoundNative?.text?.split(/\s+/u).includes('Datenschutzfolgenabschätzung'));const center=await frame.evaluate(()=>{const t=(window as unknown as {__pnEditor:{read():Array<{originalText?:string;x:number;width:number}>;appState():{scrollX:number;zoom:{value:number};offsetLeft:number}}}).__pnEditor;const text=t.read().find(e=>e.originalText==='Datenschutzfolgenabschätzung')!,s=t.appState();return (text.x+text.width/2+s.scrollX)*s.zoom.value+s.offsetLeft;});await f.page.locator('.native-editor-scroll').evaluate((e,center)=>{e.scrollLeft=Math.max(0,Math.min(e.scrollWidth-e.clientWidth,center-e.clientWidth/2));},center);const compoundFile=join(artifacts,`compound-de-${theme}-320.png`);await f.page.screenshot({path:compoundFile});ledger.push({stage:'compound',language,theme,width:320,native:compoundNative,file:compoundFile,sha256:createHash('sha256').update(readFileSync(compoundFile)).digest('hex')});}

  }
  assert.deepEqual(f.external,[]);await writeFile(join(artifacts,'native-ledger.json'),JSON.stringify({assets:f.assetBinding,states:ledger},null,2));
 }finally{await f.close();}
});
test('goal step lists the variants compactly and suggests two different variants with other names',{timeout:90000},async()=>{
 const f=await setup();try{
  const page=f.page;
  const openStage=async(stage:string)=>{if(!await page.locator(`[data-stage=${stage}]`).evaluate(e=>(e as HTMLDetailsElement).open))await page.locator(`[data-stage=${stage}]>summary`).click();};
  await page.getByTestId('mode-author').click();await page.getByTestId('recovery-author').fill('Scripted goal test');
  const prepared=page.waitForResponse(r=>r.url().endsWith('/api/author/prepare'));await page.getByTestId('recovery-prepare').click();assert.equal((await(await prepared).json()).ok,true);await page.getByTestId('recovery-start').waitFor();
  const original=(await f.author()).project!.repair!.cases[0]!.labels;
  // Precondition: the host prefills both variants with the process itself.
  assert.deepEqual((await f.author()).project!.repair!.cases.map(c=>c.labels),[original,original]);
  // Normal path: at most five visible input fields in Goal (titles and the three step choices), in both languages and widths.
  for(const language of ['en','de'] as const)for(const width of [1280,390]){
   await page.setViewportSize({width,height:1000});await page.getByTestId('language-'+language).click();await openStage('build');
   const fields=await page.locator('[data-stage=build]').evaluate(stage=>[...stage.querySelectorAll<HTMLElement>('input:not([type=checkbox]),select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';}).map(e=>e.dataset.testid??e.id));
   assert.ok(fields.length<=5,`${language} ${width}: ${fields.length} visible input fields in Goal: ${fields.join(', ')}`);
   for(let v=0;v<2;v++)assert.equal(await page.getByTestId(`recovery-variant-chain-${v}`).innerText(),original.join(' → '));
   // A chain wraps at its arrows only: no step name is split over two lines (R4-14).
   assert.deepEqual(await page.locator('[data-stage=build] .create-variant__name').evaluateAll(names=>names.filter(e=>e.getClientRects().length>1).map(e=>e.textContent)),[],`${language} ${width}: a step name breaks`);
   // The greyed "Accept examples" says what unlocks it (R4-06).
   assert.equal(await page.getByTestId('recovery-accept-hint').innerText(),language==='de'?'Prüfe die drei Beispiele unten und hake sie ab.':'Check the three examples below and tick the box.');assert.equal(await page.getByTestId('recovery-accept-examples').isDisabled(),true);
  }
  await page.setViewportSize({width:1280,height:1000});await page.getByTestId('language-en').click();await openStage('build');
  // The tick removes the line and unlocks the primary; removing it brings both back.
  await page.getByTestId('recovery-review-examples').check();assert.equal(await page.getByTestId('recovery-accept-hint').isVisible(),false);assert.equal(await page.getByTestId('recovery-accept-examples').isEnabled(),true);
  await page.getByTestId('recovery-review-examples').uncheck();assert.equal(await page.getByTestId('recovery-accept-hint').isVisible(),true);assert.equal(await page.getByTestId('recovery-accept-examples').isDisabled(),true);
  // "Suggest names" fills both variants deterministically: three different names each, never the process, never the same twice.
  await page.getByTestId('recovery-suggest-names').click();
  const shown=async()=>Promise.all([0,1].map(v=>page.getByTestId(`recovery-variant-chain-${v}`).innerText()));
  const first=await shown();await page.getByTestId('recovery-suggest-names').click();assert.deepEqual(await shown(),first,'suggestions are deterministic');
  const configured=page.waitForResponse(r=>r.url().endsWith('/api/author/configure'));await page.getByTestId('recovery-configure').click();assert.equal((await(await configured).json()).ok,true);
  // Without recordings the flow returns to Record after an action; Goal is opened again to read it.
  await page.waitForFunction(()=>!/Working locally/.test(document.querySelector('[data-testid="recovery-status"]')?.textContent??''));await openStage('build');
  const cases=(await f.author()).project!.repair!.cases.map(c=>c.labels);
  assert.deepEqual(cases.map(labels=>labels.join(' → ')),await shown(),'the rows show exactly what the host stores');
  for(const labels of cases){assert.equal(new Set(labels.map(l=>l.trim())).size,3,JSON.stringify(labels));assert.ok(labels.every(l=>l.trim().length>0));assert.notDeepEqual(labels,original);for(const l of labels)assert.ok(!original.includes(l),`${l} repeats a name of the process`);}
  assert.notDeepEqual(cases[0],cases[1]);
  // Editing one variant opens only its three fields; a duplicate is reported at the field and reopens that variant.
  await page.getByTestId('recovery-variant-edit-1').click();assert.equal(await page.getByTestId('recovery-variant-edit-1').getAttribute('aria-expanded'),'true');
  for(let i=0;i<3;i++)assert.equal(await page.getByTestId(`recovery-case-1-${i}`).inputValue(),cases[1]![i]);
  assert.equal(await page.getByTestId('recovery-case-0-0').count(),0,'only one variant is open');
  await page.getByTestId('recovery-case-1-2').fill(cases[1]![0]!);await page.getByTestId('recovery-variant-edit-1').click();assert.equal(await page.getByTestId('recovery-case-1-2').count(),0);
  await page.getByTestId('recovery-configure').click();await page.locator('#recovery-case-1-2-error').waitFor();
  assert.equal(await page.locator('#recovery-case-1-2-error').innerText(),'This name is already used.');assert.equal(await page.getByTestId('recovery-case-1-2').getAttribute('aria-invalid'),'true');assert.equal(await page.getByTestId('recovery-variant-edit-1').getAttribute('aria-expanded'),'true');
  assert.deepEqual((await f.author()).project!.repair!.cases.map(c=>c.labels),cases,'an invalid variant never reaches the host');
  assert.deepEqual(f.external,[]);
 }finally{await f.close();}
});
