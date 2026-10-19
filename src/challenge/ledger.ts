/**
 * The release ledger of 0.3.0 (PADR-0042 decision 4, PADR-0044 decisions 5 and 8): one JSON line per
 * record, each the canonical JSON of the record, chained by the SHA-256 of the line before it. The
 * first line names the release and its cap; then a `start` entry for every model run, taken before its
 * client starts, and at most one `run-end` record per start entry, appended by the runner that took
 * it. Records are only ever appended: a committed version of the file is a prefix of every later one.
 *
 * The count: every start entry counts against the cap until its run-end record releases it — a run
 * whose requested and observed billing class are both `local` with a client-attested source, or a run
 * the client refused before any model work, decided from the record's structure (PADR-0044 decision 9).
 * Pure: the file side is ledger-file.ts.
 */
import { z } from 'zod';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { BILLING_CLASSES, EVIDENCE_SOURCES, FAILURE_CODE, FAILURE_REASONS, IDENTIFIER, MODEL_ID, RunStatus } from '../bench/report.ts';
import { SHIPPED_PARSERS } from '../bench/parsers.ts';

export const LEDGER_SCHEMA = 'practonaut.release-ledger/1';
/** The release this ledger counts and its cap of model runs (maintainer decision D4). */
export const RELEASE = '0.3.0';
export const RELEASE_CAP = 800;
/** Why a run was made; every purpose counts the same (PADR-0042 decision 4). */
export const PURPOSES = ['pre-probe', 'held-out', 'development', 'example', 'acceptance', 'red-team'] as const;
export type Purpose = typeof PURPOSES[number];
const ZERO = '0'.repeat(64);

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const seq = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const count = seq;
const identifier = z.string().regex(IDENTIFIER);
/** Bench folder names as `bench` makes them (`20261019T052212Z-9974`) and run ids (`<task>-s<seed>-r<repeat>`). */
export const BENCH_ID = /^\d{8}T\d{6}Z-[0-9a-f]{4}$/;
export const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}-s\d{1,9}-r\d{1,4}$/;
const unitId = z.string().regex(/^[a-z][a-z-]{0,31}\.[a-z0-9][a-z0-9.-]{0,63}$/);
const semver = z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/);

export const HeaderRecordSchema = z.strictObject({ kind: z.literal('release'), seq: z.literal(0), prev: z.literal(ZERO), schema: z.literal(LEDGER_SCHEMA), release: z.string().regex(/^\d+\.\d+\.\d+$/), cap: z.number().int().min(1).max(100_000) });
export const StartRecordSchema = z.strictObject({
  kind: z.literal('start'), seq, prev: sha256,
  purpose: z.enum(PURPOSES),
  /** The unit and round a gate run belongs to (null for runs outside a round). */
  unit: unitId.nullable(), round: z.number().int().min(1).max(9).nullable(),
  /** The canonical SHA-256 of the probe plan (pre-probe) or the declaration (held-out) the run serves. */
  basis: sha256.nullable(),
  toolchain: identifier, rules: semver.nullable(),
  /** The billing class the preset was set up for, before the start (PADR-0044 decision 5). */
  requested: z.enum(BILLING_CLASSES),
  /** The model the client was asked for (the preset's model variable), or null. */
  model: z.string().regex(MODEL_ID).nullable(),
  /** The preset's name (`command` for a command template). */
  agent: identifier,
  bench: z.string().regex(BENCH_ID), run: z.string().regex(RUN_ID),
});
export const RunEndRecordSchema = z.strictObject({
  kind: z.literal('run-end'), seq, prev: sha256,
  /** The seq of the start entry this record ends. */
  start: seq,
  toolchain: identifier, rules: semver.nullable(),
  status: z.enum(RunStatus),
  /** SHA-256 of the judged artifact (`session.json`), of `agent.stdout` and of `checker.json`. */
  judged: sha256.nullable(), stdout: sha256.nullable(), checker: sha256.nullable(),
  observed: z.strictObject({ class: z.enum(BILLING_CLASSES), source: z.enum(EVIDENCE_SOURCES) }),
  /** The run's failure as the report holds it (exactly for an infra_error run). */
  failure: z.strictObject({ reason: z.enum(FAILURE_REASONS), parser: identifier.nullable(), code: z.string().regex(FAILURE_CODE).nullable(), beforeModelWork: z.boolean().nullable() }).nullable(),
  /** Practonaut's own counters: act, undo, reset and check calls, and observe calls. */
  hostCalls: count, reads: count,
  /** The client's own token total (input, output and cache), null when it reports none. */
  tokens: count.nullable(),
});
export type HeaderRecord = z.infer<typeof HeaderRecordSchema>;
export type StartRecord = z.infer<typeof StartRecordSchema>;
export type RunEndRecord = z.infer<typeof RunEndRecordSchema>;
export type LedgerRecord = HeaderRecord | StartRecord | RunEndRecord;
type Body<T> = Omit<T, 'seq' | 'prev'>;
export type StartBody = Body<StartRecord>;
export type RunEndBody = Body<RunEndRecord>;

export class LedgerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'LedgerError'; this.code = code; }
}

/** A parsed, verified ledger: its records, its lines, and each start entry's run-end record. */
export interface Ledger { text: string; records: LedgerRecord[]; header: HeaderRecord; ends: ReadonlyMap<number, RunEndRecord> }

/** Parses and verifies a ledger file's text: one canonical JSON record per line, ending in a newline;
 * seq is the line index; each `prev` the SHA-256 of the line before; the header first; a run-end only
 * for an earlier start entry without one, with that entry's toolchain and rules version. */
export function parseLedger(text: string, release = RELEASE): Ledger {
  const fail = (line: number, message: string): never => { throw new LedgerError('ledger_invalid', `the release ledger, line ${line + 1}: ${message}`); };
  if (!text.endsWith('\n')) fail(text.split('\n').length - 1, 'the file does not end with a complete line');
  const lines = text.slice(0, -1).split('\n'), records: LedgerRecord[] = [], ends = new Map<number, RunEndRecord>();
  let previous = ZERO;
  for (const [index, line] of lines.entries()) {
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { fail(index, 'not JSON'); }
    const kind = (raw as { kind?: unknown } | null)?.kind;
    const schema = index === 0 ? HeaderRecordSchema : kind === 'start' ? StartRecordSchema : kind === 'run-end' ? RunEndRecordSchema : null;
    if (schema === null) fail(index, index === 0 ? 'the first record names the release' : 'not a start or run-end record');
    const parsed = schema!.safeParse(raw);
    if (!parsed.success) fail(index, `${parsed.error.issues[0]?.path.join('.') || 'record'} ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    const record = parsed.data as LedgerRecord;
    if (canonicalJson(record) !== line) fail(index, 'not in canonical form');
    if (record.seq !== index) fail(index, `seq ${record.seq}, expected ${index}`);
    if (record.prev !== previous) fail(index, 'its prev is not the SHA-256 of the line before (the chain is broken)');
    if (record.kind === 'release' && record.release !== release) fail(index, `the ledger counts release ${record.release}, not ${release}`);
    if (record.kind === 'run-end') {
      const start = records[record.start];
      if (start?.kind !== 'start') fail(index, `its start entry ${record.start} is not an earlier start entry`);
      if (ends.has(record.start)) fail(index, `start entry ${record.start} has a run-end record already (one per start entry)`);
      if ((start as StartRecord).toolchain !== record.toolchain || (start as StartRecord).rules !== record.rules) fail(index, `its toolchain or rules version differs from start entry ${record.start}`);
      ends.set(record.start, record);
    }
    records.push(record); previous = sha256Hex(line);
  }
  return { text, records, header: records[0] as HeaderRecord, ends };
}

/** The first line of a new ledger. */
export const headerLine = (release = RELEASE, cap = RELEASE_CAP): string => canonicalJson({ kind: 'release', seq: 0, prev: ZERO, schema: LEDGER_SCHEMA, release, cap } satisfies HeaderRecord) + '\n';
/** The line that appends `body` to the ledger. */
export function nextLine(ledger: Pick<Ledger, 'text' | 'records'>, body: StartBody | RunEndBody): { record: StartRecord | RunEndRecord; line: string } {
  const lines = ledger.text.slice(0, -1).split('\n');
  const record = { ...body, seq: ledger.records.length, prev: sha256Hex(lines.at(-1)!) } as StartRecord | RunEndRecord;
  const parsed = (record.kind === 'start' ? StartRecordSchema : RunEndRecordSchema).safeParse(record);
  if (!parsed.success) throw new LedgerError('ledger_invalid', `a ${record.kind} record does not fit the ledger's format: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
  return { record: parsed.data as StartRecord | RunEndRecord, line: canonicalJson(parsed.data) + '\n' };
}

/** A run the client refused before any model work, exempt from every budget (PADR-0044 decision 9),
 * decided from the record's structure only: a usage limit or a login or billing error, before model
 * work, read by a parser this Practonaut ships, no host call but the bridge's start-up read, no tokens. */
export function exemptEnd(end: Pick<RunEndRecord, 'status' | 'failure' | 'hostCalls' | 'reads' | 'tokens'>): boolean {
  const failure = end.failure;
  return end.status === 'infra_error' && failure !== null && (failure.reason === 'usage_limit' || failure.reason === 'auth') && failure.beforeModelWork === true
    && failure.parser !== null && SHIPPED_PARSERS.has(failure.parser) && end.hostCalls === 0 && end.reads <= 1 && (end.tokens === null || end.tokens === 0);
}
/** A run of a local model: requested `local`, and observed `local` with a client-attested source. */
export const localEnd = (start: Pick<StartRecord, 'requested'>, end: Pick<RunEndRecord, 'observed'>): boolean =>
  start.requested === 'local' && end.observed.class === 'local' && end.observed.source === 'client-attested';
/** Whether a start entry's reservation is released by its run-end record. */
export function released(start: StartRecord, end: RunEndRecord | undefined): 'local' | 'exempt' | null {
  if (!end) return null;
  return localEnd(start, end) ? 'local' : exemptEnd(end) ? 'exempt' : null;
}

export interface LedgerCount { starts: number; counted: number; local: number; exempt: number; open: number }
/** The ledger's count against the cap: start entries minus those their run-end record released. */
export function countLedger(ledger: Pick<Ledger, 'records' | 'ends'>, filter: (start: StartRecord) => boolean = () => true): LedgerCount {
  const result: LedgerCount = { starts: 0, counted: 0, local: 0, exempt: 0, open: 0 };
  for (const record of ledger.records) {
    if (record.kind !== 'start' || !filter(record)) continue;
    result.starts++;
    const end = ledger.ends.get(record.seq), why = released(record, end);
    if (!end) result.open++;
    if (why === 'local') result.local++; else if (why === 'exempt') result.exempt++; else result.counted++;
  }
  return result;
}

/** Whether `older` is a prefix of `current` on whole lines (a committed version of an append-only file). */
export const isPrefix = (older: string, current: string): boolean => current.startsWith(older) && (older === '' || older.endsWith('\n'));
/** The SHA-256 of the ledger's last line: what a declaration binds of the ledger it counted. */
export const ledgerHead = (ledger: Pick<Ledger, 'text'>): string => sha256Hex(ledger.text.slice(0, -1).split('\n').at(-1)!);
