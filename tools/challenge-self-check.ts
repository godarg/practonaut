// The layout family's distribution self-check (PADR-0047 decision 9.8), for maintainers:
//
//   node tools/challenge-self-check.ts [--seed <first>] [--count <n>] [--difficulty 1|2|3|mixed] [--draft]
//
// Draws `count` development instances (default 100 from seed 1, mixed difficulty) exactly as a set
// would, builds and checks each (unless --draft), and prints the distribution of topologies and
// stated clause kinds and every rejection reason with its count. Exits 2 when a planned topology part
// or clause kind is under 10 % of the instances, or a seed yields no instance.
import { SEED_RANGES } from '../src/challenge/build.ts';
import type { Difficulty } from '../src/challenge/families.ts';
import { layoutSelfCheck } from '../src/challenge/self-check.ts';

const args = process.argv.slice(2);
const value = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const fail = (message: string): never => { process.stderr.write(`challenge-self-check: ${message}\n`); process.exit(1); };
const first = Number(value('--seed') ?? 1), count = Number(value('--count') ?? 100), raw = value('--difficulty') ?? 'mixed';
if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || count < 1 || first < SEED_RANGES.dev[0] || first + count - 1 > SEED_RANGES.dev[1]) fail(`seeds must lie in the development range ${SEED_RANGES.dev[0]}–${SEED_RANGES.dev[1]}`);
if (!['1', '2', '3', 'mixed'].includes(raw)) fail('--difficulty must be 1, 2, 3 or mixed');
const difficulty = raw === 'mixed' ? 'mixed' : Number(raw) as Difficulty;
const started = performance.now();
const result = layoutSelfCheck(Array.from({ length: count }, (_, index) => first + index), difficulty, args.includes('--draft') ? 'draft' : 'build');
const table = (record: Record<string, number>): string => Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, n]) => `  ${key}: ${n}`).join('\n') || '  (none)';
process.stdout.write(`layout self-check (${result.mode}): ${result.instances} of ${count} seeds from ${first}, difficulty ${raw}, ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
process.stdout.write(`topologies:\n${table(result.topologies)}\nparts:\n${table(result.parts)}\nstated clause kinds:\n${table(result.clauses)}\nrejections:\n${table(result.rejections)}\n`);
if (result.failed.length) process.stdout.write(`no instance: seeds ${result.failed.join(', ')}\n`);
if (result.belowFloor.length) process.stdout.write(`below the 10 % floor: ${result.belowFloor.join('; ')}\n`);
process.stdout.write(result.belowFloor.length || result.failed.length ? 'self-check FAILED\n' : 'self-check passed\n');
if (result.belowFloor.length || result.failed.length) process.exitCode = 2;
