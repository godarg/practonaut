import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startHost } from "../../src/host/server.ts";
import { TOKEN_HEADER } from "../../src/host/protocol.ts";
import { validateWorld } from "../../src/world/index.ts";
test("token-less flood has a separate budget and cannot starve the authenticated session", async () => {
  await mkdir(".local", {recursive:true}); const dir=await mkdtemp(resolve(".local/p5-security-"));
  const assets=join(dir,"player"); await mkdir(assets);
  for(const name of ["index.html","player.js","player.css","tokens.css"]) await writeFile(join(assets,name),"fixed");
  const world=validateWorld(JSON.parse(await readFile("tests/fixtures/core/world.json","utf8")));
  const host=await startHost(world,{mirror:"off",assetDirectory:assets,tokenDirectory:join(dir,"tokens")});
  try {
    const headers={[TOKEN_HEADER]:host.token}; const before=await (await fetch(host.origin+"/api/observe",{headers})).json();
    const denied:number[]=[];
    for(let batch=0;batch<20;batch++) denied.push(...await Promise.all(Array.from({length:20},async()=> {const response=await fetch(host.origin+"/api/observe");await response.arrayBuffer();return response.status;})));
    assert.ok(denied.includes(429),"unauthenticated traffic must remain bounded");
    const legitimate=await fetch(host.origin+"/api/observe",{headers}); assert.equal(legitimate.status,200);
    assert.deepEqual(await legitimate.json(),before);
  } finally {await host.close();await rm(dir,{recursive:true,force:true});}
});
