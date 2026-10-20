/**
 * The file side of the release ledger (PADR-0042 decision 4, PADR-0044 decision 8): the local
 * ledger (one per user and repository under PRACTONAUT_HOME, repository.ts), which only `ledger init`
 * creates (a copy of the longest pushed one), every start and run-end record appended under a lock;
 * the committed copy written from it; the start guard the bench runner consults before every client
 * start; and the recovery that appends the run-end records a killed bench's folders prove.
 */
import { appendFile, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { StartGuard, StartRequest } from '../bench/run.ts';
import type { SessionRunV3 } from '../bench/report.ts';
import { countLedger, headerLine, isPrefix, LedgerError, nextLine, parseLedger, RELEASE, RELEASE_CAP, type Ledger, type Purpose, type RoundBody, type RunEndBody, type StartBody, type StartRecord } from './ledger.ts';

/** The local ledger and the committed copy beside the release's round files. */
export interface LedgerPaths { local: string; committed: string }
/** Largest ledger read (the cap allows well under 10 000 records of a few hundred bytes). */
const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
const LOCK_WAIT_MS = 30_000;

async function readText(path: string): Promise<string | null> {
  try {
    const handle = await open(path, 'r');
    try {
      if ((await handle.stat()).size > MAX_LEDGER_BYTES) throw new LedgerError('ledger_invalid', `${path} is larger than ${MAX_LEDGER_BYTES} bytes`);
      return await handle.readFile('utf8');
    } finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
/** A ledger file, verified; null when it does not exist. */
export async function readLedger(path: string, release = RELEASE): Promise<Ledger | null> {
  const text = await readText(path);
  return text === null ? null : parseLedger(text, release);
}

/** Runs `work` while holding the ledger's lock file (one writer at a time across processes). */
async function locked<T>(path: string, work: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`, until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { await (await open(lock, 'wx', 0o600)).close(); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new LedgerError('ledger_missing', `there is no local release ledger at ${path}; create it with: node tools/challenge.ts ledger init`);
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() > until) throw new LedgerError('ledger_locked', `the release ledger has been locked for ${LOCK_WAIT_MS / 1000} s (${lock}); remove the lock file only when no bench runs`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try { return await work(); } finally { await rm(lock, { force: true }); }
}

/** The local ledger with the committed one as its prefix (a local ledger that lost or rewrote committed
 * records is refused: `ledger_diverged`). */
async function current(paths: LedgerPaths): Promise<Ledger> {
  const local = await readLedger(paths.local);
  if (local === null) throw new LedgerError('ledger_missing', `there is no local release ledger at ${paths.local}; create it with: node tools/challenge.ts ledger init`);
  const committed = await readText(paths.committed);
  if (committed !== null && !isPrefix(committed, local.text)) throw new LedgerError('ledger_diverged', `the committed release ledger (${paths.committed}) is not a prefix of the local one (${paths.local}); a ledger is only appended to`);
  return local;
}

/** Whether a local ledger exists at `path` (`ledger init` refuses first when one does). */
export const ledgerExists = async (path: string): Promise<boolean> => await readText(path) !== null;
/** `ledger init`: the local ledger as a copy of `from` (the longest pushed version), else of the
 * committed one, or a new ledger when none is committed; refuses to replace an existing local ledger. */
export async function initLedger(paths: LedgerPaths, from: string | null = null): Promise<{ records: number; from: 'committed' | 'new' }> {
  if (await readText(paths.local) !== null) throw new LedgerError('ledger_exists', `${paths.local} exists; a local ledger is never replaced`);
  const committed = from ?? await readText(paths.committed);
  const text = committed ?? headerLine();
  const ledger = parseLedger(text);
  await mkdir(dirname(paths.local), { recursive: true });
  await writeFile(paths.local, text, { flag: 'wx', mode: 0o600 });
  return { records: ledger.records.length, from: committed === null ? 'new' : 'committed' };
}

/** `ledger write`: the committed copy from the local ledger (the committed one must be its prefix). */
export async function writeCommittedLedger(paths: LedgerPaths): Promise<{ records: number; added: number }> {
  return locked(paths.local, async () => {
    const local = await current(paths), before = await readText(paths.committed);
    await mkdir(dirname(paths.committed), { recursive: true });
    await writeFile(paths.committed, local.text);
    return { records: local.records.length, added: local.records.length - (before === null ? 0 : parseLedger(before).records.length) };
  });
}

/** Appends one record under the lock; `body` sees the ledger as it is and may refuse. */
async function append(paths: LedgerPaths, body: (ledger: Ledger) => StartBody | RunEndBody | RoundBody): Promise<number> {
  return locked(paths.local, async () => {
    const ledger = await current(paths);
    const { record, line } = nextLine(ledger, body(ledger));
    await appendFile(paths.local, line, { mode: 0o600 });
    return record.seq;
  });
}
/** Appends records under one lock, in one write; `bodies` sees the ledger as it is and may refuse. */
async function appendAll(paths: LedgerPaths, bodies: (ledger: Ledger) => RunEndBody[]): Promise<void> {
  return locked(paths.local, async () => {
    let ledger = await current(paths), text = '';
    for (const body of bodies(ledger)) {
      const { line } = nextLine(ledger, body);
      ledger = parseLedger(ledger.text + line); text += line;
    }
    if (text) await appendFile(paths.local, text, { mode: 0o600 });
  });
}

export interface GuardOptions {
  paths: LedgerPaths; purpose: Purpose;
  unit: string | null; round: number | null; basis: string | null;
  toolchain: string; rules: string | null;
  /** The models a start may request (a round's declared agents); null: any. */
  models?: readonly string[] | null;
  /** A round's set: the world its plan or declaration makes and the task identities of its instances;
   * a start on another world or instance is refused (`round_instance_refused`). */
  set?: { world: string; instances: ReadonlySet<string> } | null;
}
/**
 * The start guard (PADR-0042 decision 4): before a client starts, it takes a start entry when the
 * ledger's count stays within the cap with it, and refuses otherwise (`release_budget_exhausted`) — a
 * reservation every start holds until its run-end record releases it (PADR-0044 decision 5). A round's
 * run must bench the round's own world and instances. When the run ends it appends the run-end record
 * with the hashes the report binds. `recover` (`bench --recover` through the guard) appends the run-end
 * records a killed bench's re-verified folders prove: a judged run, or an infra_error its client's own
 * output reports (a parser re-derived it); every other start of the bench without a run-end record
 * stays void — counted, never benched again (PADR-0042 amended).
 */
export function ledgerGuard(options: GuardOptions): StartGuard {
  return {
    start: (request: StartRequest) => append(options.paths, ledger => {
      if (options.models && (request.model === null || !options.models.includes(request.model)))
        throw new LedgerError('ledger_model_refused', `this ${options.purpose} run requests ${request.model ?? 'no model'}; the round names ${options.models.join(', ')} (set ANTHROPIC_MODEL)`);
      if (options.set && (request.world !== options.set.world || !options.set.instances.has(request.instance)))
        throw new LedgerError('round_instance_refused', `this ${options.purpose} run benches ${request.taskId} on world ${request.world.slice(0, 12)}…, not an instance of the round's own set (world ${options.set.world.slice(0, 12)}…, made from its ${options.purpose === 'pre-probe' ? 'plan' : 'declaration'}); bench the round's set`);
      // The cap is the release's (D4), never a value the ledger file names.
      const counted = countLedger(ledger).counted;
      if (counted + 1 > RELEASE_CAP) throw new LedgerError('release_budget_exhausted', `release ${RELEASE} has ${counted} of its ${RELEASE_CAP} model runs counted; this start would pass ${RELEASE_CAP} and is refused before the client starts — a maintainer decides`);
      return { kind: 'start', purpose: options.purpose, unit: options.unit, round: options.round, basis: options.basis, toolchain: options.toolchain, rules: options.rules,
        requested: request.requested, model: request.model, agent: request.agent.kind === 'preset' ? request.agent.name : 'command', bench: request.bench, run: request.run, world: request.world, instance: request.instance };
    }),
    end: async (handle: number, run: SessionRunV3) => { await append(options.paths, () => runEndBody(handle, options, run)); },
    recover: async (bench: string, runs: readonly SessionRunV3[]) => {
      const written: string[] = [], voided: string[] = [];
      await appendAll(options.paths, ledger => {
        written.length = 0; voided.length = 0;
        const starts = ledger.records.filter((record): record is StartRecord => record.kind === 'start' && record.bench === bench);
        const bodies: RunEndBody[] = [];
        for (const run of runs) {
          const start = starts.findLast(record => record.run === run.id);
          if (!start) throw new LedgerError('run_outside_ledger', `run ${run.id} of bench folder ${bench} has no start entry in the release ledger; only a bench the guard started is recovered through it`);
          if (start.purpose !== options.purpose || start.unit !== options.unit || start.round !== options.round || start.basis !== options.basis || start.toolchain !== options.toolchain || start.rules !== options.rules)
            throw new LedgerError('ledger_mismatch', `run ${run.id}: its start entry ${start.seq} is a ${start.purpose} run of ${start.unit ?? 'no unit'} for ${start.basis === null ? 'no plan or declaration' : 'a plan or declaration'} other than these options name; recover under the purpose and the plan or declaration the bench ran with`);
          if (ledger.ends.has(start.seq)) continue;
          // Proven by its folder: judged and re-verified, or a failure its client's own output reports.
          if (run.status !== 'infra_error' || (run.failure?.parser ?? null) !== null) { bodies.push({ ...runEndBody(start.seq, options, run), recovered: true }); written.push(run.id); }
          else voided.push(run.id);
        }
        for (const start of starts) if (!ledger.ends.has(start.seq) && !runs.some(run => run.id === start.run)) voided.push(start.run);
        return bodies;
      });
      return { written, void: voided };
    },
  };
}

/** Registers what `probe` or `declare` decided for a unit's round (an admission, a refusal, a
 * declaration) in the local ledger, under the lock, once the committed ledger is its prefix. */
export async function appendRound(paths: LedgerPaths, body: RoundBody): Promise<number> {
  return append(paths, () => body);
}

/** The run-end record of a run as its report holds it. */
export function runEndBody(start: number, options: Pick<GuardOptions, 'toolchain' | 'rules'>, run: SessionRunV3): RunEndBody {
  const tokens = run.client?.tokens;
  return {
    kind: 'run-end', start, toolchain: options.toolchain, rules: options.rules, status: run.status,
    judged: run.artifacts?.session ?? null, stdout: run.stdout?.sha256 ?? null, checker: run.artifacts?.checker ?? null,
    observed: run.client?.billing ? { class: run.client.billing.class, source: run.client.billing.source } : { class: 'unknown', source: 'none' },
    failure: run.failure ?? null,
    hostCalls: run.toolCalls.act + run.toolCalls.undo + run.toolCalls.reset + run.toolCalls.check, reads: run.toolCalls.observe,
    tokens: tokens ? tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation : null,
  };
}
