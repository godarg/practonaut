// practonaut.bench/2 end to end (PADR-0036): a task made with `tasks from-scenes` is benched with
// --world and --oracle, the bench folder is moved and re-verified there against the world stored in
// it; a changed stored world, artifact or reference fails by name; the oracle sidecar never reaches
// the agent; a command template keeps the model its output reports; a stored bench/1 report is read
// and re-verified as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrow, between, box, scene } from '../support/scenes.ts';
import { libraryWorld } from '../../src/bench/run.ts';
import { worldContentHash, worldFromPackage } from '../../src/bench/world.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const AGENT = fileURLToPath(new URL('../support/bench-agent.ts', import.meta.url));
const V1_FIXTURE = fileURLToPath(new URL('../fixtures/bench/v1/', import.meta.url));
const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: process.env });
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const benchRoot = (): string => join(process.env.PRACTONAUT_HOME!, 'bench');
const benches = async (): Promise<Set<string>> => new Set(await readdir(benchRoot()).catch(() => [] as string[]));
/** The bench folder the last command created (exactly one). */
async function newBench(before: Set<string>): Promise<string> {
  const created = [...await benches()].filter(name => !before.has(name));
  assert.equal(created.length, 1, `one new bench folder, found ${created.join(', ')}`);
  return join(benchRoot(), created[0]!);
}
/** Report and oracle JSON, edited by hand in the forgeries below. */
type Json = Record<string, any>;
const json = async (path: string): Promise<Json> => JSON.parse(await readFile(path, 'utf8')) as Json;

/** A task authored like a user would: two drawings, then `tasks from-scenes` through the CLI. */
async function authoredTask(dir: string): Promise<{ world: string; oracle: string }> {
  const a = { x: 100, y: 100 }, b = { x: 400, y: 100 }, c = { x: 700, y: 100 };
  await writeFile(join(dir, 'start.excalidraw'), scene([box('a', 'Draft', a.x, a.y), box('b', 'Review', b.x, b.y), box('c', 'Send', c.x, c.y), arrow('ab', 'a', 'b', between(a, b))]));
  await writeFile(join(dir, 'goal.excalidraw'), scene([box('a', 'Draft', a.x, a.y), box('b', 'Review', b.x, b.y, { fill: '#b2f2bb' }), box('c', 'Send', c.x, c.y), arrow('ab', 'a', 'b', between(a, b)), arrow('bc', 'b', 'c', between(b, c))]));
  const made = cli('tasks', 'from-scenes', join(dir, 'start.excalidraw'), join(dir, 'goal.excalidraw'), '--out', join(dir, 'my-task'));
  assert.equal(made.status, 0, made.stderr);
  return { world: join(dir, 'my-task', 'world'), oracle: join(dir, 'my-task', 'oracle.json') };
}

test('an authored task is benched with its oracle and the real mirror; the moved bench folder re-verifies; changes fail by name', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-own-bench-'));
  try {
    const task = await authoredTask(dir);
    // Expected values from the author's files, not from the runner.
    const oracle = await json(task.oracle);
    const steps = (oracle.steps as unknown[]).length;
    // Another world under the same id and version (a changed title), packed by the CLI.
    const otherSource = join(dir, 'other'); await mkdir(otherSource);
    const otherWorld = await json(join(task.world, 'world.json')); const originalTitle = otherWorld.tasks[0].title.en as string; otherWorld.tasks[0].title.en = 'Something else';
    await writeFile(join(otherSource, 'world.json'), JSON.stringify(otherWorld));
    assert.equal(cli('pack', otherSource, '--out', join(dir, 'other.pnworld')).status, 0);

    const before = await benches();
    const bench = cli('bench', '--agent', 'oracle', '--world', task.world, '--oracle', task.oracle, '--seed-list', '2,5', '--label', 'Own task «1»', '--mirror', 'required');
    assert.equal(bench.status, 0, bench.stderr);
    assert.match(bench.stderr, /world my-task 1\.0\.0 \(your own\), 1 of 1 benched task has a validated reference/);
    const folder = await newBench(before);
    const report = await json(join(folder, 'report.json'));
    assert.equal(report.schema, 'practonaut.bench/2');
    assert.equal(report.label, 'Own task «1»');
    assert.deepEqual([report.environment.world.source, report.environment.world.worldId, report.environment.world.package.path, report.environment.mirror], ['own', 'my-task', 'world.pnworld', 'required']);
    assert.equal(report.environment.world.package.sha256, sha256(await readFile(join(folder, 'world.pnworld'))));
    // Hand reasoning: Review's fill and the new arrow are two objects no single action changes
    // together, so the two-action reference is minimal (PADR-0040).
    assert.deepEqual(report.references.tasks, [{ taskId: 'my-task', source: 'oracle-file', actions: steps, minimal: true }]);
    assert.equal(steps, 2);
    assert.deepEqual([report.agent.isolation, report.agent.modelSource, report.agent.apiKeySource], ['builtin-baseline', 'none', null]);
    assert.deepEqual(report.settings.seeds, [2, 5]);
    for (const run of report.runs) {
      assert.equal(run.pass, true, run.id); assert.equal(run.checker.native.passed, true, run.id);
      assert.equal(run.actions, steps); assert.equal(run.referenceActions, steps);
    }
    assert.deepEqual(report.runs.map((run: Json) => run.id), ['my-task-s2-r1', 'my-task-s5-r1']);
    assert.equal(report.summary.efficiencyVsReference, 1);
    assert.equal(JSON.stringify(report).includes(dir), false, 'no local path in the report');

    // Move the bench folder; the author's world and oracle are gone too.
    const moved = join(dir, 'archive', 'moved-bench');
    await cp(folder, moved, { recursive: true }); await rm(folder, { recursive: true, force: true });
    await rm(join(dir, 'my-task'), { recursive: true, force: true });
    const verified = cli('report', join(moved, 'report.json'), '--verify');
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /Re-verified: 2 runs re-judged by the checker from their artifacts, against the world stored in the bench folder \(my-task 1\.0\.0\); every verdict matches \(0 not judged\); 1 reference re-checked/);
    assert.match(verified.stdout, /^Label: Own task «1»$/m);

    /** A copy of the moved folder, changed by `mutate`, then verified. */
    let copies = 0;
    const changed = async (mutate: (copy: string, report: Json) => Promise<void>): Promise<ReturnType<typeof cli>> => {
      const copy = join(dir, `copy-${++copies}`); await cp(moved, copy, { recursive: true });
      const value = await json(join(copy, 'report.json')); await mutate(copy, value); await writeFile(join(copy, 'report.json'), JSON.stringify(value));
      // Every change here keeps the report itself consistent: only --verify can see it.
      const plain = cli('report', join(copy, 'report.json')); assert.equal(plain.status, 0, plain.stderr);
      return cli('report', join(copy, 'report.json'), '--verify');
    };
    const refused = (result: ReturnType<typeof cli>, code: string, message: RegExp): void => {
      assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, new RegExp(`${message.source}.*\\[${code}\\]`)); assert.equal(result.stdout, '');
    };
    refused(await changed(async copy => { await appendFile(join(copy, 'world.pnworld'), Buffer.from([0])); }), 'bench_world_changed', /the stored world world\.pnworld does not match the hash the report binds/);
    refused(await changed(async copy => { await rm(join(copy, 'world.pnworld')); }), 'bench_world_changed', /the stored world world\.pnworld is missing or unreadable/);
    // Another valid world under the same id and version, with the report's hash updated to it.
    refused(await changed(async (copy, value) => {
      const bytes = await readFile(join(dir, 'other.pnworld')); await writeFile(join(copy, 'world.pnworld'), bytes);
      value.environment.world.package.sha256 = sha256(bytes);
    }), 'bench_world_changed', /the stored world is my-task 1\.0\.0 \(content [a-f0-9]{12}…\), the report names my-task 1\.0\.0/);
    refused(await changed(async copy => { await appendFile(join(copy, 'my-task-s5-r1', 'session.json'), ' '); }), 'bench_artifact_changed', /run my-task-s5-r1: artifact session\.json does not match the hash the report binds/);
    refused(await changed(async copy => { await appendFile(join(copy, 'my-task-s2-r1', 'native.excalidraw'), ' '); }), 'bench_artifact_changed', /run my-task-s2-r1: artifact native\.excalidraw does not match/);
    refused(await changed(async copy => { await appendFile(join(copy, 'references.json'), ' '); }), 'bench_artifact_changed', /the stored references references\.json do not match the hash the report binds/);
    // Larger than the 64 MiB the threat model allows: not read at all.
    refused(await changed(async copy => { await writeFile(join(copy, 'references.json'), Buffer.alloc(64 * 1024 * 1024 + 1, 32)); }), 'bench_artifact_changed', /the stored references references\.json are missing or unreadable/);
    // A consistent forgery of the reference: a near miss stored as the reference, every hash and
    // length in the report updated to it. The checker does not accept it.
    refused(await changed(async (copy, value) => {
      const references = await json(join(copy, 'references.json'));
      references.references[0].oracle.steps = oracle.nearMisses[0].steps;
      const text = JSON.stringify(references); await writeFile(join(copy, 'references.json'), text);
      const length = oracle.nearMisses[0].steps.length;
      value.references.sha256 = sha256(text); value.references.tasks[0].actions = length;
      for (const run of value.runs) run.referenceActions = length;
      // The summary follows from the runs, so the consistency check alone cannot see the forgery.
      const efficiency = Math.round(length / steps * 10_000) / 10_000;
      value.summary.efficiencyVsReference = efficiency; value.summary.byTask[0].referenceActions = length; value.summary.byTask[0].efficiency = efficiency;
    }), 'bench_reference_invalid', /the reference of task my-task does not pass the checker: with seed 2 it does not reach the goal/);
    // A minimality claim the analysis on the stored world does not make.
    refused(await changed(async (_copy, value) => { value.references.tasks[0].minimal = false; }), 'bench_reference_invalid', /task my-task: the report says the reference is a reference length; the minimal-length analysis on the stored world says proven minimal/);
    // A consistent forgery of the world: the same task with an action limit below the runs' history
    // length, every world hash in the report updated to it. The host would never have let the runs
    // take more actions than the limit, so --verify refuses them.
    const limitedSource = join(dir, 'limited'); await mkdir(limitedSource);
    const limitedWorld = await json(join(otherSource, 'world.json'));
    limitedWorld.tasks[0].title.en = originalTitle; limitedWorld.tasks[0].limits = { actions: 1 };
    await writeFile(join(limitedSource, 'world.json'), JSON.stringify(limitedWorld));
    assert.equal(cli('pack', limitedSource, '--out', join(dir, 'limited.pnworld')).status, 0);
    refused(await changed(async (copy, value) => {
      const bytes = await readFile(join(dir, 'limited.pnworld')); await writeFile(join(copy, 'world.pnworld'), bytes);
      value.environment.world.package.sha256 = sha256(bytes);
      value.environment.world.contentHash = worldContentHash(await worldFromPackage(bytes));
    }), 'bench_report_invalid', /run my-task-s2-r1: its final history holds 2 actions, more than the task's action limit of 1/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the oracle sidecar never reaches the agent; references enter the bench folder only after the last agent ended', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-own-snoop-'));
  try {
    const task = await authoredTask(dir);
    const before = await benches();
    const snoop = cli('bench', '--agent', `${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} snoop {mcp_config}`, '--world', task.world, '--oracle', task.oracle, '--seeds', '2', '--mirror', 'off');
    assert.equal(snoop.status, 0, snoop.stderr);
    const folder = await newBench(before);
    for (const run of ['my-task-s1-r1', 'my-task-s2-r1']) {
      const seen = await json(join(folder, run, 'agent', 'snoop.json')) as { files: string[]; hits: string[]; replyHits: number };
      assert.ok(seen.files.includes('world.pnworld'), `${run} could read the bench folder: ${seen.files.join(', ')}`);
      assert.equal(seen.files.includes('references.json'), false, `${run} saw references.json`);
      assert.deepEqual(seen.hits, [], `${run} found a reference solution in ${seen.hits.join(', ')}`);
      assert.equal(seen.replyHits, 0, `${run}: an MCP reply carried reference data`);
    }
    // Positive control: what the agent looked for is in references.json, which exists now.
    const references = await readFile(join(folder, 'references.json'), 'utf8');
    assert.match(references, /practonaut\.bench-references/); assert.match(references, /practonaut\.task-oracle/); assert.match(references, /nearMisses/);
    const report = await json(join(folder, 'report.json'));
    assert.deepEqual([report.agent.isolation, report.runs[0].pass], ['template-unrestricted', false]);
    assert.equal(report.summary.efficiencyVsReference, null, 'no passed run, no efficiency');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a template keeps the model its output reports; a task without a reference shows "no reference"; refusals by name', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-own-template-'));
  try {
    const task = await authoredTask(dir);
    const out = join(dir, 'template.json');
    const template = cli('bench', '--agent', `${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} init {mcp_config}`, '--tasks', 'connect', '--mirror', 'off', '--out', out);
    assert.equal(template.status, 0, template.stderr);
    const report = await json(out);
    assert.deepEqual([report.agent.model, report.agent.modelSource, report.agent.apiKeySource, report.agent.isolation, report.agent.keptEnv], ['pn-test-model', 'command-output', 'none', 'template-unrestricted', []]);
    assert.equal(report.runs[0].pass, true);
    assert.match(cli('report', out).stdout, /model pn-test-model/);

    // Random on the own world without an oracle: scored, but no reference and no efficiency.
    const randomOut = join(dir, 'random.json');
    const random = cli('bench', '--agent', 'random', '--world', task.world, '--mirror', 'off', '--max-actions', '3', '--out', randomOut);
    assert.equal(random.status, 0, random.stderr);
    assert.match(random.stderr, /0 of 1 benched task has a validated reference/);
    const unreferenced = await json(randomOut);
    assert.deepEqual([unreferenced.references, unreferenced.runs[0].referenceActions, unreferenced.summary.efficiencyVsReference], [null, null, null]);
    assert.match(random.stdout, /efficiency vs reference length no reference/);
    assert.match(random.stdout, /^my-task .* no reference +no reference$/m);

    // Refused before any run starts, and no bench folder is created.
    const before = await benches();
    const nearMiss = await json(task.oracle); nearMiss.steps = nearMiss.nearMisses[0].steps;
    await writeFile(join(dir, 'near-miss.json'), JSON.stringify(nearMiss));
    const invalid = cli('bench', '--agent', 'oracle', '--world', task.world, '--oracle', join(dir, 'near-miss.json'), '--mirror', 'off');
    assert.equal(invalid.status, 2); assert.match(invalid.stderr, /the reference of task my-task does not pass the checker: with seed 1 it does not reach the goal.*\[bench_oracle_invalid\]/);
    const other = await json(task.oracle); other.worldId = 'someone-else';
    await writeFile(join(dir, 'other.json'), JSON.stringify(other));
    const foreign = cli('bench', '--agent', 'random', '--world', task.world, '--oracle', join(dir, 'other.json'), '--mirror', 'off');
    assert.equal(foreign.status, 2); assert.match(foreign.stderr, /is the oracle of world someone-else, not of my-task.*\[bench_oracle_invalid\]/);
    const noOracle = cli('bench', '--agent', 'oracle', '--world', task.world, '--mirror', 'off');
    assert.equal(noOracle.status, 1); assert.match(noOracle.stderr, /the oracle agent plays each task's reference solution; give --oracle <file> for my-task/);
    const inside = join(dir, 'inside'); await cp(task.world, inside, { recursive: true }); await cp(task.oracle, join(inside, 'oracle.json'));
    const packed = cli('bench', '--agent', 'random', '--world', inside, '--oracle', join(inside, 'oracle.json'), '--mirror', 'off');
    assert.equal(packed.status, 2, 'an oracle inside the world folder would be packed with the world: the folder is refused'); assert.match(packed.stderr, /\[E_SOURCE_INVALID\]/);
    assert.deepEqual(await benches(), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a stored bench/1 report is read and re-verified as before', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-bench-v1-'));
  try {
    // A copy, so the fixture is also "moved": its run folders lie next to the report.
    await cp(V1_FIXTURE, dir, { recursive: true });
    const path = join(dir, 'report.json'), fixture = await json(path);
    const plain = cli('report', path);
    assert.equal(plain.status, 0, plain.stderr); assert.match(plain.stdout, /Consistency-checked, not re-verified/);
    assert.equal(JSON.parse(cli('report', path, '--json').stdout).schema, 'practonaut.bench/1');
    const verified = cli('report', path, '--verify');
    // bench/1 re-judges against the bundled library: possible while this Practonaut ships the same
    // library content, refused by name once the library has changed (as in 0.1.0).
    if ((await libraryWorld()).contentHash === fixture.environment.library.contentHash) {
      assert.equal(verified.status, 0, verified.stderr);
      assert.match(verified.stdout, /Re-verified: 2 runs re-judged by the checker from their artifacts; every verdict matches \(0 not judged\)/);
      await appendFile(join(dir, 'connect-s1-r1', 'checker.json'), ' ');
      const tampered = cli('report', path, '--verify');
      assert.equal(tampered.status, 2); assert.match(tampered.stderr, /run connect-s1-r1: artifact checker\.json does not match the hash the report binds.*\[bench_report_invalid\]/);
      // A /1 report without artifact bindings (earlier builds) is consistency-checked only.
      for (const run of fixture.runs) delete run.artifacts;
      await writeFile(join(dir, 'unbound.json'), JSON.stringify(fixture));
      assert.equal(cli('report', join(dir, 'unbound.json')).status, 0);
      const unbound = cli('report', join(dir, 'unbound.json'), '--verify');
      assert.equal(unbound.status, 2); assert.match(unbound.stderr, /binds no artifacts; the report can be consistency-checked but not re-verified/);
    } else {
      assert.equal(verified.status, 2); assert.match(verified.stderr, /report was made with library excalidraw-library 1\.1\.0.*cannot be re-judged here.*\[bench_report_invalid\]/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
