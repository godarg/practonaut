/**
 * Where a repository's local release ledger lives (PADR-0042 amended): one per user and repository,
 * under PRACTONAUT_HOME, keyed by the repository's one root commit — so every clone, every worktree and
 * every branch of one repository on one machine share one ledger and one lock, whatever directory a
 * command runs in and however (or whether) its `origin` is written. A fork shares the root commit, so
 * its clones share the same ledger too: one budget, which errs on the safe side. The root is read over
 * the whole history this clone knows — HEAD, every local and every remote-tracking branch — with git's
 * replace refs ignored; a shallow clone (whose cut-off commits git reports as roots) is refused, and a
 * history with more than one root (an orphan branch, a merge of an unrelated history, a fetched
 * unrelated remote) is refused by name: either root would give another ledger, and the tool picks none
 * silently. A second machine, or a second user with another PRACTONAUT_HOME, is not seen here: the
 * committed copy and its history catch that only once the other side pushes. Reads git without a shell.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { resolvedDataPaths } from '../platform/paths.ts';
import { RELEASE } from './ledger.ts';

/** git without a shell; replace refs never change what it reports (`git replace` is local and silent). */
const git = (cwd: string, args: string[]): string | null => {
  try { return execFileSync('git', ['--no-replace-objects', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }).trim(); }
  catch { return null; }
};

export class RepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'RepositoryError'; this.code = code; }
}

export interface RepositoryIdentity { root: string; key: string }
/** The repository of `cwd`: its one root commit over HEAD and every local and remote-tracking branch,
 * and the key it gives; null outside a repository or without a commit. Neither depends on the directory
 * `cwd` names, the branch checked out, any remote's URL or a replace ref. A shallow clone is refused
 * first (`shallow_clone`), then more than one root (`repository_roots`). */
export function repositoryIdentity(cwd: string): RepositoryIdentity | null {
  if (git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']) === null) return null;
  if (git(cwd, ['rev-parse', '--is-shallow-repository']) === 'true') throw new RepositoryError('shallow_clone', 'this repository is a shallow clone: git reports its cut-off commits as roots, and the release ledger\'s pushed versions cannot all be read (git fetch --unshallow)');
  const listed = git(cwd, ['rev-list', '--max-parents=0', 'HEAD', '--branches', '--remotes']);
  const roots = [...new Set((listed ?? '').split('\n').filter(Boolean))].sort();
  if (!roots.length) return null;
  if (roots.length > 1) throw new RepositoryError('repository_roots', `this repository's history has ${roots.length} root commits (${roots.map(root => root.slice(0, 12)).join(', ')}): an orphan branch, a merge of an unrelated history or an unrelated remote; the release ledger is keyed on the one root of a repository, and either root would give another ledger — remove the other history from this clone, or a maintainer decides`);
  const root = roots[0]!;
  return { root, key: sha256Hex(canonicalJson({ ledger: 'practonaut.release-ledger-home/2', root })).slice(0, 24) };
}
/** The local release ledger of a repository under a data folder (PRACTONAUT_HOME). */
export const releaseLedgerPath = (home: string, key: string): string => join(home, 'release-ledgers', key, `release-ledger-${RELEASE}.jsonl`);
/**
 * The local release ledger of the repository of `cwd`, as `node tools/challenge.ts` reads and writes it
 * (PADR-0042 amended): PRACTONAUT_HOME must name its folder fully on `platform`
 * (`home_not_fully_qualified`: another folder from each directory or drive otherwise), then the
 * repository's identity (`shallow_clone`, `repository_roots`; `no_repository` outside one).
 */
export async function localLedgerPath(env: NodeJS.ProcessEnv, cwd: string, platform: NodeJS.Platform = process.platform): Promise<string> {
  const configured = env.PRACTONAUT_HOME;
  if (configured !== undefined && configured !== '' && !fullyQualified(configured, platform))
    throw new RepositoryError('home_not_fully_qualified', `PRACTONAUT_HOME is not named fully (${configured}); the release ledger would be another file in every directory${platform === 'win32' ? ' or on every drive' : ''}: name it fully${platform === 'win32' ? ', with its drive or as a UNC share' : ''}`);
  const identity = repositoryIdentity(cwd);
  if (!identity) throw new RepositoryError('no_repository', 'not in a git repository with a commit: the release ledger belongs to a repository');
  return releaseLedgerPath((await resolvedDataPaths(env)).home, identity.key);
}
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
/**
 * The committed release ledger's path as git knows it: `file` relative to the checkout `top` (git's top
 * level), with forward slashes. Only the checkout root is compared by its canonical spelling (a `--folder`
 * through a symbolic link to the checkout, a short name or another letter case is the same checkout);
 * the path inside the checkout is git's as written, and no component of it may be a symbolic link
 * (`ledger_path_link`: git would read the tracked path, the file system another file). A file outside
 * the checkout is refused (`ledger_outside_repository`).
 */
export function ledgerGitPath(top: string, file: string): string {
  const root = canonicalPath(top);
  // The checkout root as `file` spells it: the farthest folder above it whose canonical path is git's top
  // level (the farthest, so that a link inside the checkout back to its root is a component, not the root).
  let at = resolve(file), found: string | null = null;
  for (;;) {
    if (canonicalPath(at) === root) found = at;
    const parent = dirname(at);
    if (parent === at) break;
    at = parent;
  }
  if (found === null || found === resolve(file)) throw new RepositoryError('ledger_outside_repository', `the committed ledger ${resolve(file)} lies outside this repository (${top}); --folder names a folder of the checkout`);
  const parts = resolve(file).slice(found.length).split(/[\\/]+/).filter(Boolean);
  let walk = found;
  for (const part of parts) {
    walk = join(walk, part);
    let link: boolean;
    try { link = lstatSync(walk).isSymbolicLink(); } catch { break; }
    if (link) throw new RepositoryError('ledger_path_link', `${walk} is a symbolic link inside the checkout: git reads the committed ledger at ${parts.join('/')}, the file system another file; remove the link`);
  }
  return parts.join('/');
}
