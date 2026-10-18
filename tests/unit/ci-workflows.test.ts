// The CI recipe's two workflow files (roadmap 0.2.0, Should 5), read as YAML (tests/support/yaml.ts)
// and checked by structure: every action pinned by commit SHA; the repository's own check runs only by
// hand, outside the required checks, with read-only permissions and one concurrency group per mode,
// and benches the plan its committed baseline was made with (compare would refuse anything else); the
// example pins an exact Practonaut
// version, skips forks (no secrets), takes a pull request's baseline from its base commit, installs
// Practonaut without install scripts, keeps secrets in step environments and expressions out of shell
// code, stops on a failed agent before comparing, and gates on instance regressions with the repeats
// a regression needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REGRESSION_REPEATS } from '../../src/bench/stats.ts';
import { parseYaml, type Yaml } from '../support/yaml.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(root + path, 'utf8');
const CHECK = '.github/workflows/ci-recipe-check.yml', EXAMPLE = 'examples/ci/practonaut-bench.yml';
type Mapping = { [key: string]: Yaml };
const map = (value: Yaml | undefined): Mapping => { assert.ok(value && typeof value === 'object' && !Array.isArray(value), `a mapping, found ${JSON.stringify(value)}`); return value as Mapping; };
const list = (value: Yaml | undefined): Yaml[] => { assert.ok(Array.isArray(value), `a sequence, found ${JSON.stringify(value)}`); return value; };
const workflow = (path: string): Mapping => map(parseYaml(read(path)));
const steps = (doc: Mapping): Mapping[] => Object.values(map(doc.jobs)).flatMap(job => list(map(job).steps).map(map));

/** The words of a shell command line (quotes removed, `\`-continued lines joined), up to `||`, `;` or a line end. */
function words(command: string): string[] {
  const out: string[] = [];
  let word = '', quote: string | null = null, started = false;
  const text = command.replace(/\\\n\s*/g, ' ');
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) { if (char === quote) quote = null; else word += char; continue; }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (char === '\n' || char === ';' || (char === '|' && text[index + 1] === '|')) break;
    if (/\s/.test(char)) { if (started) out.push(word); word = ''; started = false; continue; }
    word += char; started = true;
  }
  if (started) out.push(word);
  return out;
}
/** The options of the first `practonaut <command>` in a step's shell code: flag → value (true for a switch). */
function invocation(doc: Mapping, command: string): { step: Mapping; positional: string[]; options: Map<string, string | true> } {
  const SWITCHES = new Set(['--fail-on-agent-error', '--fail-on-regression', '--verify', '--json']);
  for (const step of steps(doc)) {
    const run = typeof step.run === 'string' ? step.run : '';
    const start = run.indexOf(`practonaut ${command} `);
    if (start < 0) continue;
    const argv = words(run.slice(start)).slice(2), options = new Map<string, string | true>(), positional: string[] = [];
    for (let index = 0; index < argv.length; index++) {
      const arg = argv[index]!;
      if (!arg.startsWith('--')) positional.push(arg);
      else if (SWITCHES.has(arg)) options.set(arg, true);
      else options.set(arg, argv[++index]!);
    }
    return { step, positional, options };
  }
  throw new Error(`no step runs practonaut ${command}`);
}
/** Every string in the document with its path. */
function strings(value: Yaml, path: string[] = [], out: Array<[string[], string]> = []): Array<[string[], string]> {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, index) => strings(item, [...path, String(index)], out));
  else if (value) for (const [key, item] of Object.entries(value)) strings(item, [...path, key], out);
  return out;
}

test('the YAML reader reads the structures the workflows use', () => {
  assert.deepEqual(parseYaml("on:\n  push:\n    branches: [main, 'x']\nenv:\n  A: 'q''s'  # c\njobs:\n  j:\n    steps:\n      - uses: a/b@c # v1\n        with:\n          k: 1\n      - run: |\n          echo \"#1\"\n          ls\n"),
    { on: { push: { branches: ['main', 'x'] } }, env: { A: "q's" }, jobs: { j: { steps: [{ uses: 'a/b@c', with: { k: '1' } }, { run: 'echo "#1"\nls\n' }] } } });
  assert.throws(() => parseYaml('a: {b: 1}\n'));
  assert.deepEqual(words('npx x -- practonaut bench --a "$B" \\\n  --c \'d e\' || status=$?'), ['npx', 'x', '--', 'practonaut', 'bench', '--a', '$B', '--c', 'd e']);
});

test('every action in every workflow and in the example is pinned to a full commit SHA', () => {
  const files = [...readdirSync(root + '.github/workflows').filter(name => name.endsWith('.yml')).map(name => `.github/workflows/${name}`), EXAMPLE];
  for (const file of files) {
    const uses = [...read(file).matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map(match => match[1]!);
    for (const action of uses) assert.match(action, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${file}: ${action}`);
  }
  for (const file of [CHECK, EXAMPLE]) for (const step of steps(workflow(file))) if (step.uses !== undefined) assert.match(String(step.uses), /@[0-9a-f]{40}$/, file);
});

test('the repository check runs only by hand, outside the required checks, with read-only permissions', () => {
  const doc = workflow(CHECK);
  assert.deepEqual(Object.keys(map(doc.on)), ['workflow_dispatch']);
  assert.deepEqual(map(map(map(doc.on).workflow_dispatch).inputs).plant_regression, { description: 'Bench a candidate whose instances regress (the compare step must then fail)', type: 'boolean', default: 'false' });
  assert.deepEqual(doc.permissions, { contents: 'read' });
  // The clean and the planted mode, dispatched back to back, must not cancel each other: the input is
  // part of the concurrency group.
  assert.deepEqual(doc.concurrency, { group: 'ci-recipe-check-${{ github.ref }}-${{ inputs.plant_regression }}', 'cancel-in-progress': 'true' });
  // The required checks are `test (<os>)` and `secret scan` (ci.yml); no job here may answer for them.
  for (const job of Object.values(map(doc.jobs))) assert.equal(/^test \(|^secret scan$/.test(String(map(job).name)), false, String(map(job).name));
});

test('the repository check benches the plan its committed baseline was made with, and gates on it', () => {
  const doc = workflow(CHECK);
  const baseline = JSON.parse(read('tests/fixtures/ci-recipe/baseline.json')) as { settings: { seeds: number[]; repeats: number; maxActions: number }; environment: { mirror: string }; agent: { name: string } };
  const bench = invocation(doc, 'bench').options;
  assert.deepEqual([bench.get('--agent'), bench.get('--seed-list'), bench.get('--repeats'), bench.get('--max-actions'), bench.get('--mirror')],
    [baseline.agent.name, baseline.settings.seeds.join(','), String(baseline.settings.repeats), String(baseline.settings.maxActions), baseline.environment.mirror]);
  assert.ok(baseline.settings.repeats >= REGRESSION_REPEATS, 'the baseline has the repeats an instance regression needs');
  assert.equal(bench.get('--fail-on-agent-error'), true);
  const compare = invocation(doc, 'compare');
  assert.deepEqual([compare.positional[0], compare.options.get('--fail-on-regression')], ['$BASELINE', true]);
  assert.equal(compare.step.if, undefined, 'compare runs only when every step before it succeeded');
  assert.match(String(map(doc.env).BASELINE), /\/tests\/fixtures\/ci-recipe\/baseline\.json$/);
});

test('the example pins Practonaut, skips forks, takes a pull request\'s baseline from its base commit and gates on agents and regressions', () => {
  const doc = workflow(EXAMPLE), env = map(doc.env);
  assert.match(String(env.PRACTONAUT), /^practonaut@\d+\.\d+\.\d+$/);
  assert.match(String(env.CLAUDE_CODE), /^@anthropic-ai\/claude-code@\d+\.\d+\.\d+$/);
  assert.equal(env.npm_config_ignore_scripts, 'true', 'Practonaut and its dependencies install without install scripts');
  assert.deepEqual(doc.permissions, { contents: 'read' });
  const job = map(Object.values(map(doc.jobs))[0]);
  assert.equal(job.if, "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository");
  const all = steps(doc);
  assert.equal(map(all[0]!.with)['fetch-depth'], '0', 'the base commit is in the checkout');
  const base = all.find(step => step.if === "github.event_name == 'pull_request'")!;
  assert.equal(map(base.env).BASE_SHA, '${{ github.event.pull_request.base.sha }}');
  assert.deepEqual(words(String(base.run)), ['git', 'show', '$BASE_SHA:$BASELINE', '>', '$RUNNER_TEMP/baseline.json']);
  assert.match(String(base.run), /BASELINE=\$RUNNER_TEMP\/baseline\.json" >> "\$GITHUB_ENV"/);
  assert.ok(all.indexOf(base) < all.indexOf(invocation(doc, 'compare').step), 'the baseline is replaced before compare reads it');
  // Secrets only as a step's environment variable; no expression inside shell code.
  for (const [path, value] of strings(doc)) {
    if (value.includes('secrets.')) assert.deepEqual([path.at(-4), path.at(-2)], ['steps', 'env'], path.join('.'));
    if (path.at(-1) === 'run') assert.equal(value.includes('${{'), false, path.join('.'));
  }
  const bench = invocation(doc, 'bench').options;
  assert.equal(bench.get('--agent'), 'claude-code');
  assert.ok(Number(bench.get('--repeats')) >= REGRESSION_REPEATS);
  assert.deepEqual([bench.get('--mirror'), bench.get('--junit'), bench.get('--fail-on-agent-error')], ['required', '$OUT/junit.xml', true]);
  const compare = invocation(doc, 'compare');
  assert.deepEqual([compare.positional[0], compare.options.get('--fail-on-regression')], ['$BASELINE', true]);
  assert.equal(compare.step.if, undefined, 'compare does not run after a failed agent');
  assert.ok(all.some(step => step.run !== undefined && words(String(step.run)).slice(-2).join(' ') === 'practonaut setup'));
});

// Issue #45: native Open evidence on every platform, and the repeat workflow that measures the fix.
const CI = '.github/workflows/ci.yml', REPEAT = '.github/workflows/native-open-repeat.yml';
const PLATFORMS = ['ubuntu-latest', 'macos-latest', 'windows-latest'];
const evidenceUpload = (step: Mapping): boolean => String(step.uses ?? '').startsWith('actions/upload-artifact@') && step.with !== undefined && map(step.with).path === '.local/native-transfer/';

const runWords = (step: Mapping): string[] => typeof step.run === 'string' ? words(step.run) : [];

test('the required checks keep their names and every CI platform uploads native-transfer evidence after its tests fail', () => {
  const jobs = map(workflow(CI).jobs), matrixJob = map(jobs.test);
  assert.equal(matrixJob.name, 'test (${{ matrix.os }})');
  assert.deepEqual(map(map(matrixJob.strategy).matrix).os, PLATFORMS);
  assert.equal(map(jobs.secrets).name, 'secret scan');
  for (const job of [matrixJob, map(jobs.node)]) {
    const all = list(job.steps).map(map), uploads = all.filter(evidenceUpload);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0]!.if, '${{ failure() }}', 'on failure and on no single platform');
    const integration = all.findIndex(step => runWords(step).join(' ') === 'npm run test:integration');
    assert.ok(integration >= 0 && all.indexOf(uploads[0]!) > integration, 'the upload comes after the step that runs the native transfer tests');
  }
});

test('the native Open repeat runs only the H1 native file test, by hand, 20 times on each CI platform, and fails unless it passed', () => {
  const doc = workflow(REPEAT);
  assert.deepEqual(Object.keys(map(doc.on)), ['workflow_dispatch']);
  assert.deepEqual(doc.permissions, { contents: 'read' });
  const jobs = Object.values(map(doc.jobs)).map(map);
  assert.equal(jobs.length, 1);
  for (const job of jobs) assert.equal(/^test \(|^secret scan$/.test(String(job.name)), false, String(job.name));
  const job = jobs[0]!, strategy = map(job.strategy), matrix = map(strategy.matrix);
  assert.deepEqual(matrix.os, PLATFORMS);
  assert.ok(new Set(list(matrix.repeat)).size >= 20, 'at least 20 runs per platform');
  assert.equal(strategy['fail-fast'], 'false', 'one failed run does not cancel the others');
  const all = list(job.steps).map(map);
  const build = all.findIndex(step => runWords(step).join(' ') === 'node tools/build-engine.ts');
  const runs = all.flatMap((step, index) => runWords(step).includes('--test') ? [index] : []);
  assert.equal(runs.length, 1, 'one test command');
  const run = runs[0]!, argv = runWords(all[run]!);
  const option = (name: string): string[] => argv.filter(arg => arg.startsWith(`${name}=`)).map(arg => arg.slice(name.length + 1));
  const pattern = option('--test-name-pattern')[0]!;
  assert.deepEqual(argv.filter(arg => arg.endsWith('.test.ts')), ['tests/integration/transfer.test.ts']);
  assert.ok(build >= 0 && build < run, 'the engine is built before the test');
  // The two H1 tests in that file, named literally: only the native file test is selected.
  const NATIVE = 'H1 native file: genuine Open, visible edit, native Undo, completed Save As and entire-file checker';
  const OTHER = 'H1 transfer: scripted human genuine editor input and adapter fixture exports judged only after editing';
  assert.equal(new RegExp(pattern).test(NATIVE), true);
  assert.equal(new RegExp(pattern).test(OTHER), false);
  // A pattern that selects nothing exits 0: the next step reads the TAP report and requires the pass.
  const reporters = option('--test-reporter'), destinations = option('--test-reporter-destination'), tap = destinations[reporters.indexOf('tap')]!;
  assert.ok(tap, 'the test writes a TAP report');
  const check = all.findIndex(step => runWords(step).slice(0, 2).join(' ') === 'node tools/require-test-passed.ts');
  assert.equal(check, run + 1, 'the check directly follows the test');
  assert.equal(all[check]!.if, undefined);
  const [, , report, prefix] = runWords(all[check]!);
  assert.equal(report, tap);
  assert.equal(NATIVE.startsWith(prefix!), true); assert.equal(OTHER.startsWith(prefix!), false);
  const uploads = all.filter(evidenceUpload);
  assert.equal(uploads.length, 1); assert.equal(uploads[0]!.if, '${{ failure() }}');
  assert.ok(all.indexOf(uploads[0]!) > check, 'the upload comes after the test and its check');
});
