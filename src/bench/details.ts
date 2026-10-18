/**
 * What a report page shows about each run beyond the report's own numbers (PADR-0039 B.3–4), read
 * from the bench folder: the goal conditions with their history (the checker's trace), the error
 * classes with their explanation (the stored checker output), the trajectory (the mutation log), the
 * final board (the engine's picture or a schematic of the judged state), groups and frames, an example
 * target from a validated reference, the call log summary. The final board and the target share one
 * viewBox, so they are drawn at one scale and in one coordinate system.
 *
 * The folder is untrusted: a file is used only when its SHA-256 is the one the report binds, and a
 * file that does not parse is reported as unreadable, never guessed around. Nothing here judges: a
 * missing or changed file only removes an explanation, never changes a verdict.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { sha256Hex } from '../canonical/index.ts';
import { runOracle, type OracleStep } from '../authoring/from-scenes.ts';
import { Session } from '../core/session.ts';
import { publicConditions } from '../host/session.ts';
import { parseJsonEntry } from '../package/json.ts';
import { LIMITS } from '../package/limits.ts';
import { evaluate } from '../predicate/index.ts';
import { generateVariant } from '../world/variant.ts';
import { validateState } from '../world/schema.ts';
import { worldEra, type Action, type Localized, type SessionData, type State, type World } from '../world/types.ts';
import { libraryReferences, MAX_REFERENCES_BYTES, readRegularFile, ReferencesFileSchema, worldContentHash, worldFromPackage } from './world.ts';
import { BENCH_REFERENCES_FILE, BENCH_SCHEMA_V3, BENCH_WORLD_FILE } from './report.ts';
import { asView, nativeFileOf, type BenchReportView, type ReportInput, type SessionReportView, type ViewSessionRun } from './view.ts';
import { MAX_LOG_BYTES, parseCallLog, parseMutations, RUN_EVIDENCE, type CallRecord, type MutationRecord } from './evidence.ts';
import { engineSvgMarkup, MAX_SVG_BYTES, readEngineSvg, type EngineSvg } from './svg.ts';
import { boardObjects, framesOf, groupOutlines, groupsOf, pictureOverflow, schematicBounds, schematicSvg, unionBox, type BoardObject, type Box, type FrameLegend, type GroupLegend } from './schematic.ts';

/** File names of the judged artifacts in a run folder (as `run.ts` writes them). */
const ARTIFACT = Object.freeze({ session: 'session.json', native: 'native.excalidraw', checker: 'checker.json' });
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

/** How a condition got to where it is at the end of the run (from the checker's trace). */
export type ConditionHistory =
  | { kind: 'start' } | { kind: 'since'; action: number } | { kind: 'never' } | { kind: 'lost'; action: number } | { kind: 'unknown' };
export interface ConditionDetail { id: string; text: Localized; formal: Localized | null; met: boolean | null; history: ConditionHistory }
export interface TrajectoryRow {
  number: number; op: MutationRecord['op']; text: string; client: string | null;
  outcome: MutationRecord['outcome']; code: string | null; step: number; revision: number;
  /** After an accepted mutation, from the trace: conditions met (as numbers 1 …), and which changed. */
  met: number | null; gained: number[]; lost: number[];
}
export interface CallSummary { calls: number; byTool: Array<[string, number]>; codes: Array<[string, number]>; resultBytes: number; bridgeMedianMs: number | null; clientMedianMs: number | null; dropped: number; omitted: number; omittedAtLeast: boolean }
export type PictureReason = 'model-only' | 'no-picture' | 'picture-unreadable' | 'picture-changed';
export type Picture = { kind: 'engine'; markup: string } | { kind: 'schematic'; markup: string; reason: PictureReason };
/** A part that could not be shown, and why. */
export type Missing = 'not-recorded' | 'changed' | 'unreadable' | 'not-judged';
export interface RunDetail {
  run: ViewSessionRun;
  conditions: ConditionDetail[] | null; conditionsMissing: Missing | null; traceError: string | null;
  errors: Array<{ id: string; explanation: Localized }>;
  trajectory: TrajectoryRow[] | null; trajectoryMissing: Missing | null;
  picture: Picture | null; groups: GroupLegend[]; frames: FrameLegend[];
  /** Every object of the judged state with its attributes in full (labels are never cut here). */
  objects: BoardObject[];
  target: string | null; targetMissing: 'no-reference' | 'unreadable' | null;
  /** Every object of the example target, like `objects`. */
  targetObjects: BoardObject[];
  /** Whether the pictures (one shared width) are wider than a phone or a desktop column. */
  overflow: 'none' | 'narrow' | 'wide';
  /** The first object where the final board and the target differ lies in the right half of the
   * shared viewBox: a picture that scrolls opens at that end. */
  fromEnd: boolean;
  /** The export carries the judged state's group outline (it shows no groups of its own). */
  groupOverlay: boolean;
  calls: CallSummary | null; callsMissing: Missing | null;
  /** Distinct MCP client names that changed the board (from the mutation log). */
  clients: string[];
  rejected: Array<[string, number]>;
}
export interface ReportDetails {
  folder: 'read' | 'missing' | 'world-changed' | 'world-unreadable'; runs: Map<string, RunDetail>;
  /** Error-class explanations by task, seed and id, from the bundled library when the report's world is
   * it (shown even without the bench folder). */
  explanations: Map<string, Localized>;
}
/** Explanations name the seed's own labels (a variant fills them in), so they are kept per seed. */
export const explanationKey = (taskId: string, seed: number, id: string): string => `${taskId}\u0000${seed}\u0000${id}`;

/** A regular file of at most `max` bytes (the limit enforced while reading), or null. */
const bounded = (path: string, max: number): Promise<Buffer | null> => readRegularFile(path, max);
/** A run file's text when its bytes have the bound hash; `changed` otherwise, `not-recorded` when missing. */
async function bound(folder: string, runId: string, name: string, sha256: string, max = MAX_ARTIFACT_BYTES): Promise<{ text: string } | { missing: Missing }> {
  const bytes = await bounded(join(folder, runId, name), max);
  if (bytes === null) return { missing: 'not-recorded' };
  return sha256Hex(bytes) === sha256 ? { text: bytes.toString('utf8') } : { missing: 'changed' };
}

const TraceSchema = z.strictObject({
  schema: z.literal('practonaut.condition-trace/1'), taskId: z.string().max(64), seed: z.number().int().safe(),
  conditions: z.array(z.string().regex(/^goal-\d{1,4}$/)).max(4096), start: z.string().regex(/^[01]*$/),
  points: z.array(z.strictObject({ seq: z.number().int().nonnegative(), step: z.number().int().nonnegative(), met: z.string().regex(/^[01]*$/) })).max(200_000),
});
const CheckerOutputSchema = z.object({ session: z.object({ tasks: z.array(z.object({ taskId: z.string(), errors: z.array(z.object({ id: z.string().max(128), explanation: z.object({ en: z.string().max(4096), de: z.string().max(4096) }) })).max(64) })) }), native: z.object({ tasks: z.array(z.object({ taskId: z.string(), errors: z.array(z.object({ id: z.string().max(128), explanation: z.object({ en: z.string().max(4096), de: z.string().max(4096) }) })).max(64) })) }).nullable() });

/** The history of condition `index` over the trace: where it ends and the last change that got it there. */
export function conditionHistory(start: string, points: ReadonlyArray<{ seq: number; met: string }>, index: number): ConditionHistory {
  const at = (met: string): boolean => met[index] === '1';
  const metAtEnd = at(points.at(-1)?.met ?? start);
  let lastChange: number | null = null, everMet = at(start), previous = at(start);
  for (const point of points) { const now = at(point.met); if (now !== previous) lastChange = point.seq + 1; if (now) everMet = true; previous = now; }
  if (metAtEnd) return lastChange === null ? { kind: 'start' } : { kind: 'since', action: lastChange };
  return everMet ? { kind: 'lost', action: lastChange! } : { kind: 'never' };
}

/** Parameters of the action vocabulary that name an object. */
const ID_PARAMETERS = new Set(['id', 'from', 'to', 'target', 'with', 'frameId']);
/** A readable form of an action: its name and parameters, ids shown as the label or name the object
 * had at that moment. Board text stays data; the renderer escapes it. */
function describe(action: { name: string; params: Record<string, unknown> }, state: State | null): string {
  const name = (id: string | null): string => {
    const object = id === null ? undefined : state?.objects[id];
    return object?.type === 'step' ? `“${object.label}”` : object?.type === 'frame' ? `“${object.name}”` : '—';
  };
  const value = (key: string, raw: unknown): string => {
    if (typeof raw === 'string' && ID_PARAMETERS.has(key)) {
      const object = state?.objects[raw];
      if (object && object.type !== 'arrow') return name(raw);
      // An arrow is named by its ends; an id that names nothing is shown short (it is data, not a name).
      if (object && object.type === 'arrow') return `${name(object.from)} → ${name(object.to)}`;
      return `“${raw.length > 24 ? `${raw.slice(0, 12)}…` : raw}”`;
    }
    return typeof raw === 'string' ? `“${raw}”` : raw === null ? '—' : String(raw);
  };
  return `${action.name}(${Object.entries(action.params).map(([key, raw]) => `${key}: ${value(key, raw)}`).join(', ')})`;
}

function trajectoryOf(records: readonly MutationRecord[], world: World, run: ViewSessionRun, trace: z.infer<typeof TraceSchema> | null): TrajectoryRow[] {
  // The core replays the accepted mutations only to name the objects each action touched.
  let session: Session | null = (() => { try { return new Session(world, run.seed, run.taskId); } catch { return null; } })();
  const metAfter = new Map((trace?.points ?? []).map(point => [point.seq, point.met]));
  let previous = trace?.start ?? null;
  const count = (met: string): number => [...met].filter(char => char === '1').length;
  return records.map(record => {
    const text = record.op === 'act' && record.action ? describe(record.action, session?.state ?? null) : record.op;
    if (record.outcome === 'accepted' && record.op !== 'check' && session) {
      const result = record.op === 'act' ? session.act(record.action as Action) : record.op === 'undo' ? session.undo() : session.reset();
      if (!result.ok) session = null;
    }
    const met = metAfter.get(record.seq) ?? null, gained: number[] = [], lost: number[] = [];
    if (met !== null && previous !== null) for (let index = 0; index < met.length; index++) { if (met[index] === '1' && previous[index] === '0') gained.push(index + 1); if (met[index] === '0' && previous[index] === '1') lost.push(index + 1); }
    if (met !== null) previous = met;
    return { number: record.seq + 1, op: record.op, text, client: record.client, outcome: record.outcome, code: record.code ?? null, step: record.step, revision: record.revision, met: met === null ? null : count(met), gained, lost };
  });
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round(((sorted[middle - 1]! + sorted[middle]!) / 2) * 10) / 10;
};
function summarizeCalls(records: readonly CallRecord[], dropped: number, omitted: number, omittedAtLeast: boolean): CallSummary {
  const tally = (key: (record: CallRecord) => string | null): Array<[string, number]> => {
    const counts = new Map<string, number>();
    for (const record of records) { const value = key(record); if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1); }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const client = records.flatMap(record => record.clientMs === null ? [] : [record.clientMs]);
  return { calls: records.length, byTool: tally(record => record.tool), codes: tally(record => record.code === 'ok' ? null : record.code), resultBytes: records.reduce((sum, record) => sum + record.resultBytes, 0), bridgeMedianMs: median(records.map(record => record.bridgeMs)), clientMedianMs: median(client), dropped, omitted, omittedAtLeast };
}

/** The stored world as the report binds it, or why it cannot be used. */
async function boundWorld(report: SessionReportView, folder: string): Promise<{ world: World } | { problem: ReportDetails['folder'] }> {
  const stored = report.environment.world.package;
  if (stored === null) {
    // A /1 report names the bundled library; its explanations need the same library content.
    const { libraryWorld } = await import('./run.ts');
    const library = await libraryWorld();
    return library.contentHash === report.environment.world.contentHash ? { world: library.world } : { problem: 'world-changed' };
  }
  const bytes = await bounded(join(folder, BENCH_WORLD_FILE), LIMITS.maxArchiveBytes);
  if (bytes === null) return { problem: 'missing' };
  if (sha256Hex(bytes) !== stored.sha256) return { problem: 'world-changed' };
  try {
    const world = await worldFromPackage(bytes);
    return worldContentHash(world) === report.environment.world.contentHash ? { world } : { problem: 'world-changed' };
  } catch { return { problem: 'world-unreadable' }; }
}

/** The validated references of the report, by task: library solutions for /1, `references.json` for /2. */
async function boundReferences(report: SessionReportView, folder: string): Promise<Map<string, readonly OracleStep[]> | null> {
  if (report.references === 'not-recorded') return new Map([...libraryReferences(report.settings.tasks)].map(([task, reference]) => [task, reference.steps]));
  if (report.references === null) return new Map();
  const bytes = await bounded(join(folder, BENCH_REFERENCES_FILE), MAX_REFERENCES_BYTES);
  if (bytes === null || sha256Hex(bytes) !== report.references.sha256) return null;
  try {
    const parsed = ReferencesFileSchema.safeParse(parseJsonEntry(bytes, BENCH_REFERENCES_FILE, 64));
    return parsed.success ? new Map(parsed.data.references.map(entry => [entry.taskId, entry.steps as readonly OracleStep[]])) : null;
  } catch { return null; }
}

/** Error-class explanations of the report's tasks when its world is the bundled library (its content
 * hash says so), so they can be shown without the bench folder. */
async function libraryExplanations(report: BenchReportView): Promise<Map<string, Localized>> {
  const explanations = new Map<string, Localized>();
  if (report.environment.world.source !== 'library') return explanations;
  const { libraryWorld } = await import('./run.ts');
  const library = await libraryWorld();
  if (library.contentHash !== report.environment.world.contentHash) return explanations;
  for (const seed of new Set((report.runs as ReadonlyArray<{ seed: number }>).map(run => run.seed))) {
    for (const task of generateVariant(library.world, seed).tasks) for (const error of task.errorClasses) explanations.set(explanationKey(task.id, seed, error.id), error.explanation);
  }
  return explanations;
}

/** Where the scene of `native.excalidraw` lies (board units): the box Excalidraw's export is centred on. */
function sceneBounds(text: string): Box | null {
  const scene = parseJsonEntry(Buffer.from(text), ARTIFACT.native, 64) as { elements?: unknown };
  if (!Array.isArray(scene.elements)) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const element of scene.elements as Array<Record<string, unknown>>) {
    if (!element || typeof element !== 'object' || element.isDeleted === true) continue;
    const x = element.x, y = element.y, width = element.width, height = element.height;
    if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) continue;
    const points = Array.isArray(element.points) ? (element.points as unknown[]).filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2 && point.every(value => typeof value === 'number' && Number.isFinite(value))) : [];
    const xs = points.length ? points.map(point => (x as number) + point[0]) : [x as number, (x as number) + (width as number)];
    const ys = points.length ? points.map(point => (y as number) + point[1]) : [y as number, (y as number) + (height as number)];
    left = Math.min(left, ...xs); right = Math.max(right, ...xs); top = Math.min(top, ...ys); bottom = Math.max(bottom, ...ys);
  }
  return Number.isFinite(left) ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

/** The x centre of the first object (target reading order, then extra objects of the final board)
 * that differs between the final board and the target, by label: missing, another shape, line, fill,
 * frame or group, a size off by more than 8 or a place off by more than 40 units; arrows by their ends.
 * Null when the two agree on every object. */
export function firstDifference(final: State, target: State): number | null {
  const objects = (state: State): { steps: Map<string, Extract<BoardObject, { kind: 'step' }>>; arrows: Set<string>; order: Array<Extract<BoardObject, { kind: 'step' }>> } => {
    const all = boardObjects(state), steps = all.filter((object): object is Extract<BoardObject, { kind: 'step' }> => object.kind === 'step');
    return { steps: new Map(steps.map(step => [step.label, step])), arrows: new Set(all.flatMap(object => object.kind === 'arrow' ? [`${object.from}\u0000${object.to}`] : [])), order: steps };
  };
  const a = objects(final), b = objects(target);
  const centre = (step: { x: number; width: number }): number => step.x + step.width / 2;
  const differs = (one: Extract<BoardObject, { kind: 'step' }>, two: Extract<BoardObject, { kind: 'step' }>): boolean =>
    one.shape !== two.shape || one.stroke !== two.stroke || one.fill !== two.fill || one.frame !== two.frame || (one.group === null) !== (two.group === null)
    || Math.abs(one.width - two.width) > 8 || Math.abs(one.height - two.height) > 8 || Math.abs(one.x - two.x) > 40 || Math.abs(one.y - two.y) > 40;
  for (const step of b.order) { const mine = a.steps.get(step.label); if (!mine || differs(mine, step)) return centre(step); }
  for (const step of a.order) if (!b.steps.has(step.label)) return centre(step);
  const middle = (key: string, steps: Map<string, { x: number; width: number }>): number | null => {
    const [from, to] = key.split('\u0000'), ends = [from, to].flatMap(label => { const step = label ? steps.get(label) : undefined; return step ? [centre(step)] : []; });
    return ends.length ? ends.reduce((sum, value) => sum + value, 0) / ends.length : null;
  };
  for (const key of b.arrows) if (!a.arrows.has(key)) { const x = middle(key, b.steps); if (x !== null) return x; }
  for (const key of a.arrows) if (!b.arrows.has(key)) { const x = middle(key, a.steps); if (x !== null) return x; }
  return null;
}

/** Reads the details of every run from `folder` (the bench folder); `null` folder: none given. */
export async function loadReportDetails(input: ReportInput, folder: string | null, words: { group: string; loose: string; finalBoard: string; target: string }): Promise<ReportDetails> {
  const report = asView(input);
  const runs = new Map<string, RunDetail>();
  const explanations = await libraryExplanations(report).catch(() => new Map<string, Localized>());
  // An artifact-judged run has no session, trajectory or trace to explain it (PADR-0044 decision 1).
  if (report.verdictLevel === 'artifact') return { folder: 'read', runs, explanations };
  if (folder === null) return { folder: 'missing', runs, explanations };
  const logFormat = report.readFrom === BENCH_SCHEMA_V3 ? 'v3' : 'v2', nativeName = nativeFileOf(report);
  const found = await boundWorld(report, folder);
  if ('problem' in found) return { folder: found.problem, runs, explanations };
  const world = found.world, references = await boundReferences(report, folder);
  const mirror = report.environment.mirror;
  for (const [index, run] of report.runs.entries()) {
    const detail: RunDetail = { run, conditions: null, conditionsMissing: null, traceError: null, errors: [], trajectory: null, trajectoryMissing: null, picture: null, groups: [], frames: [], objects: [], target: null, targetMissing: null, targetObjects: [], overflow: 'none', fromEnd: false, groupOverlay: false, calls: null, callsMissing: null, clients: [], rejected: [] };
    runs.set(run.id, detail);
    const variant = generateVariant(world, run.seed), task = variant.tasks.find(candidate => candidate.id === run.taskId);
    if (!task) continue;
    const conditions = publicConditions(task);
    const v2 = run;
    // The mutation log and the trace explain any run, judged or not.
    let trace: z.infer<typeof TraceSchema> | null = null;
    const traceHash = v2?.artifacts?.trace;
    detail.traceError = v2?.artifacts?.traceError ?? null;
    if (typeof traceHash === 'string') {
      const read = await bound(folder, run.id, RUN_EVIDENCE.trace, traceHash);
      if ('text' in read) { try { const parsed = TraceSchema.safeParse(JSON.parse(read.text)); if (parsed.success && parsed.data.conditions.length === conditions.length && [parsed.data.start, ...parsed.data.points.map(point => point.met)].every(met => met.length === conditions.length)) trace = parsed.data; else detail.conditionsMissing = 'unreadable'; } catch { detail.conditionsMissing = 'unreadable'; } }
      else detail.conditionsMissing = read.missing;
    }
    // A trace without the mutation log it follows is not shown (it could not be re-derived).
    if (trace && !v2?.logs) { trace = null; detail.conditionsMissing = 'unreadable'; }
    if (v2?.logs) {
      const read = await bound(folder, run.id, RUN_EVIDENCE.mutations, v2.logs.mutations.sha256, MAX_LOG_BYTES);
      if ('text' in read) {
        try {
          const records = parseMutations(read.text, logFormat);
          // Its points must be exactly the accepted mutations, in order, with their steps.
          const accepted = records.filter(record => record.outcome === 'accepted' && record.op !== 'check');
          if (trace && (trace.points.length !== accepted.length || trace.points.some((point, at) => point.seq !== accepted[at]!.seq || point.step !== accepted[at]!.step))) { trace = null; detail.conditionsMissing = 'unreadable'; }
          detail.trajectory = trajectoryOf(records, world, run, trace);
          detail.clients = [...new Set(records.flatMap(record => record.client === null ? [] : [record.client]))];
          const rejected = new Map<string, number>();
          for (const record of records) if (record.outcome === 'rejected' && record.op === 'act') rejected.set(record.code ?? 'rejected', (rejected.get(record.code ?? 'rejected') ?? 0) + 1);
          detail.rejected = [...rejected.entries()].sort((a, b) => b[1] - a[1]);
        } catch { detail.trajectoryMissing = 'unreadable'; trace = null; detail.conditionsMissing ??= 'unreadable'; }
      } else { detail.trajectoryMissing = read.missing; trace = null; detail.conditionsMissing ??= read.missing; }
      if (v2.logs.calls) {
        const calls = await bound(folder, run.id, RUN_EVIDENCE.calls, v2.logs.calls.sha256, MAX_LOG_BYTES);
        if ('text' in calls) { try { detail.calls = summarizeCalls(parseCallLog(calls.text), v2.logs.calls.dropped, v2.logs.calls.omitted ?? 0, v2.logs.calls.omittedAtLeast === true); } catch { detail.callsMissing = 'unreadable'; } }
        else detail.callsMissing = calls.missing;
      } else detail.callsMissing = 'not-recorded';
    } else { detail.trajectoryMissing = 'not-recorded'; detail.callsMissing = 'not-recorded'; }
    // A run without a verdict was not judged; a judged run of an older report may bind no artifacts.
    if (!run.checker) { detail.conditionsMissing = 'not-judged'; continue; }
    if (!run.artifacts) { detail.conditionsMissing = 'not-recorded'; continue; }
    const session = await bound(folder, run.id, ARTIFACT.session, run.artifacts.session);
    let state: State | null = null;
    // The judged state, validated again before anything is drawn from it.
    if ('text' in session) { try { state = validateState((parseJsonEntry(Buffer.from(session.text), ARTIFACT.session, 64) as SessionData).state, worldEra(world)); } catch { state = null; } }
    const checker = await bound(folder, run.id, ARTIFACT.checker, run.artifacts.checker);
    if ('text' in checker) {
      try {
        const parsed = CheckerOutputSchema.parse(parseJsonEntry(Buffer.from(checker.text), ARTIFACT.checker, 64));
        const all = [...(parsed.session.tasks.find(entry => entry.taskId === run.taskId)?.errors ?? []), ...(parsed.native?.tasks.find(entry => entry.taskId === run.taskId)?.errors ?? [])];
        detail.errors = all.filter((error, index) => all.findIndex(other => other.id === error.id) === index);
      } catch { /* the error ids from the report stay; their explanations are unreadable */ }
    }
    if (state === null) { detail.conditionsMissing ??= 'text' in session ? 'unreadable' : session.missing; continue; }
    // Conditions: the trace's history when there is one, else their state at the end (no history).
    const final = trace ? (trace.points.at(-1)?.met ?? trace.start) : null;
    detail.conditions = conditions.map((condition, index) => {
      if (trace && final !== null) return { id: condition.id, text: condition.text, formal: condition.formalText ?? null, met: final[index] === '1', history: conditionHistory(trace.start, trace.points, index) };
      const evaluated = evaluate(condition.predicate, state!);
      return { id: condition.id, text: condition.text, formal: condition.formalText ?? null, met: evaluated.ok ? evaluated.value : null, history: { kind: 'unknown' } };
    });
    detail.groups = groupsOf(state, words.group); detail.frames = framesOf(state); detail.objects = boardObjects(state);
    // The engine's picture when it is there and readable; where its drawing lies in board units comes
    // from the judged native scene (the export is centred on it), so the pair can share a viewBox.
    let engine: { read: EngineSvg; box: Box | null } | null = null, reason: PictureReason | null = null;
    const board = v2?.artifacts?.board;
    if (typeof board === 'string') {
      const read = await bound(folder, run.id, RUN_EVIDENCE.board, board, MAX_SVG_BYTES);
      if ('text' in read) {
        try {
          const svg = readEngineSvg(read.text, `run${index}-engine`);
          let scene: Box | null = null;
          if (run.artifacts.native) { const native = await bound(folder, run.id, nativeName, run.artifacts.native); if ('text' in native) { try { scene = sceneBounds(native.text); } catch { scene = null; } } }
          engine = { read: svg, box: scene ? { x: scene.x - (svg.box.width - scene.width) / 2, y: scene.y - (svg.box.height - scene.height) / 2, width: svg.box.width, height: svg.box.height } : null };
        } catch { reason = 'picture-unreadable'; }
      } else reason = read.missing === 'changed' ? 'picture-changed' : 'no-picture';
    } else reason = mirror === 'required' ? 'no-picture' : 'model-only';
    // Example target: the validated reference's end state for this seed, as a schematic.
    const steps = references?.get(run.taskId);
    let target: State | null = null;
    if (references === null) detail.targetMissing = 'unreadable';
    else if (!steps) detail.targetMissing = 'no-reference';
    else {
      const played = runOracle(world, run.seed, run.taskId, steps);
      if (played.ok) target = played.session.state; else detail.targetMissing = 'unreadable';
    }
    // One viewBox for the pair: the union in board units; an export whose place is unknown gets a frame
    // of the same size as the target's, so the two are still drawn at one scale.
    const finalBox = engine ? engine.box ?? engine.read.box : schematicBounds(state), targetBox = target ? schematicBounds(target) : null;
    let finalView = finalBox, targetView = targetBox;
    if (targetBox && (!engine || engine.box)) finalView = targetView = unionBox(finalBox, targetBox);
    else if (targetBox) { const width = Math.max(finalBox.width, targetBox.width), height = Math.max(finalBox.height, targetBox.height); finalView = { ...finalBox, width, height }; targetView = { ...targetBox, width, height }; }
    // Ids inside the pictures are unique on the page by the run's position, whatever its id's length.
    // Groups are drawn the same way on both pictures: an export shows none, so the judged state's group
    // outline is laid over it when the two share coordinates; when they cannot, neither picture draws
    // groups (the legend under each still names them).
    const placed = !engine || engine.box !== null;
    if (engine) {
      const offset: [number, number] | undefined = engine.box ? [engine.box.x - engine.read.box.x, engine.box.y - engine.read.box.y] : undefined;
      const overlay = engine.box ? groupOutlines(state, words) : '';
      detail.groupOverlay = overlay !== '';
      detail.picture = { kind: 'engine', markup: engineSvgMarkup(engine.read, { prefix: `run${index}-engine`, label: words.finalBoard, classes: 'engine-board', ...(offset ? { offset } : {}), ...(overlay ? { overlay } : {}), viewBox: engine.box ? finalView : { ...engine.read.box, width: finalView.width, height: finalView.height } }) };
    } else detail.picture = { kind: 'schematic', reason: reason!, markup: schematicSvg(state, { prefix: `run${index}-final`, label: words.finalBoard, words, viewBox: finalView }) };
    if (target) { detail.target = schematicSvg(target, { prefix: `run${index}-target`, label: words.target, words, viewBox: targetView!, groups: placed }); detail.targetObjects = boardObjects(target); }
    detail.overflow = pictureOverflow(finalView.width);
    // Where a scrolling pair opens: at the end where the first difference lies (only when they share coordinates).
    const difference = target && placed ? firstDifference(state, target) : null;
    detail.fromEnd = difference !== null && difference > finalView.x + finalView.width / 2;
  }
  return { folder: 'read', runs, explanations };
}
