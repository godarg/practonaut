// WCAG 2.2 contrast check of the design tokens.
// - Pairs and targets are read from docs/design/design-language.md §7.2 (the spec is the source;
//   this file holds no pair list). "(N pairs)" annotations are checked against the expansion.
// - Colours are read from design/tokens.css for the light theme and both dark blocks.
// - The `prefers-color-scheme: dark` block and `[data-theme="dark"]` must carry identical values.
// Exit 0 only if every pair meets its target in both themes and the dark blocks agree.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);

export interface Pair {
  id: string;
  fg: string;
  bg: string;
  target: number;
}

/** WCAG 2.x relative luminance of an sRGB hex colour (#RRGGBB). */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not an opaque #RRGGBB colour: ${hex}`);
  const lin = (h: string): number => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(m[1] as string) + 0.7152 * lin(m[2] as string) + 0.0722 * lin(m[3] as string);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Parses the two §7.2 tables (text and non-text) into pairs with their targets. */
export function parsePairs(markdown: string): Pair[] {
  const start = markdown.indexOf("### 7.2");
  if (start < 0) throw new Error("section 7.2 not found in design-language.md");
  const end = markdown.indexOf("\n### ", start + 1);
  const section = markdown.slice(start, end < 0 ? undefined : end);
  const pairs: Pair[] = [];
  let target: number | null = null;
  for (const line of section.split("\n")) {
    const t = /target (\d+(?:\.\d+)?):1/i.exec(line);
    if (t && !line.startsWith("|")) target = Number(t[1]);
    const row = /^\|\s*([TU]\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/.exec(line);
    if (!row) continue;
    if (target === null) throw new Error(`row ${row[1]} before any "target N:1" line`);
    const id = row[1] as string;
    const strip = (cell: string): { names: string[]; declared: number | null } => {
      const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };
      const ann = /\(([^)]*)\)/.exec(cell);
      let declared: number | null = null;
      if (ann) {
        const n = /\b(two|three|four|five|six|\d+) pairs\b/.exec(ann[1] as string);
        if (n) declared = words[n[1] as string] ?? Number(n[1]);
      }
      const names = cell.replace(/\([^)]*\)/g, "").split(",").map((s) => s.trim()).filter(Boolean);
      return { names, declared };
    };
    const f = strip(row[2] as string);
    const b = strip(row[3] as string);
    const expanded: Pair[] = [];
    for (const fg of f.names) for (const bg of b.names) expanded.push({ id, fg, bg, target });
    const declared = f.declared ?? b.declared;
    if (declared !== null && declared !== expanded.length) throw new Error(`${id}: annotation says ${declared} pairs, row expands to ${expanded.length}`);
    pairs.push(...expanded);
  }
  return pairs;
}

function blockBody(css: string, selectorPattern: RegExp): string {
  const m = selectorPattern.exec(css);
  if (!m) throw new Error(`block ${selectorPattern} not found in tokens.css`);
  const open = css.indexOf("{", m.index + m[0].length - 1);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

function colours(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/--pn-color-([a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1] as string, (m[2] as string).trim());
  return out;
}

export interface Themes {
  light: Map<string, string>;
  darkMedia: Map<string, string>;
  darkAttr: Map<string, string>;
  darkMediaScheme: string | undefined;
  darkAttrScheme: string | undefined;
}

export function parseTokens(css: string): Themes {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const light = blockBody(clean, /:root,\s*:root\[data-theme="light"\]\s*\{/);
  const darkMedia = blockBody(clean, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{/);
  const darkAttr = blockBody(clean, /(?:^|\n)\s*:root\[data-theme="dark"\]\s*\{/);
  const scheme = (b: string): string | undefined => /color-scheme\s*:\s*([^;]+);/.exec(b)?.[1]?.trim();
  return { light: colours(light), darkMedia: colours(darkMedia), darkAttr: colours(darkAttr), darkMediaScheme: scheme(darkMedia), darkAttrScheme: scheme(darkAttr) };
}

export function compareDarkBlocks(t: Themes): string[] {
  const problems: string[] = [];
  const keys = new Set([...t.darkMedia.keys(), ...t.darkAttr.keys()]);
  for (const k of [...keys].sort()) {
    const a = t.darkMedia.get(k);
    const b = t.darkAttr.get(k);
    if (a?.toLowerCase() !== b?.toLowerCase()) problems.push(`dark blocks differ for --pn-color-${k}: prefers-color-scheme=${a ?? "(missing)"}, [data-theme="dark"]=${b ?? "(missing)"}`);
  }
  if (t.darkMediaScheme !== t.darkAttrScheme) problems.push(`dark blocks differ in color-scheme: ${t.darkMediaScheme} vs ${t.darkAttrScheme}`);
  return problems;
}

function main(): number {
  const md = readFileSync(new URL("docs/design/design-language.md", ROOT), "utf8");
  const css = readFileSync(new URL("design/tokens.css", ROOT), "utf8");
  const pairs = parsePairs(md);
  const themes = parseTokens(css);
  const problems = compareDarkBlocks(themes);
  let fails = 0;
  const lines: string[] = [];
  for (const [name, map] of [["light", themes.light], ["dark", themes.darkAttr]] as const) {
    for (const p of pairs) {
      const fg = map.get(p.fg);
      const bg = map.get(p.bg);
      if (!fg || !bg) {
        problems.push(`${name} ${p.id}: token missing (${p.fg}=${fg ?? "?"}, ${p.bg}=${bg ?? "?"})`);
        continue;
      }
      let ratio: number;
      try {
        ratio = contrastRatio(fg, bg);
      } catch (e) {
        problems.push(`${name} ${p.id}: ${(e as Error).message}`);
        continue;
      }
      const ok = ratio >= p.target;
      if (!ok) fails++;
      lines.push(`${ok ? "ok  " : "FAIL"} ${name.padEnd(5)} ${p.id.padEnd(4)} ${`${p.fg} on ${p.bg}`.padEnd(34)} ${ratio.toFixed(2).padStart(5)}:1 (target ${p.target}:1)`);
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
  for (const p of problems) process.stderr.write(`design:contrast: ${p}\n`);
  process.stdout.write(`design:contrast: ${pairs.length} pairs x 2 themes, ${fails} below target, ${problems.length} other problem(s)\n`);
  return fails === 0 && problems.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
