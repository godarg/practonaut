import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectStore } from '../../src/host/project-store.ts';
import { prepareRepairProject } from '../../src/authoring/recovery.ts';

async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'pn-store-read-'));
  const directory = join(root, 'projects'), store = createProjectStore(directory);
  const project = prepareRepairProject({ id: 'saved', title: 'Saved work', author: 'Synthetic', labels: ['A','B','C'] });
  await store.save(project);
  return { root, directory, store, project };
}
test('committed projects remain readable above residue count quota and writers preserve their bytes', async () => {
  const f = await fixture();
  try {
    const original = await readFile(join(f.directory, 'saved.json'));
    for (let i=0;i<33;i++) await writeFile(join(f.directory, '.pending-'+i.toString(16).padStart(32,'0')), 'interrupted', {mode:0o600});
    assert.equal((await f.store.list())[0]!.id, 'saved');
    assert.equal((await f.store.read('saved')).repair!.title.en, 'Saved work');
    await assert.rejects(f.store.save({...f.project,notes:'retry'}), /bounded|budget/);
    assert.deepEqual(await readFile(join(f.directory,'saved.json')),original);
  } finally { await rm(f.root,{recursive:true,force:true}); }
});
test('read enumeration ignores unknown names and unsafe residue without reading or following them', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.directory,'.DS_Store'),'stray',{mode:0o600});
    const outside=join(f.root,'outside');await writeFile(outside,'untouched',{mode:0o600});
    await symlink(outside,join(f.directory,'.pending-'+'f'.repeat(32)));
    await symlink(outside,join(f.directory,'unknown-file'));
    assert.deepEqual((await f.store.list()).map(p=>p.id),['saved']);
    assert.equal((await f.store.read('saved')).id,'saved');
    await assert.rejects(f.store.save(f.project),/unsafe|safe|Unexpected/);
    assert.equal(await readFile(outside,'utf8'),'untouched');
  } finally {await rm(f.root,{recursive:true,force:true});}
});
test('read availability does not inherit residue byte quota and replacement reserves peak bytes',async()=>{
  const f=await fixture();
  try{
    const original=await readFile(join(f.directory,'saved.json'));
    const max=32*1024*1024,chunk=3*1024*1024;
    let remaining=max-original.length-Math.floor(original.length/2);
    for(let i=0;remaining>0;i++){const size=Math.min(chunk,remaining);await writeFile(join(f.directory,'.pending-'+i.toString(16).padStart(32,'0')),Buffer.alloc(size),{mode:0o600});remaining-=size;}
    const before=await readdir(f.directory);
    await assert.rejects(f.store.save(f.project),/budget/);
    assert.deepEqual(await readdir(f.directory),before);assert.deepEqual(await readFile(join(f.directory,'saved.json')),original);
    await writeFile(join(f.directory,'.pending-'+'e'.repeat(32)),Buffer.alloc(original.length),{mode:0o600});
    assert.equal((await f.store.list())[0]!.id,'saved');assert.equal((await f.store.read('saved')).id,'saved');
    await assert.rejects(f.store.save(f.project),/budget/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('committed symlinks and altered envelopes still fail closed on read',async()=>{
  const f=await fixture();
  try{
    const original=await readFile(join(f.directory,'saved.json')),outside=join(f.root,'outside');
    await writeFile(outside,original,{mode:0o600});await symlink(outside,join(f.directory,'forged.json'));
    // POSIX refuses the link when opening (O_NOFOLLOW); Windows has no O_NOFOLLOW and refuses it right after.
    const unsafe=(error:unknown)=>(error as {code?:string}).code==='project_store_unsafe';
    await assert.rejects(f.store.list(),unsafe);await assert.rejects(f.store.read('forged'),unsafe);
    await rm(join(f.directory,'forged.json'));const envelope=JSON.parse(original.toString());envelope.project.notes='altered';await writeFile(join(f.directory,'saved.json'),JSON.stringify(envelope));
    await assert.rejects(f.store.list(),/digest/);await assert.rejects(f.store.read('saved'),/digest/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
