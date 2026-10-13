import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,symlink,mkdir,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createPrivateOutput} from '../../src/evaluation/private-output.ts';
import {bindClient} from '../../src/evaluation/client.ts';
test('evaluation output admits only verified macOS root temp aliases, refuses attacker aliases',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pn-p5-eval-path-'));
  try {
    const out=await createPrivateOutput(join(root,'report'));assert.equal(out,join(await realpath(root),'report'));
    assert.equal((await lstat(out)).mode&0o777,0o700);
    await mkdir(join(root,'target'));await symlink(join(root,'target'),join(root,'attack'));
    await assert.rejects(createPrivateOutput(join(root,'attack','output')),/unsafe ancestor/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('evaluation requires an explicit executable instead of a machine-bound default',async()=>{
  await assert.rejects(bindClient(),/explicit absolute/);
});
