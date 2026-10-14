// Challenge-tier tooling for maintainers (PADR-0040). Candidate families are not part of the CLI
// until they pass their gate; this tool generates, checks and gates them from a checkout.
//
//   node tools/challenge.ts generate <family> --set dev|check|heldout [--round <1|2>] [--seed <n>]
//                                    [--count <k>] [--difficulty 1|2|3|mixed] --out <dir> [--force]
//   node tools/challenge.ts verify <dir>
//   node tools/challenge.ts gate --family <f> --round <k> --oracle <report.json> --random <report.json>
//                                --ladder <a.json,b.json,c.json> --strongest <model> --weakest <model>
//                                [--dev-runs <n>] [--previous <report.json,…>] [--release-runs <n>]
//                                --out <docs/benchmarks/challenge/<family>-round<k>.md> [--force]
//
// Families: repair, injection, long-horizon, limited-checks, tight-budget (roadmap order).
// Seeds: development 1–999 (default 1…8), throwaway checks 10000–19999 (default 10001…10024),
// held-out ≥ 1000000 (default: a random base drawn now and printed; generate held-out sets right
// before a gate round and do not look at them while tuning).
import { randomInt } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { SEED_RANGES, generateSet, type SeedSet } from '../src/challenge/build.ts';
import { FAMILIES, type Difficulty, type Family } from '../src/challenge/families.ts';
import { gateFromFiles, verifySet, writeSet } from '../src/challenge/files.ts';

const usage = `usage:
  node tools/challenge.ts generate <family> --set dev|check|heldout [--round 1|2] [--seed <n>] [--count <k>] [--difficulty 1|2|3|mixed] --out <dir> [--force]
  node tools/challenge.ts verify <dir>
  node tools/challenge.ts gate --family <f> --round <k> --oracle <report.json> --random <report.json> --ladder <a.json,b.json,c.json>
                               --strongest <model> --weakest <model> [--dev-runs <n>] [--previous <report.json,…>] [--release-runs <n>] --out <file.md> [--force]
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

async function generate(args: string[]): Promise<void> {
  const { values, flags, positional } = options(args, ['--set', '--round', '--seed', '--count', '--difficulty', '--out'], ['--force']);
  const family = positional[0] as Family;
  if (positional.length !== 1 || !FAMILIES.includes(family)) fail('name one family');
  const set = values['--set'] as SeedSet;
  if (!['dev', 'check', 'heldout'].includes(set)) fail('--set must be dev, check or heldout');
  const out = values['--out'] ?? fail('--out is required');
  const round = values['--round'] === undefined ? undefined : whole(values['--round'], '--round');
  if (set === 'heldout' && (round !== 1 && round !== 2)) fail('a held-out set names its gate round: --round 1 or --round 2');
  if (set !== 'heldout' && round !== undefined) fail('--round belongs to held-out sets');
  const count = whole(values['--count'], '--count', set === 'dev' ? 8 : 24);
  if (count < 1 || count > 120) fail('--count must be 1 to 120');
  const [low, high] = SEED_RANGES[set];
  const first = values['--seed'] !== undefined ? whole(values['--seed'], '--seed') : set === 'dev' ? 1 : set === 'check' ? 10_001 : randomInt(low, high - count);
  if (first < low || first + count - 1 > high) fail(`--set ${set} uses seeds ${low} to ${high}; ${first}…${first + count - 1} is outside`);
  const rawDifficulty = values['--difficulty'] ?? 'mixed';
  if (!['1', '2', '3', 'mixed'].includes(rawDifficulty)) fail('--difficulty must be 1, 2, 3 or mixed');
  const difficulty = rawDifficulty === 'mixed' ? 'mixed' : Number(rawDifficulty) as Difficulty;
  const seeds = Array.from({ length: count }, (_, index) => first + index);
  const name = set === 'heldout' ? `r${round}` : set;
  const started = performance.now();
  const generated = generateSet(family, seeds, difficulty, name);
  const written = await writeSet(generated, out, { family, set, ...(round !== undefined ? { round } : {}), difficulty: String(difficulty), seeds }, flags.has('--force'));
  const lengths = generated.instances.map(instance => instance.oracle.steps.length);
  process.stdout.write(`${family}: ${count} instances, seeds ${first}…${first + count - 1}${set === 'heldout' && values['--seed'] === undefined ? ' (base drawn at random)' : ''}, difficulty ${difficulty}, world ${generated.world.id}\n`);
  process.stdout.write(`reference lengths ${Math.min(...lengths)}–${Math.max(...lengths)} (proven minimal for ${generated.instances.filter(instance => instance.minimal).length} of ${count}); near misses ${generated.oracles.reduce((total, oracle) => total + oracle.nearMisses.length, 0)}; ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
  process.stdout.write(`wrote ${written.world}, ${written.oracles.length} oracle files, ${written.instances}\n`);
  process.stdout.write(`bench: node src/cli/main.ts bench --agent <oracle|random|claude-code> with the arguments in ${written.instances} (bench.args)\n`);
}

async function verify(args: string[]): Promise<void> {
  const { positional } = options(args, []);
  if (positional.length !== 1) fail('name one generated folder');
  const result = await verifySet(positional[0]!);
  process.stdout.write(`${result.world.id}: ${result.instances} instances; references passed ${result.references.passed}/${result.references.total}; near misses failed ${result.nearMisses.total - result.nearMisses.passed}/${result.nearMisses.total} (separate checker processes)\n`);
  for (const failure of result.nearMisses.failures) process.stdout.write(`  near miss passed: ${failure}\n`);
  if (result.references.passed !== result.references.total || result.nearMisses.passed) process.exitCode = 2;
}

async function gate(args: string[]): Promise<void> {
  const { values, flags } = options(args, ['--family', '--round', '--oracle', '--random', '--ladder', '--strongest', '--weakest', '--dev-runs', '--previous', '--release-runs', '--out'], ['--force']);
  const family = values['--family'] as Family;
  if (!FAMILIES.includes(family)) fail('--family names one family');
  const out = values['--out'] ?? fail('--out is required');
  if (!flags.has('--force')) { try { await lstat(out); fail(`${out} exists; add --force to replace it`); } catch { /* new file */ } }
  const ladder = (values['--ladder'] ?? fail('--ladder is required')).split(',');
  const { result, markdown } = await gateFromFiles({
    family, round: whole(values['--round'], '--round'), oracle: values['--oracle'] ?? fail('--oracle is required'), random: values['--random'] ?? fail('--random is required'), ladder,
    strongest: values['--strongest'] ?? fail('--strongest is required'), weakest: values['--weakest'] ?? fail('--weakest is required'),
    ...(values['--dev-runs'] !== undefined ? { developmentRuns: whole(values['--dev-runs'], '--dev-runs') } : {}),
    ...(values['--previous'] !== undefined ? { previous: values['--previous'].split(',') } : {}),
    ...(values['--release-runs'] !== undefined ? { releaseRunsBefore: whole(values['--release-runs'], '--release-runs') } : {}),
  });
  await writeFile(out, markdown);
  process.stdout.write(`${family} round ${result.round}: ${result.verdict}; wrote ${out}\n`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'generate') await generate(rest);
  else if (command === 'verify') await verify(rest);
  else if (command === 'gate') await gate(rest);
  else fail('name a command');
} catch (error) {
  process.stderr.write(`challenge: ${(error as { code?: string }).code ? `${(error as { code: string }).code}: ` : ''}${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
