import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProjectStore} from '../../src/host/project-store.ts';
import {prepareRepairProject} from '../../src/authoring/recovery.ts';

test('recording reference scan and unlink block a second project writer until completion',async()=>{
  const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-recording-lock-'));
  try{
    const first=createProjectStore(directory),second=createProjectStore(directory);
    const recordingId='r-00000000000000000000000000000007';
    const project=prepareRepairProject({id:'late-reference',title:'Late reference',author:'Synthetic',labels:['A','B','C']});project.recordingIds=[recordingId];
    const operation=async(references:Awaited<ReturnType<typeof first.referencingRecording>>)=>{
      assert.deepEqual(references,{projectIds:[],unavailableProjects:[]});
      await assert.rejects(second.save(project),{code:'project_store_busy'});
      assert.deepEqual((await first.catalog()).projects,[],'the rejected concurrent writer must leave no project');
    };
    // The fallback executes the exact previous separated scan/callback behavior, so the
    // original product demonstrates the race rather than merely lacking a new method.
    if('withRecordingReferences' in first)await first.withRecordingReferences(recordingId,operation);
    else await operation(await (first as {referencingRecording:typeof second.referencingRecording}).referencingRecording(recordingId));
    await second.save(project);assert.deepEqual((await second.catalog()).projects.map(p=>p.id),['late-reference']);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('a held project transaction can save and read without relocking; escaped authority expires',async()=>{
  const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-store-transaction-'));
  try{
    const store=createProjectStore(directory),project=prepareRepairProject({id:'inside',title:'Inside',author:'Synthetic',labels:['A','B','C']});
    let escaped:Parameters<Parameters<typeof store.withLock>[0]>[0]|undefined;
    await store.withLock(async transaction=>{escaped=transaction;await transaction.save(project);assert.equal((await transaction.read('inside')).id,'inside');});
    await assert.rejects(escaped!.delete('inside'),{code:'project_store_busy'});
    assert.equal((await store.read('inside')).id,'inside');await store.delete('inside');
  }finally{await rm(directory,{recursive:true,force:true});}
});
