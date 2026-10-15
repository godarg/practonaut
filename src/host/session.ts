import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { Session } from '../core/session.ts';
import { evaluate } from '../predicate/index.ts';
import { selectVariant } from '../world/variant.ts';
import { actionTemplates } from '../player/messages.ts';
import { styleNames } from '../world/style-names.ts';
import { sha256Hex, stateHash } from '../canonical/index.ts';
import type { Action, Effect, Localized, Predicate, Task, World, State, Value } from '../world/types.ts';
import type { ActRequest, HistoryItem, HostErrorCode, HostEvent, HostReply, HostView, MutationDelta, MutationReply, PracticeController, PracticeLimits, PublicCheck, PublicCondition, ResetRequest, RevisionRequest, ServeOptions, VariantRequest,TransactionContext } from './protocol.ts';
import { TASK_LIMITS } from '../world/schema.ts';
import { toRaw } from '../adapters/excalidraw/raw.ts';
import { interpretEditorGesture, reconcileCreatedIdentity } from './editor-input.ts';
import { createPracticeMirror, MirrorFault,HOST_TRANSACTION_MS,MIN_MIRROR_REMAINING_MS } from './mirror.ts';
import type { MirrorFactory, PracticeMirror } from './mirror.ts';
import {buildExportEnvelope,nativeMatchesState,type CurrentSessionExport} from './export-pair.ts';
import {HOST_LIMITS} from './limits.ts';
import { libraryTaskInfo } from '../library/index.ts';

export interface MirrorDiagnostic {
  code: 'real_tool_disagrees' | 'mirror_timeout' | 'mirror_unavailable';
  revision: number;
  action: string;
  before: { state: State; hash: string };
  predicted: { state: State; hash: string };
  readback: { state: State; hash: string } | null;
}
export interface PracticeSessionOptions extends ServeOptions {
  /** Host-only private diagnostics; world data, never credentials. No Player route. */
  /** Admission runs on the complete tentative public view before any mirror write. */
  admitView?: (view: HostView) => void;
  onMirrorDiagnostic?: (record: MirrorDiagnostic) => void | Promise<void>;
}
function actionDescription(action: Action, before: State, after: State): Localized {
  const p = action.params;
  const object = before.objects[String(p.id ?? '')];
  const added = Object.values(after.objects).find(candidate => !before.objects[candidate.id]);
  const arrow = object?.type === 'arrow' ? object : undefined;
  const newArrow = action.name === 'reconnect_end' && arrow ? after.objects[arrow.id] : undefined;
  const key = action.name === 'reconnect_end' && p.end === 'start' ? 'reconnect_start' : action.name === 'set_frame' && p.frameId === null ? 'set_frame_none' : action.name;
  const render = (language: 'en' | 'de'): string => {
    const templates = actionTemplates[language];
    const style = (value: unknown): string => typeof value === 'string' && Object.hasOwn(styleNames[language], value) ? styleNames[language][value as keyof typeof styleNames.en] : String(value ?? '');
    const name = (id: string | null | undefined, state = before): string => {
      const candidate = id ? state.objects[id] : undefined;
      return candidate?.type === 'step' ? candidate.label : templates.detached;
    };
    const fields: Record<string, string | number> = {
      label: action.name === 'add_step' && added?.type === 'step' ? added.label : action.name === 'rename_step' ? String(p.label) : object?.type === 'step' ? object.label : templates.detached,
      oldLabel: object?.type === 'step' ? object.label : templates.detached,
      x: Number(p.x ?? 0), y: Number(p.y ?? 0),
      from: newArrow?.type === 'arrow' ? name(newArrow.from, after) : action.name === 'connect' ? name(String(p.from)) : name(arrow?.from),
      to: newArrow?.type === 'arrow' ? name(newArrow.to, after) : action.name === 'connect' ? name(String(p.to)) : name(arrow?.to),
      oldFrom: name(arrow?.from), oldTo: name(arrow?.to),
      width: Number(p.width ?? 0), height: Number(p.height ?? 0),
      shape: style(p.shape), stroke: style(p.stroke), fill: style(p.fill),
      // "no fill" / "ohne Füllung" reads better than a colour slot holding "none".
      fillText: p.fill === 'none' ? templates.fillNone : templates.fillColour.replace('{colour}', style(p.fill)),
      name: String(p.name ?? ''), oldName: object?.type === 'frame' ? object.name : '',
      other: name(typeof p.with === 'string' ? p.with : null),
      frame: (() => { const frame = typeof p.frameId === 'string' ? before.objects[p.frameId] : undefined; return frame?.type === 'frame' ? frame.name : ''; })(),
    };
    const template = templates[key as keyof typeof templates];
    return template.replace(/\{([a-zA-Z]+)\}/g, (_, name: string) => String(fields[name] ?? ''));
  };
  return { en: render('en'), de: render('de') };
}
const reject = <T>(code: HostErrorCode, message: string): HostReply<T> => ({ ok: false, error: { code, message } });
/** A delta larger than this leaves its changed objects out (`changedOmitted`); the view and an
 * `observe` still carry the board. Keeps view plus delta inside the 4 MiB reply budget. */
export const DELTA_LIMIT_BYTES = 512 * 1024;
export function boundedDelta(delta: MutationDelta, limit = DELTA_LIMIT_BYTES): MutationDelta {
  return Buffer.byteLength(JSON.stringify(delta)) > limit ? { ...delta, changed: {}, changedOmitted: true } : delta;
}
/** What a mutation changed, from the committed state before it and the published view after it:
 * every object that differs (deleted objects keep their tombstone), the ids it created and the ids
 * it deleted. Derived from public data only; an agent learns nothing a view would not show. */
export function mutationDelta(before: State, after: HostView, effects: Effect[]): MutationDelta {
  const changed: MutationDelta['changed'] = {}, created: string[] = [], removed: string[] = [];
  for (const [id, object] of Object.entries(after.state.objects)) {
    const previous = before.objects[id];
    if (previous && isDeepStrictEqual(previous, object)) continue;
    changed[id] = structuredClone(object);
    if (!previous) created.push(id);
    else if (!previous.deleted && object.deleted) removed.push(id);
  }
  for (const id of Object.keys(before.objects)) if (!Object.hasOwn(after.state.objects, id)) removed.push(id);
  return { step: after.step, revision: after.revision, hash: after.hash, changed, created, removed, effects: structuredClone(effects), errors: structuredClone(after.errors), ...(after.limits ? { limits: structuredClone(after.limits) } : {}) };
}
/** Never split through quantifiers: each witness must satisfy the complete body. */
export function publicConditions(task: Task): Array<PublicCondition & { predicate: Predicate }> {
  const clauses = task.goal.op === 'all' ? task.goal.args : [task.goal];
  return clauses.map((predicate, index) => {
    const formalText = describePredicate(predicate);
    // world/2 tasks state their own sentence per clause; the formal text stays available beside it.
    const text = task.conditionTexts?.[index] ?? describePreparedRepair(predicate, task.initialState) ?? describeCondition(predicate, task.initialState);
    return { id: `goal-${index + 1}`, text: text ?? formalText, ...(text ? { formalText } : {}), predicate };
  });
}

/** The whole finite T3 tree is matched, including its binding graph and frame clauses.
 * No fragment receives an independent verdict, and no predicate is rewritten. */
function describePreparedRepair(p: Predicate, initial: State | undefined): Localized | undefined {
  if (!initial || p.op !== 'exists' || p.type !== 'step' || p.where.op !== 'all' || p.where.args.length !== 2) return undefined;
  const firstClause = p.where.args[0]!, second = p.where.args[1]!;
  if (firstClause.op !== 'eq' || firstClause.right.kind !== 'literal' || typeof firstClause.right.value !== 'string' || second.op !== 'exists' || second.type !== 'step' || second.where.op !== 'all' || second.where.args.length !== 2) return undefined;
  const lastClause = second.where.args[0]!, body = second.where.args[1]!;
  if (lastClause.op !== 'eq' || lastClause.right.kind !== 'literal' || typeof lastClause.right.value !== 'string' || body.op !== 'all' || body.args.length !== 2) return undefined;
  const global = body.args[0]!, arrow = body.args[1]!;
  if (global.op !== 'all' || global.args.length !== 4 || arrow.op !== 'exists' || arrow.type !== 'arrow') return undefined;
  const countSteps = global.args[0]!, countArrows = global.args[1]!, every = global.args[2]!, namedFrame = global.args[3]!;
  if (countSteps.op !== 'eq' || countSteps.left.kind !== 'count' || countArrows.op !== 'eq' || countArrows.left.kind !== 'count' || every.op !== 'every' || every.type !== 'step' || every.where.op !== 'eq' || every.where.right.kind !== 'literal' || typeof every.where.right.value !== 'string' || namedFrame.op !== 'exists' || namedFrame.type !== 'frame' || namedFrame.where.op !== 'eq' || namedFrame.where.right.kind !== 'literal' || typeof namedFrame.where.right.value !== 'string') return undefined;
  const first = firstClause.right.value, last = lastClause.right.value, frameId = every.where.right.value, requiredFrameName = namedFrame.where.right.value;
  const resolved = (value: string): boolean => !!value.trim() && !/\{\{[^}]*\}\}/.test(value);
  const visibleName = (value: string): string => value.replace(/\s+/g, ' ').trim();
  if (![first, last, frameId, requiredFrameName].every(resolved) || visibleName(first) === visibleName(last)) return undefined;
  const binders = [p.as, second.as, every.as, namedFrame.as, arrow.as];
  if (new Set(binders).size !== binders.length || binders.includes(countSteps.left.as) || binders.includes(countArrows.left.as)) return undefined;
  const literal = (value: string | number): Value => ({ kind: 'literal', value });
  const field = (variable: string, field: string): Value => ({ kind: 'field', variable, field });
  const eq = (left: Value, right: Value): Predicate => ({ op: 'eq', left, right });
  const all = (...args: Predicate[]): Predicate => ({ op: 'all', args });
  const expected: Predicate = { op: 'exists', type: 'step', as: p.as, where: all(
    eq(field(p.as, 'label'), literal(first)),
    { op: 'exists', type: 'step', as: second.as, where: all(
      eq(field(second.as, 'label'), literal(last)),
      all(all(
        eq({ kind: 'count', type: 'step', as: countSteps.left.as, where: { op: 'true' } }, literal(2)),
        eq({ kind: 'count', type: 'arrow', as: countArrows.left.as, where: { op: 'true' } }, literal(1)),
        { op: 'every', type: 'step', as: every.as, where: eq(field(every.as, 'frameId'), literal(frameId)) },
        { op: 'exists', type: 'frame', as: namedFrame.as, where: eq(field(namedFrame.as, 'name'), literal(requiredFrameName)) }
      ), { op: 'exists', type: 'arrow', as: arrow.as, where: all(
        eq(field(arrow.as, 'from'), field(p.as, 'id')),
        eq(field(arrow.as, 'to'), field(second.as, 'id')),
        eq(field(arrow.as, 'frameId'), literal(frameId))
      ) })
    ) }
  ) };
  if (!isDeepStrictEqual(p, expected)) return undefined;
  const frame = initial.objects[frameId];
  if (frame?.type !== 'frame' || frame.deleted || !resolved(frame.name) || Object.values(initial.objects).filter(o => o.type === 'frame' && !o.deleted && visibleName(o.name) === visibleName(frame.name)).length !== 1) return undefined;
  for (const name of [first, last]) {
    const candidates = Object.values(initial.objects).filter(o => o.type === 'step' && !o.deleted && visibleName(o.label) === visibleName(name));
    if (candidates.length !== 1 || candidates[0]?.type !== 'step' || candidates[0].label !== name) return undefined;
  }
  return {
    en: `The result has exactly two steps labelled “${first}” and “${last}”, connected in that direction by exactly one arrow. Both steps and the arrow belong to the starting frame “${frame.name}”. A frame named “${requiredFrameName}” must also exist.`,
    de: `Im Ergebnis gibt es genau zwei Schritte mit den Beschriftungen „${first}“ und „${last}“ und genau einen Pfeil, der diese beiden Schritte in dieser Richtung verbindet. Beide Schritte und der Pfeil gehören zum Ausgangsrahmen „${frame.name}“. Außerdem muss ein Rahmen mit dem Namen „${requiredFrameName}“ vorhanden sein.`,
  };
}

/** Only exact public AST shapes receive plain-language narration. Predicate authority stays untouched. */
function describeCondition(p: Predicate, initial: State | undefined): Localized | undefined {
  const words = (en: string, de: string): Localized => ({ en, de });
  const label = (id: string): string | undefined => {
    const object = initial?.objects[id];
    if (object?.type !== 'step' || object.deleted || !object.label.trim() || /\{\{[^}]*\}\}/.test(object.label)) return undefined;
    // A duplicated visible name would leave the identity-based requirement ambiguous.
    if (Object.values(initial!.objects).filter(o => o.type === 'step' && !o.deleted && o.label === object.label).length !== 1) return undefined;
    return object.label;
  };
  const boundLiteral = (condition: Predicate, variable: string, field: string): string | undefined =>
    condition.op === 'eq' && condition.left.kind === 'field' && condition.left.variable === variable && condition.left.field === field && condition.right.kind === 'literal' && typeof condition.right.value === 'string' ? condition.right.value : undefined;
  const retained = p.op === 'not' ? p.arg : p;
  if (retained.op === 'exists' && retained.type === 'step') {
    const id = boundLiteral(retained.where, retained.as, 'id'), name = id === undefined ? undefined : label(id);
    if (name !== undefined) return p.op === 'not' ? words(`Remove “${name}”.`, `Entferne „${name}“.`) : words(`Keep “${name}” in the process.`, `Behalte „${name}“ im Ablauf.`);
  }
  if (p.op === 'eq' && p.left.kind === 'count' && (p.left.type === 'step' || p.left.type === 'arrow') && p.left.where.op === 'true' && p.right.kind === 'literal' && typeof p.right.value === 'number' && Number.isSafeInteger(p.right.value) && p.right.value >= 0) {
    const count = p.right.value, en = p.left.type === 'step' ? (count === 1 ? 'step' : 'steps') : (count === 1 ? 'arrow' : 'arrows');
    const de = p.left.type === 'step' ? (count === 1 ? 'Schritt' : 'Schritte') : (count === 1 ? 'Pfeil' : 'Pfeile');
    return words(`Exactly ${count} ${en} ${count === 1 ? 'remains' : 'remain'}.`, `Genau ${count} ${de} ${count === 1 ? 'bleibt' : 'bleiben'} erhalten.`);
  }
  if (p.op === 'exists' && p.type === 'arrow' && p.where.op === 'all' && p.where.args.length === 2) {
    const from = p.where.args.map(condition => boundLiteral(condition, p.as, 'from')).filter(value => value !== undefined);
    const to = p.where.args.map(condition => boundLiteral(condition, p.as, 'to')).filter(value => value !== undefined);
    if (from.length === 1 && to.length === 1) {
      const first = label(from[0]!), last = label(to[0]!);
      if (first !== undefined && last !== undefined) return words(`An arrow connects “${first}” directly to “${last}”.`, `Ein Pfeil verbindet „${first}“ direkt mit „${last}“.`);
    }
  }
  return undefined;
}
function describePredicate(p: Predicate): Localized {
  const render = (language: 'en' | 'de'): string => {
    const names = language === 'en' ? { step: 'step', arrow: 'arrow', frame: 'frame' } : { step: 'Schritt', arrow: 'Pfeil', frame: 'Frame' };
    const fields: Record<string, string> = language === 'en' ? { label: 'label', name: 'name', frameId: 'frame', from: 'start step', to: 'end step', id: 'identity', x: 'horizontal position', y: 'vertical position', width: 'width', height: 'height', deleted: 'deleted', fontFamily: 'font', shape: 'shape', groupId: 'group', stroke: 'stroke colour', fill: 'fill colour' } : { label: 'Beschriftung', name: 'Name', frameId: 'Frame', from: 'Anfangsschritt', to: 'Endschritt', id: 'Identität', x: 'horizontale Position', y: 'vertikale Position', width: 'Breite', height: 'Höhe', deleted: 'gelöscht', fontFamily: 'Schrift', shape: 'Form', groupId: 'Gruppe', stroke: 'Linienfarbe', fill: 'Füllfarbe' };
    const value = (v: Value): string => v.kind === 'literal' ? (v.value === null ? language === 'en' ? 'unattached' : 'nicht angebunden' : typeof v.value === 'string' ? JSON.stringify(v.value) : typeof v.value === 'boolean' ? (v.value ? language === 'en' ? 'true' : 'wahr' : language === 'en' ? 'false' : 'falsch') : String(v.value)) : v.kind === 'count' ? `${language === 'en' ? 'number of' : 'Anzahl'} ${names[v.type]} [${v.as}] (${predicate(v.where)})` : `${v.variable}.${fields[v.field] ?? v.field}`;
    const predicate = (node: Predicate): string => {
      switch (node.op) {
        case 'true': return language === 'en' ? 'all' : 'alle';
        case 'false': return language === 'en' ? 'none' : 'keine';
        case 'all': return node.args.map(predicate).join(language === 'en' ? ' and ' : ' und ');
        case 'any': return `(${node.args.map(predicate).join(language === 'en' ? ' or ' : ' oder ')})`;
        case 'not': return `${language === 'en' ? 'not' : 'nicht'} (${predicate(node.arg)})`;
        case 'exists': return `${language === 'en' ? 'there is a' : 'es gibt einen'} ${names[node.type]} [${node.as}]: (${predicate(node.where)})`;
        case 'every': return `${language === 'en' ? 'every' : 'jeder'} ${names[node.type]} [${node.as}]: (${predicate(node.where)})`;
        case 'near': return `${value(node.left)} ≈ ${value(node.right)} (± ${node.tolerance})`;
        case 'contains': return `${value(node.left)} ${language === 'en' ? 'contains' : 'enthält'} ${value(node.right)}`;
        case 'startsWith': return `${value(node.left)} ${language === 'en' ? 'starts with' : 'beginnt mit'} ${value(node.right)}`;
        default: return `${value(node.left)} ${{ eq: '=', lt: '<', lte: '≤', gt: '>', gte: '≥' }[node.op]} ${value(node.right)}`;
      }
    };
    return predicate(p);
  };
  return { en: render('en'), de: render('de') };
}
export async function createPracticeSession(world: World, options: PracticeSessionOptions = {}): Promise<PracticeController> {
  return createPracticeController(world, options, createPracticeMirror);
}
/** Dependency seam for process-boundary fault probes; production always uses the real engine. */
export async function createPracticeController(input: World, options: PracticeSessionOptions, factory: MirrorFactory): Promise<PracticeController> {
  const original = structuredClone(input);
  let session = new Session(original, options.seed ?? 0, options.taskId ?? original.tasks[0]!.id);
  const mode = options.mirror ?? 'required';
  const listInfo = options.taskInfo ?? libraryTaskInfo(original);
  let mirror: PracticeMirror | undefined = mode === 'required' ? await factory(session.state) : undefined;
  const sessionId = randomUUID();
  let revision = 0, attempt = 1, hintsOpened = 0;
  let history: HistoryItem[] = [], result: PublicCheck | null = null;
  let busy = false, closed = false, recoveries = 0;
  // Limits of the current attempt (PADR-0040): accepted changes and evaluated checks since the task
  // or variant was opened. Reset and undo give nothing back.
  if (options.checks !== undefined && (!Number.isSafeInteger(options.checks) || options.checks < 0 || options.checks > TASK_LIMITS.checks)) throw new Error(`checks must be a whole number from 0 to ${TASK_LIMITS.checks}`);
  let actionsUsed = 0, checksUsed = 0;
  const limitsOf = (candidate: Session, actions = actionsUsed, checks = checksUsed): PracticeLimits | undefined => {
    const own = candidate.world.tasks.find(value => value.id === candidate.taskId)!.limits;
    const checkLimits = [own?.checks, options.checks].filter((value): value is number => value !== undefined);
    const limits: PracticeLimits = {
      ...(own?.actions !== undefined ? { actions: { limit: own.actions, used: actions } } : {}),
      ...(checkLimits.length ? { checks: { limit: Math.min(...checkLimits), used: checks } } : {}),
    };
    return limits.actions || limits.checks ? limits : undefined;
  };
  const listeners = new Set<(event: HostEvent) => void>();
  const task = (): Task => session.world.tasks.find(value => value.id === session.taskId)!;
  const consequences = (candidate: Session = session): Array<{ id: string; explanation: Localized }> => candidate.world.tasks.find(value => value.id === candidate.taskId)!.errorClasses.flatMap(error => {
    const condition = evaluate(error.when, candidate.state);
    if (!condition.ok) throw new Error(condition.error.code);
    return condition.value ? [{ id: error.id, explanation: error.explanation }] : [];
  });
  // Error classes are evaluated against the board like the goal: while a check limit applies they
  // would be a free partial check, so they appear only in a check's result, which is counted
  // (PADR-0040). Views, mutation replies, history and explain_result carry none.
  const visibleConsequences = (candidate: Session = session): Array<{ id: string; explanation: Localized }> => limitsOf(candidate)?.checks ? [] : consequences(candidate);
  const makeView = (candidate = session, overrides: Partial<HostView> = {}, counts: { actions: number; checks: number } = { actions: actionsUsed, checks: checksUsed }): HostView => {
    const selectedTask = candidate.world.tasks.find(value => value.id === candidate.taskId)!;
    const limits = limitsOf(candidate, counts.actions, counts.checks);
    return structuredClone({
      schema: 'practonaut.host/1', sessionId, revision, world: { id: original.id, version: original.version },
      seed: candidate.seed, variantId: selectVariant(original, candidate.seed).id,
      task: { id: selectedTask.id, title: selectedTask.title, prompt: selectedTask.prompt, conditions: publicConditions(selectedTask).map(({ id, text, formalText }) => ({ id, text, ...(formalText ? { formalText } : {}) })), hintCount: selectedTask.hints.length },
      tasks: candidate.world.tasks.filter(({ id }) => !options.singleTask || id === candidate.taskId).map(({ id, title }) => ({ id, title, ...(listInfo[id] ? { level: listInfo[id].level, referenceActions: listInfo[id].referenceActions } : {}) })), state: candidate.state, hash: candidate.hash, step: candidate.step,
      log: candidate.log, history, actions: candidate.world.actions, rules: candidate.world.rules, mirror: mode,
      mirrorHealth: { status: closed ? 'closed' : mode === 'off' ? 'model-only' : mirror ? 'available' : 'unavailable', recoveries },
      practiceEvidence: !closed && mode === 'required' && !!mirror, attempt, hintsOpened, hints: selectedTask.hints.slice(0, hintsOpened), result, errors: visibleConsequences(candidate), ...(limits ? { limits } : {}), ...overrides,
    });
  };
  const admit = (value: HostView): void => {
    if (Buffer.byteLength(JSON.stringify(value)) > 3 * 1024 * 1024) throw { code: 'result_too_large', message: 'Practice view exceeds the observable session limit' };
    options.admitView?.(value);
  };
  const view = (): HostView => makeView();
  try { admit(view()); } catch (error) { await mirror?.close(); throw error; }
  const emit = (event: HostEvent): void => { for (const listener of listeners) { try { listener(structuredClone(event)); } catch { /* Detached consumer cannot break the writer. */ } } };
  const contextFor=(context?:TransactionContext):TransactionContext=>context??{deadline:performance.now()+HOST_TRANSACTION_MS};
  const continues=(context:TransactionContext):boolean=>Number.isFinite(context.deadline)&&performance.now()<context.deadline;
  const deadline=(context:TransactionContext):void=>{if(!continues(context))throw new MirrorFault('mirror_timeout','Transaction deadline reached before commit');};
  /** `replay`: the committed session's full replay, before every result check and export
   * (architecture §9). Mutations replay their candidate instead (PADR-0037). */
  const guard = <T>(request: RevisionRequest,context:TransactionContext,replayCommitted=true): HostReply<T> | undefined => {
    if (closed) return reject('mirror_unavailable', 'Session closed');
    if (busy) return reject('session_busy', 'A transaction is in progress');
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision !== revision) return { ok: false, error: { code: 'stale_base', message: `Board changed since this request; the current step is ${session.step} and the current revision ${revision}`, details: { step: session.step, revision } } };
    if(!continues(context))return reject('mirror_timeout','Transaction deadline reached before commit');
    if (!replayCommitted) return undefined;
    const replay = session.checkReplay({continue:()=>continues(context)});
    if (!replay.ok) return reject(replay.error.code==='cancelled'?'mirror_timeout':replay.error.code, replay.error.code==='cancelled'?'Transaction deadline reached before commit':replay.error.message);
    return undefined;
  };
  const rejected = <T>(reply: HostReply<T>): HostReply<T> => {
    if (!reply.ok) emit({ type: 'rejected', revision, hash: session.hash, error: { code: reply.error.code, message: reply.error.message } });
    return reply;
  };
  /** The transaction candidate: a fork of the committed session, never the committed one itself.
   * Its full history is replayed before it can be published (PADR-0037). */
  const candidateFromLog = (context:TransactionContext): Session => {
    deadline(context);
    const candidate = session.fork();
    deadline(context);
    return candidate;
  };
  const diagnostic = async (code: MirrorDiagnostic['code'], candidate: Session, action: string, readback: State | null): Promise<void> => {
    await options.onMirrorDiagnostic?.(structuredClone({ code, revision, action,
      before: { state: session.state, hash: session.hash },
      predicted: { state: candidate.state, hash: candidate.hash },
      readback: readback ? { state: readback, hash: stateHash(readback) } : null,
    }));
  };
  const recoverMirror = async (preserveResult=false): Promise<void> => {
    if (!mirror || closed) return;
    const current = mirror;
    try { await current.recover(session.state); if (closed) throw new MirrorFault('mirror_unavailable', 'Session closed'); recoveries++; }
    catch { await current.close(); if (mirror === current) mirror = undefined; if(!preserveResult)result = null; }
    if (!closed) emit({ type: 'changed', view: view() });
  };
  const synchronize = async (candidate: Session,context:TransactionContext, action?: Action): Promise<HostReply<boolean>> => {
    if (!mirror) return mode === 'off' ? { ok: true, value: false } : reject('mirror_unavailable', 'Mirror is unavailable; restart the session');
    let code: MirrorDiagnostic['code'] | undefined, readback: State | null = null;
    try {
      deadline(context);
      if(context.deadline-performance.now()<MIN_MIRROR_REMAINING_MS)return reject('mirror_timeout','Insufficient remaining transaction budget before mirror write');
      const mirrored = action ? await mirror.apply({ before: session.state, after: candidate.state, action },context) : await mirror.replace(candidate.state,context);
      deadline(context);
      if (!mirrored.ok) {
        code = mirrored.error.code === 'mirror_timeout' || mirrored.error.code === 'mirror_unavailable' ? mirrored.error.code : 'real_tool_disagrees';
        try { readback = await mirror.snapshot(); } catch { /* Unavailable engine read-back is explicit null. */ }
      } else {
        readback = await mirror.snapshot(context);deadline(context);
        if (!isDeepStrictEqual(mirrored.state, candidate.state) || !isDeepStrictEqual(readback, candidate.state)) {
          code = 'real_tool_disagrees'; if (!isDeepStrictEqual(mirrored.state, candidate.state)) readback = mirrored.state;
        } else return { ok: true, value: true };
      }
    } catch (error) { code = error instanceof MirrorFault ? error.code : 'mirror_unavailable'; }
    await recoverMirror(); // Exactly one bounded restoration attempt per failed transaction.
    if(code==='mirror_timeout'&&!continues(context))return reject('mirror_timeout','Transaction deadline reached; committed board restored or mirror disposed');
    try { await diagnostic(code!, candidate, action?.name ?? 'replace', readback); }
    catch (error) { const loggingCode = (error as { code?: string }).code; return reject(loggingCode === 'diagnostic_limit' ? 'diagnostic_limit' : 'diagnostic_unavailable', 'Private mirror diagnostics failed; the board was not changed'); }
    return reject(code!, mirror ? 'Mirror rejected the action and was restored; the board was not changed' : 'Mirror unavailable; restart the session. The board was not changed');
  };
  /** `counted`: an accepted change uses one action of the attempt's limit; `newAttempt` (a new task or
   * variant) starts fresh counts instead. */
  const mutate = async (request: RevisionRequest, build: (context:TransactionContext) => { candidate: Session; action?: Action; effects?: HistoryItem['effects']; reset?: boolean; attempt?: number; actor?: HistoryItem['actor'] },suppliedContext?:TransactionContext, accounting: { counted: boolean; newAttempt?: boolean } = { counted: true }): Promise<HostReply<MutationReply>> => {
    const context=contextFor(suppliedContext),invalid = guard<MutationReply>(request,context,false); if (invalid) return rejected(invalid);
    const actionLimit = limitsOf(session)?.actions;
    if (accounting.counted && actionLimit && actionLimit.used >= actionLimit.limit) return rejected(reject('action_budget_exhausted', `This attempt's action limit (${actionLimit.limit} changes, undo and reset included) is used up`));
    const counts = accounting.newAttempt ? { actions: 0, checks: 0 } : { actions: actionsUsed + (accounting.counted ? 1 : 0), checks: checksUsed };
    busy = true;
    const started = performance.now();let mirrorWritten=false;
    try {
      const next = build(context);deadline(context);
      const replay = next.candidate.checkReplay({continue:()=>continues(context)});deadline(context);
      if (!replay.ok) return rejected(reject(replay.error.code, replay.error.message));
      const candidateConsequences = visibleConsequences(next.candidate);
      const description = next.action ? actionDescription(next.action, session.state, next.candidate.state) : undefined;
      const projectedHistory = next.reset ? [] : next.action ? [...history, { description: description!, actor: structuredClone(next.actor ?? { kind: 'human' as const }), step: next.candidate.step, action: structuredClone(next.action), hash: next.candidate.hash, effects: next.effects ?? [], consequences: candidateConsequences, ruleIds: next.candidate.world.rules.filter(rule => rule.action === next.action!.name).map(rule => rule.id), mirrorConfirmed: mode === 'required', latencyMs: 999999999 }] : history.slice(0, next.candidate.step);
      // A new task starts at attempt 1; a reset or a new variant of the same task counts on.
      const nextAttempt = next.attempt ?? (next.candidate.taskId === session.taskId ? attempt + 1 : 1);
      admit(makeView(next.candidate, { revision: revision + 1, history: projectedHistory, result: null, ...(next.reset ? { attempt: nextAttempt, hintsOpened: 0, hints: [] } : {}) }, counts));
      deadline(context);const synchronized = await synchronize(next.candidate,context, next.action);
      if (!synchronized.ok) return rejected(synchronized);
      mirrorWritten=synchronized.value;
      if (closed) return rejected(reject('mirror_unavailable', 'Session closed during transaction'));
      deadline(context);
      const latencyMs = Math.round(performance.now() - started);
      if(next.action){projectedHistory.at(-1)!.latencyMs=latencyMs;projectedHistory.at(-1)!.mirrorConfirmed=synchronized.value;}
      const value=makeView(next.candidate,{revision:revision+1,history:projectedHistory,result:null,...(next.reset?{attempt:nextAttempt,hintsOpened:0,hints:[]}:{})},counts);admit(value);
      // The delta is computed and bounded before the commit, so a committed change always has its reply.
      const delta = boundedDelta(mutationDelta(session.state, value, next.effects ?? []));
      deadline(context); // No await between this final check and the synchronous commit.
      session = next.candidate; revision++; result = null;history=projectedHistory; actionsUsed = counts.actions; checksUsed = counts.checks;
      if (next.reset) { attempt = nextAttempt; hintsOpened = 0; }
      mirrorWritten=false;emit({ type: 'changed', view: value });
      return { ok: true, value: { view: value, delta, mirrorConfirmed: synchronized.value, latencyMs } };
    } catch (error) {
      const timedOut=!continues(context);
      if(mirrorWritten)await recoverMirror(); // Lock stays held through verified rollback/disposal.
      const failure = error as { code?: HostErrorCode; message?: string };
      // A step that no longer matches (the core's baseStep check) is as stale as an old revision:
      // name what is current, as the revision guard does.
      if (!timedOut && failure.code === 'stale_base') return rejected({ ok: false, error: { code: 'stale_base', message: `${failure.message ?? 'Board changed since this request'}; the current step is ${session.step} and the current revision ${revision}`, details: { step: session.step, revision } } });
      return rejected(reject(timedOut?'mirror_timeout':failure.code ?? 'replay_mismatch',timedOut?'Transaction deadline reached; committed board restored or mirror disposed':failure.message ?? 'Transaction failed'));
    } finally { busy = false; }
  };
  return {
    view,
    scene: () => toRaw(session.state),
    editor: (request,context) => mutate(request, budget => {
      const interpreted = interpretEditorGesture(request, session.state);
      deadline(budget);const candidate = candidateFromLog(budget);
      const applied = candidate.act(interpreted.action);
      if (!applied.ok) throw applied.error;
      const intended = reconcileCreatedIdentity(interpreted.intended, interpreted.createdId, candidate.state, session.state);
      if (!isDeepStrictEqual(candidate.state, intended)) throw { code: 'editor_divergence', message: 'Editor successor differs from the complete modeled action; resynchronize' };
      return { candidate, action: interpreted.action, effects: applied.effects };
    },context),
    act: (request: ActRequest,context) => mutate(request, budget => {
      const candidate = candidateFromLog(budget); const action = structuredClone(request.action);
      const applied = candidate.act(action);
      if (!applied.ok) throw applied.error;
      return { candidate, action, effects: applied.effects, ...(request.actor ? { actor: request.actor } : {}) };
    },context),
    undo: (request,context) => mutate(request, budget => { const candidate = candidateFromLog(budget); const undone = candidate.undo(); if (!undone.ok) throw undone.error; return { candidate }; },context),
    reset: (request: ResetRequest,context) => request.confirmed !== true ? Promise.resolve(rejected(reject('invalid_request', 'Reset needs confirmation'))) : mutate(request, () => ({ candidate: new Session(original, session.seed, session.taskId), reset: true, ...(request.attempt === undefined ? {} : { attempt: request.attempt }) }),context),
    variant: (request: VariantRequest,context) => request.confirmed !== true ? Promise.resolve(rejected(reject('invalid_request', 'Task or variant change needs confirmation')))
      : options.singleTask && request.taskId !== undefined && request.taskId !== session.taskId ? Promise.resolve(rejected(reject('invalid_request', 'This session offers only its own task'))) : mutate(request, budget => {
      let seed = session.seed;
      if (request.taskId === undefined) {
        seed++;
        // A task-only change keeps this seed. New variant chooses a genuinely different case.
        while (selectVariant(original, seed).id === selectVariant(original, session.seed).id && seed < session.seed + 10_000) {deadline(budget);seed++;}
      }
      if (!Number.isSafeInteger(seed)) throw { code: 'invalid_argument', message: 'Seed limit reached' };
      return { candidate: new Session(original, seed, request.taskId ?? session.taskId), reset: true, ...(request.attempt === undefined ? {} : { attempt: request.attempt }) };
      // Under task limits (PADR-0040) a new variant of the same task counts like a reset: it uses one
      // change, is refused once the changes are used up, and keeps the attempt's counts. Only another
      // task starts fresh counts (a single-task host refuses that).
    },context,(request.taskId === undefined || request.taskId === session.taskId) && limitsOf(session) ? { counted: true } : { counted: false, newAttempt: true }),
    hint: async (request,suppliedContext) => {
      const context=contextFor(suppliedContext),invalid = guard<HostView>(request,context); if (invalid) return rejected(invalid);
      try {
        const opened = Math.min(hintsOpened + 1, task().hints.length);
        const current=makeView(session, { revision: revision + 1, hintsOpened: opened, hints: task().hints.slice(0, opened) });admit(current);deadline(context);
        hintsOpened = opened; revision++;
        emit({ type: 'changed', view: current }); return { ok: true, value: current };
      } catch (error) { const failure = error as { code?: HostErrorCode; message?: string }; return rejected(reject(failure.code ?? 'result_too_large', failure.message ?? 'View admission failed')); }
    },
    check: async (request,suppliedContext) => {
      const context=contextFor(suppliedContext),invalid = guard<PublicCheck>(request,context); if (invalid) return rejected(invalid);
      const checkLimit = limitsOf(session)?.checks;
      if (checkLimit && checkLimit.used >= checkLimit.limit) return rejected(reject('check_budget_exhausted', `This attempt's check limit (${checkLimit.limit}) is used up`));
      busy = true;
      try {
        deadline(context);if (mirror && !isDeepStrictEqual(await mirror.snapshot(context), session.state)) { await recoverMirror(true);return rejected(reject('real_tool_disagrees', 'The real tool disagrees')); }deadline(context);
        if (closed) return rejected(reject('mirror_unavailable', 'Session closed'));
        if (mode === 'required' && !mirror) return rejected(reject('mirror_unavailable', 'Mirror unavailable'));
        const full = evaluate(task().goal, session.state); if (!full.ok) return rejected(reject(full.error.code, full.error.message));
        const conditions = publicConditions(task()).map(({ id, text, formalText, predicate }) => { const checked = evaluate(predicate, session.state); if (!checked.ok) throw checked.error; return { id, text, ...(formalText ? { formalText } : {}), met: checked.value }; });
        const used = checksUsed + 1;
        const checked: PublicCheck = { scope: 'end-state-only', hash: session.hash, revision, passed: full.value, conditions, errors: consequences(), mode: mode === 'required' ? 'real-engine' : 'model-only', practiceEvidence: !closed && mode === 'required' && !!mirror, ...(checkLimit ? { checksRemaining: checkLimit.limit - used } : {}) };
        admit(makeView(session, { result: checked }, { actions: actionsUsed, checks: used }));deadline(context); result = checked; checksUsed = used;
        emit({ type: 'changed', view: view() }); return { ok: true, value: structuredClone(result) };
      } catch (error) { if (error instanceof MirrorFault) await recoverMirror(); const code = (error as { code?: HostErrorCode }).code; return rejected(reject(code ?? 'checker_invalid', mirror ? 'Result check unavailable; mirror restored' : 'Mirror unavailable; restart the session')); }
      finally { busy = false; }
    },
    png: async suppliedContext => {
      const context=contextFor(suppliedContext);
      if (busy) return reject('session_busy', 'A transaction is in progress');
      if (closed) return reject('mirror_unavailable', 'Session closed');
      if (!mirror) return reject('mirror_unavailable', 'Model-only session has no real tool image');
      busy = true;
      try {deadline(context);if(!isDeepStrictEqual(await mirror.snapshot(context),session.state))throw {code:'real_tool_disagrees'};deadline(context);const png=await mirror.png(context);deadline(context);return { ok: true, value: png }; }
      catch (error) { await recoverMirror(); return reject(error instanceof MirrorFault ? error.code : 'mirror_unavailable', mirror ? 'Real tool image unavailable; mirror restored' : 'Mirror unavailable; restart the session'); }
      finally { busy = false; }
    },
    export:async(request,suppliedContext,options)=>{
      const context=contextFor(suppliedContext),invalid=guard<CurrentSessionExport>(request,context);if(invalid)return rejected(invalid);
      if(mode!=='required'||!mirror?.exportNative)return rejected(reject('mirror_unavailable','Native export requires an available real mirror'));
      busy=true;
      try{
        const boundRevision=revision,boundHash=session.hash;
        deadline(context);if(!isDeepStrictEqual(await mirror.snapshot(context),session.state))throw {code:'real_tool_disagrees'};deadline(context);
        const native=await mirror.exportNative(context);deadline(context);
        if(Buffer.byteLength(native,'utf8')>HOST_LIMITS.replyBytes)throw {code:'result_too_large'};
        // Parse the exact adapter bytes through the separate checker import path (the era's parser).
        if(session.hash!==boundHash||!nativeMatchesState(session.world.schema,native,session.state))throw {code:'real_tool_disagrees'};
        deadline(context);if(!isDeepStrictEqual(await mirror.snapshot(context),session.state))throw {code:'real_tool_disagrees'};deadline(context);
        const replay=session.checkReplay({continue:()=>continues(context)});deadline(context);if(!replay.ok)throw replay.error;
        const data=session.serialize({continue:()=>continues(context)});deadline(context);
        const envelope=buildExportEnvelope(data,boundRevision,native);
        // The picture is taken from the same confirmed scene and read back again before it is published.
        let value:CurrentSessionExport=envelope;
        if(options?.picture){
          if(!mirror.exportPicture)throw {code:'mirror_unavailable'};
          const svg=await mirror.exportPicture(context);deadline(context);
          if(Buffer.byteLength(svg,'utf8')>HOST_LIMITS.replyBytes)throw {code:'result_too_large'};
          if(!isDeepStrictEqual(await mirror.snapshot(context),session.state))throw {code:'real_tool_disagrees'};deadline(context);
          value={...envelope,picture:{file:'practonaut.svg',utf8:svg,sha256:sha256Hex(svg)}};
        }
        if(revision!==boundRevision||session.hash!==boundHash||value.hash!==data.hash||value.seed!==data.seed||value.taskId!==data.taskId||!isDeepStrictEqual(value.world,data.world))throw {code:'replay_mismatch'};
        if(Buffer.byteLength(JSON.stringify({ok:true,value}),'utf8')>HOST_LIMITS.replyBytes-2048)throw {code:'result_too_large'};
        deadline(context);return {ok:true,value};
      }catch(error){
        const code=!continues(context)?'mirror_timeout':(error as {code?:HostErrorCode}).code??'mirror_unavailable';
        if(code!=='result_too_large')await recoverMirror(true);
        return rejected(reject(code,code==='result_too_large'?'Export pair exceeds reply budget':mirror?'Native export refused; committed mirror restored':'Native export refused; mirror unavailable'));
      }finally{busy=false;}
    },
    subscribe: listener => { listeners.add(listener); listener({ type: 'ready', view: view() }); return () => { listeners.delete(listener); }; },
    close: async () => { closed = true; listeners.clear(); await mirror?.close(); },
  };
}
