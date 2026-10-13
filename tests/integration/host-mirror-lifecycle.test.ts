import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Browser, Page } from 'playwright-core';
import { createPracticeController } from '../../src/host/session.ts';
import { createProductionMirror } from '../../src/host/mirror.ts';
import type { PracticeMirror } from '../../src/host/mirror.ts';
import { Session } from '../../src/core/session.ts';
import { validateWorld } from '../../src/world/schema.ts';
import type { HostView } from '../../src/host/protocol.ts';
const world = () => validateWorld(JSON.parse(readFileSync(new URL('../../examples/worlds/flow-diagram/world.json', import.meta.url), 'utf8')));
const move = { name: 'move_step', params: { id: 'a', x: 200, y: 220 } };
const committed = (view: HostView) => ({ state: view.state, hash: view.hash, revision: view.revision, log: view.log, history: view.history });
async function pid(browser: Browser): Promise<number> {
 const cdp = await browser.newBrowserCDPSession();
 try { const reply = await cdp.send('SystemInfo.getProcessInfo'); return reply.processInfo.find(info => info.type === 'browser')!.id; } finally { await cdp.detach(); }
}
function alive(id: number): boolean { try { process.kill(id,0); return true; } catch { return false; } }
for (const fault of ['timeout','crash','terminate'] as const) test(`production mirror ${fault}: rollback, terminate/relaunch and checked continuation`,{timeout:30_000},async()=>{
 const browsers:Browser[]=[], pages:Page[]=[], pids:number[]=[];let mirror:PracticeMirror|undefined;
 const controller=await createPracticeController(world(),{taskId:'T3'},async state=>mirror=await createProductionMirror(state,{ready:async(browser,page)=>{browsers.push(browser);pages.push(page);pids.push(await pid(browser));}}));
 try {
  assert.equal((await controller.act({expectedRevision:0,action:move})).ok,true);
  const before=controller.view(), oracle=new Session(world(),0,'T3');oracle.act(move);
  assert.equal(before.hash,oracle.hash);
  if(fault==='timeout')await pages[0]!.evaluate('window.__pn.write = () => new Promise(() => {})');
  if(fault==='crash'){const cdp=await pages[0]!.context().newCDPSession(pages[0]!);const crashed=new Promise<void>(resolve=>pages[0]!.once('crash',()=>resolve()));void cdp.send('Page.crash').catch(()=>undefined);await crashed;}
  if(fault==='terminate')await browsers[0]!.close();
  const reply=await controller.act({expectedRevision:1,action:{name:'rename_step',params:{id:'a',label:'After fault'}}});assert.equal(reply.ok,false);if(!reply.ok)assert.equal(reply.error.code,fault==='timeout'?'mirror_timeout':'mirror_unavailable');
  assert.deepEqual(committed(controller.view()),committed(before));assert.deepEqual(await mirror!.snapshot(),before.state);
  assert.equal(pids.length,2);assert.notEqual(pids[0],pids[1]);assert.equal(alive(pids[0]!),false);assert.equal(alive(pids[1]!),true);
  assert.equal(controller.view().mirrorHealth.recoveries,1);assert.equal(controller.view().practiceEvidence,true);
  const next={name:'rename_step',params:{id:'a',label:'Recovered'}};assert.equal((await controller.act({expectedRevision:1,action:next})).ok,true);oracle.act(next);
  assert.equal(controller.view().hash,oracle.hash);assert.deepEqual(await mirror!.snapshot(),oracle.state);assert.equal(controller.view().revision,2);assert.equal(controller.view().log.length,2);assert.equal(controller.view().history.length,2);
  console.log(JSON.stringify({measurement:'production-mirror-lifecycle',fault,pids,rollbackHash:before.hash,continuedHash:oracle.hash}));
 } finally {await controller.close();for(const id of pids)assert.equal(alive(id),false);}
});
test('production close during a pending engine write is terminal and never relaunches',{timeout:15_000},async()=>{
 const pids:number[]=[];let page:Page|undefined,mirror:PracticeMirror|undefined;
 const controller=await createPracticeController(world(),{taskId:'T3'},async state=>mirror=await createProductionMirror(state,{ready:async(browser,current)=>{page=current;pids.push(await pid(browser));}}));
 const before=controller.view();
 await page!.evaluate('window.__pn.write = () => {window.__writeStarted=true; return new Promise(() => {})}');
 const pending=controller.act({expectedRevision:0,action:move});await page!.waitForFunction('window.__writeStarted === true');
 await controller.close();const reply=await pending;assert.equal(reply.ok,false);assert.deepEqual(committed(controller.view()),committed(before));assert.equal(pids.length,1);assert.equal(alive(pids[0]!),false);assert.equal(controller.view().mirrorHealth.status,'closed');assert.equal(controller.view().practiceEvidence,false);
 try { await assert.rejects(mirror!.recover(before.state));assert.equal(pids.length,1); } finally {await mirror!.close();}
 console.log(JSON.stringify({measurement:'production-close-race',pids,committed:false,relaunches:0}));
});
test('failed real-process relaunch removes practice evidence and checks remain fail-closed',{timeout:30_000},async()=>{
 let browser:Browser|undefined, launches=0;const pids:number[]=[];
 const controller=await createPracticeController(world(),{taskId:'T3'},state=>createProductionMirror(state,{ready:async(current)=>{browser=current;launches++;pids.push(await pid(current));if(launches>1)await current.close();}}));
 try {const before=controller.view();await browser!.close();assert.equal((await controller.act({expectedRevision:0,action:move})).ok,false);assert.deepEqual(committed(controller.view()),committed(before));assert.equal(launches,2);assert.equal(controller.view().mirrorHealth.status,'unavailable');assert.equal(controller.view().practiceEvidence,false);const check=await controller.check({expectedRevision:0});assert.equal(check.ok,false);if(!check.ok)assert.equal(check.error.code,'mirror_unavailable');for(const id of pids)assert.equal(alive(id),false);}
 finally {await controller.close();}
});
