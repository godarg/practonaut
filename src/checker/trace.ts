/**
 * The goal conditions after every accepted mutation of a run (PADR-0039 A.3), judged by the
 * checker itself: it replays the run's timeline — `act` appends an action through the checker's own
 * transition code, `undo` removes the last action, `reset` returns to the task's start — refuses a
 * timeline that does not end in exactly the judged session (actions and every step hash), and
 * evaluates each public goal condition at the start and after every entry. The conditions are the
 * top-level clauses of the goal (`goal-1` …), the same split the Player and MCP show.
 *
 * This explains a verdict; it is never one. No runtime transition or adapter code is imported.
 */
import { canonicalJson, stateHash } from '../canonical/index.ts';
import { evaluate } from '../predicate/index.ts';
import { generateVariant } from '../world/variant.ts';
import { validateWorld } from '../world/schema.ts';
import type { Action, Predicate, State, World } from '../world/types.ts';
import { CheckerError } from './errors.ts';
import { checkerSuccessor, verifySessionHistory } from './replay.ts';
import { parseSession, validateSubmissionState } from './state.ts';

export const TRACE_SCHEMA = 'practonaut.condition-trace/1';
/** The most timeline entries one trace replays (the action budget is at most 10 000). */
export const MAX_TIMELINE = 20_000;
export type TraceEntry = { seq: number; op: 'act'; action: Action } | { seq: number; op: 'undo' | 'reset' };
export interface ConditionTrace {
  schema: typeof TRACE_SCHEMA; taskId: string; seed: number;
  /** Condition ids in goal order. */
  conditions: string[];
  /** One character per condition at the task's start: `1` met, `0` not met. */
  start: string;
  /** After each accepted mutation: its sequence number in the mutation log, the step and the conditions. */
  points: Array<{ seq: number; step: number; met: string }>;
}

/** The public conditions: the clauses of a top-level `all`, or the whole goal. */
export function goalClauses(goal: Predicate): Predicate[] { return goal.op === 'all' ? goal.args : [goal]; }

export function traceSession(world: World, input: string | Uint8Array, timeline: readonly TraceEntry[], options: { seed?: number; taskId?: string; fuel?: number } = {}): ConditionTrace {
  if (timeline.length > MAX_TIMELINE) throw new CheckerError('limit_exceeded', 'timeline is too long to trace');
  const session = parseSession(input, world);
  if (options.seed !== undefined && options.seed !== session.seed) throw new CheckerError('artifact_invalid', 'session seed/options mismatch');
  if (options.taskId !== undefined && options.taskId !== session.taskId) throw new CheckerError('artifact_invalid', 'session task/options mismatch');
  const validated = validateWorld(world), variant = generateVariant(validated, session.seed);
  const task = variant.tasks.find(candidate => candidate.id === session.taskId);
  if (!task) throw new CheckerError('artifact_invalid', 'session task is unknown');
  verifySessionHistory(variant, task, session);
  const era = variant.schema === 'practonaut.world/2' ? 2 : 1;
  const initial = validateSubmissionState(structuredClone(task.initialState ?? variant.initialState), era === 2 ? undefined : variant.app.fontFamilies, era);
  const clauses = goalClauses(task.goal), fuel = options.fuel ?? 1_000_000;
  const met = (state: State): string => clauses.map(clause => {
    const result = evaluate(clause, state, { fuel });
    if (!result.ok) throw new CheckerError(result.error.code, result.error.message, result.error.details);
    return result.value ? '1' : '0';
  }).join('');
  let stack: Array<{ action: Action; state: State }> = [];
  const current = (): State => stack.length ? stack[stack.length - 1]!.state : initial;
  const points: ConditionTrace['points'] = [];
  for (const entry of timeline) {
    if (entry.op === 'act') stack.push({ action: entry.action, state: checkerSuccessor(variant, current(), entry.action, session.seed, stack.map(item => item.action)) });
    else if (entry.op === 'undo') stack.pop();
    else stack = [];
    points.push({ seq: entry.seq, step: stack.length, met: met(current()) });
  }
  const same = stack.length === session.log.length && stack.every((item, index) => canonicalJson(item.action) === canonicalJson(session.log[index]!.action) && stateHash(item.state) === session.log[index]!.hash);
  if (!same || stateHash(current()) !== session.hash) throw new CheckerError('artifact_invalid', 'the mutation timeline does not end in the judged session');
  return { schema: TRACE_SCHEMA, taskId: session.taskId, seed: session.seed, conditions: clauses.map((_, index) => `goal-${index + 1}`), start: met(initial), points };
}
