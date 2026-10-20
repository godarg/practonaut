/**
 * Where a repository's local release ledger lives (PADR-0042 amended): one per user and repository,
 * under PRACTONAUT_HOME, keyed by the repository's root commit alone — so every clone and every worktree
 * of one repository on one machine share one ledger and one lock, whatever directory a command runs in
 * and however (or whether) its `origin` is written. A fork shares the root commit, so its clones share
 * the same ledger too: one budget, which errs on the safe side. A second machine, or a second user with
 * another PRACTONAUT_HOME, is not seen here, and neither is a branch with an unrelated history (another
 * root commit): the committed copy and its history catch that only once the other side pushes. Reads
 * git without a shell.
 */
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { RELEASE } from './ledger.ts';

const git = (cwd: string, args: string[]): string | null => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }).trim(); }
  catch { return null; }
};

export interface RepositoryIdentity { root: string; key: string }
/** The repository of `cwd`: the root commit of HEAD's history (the first in byte order when it has
 * several) and the key it gives; null outside a repository or without a commit. Neither depends on the
 * directory `cwd` names within the repository, nor on any remote. */
export function repositoryIdentity(cwd: string): RepositoryIdentity | null {
  const roots = git(cwd, ['rev-list', '--max-parents=0', 'HEAD']);
  if (roots === null || roots === '') return null;
  const root = roots.split('\n').filter(Boolean).sort()[0]!;
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
