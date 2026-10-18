/**
 * Structural constraints an application imposes on the states it can hold (PADR-0049 decision 1.2).
 * The world table (`apps.ts`) declares them per application as data; world validation, the core and
 * the adapters check them with this pure function and never decide one by an adapter id. The checker
 * has its own implementation (`src/checker/constraints.ts`); a unit test keeps both equal.
 */
import type { State, StepV2 } from "./types.ts";

/** The closed list. A new constraint is a code change with a record. */
export const STRUCTURAL_CONSTRAINTS = Object.freeze(["group-within-one-frame", "xml-text"] as const);
export type StructuralConstraint = typeof STRUCTURAL_CONSTRAINTS[number];
export interface ConstraintViolation { constraint: StructuralConstraint; objectId: string; message: string }

/** True when every character of `value` is an XML 1.0 Char: tab, LF, CR, U+0020–U+D7FF,
 * U+E000–U+FFFD, U+10000–U+10FFFF (a lone surrogate is none of them). */
export function isXmlText(value: string): boolean {
  for (const char of value) {
    const c = char.codePointAt(0)!;
    if (!(c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff))) return false;
  }
  return true;
}

const byId = (state: State) => Object.keys(state.objects).sort().map(id => state.objects[id]!);

/**
 * The first declared constraint `state` violates, on its live objects (the only ones an application
 * holds), or null. Deterministic: constraints in the closed list's order, objects by id.
 */
export function constraintViolation(state: State, constraints: readonly StructuralConstraint[]): ConstraintViolation | null {
  const live = byId(state).filter(object => !object.deleted);
  for (const constraint of STRUCTURAL_CONSTRAINTS) {
    if (!constraints.includes(constraint)) continue;
    if (constraint === "group-within-one-frame") {
      const frames = new Map<string, Set<string | null>>();
      for (const object of live) {
        if (object.type !== "step" || !Object.hasOwn(object, "groupId")) continue;
        const step = object as StepV2;
        if (step.groupId === null) continue;
        frames.set(step.groupId, (frames.get(step.groupId) ?? new Set()).add(step.frameId));
      }
      for (const group of [...frames.keys()].sort()) {
        if (frames.get(group)!.size > 1) return { constraint, objectId: group, message: `On this application a group stays within one frame: the steps of group ${group} sit in different frames. Ungroup them, move the steps, then group them again.` };
      }
    } else {
      for (const object of live) {
        const text = object.type === "frame" ? object.name : object.type === "step" ? object.label : "";
        if (!isXmlText(text)) return { constraint, objectId: object.id, message: `This application cannot store a character of the ${object.type === "frame" ? "frame name" : "label"} of ${object.id} (a control character or a noncharacter).` };
      }
    }
  }
  return null;
}
