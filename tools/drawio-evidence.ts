// The committed draw.io acceptance evidence (PADR-0049 decisions 8.6 and 8.9), rebuilt by a maintainer on
// the commit it describes, after `npm run test:drawio` wrote its summary:
//   PRACTONAUT_HOME=<home with setup --app drawio> node tools/drawio-evidence.ts --summary <summary.json> [--out docs/benchmarks/drawio]
// It benches the oracle on both libraries with --mirror required on the same seeds (one per variant case)
// and one repeat, keeps each bench folder without the agent's and the host's working folders, compares the
// two reports with --verify, and copies the three-run summary after checking it. The summary must have
// been made on this very commit from a clean checkout, over every planned sequence, with Chromium
// observed under its sandbox (review m2c); the benches run here, on the same commit. Nothing it writes
// may hold a local path; the draw.io release is never copied.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_CASES, loadLibraryOf } from '../src/library/index.ts';
import { plannedSequences } from '../tests/support/drawio-run.ts';
import { summaryProblems } from './require-drawio-summary.ts';

/** The entries of `<home>/bench/` now. */
export const benchEntries = (home: string): Set<string> => { const dir = join(home, 'bench'); return new Set(existsSync(dir) ? readdirSync(dir) : []); };
/**
 * The folder a bench run wrote: the one entry of `<home>/bench/` it added (review m2c). Never the
 * printed "Run logs and artifacts" text, which shortens a path under the user's home to `~/`.
 */
export function addedBenchFolder(home: string, before: ReadonlySet<string>): string {
  const added = [...benchEntries(home)].filter(entry => !before.has(entry));
  if (added.length !== 1) throw new Error(`expected one new folder under PRACTONAUT_HOME/bench, found ${added.length}`);
  const folder = join(home, 'bench', added[0]!);
  if (!statSync(folder).isDirectory()) throw new Error(`${added[0]} under PRACTONAUT_HOME/bench is not a folder`);
  return folder;
}

function main(): void {
  const root = fileURLToPath(new URL('..', import.meta.url)), cli = join(root, 'src/cli/main.ts');
  const args = process.argv.slice(2), value = (name: string): string | undefined => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
  const fail = (message: string): never => { process.stderr.write(`drawio-evidence: ${message}\n`); process.exit(1); };
  const summaryPath = value('--summary') ?? fail('--summary <summary.json> is required (npm run test:drawio writes .local/drawio-conformance/summary.json)');
  const out = resolve(value('--out') ?? join(root, 'docs/benchmarks/drawio'));
  const home = process.env.PRACTONAUT_HOME ? resolve(process.env.PRACTONAUT_HOME) : fail('set PRACTONAUT_HOME to a home in which setup --app drawio ran');
  const git = (...gitArgs: string[]): string => { const run = spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' }); return run.status === 0 ? run.stdout : fail(`git ${gitArgs.join(' ')} failed`); };
  const commit = git('rev-parse', 'HEAD').trim();
  if (git('status', '--porcelain').trim() !== '') fail('the checkout holds changes not in its commit; commit them, run npm run test:drawio, then this tool');
  const summaryText = readFileSync(summaryPath, 'utf8');
  const problems = summaryProblems(summaryText, { commit, planned: plannedSequences().length });
  if (problems.length) fail(`the summary does not stand as evidence for ${commit.slice(0, 12)}: ${problems.join('; ')}`);

  // One seed per variant case, the library's own (the same on both apps: one task set).
  const seeds = LIBRARY_CASES.map(variantCase => loadLibraryOf('drawio').library.tasks[0]!.oracle.seeds[variantCase]!);
  const scratch = join(root, '.local', 'drawio-evidence'); rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch, { recursive: true });
  const bench = (name: string, tasks: string, label: string): string => {
    const report = join(scratch, `${name}.json`), before = benchEntries(home);
    const run = spawnSync(process.execPath, [cli, 'bench', '--agent', 'oracle', '--tasks', tasks, '--seed-list', seeds.join(','), '--repeats', '1', '--mirror', 'required', '--label', label, '--out', report], { cwd: root, encoding: 'utf8', env: { ...process.env, PRACTONAUT_HOME: home }, maxBuffer: 64 * 1024 * 1024 });
    if (run.status !== 0) fail(`bench ${name} exited ${run.status}:\n${run.stderr.slice(-2000)}`);
    let folder = '';
    try { folder = addedBenchFolder(home, before); } catch (error) { fail(`bench ${name}: ${(error as Error).message}`); }
    // The bench folder without the agent's and the host's working folders (configuration, sockets, logs).
    const target = join(out, name);
    rmSync(target, { recursive: true, force: true });
    cpSync(folder, target, { recursive: true, filter: source => !/[\\/](agent|host)$/.test(source) });
    writeFileSync(join(target, 'report.json'), readFileSync(report, 'utf8'));
    return join(target, 'report.json');
  };
  mkdirSync(out, { recursive: true });
  const excalidraw = bench('excalidraw-oracle', 'all', 'Excalidraw library, oracle'), drawio = bench('drawio-oracle', 'drawio/all', 'draw.io library, oracle');
  const compared = spawnSync(process.execPath, [cli, 'compare', excalidraw, drawio, '--verify', '--html', join(out, 'compare.html'), '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, PRACTONAUT_HOME: home }, maxBuffer: 64 * 1024 * 1024 });
  if (compared.status !== 0) fail(`compare exited ${compared.status}:\n${compared.stderr.slice(-2000)}`);
  writeFileSync(join(out, 'compare.json'), JSON.stringify(JSON.parse(compared.stdout), null, 2) + '\n');
  writeFileSync(join(out, 'conformance-summary.json'), summaryText);
  // No local path in anything written.
  const forbidden = [root, homedir(), tmpdir(), home].filter(path => path.length > 1);
  const files = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : [path]; });
  for (const file of files(out)) {
    if (/\.war$/i.test(file)) fail(`${relative(root, file)}: no draw.io release in the evidence`);
    const text = readFileSync(file, 'latin1');
    for (const path of forbidden) if (text.includes(path)) fail(`${relative(root, file)} holds a local path`);
  }
  rmSync(scratch, { recursive: true, force: true });
  process.stdout.write(`drawio-evidence: wrote ${relative(root, out)} for ${commit.slice(0, 12)} (two oracle benches on seeds ${seeds.join(', ')}, the compare page and the three-run summary)\n`);
  if (!existsSync(join(out, 'README.md'))) process.stdout.write('drawio-evidence: docs/benchmarks/drawio/README.md describes these files; update its numbers\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
