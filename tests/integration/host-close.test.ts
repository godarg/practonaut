import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Server } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost, HostError } from '../../src/host/server.ts';
import { validateWorld } from '../../src/world/index.ts';
import { createPracticeSession } from '../../src/host/session.ts';

async function fixture(close: 'hang' | 'reject' | 'normal', rejectServer = false) {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-close-')); const assets = join(dir,'player'); await mkdir(assets);
  for (const name of ['index.html','player.js','player.css','tokens.css']) await writeFile(join(assets,name),'/* fixture */');
  const world = validateWorld(JSON.parse(await readFile('tests/fixtures/core/world.json','utf8')));
  let calls = 0;
  const host = await startHost(world,{mirror:'off',assetDirectory:assets,tokenDirectory:join(dir,'tokens'),controllerFactory:async(w,o) => {
    const controller = await createPracticeSession(w,o);
    return {...controller, close:async() => { calls++; if (close === 'hang') return new Promise<void>(()=>{}); if(close==='reject')throw new Error('Untrusted controller failure'); await controller.close(); }};
  }});
  const original = Server.prototype.close;
  if (rejectServer) Server.prototype.close = function(this: Server, callback?: (error?: Error)=>void) {
    return original.call(this, ()=> callback?.(new Error('Untrusted server failure')));
  } as typeof original;
  return {dir,host,calls:()=>calls,restore:()=>{Server.prototype.close=original;}};
}
async function absent(path:string):Promise<boolean> {try {await lstat(path);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ENOENT';}}
for (const [close,rejectServer] of [['hang',false],['reject',false],['normal',true],['normal',false]] as const) {
 test(`Host close ${close}/${rejectServer?'server rejection':'normal server'} is single-flight, bounded, and removes the actual credential/listener`, {timeout:15_000},async()=>{
  const f=await fixture(close,rejectServer); const before=performance.now();
  try {
   const first=f.host.close(),second=f.host.close(); assert.equal(first===second,true,'repeat joins cleanup');
   const results=await Promise.allSettled([first,second]);
   assert.equal(results[0]?.status,close==='normal'&&!rejectServer?'fulfilled':'rejected');
   if(results[0]?.status==='rejected')assert.equal(results[0].reason instanceof HostError && results[0].reason.message==='Session shutdown could not be fully confirmed',true,'fixed shutdown boundary');
   assert.equal(f.calls(),1);assert.equal(performance.now()-before<12_000,true,'Host overall close bound');
   assert.equal(await absent(f.host.tokenFile),true,'credential absent after close failure');
   assert.equal(await fetch(f.host.origin).then(()=>false,()=>true),true,'actual listener closed');
  } finally {f.restore();await rm(f.dir,{recursive:true,force:true});}
 });
}
