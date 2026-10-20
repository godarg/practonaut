/**
 * The structure of layout clauses (PADR-0047 decisions 1.2 and 2): where a layout operator may stand
 * in a predicate and the three closed selection shapes. Pure and shared by world validation and the
 * evaluator, so both refuse the same predicates. No geometry here: that is `src/predicate/layout.ts`.
 */
import { isLayoutPredicate, type LayoutOp, type LayoutPredicate, type Predicate, type Selection, type Value } from "./types.ts";

/** What a selection selects: every live object of its type, those outside every frame, or those in a
 * live frame with this name. A tagged value, so a frame named "all" is never read as every object. */
export type SelectionScope = { kind: "all" } | { kind: "outside" } | { kind: "frame"; name: string };

/** The fewest objects each operator's selections may require (decision 2): every operator is about
 * something by construction. `arrowsClearOfSteps` requires 1 arrow and 1 step. */
export const LAYOUT_MIN_COUNT: Readonly<Record<LayoutOp, number>> = Object.freeze({ noOverlap: 2, aligned: 2, evenlySpaced: 3, within: 1, arrowsNoCrossing: 2, arrowsClearOfSteps: 1 });

/** The selections of a layout clause in their order (the arrows first, then the steps). */
export const selectionsOf = (p: LayoutPredicate): Selection[] => p.op === "arrowsClearOfSteps" ? [p.select, p.steps] : [p.select];

const isField = (v: Value, variable: string, field: string): boolean => v.kind === "field" && v.variable === variable && v.field === field;
/**
 * The scope of a selection when its `where` has one of the three shapes, else undefined:
 * `true`; `as.frameId = null`; or the multiset's own frame clause
 * `exists frame f: f.id = as.frameId and f.name = "<name>"` (f another variable than `as`).
 */
export function selectionScope(selection: Selection): SelectionScope | undefined {
  const { where, as } = selection;
  if (where.op === "true") return { kind: "all" };
  if (where.op === "eq" && isField(where.left, as, "frameId") && where.right.kind === "literal" && where.right.value === null) return { kind: "outside" };
  if (where.op === "exists" && where.type === "frame" && where.as !== as && where.where.op === "all" && where.where.args.length === 2) {
    const [id, name] = where.where.args as [Predicate, Predicate];
    if (id.op === "eq" && isField(id.left, where.as, "id") && isField(id.right, as, "frameId")
      && name.op === "eq" && isField(name.left, where.as, "name") && name.right.kind === "literal" && typeof name.right.value === "string") return { kind: "frame", name: name.right.value };
  }
  return undefined;
}

/** Where a layout clause may stand: a task's goal or a direct argument of its top-level `all`
 * (`goal`), an error class's `when` directly or under one `not` (`when`), either of the two
 * (`evaluate`: what the evaluator accepts at its root), or nowhere (`none`: action and rule
 * preconditions). */
export type LayoutPlace = "goal" | "when" | "evaluate" | "none";

/** The first problem with the layout clauses of `p` at `place`, or undefined: a layout operator in a
 * place decision 1.2 forbids, or a selection whose `where` is not one of the three shapes. */
export function layoutProblem(p: Predicate, place: LayoutPlace): string | undefined {
  const visit = (node: Predicate, allowed: boolean, children: boolean): string | undefined => {
    if (isLayoutPredicate(node)) {
      if (!allowed) return `layout operator ${node.op} may stand only as a top-level goal clause or an error class condition (directly or under one not)`;
      for (const selection of selectionsOf(node)) {
        if (!selectionScope(selection)) return `the ${selection.type} selection of ${node.op} must select everything, outside every frame, or in the frame with a given name (PADR-0047 decision 2)`;
      }
      return undefined;
    }
    const value = (v: Value): string | undefined => v.kind === "count" ? visit(v.where, false, false) : undefined;
    switch (node.op) {
      case "true": case "false": return undefined;
      case "all": case "any": {
        for (const arg of node.args) { const found = visit(arg, children && node.op === "all" && (place === "goal" || place === "evaluate"), false); if (found) return found; }
        return undefined;
      }
      case "not": return visit(node.arg, children && (place === "when" || place === "evaluate"), false);
      case "exists": case "every": return visit(node.where, false, false);
      case "eq": case "lt": case "lte": case "gt": case "gte": case "near": case "contains": case "startsWith": return value(node.left) ?? value(node.right);
    }
  };
  return visit(p, place !== "none", true);
}
