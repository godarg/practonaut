/**
 * Where a repository's local release ledger lives (PADR-0042 amended): one per user and repository,
 * under PRACTONAUT_HOME, keyed by the repository's one root commit — so every clone, every worktree and
 * every branch of one repository on one machine share one ledger and one lock, whatever directory a
 * command runs in and however (or whether) its `origin` is written. A fork shares the root commit, so
 * its clones share the same ledger too: one budget, which errs on the safe side. The root is read over
 * the whole history this clone knows — HEAD, every local and every remote-tracking branch — and a
 * history with more than one root (an orphan branch, a merge of an unrelated history, a fetched
 * unrelated remote) is refused by name: either root would give another ledger, and the tool picks
 * none silently. A second machine, or a second user with another PRACTONAUT_HOME, is not seen here: the
 * committed copy and its history catch that only once the other side pushes. Reads git without a shell.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, join, posix, resolve } from 'node:path';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { RELEASE } from './ledger.ts';

const git = (cwd: string, args: string[]): string | null => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }).trim(); }
  catch { return null; }
};

export class RepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'RepositoryError'; this.code = code; }
}

export interface RepositoryIdentity { root: string; key: string }
/** The repository of `cwd`: its one root commit over HEAD and every local and remote-tracking branch,
 * and the key it gives; null outside a repository or without a commit. Neither depends on the directory
 * `cwd` names, the branch checked out, or any remote's URL. More than one root is refused
 * (`repository_roots`). */
export function repositoryIdentity(cwd: string): RepositoryIdentity | null {
  if (git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']) === null) return null;
  const listed = git(cwd, ['rev-list', '--max-parents=0', 'HEAD', '--branches', '--remotes']);
  const roots = [...new Set((listed ?? '').split('\n').filter(Boolean))].sort();
  if (!roots.length) return null;
  if (roots.length > 1) throw new RepositoryError('repository_roots', `this repository's history has ${roots.length} root commits (${roots.map(root => root.slice(0, 12)).join(', ')}): an orphan branch, a merge of an unrelated history or an unrelated remote; the release ledger is keyed on the one root of a repository, and either root would give another ledger — remove the other history from this clone, or a maintainer decides`);
  const root = roots[0]!;
  return { root, key: sha256Hex(canonicalJson({ ledger: 'practonaut.release-ledger-home/2', root })).slice(0, 24) };
}
/** The local release ledger of a repository under a data folder (PRACTONAUT_HOME). */
export const releaseLedgerPath = (home: string, key: string): string => join(home, 'release-ledgers', key, `release-ledger-${RELEASE}.jsonl`);
/** Where earlier versions of the tool kept a repository's local ledger: in the git common directory,
 * and in the checkout's `.local/` folder. */
export function earlierLedgerPaths(cwd: string): string[] {
  const common = git(cwd, ['rev-parse', '--git-common-dir']), top = git(cwd, ['rev-parse', '--show-toplevel']);
  return [
    ...(common ? [join(resolve(cwd, common), 'practonaut', `release-ledger-${RELEASE}.jsonl`)] : []),
    ...(top ? [join(top, '.local', `release-ledger-${RELEASE}.jsonl`)] : []),
  ];
}

/** Whether `path` names one folder from every directory on `platform`: on Windows a drive with its root
 * (`C:\…`) or a UNC share (`\\server\share\…`) — never `\pn` or `/pn`, which name a folder on the
 * current drive, nor `C:pn`, relative to drive C's current folder; elsewhere an absolute path. */
export function fullyQualified(path: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return posix.isAbsolute(path);
  return /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/.test(path);
}
/** A path by its canonical spelling: the realpath of its longest existing part (symbolic links, short
 * names and letter case as the file system has them) and the rest as given. */
export function canonicalPath(path: string): string {
  const parts: string[] = [];
  let existing = resolve(path);
  for (;;) {
    try { return join(realpathSync.native(existing), ...parts.reverse()); }
    catch {
      const parent = resolve(existing, '..');
      if (parent === existing) return resolve(path);
      parts.push(basename(existing)); existing = parent;
    }
  }
}
