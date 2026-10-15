/**
 * Git facts about a round declaration (PADR-0040, second review B-B): before a held-out set is
 * generated, its declaration must be committed, unchanged in the working tree and contained in a
 * remote-tracking branch (pushed), and at the gate it must still be so and have exactly one version
 * in the history. Reads only; runs `git` without a shell in the declaration's own repository.
 */
import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { realpathSync } from 'node:fs';

export class DeclarationGitError extends Error {
  readonly code = 'declaration_not_committed';
  constructor(message: string) { super(message); this.name = 'DeclarationGitError'; }
}

const git = (cwd: string, args: string[]): { ok: boolean; out: string } => {
  try { return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }) }; }
  catch (error) { return { ok: false, out: String((error as { stdout?: unknown }).stdout ?? '') }; }
};

/**
 * The file's folder, its name and its path in the repository as git spells it (relative to the top
 * level, with forward slashes), or null outside a repository. Git says where the file is, not the
 * path as given: one spelled otherwise than git's top level (an 8.3 short name or backslashes on
 * Windows, another letter case on a case-insensitive disk) still names the file. Every command runs
 * in the file's folder and names the file by a top-anchored literal pathspec.
 */
function located(path: string): { folder: string; name: string; rel: string; spec: string } | null {
  const file = realpathSync(path), folder = dirname(file), name = basename(file);
  const prefix = git(folder, ['rev-parse', '--show-prefix']);
  if (!prefix.ok) return null;
  const rel = prefix.out.trim() + name;
  return { folder, name, rel, spec: `:(top,literal)${rel}` };
}

/** The commit that holds the declaration as it is now, and how many versions of it git has. Refuses
 * a declaration outside a repository, not committed, changed since its commit (staged or not) or
 * whose commit no remote-tracking branch contains. */
export function declarationCommit(path: string): { commit: string; versions: number } {
  const at = located(path), name = basename(path);
  if (!at) throw new DeclarationGitError(`${name} is not in a git repository; commit and push it first`);
  if (!git(at.folder, ['ls-files', '--error-unmatch', '--', at.spec]).ok) throw new DeclarationGitError(`${name} is not committed; commit and push it first`);
  if (!git(at.folder, ['diff', '--quiet', 'HEAD', '--', at.spec]).ok) throw new DeclarationGitError(`${name} has changes that are not committed`);
  const history = git(at.folder, ['log', '--format=%H', '--', at.spec]);
  const commits = history.out.split('\n').filter(Boolean);
  if (!history.ok || !commits.length) throw new DeclarationGitError(`${name} has no commit`);
  const commit = commits[0]!;
  const remote = git(at.folder, ['branch', '-r', '--contains', commit]);
  if (!remote.ok || !remote.out.trim()) throw new DeclarationGitError(`${name} is committed in ${commit.slice(0, 12)}, which no remote-tracking branch contains; push it first`);
  return { commit, versions: commits.length };
}
/** Every committed version of the declaration file, newest first: commit and committer date. */
export function declarationVersions(path: string): Array<{ commit: string; date: string }> {
  const at = located(path);
  if (!at) return [];
  const listed = git(at.folder, ['log', '--format=%H %cI', '--', at.spec]);
  return listed.ok ? listed.out.split('\n').filter(Boolean).map(line => { const [commit, date] = line.split(' '); return { commit: commit!, date: date ?? '' }; }) : [];
}
/** The declaration file's content in a commit, or null when the commit or the file is not there. */
export function declarationAtCommit(path: string, commit: string): string | null {
  const at = located(path);
  if (!at || !/^[0-9a-f]{40}$/.test(commit)) return null;
  const shown = git(at.folder, ['show', `${commit}:${at.rel}`]);
  return shown.ok ? shown.out : null;
}
/** Whether a remote-tracking branch contains the commit (it was pushed and stays reachable). */
export function commitPushed(path: string, commit: string): boolean {
  const at = located(path);
  if (!at || !/^[0-9a-f]{40}$/.test(commit)) return false;
  const remote = git(at.folder, ['branch', '-r', '--contains', commit]);
  return remote.ok && remote.out.trim() !== '';
}

/** The committed files of a folder (names only), for counting earlier rounds. */
export function committedFiles(folder: string): string[] {
  const listed = git(folder, ['ls-files', '--', '.']);
  return listed.ok ? listed.out.split('\n').filter(Boolean).map(value => basename(value)) : [];
}
