// The miniature is display only, but it must never drop an arrow or draw a self-loop as a stray
// stub: an author reviews recorded changes through it. A minimal DOM stand-in lets the real
// factory run under node; the assertions read the SVG it builds.
import assert from "node:assert/strict";
import { test } from "node:test";

class Stub {
  attrs = new Map<string, string>();
  children: Array<Stub | string> = [];
  dataset: Record<string, string> = {};
  style = { setProperty: (): void => undefined };
  className = "";
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  set textContent(value: string) { this.children = [String(value)]; }
  get textContent(): string { return this.children.map(c => typeof c === "string" ? c : c.textContent).join(""); }
  setAttribute(name: string, value: string): void { this.attrs.set(name, String(value)); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  append(...nodes: Array<Stub | string>): void { this.children.push(...nodes); }
  addEventListener(): void { /* not needed */ }
  getContext(): null { return null; } // no canvas under node: the factory falls back to its width estimate
  all(tag: string): Stub[] { const out: Stub[] = []; for (const c of this.children) if (typeof c !== "string") { if (c.tag === tag) out.push(c); out.push(...c.all(tag)); } return out; }
}
(globalThis as unknown as { document: unknown }).document = {
  documentElement: new Stub("html"),
  createElement: (tag: string) => new Stub(tag),
  createElementNS: (_ns: string, tag: string) => new Stub(tag),
};
(globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle = () => ({ getPropertyValue: () => "" });
const { miniature } = await import("../../src/player/ui/miniature.ts");
type Graph = Parameters<typeof miniature>[0];

const svgOf = (graph: Graph, options: Partial<Parameters<typeof miniature>[1]> = {}): Stub => (miniature(graph, { label: "drawing", ...options }) as unknown as Stub).all("svg")[0]!;
const edges = (svg: Stub): Stub[] => svg.all("path").filter(p => /pn-mini__edge/.test(p.getAttribute("class") ?? ""));
const rings = (svg: Stub): Stub[] => svg.all("circle").filter(c => /pn-mini__loose/.test(c.getAttribute("class") ?? ""));
const heads = (svg: Stub): Stub[] => svg.all("path").filter(p => /pn-mini__head/.test(p.getAttribute("class") ?? ""));
const steps = [{ id: "a", label: "Collect draft", y: 0 }, { id: "b", label: "Review draft", y: 1 }];

test("an arrow with both ends loose and no known place is still drawn, with a ring at each end", () => {
  const svg = svgOf({ steps, arrows: [{ id: "free", from: null, to: null }] });
  assert.equal(edges(svg).length, 1, "the free arrow must not disappear");
  assert.equal(rings(svg).length, 2);
  assert.equal(heads(svg).length, 0, "no head points at nothing");
});

test("a self-loop is a curve that leaves and re-enters the same step, with a head and no loose ring", () => {
  const svg = svgOf({ steps, arrows: [{ id: "loop", from: "a", to: "a" }] });
  const [edge] = edges(svg);
  assert.ok(edge, "the loop is drawn");
  assert.match(edge.getAttribute("d") ?? "", /C/, "a loop is a curve, not a straight stub");
  assert.equal(heads(svg).length, 1);
  assert.equal(rings(svg).length, 0);
});

test("an arrow the result no longer has is drawn dashed at its former place, without loose-end rings", () => {
  const svg = svgOf({ steps: [steps[0]!, { id: "c", label: "Publish draft", y: 2 }], arrows: [{ id: "a1", from: "a", to: "c" }, { id: "b1", from: "b", to: "c", ghost: true }] }, { slots: ["a", "b", "c"], changed: new Set(["a1"]) });
  const [kept, gone] = edges(svg);
  assert.match(kept?.getAttribute("class") ?? "", /pn-mini__edge--changed/);
  assert.match(gone?.getAttribute("class") ?? "", /pn-mini__edge--removed/);
  assert.equal(rings(svg).length, 0, "a removed arrow is not a loose arrow");
});

test("every arrow of a mixed graph is drawn, and every step keeps its label", () => {
  const graph: Graph = { steps: [...steps, { id: "c", label: "Publish draft", y: 2 }], arrows: [
    { id: "ab", from: "a", to: "b" }, { id: "bc", from: "b", to: "c" }, { id: "ac", from: "a", to: "c" },
    { id: "loose", from: "c", to: null }, { id: "free", from: null, to: null }, { id: "self", from: "b", to: "b" }] };
  const svg = svgOf(graph);
  assert.equal(edges(svg).length, graph.arrows.length);
  assert.deepEqual(svg.all("text").map(t => t.textContent).filter(Boolean).sort(), ["Collect draft", "Publish draft", "Review draft"]);
  assert.equal(svg.getAttribute("aria-label"), "drawing");
});
