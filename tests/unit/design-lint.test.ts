// Design lint: one generated red input per rule (rule id and line asserted), green inputs for
// every justified exception, the repository-level rules on a generated tree, and the CLI format.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { lintCss, lintTs, lintRepository, format, type Finding, type LintContext } from "../../tools/design-lint.ts";

const tokens = new Set(["--pn-color-text", "--pn-color-surface", "--pn-color-glass", "--pn-blur", "--pn-space-1", "--pn-space-2", "--pn-radius-md", "--pn-shadow-raised", "--pn-duration-fast", "--pn-ease-standard", "--pn-stroke-hairline", "--pn-focus-width", "--pn-text-body", "--pn-leading-body", "--pn-font-sans", "--pn-weight-medium", "--pn-tracking-body"]);
const cssContext: LintContext = { tokens, localVars: new Set(["--_bg"]) };
const tsContext = (): LintContext => ({ tokens, classes: new Set(["pn-btn", "pn-btn--primary", "card", "t-body", "is-open", "tray-chip--loose"]), icons: new Set(["plus", "check"]), hooks: new Map([["object-list", "test hook"]]), usedHooks: new Set() });

const errors = (findings: Finding[]): Finding[] => findings.filter(f => f.severity === "error");
/** Exactly one error with this rule on this line, and no other error. */
function redOnly(findings: Finding[], rule: string, line: number): void {
  const list = errors(findings);
  assert.deepEqual(list.map(f => `${f.line} ${f.rule}`), [`${line} ${rule}`], list.map(format).join("\n"));
}
/** At least these rules among the errors (a bypass may trip several rules at once). */
function redIncludes(findings: Finding[], rules: string[], line = 1): void {
  const list = errors(findings);
  for (const rule of rules) assert.ok(list.some(f => f.rule === rule && f.line === line), `missing ${rule} on line ${line}:\n${list.map(format).join("\n")}`);
}
const css = (body: string): Finding[] => lintCss(body, "/virtual/x.css", cssContext);
const ts = (body: string, context = tsContext()): Finding[] => lintTs(body, "/virtual/x.ts", context);

test("clean CSS built from tokens is green", () => {
  const findings = css(`.card {\n  padding: var(--pn-space-2) 0;\n  margin: calc(-1 * var(--pn-space-1)) auto;\n  gap: var(--pn-space-1);\n  border-radius: var(--pn-radius-md);\n  box-shadow: var(--pn-shadow-raised);\n  border: var(--pn-stroke-hairline) solid var(--pn-color-text);\n  outline: var(--pn-focus-width) solid transparent;\n  font: var(--pn-weight-medium) var(--pn-text-body) / var(--pn-leading-body) var(--pn-font-sans);\n  letter-spacing: var(--pn-tracking-body);\n  transition: background-color var(--pn-duration-fast) var(--pn-ease-standard);\n  color: currentColor; background: var(--_bg);\n  width: 12rem; min-height: 2.5rem; translate: 0 -50%; stroke-width: 2.5;\n}\n.spin { animation: pn-spin var(--pn-duration-fast) linear infinite; }\n`);
  assert.deepEqual(errors(findings).map(format), []);
});

test("color-literal: hex, rgb(), named and system colours outside forced-colors", () => {
  redOnly(css(".a { padding: 0; }\n.b { color: #1d1d1f; }\n"), "color-literal", 2);
  redOnly(css(".a { background: rgba(0, 0, 0, 0.5); }"), "color-literal", 1);
  redOnly(css(".a {\n  border-color: red;\n}"), "color-literal", 2);
  redOnly(css(".a { color: CanvasText; }"), "color-literal", 1);
  assert.deepEqual(errors(css("@media (forced-colors: active) { .a { color: CanvasText; background: Highlight; } }")), []);
  // A grid area named like a system colour is a name, not a colour.
  assert.deepEqual(errors(css(".a { grid-area: canvas; }")), []);
});

test("raw-type, raw-space, raw-radius, raw-shadow, raw-motion, raw-stroke", () => {
  redOnly(css(".a { font-size: 14px; }"), "raw-type", 1);
  redOnly(css(".a { font: var(--pn-weight-medium) var(--pn-text-body) / 1 var(--pn-font-sans); }"), "raw-type", 1);
  redOnly(css(".a { font-weight: 600; }"), "raw-type", 1);
  redOnly(css(".a { font-family: Arial; }"), "raw-type", 1);
  redOnly(css(".a { line-height: 1.4; }"), "raw-type", 1);
  redOnly(css(".a { margin-top: 0.0625rem; }"), "raw-space", 1);
  redOnly(css(".a { padding: var(--pn-space-2) 7px; }"), "raw-space", 1);
  redOnly(css(".a { gap: calc(var(--pn-space-1) + 3px); }"), "raw-space", 1);
  redIncludes(css(".a { padding: var(--pn-space-1, 4px); }"), ["raw-space", "var-fallback"]);
  redOnly(css(".a { border-radius: 7px; }"), "raw-radius", 1);
  redOnly(css(".a { box-shadow: 0 1px 2px var(--pn-color-text); }"), "raw-shadow", 1);
  redOnly(css(".a { transition: opacity 200ms var(--pn-ease-standard); }"), "raw-motion", 1);
  redOnly(css(".a { transition: opacity var(--pn-duration-fast) ease-in-out; }"), "raw-motion", 1);
  redOnly(css(".a { animation-timing-function: cubic-bezier(0.2, 0, 0, 1); }"), "raw-motion", 1);
  redOnly(css(".a { outline-width: 2px; }"), "raw-stroke", 1);
  redOnly(css(".a { border: thin solid var(--pn-color-text); }"), "raw-stroke", 1);
  redOnly(css(".a { border-bottom-width: 3px; }"), "raw-stroke", 1);
});

test("justified exceptions stay green: visually hidden margin, reduced-motion reset", () => {
  assert.deepEqual(errors(css(".sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; clip-path: inset(50%); }")), []);
  // Without the clip the same margin is spacing and is reported.
  redOnly(css(".x { width: 1px; height: 1px; margin: -1px; }"), "raw-space", 1);
  assert.deepEqual(errors(css("@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }")), []);
});

test("local-var-raw, unknown-token, unknown-local-var", () => {
  redOnly(css(".a { --_pad: 2px; }"), "local-var-raw", 1);
  assert.deepEqual(errors(css(".a { --_pad: calc(var(--pn-space-1) / 2); --_n: 3; }")), []);
  redOnly(css(".a { padding: var(--pn-space-99); }"), "unknown-token", 1);
  redOnly(css(".a { color: var(--_fg); }"), "unknown-local-var", 1);
});

test("data-uri, external-url, import", () => {
  redOnly(css(".a { background-image: url(\"data:image/png;base64,AAAA\"); }"), "data-uri", 1);
  redOnly(css(".a { background-image: url(https://example.com/x.png); }"), "external-url", 1);
  redOnly(css("@import \"https://example.com/x.css\";\n.a { padding: 0; }"), "import", 1);
  redOnly(css("@import url(./x.css);"), "import", 1);
});

test("important only in reduced motion and [hidden] rules", () => {
  redOnly(css(".a { display: none !important; }"), "important", 1);
  assert.deepEqual(errors(css("[hidden] { display: none !important; }\n.palette [hidden] { display: none !important; }")), []);
});

test("gradient and glass are reserved for their surfaces", () => {
  redOnly(css(".hero { background: linear-gradient(90deg, var(--pn-color-text), var(--pn-color-surface)); }"), "gradient", 1);
  assert.deepEqual(errors(css(".pn-skeleton { background: linear-gradient(90deg, var(--pn-color-text), var(--pn-color-surface)); }")), []);
  assert.deepEqual(errors(css(".scroller { mask-image: linear-gradient(to bottom, var(--pn-color-text), transparent); }")), []);
  redOnly(css(".card { backdrop-filter: blur(var(--pn-blur)); }"), "glass", 1);
  redOnly(css(".card { background: var(--pn-color-glass); }"), "glass", 1);
  assert.deepEqual(errors(css(".pn-floating { background: var(--pn-color-glass); backdrop-filter: blur(var(--pn-blur)); }")), []);
});

test("clean TS built from the kit is green", () => {
  const findings = ts(`// innerHTML in a comment is fine
const SVG_NS = 'http://www.w3.org/2000/svg';
const a = h('div', { class: 'card t-body', vars: { '--_i': 2 } }, icon('plus'));
a.classList.toggle('is-open', true);
node.style.setProperty('--_x', '1');
const tone = 'x' === 'neutral' ? 'card' : 'pn-btn';
const b = button({ icon: 'check', class: kind === 'pass' ? 'pn-btn--primary' : 'card' });
const scene = { strokeColor: '#1e1e1e', backgroundColor: 'transparent' };
const re = /#fff/g; const line = 'data:';
const lists = 'tray-list object-list';
`);
  assert.deepEqual(errors(findings).map(format), []);
});

test("unsafe-html and eval", () => {
  redOnly(ts("const a = 1;\nnode.innerHTML = text;"), "unsafe-html", 2);
  redOnly(ts("node['outerHTML'] = text;"), "unsafe-html", 1);
  redOnly(ts("node.insertAdjacentHTML('beforeend', text);"), "unsafe-html", 1);
  redOnly(ts("document.write(text);"), "unsafe-html", 1);
  redOnly(ts("eval(code);"), "eval", 1);
  redOnly(ts("const f = new Function('return 1');"), "eval", 1);
  redOnly(ts("setTimeout('run()', 10);"), "eval", 1);
});

test("inline-style", () => {
  redOnly(ts("node.setAttribute('style', 'color: x');"), "inline-style", 1);
  redOnly(ts("node.style.cssText = value;"), "inline-style", 1);
  redOnly(ts("node.style.width = value;"), "inline-style", 1);
  redOnly(ts("node.style.setProperty('padding', value);"), "inline-style", 1);
  redOnly(ts("h('div', { vars: { padding: value } });"), "inline-style", 1);
  redOnly(ts("h('div', { attrs: { style: 'margin: 0' } });"), "inline-style", 1);
  redOnly(ts("document.createElement('style');"), "inline-style", 1);
});

test("color-literal, data-uri, external-url and unknown-token in code", () => {
  redOnly(ts("const fill = '#ff0000';"), "color-literal", 1);
  redOnly(ts("const fill = 'rgb(0, 0, 0)';"), "color-literal", 1);
  redOnly(ts("const fill = 'tomato';"), "color-literal", 1);
  redOnly(ts("img.src = 'data:image/png;base64,AAAA';"), "data-uri", 1);
  redOnly(ts("fetch('https://example.com/api');"), "external-url", 1);
  redOnly(ts("const c = 'var(--pn-color-nope)';"), "unknown-token", 1);
  assert.deepEqual(errors(ts("const c = `var(--pn-color-${name})`;")), []);
});

test("class registry: literals, templates, helpers, BEM strings, type roles", () => {
  redOnly(ts("h('div', { class: 'card ghost' });"), "unknown-class", 1);
  redOnly(ts("node.classList.add('ghost');"), "unknown-class", 1);
  redOnly(ts("node.className = 'ghost';"), "unknown-class", 1);
  redOnly(ts("h('div', { class: `ghost--${variant}` });"), "unknown-class", 1);
  redOnly(ts("h('div', { class: `card${on ? ' ghost' : ''}` });"), "unknown-class", 1);
  redOnly(ts("function node(tag, text = '', cls = '') { const n = document.createElement(tag); n.className = cls; return n; }\nnode('div', '', 'card');\nnode('p', '', 'ghost');"), "unknown-class", 3);
  redOnly(ts("const loose = 'tray-chip--ghost';"), "unknown-class", 1);
  redOnly(ts("h('p', { class: 't-bodyy' });"), "unknown-type-role", 1);
  // A hook class needs no CSS rule; a local variable with the same name as a helper parameter
  // elsewhere is not forwarded.
  assert.deepEqual(errors(ts("h('div', { class: 'object-list' });\nfunction pick(kind) { go(kind); }\npick('ghost');\nfunction card2() { const kind = 'x'; return h('div', { class: `card ${kind}` }); }")), []);
  const warnings = ts("function card2() { const kind = 'x'; return h('div', { class: `card ${kind}` }); }").filter(f => f.severity === "warning");
  assert.deepEqual(warnings.map(f => f.rule), ["dynamic-class"]);
});

test("unknown-icon and local-var-raw in code", () => {
  redOnly(ts("icon('ghost');"), "unknown-icon", 1);
  redOnly(ts("button({ label: 'x', icon: 'ghost' });"), "unknown-icon", 1);
  redOnly(ts("const g: IconName = ok === 'pass' ? 'check' : 'ghost';"), "unknown-icon", 1);
  redOnly(ts("h('div', { vars: { '--_pad': '2px' } });"), "local-var-raw", 1);
});

test("repository rules: setup, stale-hook, unused-token, orphan-css on a generated tree", () => {
  const root = mkdtempSync(join(tmpdir(), "pn-design-lint-"));
  try {
    const put = (path: string, text: string): void => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
    const many = Array.from({ length: 24 }, (_, i) => `  --pn-space-${i + 1}: ${i + 1}px;`).join("\n");
    put("design/tokens.css", `:root {\n${many}\n  --pn-color-text: #111111;\n}\n`);
    put("src/player/ui/icons.ts", "export const iconMarkup = {\n" + Array.from({ length: 12 }, (_, i) => `  i${i}: '<path d="M0 0"/>',`).join("\n") + "\n} as const;\n");
    put("src/player/player.css", "@import \"./css/base.css\";\n");
    put("src/player/css/base.css", ".card { padding: var(--pn-space-1); color: var(--pn-color-text); }\n");
    put("src/player/css/stray.css", ".stray { padding: 0; }\n");
    put("src/player/gallery/entry.css", "@import \"../player.css\";\n@import \"./gallery.css\";\n");
    put("src/player/gallery/gallery.css", ".gallery { padding: 0; }\n");
    put("src/player/main.ts", "h('div', { class: 'card' }, icon('i1'));\n");
    const run = lintRepository(root);
    const rules = run.findings.map(f => `${f.severity} ${f.rule}`);
    // object-list (the only hook) is not used in this tree.
    assert.ok(rules.includes("error stale-hook"), rules.join("\n"));
    assert.ok(run.findings.some(f => f.rule === "unused-token" && /--pn-space-2 /.test(f.message)));
    assert.ok(run.findings.some(f => f.rule === "orphan-css" && f.file === "src/player/css/stray.css"));
    assert.ok(!run.findings.some(f => f.rule === "setup"));
    // An empty vocabulary fails closed instead of passing every membership check.
    put("design/tokens.css", ":root { --pn-space-1: 4px; }\n");
    assert.ok(lintRepository(root).findings.some(f => f.rule === "setup" && f.severity === "error"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bypasses found by the r2 audit are closed (CSS)", () => {
  // Chain through a custom property that is neither a token nor local.
  redIncludes(css(".a { --raw: 7px; }"), ["foreign-var"]);
  redIncludes(css(".a { --_pad: var(--raw); }"), ["foreign-var"]);
  redIncludes(css(".a { --pn-space-1: 7px; }"), ["foreign-var"]);
  // Escapes hide a named colour.
  redOnly(css(".a { color: r\\65 d; }"), "css-escape", 1);
  assert.deepEqual(errors(css(".a::before { content: \"\\201C\"; }")), []);
  // Only @media (prefers-reduced-motion: reduce) exempts raw motion and !important.
  redOnly(css("@media (prefers-reduced-motion: no-preference) { .a { transition-duration: 333ms; } }"), "raw-motion", 1);
  redOnly(css("@media not (prefers-reduced-motion: reduce) { .a { transition-duration: 333ms; } }"), "raw-motion", 1);
  redOnly(css("@supports (prefers-reduced-motion: reduce) { .a { transition-duration: 333ms; } }"), "raw-motion", 1);
  redOnly(css("@media (prefers-reduced-motion: no-preference) { .a { display: none !important; } }"), "important", 1);
  // Only @media (forced-colors: active) allows system colours.
  redOnly(css("@supports (forced-colors: active) { .a { color: CanvasText; } }"), "color-literal", 1);
  redOnly(css("@media not (forced-colors: active) { .a { color: CanvasText; } }"), "color-literal", 1);
  // Declarations inside @supports are linted like any other.
  redOnly(css("@supports (display: grid) { .a { padding: 7px; } }"), "raw-space", 1);
  // Fallbacks: the fallback is a raw value in disguise, and its colour is still seen.
  redIncludes(css(".a { color: var(--x, red); }"), ["foreign-var", "var-fallback", "color-literal"]);
  redIncludes(css(".a { color: var(--x, rgb(255 0 0)); }"), ["foreign-var", "var-fallback", "color-literal"]);
  redIncludes(css(".a { color: var(--pn-color-text, #ff0000); }"), ["var-fallback", "color-literal"]);
  // color-mix with literals.
  redOnly(css(".a { background: color-mix(in srgb, red, var(--pn-color-surface)); }"), "color-literal", 1);
  redOnly(css(".a { --_bg: color-mix(in srgb, rgb(0 0 0), var(--pn-color-surface) 20%); }"), "color-literal", 1);
  assert.deepEqual(errors(css(".a { background: color-mix(in srgb, var(--pn-color-surface), var(--pn-color-text) 10%); }")), []);
});

test("bypasses found by the r2 audit are closed (TS)", () => {
  redOnly(ts("node.style['padding'] = '7px';"), "inline-style", 1);
  redOnly(ts("node.style[name] = value;"), "inline-style", 1);
  redOnly(ts("node.style.setProperty('--_pad', '7px');"), "local-var-raw", 1);
  redIncludes(ts("node.style.setProperty('--_c', '#ff0000');"), ["local-var-raw", "color-literal"]);
  redOnly(ts("node.style.setProperty('--pn-space-1', value);"), "inline-style", 1);
  assert.deepEqual(errors(ts("node.style.setProperty('--_elapsed', '0ms'); h('i', { vars: { '--_elapsed': `${ms}ms` } });")), []);
  redIncludes(ts("const c = 'color-mix(in srgb, rgb(255 0 0) 50%, white)';"), ["color-literal"]);
  redOnly(ts("const c = 'color-mix(in srgb, white, var(--pn-color-text))';"), "color-literal", 1);
  assert.deepEqual(errors(ts("const c = 'color-mix(in srgb, var(--pn-color-surface), var(--pn-color-text) 10%)';")), []);
  // SVG paint written from code.
  redOnly(ts("svg('rect', { fill: 'red' });"), "color-literal", 1);
  redOnly(ts("svg('rect', { 'flood-color': 'tomatoe' });"), "color-literal", 1);
  redOnly(ts("node.setAttribute('stroke', '#123456');"), "color-literal", 1);
  redOnly(ts("const m = '<path fill=\"red\" d=\"M0 0\"/>';"), "color-literal", 1);
  redOnly(ts("svg('rect', { fill: 'var(--pn-color-nope)' });"), "unknown-token", 1);
  assert.deepEqual(errors(ts("svg('rect', { fill: 'none', stroke: 'currentColor', 'stop-color': 'var(--pn-color-text)' }); node.setAttribute('fill', 'url(#dots)'); const m = '<circle fill=\"currentColor\" stroke=\"none\"/>';")), []);
});

test("bench report profile: report.css and the report renderer follow the same rules; a markup writer outside the profile fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "pn-design-lint-report-"));
  try {
    const put = (path: string, text: string): void => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
    const many = Array.from({ length: 24 }, (_, i) => `  --pn-space-${i + 1}: ${i + 1}px;`).join("\n");
    put("design/tokens.css", `:root {\n${many}\n  --pn-color-text: #111111;\n}\n`);
    put("src/player/ui/icons.ts", "export const iconMarkup = {\n" + Array.from({ length: 12 }, (_, i) => `  i${i}: '<path d="M0 0"/>',`).join("\n") + "\n} as const;\n");
    put("src/player/player.css", "@import \"./css/base.css\";\n");
    put("src/player/css/base.css", ".card { padding: var(--pn-space-1); color: var(--pn-color-text); }\n");
    put("src/player/gallery/entry.css", "@import \"../player.css\";\n");
    put("src/player/main.ts", "h('div', { class: 'card object-list consequence' }, icon('i1'));\n");
    put("src/bench/report.css", ".page { padding: var(--pn-space-2); color: var(--pn-color-text); }\n.bad { margin: 7px; color: red; }\n");
    put("src/bench/render.ts", "export const page = (x: string): string => `<main class=\"page\"><p class=\"missing\">${x}</p></main>`;\nexport const tint = '#ff0000';\n");
    put("src/bench/elsewhere.ts", "export const sneaky = '<p class=\"page\">';\n");
    const findings = lintRepository(root).findings.filter(f => f.severity === "error").map(f => `${f.file} ${f.rule}`);
    assert.ok(findings.includes("src/bench/report.css raw-space"), findings.join("\n"));
    assert.ok(findings.includes("src/bench/report.css color-literal"));
    assert.ok(findings.includes("src/bench/render.ts unknown-class"), "a class the report stylesheet does not define");
    assert.ok(findings.includes("src/bench/render.ts color-literal"));
    assert.ok(findings.includes("src/bench/elsewhere.ts setup"), "markup outside REPORT_SOURCES is not silently skipped");
    assert.ok(!findings.some(f => f.startsWith("src/bench/report.css orphan-css")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI prints file:line rule message and exits 1 on an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "pn-design-lint-cli-"));
  try {
    const file = join(dir, "bad.css");
    writeFileSync(file, ".ok { padding: 0; }\n.bad { border-radius: 7px; }\n");
    const run = spawnSync(process.execPath, ["tools/design-lint.ts", file], { encoding: "utf8" });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stderr, /bad\.css:2 raw-radius border-radius: raw value 7px/);
    writeFileSync(file, ".ok { padding: 0; border-radius: var(--pn-radius-md); }\n");
    const green = spawnSync(process.execPath, ["tools/design-lint.ts", file], { encoding: "utf8" });
    assert.equal(green.status, 0, green.stdout + green.stderr);
    assert.match(green.stdout, /design:lint: 1 files, 0 error\(s\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
