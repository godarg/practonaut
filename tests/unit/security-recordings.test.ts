import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createRecordingStore} from '../../src/recordings/index.ts';
import {deleteDerivedRecordings} from '../../src/recordings/derived.ts';
import {makeRecording} from './recorder-fixture.ts';
test('recording scan isolates corrupt neighbours, admits other saves, and names Finder metadata',async()=>{
  const root=await mkdtemp(join(await realpath(tmpdir()),'pn-p5-recordings-'));const store=createRecordingStore(join(root,'recordings'));
  try{
    await store.save(makeRecording('r-good'));await writeFile(join(root,'recordings','.DS_Store'),'metadata',{mode:0o600});
    await writeFile(join(root,'recordings','r-bad.json'),'{',{mode:0o600});
    assert.ok(store.scan,'isolated inventory is required');const report=await store.scan();
    assert.deepEqual(report.recordings.map(item=>item.id),['r-good']);assert.deepEqual(report.unavailable,[{id:'.DS_Store',code:'recording_store_metadata'},{id:'r-bad',code:'recording_store_invalid'}]);
    assert.equal((await store.read('r-good')).manifest.id,'r-good');await store.save(makeRecording('r-second'));
    await assert.rejects(store.list(),'strict list retains malformed entry refusal');await store.delete('r-good');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('an unrelated corrupt derived author record cannot prevent bounded recording cleanup',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'pn-p5-derived-'));
 try{await mkdir(join(root,'derived'),{mode:0o700});await writeFile(join(root,'derived','broken.author.json'),'{',{mode:0o600});
 const result=await deleteDerivedRecordings(join(root,'derived'),'r-clean');
 assert.deepEqual(result,{removed:[],unavailable:[{id:'broken',code:'derived_recording_invalid'}]});assert.equal(await readFile(join(root,'derived','broken.author.json'),'utf8'),'{');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('caller-owned corrupt recording with widened mode has a deletion path without parsing',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'pn-p5-corrupt-delete-'));const store=createRecordingStore(join(root,'recordings'));
 try{await store.save(makeRecording('r-corrupt'));const file=join(root,'recordings','r-corrupt.json');await writeFile(file,'{');const {chmod}=await import('node:fs/promises');await chmod(file,0o644);
 await assert.rejects(store.read('r-corrupt'));assert.deepEqual(await store.delete('r-corrupt'),{id:'r-corrupt',removed:['r-corrupt.json']});await assert.rejects(readFile(file),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('valid JSON with invalid derived author shape is named and retained without blocking cleanup',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'pn-p5-derived-shape-'));
 try{await mkdir(join(root,'derived'),{mode:0o700});for(const [id,body] of [['null','null'],['shape','{}']])await writeFile(join(root,'derived',id+'.author.json'),body!,{mode:0o600});
  const result=await deleteDerivedRecordings(join(root,'derived'),'r-clean');assert.deepEqual(result,{removed:[],unavailable:[{id:'null',code:'derived_recording_invalid'},{id:'shape',code:'derived_recording_invalid'}]});
  assert.equal(await readFile(join(root,'derived','null.author.json'),'utf8'),'null');
 }finally{await rm(root,{recursive:true,force:true});}
});
