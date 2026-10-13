import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPlayer, CREATE_PROGRESS_STATES, PLAYER_STATES,setLanguage,setTheme } from '../support/player-states.ts';
import { fixture } from './harness.ts';

test('rendered board labels stay at least 12px across window widths', { timeout: 120_000 }, async () => {
  const s = await startPlayer();
  try {
    for (const width of [320,390,640,768,1024,1152,1200,1280,1440]) {
      await s.page.setViewportSize({width,height:900});
      await s.page.waitForTimeout(60);
      const sizes = await s.page.locator('.board-svg text').evaluateAll(nodes => nodes.map(node => {
        const element = node as SVGTextElement, matrix = element.getScreenCTM()!;
        return {text:element.textContent,size:parseFloat(getComputedStyle(element).fontSize)*Math.hypot(matrix.a,matrix.b)};
      }));
      assert.ok(sizes.every(item => item.size >= 12), JSON.stringify({width,sizes}));
    }
  } finally { await s.close(); }
});

test('Create fields focused by keyboard are not covered by the action footer', { timeout: 120_000 }, async () => {
  const s = await startPlayer();
  try {
    await [...PLAYER_STATES,...CREATE_PROGRESS_STATES].find(state => state.id==='create-initial')!.enter(s);
    for (const size of [{width:1280,height:900},{width:390,height:844},{width:640,height:450}]) {
      await s.page.setViewportSize(size);
      await s.page.locator('[data-stage=plan]>summary').focus();
      const obscured: string[]=[];
      for (let n=0;n<9;n++) {
        await s.page.keyboard.press('Tab');
        const covered = await s.page.evaluate(() => {
          const element=document.activeElement as HTMLElement;
          if (!element?.matches('input,select,textarea,button')) return null;
          const r=element.getBoundingClientRect();
          const points=[.2,.5,.8].flatMap(x=>[.2,.5,.8].map(y=>[r.x+r.width*x,r.y+r.height*y]));
          const visible=points.filter(([x,y])=>y!>=0&&y!<innerHeight&&x!>=0&&x!<innerWidth);
          return visible.length>0&&visible.every(([x,y])=>!element.contains(document.elementFromPoint(x!,y!))) ? element.dataset.testid??element.id : null;
        });
        if(covered) obscured.push(covered);
      }
      assert.deepEqual(obscured,[],JSON.stringify(size));
    }
  } finally { await s.close(); }
});

test('clean event-stream EOF reconnects and observes the current host state', { timeout: 60_000 }, async () => {
  const f=await fixture();
  try {
    await f.page.addInitScript(() => {
      const original=window.fetch.bind(window); let streams=0;
      window.fetch=async (input,init) => {
        if(String(input)!=='/api/events'||++streams!==1) return original(input,init);
        const response=await original(input,init), reader=response.body!.getReader();
        return new Response(new ReadableStream({async start(controller){const first=await reader.read();if(first.value)controller.enqueue(first.value);await reader.cancel();controller.close();}}), {status:200,headers:{'Content-Type':'text/event-stream'}});
      };
    });
    await f.page.reload(); await f.page.getByTestId('board').waitFor();
    const reply=await fetch(f.host.origin+'/api/act',{method:'POST',headers:{'X-Practonaut-Token':f.host.token,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:0,action:{name:'rename_step',params:{id:'a',label:'After clean EOF'},baseStep:0}})});
    const value=await reply.json();assert.equal(value.ok,true,JSON.stringify(value));
    await f.page.locator('.step-label').filter({hasText:'After clean EOF'}).waitFor({timeout:8_000});
  } finally { await f.close(); }
});

test('page lifetime cancels a held event resync and restores a subscription on pageshow',{timeout:30_000},async()=>{
  const f=await fixture();
  try{
    await f.page.addInitScript(()=>{
      const original=window.fetch.bind(window);
      const metrics={streams:0,observations:0,aborted:0};Object.assign(window,{practonautLifetime:metrics});
      window.fetch=async(input,init)=>{
        if(String(input)==='/api/observe'){
          metrics.observations++;
          return await new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>{metrics.aborted++;reject(new DOMException('Aborted','AbortError'));},{once:true}));
        }
        const response=await original(input,init);
        if(String(input)!=='/api/events')return response;
        metrics.streams++;
        if(metrics.streams!==1)return response;
        const reader=response.body!.getReader();
        return new Response(new ReadableStream({async start(controller){const first=await reader.read();if(first.value)controller.enqueue(first.value);await reader.cancel();controller.close();}}),{status:200,headers:{'Content-Type':'text/event-stream'}});
      };
    });
    await f.page.reload();await f.page.waitForFunction(()=>Boolean((window as unknown as {practonautLifetime:{observations:number}}).practonautLifetime?.observations));
    await f.page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await f.page.waitForFunction(()=>(window as unknown as {practonautLifetime:{aborted:number}}).practonautLifetime.aborted===1,undefined,{timeout:3_000});
    await f.page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    await f.page.waitForFunction(()=>(window as unknown as {practonautLifetime:{streams:number}}).practonautLifetime.streams===2);
    await f.page.getByTestId('stream-recovering').waitFor({state:'hidden'});
  }finally{await f.close();}
});

test('review states which occur below the page top declare viewport anchors', () => {
  for(const id of ['practice-hint','check-fail','check-pass','check-stale','create-editor-error','create-editor-loading','create-review','create-analyzed-first','create-confirm','create-evidence-partial','create-goal','create-goal-dirty','create-advanced']){
    assert.ok([...PLAYER_STATES,...CREATE_PROGRESS_STATES].find(state=>state.id===id)?.view,id);
  }
});

test('saved-project confirmation is reached after every theme and language change',{timeout:60_000},async()=>{
  const s=await startPlayer();
  try{
    const state=CREATE_PROGRESS_STATES.find(state=>state.id==='create-saved-delete')!;
    for(const theme of ['light','dark'] as const)for(const language of ['en','de'] as const){
      await setTheme(s.page,theme);await setLanguage(s.page,language);await state.enter(s);
      assert.equal(await s.page.getByTestId('project-delete-dialog').evaluateAll(nodes=>nodes.length===1&&(nodes[0] as HTMLDialogElement).open),true,`${theme}/${language}`);
      assert.equal(await s.page.getByTestId('project-delete-cancel').evaluate(element=>document.activeElement===element),true,'the safe cancel action has focus');
    }
  }finally{await s.close();}
});

test('leaving the declared reconnecting state releases its fault before Create',{timeout:30_000},async()=>{
  const s=await startPlayer();
  try{
    await PLAYER_STATES.find(state=>state.id==='practice-reconnecting')!.enter(s);
    assert.equal(await s.page.getByTestId('stream-recovering').count(),1);
    await PLAYER_STATES.find(state=>state.id==='create-initial')!.enter(s);
    assert.equal(await s.page.getByTestId('stream-recovering').count(),0);
    assert.equal(await s.page.getByTestId('recovery-title').count(),1);
  }finally{await s.close();}
});

test('stale writes observe the new state without replaying the rejected action', {timeout:60_000},async()=>{
  const f=await fixture();
  try{
    let writes=0,reads=0;
    f.page.on('request',request=>{if(request.url().endsWith('/api/observe'))reads++;});
    await f.page.route('**/api/act',async route=>{
      writes++;
      if(writes===1){
        const response=await fetch(f.host.origin+'/api/act',{method:'POST',headers:{'X-Practonaut-Token':f.host.token,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:0,action:{name:'rename_step',params:{id:'a',label:'Changed elsewhere'},baseStep:0}})});
        assert.equal((await response.json()).ok,true);
      }
      await route.continue();
    });
    await f.page.locator('[data-object-id="a"]').first().click();
    await f.page.getByTestId('action-rename').click();
    await f.page.getByTestId('input-label').fill('Rejected local label');
    const before=reads;
    await f.page.getByTestId('action-submit').click();
    await f.page.locator('.notice.error').filter({hasText:/changed|inzwischen/i}).waitFor(); // the rejection, not the What-this-changed banner of the earlier action
    assert.ok(reads>before,'a stale reply must fetch the authoritative observation');
    assert.equal(writes,1,'the rejected mutation must not be replayed');
    const view=await f.observe();assert.equal(view.step,1);assert.equal((view.state.objects.a as {label:string}).label,'Changed elsewhere');
    await f.page.waitForFunction(()=>document.querySelector('[data-object-id="a"]')?.getAttribute('aria-label')?.includes('Changed elsewhere'));
  }finally{await f.close();}
});

test('forced colours keep the system contrast on selected controls',async()=>{
  const s=await startPlayer();
  try{
    await s.page.emulateMedia({forcedColors:'active'});
    await s.page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const actual=await s.page.getByTestId('mode-board').evaluate(element=>{
      const reference=document.createElement('span');reference.style.cssText='background:Highlight;color:HighlightText;forced-color-adjust:none';document.body.append(reference);
      const selected=getComputedStyle(element),system=getComputedStyle(reference);
      const result={background:selected.backgroundColor,color:selected.color,expectedBackground:system.backgroundColor,expectedColor:system.color};reference.remove();return result;
    });
    assert.equal(actual.background,actual.expectedBackground);assert.equal(actual.color,actual.expectedColor);
  }finally{await s.close();}
});

test('failed editor transition focuses a visible retry action',{timeout:60_000},async()=>{
  const s=await startPlayer();
  try{
    await CREATE_PROGRESS_STATES.find(state=>state.id==='create-editor-error')!.enter(s);
    const result=await s.page.getByTestId('engine-retry').evaluate(element=>{
      const r=element.getBoundingClientRect();return{focused:document.activeElement===element,visible:r.top>=0&&r.bottom<=innerHeight};
    });
    assert.deepEqual(result,{focused:true,visible:true});
  }finally{await s.close();}
});

test('German technical details remain clickable below the sticky editor',{timeout:120_000},async()=>{
  const s=await startPlayer();
  try{
    await setLanguage(s.page,'de');
    await CREATE_PROGRESS_STATES.find(state=>state.id==='create-advanced')!.enter(s);
    assert.equal(await s.page.getByTestId('author-advanced').evaluate(element=>(element as HTMLDetailsElement).open),true);
  }finally{await s.close();}
});


test('failed project deletion is reached after the preceding sheet was dismissed',{timeout:60_000},async()=>{
 const s=await startPlayer();
 try{
  await CREATE_PROGRESS_STATES.find(state=>state.id==='create-saved-delete')!.enter(s);
  await s.page.keyboard.press('Escape');
  await CREATE_PROGRESS_STATES.find(state=>state.id==='create-saved-delete-error')!.enter(s);
  assert.equal(await s.page.getByTestId('project-delete-error').count(),1);
  assert.equal(await s.page.getByTestId('project-delete-dialog').evaluate(element=>(element as HTMLDialogElement).open),true);
  for(const language of ['de','en'] as const){await setLanguage(s.page,language);await CREATE_PROGRESS_STATES.find(state=>state.id==='create-saved-delete-error')!.enter(s);assert.equal(await s.page.getByTestId('project-delete-error').count(),1);}
 }finally{await s.close();}
});
