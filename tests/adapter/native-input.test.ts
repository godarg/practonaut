import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, type Page, type Frame } from 'playwright-core';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { toRaw } from '../../src/adapters/excalidraw/raw.ts';
import { validateRecording, replayGesture, projectSnapshot, snapshotElements } from '../../src/adapters/excalidraw/recorder.ts';
import { observationAction } from '../../src/authoring/templates.ts';
import { analyzeRecordings, assertModeledSources } from '../../src/authoring/project.ts';
import type { Recording, RecordedGesture } from '../../src/adapters/excalidraw/recorder-types.ts';
import type { State } from '../../src/world/types.ts';
import { canonicalJson } from '../../src/canonical/index.ts';

const scene:State={objects:{
 f:{id:'f',type:'frame',deleted:false,name:'Native input probe'},
 a:{id:'a',type:'step',deleted:false,frameId:'f',label:'Receive request',x:300,y:300,width:180,height:100,fontFamily:3},
 b:{id:'b',type:'step',deleted:false,frameId:'f',label:'Review request',x:650,y:300,width:180,height:100,fontFamily:3},
 c:{id:'c',type:'step',deleted:false,frameId:'f',label:'Send response',x:1050,y:300,width:180,height:100,fontFamily:3},
 ab:{id:'ab',type:'arrow',deleted:false,frameId:'f',from:'a',to:'b'},
 bc:{id:'bc',type:'arrow',deleted:false,frameId:'f',from:'b',to:'c'},
}};
type BridgeReply={type:string;initial?:Recording['initial'];gesture?:RecordedGesture;elements?:ReturnType<typeof toRaw>};
async function command(page:Page,type:string,fields:Record<string,unknown>={}):Promise<BridgeReply>{
 return page.evaluate('window.__probe.command('+JSON.stringify({type,...fields})+')') as Promise<BridgeReply>;
}
async function fixture(){
 const scratch=await mkdtemp(join(await realpath(tmpdir()),'pn-native-input-'));
 // Bundle the production entry, not a reconstruction of its input listeners.
 await build({entryPoints:{editor:resolve('src/adapters/excalidraw/editor-browser.jsx'),engine:resolve('src/adapters/excalidraw/engine-browser.jsx')},outdir:scratch,bundle:true,splitting:true,format:'esm',conditions:['production'],minify:true,loader:{'.woff2':'file'},define:{'process.env.NODE_ENV':'"production"'}});
 const editor=createServer(async(request,response)=>{
  const path=new URL(request.url!,'http://127.0.0.1').pathname;
  try{
   if(path==='/editor.html'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><head><link rel="stylesheet" href="/editor.css"><style>@font-face{font-family:Cascadia;src:url(/fonts/Cascadia/CascadiaCode-Regular.woff2)}html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script type="module" src="/editor.js"></script></body></html>');return;}
   if(path==='/editor.css'){response.setHeader('Content-Type','text/css');response.end('@import url("/engine.css");');return;}
   if(!/^\/[a-zA-Z0-9_.\/-]+$/.test(path)||path.includes('..')){response.writeHead(404);response.end();return;}
   response.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'} as Record<string,string>)[extname(path)]??'application/octet-stream');
   response.end(await readFile(join(path.startsWith('/fonts/')?resolve('src/adapters/excalidraw/assets'):scratch,path.slice(1))));
  }catch{response.writeHead(404);response.end();}
 });
 await new Promise<void>(yes=>editor.listen(0,'127.0.0.1',yes));const editorAddress=editor.address();assert.ok(editorAddress&&typeof editorAddress!=='string');const editorOrigin='http://127.0.0.1:'+editorAddress.port;
 const parent=createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><body style="margin:16px"><iframe id="editor" style="width:calc(100vw - 32px);height:650px;border:0" src="'+editorOrigin+'/editor.html#parent='+encodeURIComponent(parentOrigin)+'"></iframe></body></html>');});
 let parentOrigin='';await new Promise<void>(yes=>parent.listen(0,'127.0.0.1',yes));const parentAddress=parent.address();assert.ok(parentAddress&&typeof parentAddress!=='string');parentOrigin='http://127.0.0.1:'+parentAddress.port;
 const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block'}),requests:string[]=[];
 await context.route('**/*',async route=>{const origin=new URL(route.request().url()).origin;if(![editorOrigin,parentOrigin].includes(origin)){requests.push(route.request().url());await route.abort();}else await route.continue();});
 const page=await context.newPage();await page.goto(parentOrigin);const frame=page.frames().find(f=>f.url().startsWith(editorOrigin));assert.ok(frame);await frame.waitForFunction('window.__pnEditor');
 await page.evaluate(`window.__probe={messages:[],pending:new Map(),next:0};const channel=new MessageChannel();window.__probe.port=channel.port1;channel.port1.onmessage=({data})=>{window.__probe.messages.push(data);if(data.id){const pending=window.__probe.pending.get(data.id);if(pending){window.__probe.pending.delete(data.id);data.type==='error'?pending.reject(Error(data.message)):pending.resolve(data);}}};channel.port1.start();window.__probe.command=message=>new Promise((resolve,reject)=>{const id=String(++window.__probe.next);window.__probe.pending.set(id,{resolve,reject});channel.port1.postMessage({...message,id});});document.querySelector('iframe').contentWindow.postMessage({type:'practonaut-engine/1'},${JSON.stringify(editorOrigin)},[channel.port2]);`);
 await page.waitForFunction('window.__probe.messages.some(m=>m.type==="ready"&&m.fontsReady)');
 return{page,frame,requests,async close(){await browser.close();await Promise.all([new Promise<void>((yes,no)=>editor.close(e=>e?no(e):yes())),new Promise<void>((yes,no)=>parent.close(e=>e?no(e):yes()))]);await rm(scratch,{recursive:true,force:true});}};
}
async function prepare(page:Page){
 await command(page,'configure',{mode:'author',elements:toRaw(scene)});
 await page.evaluate('window.__probe.messages=[]');
 const started=await command(page,'start');assert.ok(started.initial);return started.initial;
}
async function point(page:Page,frame:Frame,id:string,kind:'box'|'arrow'){
 const position=await frame.evaluate<{x:number;y:number}>(`(()=>{const t=window.__pnEditor,e=t.read().find(e=>e.id===${JSON.stringify(id)}),s=t.appState();const x=e.x+${kind==='box'?'20':'e.width/2'},y=e.y+${kind==='box'?'20':'e.height/2'};return{x:(x+s.scrollX)*s.zoom.value+s.offsetLeft,y:(y+s.scrollY)*s.zoom.value+s.offsetTop};})()`);
 const bounds=await page.locator('iframe').boundingBox();assert.ok(bounds);return{x:bounds.x+position.x,y:bounds.y+position.y};
}
async function finish(page:Page,initial:Recording['initial'],id:string){
 await command(page,'stop');const gestures=await page.evaluate('window.__probe.messages.filter(m=>m.type==="recorded").map(m=>m.gesture)') as RecordedGesture[];
 const recording=validateRecording({manifest:{schema:'practonaut.recording/1',id,createdAt:'2026-10-04T00:00:00Z',stoppedAt:'2026-10-04T00:00:01Z',appVersion:'0.18.1',adapterVersion:'1.0.0',coalescingVersion:'excalidraw-gesture-v1',author:'Own synthetic native input probe',license:'CC0-1.0',consent:'Self-created synthetic scene without personal data',demonstration:'scripted',status:gestures.some(g=>g.quarantined)?'quarantined':'review'},initial,gestures});
 for(const gesture of gestures)replayGesture(gesture);
 const actual=await command(page,'snapshot');assert.ok(actual.elements);
 assert.equal(canonicalJson(gestures.at(-1)?.after??initial),canonicalJson(snapshotElements(actual.elements)),'Stop preserves the actual final native scene, including a last pending input');
 return recording;
}
test('production native boundaries separate rapid step and arrow deletes without input pauses',{timeout:60000},async()=>{
 const f=await fixture();try{
  for(let repetition=0;repetition<8;repetition++){
   const initial=await prepare(f.page);await f.frame.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const step=await point(f.page,f.frame,'b','box'),arrow=await point(f.page,f.frame,'bc','arrow');
   // Consecutive genuine DOM inputs: no sleep, animation wait or gesture wait.
   await f.page.mouse.click(step.x,step.y);await f.page.keyboard.press('Delete');await f.page.mouse.click(arrow.x,arrow.y);await f.page.keyboard.press('Delete');
   const recording=await finish(f.page,initial,'rapid-'+repetition);
   const modeled=recording.gestures.filter(g=>g.events.length);assert.equal(modeled.length,2,JSON.stringify(modeled));
   const families=modeled.map(g=>{const before=projectSnapshot(g.before),after=projectSnapshot(g.after);assert.ok(before.ok&&after.ok);return observationAction(before.state,after.state);});assert.deepEqual(families,['delete_step','disconnect']);
   assert.ok(modeled.every(g=>!g.unmodeled.length&&!g.quarantined));
   const analysis=analyzeRecordings([recording]);assert.equal(analysis.hypotheses.find(h=>h.id==='delete-keeps-arrows-v1')!.status,'proposed');assert.equal(analysis.hypotheses.find(h=>h.id==='delete-removes-arrows-v1')!.refutingEvidence.length,1);assert.ok(analysis.hypotheses.some(h=>h.id==='disconnect-v1'));
  }
  assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});
test('production multi-selection Delete retains native snapshots but excludes single-action evidence',{timeout:30000},async()=>{
 const f=await fixture();try{
  const initial=await prepare(f.page);await f.frame.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const step=await point(f.page,f.frame,'b','box'),arrow=await point(f.page,f.frame,'bc','arrow');
  await f.page.mouse.click(step.x,step.y);await f.page.keyboard.down('Shift');await f.page.mouse.click(arrow.x,arrow.y);await f.page.keyboard.up('Shift');
  const selection=await f.frame.evaluate<Record<string,boolean>>('window.__pnEditor.appState().selectedElementIds');assert.ok(selection.b&&selection.bc,'real native selection must contain both roots');
  await f.page.keyboard.press('Delete');const recording=await finish(f.page,initial,'multiselect');
  const deleted=recording.gestures.find(g=>g.events.some(e=>e.kind==='set'&&e.id==='b'&&e.field==='isDeleted'&&e.after===true));assert.ok(deleted);assert.ok(deleted.events.some(e=>e.kind==='set'&&e.id==='bc'&&e.field==='isDeleted'&&e.after===true));
  assert.deepEqual(deleted.unmodeled.filter(change=>change.reason.startsWith('Native Delete')).map(change=>({id:change.id,attributes:change.attributes})).sort((a,b)=>a.id.localeCompare(b.id)),[{id:'b',attributes:[]},{id:'bc',attributes:[]}]);
  assert.equal(deleted.after.elements.b!.attributes.isDeleted,true);assert.equal(deleted.after.elements.bc!.attributes.isDeleted,true);assert.equal(deleted.quarantined,false);
  assert.deepEqual(analyzeRecordings([recording]).hypotheses,[]);assert.throws(()=>assertModeledSources([recording]),/evidence_unmodeled/);assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});
test('production held native arrow drag records one semantic gesture at 150ms and 300ms pauses',{timeout:60000},async()=>{
 const f=await fixture();try{
  for(const hold of [150,300]){
   const initial=await prepare(f.page);await f.frame.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   const middle=await point(f.page,f.frame,'ab','arrow');await f.page.mouse.click(middle.x,middle.y);
   const positions=await f.frame.evaluate<{end:{x:number;y:number};target:{x:number;y:number}}>(`(()=>{const t=window.__pnEditor,s=t.appState(),e=t.read().find(e=>e.id==='ab'),c=t.read().find(e=>e.id==='c'),p=e.points.at(-1);const screen=(x,y)=>({x:(x+s.scrollX)*s.zoom.value+s.offsetLeft,y:(y+s.scrollY)*s.zoom.value+s.offsetTop});return{end:screen(e.x+p[0],e.y+p[1]),target:screen(c.x,c.y+c.height/2)};})()`);
   const iframe=await f.page.locator('iframe').boundingBox();assert.ok(iframe);
   const end={x:iframe.x+positions.end.x,y:iframe.y+positions.end.y},target={x:iframe.x+positions.target.x,y:iframe.y+positions.target.y};
   await f.page.mouse.move(end.x,end.y);await f.page.mouse.down();
   const halfway={x:(end.x+target.x)/2,y:end.y+40};
   await f.page.mouse.move(halfway.x,halfway.y,{steps:8});await new Promise(resolve=>setTimeout(resolve,hold));
   assert.equal(await f.page.evaluate('window.__probe.messages.filter(m=>m.type==="recorded").length'),0,'quiet time may not split any semantic or excluded-only intermediate drag');
   await f.page.mouse.move(target.x,target.y,{steps:8});await new Promise(resolve=>setTimeout(resolve,150));
   await f.page.mouse.up();await f.page.waitForFunction('window.__probe.messages.some(m=>m.type==="recorded"&&m.gesture.boundary==="pointerup"&&m.gesture.events.length)');
   const recording=await finish(f.page,initial,'held-'+hold);
   assert.equal(recording.gestures.length,1,JSON.stringify(recording.gestures));
   const changes=recording.gestures.filter(g=>g.events.length);assert.equal(changes.length,1,JSON.stringify(changes));
   const g=changes[0]!;assert.deepEqual(g.unmodeled,[]);assert.equal(g.quarantined,false);assert.equal(g.boundary,'pointerup');
   const before=projectSnapshot(g.before),after=projectSnapshot(g.after);assert.ok(before.ok&&after.ok);assert.equal(observationAction(before.state,after.state),'reconnect_end');
   const arrow=after.state.objects.ab;assert.equal(arrow?.type,'arrow');if(arrow?.type==='arrow')assert.equal(arrow.to,'c');
  }
 }finally{await f.close();}
});
test('production camera preserves scene and recorder across desktop and minimum editor width',{timeout:30000},async()=>{
 const f=await fixture();try{
  const initial=await prepare(f.page),before=await command(f.page,'snapshot');
  for(const width of [1248,896]){
   await f.page.locator('iframe').evaluate((element,width)=>{element.style.width=width+'px';element.style.height='576px';},width);
   await f.frame.waitForFunction(`window.__pnEditor.appState().width===${width}&&window.__pnEditor.appState().height===576`);
   // Setup-only rendering wait: no native action or recording boundary is requested.
   await f.frame.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   const geometry=await f.frame.evaluate<Array<{id:string;left:number;top:number;right:number;bottom:number;zoom:number}>>(`(()=>{const t=window.__pnEditor,s=t.appState();return t.read().filter(e=>e.type==='rectangle'&&!e.isDeleted).map(e=>({id:e.id,left:(e.x+s.scrollX)*s.zoom.value,top:(e.y+s.scrollY)*s.zoom.value,right:(e.x+e.width+s.scrollX)*s.zoom.value,bottom:(e.y+e.height+s.scrollY)*s.zoom.value,zoom:s.zoom.value}));})()`);
   assert.equal(geometry.length,3);assert.ok(geometry.every(e=>e.left>=0&&e.right<=width&&e.top>=80&&e.bottom<=576&&e.zoom>=0.65),JSON.stringify(geometry));
   const heading=f.frame.locator('[id$="-frame-name-f"]');await heading.waitFor();const bounds=await heading.boundingBox();assert.ok(bounds);const iframe=await f.page.locator('iframe').boundingBox();assert.ok(iframe);assert.ok(bounds.x>=iframe.x&&bounds.y>=iframe.y&&bounds.x+bounds.width<=iframe.x+width,'native frame name is visible');
   assert.deepEqual((await command(f.page,'snapshot')).elements,before.elements,'camera fitting must not mutate native elements');
  }
  const recording=await finish(f.page,initial,'camera');assert.equal(recording.gestures.length,0,'resizing must not fabricate a gesture or reset recording');assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});
