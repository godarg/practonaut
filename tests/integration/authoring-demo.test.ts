import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, realpath, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPhase3Demo } from '../support/authoring-demo.ts';
import { readWorldPackageFile, readCheckerBundleFile } from '../../src/package/reader.ts';
import { validateWorld } from '../../src/world/schema.ts';
import { checkerDataFromBundle } from '../../src/checker/bundle.ts';

test('scripted native gestures yield evidence-bound compiled world loaded by core and actual Player', {timeout:120000}, async()=>{
  const scratch=await mkdtemp(join(await realpath(tmpdir()),'pn-phase3-demonstration-'));
  try {
    const report=await runPhase3Demo(join(scratch,'output'),join(scratch,'recordings'));
    for(const rule of ['create-step-v1','rename-step-v1','move-step-v1','delete-keeps-arrows-v1','connect-v1','reconnect-v1'])assert.ok(report.confirmedRules.includes(rule),`No observed confirmation for ${rule}: ${JSON.stringify({attempts:report.attempts,confirmationFailures:report.confirmationFailures})}`);
    for(const count of Object.values(report.demonstrationsPerRule))assert.ok(count>=2,'Proposal never confirms itself');
    assert.equal(report.coreReplay,true);assert.equal(report.playerLoaded,true);assert.equal(report.hostedMirrorConfirmed,true);assert.equal(report.hostedResultPassed,true);assert.equal(report.humanExpertDemonstration,'OPEN');
    const pack=await readWorldPackageFile(join(scratch,'output','flow-diagram.pnworld'));
    const worldFile=pack.files.get('world.json');assert.ok(worldFile);
    const world=validateWorld(JSON.parse(worldFile.data.toString()));
    assert.ok(world.rules.every(r=>r.status==='confirmed' && r.evidence.length>=2));assert.equal(world.provenance.coalescingVersion,'excalidraw-gesture-v1');
    const bundle=await readCheckerBundleFile(join(scratch,'output','flow-diagram.pncheck'));
    const checker=checkerDataFromBundle(bundle,world);assert.equal(checker.heldOutTasks[0]!.id,'heldout-name');
    assert.equal(JSON.stringify(world).includes('heldout-name'),false);
    const project=JSON.parse(await readFile(join(scratch,'output','project.author.json'),'utf8')) as {questions:Array<{id:string;status:string}>};
    for(const action of report.missingActions)assert.ok(project.questions.some(q=>q.id===`q-scripted-${action}` && q.status==='open'));
  } catch(error) {const kept=await mkdtemp(join(await realpath(tmpdir()),'pn-phase3-failed-evidence-'));await cp(join(scratch,'recordings'),join(kept,'recordings'),{recursive:true});try{await cp(join(scratch,'output','report.json'),join(kept,'report.json'));}catch(copyError){if((copyError as NodeJS.ErrnoException).code!=='ENOENT')throw copyError;console.error('Demo stopped before a report was generated; recording evidence remains retained.');}console.error('Own synthetic failure recordings retained at '+kept);throw error;
  } finally {await rm(scratch,{recursive:true,force:true});}
});
