// A project for the 0.3.0 gate's integration tests (PADR-0042 as amended on acceptance): a temporary
// repository with a local bare remote and the committed 0.2.0 round files copied in, git with the test's
// own configuration only (tests/support/git-config.ts), a private PRACTONAUT_HOME, and a stand-in
// `claude` (tests/support/fake-claude.ts) that observes, plays a listed task's reference, hits a usage
// limit, crashes, holds or sleeps as the test asks. Every model run of a round goes through the release
// ledger's start guard (`node tools/challenge.ts bench`). Shared by tests/integration/challenge-*.test.ts.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeClaude } from './fake-claude.ts';
import { isolateGit } from './git-config.ts';
import { headerLine, nextLine, parseLedger, type LedgerRecord, type StartBody } from '../../src/challenge/ledger.ts';
import { releaseLedgerPath, repositoryIdentity } from '../../src/challenge/repository.ts';

export const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
export const TOOL = fileURLToPath(new URL('../../tools/challenge.ts', import.meta.url));
const ROUNDS_020 = fileURLToPath(new URL('../../docs/benchmarks/challenge/', import.meta.url));
export const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-5-5';
export const RELEASE_FOLDER = join('docs', 'benchmarks', 'challenge', '0.3.0');
export type Json = Record<string, any>;
export const json = async (path: string): Promise<Json> => JSON.parse(await readFile(path, 'utf8')) as Json;

/** A repository with a bare remote and the committed 0.2.0 rounds, a stand-in `claude`, and helpers. */
export async function project(dir: string) {
  // Git with the test's own configuration only: a bare remote whose HEAD named a branch that was never
  // pushed (a CI runner's `master` default) would give every clone of it an unborn HEAD.
  isolateGit();
  const bin = join(dir, 'bin'), repo = join(dir, 'repo'), remote = join(dir, 'remote.git'), state = join(dir, 'state');
  await mkdir(bin); await mkdir(state); await fakeClaude(bin);
  // The data folder by its canonical spelling (realpath, as the tool resolves it: on Windows a temporary
  // folder can be named by an 8.3 short name, RUNNER~1, that the tool prints in full).
  await mkdir(join(dir, 'home')); const home = realpathSync.native(join(dir, 'home'));
  const pathKey = Object.keys(process.env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
  const env: NodeJS.ProcessEnv = { ...process.env, PRACTONAUT_HOME: home, PN_FAKE_STATE: state, [pathKey]: bin + delimiter + (process.env[pathKey] ?? '') };
  delete env.ANTHROPIC_MODEL;
  /** git in `cwd`, with the test's configuration only. */
  const gitIn = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const git = (...args: string[]) => gitIn(repo, ...args);
  await mkdir(remote); gitIn(remote, 'init', '--bare', '--quiet');
  await mkdir(join(repo, 'docs', 'benchmarks'), { recursive: true }); git('init', '--quiet'); git('remote', 'add', 'origin', remote);
  // The 0.2.0 rounds as committed: five declarations /1 and five ledgers that counted 470 of 500.
  await cp(ROUNDS_020, join(repo, 'docs', 'benchmarks', 'challenge'), { recursive: true });
  await writeFile(join(repo, '.gitignore'), '.local/\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'start'); git('push', '--quiet', '-u', 'origin', 'main');
  const tool = (args: string[], extra: Record<string, string> = {}) => spawnSync(process.execPath, [TOOL, ...args], { cwd: repo, encoding: 'utf8', env: { ...env, ...extra } });
  /** The tool in another directory (a worktree, a clone, a subdirectory). */
  const toolIn = (cwd: string, args: string[], extra: Record<string, string> = {}) => spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: 'utf8', env: { ...env, ...extra } });
  const ok = (args: string[], extra: Record<string, string> = {}) => { const result = tool(args, extra); assert.equal(result.status, 0, `${args.slice(0, 2).join(' ')}: ${result.stderr}`); return result; };
  const benchRoot = join(home, 'bench');
  /** A bench (through the tool's guard, or the plain CLI) and the report it wrote. */
  const bench = async (args: string[], extra: Record<string, string> = {}, plain = false): Promise<{ path: string; status: number | null; stdout: string; stderr: string }> => {
    const before = new Set(await readdir(benchRoot).catch(() => [] as string[]));
    const result = plain ? spawnSync(process.execPath, [CLI, 'bench', ...args], { cwd: repo, encoding: 'utf8', env: { ...env, ...extra } }) : tool(['bench', ...args], extra);
    const created = (await readdir(benchRoot).catch(() => [] as string[])).filter(name => !before.has(name));
    return { path: created.length === 1 ? join(benchRoot, created[0]!, 'report.json') : '', status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const setArgs = (set: string, tasks?: string): string[] => ok(['args', set, ...(tasks ? ['--tasks', tasks] : [])]).stdout.trim().split(' ');
  const started = async (): Promise<string[]> => existsSync(join(state, 'started.log')) ? (await readFile(join(state, 'started.log'), 'utf8')).split('\n').filter(Boolean) : [];
  // One local ledger per user and repository, under PRACTONAUT_HOME (shared by every clone and worktree).
  const ledgerPath = releaseLedgerPath(home, repositoryIdentity(repo)!.key);
  const folder = join(repo, RELEASE_FOLDER);
  const commit = (message: string) => { git('add', '-A'); git('commit', '--quiet', '-m', message); git('push', '--quiet'); };
  /** A guarded bench started in the background (to act while it runs), and its exit. */
  const background = (args: string[], extra: Record<string, string> = {}) => {
    const child = spawn(process.execPath, [TOOL, 'bench', ...args], { cwd: repo, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = once(child, 'exit').then(([code]) => ({ status: code as number | null, stdout, stderr }));
    return { child, exited };
  };
  return { env, git, gitIn, tool, toolIn, ok, bench, background, setArgs, started, ledgerPath, folder, commit, repo, remote, home, benchRoot, state };
}
export type Project = Awaited<ReturnType<typeof project>>;

/**
 * Round 1 of repair.practonaut, ready for its pre-probe: the ledger started, the probe plan written,
 * committed and pushed, the pre-probe set generated, and the stand-in told to solve `solves` (task ids)
 * as Opus. The round files' paths are relative to the repository.
 */
export async function preProbeReady(p: Project, dir: string, solves: readonly string[] = ['repair-1', 'repair-2', 'repair-3']) {
  const plan = join(RELEASE_FOLDER, 'repair.practonaut-round-1.probe-1.plan.json'), record = join(RELEASE_FOLDER, 'repair.practonaut-round-1.probe-1.json'), declaration = join(RELEASE_FOLDER, 'repair.practonaut-round-1.declaration.json');
  p.ok(['ledger', 'init']);
  p.ok(['plan', '--unit', 'repair.practonaut', '--maintainer-approved-unit', 'repair.practonaut', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', plan]);
  p.commit('plan');
  const probeSet = join(dir, 'probe');
  p.ok(['generate', 'repair.practonaut', '--set', 'probe', '--plan', plan, '--out', probeSet]);
  const solve = join(dir, 'solve.json');
  await writeFile(solve, JSON.stringify({ oracles: join(probeSet, 'oracles'), tasks: { [OPUS]: solves } }));
  const model = { ANTHROPIC_MODEL: OPUS, PN_FAKE_MODEL: OPUS, PN_FAKE_SOLVE: solve };
  /** A guarded pre-probe bench's arguments, of all seven instances or of `tasks`. */
  const guarded = (tasks?: string): string[] => ['--purpose', 'pre-probe', '--plan', plan, '--', '--agent', 'claude-code', ...(tasks ? p.setArgs(probeSet, tasks) : p.setArgs(probeSet))];
  return { plan, record, declaration, probeSet, solve, model, guarded };
}

/** Waits until `condition` holds (polling), at most `ms`. */
export async function until(condition: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await condition()) return true; await new Promise(resolve => setTimeout(resolve, 100)); }
  return condition();
}
/** The number of records (lines) of a ledger file, 0 when there is none. */
export const records = async (path: string): Promise<number> => existsSync(path) ? (await readFile(path, 'utf8')).split('\n').filter(Boolean).length : 0;
/** A ledger of `n` counted development starts, built line by line, each chained to the one before. */
export function counted(n: number): string {
  const state = { text: headerLine(), records: [parseLedger(headerLine()).header] as LedgerRecord[] };
  for (let index = 0; index < n; index++) {
    const body: StartBody = { kind: 'start', purpose: 'development', unit: null, round: null, basis: null, toolchain: 'practonaut', rules: null, requested: 'api-key', model: OPUS, agent: 'claude-code', bench: '20261101T100000Z-0001', run: `connect-s${index + 1}-r1`, world: 'f'.repeat(64), instance: 'e'.repeat(64) };
    const { record, line } = nextLine(state, body); state.text += line; state.records.push(record);
  }
  return state.text;
}
