// Challenge-tier tooling for maintainers (PADR-0040, PADR-0042 as amended on acceptance). Candidate
// families are not part of the CLI until they pass their gate; this tool generates and checks them,
// keeps the 0.3.0 release ledger, runs the project's benches through its start guard, and plans,
// records, declares and gates a unit's round from a checkout.
//
// Tuning (development seeds 1–999, throwaway checks 10000–19999):
//   node tools/challenge.ts generate <family> --set dev|check [--seed <n>] [--count <k>] [--difficulty 1|2|3|mixed] --out <dir> [--force]
//   node tools/challenge.ts verify <dir>
//   node tools/challenge.ts args <dir> [--tasks <id,…>]
// The release ledger (local: one per user and repository under PRACTONAUT_HOME, shared by every clone and
// worktree of the repository; committed in docs/benchmarks/challenge/0.3.0/):
//   node tools/challenge.ts ledger init|write|show [--folder <dir>] [--bench-root <dir,…>]
//   node tools/challenge.ts bench --purpose <p> [--plan <file> | --declaration <file> | --unit <u>] [--folder <dir>] -- <bench arguments> [--recover <bench folder>]
// A round of a unit <family>.<toolchain> (shape B):
//   node tools/challenge.ts plan --unit <u> --round <k> [--probe <p>] --difficulty <d> --seed <first> --model <opus id> --mirror off|required --timeout <s> --max-actions <n> [--checks <n>] [--maintainer-approved-unit <unit>] --out <file>
//   node tools/challenge.ts generate <unit> --set probe --plan <file> --out <dir>
//   node tools/challenge.ts probe --plan <file> --set <dir> --dev <report.json,…> [--bench-root <dir,…>] --out <file>
//   node tools/challenge.ts declare --plan <file> --probe <file> --dev <report.json,…> --ladder <preset=model,…> [--bench-root <dir,…>] --out <file>
//   node tools/challenge.ts generate <unit> --set heldout --declaration <file> --out <dir>
//   node tools/challenge.ts gate [--preflight] --declaration <file> --set <dir> --dev <…> --oracle <…> --random <…> [--ladder <…>] [--bench-root <dir,…>] [--out <file.md>]
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { SEED_RANGES, generateSet, type SeedSet } from '../src/challenge/build.ts';
import { declarationHash, fileHash, GATE_PRESET, heldOutSeeds } from '../src/challenge/declaration.ts';
import { FAMILIES, type Difficulty, type Family } from '../src/challenge/families.ts';
import { committedFile, COMMITTED_LEDGER, declareFromFiles, gateFromFiles, heldOutSet, ledgerPaths, makePlan, preflightFromFiles, probeFromFiles, probeSet, readDeclaration, readPlan, roundFiles, scanUnledgered, setArgs, setIdentities, verifySet, writeSet } from '../src/challenge/files.ts';
import { appendRound, initLedger, ledgerExists, ledgerGuard, readLedger, writeCommittedLedger } from '../src/challenge/ledger-file.ts';
import { countLedger, headerLine, isPrefix, LedgerError, parseLedger, PURPOSES, RELEASE, type Purpose } from '../src/challenge/ledger.ts';
import { earlierLedgerPaths, releaseLedgerPath, repositoryIdentity } from '../src/challenge/repository.ts';
import { committedVersions, isShallowRepository } from '../src/challenge/git.ts';
import { taskIdOf } from '../src/challenge/build.ts';
import { canonicalJson, sha256Hex } from '../src/canonical/index.ts';
import { resolvedDataPaths } from '../src/platform/paths.ts';
import { parseUnit, PRACTONAUT_TOOLCHAIN } from '../src/challenge/units.ts';
import { commandBench } from '../src/cli/bench.ts';
import { PACKAGE_VERSION } from '../src/version.ts';

const usage = `usage:
  node tools/challenge.ts generate <family> --set dev|check [--seed <n>] [--count <k>] [--difficulty 1|2|3|mixed] --out <dir> [--force]
  node tools/challenge.ts generate <unit> --set probe --plan <file> --out <dir> [--force]
  node tools/challenge.ts generate <unit> --set heldout --declaration <file> --out <dir> [--force]
  node tools/challenge.ts verify <dir>
  node tools/challenge.ts args <dir> [--tasks <id,…>]   (the set's bench arguments, for: … bench --agent <a> $(…) in a POSIX shell)
  node tools/challenge.ts ledger init|write|show [--folder <dir>] [--bench-root <dir,…>]
  node tools/challenge.ts bench --purpose ${PURPOSES.join('|')} [--plan <file> | --declaration <file> | --unit <u>] [--folder <dir>] -- <bench arguments> [--recover <bench folder>]
  node tools/challenge.ts plan --unit <u> --round <k> [--probe <p>] --difficulty 1|2|3|mixed --seed <first> --model <opus id> --mirror off|required --timeout <s> --max-actions <n> [--checks <n>] [--maintainer-approved-unit <unit>] --out <file> [--force]
  node tools/challenge.ts probe --plan <file> --set <dir> --dev <report.json,…> [--bench-root <dir,…>] --out <file> [--force]
  node tools/challenge.ts declare --plan <file> --probe <file> --dev <report.json,…> --ladder <preset=model,…> [--bench-root <dir,…>] --out <file> [--force]
  node tools/challenge.ts gate [--preflight] --declaration <file> --set <dir> --dev <…> --oracle <…> --random <…> [--ladder <…>] [--bench-root <dir,…>] [--out <file.md>] [--force]
families: ${FAMILIES.join(', ')}; a unit is <family>.<toolchain>, for example layout.practonaut`;
const fail = (message: string): never => { process.stderr.write(`challenge: ${message}\n${usage}\n`); process.exit(1); };

function options(args: string[], valued: string[], booleans: string[] = []): { values: Record<string, string>; flags: Set<string>; positional: string[] } {
  const values: Record<string, string> = {}, flags = new Set<string>(), positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (booleans.includes(arg)) { flags.add(arg); continue; }
    if (arg.startsWith('--')) {
      if (!valued.includes(arg) || Object.hasOwn(values, arg)) fail(`unknown or repeated option ${arg}`);
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`);
      values[arg] = value!;
    } else positional.push(arg);
  }
  return { values, flags, positional };
}
const whole = (raw: string | undefined, name: string, fallback?: number): number => {
  if (raw === undefined) { if (fallback === undefined) fail(`${name} is required`); return fallback!; }
  if (!/^\d{1,9}$/.test(raw)) fail(`${name} must be a whole number`);
  return Number(raw);
};
const difficultyOf = (raw: string | undefined): Difficulty | 'mixed' => {
  const value = raw ?? 'mixed';
  if (!['1', '2', '3', 'mixed'].includes(value)) fail('--difficulty must be 1, 2, 3 or mixed');
  return value === 'mixed' ? 'mixed' : Number(value) as Difficulty;
};
const list = (raw: string | undefined): string[] => raw === undefined ? [] : raw.split(',').filter(value => value !== '');
async function refuseExisting(out: string, force: boolean): Promise<void> {
  if (force) return;
  try { await lstat(out); } catch { return; }
  fail(`${out} exists; add --force to replace it`);
}
const gitPath = (args: string[]): string => {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return fail('not in a git checkout'); }
};
/** The checkout's top level: the release folder of this branch's round files. */
const defaultFolder = (): string => join(gitPath(['rev-parse', '--show-toplevel']), 'docs', 'benchmarks', 'challenge', RELEASE);
/** One local ledger per user and repository (PADR-0042 amended): under PRACTONAUT_HOME, keyed by the
 * repository's normalised origin URL and root commit, so every clone and worktree of the repository on
 * this machine shares it and its lock. Never a path an option names. */
async function localLedger(): Promise<string> {
  // A data folder named relatively is resolved against each directory a command runs in: another folder,
  // and another ledger, from each of them.
  const configured = process.env.PRACTONAUT_HOME;
  if (configured !== undefined && configured !== '' && !isAbsolute(configured)) fail(`PRACTONAUT_HOME is a relative path (${configured}); the release ledger would be another file in every directory: name it absolutely`);
  const identity = repositoryIdentity(process.cwd()) ?? fail('not in a git repository with a commit: the release ledger belongs to a repository');
  return releaseLedgerPath((await resolvedDataPaths()).home, identity.key);
}
/** No argument but the options a command names. */
const noPositional = (positional: string[]): void => { if (positional.length) fail(`unexpected argument ${positional[0]}`); };

async function generate(args: string[]): Promise<void> {
  const { values, flags, positional } = options(args, ['--set', '--seed', '--count', '--difficulty', '--out', '--declaration', '--plan'], ['--force']);
  if (positional.length !== 1) fail('name one family (tuning sets) or one unit (a round\'s sets)');
  const set = values['--set'] as SeedSet | 'probe';
  if (!['dev', 'check', 'heldout', 'probe'].includes(set)) fail('--set must be dev, check, probe or heldout');
  const out = values['--out'] ?? fail('--out is required');
  const started = performance.now();
  if (set === 'probe' || set === 'heldout') {
    // A round's set comes from its committed and pushed plan or declaration alone (PADR-0044 decision 8).
    for (const name of ['--seed', '--count', '--difficulty']) if (values[name] !== undefined) fail(`${name} is fixed by the ${set === 'probe' ? 'plan' : 'declaration'}`);
    const from = set === 'probe' ? values['--plan'] ?? fail('a pre-probe set is generated from its probe plan: --plan <file> (commit and push it first)') : values['--declaration'] ?? fail('a held-out set is generated from its round declaration: --declaration <file> (commit and push it first)');
    const value = set === 'probe' ? await readPlan(from) : await readDeclaration(from);
    if (value.unit !== positional[0]) fail(`the ${set === 'probe' ? 'plan' : 'declaration'} is for ${value.unit}, not ${positional[0]}`);
    const commit = committedFile(from);
    const family = value.unit.split('.')[0] as Family;
    const generated = set === 'probe' ? probeSet(value as Awaited<ReturnType<typeof readPlan>>) : heldOutSet(value as Awaited<ReturnType<typeof readDeclaration>>).set;
    const seeds = set === 'probe' ? (value as Awaited<ReturnType<typeof readPlan>>).seeds : heldOutSeeds(value as Awaited<ReturnType<typeof readDeclaration>>);
    const models = set === 'probe' ? [(value as Awaited<ReturnType<typeof readPlan>>).agent.model] : (value as Awaited<ReturnType<typeof readDeclaration>>).ladder.map(agent => agent.model);
    const basis = { kind: set === 'probe' ? 'plan' as const : 'declaration' as const, sha256: set === 'probe' ? fileHash(value) : declarationHash(value as Awaited<ReturnType<typeof readDeclaration>>), commit, path: from };
    const written = await writeSet(generated, out, { family, unit: value.unit, round: value.round, set, difficulty: value.difficulty, seeds, basis, bench: value.bench, models }, flags.has('--force'));
    process.stdout.write(`${value.unit} round ${value.round}: ${seeds.length} ${set === 'probe' ? 'pre-probe' : 'held-out'} instances, seeds ${seeds[0]}…${seeds.at(-1)} (from the ${basis.kind} of commit ${commit.slice(0, 12)}), world ${generated.world.id}; ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
    process.stdout.write(`wrote ${written.world}, ${written.oracles.length} oracle files, ${written.instances}\n`);
    process.stdout.write(`bench commands${set === 'heldout' ? ' (oracle and random first, then gate --preflight, then the ladder)' : ''}:\n${written.commands.map(command => `  ${command}`).join('\n')}\n`);
    return;
  }
  const family = positional[0] as Family;
  if (!FAMILIES.includes(family)) fail(`name one family: ${FAMILIES.join(', ')}`);
  for (const name of ['--declaration', '--plan']) if (values[name] !== undefined) fail(`${name} belongs to a round's sets`);
  const count = whole(values['--count'], '--count', set === 'dev' ? 8 : 24);
  if (count < 1 || count > 120) fail('--count must be 1 to 120');
  const [low, high] = SEED_RANGES[set as SeedSet];
  const first = values['--seed'] !== undefined ? whole(values['--seed'], '--seed') : set === 'dev' ? 1 : 10_001;
  if (first < low || first + count - 1 > high) fail(`--set ${set} uses seeds ${low} to ${high}; ${first}…${first + count - 1} is outside`);
  const difficulty = difficultyOf(values['--difficulty']);
  const seeds = Array.from({ length: count }, (_, index) => first + index);
  const generated = generateSet(family, seeds, difficulty, set);
  const written = await writeSet(generated, out, { family, set, difficulty: String(difficulty), seeds }, flags.has('--force'));
  const lengths = generated.instances.map(instance => instance.oracle.steps.length);
  process.stdout.write(`${family}: ${count} instances, seeds ${first}…${first + count - 1}, difficulty ${difficulty}, world ${generated.world.id}\n`);
  process.stdout.write(`reference lengths ${Math.min(...lengths)}–${Math.max(...lengths)} (proven minimal for ${generated.instances.filter(instance => instance.minimal).length} of ${count}); near misses ${generated.oracles.reduce((total, oracle) => total + oracle.nearMisses.length, 0)}; ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
  process.stdout.write(`wrote ${written.world}, ${written.oracles.length} oracle files, ${written.instances}\n`);
  process.stdout.write(`bench (built-in agents; a model agent through: node tools/challenge.ts bench --purpose development -- …): node src/cli/main.ts bench --agent <oracle|random> $(node tools/challenge.ts args ${out}) --mirror required\n`);
}

async function verify(args: string[]): Promise<void> {
  const { positional } = options(args, []);
  if (positional.length !== 1) fail('name one generated folder');
  const result = await verifySet(positional[0]!);
  process.stdout.write(`${result.world.id}: ${result.instances} instances; references passed ${result.references.passed}/${result.references.total}; near misses failed ${result.nearMisses.total - result.nearMisses.passed}/${result.nearMisses.total} (separate checker processes)\n`);
  for (const failure of result.nearMisses.failures) process.stdout.write(`  near miss passed: ${failure}\n`);
  if (result.references.passed !== result.references.total || result.nearMisses.passed) process.exitCode = 2;
}

async function benchArgs(args: string[]): Promise<void> {
  const { values, positional } = options(args, ['--tasks']);
  if (positional.length !== 1) fail('name one generated folder');
  const tasks = values['--tasks'] === undefined ? undefined : list(values['--tasks']);
  const result = await setArgs(positional[0]!, tasks);
  if (result.some(value => /\s/.test(value))) fail('a path in the bench arguments contains white space; pass them by hand');
  process.stdout.write(result.join(' ') + '\n');
}

async function ledger(args: string[]): Promise<void> {
  const { values, positional } = options(args, ['--folder', '--bench-root']);
  const action = positional[0];
  if (positional.length !== 1 || !['init', 'write', 'show'].includes(action!)) fail('ledger init, write or show');
  const folder = values['--folder'] ?? defaultFolder(), paths = ledgerPaths(folder, await localLedger());
  if (action === 'init') {
    // This repository's ledger exists (here, or where an earlier Practonaut kept it): never a second one.
    if (await ledgerExists(paths.local)) throw new LedgerError('ledger_exists', `${paths.local} exists: this repository's local release ledger (shared by every clone and worktree of it); a local ledger is never replaced`);
    for (const earlier of earlierLedgerPaths(process.cwd())) if (await ledgerExists(earlier))
      throw new LedgerError('ledger_elsewhere', `a release ledger of this repository exists at ${earlier}, where an earlier Practonaut kept it; move it to ${paths.local} instead of starting a second count`);
    // Every pushed version, over HEAD and every remote-tracking branch: one history, the longest its head.
    const top = gitPath(['rev-parse', '--show-toplevel']);
    if (isShallowRepository(top)) throw new LedgerError('shallow_clone', 'this repository is a shallow clone: the release ledger\'s pushed versions cannot all be read (git fetch --unshallow)');
    const rel = relative(top, resolve(folder, COMMITTED_LEDGER)).split(sep).join('/');
    const versions = committedVersions(top, rel);
    const texts = [...versions.map(version => version.text), ...(await readLedger(paths.committed).then(value => value ? [value.text] : [], () => []))];
    const longest = texts.reduce<string | null>((best, text) => best === null || text.length > best.length ? text : best, null);
    const diverged = texts.find(text => !isPrefix(text, longest!));
    if (diverged !== undefined) throw new LedgerError('ledger_diverged', 'the pushed versions of the release ledger are not one history (a branch holds records another lacks); a maintainer merges them before a ledger is started');
    const base = longest === null ? parseLedger(headerLine()) : parseLedger(longest);
    // It refuses while model-run folders exist that no start entry names (made outside the ledger: they
    // would never count).
    const roots = [...list(values['--bench-root']), join((await resolvedDataPaths()).home, 'bench')];
    const outside = await scanUnledgered(roots, base);
    if (outside.length) throw Object.assign(new Error(`${outside.length} model run folder${outside.length === 1 ? '' : 's'} (first: ${outside[0]!.run} in bench folder ${outside[0]!.bench}) hold${outside.length === 1 ? 's' : ''} no start entry of any pushed version of the release ledger; a ledger is not started while runs made outside it exist`), { code: 'runs_outside_ledger' });
    const made = await initLedger(paths, longest);
    process.stdout.write(`wrote ${paths.local}: ${made.from === 'new' ? 'a new release ledger for ' + RELEASE : `a copy of the longest pushed ledger (${made.records} records)`}; every clone and worktree of this repository on this machine uses it\n`);
  } else if (action === 'write') {
    const written = await writeCommittedLedger(paths);
    process.stdout.write(`wrote ${paths.committed}: ${written.records} records (${written.added} new); commit and push it before declare or gate read them\n`);
  } else {
    const local = await readLedger(paths.local);
    if (!local) return void fail(`no local ledger at ${paths.local}`);
    const count = countLedger(local);
    process.stdout.write(`release ${local.header.release}: ${count.counted} of ${local.header.cap} model runs counted; ${count.starts} starts (${count.open} without a run-end record), ${count.exempt} refused by the client before model work, ${count.local} local; ${local.records.length} records (${paths.local})\n`);
  }
}

/** A bench of the project, every client start through the release ledger's start guard. */
async function bench(args: string[]): Promise<void> {
  const split = args.indexOf('--');
  if (split < 0) fail('separate the bench arguments with --');
  const { values, positional } = options(args.slice(0, split), ['--purpose', '--plan', '--declaration', '--unit', '--folder']);
  if (positional.length) fail(`unexpected ${positional[0]} before --`);
  const purpose = values['--purpose'] as Purpose;
  if (!PURPOSES.includes(purpose)) fail(`--purpose is one of ${PURPOSES.join(', ')}`);
  const local = await localLedger();
  let guard: Parameters<typeof ledgerGuard>[0];
  if (purpose === 'pre-probe' || purpose === 'held-out') {
    // A round's run serves its pushed plan or declaration (PADR-0044 decision 8: the plan before the first run).
    if (values['--unit'] !== undefined) fail('a round\'s unit comes from its plan or declaration');
    const path = purpose === 'pre-probe' ? values['--plan'] ?? fail('a pre-probe run serves its probe plan: --plan <file>, committed and pushed') : values['--declaration'] ?? fail('a held-out run serves its round declaration: --declaration <file>, committed and pushed');
    const value = purpose === 'pre-probe' ? await readPlan(path) : await readDeclaration(path);
    committedFile(path);
    if (value.toolchain.practonaut !== PACKAGE_VERSION) fail(`the round's plan pins Practonaut ${value.toolchain.practonaut}; this is ${PACKAGE_VERSION}`);
    const models = purpose === 'pre-probe' ? [(value as Awaited<ReturnType<typeof readPlan>>).agent.model] : (value as Awaited<ReturnType<typeof readDeclaration>>).ladder.map(agent => agent.model);
    const basis = purpose === 'pre-probe' ? fileHash(value) : declarationHash(value as Awaited<ReturnType<typeof readDeclaration>>);
    // The round's own set, regenerated: a start on another world or instance is refused.
    const made = purpose === 'pre-probe' ? { set: probeSet(value as Awaited<ReturnType<typeof readPlan>>), seeds: (value as Awaited<ReturnType<typeof readPlan>>).seeds } : heldOutSet(value as Awaited<ReturnType<typeof readDeclaration>>);
    const family = value.unit.split('.')[0] as Family;
    const set = { world: sha256Hex(canonicalJson(made.set.world)), instances: new Set(setIdentities(made.set, made.seeds.map(seed => taskIdOf(family, seed)))) };
    guard = { paths: ledgerPaths(dirname(path), local), purpose, unit: value.unit, round: value.round, basis, toolchain: value.toolchain.id, rules: value.toolchain.rules, models, set };
  } else {
    if (values['--plan'] !== undefined || values['--declaration'] !== undefined) fail(`a ${purpose} run serves no plan or declaration`);
    const unit = values['--unit'] === undefined ? null : parseUnit(values['--unit']);
    if (unit && unit.level !== 'session') fail(`${unit.id} is judged in artifact mode, which this Practonaut does not ship yet`);
    guard = { paths: ledgerPaths(values['--folder'] ?? defaultFolder(), local), purpose, unit: unit?.id ?? null, round: null, basis: null, toolchain: unit?.toolchain ?? PRACTONAUT_TOOLCHAIN, rules: null };
  }
  process.exitCode = await commandBench(args.slice(split + 1), { guard: ledgerGuard(guard) });
}

async function plan(args: string[]): Promise<void> {
  const { values, flags, positional } = options(args, ['--unit', '--round', '--probe', '--difficulty', '--seed', '--model', '--mirror', '--timeout', '--max-actions', '--checks', '--shape', '--out', '--maintainer-approved-unit'], ['--force']);
  noPositional(positional);
  const unit = values['--unit'] ?? fail('--unit names the unit, <family>.<toolchain>');
  // The maintainer's approval names its unit (PADR-0042 decision 2).
  const approved = values['--maintainer-approved-unit'] ?? null;
  if (approved !== null && approved !== unit) fail(`--maintainer-approved-unit names ${approved}, not the planned unit ${unit}`);
  const round = whole(values['--round'], '--round'), probe = whole(values['--probe'], '--probe', 1);
  const out = values['--out'] ?? fail('--out is required');
  if (!out.endsWith(roundFiles.plan(unit, round, probe))) fail(`name the file <folder>/${roundFiles.plan(unit, round, probe)}`);
  await refuseExisting(out, flags.has('--force'));
  const mirror = values['--mirror'];
  if (mirror !== 'off' && mirror !== 'required') fail('--mirror off or required: a round names its mirror');
  const first = whole(values['--seed'], '--seed'), shape = (values['--shape'] ?? 'B') as 'A' | 'B';
  if (shape !== 'A' && shape !== 'B') fail('--shape A or B');
  const made = await makePlan({
    unit, round, probe, difficulty: difficultyOf(values['--difficulty'] ?? fail('--difficulty is required')), seeds: Array.from({ length: 7 }, (_, index) => first + index),
    model: values['--model'] ?? fail('--model names the Opus model of the pre-probe (as ANTHROPIC_MODEL)'),
    bench: { mirror: mirror as 'off' | 'required', timeoutSeconds: whole(values['--timeout'], '--timeout'), maxActions: whole(values['--max-actions'], '--max-actions'), checks: values['--checks'] === undefined ? null : whole(values['--checks'], '--checks') },
    maintainerApprovedUnit: approved, shape,
  }, dirname(out));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(made, null, 2) + '\n');
  process.stdout.write(`${made.unit} round ${made.round}, probe ${made.probe}: Opus (${made.agent.model}) pre-probes seeds ${made.seeds[0]}…${made.seeds.at(-1)} at difficulty ${made.difficulty}; 1–5 of 7 passes admit. Wrote ${out}. Commit and push it before the first pre-probe run.\n`);
}

async function probe(args: string[]): Promise<void> {
  const { values, flags, positional } = options(args, ['--plan', '--set', '--dev', '--out', '--bench-root'], ['--force']);
  noPositional(positional);
  const out = values['--out'] ?? fail('--out is required');
  await refuseExisting(out, flags.has('--force'));
  const local = await localLedger(), planPath = values['--plan'] ?? fail('--plan is required');
  const { record, text, round } = await probeFromFiles({ plan: planPath, set: values['--set'] ?? fail('--set names the pre-probe set'), reports: list(values['--dev'] ?? fail('--dev names the pre-probe reports')), ledger: local, benchRoots: list(values['--bench-root']) });
  if (!out.endsWith(roundFiles.probe(record.unit, record.round, record.probe))) fail(`name the file <folder>/${roundFiles.probe(record.unit, record.round, record.probe)}`);
  await writeFile(out, text);
  await appendRound(ledgerPaths(dirname(planPath), local), round);
  const verdict = record.admitted ? 'admitted (1–5 of 7)' : record.void.length ? `not admitted: ${record.void.length} void pre-probe run${record.void.length === 1 ? '' : 's'} (no run-end record: ${record.void.join(', ')}); a refused unit may be retuned once` : 'not admitted (0 or 6–7 of 7): a refused unit may be retuned once';
  process.stdout.write(`${record.unit} round ${record.round}, probe ${record.probe}: Opus passed ${record.passed} of ${record.outcomes.length}; ${verdict}. Wrote ${out} and registered it in the release ledger; write the ledger (ledger write), commit and push both either way.\n`);
}

async function declare(args: string[]): Promise<void> {
  const { values, flags, positional } = options(args, ['--plan', '--probe', '--dev', '--ladder', '--out', '--bench-root'], ['--force']);
  noPositional(positional);
  const out = values['--out'] ?? fail('--out is required');
  await refuseExisting(out, flags.has('--force'));
  const ladder = list(values['--ladder'] ?? fail('--ladder names the agents, most capable first: <preset>=<model>,… (a bare model runs through claude-code)')).map(entry => {
    const at = entry.indexOf('=');
    return at < 0 ? { preset: GATE_PRESET, model: entry } : { preset: entry.slice(0, at), model: entry.slice(at + 1) };
  });
  const local = await localLedger();
  const { declaration, seeds, round } = await declareFromFiles({ plan: values['--plan'] ?? fail('--plan is required'), probe: values['--probe'] ?? fail('--probe names the pre-probe record'), reports: list(values['--dev'] ?? fail('--dev names the pre-probe reports')), ladder, ledger: local, out, benchRoots: list(values['--bench-root']) });
  await writeFile(out, JSON.stringify(declaration, null, 2) + '\n');
  await appendRound(ledgerPaths(dirname(out), local), round);
  process.stdout.write(`${declaration.unit} round ${declaration.round}: shape B, ladder ${declaration.ladder.map(agent => agent.model).join(', ')}; gate pair ${declaration.pair.strongest} (strongest) vs ${declaration.pair.weakest} (weakest), fixed by the capability order; α = ${declaration.alpha}\n`);
  process.stdout.write(`release runs counted before this round: ${declaration.budget.before} of ${declaration.budget.cap} (0.3.0 counts from zero); the round plans ${declaration.budget.roundRuns} (formula ${declaration.budget.formula} ≤ 100); ${declaration.budget.reserved} kept for other units; funded\n`);
  process.stdout.write(`held-out seeds ${seeds[0]}…${seeds.at(-1)} follow from the pre-probe runs; wrote ${out} and registered it in the release ledger. Write the ledger (ledger write), commit and push both, then generate the held-out set.\n`);
}

async function gate(args: string[]): Promise<void> {
  const { values, flags, positional } = options(args, ['--declaration', '--set', '--dev', '--oracle', '--random', '--ladder', '--bench-root', '--out'], ['--force', '--preflight']);
  noPositional(positional);
  const files = {
    declaration: values['--declaration'] ?? fail('--declaration is required'), set: values['--set'] ?? fail('--set names the generated held-out folder'),
    development: list(values['--dev'] ?? fail('--dev names the pre-probe reports')), oracle: list(values['--oracle'] ?? fail('--oracle is required')), random: list(values['--random'] ?? fail('--random is required')),
    benchRoots: list(values['--bench-root']), ledger: await localLedger(),
  };
  if (flags.has('--preflight')) {
    if (values['--ladder'] !== undefined || values['--out'] !== undefined) fail('--preflight checks the round before any ladder run: no --ladder, no --out');
    process.stdout.write((await preflightFromFiles(files)).text);
    return;
  }
  const out = values['--out'] ?? fail('--out is required');
  await refuseExisting(out, flags.has('--force'));
  const { result, markdown, json } = await gateFromFiles({ ...files, ladder: list(values['--ladder'] ?? fail('--ladder is required')) });
  if (!out.endsWith(roundFiles.gate(result.unit, result.round))) fail(`name the file <folder>/${roundFiles.gate(result.unit, result.round)}`);
  const jsonPath = join(dirname(out), roundFiles.gateJson(result.unit, result.round));
  await writeFile(out, markdown);
  await writeFile(jsonPath, json);
  process.stdout.write(`${result.unit} round ${result.round}: ${result.verdict}; ${result.spend.total} model runs counted in the round (${result.spend.exempt} exempt); release ${result.ledger.counted} of ${result.ledger.cap}; wrote ${out} and ${jsonPath}\n`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'generate') await generate(rest);
  else if (command === 'verify') await verify(rest);
  else if (command === 'args') await benchArgs(rest);
  else if (command === 'ledger') await ledger(rest);
  else if (command === 'bench') await bench(rest);
  else if (command === 'plan') await plan(rest);
  else if (command === 'probe') await probe(rest);
  else if (command === 'declare') await declare(rest);
  else if (command === 'gate') await gate(rest);
  else fail('name a command');
} catch (error) {
  process.stderr.write(`challenge: ${(error as { code?: string }).code ? `${(error as { code: string }).code}: ` : ''}${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
