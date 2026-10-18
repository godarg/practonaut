/**
 * The checker's own implementation of the structural constraints a world's application declares
 * (PADR-0049 decision 5.2). The list comes from the world table (data); the checks are written here
 * again, independently of `src/world/constraints.ts`, which the core and world validation use. A unit
 * test keeps both implementations equal on shared fixtures.
 */
import { structuralConstraintsOf } from "../world/apps.ts";
import type { State } from "../world/types.ts";
import { CheckerError } from "./errors.ts";

/** XML 1.0's character production, by code point. */
const xmlChar = (c: number): boolean => c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);

/** The name of the first declared constraint `state` breaks on its live objects, or null. */
export function brokenConstraint(state: State, declared: readonly string[]): { constraint: string; objectId: string } | null {
  const objects = Object.values(state.objects).filter(object => !object.deleted).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (declared.includes("group-within-one-frame")) {
    const firstFrame = new Map<string, string | null>();
    const spanning = new Set<string>();
    for (const object of objects) {
      if (object.type !== "step") continue;
      const group = (object as { groupId?: string | null }).groupId;
      if (group === undefined || group === null) continue;
      if (!firstFrame.has(group)) firstFrame.set(group, object.frameId);
      else if (firstFrame.get(group) !== object.frameId) spanning.add(group);
    }
    const group = [...spanning].sort()[0];
    if (group !== undefined) return { constraint: "group-within-one-frame", objectId: group };
  }
  if (declared.includes("xml-text")) {
    for (const object of objects) {
      const text = object.type === "frame" ? object.name : object.type === "step" ? object.label : "";
      for (let i = 0; i < text.length; i++) {
        const c = text.codePointAt(i)!;
        if (c > 0xffff) i++;
        if (!xmlChar(c)) return { constraint: "xml-text", objectId: object.id };
      }
    }
  }
  return null;
}

/** Refuses a state that the world's application cannot hold (`artifact_invalid`, reason `constraint`). */
export function refuseConstraintViolation(state: State, adapterId: string): void {
  const broken = brokenConstraint(state, structuralConstraintsOf(adapterId));
  if (broken) throw new CheckerError("artifact_invalid", `the application cannot hold this state (constraint ${broken.constraint}, object ${broken.objectId})`, { reason: "constraint", constraint: broken.constraint });
}
