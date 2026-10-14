// Design lint: mechanical guardrails for docs/design/design-language.md (§6 tokens, §8, §13).
//
// CSS (every file under src/player/, tokens live in design/tokens.css and are not linted here):
//   color-literal      no hex, rgb()/hsl()/hwb()/lab()/lch()/oklch()/oklab()/color(), no named colours;
//                      system colours (Canvas, CanvasText, Highlight, ...) only inside
//                      @media (forced-colors: active)
//   raw-type           font-size, font, line-height, letter-spacing, font-weight, font-family
//   raw-space          padding*, margin*, gap, row-gap, column-gap
//   raw-radius         border-radius and its longhands
//   raw-shadow         box-shadow
//   raw-motion         transition*, animation, animation-duration, animation-timing-function
//   raw-stroke         outline, outline-width, outline-offset, border(-side) and border-*-width
//                      -> only var(--pn-...), 0, auto/none/normal/inherit-style keywords, and
//                         calc()/min()/max()/clamp() built from tokens, 0, percentages and
//                         unit-free factors. Geometry (width, height, inset, translate, ...) is free.
//   local-var-raw      a component-local custom property (--_x) may not smuggle a raw length,
//                      duration or colour into a governed property
//   foreign-var        components use tokens (--pn-x, declared only in tokens.css) and local
//                      properties (--_x); any other custom property, or a token declared in a
//                      component, is a way around the scales
//   var-fallback       var(--x, value) is not allowed: the fallback is a raw value in disguise
//   css-escape         backslash escapes outside strings (r\65 d) hide values from every rule
//   unknown-token      var(--pn-x) must be declared in design/tokens.css
//   unknown-local-var  var(--_x) must be declared in the player's CSS or set from code
//   unused-token       (warning) a token nobody references; §6 says it is deleted
//   data-uri, external-url, import   no data: URIs, no remote URLs, @import only "./" or "../"
//   important          !important only inside @media (prefers-reduced-motion: reduce) and [hidden]
//                      rules (an @supports, a "not" or "no-preference" condition does not count)
//   gradient           gradients only for the loading shimmer (PADR-0020)
//   glass              backdrop blur and the glass fill only on the floating surfaces (§8)
//   orphan-css         (warning) a CSS file that no bundle imports
// TS (every file under src/player/):
//   unsafe-html        innerHTML, outerHTML, insertAdjacentHTML, document.write, DOMParser, ...
//   eval               eval, new Function, Function(), string timers
//   inline-style       setAttribute('style'), .style.cssText, .style.x = ..., <style> elements,
//                      a `style` attribute key, setProperty / `vars` for names without "--"
//   color-literal, data-uri, external-url, unknown-token   as for CSS, inside string literals
//   unknown-class      a class written in code must appear in a selector of the CSS bundle that
//                      ships with the file (player or gallery), or on HOOK_CLASSES
//   unknown-type-role  the same for t-* type roles
//   unknown-icon       icon('x') / icon: 'x' / IconName literals must exist in ui/icons.ts
//   stale-hook         a HOOK_CLASSES entry that no code uses, or that CSS now styles
//   dynamic-class      (warning) a class value that cannot be resolved statically
// Bench report profile (PADR-0039 B.5): the same CSS rules on src/bench/report.css and the same TS
// rules on every module that writes report markup (REPORT_SOURCES), with classes checked against
// report.css. A src/bench module that writes markup but is not in REPORT_SOURCES is a setup error.
// Output: `file:line rule message` per finding (warnings marked), exit 1 if any error.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));

export type Severity = "error" | "warning";
export interface Finding { file: string; line: number; rule: string; message: string; severity: Severity }

export interface LintContext {
  /** Token names declared in design/tokens.css, with the leading "--". */
  tokens?: Set<string>;
  /** Classes that appear in any selector of the CSS bundle that ships with the file. */
  classes?: Set<string>;
  /** Icon names exported by src/player/ui/icons.ts. */
  icons?: Set<string>;
  /** Component-local custom properties (--_x) declared in CSS or set from code. */
  localVars?: Set<string>;
  /** Hook classes allowed without a CSS rule (records which ones were used). */
  hooks?: Map<string, string>;
  usedHooks?: Set<string>;
}

/**
 * Classes that code may write without any CSS rule. Each is a JavaScript or test hook, never a
 * look; a class that only exists to be styled belongs in CSS. Keep this list short: an entry that
 * no code uses, or that CSS starts to style, is reported as `stale-hook`.
 */
export const HOOK_CLASSES = new Map<string, string>([
  ["object-list", "test hook: tests/e2e select the tray lists by .object-list"],
  ["consequence", "test hook: the neutral world-consequence banner is .notice.consequence (tools/test-player-a11y.ts waits for it); its look is the kit banner"],
]);

const report = (out: Finding[], file: string, line: number, rule: string, message: string, severity: Severity = "error"): void => {
  out.push({ file, line, rule, message, severity });
};

// ------------------------------------------------------------------------------------------
// Shared colour vocabulary
// ------------------------------------------------------------------------------------------
const NAMED_COLOURS = new Set(("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
  "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray " +
  "darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue " +
  "darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite " +
  "forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory " +
  "khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen " +
  "lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime " +
  "limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue " +
  "mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive " +
  "olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
  "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue " +
  "slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke " +
  "yellow yellowgreen").split(" "));
const SYSTEM_COLOURS = new Set(["canvas", "canvastext", "linktext", "visitedtext", "activetext", "buttonface", "buttontext", "buttonborder",
  "field", "fieldtext", "highlight", "highlighttext", "selecteditem", "selecteditemtext", "mark", "marktext", "graytext", "accentcolor", "accentcolortext"]);
const COLOUR_FUNCTIONS = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const DATA_URI = /\bdata:(?:[a-z]+\/[\w.+-]+)?(?:;[\w=.-]+)*[;,]/i;
const COLOUR_PROPERTY = /^(--.*|color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|fill|stroke|box-shadow|text-shadow|text-decoration(-color)?|caret-color|accent-color|column-rule(-color)?|scrollbar-color|flood-color|stop-color|lighting-color|-webkit-tap-highlight-color|-webkit-text-fill-color)$/;
const HEX = /(?<![\w-])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-])/i;

// ------------------------------------------------------------------------------------------
// CSS parsing (small, comment- and string-aware; enough for the player's stylesheets)
// ------------------------------------------------------------------------------------------
export interface CssDecl { prop: string; value: string; important: boolean; line: number; selectors: string[]; atRules: string[] }
export interface CssRule { selector: string; line: number; atRules: string[] }
export interface CssStatement { text: string; line: number }
export interface ParsedCss { decls: CssDecl[]; rules: CssRule[]; statements: CssStatement[] }

/** Replaces comments by spaces (keeping newlines) so line numbers stay true. */
function stripCssComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1); i = j; continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " "); i = stop - 1; continue;
    }
    out += ch;
  }
  return out;
}

export function parseCss(text: string): ParsedCss {
  const src = stripCssComments(text);
  const result: ParsedCss = { decls: [], rules: [], statements: [] };
  const stack: Array<{ kind: "rule" | "at"; text: string }> = [];
  let buf = "", bufLine = 0, line = 1, paren = 0;
  const flush = (): string => { const value = buf.trim(); buf = ""; return value; };
  const atRules = (): string[] => stack.filter(s => s.kind === "at").map(s => s.text);
  const selectors = (): string[] => stack.filter(s => s.kind === "rule").map(s => s.text);
  const declaration = (statement: string, at: number): void => {
    const colon = statement.indexOf(":");
    if (colon < 0) return;
    const prop = statement.slice(0, colon).trim().toLowerCase();
    let value = statement.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, "").trim();
    result.decls.push({ prop, value, important, line: at, selectors: selectors(), atRules: atRules() });
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      const piece = src.slice(i, j + 1);
      if (!buf.trim()) bufLine = line;
      buf += piece; line += (piece.match(/\n/g) ?? []).length; i = j; continue;
    }
    if (ch === "\n") line++;
    if (ch === "(") paren++;
    if (ch === ")") paren = Math.max(0, paren - 1);
    if (paren === 0 && ch === "{") {
      const prelude = flush();
      if (prelude.startsWith("@")) stack.push({ kind: "at", text: prelude });
      else { stack.push({ kind: "rule", text: prelude }); result.rules.push({ selector: prelude, line: bufLine, atRules: atRules() }); }
      continue;
    }
    if (paren === 0 && (ch === ";" || ch === "}")) {
      const at = bufLine; const statement = flush();
      if (statement) {
        if (statement.startsWith("@") && !stack.some(s => s.kind === "rule")) result.statements.push({ text: statement, line: at });
        else if (stack.length) declaration(statement, at);
      }
      if (ch === "}") stack.pop();
      continue;
    }
    if (!buf.trim() && ch.trim()) bufLine = line;
    buf += ch;
  }
  return result;
}

/** Class names used in a selector (attribute selector contents and strings excluded). */
export function selectorClasses(selector: string): string[] {
  const clean = selector.replace(/"[^"]*"|'[^']*'/g, "").replace(/\[[^\]]*\]/g, "");
  return [...clean.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)].map(m => m[1] as string);
}

// ------------------------------------------------------------------------------------------
// CSS value scanning
// ------------------------------------------------------------------------------------------
interface ValueTok { k: "fn" | "close" | "num" | "dim" | "pct" | "id" | "hex" | "str" | "op"; v: string; unit?: string; n?: number }

function valueTokens(value: string): ValueTok[] {
  const out: ValueTok[] = [];
  const re = /\s+|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[0-9a-zA-Z]+)|([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(%|[a-zA-Z]+)?|(-{0,2}[a-zA-Z_][\w-]*)(\()?|(\))|(.)/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    if (m[0].trim() === "") continue;
    if (m[1]) out.push({ k: "str", v: m[1] });
    else if (m[2]) out.push({ k: "hex", v: m[2] });
    else if (m[3] !== undefined) {
      const n = Number(m[3]);
      if (m[4] === "%") out.push({ k: "pct", v: m[0], n });
      else if (m[4]) out.push({ k: "dim", v: m[0], unit: m[4].toLowerCase(), n });
      else out.push({ k: "num", v: m[0], n });
    } else if (m[5]) out.push(m[6] ? { k: "fn", v: m[5].toLowerCase() } : { k: "id", v: m[5] });
    else if (m[7]) out.push({ k: "close", v: ")" });
    else out.push({ k: "op", v: m[8] as string });
  }
  return out;
}

const GOVERNED: Array<[RegExp, string]> = [
  [/^(font-size|font|line-height|letter-spacing|font-weight|font-family)$/, "raw-type"],
  [/^(padding|margin)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/, "raw-space"],
  [/^(gap|row-gap|column-gap)$/, "raw-space"],
  [/^border(-(top|bottom)-(left|right)|-(start|end)-(start|end))?-radius$/, "raw-radius"],
  [/^box-shadow$/, "raw-shadow"],
  [/^(transition(-duration|-timing-function|-delay)?|animation(-duration|-timing-function|-delay)?)$/, "raw-motion"],
  [/^(outline|outline-width|outline-offset)$/, "raw-stroke"],
  [/^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-width)?$/, "raw-stroke"],
];
export function governedRule(prop: string): string | undefined {
  return GOVERNED.find(([re]) => re.test(prop))?.[1];
}

const GLOBAL_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer", "auto", "none", "normal"]);
// Keywords that are a curve or size choice and therefore must come from a token.
const RAW_TIMING = new Set(["ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"]);
const RAW_WIDTH = new Set(["thin", "medium", "thick"]);
const RAW_TYPE = new Set(["bold", "bolder", "lighter", "smaller", "larger", "xx-small", "x-small", "small", "large", "x-large", "xx-large", "xxx-large", "serif", "sans-serif", "monospace", "system-ui", "cursive", "fantasy", "ui-monospace", "ui-sans-serif"]);
const RAW_FUNCTIONS = new Set(["cubic-bezier", "steps", "linear"]);
const MATH = new Set(["calc", "min", "max", "clamp"]);

interface ScaleProblem { message: string }

/** Checks one governed declaration value; returns the problems found (empty = allowed). */
export function checkScaleValue(prop: string, value: string): ScaleProblem[] {
  const problems: ScaleProblem[] = [];
  const toks = valueTokens(value);
  const typeProp = /^(font-size|font|line-height|letter-spacing)$/.test(prop);
  const shorthandAnimation = prop === "animation";
  const shorthandMotion = prop === "transition" || prop === "animation";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i] as ValueTok;
    if (t.k === "fn") {
      // Find the matching close paren.
      let depth = 1, j = i + 1;
      for (; j < toks.length && depth; j++) { if ((toks[j] as ValueTok).k === "fn") depth++; if ((toks[j] as ValueTok).k === "close") depth--; }
      const inner = toks.slice(i + 1, j - 1);
      if (t.v === "var") {
        const name = inner[0]?.v ?? "";
        if (inner.some(x => x.k === "op" && x.v === ",")) problems.push({ message: `var(${name}, ...) has a fallback; a fallback is a raw value in disguise` });
        if (!name.startsWith("--pn-") && !name.startsWith("--_")) problems.push({ message: `${name || "var()"} is not a design token` });
      } else if (MATH.has(t.v)) {
        for (const x of inner) {
          if (x.k === "dim" && x.n !== 0) problems.push({ message: `${t.v}() contains the raw value ${x.v}; use tokens, 0, percentages or unit-free factors` });
          if (x.k === "fn" && !MATH.has(x.v) && x.v !== "var") problems.push({ message: `${t.v}() contains ${x.v}()` });
        }
        // var() inside math: check names and fallbacks
        for (let k = 0; k < inner.length; k++) if (inner[k]?.k === "fn" && inner[k]?.v === "var") {
          const name = inner[k + 1]?.v ?? "";
          if (!name.startsWith("--pn-") && !name.startsWith("--_")) problems.push({ message: `${name} inside ${t.v}() is not a design token` });
          if (inner[k + 2]?.k === "op" && inner[k + 2]?.v === ",") problems.push({ message: `var(${name}, ...) inside ${t.v}() has a fallback` });
        }
      } else if (RAW_FUNCTIONS.has(t.v)) {
        problems.push({ message: `${t.v}() is a raw easing; use a --pn-ease-* token` });
      } else {
        problems.push({ message: `${t.v}() is not allowed in ${prop}` });
      }
      i = j - 1;
      continue;
    }
    if (t.k === "dim") {
      if (t.n !== 0) problems.push({ message: `raw value ${t.v}` });
      continue;
    }
    if (t.k === "pct") {
      if (typeProp && t.n !== 0) problems.push({ message: `raw value ${t.v}` });
      continue;
    }
    if (t.k === "num") {
      // 0 is always allowed; a unit-free count in the animation shorthand is an iteration count.
      if (t.n !== 0 && !shorthandAnimation) problems.push({ message: `raw value ${t.v}` });
      continue;
    }
    if (t.k === "id") {
      const word = t.v.toLowerCase();
      if (GLOBAL_KEYWORDS.has(word)) continue;
      if (shorthandMotion && RAW_TIMING.has(word)) { problems.push({ message: `${t.v} is a raw easing; use a --pn-ease-* token` }); continue; }
      // `linear` is not a curve choice: it is "no easing", which is what a constant-speed loop
      // (spinner, flowing dashes of a pending connection) means. Allowed as a keyword.
      if (shorthandMotion && word === "linear") continue;
      if ((prop.startsWith("border") || prop.startsWith("outline")) && RAW_WIDTH.has(word)) { problems.push({ message: `${t.v} is a raw width; use --pn-stroke-*` }); continue; }
      if ((prop === "font" || prop === "font-weight" || prop === "font-size" || prop === "font-family") && (RAW_TYPE.has(word) || prop === "font-family")) { problems.push({ message: `${t.v} is a raw type value; use the --pn-font-*/--pn-weight-*/--pn-text-* tokens` }); continue; }
      if (prop === "font" && !["italic", "normal", "small-caps"].includes(word)) { problems.push({ message: `${t.v} in the font shorthand; use tokens` }); continue; }
      continue; // other keywords (solid, inset, property and keyframe names, infinite, ...)
    }
    if (t.k === "str" && (prop === "font" || prop === "font-family")) problems.push({ message: `${t.v} is a raw font family; use --pn-font-*` });
  }
  return problems;
}

// ------------------------------------------------------------------------------------------
// CSS lint
// ------------------------------------------------------------------------------------------
const GLASS_ALLOWED = [/\.shell-bar\b/, /\.pn-floating\b/, /\.canvas__coach\b/, /::backdrop\b/, /\.gallery-bar\b/];
const GRADIENT_ALLOWED = [/\.pn-skeleton\b/];

/** True for `@media (prefers-reduced-motion: reduce)` (no `not`, no other at-rule kind). */
const isReducedMotionMedia = (at: string): boolean => /^@media\b/i.test(at) && /prefers-reduced-motion\s*:\s*reduce\b/i.test(at) && !/\bnot\b/i.test(at);
const isForcedColoursMedia = (at: string): boolean => /^@media\b/i.test(at) && /forced-colors\s*:\s*active\b/i.test(at) && !/\bnot\b/i.test(at);
/** Removes var() names but keeps fallbacks, so a colour inside `var(--x, red)` is still seen. */
const withoutVarNames = (value: string): string => value.replace(/var\(\s*--[\w-]+\s*,?/g, "(");

export function lintCss(text: string, file: string, context: LintContext = {}): Finding[] {
  const out: Finding[] = [];
  const parsed = parseCss(text);
  for (const statement of parsed.statements) {
    const m = /^@import\s+(.*)$/is.exec(statement.text);
    if (!m) continue;
    const target = /^["']([^"']+)["']\s*$/.exec((m[1] as string).trim());
    if (!target) { report(out, file, statement.line, "import", `@import must name a local file as a quoted relative path: ${statement.text}`); continue; }
    const path = target[1] as string;
    if (!path.startsWith("./") && !path.startsWith("../")) report(out, file, statement.line, "import", `@import "${path}" is not a local relative file`);
    else if (existsSync(dirname(resolve(file))) && !existsSync(resolve(dirname(resolve(file)), path))) report(out, file, statement.line, "import", `@import "${path}" does not exist`);
  }
  for (const rule of parsed.rules) {
    if (/\b(?:https?:)?\/\//.test(rule.selector) && /url\(|@import/.test(rule.selector)) report(out, file, rule.line, "external-url", "remote URL in a selector");
  }
  for (const d of parsed.decls) {
    const selector = d.selectors.join(" ");
    const forcedColours = d.atRules.some(isForcedColoursMedia);
    const reducedMotion = d.atRules.some(isReducedMotionMedia);
    const value = d.value;
    // Escapes outside strings turn `red` into `r\65 d`: no rule below would see the value.
    if (/\\/.test((d.prop + ":" + value).replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ""))) report(out, file, d.line, "css-escape", `${d.prop}: backslash escape outside a string hides the value from the design rules`);
    // Custom properties: tokens come from tokens.css; components only declare local --_x.
    if (d.prop.startsWith("--") && !d.prop.startsWith("--_")) report(out, file, d.line, "foreign-var", `${d.prop}: components declare only local properties (--_x); tokens live in design/tokens.css`);
    for (const m of value.matchAll(/var\(\s*(--[\w-]*)\s*(,)?/g)) {
      const name = m[1] as string;
      if (!name.startsWith("--pn-") && !name.startsWith("--_")) report(out, file, d.line, "foreign-var", `${d.prop}: ${name} is neither a token (--pn-x) nor a local property (--_x)`);
      if (m[2]) report(out, file, d.line, "var-fallback", `${d.prop}: var(${name}, ...) has a fallback; a fallback is a raw value in disguise`);
    }
    // Colour literals in every declaration, including custom properties.
    const colourText = withoutVarNames(value);
    if (HEX.test(colourText)) report(out, file, d.line, "color-literal", `${d.prop}: hex colour ${HEX.exec(colourText)?.[0]}; use a --pn-color-* token`);
    const fn = COLOUR_FUNCTIONS.exec(colourText);
    if (fn && !/^color-mix\($/i.test(fn[0])) report(out, file, d.line, "color-literal", `${d.prop}: ${fn[1]}() colour; use a --pn-color-* token`);
    // Named and system colours are identifiers, so they are only looked for where a colour can
    // stand (grid-area: canvas is a name, not a colour).
    const colourWords = COLOUR_PROPERTY.test(d.prop) ? colourText.replace(/url\([^)]*\)/g, " ").replace(/"[^"]*"|'[^']*'/g, " ").match(/-?[a-zA-Z][\w-]*/g) ?? [] : [];
    for (const word of colourWords) {
      const lower = word.toLowerCase();
      if (NAMED_COLOURS.has(lower)) report(out, file, d.line, "color-literal", `${d.prop}: named colour ${word}; use a --pn-color-* token`);
      else if (SYSTEM_COLOURS.has(lower) && !forcedColours) report(out, file, d.line, "color-literal", `${d.prop}: system colour ${word} is allowed only inside @media (forced-colors: active)`);
    }
    // URLs
    if (/url\(\s*["']?\s*data:/i.test(value) || DATA_URI.test(value)) report(out, file, d.line, "data-uri", `${d.prop}: data: URI (CSP allows img-src 'self' blob: only)`);
    if (/\b(?:https?:)?\/\/[\w.-]/i.test(value.replace(/"[^"]*"|'[^']*'/g, s => /url|\/\//.test(s) ? s : "")) && /url\(|https?:/i.test(value)) report(out, file, d.line, "external-url", `${d.prop}: remote URL; the player is offline`);
    // !important
    if (d.important && !reducedMotion && !d.selectors.some(s => s.split(",").every(part => /\[hidden\]\s*$/.test(part.trim())))) {
      report(out, file, d.line, "important", `${d.prop}: !important is allowed only in @media (prefers-reduced-motion) and [hidden] rules`);
    }
    // Gradients
    // A mask gradient only fades content at a scroll edge (alpha, no colour); §8 bans colour
    // gradients and gradient heroes, so masks are not reported.
    if (/(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(value) && !/^(-webkit-)?mask(-image)?$/.test(d.prop) && !GRADIENT_ALLOWED.some(re => re.test(selector))) {
      report(out, file, d.line, "gradient", `${d.prop}: gradients are reserved for the loading shimmer (.pn-skeleton, PADR-0020)`);
    }
    // Glass material
    const glass = /backdrop-filter$/.test(d.prop) || /var\(\s*--pn-color-glass\s*\)/.test(value) || /var\(\s*--pn-blur\s*\)/.test(value);
    if (glass && !GLASS_ALLOWED.some(re => re.test(selector))) {
      report(out, file, d.line, "glass", `${d.prop}: glass belongs to the floating surfaces only (app bar, .pn-floating, coach pill, sheet scrim; design-language §8)`);
    }
    // Tokens and local custom properties
    for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const name = m[1] as string;
      if (name.startsWith("--pn-") && context.tokens && !context.tokens.has(name)) report(out, file, d.line, "unknown-token", `${name} is not declared in design/tokens.css`);
      if (name.startsWith("--_") && context.localVars && !context.localVars.has(name)) report(out, file, d.line, "unknown-local-var", `${name} is never declared in CSS or set from code`);
    }
    if (d.prop.startsWith("--_")) {
      const toks = valueTokens(value);
      // A local custom property is a component's private switch. It may hold tokens, unit-free
      // numbers (indices, counts) and percentages, never a raw length, duration or colour.
      for (const t of toks) {
        if (t.k === "dim" && t.n !== 0) report(out, file, d.line, "local-var-raw", `${d.prop}: ${t.v} is a raw value; derive it from a token`);
      }
    }
    const rule = governedRule(d.prop);
    if (!rule) continue;
    // The visually-hidden pattern (1 px box clipped to nothing) needs margin: -1px. It is never
    // visible spacing, so it is exempt when the same rule clips the box with clip-path: inset(50%).
    if (rule === "raw-space" && /^-1px$/.test(value.trim())) {
      const sameRule = parsed.decls.filter(x => x.selectors.join(" ") === selector && x.atRules.join(" ") === d.atRules.join(" "));
      if (sameRule.some(x => x.prop === "clip-path" && /inset\(\s*50%\s*\)/.test(x.value))) continue;
    }
    // The reduced-motion reset neutralises every animation, including ones that never used a
    // token; its 0.01ms is the twin of the motion scale, not a design value (design-language §8).
    if (rule === "raw-motion" && reducedMotion) continue;
    const problems = checkScaleValue(d.prop, value);
    if (problems.length) report(out, file, d.line, rule, `${d.prop}: ${[...new Set(problems.map(p => p.message))].join("; ")}`);
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// TypeScript scanning (comments, strings, template literals and regexes recognised)
// ------------------------------------------------------------------------------------------
export interface Tok { k: "id" | "str" | "tpl" | "num" | "p" | "re"; v: string; line: number; parts?: Array<string | Tok[]> }

const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const PUNCT = ["===", "!==", "**=", "...", "<<=", ">>=", ">>>", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>"];

export function tokenizeTs(src: string): Tok[] {
  let i = 0, line = 1;
  const read = (untilBrace: boolean): Tok[] => {
    const toks: Tok[] = [];
    let depth = 0;
    while (i < src.length) {
      const ch = src[i] as string;
      if (ch === "\n") { line++; i++; continue; }
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (ch === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); const stop = end < 0 ? src.length : end + 2; line += (src.slice(i, stop).match(/\n/g) ?? []).length; i = stop; continue; }
      if (ch === '"' || ch === "'") {
        const start = line; let j = i + 1, value = "";
        while (j < src.length && src[j] !== ch) { if (src[j] === "\\") { value += src[j + 1] === "n" ? "\n" : (src[j + 1] ?? ""); j += 2; } else { if (src[j] === "\n") line++; value += src[j]; j++; } }
        toks.push({ k: "str", v: value, line: start }); i = j + 1; continue;
      }
      if (ch === "`") {
        const start = line; const parts: Array<string | Tok[]> = []; let text = ""; i++;
        while (i < src.length && src[i] !== "`") {
          if (src[i] === "\\") { text += src[i + 1] ?? ""; i += 2; continue; }
          if (src[i] === "$" && src[i + 1] === "{") { parts.push(text); text = ""; i += 2; parts.push(read(true)); continue; }
          if (src[i] === "\n") line++;
          text += src[i]; i++;
        }
        parts.push(text); i++;
        toks.push({ k: "tpl", v: parts.filter((p): p is string => typeof p === "string").join("${}"), line: start, parts }); continue;
      }
      if (/[A-Za-z_$]/.test(ch)) { const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200)) as RegExpExecArray; toks.push({ k: "id", v: m[0], line }); i += m[0].length; continue; }
      if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) { const m = /^(?:0[xob][\da-f_]+|[\d_]*\.?[\d_]+(?:e[-+]?\d+)?)n?/i.exec(src.slice(i, i + 100)) as RegExpExecArray; toks.push({ k: "num", v: m[0], line }); i += Math.max(1, m[0].length); continue; }
      if (ch === "/") {
        const prev = toks[toks.length - 1];
        const division = prev && (prev.k === "num" || prev.k === "str" || prev.k === "tpl" || prev.k === "re" || (prev.k === "id" && !KEYWORDS_BEFORE_REGEX.has(prev.v)) || (prev.k === "p" && [")", "]", "}"].includes(prev.v)));
        if (!division) {
          let j = i + 1, inClass = false;
          while (j < src.length && (inClass || src[j] !== "/")) { if (src[j] === "\\") j++; else if (src[j] === "[") inClass = true; else if (src[j] === "]") inClass = false; j++; }
          j++; while (/[a-z]/i.test(src[j] ?? "")) j++;
          toks.push({ k: "re", v: src.slice(i, j), line }); i = j; continue;
        }
      }
      if (untilBrace) {
        if (ch === "{") depth++;
        if (ch === "}") { if (depth === 0) { i++; return toks; } depth--; }
      }
      const op = PUNCT.find(p => src.startsWith(p, i)) ?? ch;
      toks.push({ k: "p", v: op, line }); i += op.length;
    }
    return toks;
  };
  return read(false);
}

/** Every token sequence: the top level and every template expression, recursively. */
function sequences(toks: Tok[]): Tok[][] {
  const out: Tok[][] = [toks];
  for (const t of toks) for (const part of t.parts ?? []) if (Array.isArray(part)) out.push(...sequences(part));
  return out;
}

/** Tokens of the expression starting at `start`, up to a top-level , ; ) ] or }. */
function expression(seq: Tok[], start: number): Tok[] {
  let depth = 0; const out: Tok[] = [];
  for (let i = start; i < seq.length; i++) {
    const t = seq[i] as Tok;
    if (t.k === "p" && ["(", "[", "{"].includes(t.v)) depth++;
    if (t.k === "p" && [")", "]", "}"].includes(t.v)) { if (depth === 0) break; depth--; }
    if (t.k === "p" && (t.v === "," || t.v === ";") && depth === 0) break;
    out.push(t);
  }
  return out;
}

/** Tokens inside the parentheses that open at `open` (exclusive). */
function callArgs(seq: Tok[], open: number): Tok[] {
  let depth = 0; const out: Tok[] = [];
  for (let i = open; i < seq.length; i++) {
    const t = seq[i] as Tok;
    if (t.k === "p" && ["(", "[", "{"].includes(t.v)) { depth++; if (depth === 1) continue; }
    if (t.k === "p" && [")", "]", "}"].includes(t.v)) { depth--; if (depth === 0) break; }
    out.push(t);
  }
  return out;
}

/** Splits call arguments (as returned by callArgs) at top-level commas. */
function splitArgs(args: Tok[]): Tok[][] {
  const out: Tok[][] = [[]]; let depth = 0;
  for (const t of args) {
    if (t.k === "p" && ["(", "[", "{"].includes(t.v)) depth++;
    if (t.k === "p" && [")", "]", "}"].includes(t.v)) depth--;
    if (t.k === "p" && t.v === "," && depth === 0) { out.push([]); continue; }
    (out[out.length - 1] as Tok[]).push(t);
  }
  return out;
}

interface FunctionSpan { name: string; nameIndex: number; params: string[]; start: number; end: number }
/** `function f(a, b) {...}` and `const f = <T>(a, b): R => ...` with their token spans. */
export function functionSpans(toks: Tok[]): FunctionSpan[] {
  const out: FunctionSpan[] = [];
  const skipBalanced = (i: number, open: string, close: string): number => { let depth = 0; for (; i < toks.length; i++) { if (toks[i]?.v === open) depth++; if (toks[i]?.v === close) { depth--; if (depth === 0) return i + 1; } } return i; };
  for (let i = 0; i < toks.length; i++) {
    let nameIndex = -1, open = -1;
    if (toks[i]?.v === "function" && toks[i + 1]?.k === "id") { nameIndex = i + 1; open = i + 2; }
    else if (toks[i]?.k === "id" && toks[i + 1]?.v === "=" && (toks[i - 1]?.v === "const" || toks[i - 1]?.v === "let")) { nameIndex = i; open = i + 2; }
    if (nameIndex < 0) continue;
    if (toks[open]?.v === "<") open = skipBalanced(open, "<", ">");
    if (toks[open]?.v !== "(") continue;
    const params = splitArgs(callArgs(toks, open)).map(p => p.find(t => t.k === "id")?.v ?? "");
    let j = skipBalanced(open, "(", ")");
    // Optional return type: object types, generics and indexed types are skipped as balanced groups.
    if (toks[j]?.v === ":") {
      j++;
      while (j < toks.length && toks[j]?.v !== "=>") {
        // `{` right after `:`, `|`, `&`, `<`, `,` or `(` opens an object type; any other `{` is the body.
        if (toks[j]?.v === "{") { if (!/^(:|\||&|<|,|\()$/.test(toks[j - 1]?.v ?? "")) break; j = skipBalanced(j, "{", "}"); continue; }
        if (toks[j]?.v === "<") { j = skipBalanced(j, "<", ">"); continue; }
        if (toks[j]?.v === "[") { j = skipBalanced(j, "[", "]"); continue; }
        if (toks[j]?.v === "(") { j = skipBalanced(j, "(", ")"); continue; }
        j++;
      }
    }
    if (toks[j]?.v === "=>") j++;
    let end: number;
    if (toks[j]?.v === "{") end = skipBalanced(j, "{", "}") - 1;
    else { let depth = 0; end = j; for (; end < toks.length; end++) { const v = toks[end]?.v; if (v === "(" || v === "[" || v === "{") depth++; if (v === ")" || v === "]" || v === "}") { if (depth === 0) break; depth--; } if ((v === ";" || v === ",") && depth === 0) break; } }
    out.push({ name: toks[nameIndex]?.v as string, nameIndex, params, start: i, end });
  }
  return out;
}

const literals = (toks: Tok[]): Tok[] => toks.filter(t => t.k === "str" || t.k === "tpl");
const COMPARISON = /^[!=]==?$/;
/**
 * String and template literals in `toks`, including those nested in template expressions.
 * With `values` set, operands of ===/!== are skipped: in `variant !== 'secondary' && 'pn-btn--x'`
 * only the second literal is a value, the first is the discriminant.
 */
function stringsDeep(toks: Tok[], values = false): Tok[] {
  const out: Tok[] = [];
  toks.forEach((t, k) => {
    if ((t.k === "str" || t.k === "tpl") && !(values && (COMPARISON.test(toks[k - 1]?.v ?? "") || COMPARISON.test(toks[k + 1]?.v ?? "")))) out.push(t);
    for (const part of t.parts ?? []) if (Array.isArray(part)) out.push(...stringsDeep(part, values));
  });
  return out;
}
const textOf = (t: Tok): string => t.k === "tpl" ? (t.parts ?? []).map(p => typeof p === "string" ? p : "").join("") : t.v;

// A non-zero length or duration ("0ms" is no design value; elapsed times are built with ${}).
const RAW_LENGTH = /(?<![\w-])-?(?:0*[1-9]\d*(?:\.\d*)?|0*\.\d*[1-9]\d*)(px|rem|em|ms|s|vw|vh)\b/;
const SVG_PAINT = new Set(["fill", "stroke", "stop-color", "flood-color", "lighting-color"]);
const PAINT_OK = /^(none|currentColor|transparent|inherit|url\(#[\w-]+\)|var\(\s*--pn-color-[\w-]*\s*\))$/i;
const EXCALIDRAW_COLOUR_KEYS = new Set(["strokeColor", "backgroundColor", "viewBackgroundColor", "currentItemStrokeColor", "currentItemBackgroundColor"]);
const CLASSISH = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
const BEM = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:__[a-z0-9]+(?:-[a-z0-9]+)*)?(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

export function lintTs(text: string, file: string, context: LintContext = {}): Finding[] {
  const out: Finding[] = [];
  const toks = tokenizeTs(text);
  // Every nested token maps to the index of the top-level token that contains it.
  const topIndex = new Map<Tok, number>();
  const mark = (list: Tok[], index: number): void => { for (const t of list) { topIndex.set(t, index); for (const part of t.parts ?? []) if (Array.isArray(part)) mark(part, index); } };
  toks.forEach((t, index) => { topIndex.set(t, index); for (const part of t.parts ?? []) if (Array.isArray(part)) mark(part, index); });
  const isDomHelper = /src\/player\/ui\/dom\.ts$/.test(file.split(sep).join("/"));

  const checkClassWord = (word: string, line: number): void => {
    if (!word || !context.classes) return;
    if (!CLASSISH.test(word)) { report(out, file, line, "unknown-class", `"${word}" is not a valid class name`); return; }
    if (context.classes.has(word)) return;
    if (context.hooks?.has(word)) { context.usedHooks?.add(word); return; }
    if (word.startsWith("t-")) report(out, file, line, "unknown-type-role", `type role "${word}" does not exist (base.css defines the t-* roles)`);
    else report(out, file, line, "unknown-class", `class "${word}" has no CSS rule in this bundle and is not a hook (tools/design-lint.ts HOOK_CLASSES)`);
  };
  const checkClassPrefix = (prefix: string, line: number): void => {
    if (!prefix || !context.classes) return;
    if ([...context.classes].some(c => c.startsWith(prefix) && c.length > prefix.length)) return;
    report(out, file, line, "unknown-class", `no class in this bundle starts with "${prefix}" (built as ${prefix}\${...})`);
  };
  const checked = new Set<Tok>();
  const sceneData = new Set<Tok>();
  const paintChecked = new Set<Tok>();
  const checkPaint = (lit: Tok, attribute: string): void => {
    paintChecked.add(lit);
    const value = textOf(lit).trim();
    if (PAINT_OK.test(value)) { const token = /var\(\s*(--pn-[\w-]+)/.exec(value)?.[1]; if (token && context.tokens && !context.tokens.has(token) && !(lit.k === "tpl" && token.endsWith("-"))) report(out, file, lit.line, "unknown-token", `${token} is not declared in design/tokens.css`); return; }
    report(out, file, lit.line, "color-literal", `${attribute}: '${value}' is not none, currentColor, transparent, url(#id) or var(--pn-color-*)`);
  };
  const checkClassLiteral = (t: Tok): void => {
    if (checked.has(t)) return;
    checked.add(t);
    if (t.k === "str") { for (const word of t.v.split(/\s+/)) checkClassWord(word, t.line); return; }
    // Each ${...} becomes a numbered marker, so a word can be split into static text and the
    // expressions it touches: `pn-btn--${variant}` is checked as a prefix, a word that is only
    // `${...}` is checked through the literals its expression can produce.
    const exprs = (t.parts ?? []).filter((p): p is Tok[] => Array.isArray(p));
    // An expression whose literals all start with a space (`${on ? ' is-new' : ''}`) adds its own
    // words; any other expression continues the word it touches.
    const separate = exprs.map(expr => { const inner = stringsDeep(expr, true); return inner.length > 0 && inner.every(l => textOf(l) === "" || /^\s/.test(textOf(l))); });
    let n = 0;
    const joined = (t.parts ?? []).map(p => { if (typeof p === "string") return p; const index = n++; return separate[index] ? ` \u0000${index}\u0001 ` : `\u0000${index}\u0001`; }).join("");
    for (const word of joined.split(/\s+/)) {
      if (!word) continue;
      const marks = [...word.matchAll(/\u0000(\d+)\u0001/g)].map(m => Number(m[1]));
      if (!marks.length) { checkClassWord(word, t.line); continue; }
      const prefix = word.slice(0, word.indexOf("\u0000"));
      const rest = word.replace(/\u0000\d+\u0001/g, "");
      if (prefix) { checkClassPrefix(prefix, t.line); continue; }
      if (rest) { report(out, file, t.line, "dynamic-class", `class word "${word.replace(/\u0000\d+\u0001/g, "${...}")}" starts with an expression; it cannot be checked`, "warning"); continue; }
      for (const index of marks) {
        const expr = exprs[index] as Tok[];
        const inner = stringsDeep(expr, true);
        if (!inner.length && expr.length === 1 && expr[0]?.k === "id" && forwardClassParameter(expr[0].v, expr[0])) continue;
        if (!inner.length) { if (!isDomHelper) report(out, file, t.line, "dynamic-class", `class built from a variable (\${${expr.map(x => x.v).join("")}}); its values are not checked here`, "warning"); continue; }
        for (const lit of inner) checkClassLiteral(lit);
      }
    }
  };
  const classExpression = (expr: Tok[], line: number): void => {
    const lits = stringsDeep(expr, true);
    if (!lits.length) {
      // A helper parameter (`n.className = cls`, `class: className`) is followed to the helper's
      // call sites in the same file, where the literal arguments are checked.
      if (expr.length === 1 && expr[0]?.k === "id" && forwardClassParameter(expr[0].v, expr[0])) return;
      // ui/dom.ts passes Props.class through; every caller's literal is checked at the call site.
      if (!isDomHelper && expr.length && !(expr.length === 1 && expr[0]?.k === "id" && /^(undefined|null)$/.test(expr[0].v))) report(out, file, line, "dynamic-class", `class set from ${expr.map(x => x.v).join("").slice(0, 60)}; its values are not checked here`, "warning");
      return;
    }
    for (const lit of lits) checkClassLiteral(lit);
  };
  // Function definitions (name, parameter names, token span) for parameter forwarding.
  const functions = functionSpans(toks);
  const forwarded = new Map<string, boolean>();
  function forwardClassParameter(param: string, usage: Tok): boolean {
    const at = topIndex.get(usage) ?? -1;
    // The helper is the innermost function that contains the usage and declares the parameter.
    const helper = functions.filter(f => f.start <= at && at <= f.end && f.params.includes(param)).sort((a, b) => b.start - a.start)[0];
    if (!helper) return false;
    const key = `${helper.name}#${param}`;
    if (forwarded.has(key)) return forwarded.get(key) as boolean;
    forwarded.set(key, true);
    const index = helper.params.indexOf(param);
    for (let i = 0; i < toks.length; i++) {
      if (toks[i]?.k !== "id" || toks[i]?.v !== helper.name || toks[i + 1]?.v !== "(" || toks[i - 1]?.v === "function" || toks[i - 1]?.v === "." || i === helper.nameIndex) continue;
      for (const lit of stringsDeep(splitArgs(callArgs(toks, i + 1))[index] ?? [], true)) checkClassLiteral(lit);
    }
    return true;
  }
  const checkIcon = (t: Tok): void => {
    if (!context.icons || t.k !== "str") return;
    if (!context.icons.has(t.v)) report(out, file, t.line, "unknown-icon", `icon "${t.v}" is not drawn in src/player/ui/icons.ts`);
  };

  for (const seq of sequences(toks)) {
    for (let i = 0; i < seq.length; i++) {
      const t = seq[i] as Tok, next = seq[i + 1], prev = seq[i - 1];
      const isProp = prev?.k === "p" && (prev.v === "." || prev.v === "?.");
      // unsafe-html
      if (t.k === "id" && /^(innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|setHTMLUnsafe|parseHTMLUnsafe|srcdoc)$/.test(t.v)) report(out, file, t.line, "unsafe-html", `${t.v} builds markup from a string; build nodes with h()/svg factories (Trusted Types)`);
      if (t.k === "id" && t.v === "DOMParser") report(out, file, t.line, "unsafe-html", "DOMParser parses markup from a string");
      if (t.k === "id" && /^(write|writeln)$/.test(t.v) && isProp && seq[i - 2]?.v === "document") report(out, file, t.line, "unsafe-html", `document.${t.v} writes markup`);
      if (t.k === "str" && /^(innerHTML|outerHTML|insertAdjacentHTML|srcdoc)$/.test(t.v)) report(out, file, t.line, "unsafe-html", `"${t.v}" accessed by name`);
      // eval
      if (t.k === "id" && t.v === "eval" && next?.v === "(" && !isProp) report(out, file, t.line, "eval", "eval() runs a string as code");
      if (t.k === "id" && t.v === "Function" && (next?.v === "(" || prev?.v === "new")) report(out, file, t.line, "eval", "Function() runs a string as code");
      if (t.k === "id" && /^(setTimeout|setInterval)$/.test(t.v) && next?.v === "(" && (seq[i + 2]?.k === "str" || seq[i + 2]?.k === "tpl")) report(out, file, t.line, "eval", `${t.v} with a string runs it as code`);
      // inline-style
      if (t.k === "id" && /^setAttribute(NS)?$/.test(t.v) && next?.v === "(") {
        const args = callArgs(seq, i + 1);
        const name = t.v === "setAttributeNS" ? literals(args)[1] ?? literals(args)[0] : args[0];
        if (name && (name.k === "str" || name.k === "tpl") && textOf(name).toLowerCase() === "style") report(out, file, t.line, "inline-style", "setAttribute('style') writes an inline style; use a class or a custom property");
        if (name && name.k === "str" && name.v === "class") classExpression(expression(args, 2), t.line);
      }
      if (t.k === "id" && t.v === "cssText") report(out, file, t.line, "inline-style", "cssText writes an inline style");
      if (t.k === "id" && t.v === "style" && isProp && seq[i + 1]?.v === "." && seq[i + 2]?.k === "id") {
        const member = seq[i + 2] as Tok, after = seq[i + 3];
        if (member.v === "setProperty") {
          const args = callArgs(seq, i + 3);
          const name = args[0];
          if (name?.k === "str") {
            if (!name.v.startsWith("--")) report(out, file, t.line, "inline-style", `style.setProperty('${name.v}') sets a real property; only custom properties (--x) are allowed`);
            else if (name.v.startsWith("--pn-")) report(out, file, t.line, "inline-style", `style.setProperty('${name.v}') overrides a token from code; tokens live in design/tokens.css`);
            for (const lit of literals(splitArgs(args)[1] ?? [])) if (RAW_LENGTH.test(textOf(lit)) || HEX.test(textOf(lit)) || COLOUR_FUNCTIONS.test(textOf(lit))) report(out, file, lit.line, "local-var-raw", `style.setProperty('${name.v}', '${textOf(lit)}') sets a raw value; derive it from a token`);
          }
          else if (name?.k === "tpl" && !textOf(name).startsWith("--")) report(out, file, t.line, "inline-style", "style.setProperty with a computed name that does not start with --");
          // ui/dom.ts h(): the name comes from Props.vars, whose keys are checked at every call site
          // by the `vars` rule below. Any other computed name is a finding.
          else if (name && name.k !== "tpl" && !isDomHelper) report(out, file, t.line, "inline-style", "style.setProperty with a computed name; only literal custom properties (--x) can be checked");
        } else if (!/^(getPropertyValue|removeProperty|getPropertyPriority|item|length|cssText)$/.test(member.v) && after?.k === "p" && /^([-+*/%&|^]|\*\*|<<|>>)?=$/.test(after.v)) {
          report(out, file, t.line, "inline-style", `style.${member.v} = ... writes an inline style`);
        }
      }
      // node.style['padding'] = ... or node.style[name] = ...
      if (t.k === "id" && t.v === "style" && isProp && next?.v === "[") {
        let k = i + 1, depth = 0;
        for (; k < seq.length; k++) { if (seq[k]?.v === "[") depth++; if (seq[k]?.v === "]") { depth--; if (depth === 0) break; } }
        if (/^([-+*/%&|^]|\*\*|<<|>>)?=$/.test(seq[k + 1]?.v ?? "")) report(out, file, t.line, "inline-style", "style[...] = ... writes an inline style");
      }
      if ((t.k === "id" || t.k === "str") && t.v === "style" && next?.v === ":" && !isProp && seq[i + 2] && seq[i + 2]?.k !== "id") report(out, file, t.line, "inline-style", "a style attribute value; use a class or a custom property");
      if (t.k === "id" && /^(createElement|createElementNS|h)$/.test(t.v) && next?.v === "(") {
        const first = literals(callArgs(seq, i + 1)).find(x => textOf(x).toLowerCase() === "style");
        if (first) report(out, file, t.line, "inline-style", "a <style> element injects CSS outside the stylesheet bundle");
      }
      if (t.k === "id" && /^(insertRule|adoptedStyleSheets|replaceSync)$/.test(t.v) && isProp) report(out, file, t.line, "inline-style", `${t.v} injects CSS outside the stylesheet bundle`);
      // vars: { '--x': value } (h() sets these with style.setProperty)
      if (t.k === "id" && t.v === "vars" && next?.v === ":" && seq[i + 2]?.v === "{") {
        const body = callArgs(seq, i + 2);
        for (let k = 0; k < body.length; k++) {
          const key = body[k] as Tok;
          if ((key.k === "str" || key.k === "id") && body[k + 1]?.v === ":" && (k === 0 || body[k - 1]?.v === "," || body[k - 1]?.v === "{")) {
            if (!key.v.startsWith("--")) report(out, file, key.line, "inline-style", `vars key "${key.v}" is not a custom property (--x)`);
            for (const lit of literals(expression(body, k + 2))) {
              const raw = RAW_LENGTH.exec(textOf(lit));
              if (raw) report(out, file, lit.line, "local-var-raw", `vars "${key.v}": ${raw[0]} is a raw value; derive it from a token`);
            }
          }
        }
      }
      // SVG paint written from code: only none, currentColor, transparent, a url(#id) reference or a
      // colour token. `fill: 'red'`, setAttribute('stroke', '#123'), 'flood-color': 'tomatoe' fail.
      if ((t.k === "id" || t.k === "str") && SVG_PAINT.has(t.v) && next?.v === ":" && (seq[i + 2]?.k === "str" || seq[i + 2]?.k === "tpl") && !EXCALIDRAW_COLOUR_KEYS.has(t.v)) checkPaint(seq[i + 2] as Tok, t.v);
      if (t.k === "id" && /^setAttribute(NS)?$/.test(t.v) && next?.v === "(") {
        const args = splitArgs(callArgs(seq, i + 1));
        const nameArg = (t.v === "setAttributeNS" ? args[1] : args[0]) ?? [];
        const valueArg = (t.v === "setAttributeNS" ? args[2] : args[1]) ?? [];
        if (nameArg.length === 1 && nameArg[0]?.k === "str" && SVG_PAINT.has(nameArg[0].v) && valueArg.length === 1 && (valueArg[0]?.k === "str" || valueArg[0]?.k === "tpl")) checkPaint(valueArg[0] as Tok, nameArg[0].v);
      }
      // Excalidraw scene data: element colours are values the real editor stores for its own
      // drawing (PADR-0006/0012), not interface colour; they cannot be CSS variables.
      if ((t.k === "id" || t.k === "str") && EXCALIDRAW_COLOUR_KEYS.has(t.v) && next?.v === ":" && seq[i + 2]?.k === "str") sceneData.add(seq[i + 2] as Tok);
      // Classes
      if ((t.k === "id" || t.k === "str") && t.v === "class" && next?.v === ":") classExpression(expression(seq, i + 2), t.line);
      if (t.k === "id" && t.v === "className" && next?.k === "p" && (next.v === "=" || next.v === "+=")) classExpression(expression(seq, i + 2), t.line);
      if (t.k === "id" && t.v === "classList" && seq[i + 1]?.v === "." && /^(add|remove|toggle|contains|replace)$/.test(seq[i + 2]?.v ?? "") && seq[i + 3]?.v === "(") {
        const args = callArgs(seq, i + 3);
        const relevant = seq[i + 2]?.v === "toggle" || seq[i + 2]?.v === "contains" ? expression(args, 0) : args;
        classExpression(relevant, t.line);
      }
      if (t.k === "id" && t.v === "classes" && next?.v === "(" && !isProp && prev?.v !== "function") classExpression(callArgs(seq, i + 1), t.line);
      // Icons
      if (t.k === "id" && t.v === "icon" && next?.v === "(" && !isProp && prev?.v !== "function") { const a = callArgs(seq, i + 1)[0]; if (a) checkIcon(a); }
      if ((t.k === "id" || t.k === "str") && t.v === "icon" && next?.v === ":") { for (const lit of stringsDeep(expression(seq, i + 2), true)) checkIcon(lit); }
      if (t.k === "id" && t.v === "IconName" && prev?.v === ":" && next?.v === "=") {
        // Only the values of the ternary chain are icon names; operands of === are the discriminant.
        for (const lit of stringsDeep(expression(seq, i + 2), true)) checkIcon(lit);
      }
    }
  }
  // String contents: colours, URLs, tokens, markup class attributes, BEM-looking classes.
  for (const lit of stringsDeep(toks)) {
    const value = textOf(lit);
    if (sceneData.has(lit)) continue;
    if (paintChecked.has(lit)) continue;
    const colourText = withoutVarNames(value);
    if (HEX.test(colourText) && !/url\(#/.test(value)) report(out, file, lit.line, "color-literal", `hex colour ${HEX.exec(colourText)?.[0]} in code; use a --pn-color-* token`);
    // COLOUR_FUNCTIONS does not match color-mix( itself, so a mix of tokens passes and a mix with
    // rgb()/hsl() inside is reported; named colours inside a mix are looked for below.
    if (COLOUR_FUNCTIONS.test(colourText)) report(out, file, lit.line, "color-literal", `colour function in code; use a --pn-color-* token`);
    if (NAMED_COLOURS.has(value.trim().toLowerCase())) report(out, file, lit.line, "color-literal", `named colour "${value}" in code`);
    if (/color-mix\(/i.test(value)) for (const word of colourText.match(/-?[a-zA-Z][\w-]*/g) ?? []) if (NAMED_COLOURS.has(word.toLowerCase())) report(out, file, lit.line, "color-literal", `named colour ${word} inside color-mix() in code`);
    for (const m of value.matchAll(/\b(fill|stroke|stop-color|flood-color|lighting-color)="([^"]*)"/g)) if (!PAINT_OK.test((m[2] as string).trim())) report(out, file, lit.line, "color-literal", `${m[1]}="${m[2]}" in markup is not none, currentColor, transparent, url(#id) or var(--pn-color-*)`);
    // A data: URI names a media type and carries ;base64 or a comma (header "data:image/png;base64,").
    // The bare word "data:" (an event-stream field name) is not one.
    if (DATA_URI.test(value)) report(out, file, lit.line, "data-uri", "data: URI in code (CSP allows img-src 'self' blob: only)");
    for (const m of value.matchAll(/\b(https?:\/\/[^\s"'`)<>]+)/g)) {
      // XML namespace identifiers are names, not requests.
      if (/^http:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml|1999\/xlink|XML\/1998\/namespace)$/.test(m[1] as string)) continue;
      report(out, file, lit.line, "external-url", `remote URL ${m[1]} in player code; the player is offline`);
    }
    for (const m of value.matchAll(/var\(\s*(--pn-[\w-]*)/g)) {
      const name = m[1] as string;
      if (!context.tokens) continue;
      if (context.tokens.has(name)) continue;
      // `var(--pn-color-${name})` in a template: the static part is a prefix.
      if (lit.k === "tpl" && name.endsWith("-") && [...context.tokens].some(tok => tok.startsWith(name))) continue;
      report(out, file, lit.line, "unknown-token", `${name} is not declared in design/tokens.css`);
    }
    for (const m of value.matchAll(/\bclass="([^"]*)"/g)) for (const word of (m[1] as string).split(/\s+/)) checkClassWord(word, lit.line);
    if (lit.k === "str" && !checked.has(lit)) {
      const words = value.trim().split(/\s+/);
      if (words.length && words.every(w => BEM.test(w)) && words.some(w => /[a-z0-9](?:__|--)[a-z0-9]/.test(w))) for (const w of words) checkClassWord(w, lit.line);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Repository scan
// ------------------------------------------------------------------------------------------
function walk(dir: string, ext: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) walk(p, ext, out);
    else if (d.isFile() && d.name.endsWith(ext)) out.push(p);
  }
  return out.sort();
}

/** Token names declared in tokens.css (declarations only, not references). */
export function declaredTokens(css: string): Set<string> {
  return new Set([...stripCssComments(css).matchAll(/(--pn-[\w-]+)\s*:/g)].map(m => m[1] as string));
}

/** Files of a CSS bundle, following local @import from its entry. */
export function bundleFiles(entry: string, seen = new Set<string>()): string[] {
  const path = resolve(entry);
  if (seen.has(path) || !existsSync(path)) return [];
  seen.add(path);
  const files = [path];
  for (const statement of parseCss(readFileSync(path, "utf8")).statements) {
    const m = /^@import\s+["'](\.{1,2}\/[^"']+)["']/.exec(statement.text);
    if (m) files.push(...bundleFiles(resolve(dirname(path), m[1] as string), seen));
  }
  return files;
}

function bundleClasses(files: string[]): Set<string> {
  const classes = new Set<string>();
  for (const f of files) {
    const parsed = parseCss(readFileSync(f, "utf8"));
    for (const rule of parsed.rules) {
      if (rule.atRules.some(a => /^@keyframes/i.test(a))) continue;
      for (const c of selectorClasses(rule.selector)) classes.add(c);
    }
  }
  return classes;
}

export interface LintRun { findings: Finding[]; files: string[] }

/** Modules that write the bench report and compare pages (static HTML from strings). */
export const REPORT_SOURCES = ["src/bench/render.ts", "src/bench/render-compare.ts", "src/bench/schematic.ts", "src/bench/svg.ts"];
export const REPORT_CSS = "src/bench/report.css";

export function lintRepository(root: string = ROOT, only?: string[]): LintRun {
  const findings: Finding[] = [];
  const rel = (p: string): string => relative(root, p).split(sep).join("/") || p;
  const tokensPath = join(root, "design", "tokens.css");
  if (!existsSync(tokensPath)) {
    findings.push({ file: "design/tokens.css", line: 0, rule: "setup", message: "design/tokens.css is missing; nothing can be checked", severity: "error" });
    return { findings, files: [] };
  }
  const tokensCss = readFileSync(tokensPath, "utf8");
  const tokens = declaredTokens(tokensCss);
  const iconsPath = join(root, "src", "player", "ui", "icons.ts");
  const icons = new Set(existsSync(iconsPath) ? [...readFileSync(iconsPath, "utf8").replace(/^[\s\S]*?export const iconMarkup = \{/, "").split(/\n\}\s*as const;/)[0]!.matchAll(/^\s+([A-Za-z]\w*)\s*:/gm)].map(m => m[1] as string) : []);
  // Fail closed: an empty vocabulary would turn every membership rule into a silent pass.
  if (tokens.size < 20) findings.push({ file: rel(tokensPath), line: 0, rule: "setup", message: `only ${tokens.size} tokens parsed from tokens.css; refusing to lint against an empty vocabulary`, severity: "error" });
  if (icons.size < 10) findings.push({ file: rel(iconsPath), line: 0, rule: "setup", message: `only ${icons.size} icons parsed from icons.ts; refusing to lint against an empty vocabulary`, severity: "error" });

  // Two bundles ship: the player (src/player/player.css) and the never-shipped gallery
  // (src/player/gallery/entry.css). Code is checked against the bundle it is rendered with.
  const playerBundle = bundleFiles(join(root, "src", "player", "player.css"));
  const galleryBundle = bundleFiles(join(root, "src", "player", "gallery", "entry.css"));
  if (playerBundle.length < 2) findings.push({ file: "src/player/player.css", line: 0, rule: "setup", message: "player CSS bundle could not be resolved", severity: "error" });
  if (galleryBundle.length < 2) findings.push({ file: "src/player/gallery/entry.css", line: 0, rule: "setup", message: "gallery CSS bundle could not be resolved", severity: "error" });
  const classes = { player: bundleClasses(playerBundle), gallery: bundleClasses(galleryBundle) };

  // The bench report renderer: its stylesheet and the modules that write its markup.
  const reportCss = join(root, REPORT_CSS), benchDirectory = join(root, "src", "bench");
  const reportSources = REPORT_SOURCES.map(path => join(root, path)).filter(path => existsSync(path));
  const reportClasses = existsSync(reportCss) ? bundleClasses([reportCss]) : new Set<string>();
  if (reportSources.length && !existsSync(reportCss)) findings.push({ file: REPORT_CSS, line: 0, rule: "setup", message: "the report renderer exists but its stylesheet is missing", severity: "error" });
  // Fail closed: a bench module that writes markup outside the profile would escape every rule.
  for (const file of walk(benchDirectory, ".ts")) if (!REPORT_SOURCES.includes(rel(file)) && /\bclass="|<!doctype/i.test(readFileSync(file, "utf8"))) findings.push({ file: rel(file), line: 0, rule: "setup", message: "writes report markup but is not in REPORT_SOURCES (tools/design-lint.ts); the design rules would not see it", severity: "error" });

  const cssFiles = [...walk(join(root, "src", "player"), ".css"), ...(existsSync(reportCss) ? [reportCss] : [])];
  const tsFiles = [...walk(join(root, "src", "player"), ".ts"), ...reportSources];
  // Local custom properties: declared in any player CSS, or set from code by a string key.
  const localVars = new Set<string>();
  for (const f of cssFiles) for (const d of parseCss(readFileSync(f, "utf8")).decls) if (d.prop.startsWith("--_")) localVars.add(d.prop);
  for (const f of tsFiles) for (const m of readFileSync(f, "utf8").matchAll(/["'](--_[\w-]+)["']/g)) localVars.add(m[1] as string);

  const usedHooks = new Set<string>();
  const selected = only?.map(p => resolve(p));
  const targets = selected ?? [...cssFiles, ...tsFiles];
  for (const file of targets) {
    const text = readFileSync(file, "utf8");
    const posix = file.split(sep).join("/");
    if (file.endsWith(".css")) {
      findings.push(...lintCss(text, file, { tokens, localVars }).map(f => ({ ...f, file: rel(f.file) })));
      if (!selected && ![...playerBundle, ...galleryBundle, resolve(reportCss)].includes(resolve(file))) findings.push({ file: rel(file), line: 1, rule: "orphan-css", message: "no bundle imports this stylesheet", severity: "warning" });
    } else if (file.endsWith(".ts")) {
      const bundle = /\/src\/bench\//.test(posix) ? reportClasses : /\/src\/player\/gallery\//.test(posix) ? classes.gallery : classes.player;
      findings.push(...lintTs(text, file, { tokens, icons, classes: bundle, hooks: HOOK_CLASSES, usedHooks }).map(f => ({ ...f, file: rel(f.file) })));
    }
  }
  if (!selected) {
    for (const [hook, reason] of HOOK_CLASSES) {
      if (!usedHooks.has(hook)) findings.push({ file: "tools/design-lint.ts", line: 1, rule: "stale-hook", message: `hook class "${hook}" is not used by any code (${reason}); remove it from HOOK_CLASSES`, severity: "error" });
      if (classes.player.has(hook)) findings.push({ file: "tools/design-lint.ts", line: 1, rule: "stale-hook", message: `hook class "${hook}" now has a CSS rule; remove it from HOOK_CLASSES`, severity: "error" });
    }
    // Unused tokens: referenced nowhere in product CSS/TS and not by another token.
    const product = [...cssFiles, ...tsFiles].filter(f => !/\/src\/player\/gallery\//.test(f.split(sep).join("/")));
    const referenced = new Set<string>();
    for (const f of product) for (const m of readFileSync(f, "utf8").matchAll(/(--pn-[\w-]+)/g)) referenced.add(m[1] as string);
    for (const m of stripCssComments(tokensCss).matchAll(/:\s*([^;]*)/g)) for (const r of (m[1] as string).matchAll(/var\(\s*(--pn-[\w-]+)/g)) referenced.add(r[1] as string);
    const tokenLines = tokensCss.split("\n");
    for (const token of [...tokens].sort()) {
      if (referenced.has(token)) continue;
      const line = tokenLines.findIndex(l => l.includes(token + ":")) + 1;
      findings.push({ file: rel(tokensPath), line, rule: "unused-token", message: `${token} is not referenced by the player (design-language §6: a token nobody uses is deleted)`, severity: "warning" });
    }
  }
  return { findings, files: targets.map(rel) };
}

export function format(f: Finding): string {
  return `${f.file}:${f.line} ${f.rule} ${f.severity === "warning" ? "(warning) " : ""}${f.message}`;
}

function main(): number {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const root = rootIndex >= 0 ? resolve(args[rootIndex + 1] as string) : ROOT;
  const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--root");
  const run = lintRepository(root, only.length ? only : undefined);
  const errors = run.findings.filter(f => f.severity === "error");
  const warnings = run.findings.filter(f => f.severity === "warning");
  for (const f of [...errors, ...warnings]) (f.severity === "error" ? process.stderr : process.stdout).write(format(f) + "\n");
  process.stdout.write(`design:lint: ${run.files.length} files, ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
