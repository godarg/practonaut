import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixture} from './harness.ts';
import {PLAYER_STATES,startPlayer,setLanguage,setTheme} from '../support/player-states.ts';
import type {CurrentSessionExport} from '../../src/host/export-pair.ts';

test('current-session UI downloads both opaque files from one revision-bound envelope',{timeout:60_000},async()=>{
 const f=await fixture();
 try{
  assert.equal(await f.page.getByTestId('export-prepare').count(),1,'the actual player must expose current-session export');
  await f.page.locator('[data-object-id="a"]').first().click();await f.page.getByTestId('action-rename').click();await f.page.getByTestId('input-label').fill('Gruß 🚀');
  const renamed=f.page.waitForResponse(r=>r.url().endsWith('/api/act'));await f.page.getByTestId('action-submit').click();assert.equal((await(await renamed).json()).ok,true);
  await f.page.evaluate(()=>{
   const original=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),counts={created:0,revoked:0,types:[] as string[]};Object.assign(window,{practonautDownloads:counts});
   URL.createObjectURL=value=>{counts.created++;if(value instanceof Blob)counts.types.push(value.type);return original(value);};URL.revokeObjectURL=url=>{counts.revoked++;revoke(url);};
  });
  const response=f.page.waitForResponse(r=>r.url().endsWith('/api/export'));let envelopes=0;f.page.on('request',r=>{if(r.url().endsWith('/api/export'))envelopes++;});
  await f.page.getByTestId('export-prepare').click();const reply=await(await response).json();assert.equal(reply.ok,true,JSON.stringify(reply));const envelope=reply.value as CurrentSessionExport;
  await f.page.getByTestId('export-ready').waitFor();
  for(const [id,artifact]of [['export-session',envelope.session],['export-native',envelope.native]] as const){
   const downloading=f.page.waitForEvent('download');await f.page.getByTestId(id).click();const download=await downloading;
   assert.equal(download.suggestedFilename(),artifact.file);const path=await download.path();assert.ok(path);const bytes=await readFile(path);
   assert.equal(bytes.toString('utf8'),artifact.utf8);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);
   assert.equal(bytes.includes(Buffer.from(f.host.token)),false);
   assert.equal(artifact.utf8.includes('Gruß 🚀'),true,'opaque UTF-8 retains non-ASCII and astral labels');
  }
  await f.page.waitForFunction(()=>(window as unknown as {practonautDownloads:{created:number;revoked:number}}).practonautDownloads.revoked===2);
  assert.deepEqual(await f.page.evaluate(()=>(window as unknown as {practonautDownloads:{created:number;types:string[]}}).practonautDownloads),{created:2,revoked:2,types:['application/json','application/vnd.excalidraw+json']});
  assert.equal(envelopes,1,'two explicit downloads must use one cached envelope');const manifest=JSON.parse(envelope.session.utf8);
  assert.equal(manifest.revision,envelope.revision);assert.equal(manifest.hash,envelope.hash);assert.equal(manifest.nativeSha256,envelope.native.sha256);
  assert.deepEqual(manifest.world,manifest.session.world);assert.equal(manifest.seed,manifest.session.seed);assert.equal(manifest.taskId,manifest.session.taskId);
  const before=await f.observe();await f.page.getByTestId('hint').click();await f.page.getByTestId('export-stale').waitFor();
  assert.equal(await f.page.getByTestId('export-session').isDisabled(),true);assert.equal(await f.page.getByTestId('export-native').isDisabled(),true);assert.equal(envelopes,1);
  assert.equal((await f.observe()).revision,before.revision+1);
 }finally{await f.close();}
});

test('a changed native byte string with its unchanged digest cannot become a download',{timeout:30_000},async()=>{
 const f=await fixture();
 try{
  await f.page.route('**/api/export',async route=>{const response=await route.fetch(),reply=await response.json();assert.equal(reply.ok,true);reply.value.native.utf8+=' ';await route.fulfill({response,json:reply});});
  await f.page.getByTestId('export-prepare').click();await f.page.getByTestId('export-error').waitFor();
  assert.match(await f.page.getByTestId('export-error').innerText(),/confirmed bytes|bestätigten Bytes/);assert.equal(await f.page.getByTestId('export-native').count(),0);assert.equal(await f.page.getByTestId('export-session').count(),0);
 }finally{await f.close();}
});

test('model-only session clearly refuses the native/session export pair',{timeout:30_000},async()=>{
 const f=await fixture({mirror:'off'});
 try{assert.equal(await f.page.getByTestId('export-prepare').isDisabled(),true);assert.equal(await f.page.getByTestId('export-model-only').count(),1);assert.equal(await f.page.getByTestId('export-native').count(),0);}
 finally{await f.close();}
});


test('held export capture response finishes before the next real state is entered',{timeout:60_000},async()=>{
 const s=await startPlayer();
 try{for(const theme of ['light','dark'] as const)for(const language of ['en','de'] as const){
  await setTheme(s.page,theme);await setLanguage(s.page,language);
  await PLAYER_STATES.find(state=>state.id==='practice-export-loading')!.enter(s);assert.equal(await s.page.getByTestId('export-loading').count(),1);
  await PLAYER_STATES.find(state=>state.id==='practice-export-ready')!.enter(s);assert.equal(await s.page.getByTestId('export-ready').count(),1);assert.equal(await s.page.getByTestId('export-loading').count(),0);
 }}finally{await s.close();}
});
