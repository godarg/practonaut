/**
 * The file side of the release ledger (PADR-0042 decision 4, PADR-0044 decision 8): the local
 * ledger under `.local/`, which only `ledger init` creates (a copy of the committed one), every start
 * and run-end record appended under a lock; the committed copy written from it; and the start guard
 * the bench runner consults before every client start.
 */
import { appendFile, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { StartGuard, StartRequest } from '../bench/run.ts';
import type { SessionRunV3 } from '../bench/report.ts';
import { countLedger, headerLine, isPrefix, LedgerError, nextLine, parseLedger, RELEASE, type Ledger, type Purpose, type RunEndBody, type StartBody } from './ledger.ts';

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

/** `ledger init`: the local ledger as a copy of the committed one, or a new ledger when none is
 * committed; refuses to replace an existing local ledger. */
export async function initLedger(paths: LedgerPaths): Promise<{ records: number; from: 'committed' | 'new' }> {
  if (await readText(paths.local) !== null) throw new LedgerError('ledger_exists', `${paths.local} exists; a local ledger is never replaced`);
  const committed = await readText(paths.committed);
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
async function append(paths: LedgerPaths, body: (ledger: Ledger) => StartBody | RunEndBody): Promise<number> {
  return locked(paths.local, async () => {
    const ledger = await current(paths);
    const { record, line } = nextLine(ledger, body(ledger));
    await appendFile(paths.local, line, { mode: 0o600 });
    return record.seq;
  });
}

export interface GuardOptions {
  paths: LedgerPaths; purpose: Purpose;
  unit: string | null; round: number | null; basis: string | null;
  toolchain: string; rules: string | null;
  /** The models a start may request (a round's declared agents); null: any. */
  models?: readonly string[] | null;
}
/**
 * The start guard (PADR-0042 decision 4): before a client starts, it takes a start entry when the
 * ledger's count stays within the cap with it, and refuses otherwise (`release_budget_exhausted`) — a
 * reservation every start holds until its run-end record releases it (PADR-0044 decision 5). When the
 * run ends it appends the run-end record with the hashes the report binds.
 */
export function ledgerGuard(options: GuardOptions): StartGuard {
  return {
    start: (request: StartRequest) => append(options.paths, ledger => {
      if (options.models && (request.model === null || !options.models.includes(request.model)))
        throw new LedgerError('ledger_model_refused', `this ${options.purpose} run requests ${request.model ?? 'no model'}; the round names ${options.models.join(', ')} (set ANTHROPIC_MODEL)`);
      const counted = countLedger(ledger).counted;
      if (counted + 1 > ledger.header.cap) throw new LedgerError('release_budget_exhausted', `release ${ledger.header.release} has ${counted} of its ${ledger.header.cap} model runs counted; this start would pass ${ledger.header.cap} and is refused before the client starts — a maintainer decides`);
      return { kind: 'start', purpose: options.purpose, unit: options.unit, round: options.round, basis: options.basis, toolchain: options.toolchain, rules: options.rules,
        requested: request.requested, model: request.model, agent: request.agent.kind === 'preset' ? request.agent.name : 'command', bench: request.bench, run: request.run };
    }),
    end: async (handle: number, run: SessionRunV3) => { await append(options.paths, () => runEndBody(handle, options, run)); },
  };
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
