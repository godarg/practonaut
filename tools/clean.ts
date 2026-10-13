// npm run clean: removes generated output inside this repository, nothing else.
// Targets: dist/, coverage/, .local/demo/. Never .local/penpot or other .local data, never spike
// output, never anything outside the repository root. Idempotent.
// A target that is a symbolic link is removed as a link (its destination is untouched). If a
// parent of a target (for example .local) resolves outside the root, the tool refuses.
import { lstatSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const CLEAN_TARGETS: readonly string[] = Object.freeze(["dist", "coverage", ".local/demo"]);

function inside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel !== "" && !rel.split(sep).includes("..") && !isAbsolute(rel);
}

export function clean(rootDir: string): { removed: string[] } {
  const root = realpathSync(rootDir);
  const removed: string[] = [];
  for (const t of CLEAN_TARGETS) {
    const target = join(root, t);
    const parent = safeReal(dirname(target));
    if (parent === null) continue; // parent missing: nothing to remove
    if (parent !== root && !inside(root, parent)) throw new Error(`clean: ${t} resolves outside the repository (${relative(root, parent)}); refusing`);
    let st;
    try {
      st = lstatSync(target);
    } catch {
      continue; // already absent
    }
    if (st.isSymbolicLink()) unlinkSync(target);
    else rmSync(target, { recursive: true, force: true });
    removed.push(t);
  }
  return { removed };
}

function safeReal(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const { removed } = clean(root);
  process.stdout.write(removed.length ? `clean: removed ${removed.join(", ")}\n` : "clean: nothing to remove\n");
}
