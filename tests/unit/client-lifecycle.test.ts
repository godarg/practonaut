import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';import {readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {boundedProcess} from '../../src/evaluation/process.ts';
test('bounded client failure is returned only after the actual child has exited',{timeout:10000},async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'pn-client-exit-'));
 try{for(let attempt=0;attempt<5;attempt++){
  const pidFile=join(root,String(attempt));
  await assert.rejects(boundedProcess(process.execPath,['-e','require("node:fs").writeFileSync(process.argv[1],String(process.pid));process.stdout.write("x".repeat(10000));setTimeout(()=>{},10000)',pidFile],{bytes:100,wallMs:3000}),/bounded process contract/);
  const pid=Number(readFileSync(pidFile,'utf8'));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},'Rejected process must already be reaped');
 }}finally{await rm(root,{recursive:true,force:true});}
});
