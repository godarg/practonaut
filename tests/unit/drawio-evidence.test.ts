// PADR-0049 decisions 8.6 and 8.9: the committed draw.io acceptance evidence holds what it claims. Both
// oracle reports are bench/3 at the session level with the real mirror, every run judged on the session
// and on the native export; compare pairs 48 of 48 task identities with equal run counts and no
// difference; the three-run summary is complete and agrees; and no file holds a local path or a draw.io
// release. The re-verification from the stored folders is in tests/integration/drawio-evidence-*.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBenchReportV3 } from '../../src/bench/report.ts';
import { compareReports } from '../../src/bench/compare.ts';
import { summaryProblems } from '../../tools/require-drawio-summary.ts';
import { addedBenchFolder, benchEntries, checkoutSample } from '../../tools/drawio-evidence.ts';
import { checkoutOf } from '../support/drawio-run.ts';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url)), dir = join(root, 'docs/benchmarks/drawio');
const report = (name: string) => validateBenchReportV3(JSON.parse(readFileSync(join(dir, name, 'report.json'), 'utf8')));

test('both oracle reports: bench/3, real mirror, every run judged on the session and the native export and passed', () => {
  for (const [name, app, version, world] of [['excalidraw-oracle', 'excalidraw', '0.18.1', 'excalidraw-library'], ['drawio-oracle', 'drawio', '32.4.1', 'drawio-library']] as const) {
    const value = report(name);
    assert.deepEqual([value.verdictLevel, value.environment.app, value.environment.mirror, value.environment.world.source, value.environment.world.worldId], ['session', { adapterId: app, version }, 'required', 'library', world], name);
    assert.deepEqual([value.settings.seeds, value.settings.repeats, value.runs.length], [[0, 2, 4], 1, 48], name);
    for (const run of value.runs as Array<{ id: string; pass: boolean; checker: { session: { passed: boolean }; native: { passed: boolean } | null } | null }>) {
      assert.ok(run.pass && run.checker?.session.passed && run.checker.native?.passed, `${name} ${run.id}`);
    }
  }
});

test('compare pairs all 48 task identities with equal run counts and no different outcome', () => {
  const comparison = compareReports(report('excalidraw-oracle'), report('drawio-oracle'));
  assert.equal(comparison.pairing, 'identity');
  assert.equal(comparison.pairs.length, 48);
  assert.ok(comparison.pairs.every(pair => pair.kind === 'paired' && pair.baseline?.repeats === pair.candidate?.repeats && pair.baseline?.outcome === 'pass' && pair.candidate?.outcome === 'pass'));
  assert.deepEqual([comparison.discordant.baselineOnly, comparison.discordant.candidateOnly], [0, 0]);
  const committed = JSON.parse(readFileSync(join(dir, 'compare.json'), 'utf8')) as { baseline: { verification: string }; candidate: { verification: string }; comparison: { paired: number } };
  assert.deepEqual([committed.baseline.verification, committed.candidate.verification, committed.comparison.paired], ['re-verified', 're-verified', 48]);
});

test('the three-run summary: complete, every run 303 sequences, every task as expected, no disagreement, bound to the commit the README names', () => {
  const text = readFileSync(join(dir, 'conformance-summary.json'), 'utf8');
  const summary = JSON.parse(text) as { commit: string; dirty: boolean; chromium: string; sandbox: { policy: string; observed: Array<{ processes: number; noSandbox: number }> }; runs: Array<{ order: string; sequences: number; refusedRequests: number; byTask: Record<string, { referencesPassed: string; nearMissesFailed: string; startsFailed: string }> }>; pin: { version: string } };
  // Made from a clean checkout of one commit, over every planned sequence; the README says which commit.
  assert.deepEqual(summaryProblems(text, { commit: summary.commit, planned: 303 }), []);
  assert.equal(summary.dirty, false);
  assert.ok(readFileSync(join(dir, 'README.md'), 'utf8').includes(summary.commit.slice(0, 7)), 'the README names the summary\'s commit');
  // The sandbox and the browser are observations of each run, not settings (review m2c).
  assert.equal(summary.sandbox.policy, 'required');
  for (const seen of summary.sandbox.observed) { assert.ok(seen.processes > 0); assert.equal(seen.noSandbox, 0); }
  assert.match(summary.chromium, /^\d+\.\d+\.\d+\.\d+$/);
  assert.deepEqual(summary.runs.map(run => run.order), ['forward', 'reverse', 'shuffle']);
  assert.equal(summary.pin.version, '32.4.1');
  for (const run of summary.runs) {
    assert.equal(run.sequences, 303); assert.equal(run.refusedRequests, 0);
    assert.equal(Object.keys(run.byTask).length, 16 + 15);
    for (const [task, counts] of Object.entries(run.byTask)) for (const value of Object.values(counts)) { const [done, total] = value.split('/').map(Number); assert.equal(done, total, `${run.order} ${task}`); }
  }
});

test('a summary that is not evidence for this commit, this pin and a sandboxed Chromium is refused by name (review m2c)', () => {
  const commit = 'a'.repeat(40), observed = { samples: 2, processes: 4, noSandbox: 0 };
  const good = {
    schema: 'practonaut.drawio-conformance/2', commit, dirty: false, chromium: '156.0.8078.4',
    sandbox: { policy: 'required', observed: [observed, observed, observed] },
    pin: { version: '32.4.1', size: 48_442_174, sha256: 'b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820' },
    runs: [1, 2, 3].map(() => ({ sequences: 303, chromium: '156.0.8078.4' })), disagreements: 0, problems: [],
  };
  const binding = { commit, planned: 303 };
  assert.deepEqual(summaryProblems(JSON.stringify(good), binding), []);
  const refused = (change: (s: typeof good & Record<string, unknown>) => void, pattern: RegExp, bound = true): void => {
    const copy = structuredClone(good) as typeof good & Record<string, unknown>; change(copy);
    const problems = summaryProblems(JSON.stringify(copy), bound ? binding : undefined);
    assert.ok(problems.some(problem => pattern.test(problem)), `${pattern}: ${problems.join('; ')}`);
  };
  // The forged summary of the review: another commit, another pin, the sandbox off, one sequence a run.
  refused(s => { s.commit = '0000000'; }, /names no commit/, false);
  refused(s => { s.pin.version = '1.0.0'; }, /not for the pinned draw\.io 32\.4\.1/, false);
  refused(s => { (s as Record<string, unknown>).sandbox = 'off'; }, /policy is not required/, false);
  refused(s => { s.runs.forEach(run => { run.sequences = 1; }); }, /run 1 has 1 sequences, the protocol plans 303/);
  // Bound to the commit: another commit, or a checkout with changes.
  refused(s => { s.commit = 'b'.repeat(40); }, /made on bbbbbbbbbbbb, not on aaaaaaaaaaaa/);
  refused(s => { s.dirty = true; }, /changes not in its commit/);
  // The sandbox observed, not assumed: no process seen, or one without its sandbox.
  refused(s => { s.sandbox.observed[1] = { samples: 1, processes: 0, noSandbox: 0 }; }, /run 2: no Chromium process was observed/, false);
  refused(s => { s.sandbox.observed[2] = { samples: 1, processes: 4, noSandbox: 1 }; }, /run 3: 1 Chromium processes ran with --no-sandbox/, false);
  refused(s => { (s.sandbox.observed as unknown[])[0] = null; }, /run 1: no Chromium process was observed/, false);
  // One Chromium version, named, for every run.
  refused(s => { (s as Record<string, unknown>).chromium = undefined; }, /no single Chromium version/, false);
  refused(s => { s.runs[1]!.chromium = '155.0.0.0'; }, /run 2 ran another Chromium/, false);
});

test('the evidence tool takes the bench folder from PRACTONAUT_HOME, not from printed text (review m2c)', () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-evidence-'));
  try {
    const before = benchEntries(home);
    assert.throws(() => addedBenchFolder(home, before), /found 0/);
    mkdirSync(join(home, 'bench', 'b-one'), { recursive: true });
    assert.equal(addedBenchFolder(home, before), join(home, 'bench', 'b-one'));
    mkdirSync(join(home, 'bench', 'b-two'));
    assert.throws(() => addedBenchFolder(home, before), /found 2/);
    assert.equal(addedBenchFolder(home, new Set(['b-one'])), join(home, 'bench', 'b-two'));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('the evidence tool\'s benches are bound to the checkout before and after: its own output may change, nothing else (review m3, r3-contract-3)', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-checkout-'));
  const git = (...args: string[]): void => { const run = spawnSync('git', ['-c', 'user.name=Practonaut test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr); };
  try {
    git('init', '-q'); mkdirSync(join(root, 'evidence')); writeFileSync(join(root, 'evidence', 'report.json'), '{}\n'); writeFileSync(join(root, 'source.ts'), 'one\n');
    git('add', '.'); git('commit', '-q', '-m', 'start');
    const out = join(root, 'evidence'), before = checkoutSample(root, out);
    assert.equal(before.status, '');
    // The tool's own writes land in --out: no problem.
    writeFileSync(join(out, 'report.json'), '{"rebuilt":true}\n'); mkdirSync(join(out, 'run-1')); writeFileSync(join(out, 'run-1', 'session.json'), '{}\n');
    assert.equal(checkoutOf(before, checkoutSample(root, out)).problem, null);
    // A source file changed while the benches ran.
    writeFileSync(join(root, 'source.ts'), 'two\n');
    assert.match(checkoutOf(before, checkoutSample(root, out)).problem ?? '', /files changed/);
    // Another commit while the benches ran.
    git('add', 'source.ts'); git('commit', '-q', '-m', 'moved');
    assert.match(checkoutOf(before, checkoutSample(root, out)).problem ?? '', /moved from/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('no committed evidence file holds a local path or a draw.io release', () => {
  const files = (path: string): string[] => readdirSync(path).flatMap(name => { const full = join(path, name); return statSync(full).isDirectory() ? files(full) : [full]; });
  const all = files(dir);
  assert.ok(all.length > 100);
  for (const file of all) {
    assert.doesNotMatch(file, /\.war$/i);
    const text = readFileSync(file, 'latin1');
    for (const local of [root.replace(/[\\/]$/, ''), '/Users/', '/home/', 'C:\\Users', '\\\\?\\']) assert.ok(!text.includes(local), `${file.slice(root.length)} holds ${local}`);
  }
});
