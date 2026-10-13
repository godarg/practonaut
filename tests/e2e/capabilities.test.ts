import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startPlayer,CREATE_PROGRESS_STATES} from '../support/player-states.ts';
import {TAB_SESSION_KEY} from '../../src/player/tab-session.ts';
import {TOKEN_HEADER} from '../../src/host/protocol.ts';

test('practice-only cached resume retains practice and editor but never author access',{timeout:60_000},async()=>{
 const s=await startPlayer();
 try{
  const held=await s.page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!) as {token:string;authorToken?:string;sessionId:string;workspace:string},TAB_SESSION_KEY);
  assert.ok(held.authorToken);assert.equal(held.token!==held.authorToken,true,'the capabilities must be distinct');assert.equal(held.sessionId,(await s.observe()).sessionId);
  const reply=await(await fetch(s.host.origin+'/api/resume',{headers:{[TOKEN_HEADER]:s.host.token}})).json();
  assert.equal(reply.ok,true);assert.equal(reply.value.authorEnabled,false);assert.equal(Object.hasOwn(reply.value,'authorToken'),false);assert.equal(Object.hasOwn(reply.value,'token'),false);
  await s.page.evaluate(key=>{const value=JSON.parse(sessionStorage.getItem(key)!);delete value.authorToken;value.workspace='author';sessionStorage.setItem(key,JSON.stringify(value));},TAB_SESSION_KEY);
  let authorReads=0;s.page.on('request',r=>{if(new URL(r.url()).pathname==='/api/author')authorReads++;});
  await s.page.reload();await s.page.getByTestId('board').waitFor();assert.equal(await s.page.getByTestId('mode-author').isDisabled(),true,'Create is shown on every route but never opens without author access');
  await s.page.getByTestId('mode-editor').click();await s.page.waitForFunction(()=>document.body.dataset.workspace==='editor');assert.equal(authorReads,0);
  await s.page.getByTestId('mode-board').click();const hinted=s.page.waitForResponse(response=>response.url().endsWith('/api/hint'));await s.page.getByTestId('hint').click();assert.equal((await hinted).status(),200);assert.equal((await s.observe()).hintsOpened,1);
  assert.equal(await s.page.evaluate(key=>Object.hasOwn(JSON.parse(sessionStorage.getItem(key)!),'authorToken'),TAB_SESSION_KEY),false);
 }finally{await s.close();}
});

test('mismatched author resume host instance clears both credentials fail closed',{timeout:30_000},async()=>{
 const s=await startPlayer();
 try{
  const heldAuthor=await s.page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).authorToken as string,TAB_SESSION_KEY);
  await s.page.route('**/api/resume',async route=>{const response=await route.fetch(),reply=await response.json();if(route.request().headers()['x-practonaut-token']===heldAuthor){reply.value.view.sessionId='22222222-2222-4222-8222-222222222222';}await route.fulfill({response,json:reply});});
  await s.page.reload();await s.page.locator('.shell-message--danger').waitFor();assert.equal(await s.page.getByTestId('board').count(),0);
  assert.equal(await s.page.evaluate(key=>sessionStorage.getItem(key),TAB_SESSION_KEY),null);
 }finally{await s.close();}
});

test('actual author_required refusal preserves the legitimate held cache and practice',{timeout:60_000},async()=>{
 const s=await startPlayer();
 try{
  const before=await s.page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!) as {token:string;authorToken:string;sessionId:string},TAB_SESSION_KEY);
  await CREATE_PROGRESS_STATES.find(state=>state.id==='create-author-required')!.enter(s);
  const after=await s.page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!) as {token:string;authorToken:string;sessionId:string},TAB_SESSION_KEY);
  assert.equal(after.token===before.token&&after.authorToken===before.authorToken&&after.sessionId===before.sessionId,true,'held credentials and host binding are unchanged');
  assert.match(await s.page.getByTestId('recovery-status').innerText(),/author access|Autorenzugriff/);
  await s.page.getByTestId('mode-board').click();const hinted=s.page.waitForResponse(response=>response.url().endsWith('/api/hint'));await s.page.getByTestId('hint').click();assert.equal((await hinted).status(),200);assert.equal((await s.observe()).hintsOpened,1);
  assert.equal(await s.page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).schema,TAB_SESSION_KEY),'practonaut.tab-session/2');
 }finally{await s.close();}
});

test('opening an authored exercise creates a noopener practice-only child without author cache',{timeout:120_000},async()=>{
 const s=await startPlayer();
 try{
  await CREATE_PROGRESS_STATES.find(state=>state.id==='create-finish')!.enter(s);
  const opened=s.context.waitForEvent('page');await s.page.getByTestId('recovery-launch').click();const child=await opened;
  await child.getByTestId('board').waitFor();assert.equal(await child.evaluate(()=>opener===null),true);
  const cache=await child.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!) as Record<string,unknown>,TAB_SESSION_KEY);
  assert.equal(cache.schema,'practonaut.tab-session/2');assert.equal(Object.hasOwn(cache,'authorToken'),false);assert.equal(await child.getByTestId('mode-author').isDisabled(),true);
  const frame=await(await s.page.getByTestId('real-editor').elementHandle())!.contentFrame();assert.ok(frame);
  assert.equal(await frame.evaluate(key=>sessionStorage.getItem(key),TAB_SESSION_KEY),null);
  await child.close();
 }finally{await s.close();}
});
