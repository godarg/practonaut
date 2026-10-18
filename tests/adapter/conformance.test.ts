import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Browser } from 'playwright-core';
import { stateHash } from '../../src/canonical/index.ts';
import { renderCheck } from '../../src/adapters/excalidraw/index.ts';
import { EXCALIDRAW_APP, resolveAdapter } from '../../src/adapters/registry.ts';
import type { Action, State } from '../../src/world/types.ts';
export const base: State = { objects: {
  f:{id:'f',type:'frame',deleted:false,name:'Flow'},
  a:{id:'a',type:'step',deleted:false,frameId:'f',label:'Receive request',x:300,y:300,width:180,height:100,fontFamily:3},
  b:{id:'b',type:'step',deleted:false,frameId:'f',label:'Check payment',x:650,y:300,width:180,height:100,fontFamily:3},
  c:{id:'c',type:'step',deleted:false,frameId:'f',label:'Dispatch',x:1050,y:300,width:180,height:100,fontFamily:3},
  ab:{id:'ab',type:'arrow',deleted:false,frameId:'f',from:'a',to:'b'},
  bc:{id:'bc',type:'arrow',deleted:false,frameId:'f',from:'b',to:'c'}
} };
const evidence: Array<{ repetition:number; case:string; state:State; hash:string; render?:Awaited<ReturnType<typeof renderCheck>> }> = [];
test('all seven actions and rule effects conform 3 times to the real pinned engine', { timeout: 120000 }, async () => {
  for (let repetition = 1; repetition <= 3; repetition++) {
    const adapter = await resolveAdapter(EXCALIDRAW_APP, 'practonaut.world/1').create(base);
    try {
      await mkdir('.local/adapter',{recursive:true});
      let before = structuredClone(base);
      const transition = async (action: Action, mutate: (after:State) => void) => {
        const after = structuredClone(before); mutate(after);
        const result = await adapter.apply({ before, after, action });
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.deepEqual(await adapter.snapshot(), after);
        const render = await renderCheck(await adapter.exportArtifact(), repetition === 1 && action.name === 'connect' ? '.local/adapter/reference.png' : undefined);
        assert.equal(render.ok, true, JSON.stringify(render));
        evidence.push({ repetition, case: action.name === 'reconnect_end' ? `${action.name}-${action.params.end === 'start' ? 'start-' : ''}${action.params.target}` : action.name, state: after, hash: stateHash(after), render });
        before = after;
      };
      await transition({name:'add_step',params:{frameId:'f',label:'Confirm',x:850,y:500,width:180,height:100,fontFamily:3}}, after => { after.objects.n = {id:'n',type:'step',deleted:false,frameId:'f',label:'Confirm',x:850,y:500,width:180,height:100,fontFamily:3}; });
      await transition({name:'rename_step',params:{id:'n',label:'Check inventory'}}, after => { const n = after.objects.n; if(n?.type==='step') n.label='Check inventory'; });
      await transition({name:'move_step',params:{id:'n',x:850,y:450}}, after => { const n=after.objects.n; if(n?.type==='step') { n.x=850;n.y=450; } });
      await transition({name:'connect',params:{frameId:'f',from:'n',to:'c'}}, after => { after.objects.nc={id:'nc',type:'arrow',deleted:false,frameId:'f',from:'n',to:'c'}; });
      await transition({name:'reconnect_end',params:{id:'bc',end:'end',target:'n'}}, after => { const bc=after.objects.bc; if(bc?.type==='arrow') bc.to='n'; });
      await transition({name:'reconnect_end',params:{id:'bc',end:'start',target:'a'}}, after => { const bc=after.objects.bc; if(bc?.type==='arrow') bc.from='a'; });
      await transition({name:'reconnect_end',params:{id:'bc',end:'start',target:'b'}}, after => { const bc=after.objects.bc; if(bc?.type==='arrow') bc.from='b'; });
      await transition({name:'disconnect',params:{id:'nc'}}, after => { const nc=after.objects.nc; if(nc?.type==='arrow') { nc.deleted=true;nc.from=null;nc.to=null; } });
      await transition({name:'reconnect_end',params:{id:'bc',end:'end',target:'c'}}, after => { const bc=after.objects.bc;if(bc?.type==='arrow') bc.to='c'; });
      await transition({name:'delete_step',params:{id:'n'}}, after => { after.objects.n!.deleted=true; });
      assert.deepEqual(adapter.networkAttempts(),[]);
      const artifact=await adapter.exportArtifact(); assert.match(artifact.svg,/data:font/);
      const imported=await adapter.importArtifact(artifact.native);assert.equal(imported.ok,true,JSON.stringify(imported));
      assert.deepEqual(await adapter.snapshot(), before);
      // Genuine UI mistake, never a JSON mutation: deletion leaves a live arrow with a null end.
      const deletion = await adapter.deleteStepViaUI('b'); assert.equal(deletion.ok,true,JSON.stringify(deletion));
      const deleted=await adapter.snapshot(); assert.equal(deleted.objects.b!.deleted,true);
      const ab=deleted.objects.ab,bc=deleted.objects.bc;
      assert.equal(ab?.type==='arrow' ? ab.to : 'wrong',null); assert.equal(bc?.type==='arrow' ? bc.from : 'wrong',null);
      const brokenExport=await adapter.exportArtifact(), render=await renderCheck(brokenExport); assert.equal(render.ok,false);
      evidence.push({repetition,case:'real-ui-delete-loose-arrow',state:deleted,hash:stateHash(deleted),render});
      await mkdir('.local/adapter',{recursive:true});
      await writeFile(`.local/adapter/loose-${repetition}.excalidraw`,brokenExport.native);
      await writeFile(`.local/adapter/loose-${repetition}.svg`,brokenExport.svg);
    } finally { await adapter.close(); }
    // Production capability path: updateScene-only deletion must detach both incident arrows,
    // independently of the separate UI-Delete measurement above.
    const apiDeleteAdapter=await resolveAdapter(EXCALIDRAW_APP,'practonaut.world/1').create(base);
    try {
      const after=structuredClone(base);after.objects.b!.deleted=true;
      const ab=after.objects.ab,bc=after.objects.bc;
      if(ab?.type==='arrow')ab.to=null;if(bc?.type==='arrow')bc.from=null;
      const deletion=await apiDeleteAdapter.apply({before:base,after,action:{name:'delete_step',params:{id:'b'}}});
      assert.equal(deletion.ok,true,JSON.stringify(deletion));
      const readback=await apiDeleteAdapter.snapshot();assert.deepEqual(readback,after);
      const exported=await apiDeleteAdapter.exportArtifact(),render=await renderCheck(exported);
      assert.equal(render.ok,false);
      assert.equal(render.arrows.filter(arrow=>!arrow.ok&&arrow.gap===null).length,2);
      assert.deepEqual(apiDeleteAdapter.networkAttempts(),[]);
      evidence.push({repetition,case:'real-api-delete-loose-arrow',state:readback,hash:stateHash(readback),render});
      await writeFile(`.local/adapter/api-loose-${repetition}.excalidraw`,exported.native);
      await writeFile(`.local/adapter/api-loose-${repetition}.svg`,exported.svg);
    } finally {await apiDeleteAdapter.close();}
  }
  const cases=new Set(evidence.map(e=>e.case));
  for (const name of cases) { const runs=evidence.filter(e=>e.case===name); assert.equal(new Set(runs.map(e=>e.hash)).size,1,`${name} differs across repetitions`); }
  await writeFile('.local/adapter/conformance.json',JSON.stringify({app:'@excalidraw/excalidraw@0.18.1',react:'18.3.1',adapter:'1.0.0',networkAttempts:0,runs:evidence},null,2)+'\n');
});
test('wrong prediction, invalid binding, unmodeled action, timeout and cancellation reject atomically', {timeout:30000}, async()=>{
  let browser:Browser|undefined;
  const adapter=await resolveAdapter(EXCALIDRAW_APP,'practonaut.world/1').create(base,{}, {ready:current=>{browser=current;}});
  const currentPage=()=>browser!.contexts()[0]!.pages()[0]!;
  // Suspend the real process response after a genuine write, rather than assuming
  // that a fast successful action must still be running after an arbitrary 1–5 ms.
  const suspendWrite=async()=>{
    const page=currentPage();
    await page.evaluate('window.__originalWrite=window.__pn.write.bind(window.__pn);window.__pn.write=async els=>{await window.__originalWrite(els);window.__writeStarted=true;return new Promise(()=>{})}');
    return page;
  };
  try {
    const after=structuredClone(base); const a=after.objects.a;if(a?.type==='step') a.x=301;
    const wrong=await adapter.apply({before:base,after,action:{name:'move_step',params:{id:'a',x:302,y:300}}});assert.equal(wrong.ok,false); if(!wrong.ok)assert.equal(wrong.error.code,'real_tool_disagrees');
    assert.deepEqual(await adapter.snapshot(),base);
    const invalid=structuredClone(base); const ab=invalid.objects.ab;if(ab?.type==='arrow') ab.to='missing';
    assert.equal((await adapter.apply({before:base,after:invalid,action:{name:'reconnect_end',params:{id:'ab',end:'end',target:'missing'}}})).ok,false);
    const unknown=await adapter.apply({before:base,after:base,action:{name:'paint',params:{}}});assert.equal(unknown.ok,false);if(!unknown.ok)assert.equal(unknown.error.code,'unmodeled');
    const validAction:Action={name:'move_step',params:{id:'a',x:301,y:300}};
    const timeoutPage=await suspendWrite();
    const timeoutPending=adapter.apply({before:base,after,action:validAction},{timeoutMs:1000});
    await timeoutPage.waitForFunction('window.__writeStarted===true');
    const timeout=await timeoutPending;assert.equal(timeout.ok,false);if(!timeout.ok)assert.equal(timeout.error.code,'mirror_timeout');
    assert.deepEqual(await adapter.snapshot(),base);
    const cancellationPage=await suspendWrite();
    const controller=new AbortController();const pending=adapter.apply({before:base,after,action:validAction},{signal:controller.signal});
    await cancellationPage.waitForFunction('window.__writeStarted===true');controller.abort();
    const cancelled=await pending;assert.equal(cancelled.ok,false);if(!cancelled.ok)assert.equal(cancelled.error.code,'cancelled');
    assert.deepEqual(await adapter.snapshot(),base);assert.deepEqual(adapter.networkAttempts(),[]);
    await assert.rejects(adapter.exportArtifact({signal:controller.signal}), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'cancelled');
    const exportPage=currentPage();
    await exportPage.evaluate('window.__pn.svg=()=>{window.__exportStarted=true;return new Promise(()=>{})}');
    const exportPending=adapter.exportArtifact({timeoutMs:1000});
    const rejectedExport=assert.rejects(exportPending, error => !!error && typeof error === 'object' && 'code' in error && error.code === 'mirror_timeout');
    await exportPage.waitForFunction('window.__exportStarted===true');await rejectedExport;
    assert.deepEqual(await adapter.snapshot(),base);
    const continued=await adapter.apply({before:base,after,action:validAction});assert.equal(continued.ok,true,JSON.stringify(continued));
    assert.deepEqual(await adapter.snapshot(),after);
    const restored=await adapter.restoreState(base);assert.equal(restored.ok,true,JSON.stringify(restored));
    const native=(await adapter.exportArtifact()).native;
    for (const mutate of [(raw: {elements: Array<Record<string, unknown>>})=>{raw.elements[0]!.type='embeddable';},(raw:{elements:Array<Record<string,unknown>>})=>{raw.elements[0]!.link='https://example.invalid';},(raw:{elements:Array<Record<string,unknown>>})=>{raw.elements.push(raw.elements[0]!);}]) {
      const data=JSON.parse(native) as {elements:Array<Record<string,unknown>>};mutate(data);
      assert.equal((await adapter.importArtifact(JSON.stringify(data))).ok,false);assert.deepEqual(await adapter.snapshot(),base);
    }
    assert.equal((await adapter.importArtifact('{"type":"excalidraw","elements":'+ '['.repeat(70)+'0'+']'.repeat(70)+'}')).ok,false);
    assert.deepEqual(await adapter.snapshot(),base);
  } finally {await adapter.close();}
});
test('SVG words shared by different labels are associated by native group geometry', {timeout:30000}, async()=>{
  const state=structuredClone(base);
  for(const [id,label] of [['a','Anfrage annehmen'],['b','Anfrage freigeben'],['c','Anfrage ablegen']] as const) {
    const step=state.objects[id];if(step?.type==='step')step.label=label;
  }
  const adapter=await resolveAdapter(EXCALIDRAW_APP,'practonaut.world/1').create(state);
  try {
    const artifact=await adapter.exportArtifact(), report=await renderCheck(artifact);
    assert.equal(report.ok,true,JSON.stringify(report));
    assert.equal(report.labels.filter(label=>label.text==='Anfrage').length,3);
    // The same repeated word still has to fit its own box. A displaced SVG group must fail.
    const translated=artifact.svg.replace(/(transform="translate\()([-\d.]+)( [-\d.]+\) rotate\(0 [^\"]*\)"><text x="[\d.]+" y="[\d.]+" font-family="Cascadia)/,
      (_match,prefix:string,x:string,suffix:string)=>prefix+String(Number(x)+190)+suffix);
    assert.notEqual(translated,artifact.svg);
    assert.equal((await renderCheck({...artifact,svg:translated})).ok,false);
  } finally {await adapter.close();}
});
test('source adapter finds its engine relative to its module, independent of caller cwd', {timeout:30000},async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');
  const {resolve}=await import('node:path');const {spawnSync}=await import('node:child_process');
  const scratch=await mkdtemp(resolve(tmpdir(),'practonaut-adapter-cwd-'));
  try {
    await mkdir(resolve(scratch,'.local/engine'),{recursive:true});
    await writeFile(resolve(scratch,'.local/engine/engine.js'),'throw new Error("cwd engine must never be read")');
    const moduleURL=new URL('../../src/adapters/registry.ts',import.meta.url).href;
    const script=`import{EXCALIDRAW_APP,resolveAdapter}from${JSON.stringify(moduleURL)};const adapter=await resolveAdapter(EXCALIDRAW_APP,'practonaut.world/1').create(${JSON.stringify(base)});try{console.log(JSON.stringify(await adapter.snapshot()))}finally{await adapter.close()}`;
    const run=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:scratch,encoding:'utf8',timeout:20000});
    assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),base);
  }finally{await rm(scratch,{recursive:true,force:true});}
});
