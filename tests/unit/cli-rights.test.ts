/** Actual CLI disclosure is metadata, never a verified redistribution grant. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
const MAIN=fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
for(const language of ['en','de'])test(`actual ${language} CLI discloses public and private declared rights without granting permission`,()=>{
 const dir=mkdtempSync(join(tmpdir(),'pn-rights-cli-'));try{
 for(const isPrivate of [false,true]){
  const world=JSON.parse(readFileSync(new URL('../fixtures/core/world.json',import.meta.url),'utf8'));const source=join(dir,isPrivate?'local-source':'public-source');mkdirSync(source);
  if(isPrivate){world.rights.license='LicenseRef-Private';world.provenance.privateSource={owner:'Local fixture owner',reconstructionAuthor:world.provenance.authors[0],authorization:{reference:'local-user-instruction',sha256:'9'.repeat(64),scope:'Local fixture testing'},sources:[{reference:'neutral-local-fixture',sha256:'8'.repeat(64)}]};}
  writeFileSync(join(source,'world.json'),JSON.stringify(world));const out=join(dir,isPrivate?'local.pnworld':'public.pnworld');
  const run=(args:string[])=>spawnSync(process.execPath,[MAIN,'--lang',language,...args],{encoding:'utf8',timeout:15000});
  for(const args of [['pack',source,'--out',out,'--json'],['validate',out,'--json']]){
   const result=run(args);assert.equal(result.status,0);const data=JSON.parse(result.stdout);
   assert.deepEqual(data.declaredRights,{license:isPrivate?'LicenseRef-Private':'CC0-1.0',privateSource:isPrivate,redistributionGrantVerified:false});
  }
  const human=run(['validate',out]);assert.equal(human.status,0);assert.ok(human.stdout.includes(isPrivate?'LicenseRef-Private':'CC0-1.0'));
  assert.ok(human.stdout.includes(language==='de'?'keine Weitergabeerlaubnis geprüft':'no redistribution grant verified'));
 }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
