// The committed draw.io acceptance evidence (PADR-0049 decisions 8.6 and 8.9), rebuilt by a maintainer on
// the commit it describes, after `npm run test:drawio` wrote its summary:
//   PRACTONAUT_HOME=<home with setup --app drawio> node tools/drawio-evidence.ts --summary <summary.json> [--out docs/benchmarks/drawio]
// It benches the oracle on both libraries with --mirror required on the same seeds (one per variant case)
// and one repeat, keeps each bench folder without the agent's and the host's working folders, compares the
// two reports with --verify, and copies the three-run summary after checking it. Nothing it writes may
// hold a local path; the draw.io release is never copied.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_CASES, loadLibraryOf } from '../src/library/index.ts';
import { summaryProblems } from './require-drawio-summary.ts';

const root = fileURLToPath(new URL('..', import.meta.url)), cli = join(root, 'src/cli/main.ts');
const args = process.argv.slice(2), value = (name: string): string | undefined => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const fail = (message: string): never => { process.stderr.write(`drawio-evidence: ${message}\n`); process.exit(1); };
const summaryPath = value('--summary') ?? fail('--summary <summary.json> is required (npm run test:drawio writes .local/drawio-conformance/summary.json)');
const out = resolve(value('--out') ?? join(root, 'docs/benchmarks/drawio'));
if (!process.env.PRACTONAUT_HOME) fail('set PRACTONAUT_HOME to a home in which setup --app drawio ran');
const summaryText = readFileSync(summaryPath, 'utf8');
const problems = summaryProblems(summaryText);
if (problems.length) fail(`the summary does not show a complete run: ${problems.join('; ')}`);

// One seed per variant case, the library's own (the same on both apps: one task set).
const seeds = LIBRARY_CASES.map(variantCase => loadLibraryOf('drawio').library.tasks[0]!.oracle.seeds[variantCase]!);
const scratch = join(root, '.local', 'drawio-evidence'); rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch, { recursive: true });
function bench(name: string, tasks: string, label: string): string {
  const report = join(scratch, `${name}.json`);
  const run = spawnSync(process.execPath, [cli, 'bench', '--agent', 'oracle', '--tasks', tasks, '--seed-list', seeds.join(','), '--repeats', '1', '--mirror', 'required', '--label', label, '--out', report], { cwd: root, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) fail(`bench ${name} exited ${run.status}:\n${run.stderr.slice(-2000)}`);
  const folder = /^Run logs and artifacts: (.+)$/m.exec(run.stdout)?.[1] ?? fail(`bench ${name} named no folder`);
  // The bench folder without the agent's and the host's working folders (configuration, sockets, logs).
  const target = join(out, name);
  rmSync(target, { recursive: true, force: true });
  cpSync(resolve(root, folder), target, { recursive: true, filter: source => !/[\\/](agent|host)$/.test(source) });
  writeFileSync(join(target, 'report.json'), readFileSync(report, 'utf8'));
  return join(target, 'report.json');
}
mkdirSync(out, { recursive: true });
const excalidraw = bench('excalidraw-oracle', 'all', 'Excalidraw library, oracle'), drawio = bench('drawio-oracle', 'drawio/all', 'draw.io library, oracle');
const compared = spawnSync(process.execPath, [cli, 'compare', excalidraw, drawio, '--verify', '--html', join(out, 'compare.html'), '--json'], { cwd: root, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
if (compared.status !== 0) fail(`compare exited ${compared.status}:\n${compared.stderr.slice(-2000)}`);
writeFileSync(join(out, 'compare.json'), JSON.stringify(JSON.parse(compared.stdout), null, 2) + '\n');
writeFileSync(join(out, 'conformance-summary.json'), summaryText);
// No local path in anything written.
const forbidden = [root, homedir(), tmpdir(), resolve(process.env.PRACTONAUT_HOME ?? '')].filter(path => path.length > 1);
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : [path]; });
for (const file of files(out)) {
  if (/\.war$/i.test(file)) fail(`${relative(root, file)}: no draw.io release in the evidence`);
  const text = readFileSync(file, 'latin1');
  for (const path of forbidden) if (text.includes(path)) fail(`${relative(root, file)} holds a local path`);
}
rmSync(scratch, { recursive: true, force: true });
process.stdout.write(`drawio-evidence: wrote ${relative(root, out)} (two oracle benches on seeds ${seeds.join(', ')}, the compare page and the three-run summary)\n`);
if (!existsSync(join(out, 'README.md'))) process.stdout.write('drawio-evidence: docs/benchmarks/drawio/README.md describes these files; update its numbers\n');
