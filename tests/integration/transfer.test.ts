import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, type ExecFileException } from 'node:child_process';
import { packWorld } from '../../src/package/index.ts';
import { packChecker } from '../../tools/pack-checker.ts';
import { checkerRequest } from '../../src/evaluation/process.ts';
import type { AssignmentReply, VerdictReply } from '../../src/evaluation/contracts.ts';
import { exportAgentSolution, exportScriptedHuman, inspectNativeTransferFile, assertNativeTransferPreserved, nativeFileTransfer, nativeTransferErrorEvidence, readNativeTransferCompletion, NativeTransferPersistenceError } from '../../src/evaluation/transfer.ts';
import { createExcalidrawAdapter } from '../../src/adapters/excalidraw/index.ts';
import { RuntimeError } from '../../src/cli/runtime.ts';
import { h1NativeInput, installLaunchSeam, recordOpenTimeline, focusThiefInitScript, type OpenTimelineEntry } from '../support/native-open.ts';

test('H1 transfer: scripted human genuine editor input and adapter fixture exports judged only after editing', { timeout: 90_000 }, async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'pn-transfer-')); try {
    const worldPath = join(root, 'flow.pnworld'), bundlePath = join(root, 'flow.pncheck'); await writeFile(worldPath, await packWorld('examples/worlds/flow-diagram')); await writeFile(bundlePath, await packChecker('examples/worlds/flow-diagram.check'));
    const request = { worldPath, bundlePath, taskId: 'H1', seed: 42 }, assigned = await checkerRequest({ ...request, mode: 'assignment', instantiated: true }) as AssignmentReply;
    const solution = { steps: [{ label: 'Review', x: 300, y: 300 }, { label: 'Archive', x: 750, y: 300 }], arrows: [{ from: 0, to: 1 }] };
    const human = await exportScriptedHuman(assigned.assignment.initialState);
    const nativeHuman = JSON.parse(human.native) as { elements: Array<{ id: string; type: string; containerId?: string; customData?: { practonautId?: string } }> };
    const drawn = nativeHuman.elements.filter(element => element.type !== 'frame');
    assert.equal(drawn.filter(element => element.type === 'rectangle').length, 2);
    assert.equal(drawn.filter(element => element.type === 'text').length, 2);
    assert.equal(drawn.filter(element => element.type === 'arrow').length, 1);
    for (const element of drawn) assert.equal(element.customData?.practonautId, undefined, 'Actual drawn objects must reach the checker without injected annotation');
    const steps = Object.values(human.state.objects).filter(object => object.type === 'step');
    assert.deepEqual(steps.map(step => step.label).sort(), ['Archive', 'Review']);
    const arrow = Object.values(human.state.objects).find(object => object.type === 'arrow');
    assert.ok(arrow?.type === 'arrow'); assert.equal(arrow.from, steps.find(step => step.label === 'Review')!.id); assert.equal(arrow.to, steps.find(step => step.label === 'Archive')!.id);
    for (const step of steps) { assert.ok(nativeHuman.elements.some(element => element.type === 'rectangle' && element.id === step.id)); assert.ok(nativeHuman.elements.some(element => element.type === 'text' && element.containerId === step.id)); }
    for (const exported of [human, await exportAgentSolution(assigned.assignment.initialState, solution)]) { assert.deepEqual(exported.networkAttempts, []); const checked = await checkerRequest({ ...request, mode: 'verdict', input: exported.native, expectedBundleSha256: assigned.bundleSha256 }) as VerdictReply; assert.equal(checked.verdict.passed, true, JSON.stringify(checked.verdict)); assert.notEqual(checked.checkerPid, process.pid); }
    const wrong = await exportAgentSolution(assigned.assignment.initialState, { ...solution, steps: [{ label: 'Wrong', x: 300, y: 300 }, solution.steps[1]] }); const checked = await checkerRequest({ ...request, mode: 'verdict', input: wrong.native, expectedBundleSha256: assigned.bundleSha256 }) as VerdictReply; assert.equal(checked.verdict.passed, false);
    const unbound = await exportAgentSolution(assigned.assignment.initialState, { ...solution, arrows: [] }); assert.equal((await checkerRequest({ ...request, mode: 'verdict', input: unbound.native, expectedBundleSha256: assigned.bundleSha256 }) as VerdictReply).verdict.passed, false);
    await assert.rejects(exportAgentSolution(assigned.assignment.initialState, { ...solution, arrows: [{ from: 0, to: 7 }] }), /invalid arrow reference/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Independently assigned CC0 native data. No adapter serializer defines this policy oracle.
function nativePolicyFixture(): { type: 'excalidraw'; version: 2; elements: Array<Record<string, unknown>>; files: Record<string, never> } {
  const element = (id: string, type: string, x: number, frameId: string | null) => ({ id, type, isDeleted: false, x, y: 300, width: 180, height: 100, angle: 0, frameId, boundElements: [] as Array<{ id: string; type: string }> });
  const frame = { ...element('frame', 'frame', 100, null), name: 'Synthetic CC0 process', width: 1100, height: 500 };
  const a = { ...element('a', 'rectangle', 300, 'frame'), boundElements: [{ id: 'a:text', type: 'text' }, { id: 'ac', type: 'arrow' }] };
  const c = { ...element('c', 'rectangle', 750, 'frame'), boundElements: [{ id: 'c:text', type: 'text' }, { id: 'ac', type: 'arrow' }] };
  const text = (id: string, x: number, label: string, deleted = false) => ({ ...element(`${id}:text`, 'text', x, 'frame'), isDeleted: deleted, containerId: id, fontFamily: 3, text: label, originalText: label });
  const arrow = { ...element('ac', 'arrow', 480, 'frame'), startBinding: { elementId: 'a' }, endBinding: { elementId: 'c' }, startArrowhead: null, endArrowhead: 'arrow' };
  const b = { ...element('b', 'rectangle', 520, 'frame'), isDeleted: true, boundElements: [{ id: 'b:text', type: 'text' }] };
  const bc = { ...element('bc', 'arrow', 700, 'frame'), isDeleted: true, startBinding: null, endBinding: null };
  return { type: 'excalidraw', version: 2, elements: [frame, a, text('a', 320, 'Review'), b, text('b', 540, 'Discard', true), c, text('c', 770, 'Archive'), arrow, bc], files: {} };
}
test('native transfer policy: preregistered normalization permits tombstone and wrapper/text-layout changes, preserves all active relationships', () => {
  const fixture = nativePolicyFixture(), before = inspectNativeTransferFile(JSON.stringify(fixture));
  const normalized = { ...fixture, source: 'https://excalidraw.com', appState: { viewBackgroundColor: '#ffffff' }, elements: fixture.elements.filter(element => !element.isDeleted).map(element => element.type === 'text' ? { ...element, x: Number(element.x) + 7, width: 140, text: String(element.text).replace(' ', '\n') } : element) };
  const after = inspectNativeTransferFile(JSON.stringify(normalized, null, 2));
  assert.equal(before.bytes, Buffer.byteLength(before.native)); assert.equal(before.sha256, createHash('sha256').update(before.native).digest('hex'));
  assert.deepEqual(before.tombstoneIds, ['b', 'b:text', 'bc']); assert.deepEqual(after.tombstoneIds, []);
  assertNativeTransferPreserved(before, after);
  assert.notEqual(before.sha256, after.sha256, 'Native serialization is not the byte transport oracle');
  assert.notDeepEqual(before.state, after.state, 'A tombstone-identical full-array oracle remains RED');
  assert.throws(() => assertNativeTransferPreserved(before, before), /unexpected tombstones/);
  for (const damage of ['label', 'frame', 'binding', 'back-reference', 'direction', 'active-id'] as const) {
    const bad = structuredClone(normalized);
    if (damage === 'label') for (const element of bad.elements) if (element.id === 'a:text') { element.originalText = 'Wrong'; element.text = 'Wrong'; }
    if (damage === 'frame') bad.elements.find(element => element.id === 'a')!.frameId = null;
    if (damage === 'binding') bad.elements.find(element => element.id === 'ac')!.endBinding = null;
    if (damage === 'back-reference') bad.elements.find(element => element.id === 'c')!.boundElements = [{ id: 'c:text', type: 'text' }];
    if (damage === 'direction') bad.elements.find(element => element.id === 'ac')!.endArrowhead = null;
    if (damage === 'active-id') bad.elements = bad.elements.filter(element => element.id !== 'c:text');
    assert.throws(() => assertNativeTransferPreserved(before, inspectNativeTransferFile(JSON.stringify(bad))), `${damage} must not normalize away`);
  }
});

test('native lifecycle pure: a pre-aborted factory refuses before engine or browser initialization', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createExcalidrawAdapter({ objects: {} }, { signal: controller.signal }), /cancelled/);
});
test('native lifecycle pure: primary and cleanup error originals remain separately inspectable', () => {
  const primary = new Error('independently assigned primary marker'), cleanup = new Error('independently assigned cleanup marker');
  const record = nativeTransferErrorEvidence(new AggregateError([primary, cleanup], 'two failures', { cause: primary })) as { cause: { message: string }; errors: Array<{ message: string; stack: string }> };
  assert.equal(record.cause.message, 'independently assigned primary marker');
  assert.deepEqual(record.errors.map(error => error.message), ['independently assigned primary marker', 'independently assigned cleanup marker']);
  assert.equal(record.errors[0]!.stack, primary.stack); assert.equal(record.errors[1]!.stack, cleanup.stack);
  assert.equal(nativeTransferErrorEvidence(undefined), null);
});

// Prepared real-process controls, never counted as runtime evidence until this exact test executes.
for (const fault of ['initial-write-stall', 'primary-and-close-failure'] as const) {
  test(`native lifecycle real process: ${fault}, joined factory and immutable terminal originals`, { timeout: 90_000 }, async context => {
    const root = await mkdtemp(join(await realpath(tmpdir()), 'pn-native-lifecycle-'));
    context.diagnostic(`Native lifecycle control originals: ${root}`);
    const inputPath = join(root, 'input.excalidraw'), outputDirectory = join(root, 'attempt');
    await writeFile(inputPath, JSON.stringify(nativePolicyFixture()), { flag: 'wx', mode: 0o600 });
    const inputSha256 = createHash('sha256').update(await readFile(inputPath)).digest('hex');
    const script = `
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {chromium} from ${JSON.stringify(new URL('../../node_modules/playwright-core/index.mjs', import.meta.url).href)};
import {nativeFileTransfer,nativeTransferErrorEvidence} from ${JSON.stringify(new URL('../../src/evaluation/transfer.ts', import.meta.url).href)};
// Without process monitoring the observable lifecycle is Playwright's connection state.
const ownedBrowserEvidence=async b=>({bound:b.isConnected(),parentOwner:true,residualCount:b.isConnected()?1:0,profilePresent:b.isConnected()});
const fault=${JSON.stringify(fault)}, root=${JSON.stringify(root)}, outputDirectory=${JSON.stringify(outputDirectory)};
const launch=chromium.launch.bind(chromium); let browser,realClose,started=false,launches=0,beforePending;
chromium.launch=async options=>{
  // Counts started browsers. A start the system refused for the sandbox produced none; the Linux
  // fallback that follows it (PADR-0032) is that same start, not a relaunch of a lost browser.
  browser=await launch(options); launches++; realClose=browser.close.bind(browser);
  if(fault==='primary-and-close-failure') browser.close=async()=>{await realClose();return await new Promise(()=>{});};
  const newContext=browser.newContext.bind(browser);
  browser.newContext=async options=>{
    const context=await newContext(options);
    beforePending=ownedBrowserEvidence(browser); await beforePending;
    await context.addInitScript(({fault})=>{
      let bridge;
      Object.defineProperty(window,'__pn',{configurable:true,get:()=>bridge,set:value=>{
        bridge=value;
        value.write=()=>{console.info('NATIVE_INIT_WRITE_ENTERED');
          if(fault==='primary-and-close-failure')throw Error('native-init-primary-control');
          return new Promise(()=>{});
        };
      }});
    },{fault});
    context.on('page',page=>page.on('console',message=>{
      if(message.text()==='NATIVE_INIT_WRITE_ENTERED')started=true;
    }));
    return context;
  };
  return browser;
};
process.once('SIGTERM',()=>{void Promise.resolve().then(()=>realClose?.()).finally(()=>process.exit(143));});
let primary,terminal,before,after,controlError;
try {
  try { await nativeFileTransfer({inputPath:${JSON.stringify(inputPath)},expectedInputSha256:${JSON.stringify(inputSha256)},outputDirectory,stepId:'a'}); }
  catch(error){primary=error;}
  assert.ok(primary,'Control must refuse the real native attempt');
  assert.equal(started,true,'The real browser-side initial write must have been entered');
  assert.equal(launches,1,'No launch retry');
  before=await beforePending; after=await ownedBrowserEvidence(browser);
  assert.equal(before.bound,true);assert.equal(before.parentOwner,true);assert.ok(before.residualCount>=1);
  assert.equal(browser.isConnected(),false);assert.equal(after.bound,false);assert.equal(after.profilePresent,false);assert.equal(after.residualCount,0);
  terminal=JSON.parse(await readFile(join(outputDirectory,'terminal.json'),'utf8'));
  assert.equal(terminal.status,'failed');assert.equal(terminal.stage,'initialize');assert.equal(terminal.initializationAndRunJoined,true);
  assert.deepEqual(terminal.networkAttempts,[]);assert.equal(terminal.cleanup.attempted,true);
  assert.equal(terminal.deadlineExpired,fault==='initial-write-stall');
  if(fault==='initial-write-stall'){assert.match(terminal.primaryError.message,/deadline/);assert.equal(terminal.cleanup.succeeded,true);}
  else {assert.match(terminal.primaryError.message,/native-init-primary-control/);assert.match(primary.message,/native-init-primary-control/);assert.equal(terminal.cleanup.succeeded,false);assert.ok(terminal.cleanup.errors.length>=1);}
  assert.equal((await readdir(outputDirectory)).includes('result.json'),false,'Failed cleanup cannot leave a success result');
  const original=await readFile(join(outputDirectory,'terminal.json'));
  await assert.rejects(writeFile(join(outputDirectory,'terminal.json'),'overwrite',{flag:'wx'}),error=>error.code==='EEXIST');
  assert.equal((await readFile(join(outputDirectory,'terminal.json'))).equals(original),true);
} catch(error){controlError=error;process.exitCode=1;}
finally {
  // Only this child's real browser is cleaned up, also when running the pre-fix counterfactual.
  if(browser?.isConnected())await realClose();
  const files={};for(const name of await readdir(outputDirectory).catch(()=>[])){const bytes=await readFile(join(outputDirectory,name));files[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
  const record={fault,launches,started,before,after,terminal,primary:nativeTransferErrorEvidence(primary),controlError:nativeTransferErrorEvidence(controlError),files};
  await writeFile(join(root,'negative-process.original.json'),JSON.stringify(record,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(record));
}
`;
    const scriptPath = join(root, 'negative-child.original.mjs');
    await writeFile(scriptPath, script, { flag: 'wx', mode: 0o600 });
    const reply = await new Promise<{ error: ExecFileException | null; stdout: string; stderr: string }>(resolve => {
      execFile(process.execPath, [scriptPath], { timeout: 85_000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
    await writeFile(join(root, 'child.stdout.original.log'), reply.stdout, { flag: 'wx', mode: 0o600 });
    await writeFile(join(root, 'child.stderr.original.log'), reply.stderr, { flag: 'wx', mode: 0o600 });
    await writeFile(join(root, 'child.exit.original.json'), JSON.stringify({ code: reply.error?.code ?? 0, signal: reply.error?.signal ?? null, error: nativeTransferErrorEvidence(reply.error ?? undefined), scriptSha256: createHash('sha256').update(script).digest('hex') }, null, 2), { flag: 'wx', mode: 0o600 });
    assert.equal(reply.error, null, reply.stderr || reply.stdout);
    const evidence = JSON.parse(await readFile(join(root, 'negative-process.original.json'), 'utf8')) as { started: boolean; after: { residualCount: number; profilePresent: boolean }; controlError: unknown };
    assert.equal(evidence.started, true); assert.equal(evidence.after.residualCount, 0); assert.equal(evidence.after.profilePresent, false); assert.equal(evidence.controlError, null);
  });
}

test('native abort settlement pure: setup refusal persists honestly, existing directories remain untouched', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'pn-abort-setup-'));
  try {
    const outputDirectory = join(root, 'missing-input-attempt');
    await assert.rejects(nativeFileTransfer({ inputPath: join(root, 'absent.excalidraw'), expectedInputSha256: '0'.repeat(64), outputDirectory, stepId: 'a' }), { code: 'ENOENT' });
    const terminal = JSON.parse(await readFile(join(outputDirectory, 'terminal.json'), 'utf8')) as { status: string; stage: string; primaryError: { code: string }; cleanup: { succeeded: boolean } };
    assert.equal(terminal.status, 'failed'); assert.equal(terminal.stage, 'setup'); assert.equal(terminal.primaryError.code, 'ENOENT'); assert.equal(terminal.cleanup.succeeded, false);
    await assert.rejects(nativeFileTransfer({ inputPath: 'unused', expectedInputSha256: '0'.repeat(64), outputDirectory, stepId: 'a' }), error => {
      assert.ok(error instanceof NativeTransferPersistenceError); assert.equal(error.durableEvidence, 'unavailable');
      assert.equal((error.cause as { code: string }).code, 'EEXIST'); return true;
    });
    assert.deepEqual(JSON.parse(await readFile(join(outputDirectory, 'terminal.json'), 'utf8')), terminal);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('native abort settlement pure: complete whole-byte candidate/terminal pair is the success boundary', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'pn-abort-pair-'));
  try {
    const candidate = Buffer.from(JSON.stringify({ status: 'candidate', requiresCompleteTerminalPair: true, result: { independentlyAssignedMarker: 'pair-only, no runtime' } }));
    await writeFile(join(root, 'result.json'), candidate, { flag: 'wx' });
    await assert.rejects(readNativeTransferCompletion(root), { code: 'ENOENT' });
    const terminal = { status: 'succeeded', runSettled: true, pendingNativeOperations: 0, cleanup: { succeeded: true }, resultFile: { sha256: createHash('sha256').update(candidate).digest('hex'), bytes: candidate.length } };
    const terminalBytes = Buffer.from(JSON.stringify(terminal));
    await writeFile(join(root, 'terminal.json'), terminalBytes, { flag: 'wx' });
    assert.deepEqual(await readNativeTransferCompletion(root), { resultSha256: terminal.resultFile.sha256, terminalSha256: createHash('sha256').update(terminalBytes).digest('hex') });
    const damaged = await mkdtemp(join(await realpath(tmpdir()), 'pn-abort-pair-damaged-'));
    try {
      await writeFile(join(damaged, 'result.json'), Buffer.concat([candidate, Buffer.from('\n')]), { flag: 'wx' });
      await writeFile(join(damaged, 'terminal.json'), terminalBytes, { flag: 'wx' });
      await assert.rejects(readNativeTransferCompletion(damaged), /complete matching/);
    } finally { await rm(damaged, { recursive: true, force: true }); }
    const primary = new Error('independent I/O primary'), cleanup = new Error('independent cleanup refusal'), io = new Error('terminal I/O failed');
    const unavailable = new NativeTransferPersistenceError(primary, [cleanup], io, terminal);
    assert.equal(unavailable.durableEvidence, 'unavailable'); assert.equal(unavailable.cause, primary);
    assert.deepEqual(unavailable.errors, [primary, cleanup, io]); assert.equal(unavailable.terminalRecord, terminal);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native abort settlement combined real process: pending initial write plus close reply after actual owned close', { timeout: 90_000 }, async context => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'pn-abort-combined-'));
  context.diagnostic(`Combined abort settlement originals: ${root}`);
  const inputPath = join(root, 'input.excalidraw'), outputDirectory = join(root, 'attempt');
  await writeFile(inputPath, JSON.stringify(nativePolicyFixture()), { flag: 'wx', mode: 0o600 });
  const inputSha256 = createHash('sha256').update(await readFile(inputPath)).digest('hex');
  const combinedScript = `
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {chromium} from ${JSON.stringify(new URL('../../node_modules/playwright-core/index.mjs', import.meta.url).href)};
import {nativeFileTransfer,nativeTransferErrorEvidence} from ${JSON.stringify(new URL('../../src/evaluation/transfer.ts', import.meta.url).href)};
import {bounded} from ${JSON.stringify(new URL('../../src/adapters/excalidraw/bounded.ts', import.meta.url).href)};
// Without process monitoring the observable lifecycle is Playwright's connection state.
const ownedBrowserEvidence=async b=>({bound:b.isConnected(),parentOwner:true,residualCount:b.isConnected()?1:0,profilePresent:b.isConnected()});
const root=${JSON.stringify(root)}, outputDirectory=${JSON.stringify(outputDirectory)}, start=performance.now(), timeline=[];
const mark=event=>timeline.push({event,ms:Math.round(performance.now()-start)});
let browser,realClose,before,after,entered=false,initialReplyHeld=false,actualCloseDone=false,closeReplyHeld=false,launches=0;
const launch=chromium.launch.bind(chromium);
const watchdog=setTimeout(()=>{
  mark('watchdog-product-did-not-settle');console.error(JSON.stringify({timeline,entered,actualCloseDone,initialReplyHeld,closeReplyHeld}));
  const hard=setTimeout(()=>process.exit(124),3000);
  void Promise.resolve().then(()=>realClose?.()).finally(()=>{clearTimeout(hard);process.exit(124);});
},84000);
chromium.launch=async options=>{
  // Counts started browsers; a sandbox refusal and its Linux fallback are one start (PADR-0032).
  browser=await launch(options);launches++;realClose=browser.close.bind(browser);mark('real-launch');
  browser.close=async()=>{mark('tested-close-entered');await realClose();actualCloseDone=true;mark('actual-owned-close-complete');closeReplyHeld=true;return await new Promise(()=>{});};
  const newContext=browser.newContext.bind(browser);
  browser.newContext=async options=>{
    const context=await newContext(options);before=await ownedBrowserEvidence(browser);mark('owned-before');
    await context.addInitScript(()=>{
      let bridge;Object.defineProperty(window,'__pn',{configurable:true,get:()=>bridge,set:value=>{
        bridge=value;value.write=()=>{console.info('COMBINED_INITIAL_WRITE_ENTERED');return new Promise(()=>{});};
      }});
    });
    context.on('page',page=>{
      page.on('console',message=>{if(message.text()==='COMBINED_INITIAL_WRITE_ENTERED'){entered=true;mark('actual-browser-initial-write-entered');}});
      const evaluate=page.evaluate.bind(page);
      page.evaluate=(...args)=>{
        if(typeof args[0]==='string'&&args[0].includes('window.__pn.write')){
          initialReplyHeld=true;mark('initial-api-reply-held');
          // The actual browser write is invoked. Its real rejection after close is observed,
          // while this public API reply stays pending to exercise refusal settlement.
          void evaluate(...args).then(()=>mark('underlying-write-resolved'),()=>mark('underlying-write-rejected'));
          return new Promise(()=>{});
        }
        return evaluate(...args);
      };
    });
    return context;
  };
  return browser;
};
let primary,terminal,terminalSha256,terminalBytes,controlError,refusalSnapshot,hygiene;
try {
  try{await nativeFileTransfer({inputPath:${JSON.stringify(inputPath)},expectedInputSha256:${JSON.stringify(inputSha256)},outputDirectory,stepId:'a'});}
  catch(error){primary=error;mark('product-refused');}
  assert.ok(primary);assert.equal(entered,true);assert.equal(launches,1);assert.equal(initialReplyHeld,true);assert.equal(closeReplyHeld,true);assert.equal(actualCloseDone,true);
  after=await ownedBrowserEvidence(browser);mark('owned-after-before-hygiene');
  terminalBytes=await readFile(join(outputDirectory,'terminal.json'));terminalSha256=createHash('sha256').update(terminalBytes).digest('hex');terminal=JSON.parse(terminalBytes);
  refusalSnapshot={ms:Math.round(performance.now()-start),primary:nativeTransferErrorEvidence(primary),before,after,terminalSha256,terminalBytes:terminalBytes.length,actualCloseDone,initialReplyHeld,closeReplyHeld};
  await writeFile(join(root,'refusal-before-hygiene.original.json'),JSON.stringify(refusalSnapshot,null,2),{flag:'wx',mode:0o600});
  assert.equal(before.bound,true);assert.equal(before.parentOwner,true);assert.ok(before.residualCount>=1);
  assert.equal(after.bound,false);assert.equal(after.profilePresent,false);assert.equal(after.residualCount,0);
  assert.equal(browser.isConnected(),false);assert.ok(refusalSnapshot.ms>=60000);assert.ok(refusalSnapshot.ms<83500);
  assert.equal(terminal.status,'failed');assert.equal(terminal.stage,'initialize');assert.equal(terminal.deadlineExpired,true);
  assert.match(terminal.primaryError.message,/deadline/);assert.equal(terminal.runSettled,true);
  assert.ok(terminal.pendingInitializationOperations>=1);assert.equal(terminal.initializationAndRunJoined,false);
  assert.equal(terminal.cleanup.attempted,true);assert.equal(terminal.cleanup.succeeded,false);assert.ok(terminal.cleanup.errors.length>=1);
  assert.deepEqual(terminal.networkAttempts,[]);assert.equal((await readdir(outputDirectory)).includes('result.json'),false);
  await assert.rejects(writeFile(join(outputDirectory,'terminal.json'),'overwrite',{flag:'wx'}),error=>error.code==='EEXIST');
  assert.equal((await readFile(join(outputDirectory,'terminal.json'))).equals(terminalBytes),true);
}catch(error){controlError=error;process.exitCode=1;}
finally{
  // Hygiene follows the immutable refusal snapshot; it cannot repair the product verdict.
  mark('separate-hygiene-start');
  try{if(realClose)await bounded(realClose(),2000);hygiene={status:'completed',separateFromProduct:true};}
  catch(error){hygiene={status:'refused',separateFromProduct:true,error:nativeTransferErrorEvidence(error)};process.exitCode=1;}
  mark('separate-hygiene-end');clearTimeout(watchdog);
  const files={};for(const name of await readdir(outputDirectory).catch(()=>[])){const bytes=await readFile(join(outputDirectory,name));files[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
  const record={schema:'native-abort-combined/1',launches,entered,initialReplyHeld,closeReplyHeld,actualCloseDone,before,after,refusalSnapshot,hygiene,timeline,terminal,terminalSha256,primary:nativeTransferErrorEvidence(primary),controlError:nativeTransferErrorEvidence(controlError),files};
  await writeFile(join(root,'combined-process.original.json'),JSON.stringify(record,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(record));
}
`;
  const scriptPath = join(root, 'combined-child.original.mjs');
  await writeFile(scriptPath, combinedScript, { flag: 'wx', mode: 0o600 });
  const reply = await new Promise<{ error: ExecFileException | null; stdout: string; stderr: string }>(resolve => {
    execFile(process.execPath, [scriptPath], { timeout: 87_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });
  await writeFile(join(root, 'combined.stdout.original.log'), reply.stdout, { flag: 'wx', mode: 0o600 });
  await writeFile(join(root, 'combined.stderr.original.log'), reply.stderr, { flag: 'wx', mode: 0o600 });
  await writeFile(join(root, 'combined.exit.original.json'), JSON.stringify({ code: reply.error?.code ?? 0, signal: reply.error?.signal ?? null, error: nativeTransferErrorEvidence(reply.error ?? undefined), scriptSha256: createHash('sha256').update(combinedScript).digest('hex') }, null, 2), { flag: 'wx', mode: 0o600 });
  assert.equal(reply.error, null, reply.stderr || reply.stdout);
});

/** Attempt originals under the ignored .local/native-transfer/ (uploaded by CI on failure), one fresh folder each. */
async function nativeEvidenceRoot(prefix: string): Promise<string> {
  await mkdir('.local/native-transfer', { recursive: true });
  return mkdtemp(join(await realpath('.local/native-transfer'), prefix));
}
const isPng = (bytes: Buffer): boolean => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

// Ordering contract of the native Open (issue #45, docs/testing.md): the filechooser listener exists and
// one page round trip has completed after it before the shortcut is sent. Observed through the launch
// seam on the real product call; the recorded calls are the runtime behaviour, not source text.
test('native Open ordering: filechooser listener, then a completed page round trip, then the shortcut', { timeout: 90_000 }, async context => {
  const root = await nativeEvidenceRoot('ordering-');
  context.diagnostic(`Native Open ordering evidence: ${root}`);
  const input = await h1NativeInput(root), timeline: OpenTimelineEntry[] = [];
  const seam = installLaunchSeam({ page: recordOpenTimeline(timeline) });
  let transferred: Awaited<ReturnType<typeof nativeFileTransfer>>;
  try { transferred = await nativeFileTransfer({ inputPath: input.inputPath, expectedInputSha256: input.expectedInputSha256, outputDirectory: join(root, 'native-attempt'), stepId: 'transfer-step-0' }); }
  finally { seam.uninstall(); await writeFile(join(root, 'timeline.json'), JSON.stringify(timeline, null, 2)); }
  assert.equal(seam.launches(), 1);
  assert.equal(transferred.snapshots.opened.state.objects['transfer-step-0']?.type, 'step', 'the native Open loaded the file');
  const shortcut = timeline.findIndex(entry => entry.event === 'press' && /^(Meta|Control)\+o$/.test(entry.key));
  const listener = timeline.findIndex(entry => entry.event === 'listener' && entry.name === 'filechooser');
  assert.ok(shortcut >= 0, 'the Open shortcut was pressed');
  assert.ok(listener >= 0 && listener < shortcut, 'a filechooser listener exists before the shortcut');
  const between = timeline.slice(listener + 1, shortcut);
  const ended = new Set(between.flatMap(entry => entry.event === 'roundtrip-end' ? [entry.call] : []));
  const completed = between.flatMap(entry => entry.event === 'roundtrip-start' && ended.has(entry.call) ? [entry.call] : []);
  assert.ok(completed.length >= 1, `a page round trip starts after the listener and completes before the shortcut: ${JSON.stringify(between)}`);
  assert.equal(timeline.filter(entry => entry.event === 'press' && /\+o$/.test(entry.key)).length, 1, 'exactly one Open shortcut');
  assert.ok(isPng(await readFile(join(root, 'native-attempt', '00-before-open.png'))), 'a screenshot before Open is attempt evidence');
});

test('native Open refuses by name when keyboard focus left the editor before the shortcut', { timeout: 90_000 }, async context => {
  const root = await nativeEvidenceRoot('focus-');
  context.diagnostic(`Native Open focus refusal evidence: ${root}`);
  const input = await h1NativeInput(root), outputDirectory = join(root, 'native-attempt');
  const seam = installLaunchSeam({ initScript: focusThiefInitScript });
  let refusal: unknown;
  try { await nativeFileTransfer({ inputPath: input.inputPath, expectedInputSha256: input.expectedInputSha256, outputDirectory, stepId: 'transfer-step-0' }); }
  catch (error) { refusal = error; } finally { seam.uninstall(); }
  assert.equal(seam.launches(), 1);
  // Named at once, not a lost shortcut ending in the 10 s filechooser timeout.
  assert.ok(refusal instanceof RuntimeError, String(refusal));
  assert.equal(refusal.code, 'transfer_invalid');
  assert.match(refusal.message, /keyboard focus is on button#pn-focus-thief, outside the editor/);
  const terminal = JSON.parse(await readFile(join(outputDirectory, 'terminal.json'), 'utf8')) as { status: string; stage: string; primaryError: { message: string }; console: { messages: Array<{ type: string; text: string }>; dropped: number } };
  assert.equal(terminal.status, 'failed'); assert.equal(terminal.stage, 'open');
  assert.match(terminal.primaryError.message, /outside the editor/);
  assert.ok(terminal.console.messages.some(message => message.text === 'PN_FOCUS_THIEF moved focus'), 'the page console after readiness is attempt evidence');
  assert.ok(isPng(await readFile(join(outputDirectory, '00-before-open.png'))), 'a screenshot before Open is attempt evidence');
  assert.equal((await readdir(outputDirectory)).includes('result.json'), false);
});

test('native Open: a failed before-Open screenshot is recorded and does not fail the attempt', { timeout: 90_000 }, async context => {
  const root = await nativeEvidenceRoot('screenshot-');
  context.diagnostic(`Native Open screenshot failure evidence: ${root}`);
  const input = await h1NativeInput(root), outputDirectory = join(root, 'native-attempt');
  // Through the seam: only the first screenshot of the page (the one before Open) fails.
  const seam = installLaunchSeam({ page: page => {
    const screenshot = page.screenshot.bind(page); let first = true;
    page.screenshot = (options => { if (first) { first = false; return Promise.reject(new Error('independently assigned screenshot failure')); } return screenshot(options); }) as typeof page.screenshot;
  } });
  try { await nativeFileTransfer({ inputPath: input.inputPath, expectedInputSha256: input.expectedInputSha256, outputDirectory, stepId: 'transfer-step-0' }); }
  finally { seam.uninstall(); }
  const terminal = JSON.parse(await readFile(join(outputDirectory, 'terminal.json'), 'utf8')) as { status: string; diagnostics: { beforeOpenScreenshot: { message: string } | null } };
  assert.equal(terminal.status, 'succeeded');
  assert.equal(terminal.diagnostics.beforeOpenScreenshot?.message, 'independently assigned screenshot failure');
  const files = await readdir(outputDirectory);
  assert.equal(files.includes('00-before-open.png'), false); assert.equal(files.includes('01-opened.png'), true);
});

test('H1 native file: genuine Open, visible edit, native Undo, completed Save As and entire-file checker', { timeout: 90_000 }, async context => {
  const root = await nativeEvidenceRoot('h1-');
  // Keep attempt originals on success and failure; no re-run silently replaces this directory.
  context.diagnostic(`Native file attempt evidence: ${root}`);
    const { request, assigned, exported, inputPath, inputBytes, expectedInputSha256 } = await h1NativeInput(root);
    assert.equal(inputBytes.toString('utf8'), exported.native, 'Transport preserves the whole opaque native bytes');
    const transportVerdict = await checkerRequest({ ...request, mode: 'verdict', input: inputBytes.toString('utf8'), expectedBundleSha256: assigned.bundleSha256 }) as VerdictReply;
    assert.equal(transportVerdict.verdict.passed, true);
    const transferred = await nativeFileTransfer({ inputPath, expectedInputSha256, outputDirectory: join(root, 'native-attempt'), stepId: 'transfer-step-0' });
    assert.equal(transferred.evidence, 'SCRIPTED_HEADLESS'); assert.equal(transferred.visibleOsSighting, 'OPEN'); assert.deepEqual(transferred.networkAttempts, []);
    const { before, opened, edited, undone, saved } = transferred.snapshots;
    assert.deepEqual(before.tombstoneIds, ['b', 'b:text', 'bc']); assert.deepEqual(opened.tombstoneIds, []);
    assert.notDeepEqual(before.state, saved.state, 'Full-array identity remains RED after native tombstone normalization');
    assert.notEqual(before.sha256, saved.sha256, 'Native Save As is reported separately from byte transport');
    const moved = edited.state.objects['transfer-step-0'], original = opened.state.objects['transfer-step-0'];
    assert.ok(moved?.type === 'step' && original?.type === 'step'); assert.equal(moved.x, original.x + 5); assert.equal(moved.y, original.y);
    assertNativeTransferPreserved(opened, undone); assertNativeTransferPreserved(opened, saved);
    const actualSavedBytes = await readFile(transferred.savedPath);
    assert.equal(saved.sha256, createHash('sha256').update(actualSavedBytes).digest('hex')); assert.equal(saved.bytes, actualSavedBytes.length);
    const checked = await checkerRequest({ ...request, mode: 'verdict', input: actualSavedBytes.toString('utf8'), expectedBundleSha256: assigned.bundleSha256 }) as VerdictReply;
    assert.equal(checked.verdict.passed, true, JSON.stringify(checked.verdict)); assert.notEqual(checked.checkerPid, process.pid);
    assert.deepEqual(checked.verdict.counterprobes, { empty: false, unchanged: false, wrongArtifact: false });
    // Full-file negative controls: actual saved bytes with one damaged active label or relation.
    const raw = JSON.parse(actualSavedBytes.toString('utf8')) as { elements: Array<Record<string, unknown>> };
    const wrongLabel = structuredClone(raw);
    const text = wrongLabel.elements.find(element => element.type === 'text' && element.containerId === 'transfer-step-0')!; text.originalText = 'Wrong'; text.text = 'Wrong';
    const labelVerdict = await checkerRequest({ ...request, mode: 'verdict', input: JSON.stringify(wrongLabel), expectedBundleSha256: assigned.bundleSha256 }) as VerdictReply;
    assert.equal(labelVerdict.verdict.passed, false);
    const wrongBinding = structuredClone(raw), arrow = wrongBinding.elements.find(element => element.type === 'arrow')!; arrow.endBinding = null;
    for (const element of wrongBinding.elements) if (element.id === 'transfer-step-1') element.boundElements = (element.boundElements as Array<{ id: string }>).filter(reference => reference.id !== arrow.id);
    const bindingVerdict = await checkerRequest({ ...request, mode: 'verdict', input: JSON.stringify(wrongBinding), expectedBundleSha256: assigned.bundleSha256 }) as VerdictReply;
    assert.equal(bindingVerdict.verdict.passed, false);
    await writeFile(join(root, 'whole-file-verdicts.json'), JSON.stringify({ transportVerdict, savedVerdict: checked, labelVerdict, bindingVerdict,
      tombstoneIdenticalFullArray: false, nativeByteEqualTransport: before.sha256 === saved.sha256, wholeFileSha256: saved.sha256 }, null, 2), { flag: 'wx', mode: 0o600 });
});
