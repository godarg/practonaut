/**
 * The agent-facing reply shapes (PADR-0038). The host keeps one public view for the Player and the
 * bridge; these functions only select and localise parts of it, so an agent never sees anything a
 * view would not show. `observe` is compact by default: the task with its goal conditions, the live
 * objects, step and revision, the last few history items, the last check and the current error
 * explanations. Mutations answer with what changed. Goal conditions keep their sentence and their
 * formal form in every `observe` and `check_result`, in the chosen language, exactly as the Player
 * shows them.
 */
import type { Actor, HostView, MutationDeltaReply, PublicCheck } from '../host/protocol.ts';
import type { Localized, State } from '../world/types.ts';

export const LANGS = ['en', 'de', 'both'] as const;
export type Lang = typeof LANGS[number];
/** A localised text in the chosen language, or both texts. */
export type Text = string | Localized;
export const HISTORY_DEFAULT = 5;

function isLocalized(value: unknown): value is Localized {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes('en') && keys.includes('de') && typeof (value as Localized).en === 'string' && typeof (value as Localized).de === 'string';
}
/** Replaces every `{en, de}` text in a JSON value by the chosen language (`both` keeps both). */
export function localize<T>(value: T, lang: Lang): T {
  if (lang === 'both') return structuredClone(value);
  const walk = (node: unknown): unknown => {
    if (isLocalized(node)) return node[lang];
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    return node;
  };
  return walk(value) as T;
}

export interface CompactCondition { id: string; text: Text; formalText?: Text }
export interface CompactView {
  task: { id: string; title: Text; prompt: Text; conditions: CompactCondition[]; hintCount: number };
  /** Live objects only; deleted objects (tombstones) are left out. */
  state: { objects: State['objects'] };
  step: number; revision: number;
  mirror: { mode: HostView['mirror']; status: HostView['mirrorHealth']['status'] }; practiceEvidence: boolean;
  history: { total: number; recent: Array<{ step: number; actor: Actor; description: Text; mirrorConfirmed: boolean }> };
  /** The last check of this revision, by condition id (the texts are in `task.conditions`). */
  result: { revision: number; passed: boolean; conditions: Array<{ id: string; met: boolean }> } | null;
  errors: Array<{ id: string; explanation: Text }>;
  hints: Text[]; attempt: number;
}

export function compactView(view: HostView, lang: Lang, history = HISTORY_DEFAULT): CompactView {
  const live = Object.fromEntries(Object.entries(view.state.objects).filter(([, object]) => !object.deleted));
  return localize({
    task: { id: view.task.id, title: view.task.title, prompt: view.task.prompt, conditions: view.task.conditions, hintCount: view.task.hintCount },
    state: { objects: live },
    step: view.step, revision: view.revision,
    mirror: { mode: view.mirror, status: view.mirrorHealth.status }, practiceEvidence: view.practiceEvidence,
    history: { total: view.history.length, recent: (history > 0 ? view.history.slice(-history) : []).map(item => ({ step: item.step, actor: item.actor, description: item.description, mirrorConfirmed: item.mirrorConfirmed })) },
    result: view.result ? { revision: view.result.revision, passed: view.result.passed, conditions: view.result.conditions.map(({ id, met }) => ({ id, met })) } : null,
    errors: view.errors, hints: view.hints, attempt: view.attempt,
  }, lang) as CompactView;
}

/** The whole public view in the chosen language; `both` is the view itself. */
export function fullView(view: HostView, lang: Lang): HostView { return localize(view, lang); }

export interface MutationResult {
  step: number; revision: number;
  /** Objects that differ after the change, as they are now; a deleted object has `deleted: true`. */
  changed: State['objects']; created: string[]; removed: string[];
  effects: Array<{ kind: string; id: string }>;
  errors: Array<{ id: string; explanation: Text }>;
  /** The changed objects were too large to send; call observe for the board. */
  changedOmitted?: true;
  mirrorConfirmed: boolean; latencyMs: number;
}
export function mutationResult(reply: MutationDeltaReply, lang: Lang): MutationResult {
  const { delta } = reply;
  return localize({ step: delta.step, revision: delta.revision, changed: delta.changed, created: delta.created, removed: delta.removed, effects: delta.effects, errors: delta.errors, ...(delta.changedOmitted ? { changedOmitted: true } : {}), mirrorConfirmed: reply.mirrorConfirmed, latencyMs: reply.latencyMs }, lang) as MutationResult;
}

export function checkResult(check: PublicCheck, lang: Lang): PublicCheck { return localize(check, lang); }
