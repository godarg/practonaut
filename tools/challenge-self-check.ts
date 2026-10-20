// The layout family's distribution self-check (PADR-0047 decision 9.8), for maintainers:
//
//   node tools/challenge-self-check.ts [--seed <first>] [--count <n>] [--difficulty 1|2|3|mixed|all] [--draft]
//
// Draws `count` development instances (default 100 from seed 1) exactly as a set would, builds and
// checks each (unless --draft), and prints the distribution of topologies, lanes, stated clauses per lane
// and their combinations, and every rejection reason with its count. `all` (the default) checks each
// difficulty a round may declare (1, 2, 3 and mixed). Exits 2 when a planned item is under 10 % (a
// combination: of the instances with its part), or a seed yields no instance.
import { SEED_RANGES } from '../src/challenge/build.ts';
import type { Difficulty } from '../src/challenge/families.ts';
import { layoutSelfCheck } from '../src/challenge/self-check.ts';

const args = process.argv.slice(2);
const value = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const fail = (message: string): never => { process.stderr.write(`challenge-self-check: ${message}\n`); process.exit(1); };
const first = Number(value('--seed') ?? 1), count = Number(value('--count') ?? 100), raw = value('--difficulty') ?? 'all';
if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || count < 1 || first < SEED_RANGES.dev[0] || first + count - 1 > SEED_RANGES.dev[1]) fail(`seeds must lie in the development range ${SEED_RANGES.dev[0]}–${SEED_RANGES.dev[1]}`);
if (!['1', '2', '3', 'mixed', 'all'].includes(raw)) fail('--difficulty must be 1, 2, 3, mixed or all');
const levels: Array<Difficulty | 'mixed'> = raw === 'all' ? [1, 2, 3, 'mixed'] : [raw === 'mixed' ? 'mixed' : Number(raw) as Difficulty];
const table = (record: Record<string, number>): string => Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, n]) => `  ${key}: ${n}`).join('\n') || '  (none)';
let failedAny = false;
for (const difficulty of levels) {
  const started = performance.now();
  const result = layoutSelfCheck(Array.from({ length: count }, (_, index) => first + index), difficulty, args.includes('--draft') ? 'draft' : 'build');
  process.stdout.write(`layout self-check (${result.mode}): ${result.instances} of ${count} seeds from ${first}, difficulty ${difficulty}, ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
  process.stdout.write(`topologies:\n${table(result.topologies)}\nparts:\n${table(result.parts)}\nlanes:\n${table(result.lanes)}\nstated clauses:\n${table(result.clauses)}\n`);
  process.stdout.write(`combinations:\n${Object.entries(result.combinations).map(([key, entry]) => `  ${key}: ${entry.with}/${entry.of}`).join('\n')}\nrejections:\n${table(result.rejections)}\n`);
  if (result.failed.length) process.stdout.write(`no instance: seeds ${result.failed.join(', ')}\n`);
  if (result.belowFloor.length) process.stdout.write(`below the 10 % floor: ${result.belowFloor.join('; ')}\n`);
  const failed = result.belowFloor.length > 0 || result.failed.length > 0;
  failedAny ||= failed;
  process.stdout.write(`difficulty ${difficulty}: ${failed ? 'FAILED' : 'passed'}\n\n`);
}
process.stdout.write(failedAny ? 'self-check FAILED\n' : 'self-check passed\n');
if (failedAny) process.exitCode = 2;
