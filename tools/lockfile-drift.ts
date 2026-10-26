// Does node_modules hold what package-lock.json pins? The lockfile is the only dependency pin
// (docs/testing.md), but a pull, merge or branch switch that changes it leaves node_modules as it was
// until `npm ci` runs, and the tests then run against other dependencies than CI. Used by
// tests/unit/lockfile-drift.test.ts, `npm run doctor`, tools/measure-headless-shell.ts and the git
// hooks post-merge and post-checkout (tools/githooks).
//
//   node tools/lockfile-drift.ts   exit 0: node_modules matches package-lock.json
//                                  exit 1: the differences, remedy `npm ci`
//                                  exit 2: cannot compare (no or unreadable package-lock.json)
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** An entry of package-lock.json's `packages` (lockfileVersion 2 and 3), keyed by install path. */
export interface LockedPackage { version?: string; integrity?: string; optional?: boolean; devOptional?: boolean; link?: boolean }
/** What is installed at an install path: the version of its package.json, the integrity npm recorded. */
export interface InstalledPackage { version?: string | undefined; integrity?: string }
export interface Drift {
  path: string;
  locked?: string | undefined;
  installed?: string | undefined;
  /** missing: locked, not installed · version / integrity: installed differs · extraneous: installed, not locked. */
  reason: 'missing' | 'version' | 'integrity' | 'extraneous';
}

const installPath = (path: string): boolean => path.startsWith('node_modules/');

/**
 * The differences between the locked and the installed packages; empty when they match. An optional
 * package that npm leaves out on this platform (another os or cpu) is not missing; a linked one is
 * compared at its target.
 */
export function lockfileDrift(locked: Record<string, LockedPackage>, installed: Record<string, InstalledPackage>): Drift[] {
  const drift: Drift[] = [];
  for (const [path, entry] of Object.entries(locked)) {
    if (!installPath(path) || entry.link) continue;
    const found = Object.hasOwn(installed, path) ? installed[path] : undefined;
    if (!found) {
      if (!entry.optional && !entry.devOptional) drift.push({ path, locked: entry.version, reason: 'missing' });
    } else if (found.version !== entry.version) {
      drift.push({ path, locked: entry.version, installed: found.version, reason: 'version' });
    } else if (entry.integrity && found.integrity && found.integrity !== entry.integrity) {
      drift.push({ path, locked: entry.version, installed: found.version, reason: 'integrity' });
    }
  }
  for (const [path, found] of Object.entries(installed)) {
    if (installPath(path) && !Object.hasOwn(locked, path)) drift.push({ path, installed: found.version, reason: 'extraneous' });
  }
  return drift;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

/** The `packages` of `<root>/package-lock.json`; throws when the file is missing or has none (lockfileVersion 1). */
export function readLocked(root: string): Record<string, LockedPackage> {
  const lock = readJson(join(root, 'package-lock.json')) as { packages?: unknown };
  if (!lock.packages || typeof lock.packages !== 'object') throw new Error('package-lock.json has no "packages" (lockfileVersion 2 or later)');
  return lock.packages as Record<string, LockedPackage>;
}

/**
 * What is installed in `<root>/node_modules` at the locked paths and at the paths of npm's record of
 * its last install (node_modules/.package-lock.json), which also holds what the lockfile no longer
 * names. Versions come from the package.json files Node loads, not from npm's record; the recorded
 * integrity counts only where the record names the same version.
 */
export function readInstalled(root: string, locked: Record<string, LockedPackage>): Record<string, InstalledPackage> {
  let record: Record<string, LockedPackage> = {};
  const recordFile = join(root, 'node_modules', '.package-lock.json');
  // Absent after an install by another tool: then versions are compared and integrity is not.
  if (existsSync(recordFile)) record = ((readJson(recordFile) as { packages?: Record<string, LockedPackage> }).packages) ?? {};
  const installed: Record<string, InstalledPackage> = {};
  for (const path of new Set([...Object.keys(locked), ...Object.keys(record)])) {
    if (!installPath(path)) continue;
    const manifest = join(root, ...path.split('/'), 'package.json');
    if (!existsSync(manifest)) continue;
    const version = (readJson(manifest) as { version?: string }).version;
    const recorded = Object.hasOwn(record, path) ? record[path] : undefined;
    installed[path] = recorded?.version === version && recorded?.integrity ? { version, integrity: recorded.integrity } : { version };
  }
  return installed;
}

/** The drift of the installation in a checkout against its package-lock.json. */
export function installationDrift(root: string): Drift[] {
  const locked = readLocked(root);
  return lockfileDrift(locked, readInstalled(root, locked));
}

/** One line: how many packages differ, the first few, and the remedy. */
export function describeDrift(drift: readonly Drift[], shown = 5): string {
  const one = (d: Drift): string => {
    const name = d.path.slice('node_modules/'.length);
    if (d.reason === 'missing') return `${name} ${d.locked} not installed`;
    if (d.reason === 'extraneous') return `${name} ${d.installed} installed but not locked`;
    if (d.reason === 'integrity') return `${name} ${d.installed} installed from another archive than the locked one`;
    return `${name} ${d.installed} installed, ${d.locked} locked`;
  };
  const more = drift.length > shown ? `; ${drift.length - shown} more` : '';
  return `node_modules does not match package-lock.json (${drift.length} package${drift.length === 1 ? '' : 's'}: ${drift.slice(0, shown).map(one).join('; ')}${more}): run npm ci`;
}

/** Run as `node tools/lockfile-drift.ts`, not imported. Real paths on both sides: under a symlinked
 * checkout path a plain comparison would skip the block below and exit 0 (the hooks therefore also
 * require its output). An importer started with a script argument that is no file stays an importer. */
function invokedDirectly(): boolean {
  const script = process.argv[1];
  return !!script && existsSync(script) && realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
}

if (invokedDirectly()) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  let drift: Drift[];
  try { drift = installationDrift(root); } catch (error) {
    console.error(`lockfile-drift: cannot compare node_modules with package-lock.json: ${(error as Error).message}`);
    process.exit(2);
  }
  if (drift.length > 0) { console.error(describeDrift(drift)); process.exit(1); }
  console.log('node_modules matches package-lock.json');
}
