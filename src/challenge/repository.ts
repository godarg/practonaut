/**
 * Where a repository's local release ledger lives (PADR-0042 amended): one per user and repository,
 * under PRACTONAUT_HOME, keyed by the repository's identity — its normalised `origin` URL and its root
 * commit — so every clone and every worktree of one repository on one machine share one ledger and one
 * lock. A second machine, or a second user with another PRACTONAUT_HOME, is not seen here: the
 * committed copy and its history catch that only once the other side pushes. Reads git without a shell.
 */
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { RELEASE } from './ledger.ts';

const git = (cwd: string, args: string[]): string | null => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }).trim(); }
  catch { return null; }
};

/**
 * A remote URL as one repository is reached under every spelling: no scheme, no user or password, the
 * host in lower case, no trailing slash and no `.git`; an scp-like `user@host:path` reads as
 * `host/path`; a local path (or `file://` URL) is made absolute against `cwd`, with forward slashes.
 */
export function normaliseRemote(url: string, cwd = process.cwd()): string {
  let value = url.trim().replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(value);
  if (scheme && scheme[1]!.toLowerCase() !== 'file') {
    const rest = scheme[2]!, slash = rest.indexOf('/');
    const authority = (slash < 0 ? rest : rest.slice(0, slash)).replace(/^.*@/, '').toLowerCase();
    return authority + (slash < 0 ? '' : rest.slice(slash).replace(/\/{2,}/g, '/'));
  }
  if (scheme) value = decodeURIComponent(scheme[2]!).replace(/^localhost\//, '/');
  // scp-like: [user@]host:path, where the host has no slash and is not a Windows drive letter.
  const scp = /^(?:[^@/\\]+@)?([^:/\\]+):(?!\/\/)(.+)$/.exec(value);
  if (!scheme && scp && scp[1]!.length > 1) return `${scp[1]!.toLowerCase()}/${scp[2]!.replace(/^\/+/, '')}`;
  return (isAbsolute(value) ? resolve(value) : resolve(cwd, value)).replaceAll('\\', '/');
}

export interface RepositoryIdentity { origin: string | null; root: string; key: string }
/** The repository of `cwd`: its normalised origin URL (null without one), its root commit (the first in
 * byte order when it has several) and the key both give; null outside a repository or without a commit. */
export function repositoryIdentity(cwd: string): RepositoryIdentity | null {
  const roots = git(cwd, ['rev-list', '--max-parents=0', 'HEAD']);
  if (roots === null || roots === '') return null;
  const root = roots.split('\n').filter(Boolean).sort()[0]!;
  const remote = git(cwd, ['remote', 'get-url', 'origin']);
  const origin = remote ? normaliseRemote(remote, cwd) : null;
  return { origin, root, key: sha256Hex(canonicalJson({ ledger: 'practonaut.release-ledger-home/1', origin, root })).slice(0, 24) };
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
