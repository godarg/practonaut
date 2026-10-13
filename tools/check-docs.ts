// Documentation link check.
// 1. Every relative Markdown link in docs/**, README.md, AGENTS.md and CLAUDE.md
//    resolves to an existing file or directory (fragments and query strings are ignored;
//    http(s), mailto and pure #anchors are not checked).
// 2. Every .md file under docs/ is linked from docs/index.md. If docs/index.md does not exist,
//    the tool says exactly that instead of listing every file as unindexed.
// Exit 0 only if both hold.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCAN_FILES = ["README.md", "AGENTS.md", "CLAUDE.md"];
const SCAN_DIRS = ["docs"];

export interface Link {
  target: string;
  line: number;
}

/** Extracts link targets from Markdown, skipping fenced code blocks and inline code spans. */
export function extractLinks(markdown: string): Link[] {
  const out: Link[] = [];
  let fence: string | null = null;
  markdown.split("\n").forEach((raw, i) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (fenceMatch) {
      const marker = (fenceMatch[1] as string)[0] as string;
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      return;
    }
    if (fence !== null) return;
    const line = raw.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push({ target: m[1] as string, line: i + 1 });
    const def = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/.exec(line);
    if (def) out.push({ target: def[1] as string, line: i + 1 });
  });
  return out;
}

export function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("//");
}

function walk(dir: string, out: string[]): void {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name === "node_modules" || d.name.startsWith(".")) continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (d.isFile() && d.name.endsWith(".md")) out.push(p);
  }
}

const rel = (p: string): string => relative(ROOT, p).split(sep).join("/");

function resolveTarget(fromFile: string, target: string): string {
  const clean = decodeURI(target.split("#")[0]?.split("?")[0] ?? "");
  return resolve(dirname(fromFile), clean);
}

export function main(root: string = ROOT): number {
  const files: string[] = [];
  const notes: string[] = [];
  for (const f of SCAN_FILES) {
    const p = join(root, f);
    if (existsSync(p)) files.push(p);
    else notes.push(`${f} not present (not scanned)`);
  }
  for (const d of SCAN_DIRS) {
    const p = join(root, d);
    if (existsSync(p) && statSync(p).isDirectory()) walk(p, files);
    else notes.push(`${d}/ not present (not scanned)`);
  }

  const broken: string[] = [];
  let checked = 0;
  for (const f of files) {
    for (const link of extractLinks(readFileSync(f, "utf8"))) {
      if (isExternal(link.target)) continue;
      checked++;
      if (!existsSync(resolveTarget(f, link.target))) broken.push(`${rel(f)}:${link.line}: broken link -> ${link.target}`);
    }
  }

  const problems: string[] = [...broken];
  const indexPath = join(root, "docs", "index.md");
  if (!existsSync(indexPath)) {
    problems.push("docs/index.md is missing");
  } else {
    const indexed = new Set(extractLinks(readFileSync(indexPath, "utf8")).filter((l) => !isExternal(l.target)).map((l) => resolveTarget(indexPath, l.target)));
    const docs: string[] = [];
    walk(join(root, "docs"), docs);
    for (const d of docs) {
      if (d === indexPath) continue;
      if (!indexed.has(resolve(d))) problems.push(`${rel(d)}: not linked from docs/index.md`);
    }
  }

  for (const n of notes) process.stdout.write(`docs:check: note: ${n}\n`);
  process.stdout.write(`docs:check: ${files.length} files scanned, ${checked} relative links checked\n`);
  for (const p of problems) process.stderr.write(`docs:check: ${p}\n`);
  if (problems.length === 0) process.stdout.write("docs:check: OK\n");
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
