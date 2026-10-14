import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cliText, getCliLanguage } from './messages.ts';
import { RuntimeError } from './runtime.ts';
import { checksOption, fallbackNotice, resolveMirror } from './serve.ts';
import { displayPath, safeJson, safeText } from './output.ts';
import { loadLibrary, LIBRARY_PREFIX } from '../library/index.ts';
import { AgentTemplateError, agentEnvironment, ENV_NAME, resolveAgent } from '../bench/agents.ts';
import { killRunningAgents, libraryWorld, runBench } from '../bench/run.ts';
import { verifyBenchArtifacts, verifyBenchV2 } from '../bench/verify.ts';
import { BenchReportError, isBenchReportV2, MAX_LABEL, MAX_SEED, validateBenchReport } from '../bench/report.ts';
import { libraryBenchWorld, libraryReferences, ownBenchWorld, ownReferences, readOracleFile, resolveWorldTasks, validateOwnReferences, type BenchReference, type BenchWorld } from '../bench/world.ts';
import { readTokensCss, renderHtml, renderTable } from '../bench/render.ts';
import { parseJsonEntry } from '../package/json.ts';
import { inlineOptionValues } from './options.ts';

const VALUED = ['--agent', '--tasks', '--seeds', '--seed-list', '--repeats', '--timeout', '--max-actions', '--mirror', '--out', '--keep-env', '--world', '--oracle', '--label', '--checks'];
function flags(given: string[], valued: string[], booleans: string[] = []): { flags: Record<string, string>; positional: string[]; booleans: Set<string> } {
  const args = inlineOptionValues(given, valued);
  const out: Record<string, string> = {}, positional: string[] = [], seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (booleans.includes(arg)) { if (seen.has(arg)) throw new RuntimeError('usage', cliText('optionDuplicate', { option: arg })); seen.add(arg); continue; }
    if (arg.startsWith('--')) {
      if (!valued.includes(arg)) throw new RuntimeError('usage', cliText('optionUnknown', { option: safeText(arg) }));
      if (Object.hasOwn(out, arg)) throw new RuntimeError('usage', cliText('optionDuplicate', { option: arg }));
      const value = args[++i];
      if (value === undefined || value === '' || (value.startsWith('--') && arg !== '--agent')) throw new RuntimeError('usage', cliText('optionValue', { option: arg }));
      out[arg] = value;
    } else positional.push(arg);
  }
  return { flags: out, positional, booleans: seen };
}
function positiveInteger(raw: string | undefined, fallback: number, option: string, max: number): number {
  if (raw === undefined) return fallback;
  if (!/^\d{1,9}$/.test(raw) || Number(raw) < 1 || Number(raw) > max) throw new RuntimeError('usage', cliText('benchNumber', { option, max }));
  return Number(raw);
}

/** `--seed-list 2,5`: distinct whole numbers 0 … MAX_SEED, at most 1000. */
function seedList(raw: string): number[] {
  const values = raw.split(',').map(value => value.trim());
  if (!values.length || values.length > 1000 || values.some(value => !/^\d{1,9}$/.test(value))) throw new RuntimeError('usage', cliText('benchSeedList'));
  const seeds = values.map(Number);
  if (seeds.some(value => value > MAX_SEED) || new Set(seeds).size !== seeds.length) throw new RuntimeError('usage', cliText('benchSeedList'));
  return seeds;
}

export interface BenchArguments {
  agent: string;
  /** Library task ids (resolved here), or with `--world` the requested ids or `all` (resolved once the world is loaded). */
  tasks: string[] | 'all';
  world?: string; oracles: string[];
  seeds: number[]; repeats: number; timeoutSeconds: number; maxActions: number; mirror: 'auto' | 'required' | 'off'; keepEnv: string[]; label?: string; out?: string;
  /** `--checks <n>`: checks allowed per run (a task's own limit can only be lowered). */
  checks?: number;
}
export function parseBenchArguments(args: string[]): BenchArguments {
  const parsed = flags(args, VALUED);
  if (parsed.positional.length || !parsed.flags['--agent']) throw new RuntimeError('usage', cliText('benchUsage'));
  const world = parsed.flags['--world'];
  const oracles = parsed.flags['--oracle'] === undefined ? [] : parsed.flags['--oracle'].split(',').map(value => value.trim());
  if (oracles.some(path => !path)) throw new RuntimeError('usage', cliText('optionValue', { option: '--oracle' }));
  // Library tasks bring their reference solutions; an oracle sidecar belongs to an own world.
  if (oracles.length && world === undefined) throw new RuntimeError('usage', cliText('benchOracleNeedsWorld'));
  const requested = parsed.flags['--tasks'] ?? 'all';
  const named = requested === 'all' ? 'all' as const : requested.split(',').map(value => value.trim()).filter(Boolean);
  let tasks: string[] | 'all';
  if (world === undefined) {
    const library = loadLibrary().library.tasks.map(task => task.id);
    tasks = named === 'all' ? library : named.map(value => value.startsWith(LIBRARY_PREFIX) ? value.slice(LIBRARY_PREFIX.length) : value);
    for (const task of tasks) if (!library.includes(task)) throw new RuntimeError('task_unknown', cliText('tasksUnknown', { id: safeText(task) }));
    if (!tasks.length || new Set(tasks).size !== tasks.length) throw new RuntimeError('usage', cliText('benchTasks'));
  } else {
    tasks = named;
    if (tasks !== 'all' && (!tasks.length || new Set(tasks).size !== tasks.length)) throw new RuntimeError('usage', cliText('benchTasks'));
  }
  if (parsed.flags['--seeds'] !== undefined && parsed.flags['--seed-list'] !== undefined) throw new RuntimeError('usage', cliText('benchSeedsExclusive'));
  const seeds = parsed.flags['--seed-list'] !== undefined ? seedList(parsed.flags['--seed-list']) : Array.from({ length: positiveInteger(parsed.flags['--seeds'], 1, '--seeds', 1000) }, (_, index) => index + 1);
  const mirror = parsed.flags['--mirror'] ?? 'auto';
  if (mirror !== 'auto' && mirror !== 'required' && mirror !== 'off') throw new RuntimeError('usage', cliText('mirrorUsage'));
  const keepEnv = parsed.flags['--keep-env'] === undefined ? [] : parsed.flags['--keep-env'].split(',').map(value => value.trim());
  if (keepEnv.some(name => !ENV_NAME.test(name))) throw new RuntimeError('usage', cliText('benchKeepEnv'));
  if (new Set(keepEnv).size !== keepEnv.length) throw new RuntimeError('usage', cliText('benchKeepEnv'));
  const label = parsed.flags['--label'];
  if (label !== undefined && label.length > MAX_LABEL) throw new RuntimeError('usage', cliText('benchLabel', { max: MAX_LABEL }));
  return {
    agent: parsed.flags['--agent']!, tasks, ...(world !== undefined ? { world } : {}), oracles, seeds,
    repeats: positiveInteger(parsed.flags['--repeats'], 1, '--repeats', 1000), timeoutSeconds: positiveInteger(parsed.flags['--timeout'], 300, '--timeout', 86_400),
    maxActions: positiveInteger(parsed.flags['--max-actions'], 50, '--max-actions', 10_000), mirror, keepEnv, ...(label !== undefined ? { label } : {}), ...(parsed.flags['--out'] ? { out: parsed.flags['--out'] } : {}),
    ...(parsed.flags['--checks'] !== undefined ? { checks: checksOption(parsed.flags['--checks']) } : {}),
  };
}

/** The world, the benched tasks and their validated references. An own world's oracle files are read,
 * matched to its tasks and accepted only after the checker passes each for every planned seed. */
export async function prepareBench(options: Pick<BenchArguments, 'world' | 'tasks' | 'oracles' | 'seeds'>, agent: { kind: string; name: string }): Promise<{ world: BenchWorld; tasks: string[]; references: Map<string, BenchReference> }> {
  if (options.world === undefined) {
    const tasks = options.tasks === 'all' ? loadLibrary().library.tasks.map(task => task.id) : options.tasks;
    return { world: await libraryBenchWorld(), tasks, references: libraryReferences(tasks) };
  }
  const world = await ownBenchWorld(options.world);
  const tasks = resolveWorldTasks(world.world, options.tasks);
  const oracles = [];
  for (const path of options.oracles) oracles.push({ path, oracle: await readOracleFile(path) });
  const references = ownReferences(world.world, tasks, oracles);
  const missing = tasks.filter(task => !references.has(task));
  if (agent.kind === 'builtin' && agent.name === 'oracle' && missing.length) throw new RuntimeError('usage', cliText('benchOracleMissing', { tasks: missing.map(safeText).join(', ') }));
  await validateOwnReferences(world.world, references, options.seeds);
  return { world, tasks, references };
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  try { await writeFile(temporary, text, { flag: 'wx', mode: 0o644 }); await rename(temporary, path); }
  catch (error) { await rm(temporary, { force: true }); throw new RuntimeError('usage', cliText('writeFailed', { path: safeText(displayPath(path)), code: (error as NodeJS.ErrnoException).code ?? 'error' })); }
}

/** practonaut bench --agent <preset|builtin|command> … : runs the grid, writes a validated report. */
export async function commandBench(args: string[]): Promise<number> {
  const options = parseBenchArguments(args);
  let agent;
  try { agent = resolveAgent(options.agent); } catch (error) { if (error instanceof AgentTemplateError) throw new RuntimeError('usage', error.message); throw error; }
  if (options.keepEnv.length && agent.kind !== 'preset') throw new RuntimeError('usage', cliText('benchKeepEnvPreset'));
  // Names only, never values: what the preset agent will not get (PADR-0034).
  const { withheld } = agentEnvironment(agent, process.env, options.keepEnv);
  if (withheld.length) process.stderr.write(cliText('benchWithheld', { agent: agent.name, names: withheld.map(safeText).join(', ') }));
  // World, tasks and references are settled (and an own oracle checked) before anything starts.
  const prepared = await prepareBench(options, agent);
  const mirror = await resolveMirror(options.mirror);
  process.stderr.write(fallbackNotice(mirror));
  if (prepared.world.source === 'own') process.stderr.write(cliText('benchWorldOwn', { world: safeText(prepared.world.world.id), version: safeText(prepared.world.world.version), refs: prepared.references.size, tasks: prepared.tasks.length }));
  process.stderr.write(cliText('benchStart', { runs: prepared.tasks.length * options.seeds.length * options.repeats, agent: agent.name, mode: mirror.mode === 'required' ? 'real-engine' : cliText('modelOnly') }));
  // Ctrl+C, SIGTERM and SIGHUP stop the bench in order: the running agent (its whole process group or
  // tree) is ended, its session host closes and removes its token file, and the runs that finished
  // are written as a partial report. The default handler would kill only this process. A second
  // signal does not wait for that: it ends the running agent's group and exits at once, without a report.
  const stop = new AbortController();
  const onSignal = (): void => {
    if (!stop.signal.aborted) { process.stderr.write(cliText('benchInterrupting')); stop.abort(); return; }
    killRunningAgents();
    process.stderr.write(cliText('benchForcedStop'));
    process.exit(EXIT_INTERRUPTED);
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const name of signals) process.on(name, onSignal);
  let result: Awaited<ReturnType<typeof runBench>>;
  try {
    result = await runBench({ agent, tasks: prepared.tasks, world: prepared.world, references: prepared.references, seeds: options.seeds, repeats: options.repeats, timeoutSeconds: options.timeoutSeconds, maxActions: options.maxActions, mirrorRequested: options.mirror, mirror: mirror.mode, keepEnv: options.keepEnv, ...(options.label !== undefined ? { label: options.label } : {}), ...(options.checks !== undefined ? { checks: options.checks } : {}), progress: line => process.stderr.write(`  ${line}\n`), signal: stop.signal });
  } finally { for (const name of signals) process.off(name, onSignal); }
  const { report, directory } = result;
  if (report === null) {
    process.stderr.write(cliText('benchInterruptedEmpty', { logs: safeText(displayPath(directory)) }));
    return EXIT_INTERRUPTED;
  }
  const out = options.out ?? join(directory, 'report.json');
  await writeAtomic(out, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write('\n' + renderTable(report, getCliLanguage()));
  if (report.interrupted) process.stdout.write(cliText('benchInterrupted', { runs: report.runs.length, planned: report.interrupted.plannedRuns }));
  process.stdout.write(cliText('benchWritten', { path: safeText(displayPath(out)), logs: safeText(displayPath(directory)) }));
  return report.interrupted ? EXIT_INTERRUPTED : 0;
}

/** 128 + SIGINT, as shells report a command stopped by Ctrl+C. */
const EXIT_INTERRUPTED = 130;

/** Largest bench report read (100 000 runs fit comfortably). */
const MAX_REPORT_BYTES = 128 * 1024 * 1024;

/** practonaut report <bench.json> [--verify [--runs <dir>]] [--html <out.html>] [--json]: validates, optionally re-judges, then renders. */
export async function commandReport(args: string[]): Promise<number> {
  const parsed = flags(args, ['--html', '--runs'], ['--json', '--verify']);
  if (parsed.positional.length !== 1) throw new RuntimeError('usage', cliText('reportUsage'));
  if (parsed.flags['--runs'] !== undefined && !parsed.booleans.has('--verify')) throw new RuntimeError('usage', cliText('reportRunsNeedsVerify'));
  const path = parsed.positional[0]!;
  let bytes: Buffer;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'EISDIR' });
    if (info.size > MAX_REPORT_BYTES) throw new RuntimeError('bench_report_invalid', cliText('reportTooLarge', { size: MAX_REPORT_BYTES / 1024 / 1024 }));
    bytes = await readFile(path);
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError('usage', cliText('readFailed', { path: safeText(displayPath(path)), code: (error as NodeJS.ErrnoException).code ?? 'error' }));
  }
  let report;
  try { report = validateBenchReport(parseJsonEntry(bytes, 'bench-report.json', 64)); }
  catch (error) {
    if (error instanceof BenchReportError) throw new RuntimeError(error.code, error.message);
    throw new RuntimeError('bench_report_invalid', cliText('reportJson'));
  }
  // Without --verify only the report's own arithmetic is checked; --verify re-judges the run artifacts:
  // a /2 report against the world stored in its bench folder, a /1 report against the bundled library.
  let verification: { level: 'consistency-checked' } | { level: 're-verified'; reverified: number; unjudged: number; references?: number; world?: { id: string; version: string } } = { level: 'consistency-checked' };
  if (parsed.booleans.has('--verify')) {
    const runs = parsed.flags['--runs'] ?? dirname(path);
    try { verification = { level: 're-verified', ...(isBenchReportV2(report) ? await verifyBenchV2(report, runs) : await verifyBenchArtifacts(report, runs, await libraryWorld())) }; }
    catch (error) { if (error instanceof BenchReportError) throw new RuntimeError(error.code, error.message); throw error; }
  }
  if (parsed.booleans.has('--json')) process.stdout.write(safeJson({ ok: true, schema: report.schema, verification, summary: report.summary }) + '\n');
  else {
    process.stdout.write(renderTable(report, getCliLanguage()));
    process.stdout.write(verification.level === 're-verified'
      ? verification.world ? cliText('reportReverifiedWorld', { world: safeText(verification.world.id), version: safeText(verification.world.version), runs: verification.reverified, unjudged: verification.unjudged, references: verification.references ?? 0 })
        : cliText('reportReverified', { runs: verification.reverified, unjudged: verification.unjudged })
      : cliText('reportConsistencyOnly'));
  }
  const html = parsed.flags['--html'];
  if (html) {
    await writeAtomic(html, renderHtml(report, await readTokensCss(), getCliLanguage(), verification.level));
    if (!parsed.booleans.has('--json')) process.stdout.write(cliText('reportHtml', { path: safeText(displayPath(html)) }));
  }
  return 0;
}
