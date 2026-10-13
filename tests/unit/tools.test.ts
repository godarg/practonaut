// Repository tools: contrast math, token parsing, Markdown link extraction.
// Contrast oracles: 21:1 for black on white is the WCAG maximum by definition; #777777 on white
// is 4.48:1 per the WebAIM contrast checker (documented reference value, retrieved 2026-10-03).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { compareDarkBlocks, contrastRatio, parsePairs, parseTokens } from "../../tools/check-contrast.ts";
import { extractLinks, isExternal } from "../../tools/check-docs.ts";

describe("contrast", () => {
  it("matches reference values", () => {
    assert.equal(contrastRatio("#000000", "#FFFFFF").toFixed(2), "21.00");
    assert.equal(contrastRatio("#777777", "#ffffff").toFixed(2), "4.48");
    assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  });

  it("refuses colours with alpha (no backdrop to composite on)", () => {
    assert.throws(() => contrastRatio("#00000099", "#ffffff"), /opaque/);
  });

  it("parses all §7.2 pairs from the design language and checks pair-count annotations", () => {
    const md = readFileSync(new URL("../../docs/design/design-language.md", import.meta.url), "utf8");
    const pairs = parsePairs(md);
    assert.equal(pairs.filter((p) => p.target === 4.5).length > 0, true);
    assert.equal(pairs.filter((p) => p.target === 3).length > 0, true);
    assert.equal(pairs.filter((p) => p.id === "T1").length, 13);
    assert.equal(pairs.filter((p) => p.id === "U4").length, 6);
    const broken = md.replace("| T3 | text-on-accent | accent, accent-hover, accent-pressed, danger-solid, danger-solid-hover (five pairs) |", "| T3 | text-on-accent | accent, accent-hover, accent-pressed, danger-solid (five pairs) |");
    assert.throws(() => parsePairs(broken), /annotation says 5 pairs/);
  });

  it("detects a difference between the two dark blocks", () => {
    const css = readFileSync(new URL("../../design/tokens.css", import.meta.url), "utf8");
    assert.deepEqual(compareDarkBlocks(parseTokens(css)), []);
    const original = "--pn-color-canvas: #1C1C1E;";
    const lastCanvas = css.lastIndexOf(original);
    assert.ok(lastCanvas > 0, "the tampering target must exist in the last (explicit dark) block");
    const tampered = css.slice(0, lastCanvas) + "--pn-color-canvas: #1C1C1F;" + css.slice(lastCanvas + original.length);
    const problems = compareDarkBlocks(parseTokens(tampered));
    assert.equal(problems.length, 1);
    assert.match(problems[0] as string, /canvas/);
  });
});

describe("markdown links", () => {
  it("extracts inline and reference links, skipping code", () => {
    const md = ["See [a](docs/a.md) and ![img](x.png \"t\").", "```", "[not](skipped.md)", "```", "Inline `[code](no.md)` text.", "[ref]: ../b.md#part"].join("\n");
    assert.deepEqual(extractLinks(md).map((l) => l.target), ["docs/a.md", "x.png", "../b.md#part"]);
  });

  it("treats URLs and anchors as external", () => {
    assert.ok(isExternal("https://example.org"));
    assert.ok(isExternal("mailto:a@b.c"));
    assert.ok(isExternal("#section"));
    assert.ok(!isExternal("docs/x.md"));
  });
});
