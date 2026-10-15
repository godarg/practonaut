// Challenge-tier tooling for maintainers (PADR-0040). Candidate families are not part of the CLI
// until they pass their gate; this tool generates, checks, declares and gates them from a checkout.
//
//   node tools/challenge.ts generate <family> --set dev|check [--seed <n>] [--count <k>] [--difficulty 1|2|3|mixed] --out <dir> [--force]
//   node tools/challenge.ts generate <family> --set heldout --declaration <file.declaration.json> --out <dir> [--force]
//   node tools/challenge.ts verify <dir>
//   node tools/challenge.ts args <dir> [--tasks <id,…>]   the set's bench arguments on one line (for some tasks: to resume)
//   node tools/challenge.ts declare --family <f> --round <k> --difficulty <d> --dev <report.json,…>
//                                   [--maintainer-approved <model,…>] [--bench-root <dir,…>] --out <folder>/<family>-round-<k>.declaration.json [--force]
//   node tools/challenge.ts gate --preflight --declaration <file> --set <held-out dir> --dev <report.json,…> --oracle <report.json,…> --random <report.json,…>
//   node tools/challenge.ts gate --declaration <file> --set <held-out dir> --dev <…> --oracle <…> --random <…> --ladder <report.json,…>
//                                [--previous <report.json,…>] [--maintainer-approved <model,…>] [--bench-root <dir,…>] --out <folder>/<family>-round<k>.md [--force]
//
// Families: repair, injection, long-horizon, limited-checks, tight-budget (roadmap order).
// Seeds: development 1–999 (default 1…8), throwaway checks 10000–19999 (default 10001…10024),
// held-out ≥ 1000000, derived from the round's committed and pushed declaration only.
import { lstat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SEED_RANGES, generateSet, type SeedSet } from '../src/challenge/build.ts';
import { declarationHash } from '../src/challenge/declaration.ts';
import { FAMILIES, type Difficulty, type Family } from '../src/challenge/families.ts';
import { committedDeclaration, declareFromFiles, gateFromFiles, heldOutSet, preflightFromFiles, readDeclaration, setArgs, verifySet, writeSet } from '../src/challenge/files.ts';

const usage = `usage:
  node tools/challenge.ts generate <family> --set dev|check [--seed <n>] [--count <k>] [--difficulty 1|2|3|mixed] --out <dir> [--force]
  node tools/challenge.ts generate <family> --set heldout --declaration <file> --out <dir> [--force]
  node tools/challenge.ts verify <dir>
  node tools/challenge.ts args <dir> [--tasks <id,…>]   (the set's bench arguments, for: practonaut bench --agent <a> $(…))
  node tools/challenge.ts declare --family <f> --round <k> --difficulty 1|2|3|mixed --dev <report.json,…> [--maintainer-approved <model,…>] [--bench-root <dir,…>] --out <file> [--force]
  node tools/challenge.ts gate --preflight --declaration <file> --set <held-out dir> --dev <report.json,…> --oracle <report.json,…> --random <report.json,…> [--bench-root <dir,…>]
  node tools/challenge.ts gate --declaration <file> --set <held-out dir> --dev <…> --oracle <…> --random <…> --ladder <report.json,…>
                               [--previous <report.json,…>] [--maintainer-approved <model,…>] [--bench-root <dir,…>] --out <file.md> [--force]
families: ${FAMILIES.join(', ')}`;
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

async function generate(args: string[]): Promise<void> {
  const { values, flags, positional } = options(args, ['--set', '--round', '--seed', '--count', '--difficulty', '--out', '--declaration', '--dev-runs'], ['--force']);
  const family = positional[0] as Family;
  if (positional.length !== 1 || !FAMILIES.includes(family)) fail('name one family');
  const set = values['--set'] as SeedSet;
  if (!['dev', 'check', 'heldout'].includes(set)) fail('--set must be dev, check or heldout');
  const out = values['--out'] ?? fail('--out is required');
  const started = performance.now();
  if (set === 'heldout') {
    // A held-out set is the declaration's: its seeds, difficulty, round and bench settings come from
    // it alone, and only once it is committed and pushed (second review B-B).
    if (values['--declaration'] === undefined) fail('a held-out set is generated from its round declaration: --declaration <file> (commit and push it first)');
    for (const name of ['--seed', '--count', '--difficulty', '--round', '--dev-runs']) if (values[name] !== undefined) fail(`${name} is fixed by the declaration`);
    const declaration = await readDeclaration(values['--declaration']!);
    if (declaration.family !== family) fail(`the declaration is for ${declaration.family}, not ${family}`);
    const { commit } = committedDeclaration(values['--declaration']!);
    const { set: generated, seeds } = heldOutSet(declaration);
    const bench = { mirror: declaration.bench.mirror, maxActions: declaration.bench.maxActions, timeoutSeconds: declaration.bench.timeoutSeconds, checks: declaration.bench.checks };
    const written = await writeSet(generated, out, { family, set, round: declaration.round, difficulty: declaration.difficulty, seeds, declaration: { sha256: declarationHash(declaration), commit }, bench, ladder: declaration.ladder }, flags.has('--force'));
    process.stdout.write(`${family} round ${declaration.round}: ${seeds.length} held-out instances, seeds ${seeds[0]}…${seeds.at(-1)} (derived from the declaration of commit ${commit.slice(0, 12)}), difficulty ${declaration.difficulty}, world ${generated.world.id}; ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
    process.stdout.write(`wrote ${written.world}, ${written.oracles.length} oracle files, ${written.instances}\n`);
    process.stdout.write(`bench commands (oracle and random first, then gate --preflight, then the ladder):\n${written.commands.map(command => `  ${command}`).join('\n')}\n`);
    return;
  }
  for (const name of ['--declaration', '--round', '--dev-runs']) if (values[name] !== undefined) fail(`${name} belongs to held-out sets`);
  const count = whole(values['--count'], '--count', set === 'dev' ? 8 : 24);
  if (count < 1 || count > 120) fail('--count must be 1 to 120');
  const [low, high] = SEED_RANGES[set];
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
  process.stdout.write(`bench: DISABLE_AUTOUPDATER=1 node src/cli/main.ts bench --agent <oracle|random|claude-code> $(node tools/challenge.ts args ${out}) --mirror required\n`);
}

async function verify(args: string[]): Promise<void> {
  const { positional } = options(args, []);
  if (positional.length !== 1) fail('name one generated folder');
  const result = await verifySet(positional[0]!);
  process.stdout.write(`${result.world.id}: ${result.instances} instances; references passed ${result.references.passed}/${result.references.total}; near misses failed ${result.nearMisses.total - result.nearMisses.passed}/${result.nearMisses.total} (separate checker processes)\n`);
  for (const failure of result.nearMisses.failures) process.stdout.write(`  near miss passed: ${failure}\n`);
  if (result.references.passed !== result.references.total || result.nearMisses.passed) process.exitCode = 2;
}

/** The bench arguments a set's instances.json names, one line, for `bench --agent <a> $(…)`; with
 * --tasks, only those tasks (to resume a stopped bench). */
async function benchArgs(args: string[]): Promise<void> {
  const { values, positional } = options(args, ['--tasks']);
  if (positional.length !== 1) fail('name one generated folder');
  const tasks = values['--tasks'] === undefined ? undefined : list(values['--tasks']);
  const result = await setArgs(positional[0]!, tasks);
  if (result.some(value => /\s/.test(value))) fail('a path in the bench arguments contains white space; pass them by hand');
  process.stdout.write(result.join(' ') + '\n');
}

async function declare(args: string[]): Promise<void> {
  const { values, flags } = options(args, ['--family', '--round', '--difficulty', '--dev', '--maintainer-approved', '--bench-root', '--out'], ['--force']);
  const family = values['--family'] as Family;
  if (!FAMILIES.includes(family)) fail('--family names one family');
  const out = values['--out'] ?? fail('--out is required');
  if (!out.endsWith(`${family}-round-${values['--round'] ?? ''}.declaration.json`)) fail(`name the file <folder>/${family}-round-<k>.declaration.json`);
  await refuseExisting(out, flags.has('--force'));
  const { declaration, text, seeds } = await declareFromFiles({
    family, round: whole(values['--round'], '--round'), difficulty: difficultyOf(values['--difficulty'] ?? fail('--difficulty is required')),
    development: list(values['--dev'] ?? fail('--dev names the development reports')), maintainerApproved: list(values['--maintainer-approved']), benchRoots: list(values['--bench-root']), out,
  });
  await writeFile(out, text);
  const counts = declaration.development.passed.map((row, index) => `${declaration.ladder[index]} ${row.filter(Boolean).length}/${row.length}`).join(', ');
  process.stdout.write(`${family} round ${declaration.round}: gate pair ${declaration.pair.strongest} (strongest) vs ${declaration.pair.weakest} (weakest), fixed by the capability order\n`);
  process.stdout.write(`development ${counts}: ${declaration.development.order === 'consistent' ? 'consistent with the capability order' : 'contradicts the capability order; the pair does not change'}; ${declaration.development.spent} development model runs found\n`);
  process.stdout.write(`release runs before this round: ${declaration.budget.releaseRunsBefore} (35${declaration.budget.earlier.map(entry => ` + ${entry.runs} ${entry.declaration}`).join('')}); after it at least ${declaration.budget.releaseRunsBefore + declaration.budget.roundRuns} of ${declaration.budget.releaseBudget}\n`);
  process.stdout.write(`held-out seeds ${seeds[0]}…${seeds.at(-1)} follow from the development runs; wrote ${out}. Commit and push it, then generate the held-out set.\n`);
}

async function gate(args: string[]): Promise<void> {
  const { values, flags } = options(args, ['--declaration', '--set', '--dev', '--oracle', '--random', '--ladder', '--previous', '--maintainer-approved', '--bench-root', '--out'], ['--force', '--preflight']);
  const files = {
    declaration: values['--declaration'] ?? fail('--declaration is required'), set: values['--set'] ?? fail('--set names the generated held-out folder'),
    development: list(values['--dev'] ?? fail('--dev names the development reports')), oracle: list(values['--oracle'] ?? fail('--oracle is required')), random: list(values['--random'] ?? fail('--random is required')),
    previous: list(values['--previous']), maintainerApproved: list(values['--maintainer-approved']), benchRoots: list(values['--bench-root']),
  };
  if (flags.has('--preflight')) {
    if (values['--ladder'] !== undefined || values['--out'] !== undefined) fail('--preflight checks the round before any ladder run: no --ladder, no --out');
    process.stdout.write((await preflightFromFiles(files)).text);
    return;
  }
  const out = values['--out'] ?? fail('--out is required');
  await refuseExisting(out, flags.has('--force'));
  const { result, markdown, ledger } = await gateFromFiles({ ...files, ladder: list(values['--ladder'] ?? fail('--ladder is required')) });
  const ledgerPath = join(dirname(out), `${result.family}-round${result.round}.ledger.json`);
  await writeFile(out, markdown);
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  process.stdout.write(`${result.family} round ${result.round}: ${result.verdict}; ${result.spent.total} model runs spent; wrote ${out} and ${ledgerPath}\n`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'generate') await generate(rest);
  else if (command === 'verify') await verify(rest);
  else if (command === 'args') await benchArgs(rest);
  else if (command === 'declare') await declare(rest);
  else if (command === 'gate') await gate(rest);
  else fail('name a command');
} catch (error) {
  process.stderr.write(`challenge: ${(error as { code?: string }).code ? `${(error as { code: string }).code}: ` : ''}${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
