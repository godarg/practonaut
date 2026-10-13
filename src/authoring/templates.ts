import { canonicalJson } from '../canonical/index.ts';
import type { ActionName, EffectKind, EvidenceRef, State, WorldObject } from '../world/types.ts';
import type { RuleTemplate } from './types.ts';

const equal = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** Complete successor comparison: a matching label alone never attests an effect. */
function matches(action: ActionName, before: State, after: State, removeArrows = false): boolean {
  // PADR-0015: inactive native tombstone bindings are not live relations. Compare
  // normalized copies only; raw recording snapshots, events and digests stay intact.
  before = normalizeInactiveArrowBindings(before); after = normalizeInactiveArrowBindings(after);
  const old = before.objects, next = after.objects;
  const added = Object.keys(next).filter(id => !Object.hasOwn(old, id));
  if (action === 'add_step' || action === 'connect') {
    if (added.length !== 1) return false;
    const object = next[added[0]!]!;
    if (object.deleted || object.type !== (action === 'add_step' ? 'step' : 'arrow')) return false;
    if (object.type === 'arrow' && (object.from === null || object.to === null)) return false;
    const expected = structuredClone(before); expected.objects[object.id] = object;
    return equal(expected, after);
  }
  if (added.length) return false;
  for (const object of Object.values(old)) {
    if (object.deleted) continue;
    const changed = next[object.id];
    if (!changed || changed.type !== object.type) continue;
    const expected = structuredClone(before);
    const target = expected.objects[object.id]!;
    if (object.type === 'step' && changed.type === 'step' && target.type === 'step') {
      if (action === 'rename_step' && object.label !== changed.label) target.label = changed.label;
      else if (action === 'move_step' && (object.x !== changed.x || object.y !== changed.y)) { target.x = changed.x; target.y = changed.y; }
      else if (action === 'delete_step' && changed.deleted) {
        target.deleted = true;
        for (const arrow of Object.values(expected.objects)) if (arrow.type === 'arrow' && !arrow.deleted && (arrow.from === object.id || arrow.to === object.id)) {
          if (removeArrows) { arrow.deleted = true; arrow.from = null; arrow.to = null; }
          else { if (arrow.from === object.id) arrow.from = null; if (arrow.to === object.id) arrow.to = null; }
        }
      } else continue;
    } else if (object.type === 'arrow' && changed.type === 'arrow' && target.type === 'arrow') {
      if (action === 'disconnect' && changed.deleted) { target.deleted = true; target.from = null; target.to = null; }
      else if (action === 'reconnect_end' && !changed.deleted) {
        const fromChanged = object.from !== changed.from, toChanged = object.to !== changed.to;
        if (fromChanged === toChanged || (fromChanged ? changed.from : changed.to) === null) continue;
        target.from = changed.from; target.to = changed.to;
      } else continue;
    } else continue;
    if (equal(expected, after)) return true;
  }
  return false;
}
export function normalizeInactiveArrowBindings(state: State): State {
  const copy = structuredClone(state);
  for (const object of Object.values(copy.objects)) if (object.type === 'arrow' && object.deleted) {
    object.from = null; object.to = null;
  }
  return copy;
}
function template(id: string, action: ActionName, effects: EffectKind[], en: string, de: string, remove = false): RuleTemplate {
  return { id, action, explanation: { en, de }, matches: (before, after) => matches(action, before, after, remove),
    rule: (evidence: EvidenceRef[]) => ({ id, action, status: 'confirmed', preconditions: [], effects, evidence }) };
}
export const RULE_TEMPLATES: readonly RuleTemplate[] = [
  template('create-step-v1', 'add_step', ['create_step'], 'Create one step and preserve the other objects.', 'Einen Schritt erstellen und die übrigen Objekte erhalten.'),
  template('rename-step-v1', 'rename_step', ['set_label'], 'Change only the step label.', 'Nur die Beschriftung des Schritts ändern.'),
  template('move-step-v1', 'move_step', ['set_position'], 'Move one step and retain its frame and connections.', 'Einen Schritt verschieben und Rahmen sowie Verbindungen erhalten.'),
  template('connect-v1', 'connect', ['create_arrow'], 'Create one arrow between two steps.', 'Einen Pfeil zwischen zwei Schritten erstellen.'),
  template('reconnect-v1', 'reconnect_end', ['set_endpoint'], 'Rebind one arrow end and preserve the other end.', 'Ein Pfeilende neu verbinden und das andere erhalten.'),
  template('disconnect-v1', 'disconnect', ['disconnect_arrow'], 'Remove one arrow; it no longer connects steps.', 'Einen Pfeil entfernen; er verbindet keine Schritte mehr.'),
  template('delete-keeps-arrows-v1', 'delete_step', ['tombstone_step', 'detach_incident_arrows'], 'Deleting a step leaves incident arrows loose.', 'Beim Löschen eines Schritts bleiben verbundene Pfeile lose erhalten.'),
  // This alternative is testable but has no executable effect in world/1. Never invent one.
  template('delete-removes-arrows-v1', 'delete_step', ['tombstone_step'], 'Deleting a step also removes incident arrows.', 'Beim Löschen eines Schritts werden verbundene Pfeile ebenfalls entfernt.', true),
];
/** Families of observations that may refute alternatives; unrelated actions are not counterexamples. */
export function observationAction(before: State, after: State): ActionName | undefined {
  const matched = RULE_TEMPLATES.find(t => t.matches(before, after));
  if (matched) return matched.action;
  const deletedStep = Object.values(before.objects).some(o => o.type === 'step' && !o.deleted && after.objects[o.id]?.deleted);
  return deletedStep ? 'delete_step' : undefined;
}
export function hasIncidentArrow(before: State, after: State): boolean {
  const deleted = Object.values(before.objects).find(o => o.type === 'step' && !o.deleted && after.objects[o.id]?.deleted);
  return !!deleted && Object.values(before.objects).some((o: WorldObject) => o.type === 'arrow' && !o.deleted && (o.from === deleted.id || o.to === deleted.id));
}
