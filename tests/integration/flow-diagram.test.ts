import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { packWorld, readWorldPackage } from "../../src/package/index.ts";
import { loadWorldPackage, selectVariant } from "../../src/world/index.ts";
import { Session } from "../../src/core/index.ts";
import { createExcalidrawAdapter, renderCheck } from "../../src/adapters/excalidraw/index.ts";
import { parseExcalidraw, checkState, validateCheckerData, generateCheckerVariant } from "../../src/checker/index.ts";
import { checkInProcess } from "../../src/cli/runtime.ts";
import { packChecker } from "../../tools/pack-checker.ts";
import { solution } from "./solutions.ts";
import { stateHash } from "../../src/canonical/index.ts";

const source="examples/worlds/flow-diagram";
test("pack -> validate -> log -> real adapter readback -> export -> independent checker, three seeds",{timeout:180_000},async()=>{
 const bytes=await packWorld(source);assert.deepEqual(bytes,await packWorld(source));
 const world=loadWorldPackage(await readWorldPackage(bytes));
 const checker=validateCheckerData(JSON.parse(await readFile("examples/worlds/flow-diagram.check/checker.json","utf8")),world);
 for(const seed of [1,42,20261003])for(const taskId of ["T1","T2","T3"]){
  const session=new Session(world,seed,taskId);const adapter=await createExcalidrawAdapter(session.state);
  try{
   for(const action of solution(world,seed,taskId)){const before=session.state;const result=session.act(action);assert.equal(result.ok,true);if(!result.ok)continue;
    const mirrored=await adapter.apply({before,after:session.state,action});assert.equal(mirrored.ok,true,JSON.stringify(mirrored));assert.deepEqual(await adapter.snapshot(),session.state);assert.equal(session.checkReplay().ok,true);}
   const artifact=await adapter.exportArtifact();assert.equal((await renderCheck(artifact)).ok,true);assert.equal(stateHash(parseExcalidraw(artifact.native)),stateHash(session.state));
   const verdict=await checkInProcess(world,artifact.native,{seed,taskId,bundle:checker});assert.equal(verdict.passed,true,JSON.stringify(verdict));assert.equal(verdict.scope,"end-state-only");
   const nativeSession=await checkInProcess(world,JSON.stringify(session.serialize()),{bundle:checker});assert.equal(nativeSession.passed,true);
   const roundtrip=await adapter.importArtifact(artifact.native);assert.equal(roundtrip.ok,true);assert.deepEqual(await adapter.snapshot(),session.state);assert.deepEqual(adapter.networkAttempts(),[]);
  }finally{await adapter.close();}
 }
});
test("real UI deletion produces loose-arrow verdict and red independent render",{timeout:60_000},async()=>{
 const world=loadWorldPackage(await readWorldPackage(await packWorld(source)));const seed=42;const session=new Session(world,seed,"T3");const adapter=await createExcalidrawAdapter(session.state);
 try{const removed=await adapter.deleteStepViaUI("b");assert.equal(removed.ok,true);const artifact=await adapter.exportArtifact();assert.equal((await renderCheck(artifact)).ok,false);
  const verdict=await checkInProcess(world,artifact.native,{seed,taskId:"T3"});assert.equal(verdict.passed,false);assert.ok(verdict.tasks[0]?.errors.some(e=>e.id==="loose-arrow"));assert.deepEqual(adapter.networkAttempts(),[]);
 }finally{await adapter.close();}
});
test("every frozen finite variant has a trusted witness; alternatives pass, near misses fail",()=>{
 // The six cases are reached by bounded seed enumeration; generation itself carries no witnesses.
 return (async()=>{const world=loadWorldPackage(await readWorldPackage(await packWorld(source)));const bundle=validateCheckerData(JSON.parse(await readFile("examples/worlds/flow-diagram.check/checker.json","utf8")),world);const found=new Set<string>();
  for(let seed=0;seed<1000&&found.size<world.variants.cases.length;seed++){const variant=selectVariant(world,seed);if(found.has(variant.id))continue;found.add(variant.id);
   for(const taskId of ["T1","T2","T3"]){const session=new Session(world,seed,taskId);for(const action of solution(world,seed,taskId))assert.equal(session.act(action).ok,true);assert.equal(checkState(world,session.state,{seed,taskId,bundle}).passed,true);}
   for(const fixture of generateCheckerVariant(world,bundle,seed).fixtures)assert.equal(checkState(world,fixture.state,{seed,taskId:fixture.taskId,bundle}).passed,fixture.expected);
  }assert.equal(found.size,world.variants.cases.length);
 })();
});
test("CLI run and separate check on installed-shaped native/session files; rejection and unmodeled",{timeout:60_000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"pn-integration-"));try{
 const bytes=await packWorld(source);const world=loadWorldPackage(await readWorldPackage(bytes));const pnworld=join(dir,"flow.pnworld"),pncheck=join(dir,"flow.pncheck"),actions=join(dir,"actions.json"),state=join(dir,"state.json"),prefix=join(dir,"export");
 await writeFile(pnworld,bytes);await writeFile(pncheck,await packChecker("examples/worlds/flow-diagram.check"));await writeFile(actions,JSON.stringify(solution(world,42,"T3")));
 const cli=(args:string[])=>spawnSync(process.execPath,["src/cli/main.ts",...args],{encoding:"utf8",timeout:30_000});
 const run=cli(["run",pnworld,"--seed","42","--actions",actions,"--task","T3","--state-out",state,"--export",prefix]);assert.equal(run.status,0,run.stderr);const out=JSON.parse(run.stdout);assert.equal(out.steps.length,3);assert.equal(out.endHash,out.state.hash);assert.equal(JSON.parse(await readFile(prefix+".excalidraw","utf8")).practonaut,undefined);
 const checked=cli(["check",state,"--world",pnworld,"--bundle",pncheck]);assert.equal(checked.status,0,checked.stdout+checked.stderr);
 const exportCheck=cli(["check",prefix+".excalidraw","--world",pnworld,"--bundle",pncheck,"--pair",prefix+".session.json"]);assert.equal(exportCheck.status,0,exportCheck.stdout+exportCheck.stderr);
 const mismatched=cli(["check",prefix+".excalidraw","--world",pnworld,"--pair",prefix+".session.json","--seed","1"]);assert.equal(mismatched.status,2);assert.match(mismatched.stderr,/artifact_invalid/);
 await writeFile(actions,JSON.stringify([{name:"group",params:{}}]));const rejected=cli(["run",pnworld,"--seed","42","--actions",actions,"--mirror","off"]);assert.equal(rejected.status,2);assert.match(rejected.stderr,/unmodeled/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
