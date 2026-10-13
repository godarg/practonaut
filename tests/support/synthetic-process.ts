/** Local practice measurement. Run only against a frozen source stand; no capability claim. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Page } from 'playwright-core';
import { validateWorld } from '../../src/world/schema.ts';
import { startHost } from '../../src/host/server.ts';
import { createPracticeController } from '../../src/host/session.ts';
import { createProductionMirror } from '../../src/host/mirror.ts';
import { createExcalidrawAdapter } from '../../src/adapters/excalidraw/index.ts';
import { parseExcalidraw, validateCheckerData } from '../../src/checker/index.ts';
import { checkInProcess } from '../../src/cli/runtime.ts';
import { canonicalJson } from '../../src/canonical/index.ts';
import { packWorld } from '../../src/package/index.ts';
import { bindClient } from '../../src/evaluation/client.ts';
import { createPrivateOutput, redactCredential } from '../../src/evaluation/private-output.ts';
import type { HostReply, HostView } from '../../src/host/protocol.ts';
import type { CheckerData, State, World } from '../../src/world/types.ts';
import { nativeFileTransfer, inspectNativeTransferFile, assertNativeTransferPreserved } from '../../src/evaluation/transfer.ts';
import { runRealAgent } from '../../tools/agent-runs.ts';
import { syntheticProcessWorld, CYCLE_CONTENT_PROVENANCE } from './synthetic-process-world.ts';

export interface StagePreservationSpec { renames: Array<{ from: string; to: string }>; reconnects: Array<{ from: string; before: string; after: string }>; addedArrows: number }
export interface ProcessStage { id: string; taskId: string; world(previous: State | undefined): World; instruction: string; preserveExisting?: StagePreservationSpec; checker?: CheckerData }
/** Checks an update obligation that is deliberately separate from the end-state graph goal. */
export function checkStagePreservation(before: State, after: State, spec: StagePreservationSpec): { passed: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const [id, original] of Object.entries(before.objects)) {
    const actual = after.objects[id];
    if (!actual) { errors.push('Existing object missing: ' + id); continue; }
    const expected = structuredClone(original);
    if (expected.type === 'step') {
      const rename = spec.renames.find(item => item.from === expected.label);
      if (rename) expected.label = rename.to;
    } else if (expected.type === 'arrow') {
      const from = expected.from === null ? undefined : before.objects[expected.from], to = expected.to === null ? undefined : before.objects[expected.to];
      const reconnect = from?.type === 'step' && to?.type === 'step' ? spec.reconnects.find(item => item.from === from.label && item.before === to.label) : undefined;
      if (reconnect) {
        const targets = Object.values(before.objects).filter(item => item.type === 'step' && item.label === reconnect.after);
        if (targets.length !== 1) errors.push('Declared target is not uniquely available: ' + id);
        else expected.to = targets[0]!.id;
      }
    }
    if (canonicalJson(actual) !== canonicalJson(expected)) errors.push('Existing object differs beyond declared update: ' + id);
  }
  const added = Object.values(after.objects).filter(item => !Object.hasOwn(before.objects, item.id));
  if (added.length !== spec.addedArrows || added.some(item => item.type !== 'arrow' || item.deleted)) errors.push('Added objects do not match the declared arrow count');
  return { passed: errors.length === 0, errors };
}
export const artifactSha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** Additional native attempt; the original mirror, preservation and API roundtrip guards remain upstream. */
export async function runProcessNativeTransfer(input: { directory: string; native: string; world: World; seed: number; taskId: string; checker?: CheckerData }, transfer: typeof nativeFileTransfer = nativeFileTransfer) {
  const inputPath = join(input.directory, 'input.excalidraw'), outputDirectory = join(input.directory, 'native-transfer');
  const inputBytes = Buffer.from(input.native), before = inspectNativeTransferFile(inputBytes);
  const binding = { worldSha256: artifactSha256(canonicalJson(input.world)), seed: input.seed, taskId: input.taskId,
    checkerSha256: input.checker === undefined ? null : artifactSha256(canonicalJson(input.checker)), inputSha256: before.sha256, inputBytes: inputBytes.length };
  await writeFile(inputPath, inputBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(join(input.directory, 'native-transfer-binding.json'), JSON.stringify(binding, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  let terminalStage = 'input', savedBinding: { sha256: string; bytes: number } | undefined;
  try {
    assert.deepEqual(await readFile(inputPath), inputBytes, 'Transport must save the complete opaque mirror bytes');
    const stepId = Object.keys(before.state.objects).sort().find(id => { const object = before.state.objects[id]; return object?.type === 'step' && !object.deleted; });
    assert.ok(stepId, 'Successful process task must have an active native rectangle to edit');
    terminalStage = 'native-open-edit-undo-save';
    const transferred = await transfer({ inputPath, expectedInputSha256: before.sha256, outputDirectory, stepId });
    terminalStage = 'saved-file';
    assert.equal(transferred.inputPath, inputPath, 'Native attempt must use this exact saved input');
    assert.equal(resolve(transferred.savedPath), resolve(join(outputDirectory, 'native-saved.excalidraw')), 'Read the owned completed native download');
    assert.deepEqual(await readFile(inputPath), inputBytes, 'Native Open must not rewrite the opaque transport file');
    const savedBytes = await readFile(transferred.savedPath), saved = inspectNativeTransferFile(savedBytes);
    savedBinding = { sha256: saved.sha256, bytes: savedBytes.length };
    assert.equal(saved.sha256, transferred.snapshots.saved.sha256, 'Checker must consume the whole actually saved file');
    assert.equal(saved.bytes, transferred.snapshots.saved.bytes);
    assert.equal(transferred.snapshots.before.sha256, before.sha256);
    assert.deepEqual(transferred.networkAttempts, [], 'Native attempt must remain network silent');
    terminalStage = 'original-full-task-checker';
    // checkInProcess spawns the independent original checker. No state/goal projection is substituted.
    const verdict = await checkInProcess(input.world, savedBytes.toString('utf8'), { seed: input.seed, taskId: input.taskId, ...(input.checker === undefined ? {} : { bundle: input.checker }) });
    await writeFile(join(input.directory, 'native-saved-full-verdict.json'), JSON.stringify({ ...binding, saved: savedBinding, verdict }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    assert.deepEqual(verdict.counterprobes, { empty: false, unchanged: false, wrongArtifact: false });
    assert.deepEqual(verdict.tasks.map(task => task.taskId), [input.taskId]);
    terminalStage = 'additional-active-native-oracles';
    assertNativeTransferPreserved(before, transferred.snapshots.opened);
    assertNativeTransferPreserved(transferred.snapshots.opened, transferred.snapshots.undone);
    assertNativeTransferPreserved(transferred.snapshots.opened, saved);
    assert.deepEqual(transferred.edit, { stepId, dx: 5, dy: 0 });
    const original = transferred.snapshots.opened.state.objects[stepId], moved = transferred.snapshots.edited.state.objects[stepId];
    assert.ok(original?.type === 'step' && moved?.type === 'step');
    assert.equal(moved.x, original.x + 5); assert.equal(moved.y, original.y);
    const expectedEdit = structuredClone(transferred.snapshots.opened.state), expectedStep = expectedEdit.objects[stepId];
    assert.ok(expectedStep?.type === 'step'); expectedStep.x += 5;
    assert.equal(canonicalJson(transferred.snapshots.edited.state), canonicalJson(expectedEdit), 'Exactly the declared rectangle move precedes native Undo');
    const result = { binding, saved: savedBinding, verdict, native: transferred, passed: verdict.passed,
      supplementalActivePreservation: true, nativeByteEqualTransport: inputBytes.equals(savedBytes),
      tombstoneIdenticalFullState: canonicalJson(before.state) === canonicalJson(saved.state),
      criteria: { transport: 'whole opaque byte copy', native: 'original full task plus active identity/label/frame/bindings; documented native normalization reported separately' } };
    await writeFile(join(input.directory, 'native-transfer-check.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return result;
  } catch (error) {
    await writeFile(join(input.directory, 'native-transfer-check-failure.json'), JSON.stringify({ binding, terminalStage, saved: savedBinding, passed: false,
      error: { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : 'Unknown native process transfer failure' }, retry: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    throw error;
  }
}
/** Shared mechanics only. Stage content and source evidence are supplied by the caller. */
export async function runProcessStages(options: { output: string; clientPath: string; stages: ProcessStage[]; contentProvenance: unknown }): Promise<{ output: string; passed: boolean }> {
  if (!isAbsolute(options.clientPath)) throw Error('An explicit absolute client executable is required');
  const binding = await bindClient(options.clientPath);
  const output = await createPrivateOutput(options.output);
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
  const dirty = execFileSync('git', ['status', '--porcelain']).toString().trim();
  const stages: unknown[] = []; let previous: State | undefined; let passed = true;
  const manifest = async (): Promise<void> => { await writeFile(join(output, 'manifest.json'), JSON.stringify({ measuredAt: new Date().toISOString(), head: sourceHead, dirty, contentProvenance: options.contentProvenance, executable: binding, stages, passed, claims: { evidenceClass: 'practice-only', C5: false, C6: 'UNKNOWN', humanDemonstration: 'not performed', humanTiming: 'UNKNOWN', revenueImpact: 'UNKNOWN', earlierResultsInherited: false } }, null, 2) + '\n', { mode: 0o600 }); };
  await manifest();
  for (const stage of options.stages) {
    const directory = await createPrivateOutput(join(output, stage.id));
    const world = validateWorld(stage.world(previous));
    const checker = stage.checker === undefined ? undefined : validateCheckerData(stage.checker, world);
    const checkerOptions = checker === undefined ? {} : { bundle: checker };
    await writeFile(join(directory, 'world.json'), JSON.stringify(world, null, 2) + '\n', { mode: 0o600 });
    if (checker) await writeFile(join(directory, 'checker.json'), JSON.stringify(checker, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const source = await mkdtemp(join(tmpdir(), 'pn-process-world-'));
    try { await writeFile(join(source, 'world.json'), JSON.stringify(world)); await writeFile(join(directory, 'world.pnworld'), await packWorld(source), { mode: 0o600 }); }
    finally { await rm(source, { recursive: true, force: true }); }
    let enginePage: Page | undefined;
    const host = await startHost(world, { seed: 42, taskId: stage.taskId, mirror: 'required', controllerFactory: (input, settings) => createPracticeController(input, settings ?? {}, initial => createProductionMirror(initial, { ready(_browser, page) { enginePage = page; } })) });
    const started = new Date().toISOString(), beginning = performance.now();
    let agent: unknown, agentFailure: string | undefined;
    const errors: string[] = []; let stateHash: string | undefined; let acceptedActions: number | undefined;
    let nativeHash: string | undefined; let verdict: unknown; let editorTransfer: unknown; let preservation: unknown; let nativeTransfer: unknown;
    try {
      const initial = await (await fetch(host.origin + '/api/observe', { headers: { 'X-Practonaut-Token': host.token } })).json() as HostReply<HostView>;
      assert.ok(initial.ok, 'Beginning shared state must be observable');
      await writeFile(join(directory, 'beginning-state.json'), JSON.stringify(initial.value.state, null, 2) + '\n', { mode: 0o600 });
      // This helper creates a fresh empty client working directory and binds the executable bytes.
      try { agent = await runRealAgent(host, stage.instruction, join(directory, 'agent'), { world, clientPath: options.clientPath }); }
      catch (error) { agentFailure = redactCredential(error instanceof Error ? error.message : 'Unknown agent failure', host.token, host.code); errors.push('agent failed; original stream retained in agent/'); }
      const reply = await (await fetch(host.origin + '/api/observe', { headers: { 'X-Practonaut-Token': host.token } })).json() as HostReply<HostView>;
      assert.ok(reply.ok, 'Final shared state must be observable'); assert.ok(enginePage, 'Real engine must be available');
      previous = reply.value.state; stateHash = reply.value.hash; acceptedActions = reply.value.log.length;
      if (stage.preserveExisting) { preservation = checkStagePreservation(initial.value.state, previous, stage.preserveExisting); if (!(preservation as { passed: boolean }).passed) errors.push('Update did not preserve the declared existing objects and layout'); }
      await writeFile(join(directory, 'state.json'), JSON.stringify(previous, null, 2) + '\n', { mode: 0o600 });
      const native = JSON.stringify(await enginePage.evaluate('({type:"excalidraw",version:2,source:"practonaut",elements:window.__pn.read(),appState:{viewBackgroundColor:"#ffffff"},files:{}})'));
      // Retain actual bytes before parsing or checking. No annotations or metadata are added later.
      await writeFile(join(directory, 'diagram.excalidraw'), native, { mode: 0o600 }); nativeHash = artifactSha256(native);
      const svg = await enginePage.evaluate<string>('window.__pn.svg()'); await writeFile(join(directory, 'diagram.svg'), svg, { mode: 0o600 });
      const image = await fetch(host.origin + '/api/tool.png', { headers: { 'X-Practonaut-Token': host.token } });
      if (image.status === 200) await writeFile(join(directory, 'diagram.png'), new Uint8Array(await image.arrayBuffer()), { mode: 0o600 });
      else errors.push('Mirror image unavailable: HTTP ' + image.status);
      assert.equal(canonicalJson(parseExcalidraw(native)), canonicalJson(previous), 'Actual mirror export must equal shared state');
      const checked = await checkInProcess(world, native, { seed: 42, taskId: stage.taskId, ...checkerOptions }); verdict = checked;
      if (!checked.passed) errors.push('Actual native end state did not satisfy the checker');
      // Open the exact native bytes in a second real editor process, with no Session or goal feedback.
      const editor = await createExcalidrawAdapter({ objects: {} });
      try {
        const imported = await editor.importArtifact(native); assert.ok(imported.ok, 'Separate real editor import must succeed');
        const roundtrip = await editor.exportArtifact();
        await writeFile(join(directory, 'editor-roundtrip.excalidraw'), roundtrip.native, { mode: 0o600 });
        await writeFile(join(directory, 'editor-roundtrip.svg'), roundtrip.svg, { mode: 0o600 });
        const roundtripVerdict = await checkInProcess(world, roundtrip.native, { seed: 42, taskId: stage.taskId, ...checkerOptions });
        const sameState = canonicalJson(parseExcalidraw(roundtrip.native)) === canonicalJson(previous);
        editorTransfer = { inputSha256: nativeHash, roundtripSha256: roundtrip.nativeSha256, sameState, networkAttempts: editor.networkAttempts(), verdict: roundtripVerdict, mode: 'exact artifact import and export in a second real editor; no metadata injection' };
        if (!sameState || !roundtripVerdict.passed || editor.networkAttempts().length) errors.push('Separate editor transfer did not preserve a passing native end state');
      } finally { await editor.close(); }
      if (errors.length === 0) {
        const transferred = await runProcessNativeTransfer({ directory, native, world, seed: 42, taskId: stage.taskId, ...(checker === undefined ? {} : { checker }) });
        nativeTransfer = transferred;
        if (!transferred.passed) errors.push('Actually saved native file did not satisfy the original complete task');
      }
    } catch (error) { errors.push(redactCredential(error instanceof Error ? error.message : 'Unknown measurement failure', host.token, host.code)); }
    finally { await host.close(); }
    const row = { stage: stage.id, started, finished: new Date().toISOString(), durationMs: performance.now() - beginning, stateHash, acceptedActions, nativeSha256: nativeHash, agent, agentFailure, verdict, editorTransfer, preservation, nativeTransfer, errors, passed: errors.length === 0 };
    stages.push(row); await writeFile(join(directory, 'measurement.json'), JSON.stringify(row, null, 2) + '\n', { mode: 0o600 });
    if (!row.passed) passed = false;
    await manifest();
    // One original attempt per stage. An unsuccessful predecessor cannot become an assumed solution.
    if (!row.passed) break;
  }
  return { output, passed };
}

async function main(): Promise<void> {
  const [output, clientPath, ...extra] = process.argv.slice(2);
  if (!output || !clientPath || extra.length) throw Error('Usage: node tests/support/synthetic-process.ts <new-private-output-dir> <absolute-client-executable>');
  const reference = validateWorld(JSON.parse(await readFile('examples/worlds/flow-diagram/world.json', 'utf8')));
  const result = await runProcessStages({ output: resolve(output), clientPath, contentProvenance: CYCLE_CONTENT_PROVENANCE, stages: [
    { id: 'construction', taskId: 'S1', world: () => syntheticProcessWorld(reference), instruction: 'Solve the public S1 task using only Practonaut MCP tools. Observe the state and action definitions, use observed revision and step, and check the final result. Follow the given layout. Do not reset.' },
    { id: 'revision', taskId: 'S1', world: previous => syntheticProcessWorld(reference, true, previous), preserveExisting: { renames: [{ from: 'Inspect', to: 'Verify' }], reconnects: [{ from: 'Link', before: 'Inspect', after: 'Polish' }, { from: 'Inspect', before: 'Polish', after: 'Store' }, { from: 'Polish', before: 'Store', after: 'Inspect' }], addedArrows: 0 }, instruction: 'Solve the public S1 revision task using only Practonaut MCP tools. Observe and preserve all existing objects and layout. Rename the requested label and change only the requested bound endpoints. Use observed revision and step and check the final result. Do not reset.' },
  ] });
  console.log(JSON.stringify(result)); if (!result.passed) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 2; });
