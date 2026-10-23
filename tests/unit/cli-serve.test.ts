// serve/play argument handling, mirror resolution and the browser-open command per platform.
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BUNDLED_WORLD, fallbackNotice, modelOnlyNotice, parseServeArguments, resolveMirror, startHostWithMirror } from '../../src/cli/serve.ts';
import { invocationName } from '../../src/cli/invocation.ts';
import { headlessShellMegabytes } from '../../src/cli/chromium-download.ts';
import { browserAdvice, launchFailureDetail, type StartResult } from '../../src/cli/browser-start.ts';
import { AdapterInitializationError } from '../../src/adapters/excalidraw/index.ts';
import type { RunningHost } from '../../src/host/protocol.ts';
import { launcherDirectory, openCommand, removeOrphanedLaunchers, writeLauncher } from '../../src/cli/open-browser.ts';
import { createTokenFile, removeOrphanedSessionFiles } from '../../src/host/token-file.ts';
import { lstat, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HELP_COMMANDS } from '../../src/cli/help.ts';
import { RuntimeError } from '../../src/cli/runtime.ts';

const main = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const cli = (args: string[], env: NodeJS.ProcessEnv = process.env) => spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', timeout: 30_000, env });
const url = 'http://127.0.0.1:4321/#code=' + 'a'.repeat(32);

test('serve defaults: bundled world, seed 42, mirror auto, browser opens', () => {
  assert.deepEqual(parseServeArguments([]), { source: BUNDLED_WORLD, seed: 42, mirror: 'auto', open: true, requireOffline: false });
  assert.deepEqual(parseServeArguments(['w', '--task', 'T3', '--seed', '-7', '--mirror', 'off', '--no-open', '--require-offline']), { source: 'w', seed: -7, taskId: 'T3', mirror: 'off', open: false, requireOffline: true });
  for (const bad of [['a', 'b'], ['--mirror', 'sometimes'], ['--no-open', '--no-open'], ['--player', 'headless'], ['--seed', 'x']]) assert.throws(() => parseServeArguments(bad), (error: unknown) => error instanceof RuntimeError && error.code === 'usage', bad.join(' '));
});

test('mirror auto falls back to model-only without Chromium or when it does not start; required refuses with a named error; off never probes', async () => {
  const probes = (installed: boolean, starts: StartResult | 'never') => ({ installed: async () => installed, starts: async (): Promise<StartResult> => { if (starts === 'never') throw new Error('must not start'); return starts; } });
  assert.deepEqual(await resolveMirror('auto', probes(true, { ok: true, sandbox: true })), { mode: 'required', fallback: false, sandbox: true, app: 'excalidraw' });
  assert.deepEqual(await resolveMirror('auto', probes(true, { ok: true, sandbox: false })), { mode: 'required', fallback: false, sandbox: false, app: 'excalidraw' });
  assert.deepEqual(await resolveMirror('auto', probes(false, 'never')), { mode: 'off', fallback: true, reason: 'missing', app: 'excalidraw' });
  assert.deepEqual(await resolveMirror('auto', probes(true, { ok: false, detail: 'No usable sandbox!' })), { mode: 'off', fallback: true, reason: 'start', detail: 'No usable sandbox!', app: 'excalidraw' });
  assert.deepEqual(await resolveMirror('required', probes(true, { ok: true, sandbox: true })), { mode: 'required', fallback: false, sandbox: true, app: 'excalidraw' });
  await assert.rejects(resolveMirror('required', probes(false, 'never')), (error: unknown) => error instanceof RuntimeError && error.code === 'browser_runtime_missing');
  await assert.rejects(resolveMirror('required', probes(true, { ok: false, detail: 'No usable sandbox!' })), (error: unknown) => error instanceof RuntimeError && error.code === 'browser_start_failed' && /did not start \(No usable sandbox!\)/.test(error.message) && /--mirror off/.test(error.message));
  assert.deepEqual(await resolveMirror('off', { installed: async () => { throw new Error('must not probe'); }, starts: async () => { throw new Error('must not probe'); } }), { mode: 'off', fallback: false });
  assert.match(fallbackNotice({ mode: 'off', fallback: true, reason: 'start', detail: 'x' }), /installed but did not start \(x\)/);
  assert.equal(fallbackNotice({ mode: 'required', fallback: false }), '');
  assert.equal(fallbackNotice({ mode: 'required', fallback: false, sandbox: true }), '');
  // A mirror without its sandbox is said in one line, with the switch that refuses it.
  const unsandboxed = fallbackNotice({ mode: 'required', fallback: false, sandbox: false });
  assert.match(unsandboxed, /without its sandbox/); assert.match(unsandboxed, /PRACTONAUT_CHROMIUM_SANDBOX=require/); assert.equal(unsandboxed.trimEnd().split('\n').length, 1);
});

test('browser start failures are reported as one telling line with platform advice', () => {
  const error = new Error('browserType.launch: Target page, context or browser has been closed\nBrowser logs:\n[pid=4711][err] [0101/000000.000000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox! If you are running on Ubuntu 23.10+ ...\n    at foo (file:///srv/app/x.js:1:1)');
  assert.match(launchFailureDetail(error), /^\[0101\/000000\.000000:FATAL:zygote_host_impl_linux\.cc\(127\)\] No usable sandbox!/);
  assert.equal(launchFailureDetail(new Error('a\u001b[2Jb')), 'a\\u{001b}[2Jb');
  assert.match(browserAdvice('linux'), /--with-deps chromium/); assert.match(browserAdvice('linux'), /AppArmor/);
  assert.doesNotMatch(browserAdvice('darwin'), /AppArmor/);
});

test('the Player learns why a session is model-only and what gets the real engine, named with its download size', async () => {
  const cli = invocationName();
  assert.deepEqual(modelOnlyNotice('auto', { mode: 'off', fallback: true, reason: 'missing' }), { reason: 'missing', command: `${cli} setup`, download: { name: 'Chromium headless shell', megabytes: headlessShellMegabytes() } });
  assert.deepEqual(modelOnlyNotice('auto', { mode: 'off', fallback: true, reason: 'start', detail: 'x' }), { reason: 'start', command: `${cli} doctor --adapter` });
  assert.deepEqual(modelOnlyNotice('off', { mode: 'off', fallback: false }), { reason: 'off' });
  assert.equal(modelOnlyNotice('auto', { mode: 'required', fallback: false }), undefined);
  // The host gets the notice of the fallback that actually happened.
  const notices: unknown[] = [];
  const fake = { url: 'u' } as unknown as RunningHost;
  await startHostWithMirror('auto', { mode: 'off', fallback: true, reason: 'missing' }, async (mode, notice) => { notices.push([mode, notice?.reason]); return fake; });
  await startHostWithMirror('off', { mode: 'off', fallback: false }, async (mode, notice) => { notices.push([mode, notice?.reason]); return fake; });
  await startHostWithMirror('auto', { mode: 'required', fallback: false }, async (mode, notice) => { notices.push([mode, notice?.reason]); if (mode === 'required') throw new AdapterInitializationError(new Error('boom'), undefined, []); return fake; });
  assert.deepEqual(notices, [['off', 'missing'], ['off', 'off'], ['required', undefined], ['off', 'start']]);
  // The terminal names the same download.
  assert.match(fallbackNotice({ mode: 'off', fallback: true, reason: 'missing' }), new RegExp(`one download: Chromium headless shell, about ${headlessShellMegabytes()} MB`));
});

test('auto keeps the session when the mirror itself fails to start; required names the failure', async () => {
  const started: string[] = [];
  const fake = { url: 'u' } as unknown as RunningHost;
  const failing = async (mode: 'required' | 'off'): Promise<RunningHost> => { started.push(mode); if (mode === 'required') throw new AdapterInitializationError(new Error('No usable sandbox!'), undefined, []); return fake; };
  const auto = await startHostWithMirror('auto', { mode: 'required', fallback: false }, failing);
  assert.deepEqual(started, ['required', 'off']); assert.deepEqual(auto.mirror, { mode: 'off', fallback: true, reason: 'start', detail: 'No usable sandbox!' });
  await assert.rejects(startHostWithMirror('required', { mode: 'required', fallback: false }, failing), (error: unknown) => error instanceof RuntimeError && error.code === 'browser_start_failed');
  // Other failures (port, file system) are not a browser problem and are not hidden.
  await assert.rejects(startHostWithMirror('auto', { mode: 'required', fallback: false }, async () => { throw Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' }); }), /EADDRINUSE/);
});

test('the default browser opens a private launcher file, so the code never appears in a process argument list', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-launch-'));
  try {
    const launcher = await writeLauncher(join(dir, 'host'), url);
    const html = await readFile(launcher.path, 'utf8');
    assert.match(html, new RegExp(`<meta http-equiv="refresh" content="0;url=${url.replace(/[.?/]/g, '\\$&')}">`));
    if (process.platform !== 'win32') { assert.equal((await lstat(launcher.path)).mode & 0o777, 0o600); assert.equal((await lstat(join(dir, 'host'))).mode & 0o777, 0o700); }
    // The launcher path in the form each platform would hand over (a Windows run also checks the
    // POSIX branches with the same file written as a POSIX path).
    const posixForm = process.platform === 'win32' ? launcher.path.replace(/^[A-Za-z]:/, '').replaceAll('\\', '/') : launcher.path;
    for (const platform of ['darwin', 'linux', 'freebsd', 'win32'] as const) {
      const { command, args } = openCommand(platform === 'win32' ? launcher.path : posixForm, platform);
      assert.equal([command, ...args].join(' ').includes('a'.repeat(32)), false, `${platform}: code in argv`);
      assert.equal(command, platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open');
    }
    assert.deepEqual(openCommand('C:\\Users\\Jo Smith\\.practonaut\\host\\open-1.html', 'win32').args, ['/c', 'start', '""', '"C:\\Users\\Jo Smith\\.practonaut\\host\\open-1.html"']);
    for (const bad of ['relative.html', '/tmp/x.sh', '/tmp/a&calc.html', '/tmp/a"b.html']) assert.throws(() => openCommand(bad, 'win32'), bad);
    await assert.rejects(writeLauncher(join(dir, 'host'), 'https://example.com/#code=' + 'a'.repeat(32)));
    await launcher.remove(); await assert.rejects(lstat(launcher.path));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('every command has --help, in English and German, exit 0', () => {
  for (const command of HELP_COMMANDS) {
    const en = cli([command, '--help']);
    assert.equal(en.status, 0, command); assert.match(en.stdout, /^Usage: practonaut /, command);
    const de = cli(['--lang', 'de', command, '--help']);
    assert.equal(de.status, 0, command); assert.match(de.stdout, /^Verwendung: practonaut /, command);
  }
  const top = cli(['--help']);
  assert.match(top.stdout, /practonaut\s+start the bundled example world \(same as: practonaut play\)/);
  assert.equal(cli(['frobnicate', '--help']).status, 1);
});

test('errors are human-readable by default and JSON with --json', () => {
  const text = cli(['check', 'x.json']);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /^practonaut: .+ \[usage\]\n$/);
  const json = cli(['check', 'x.json', '--json']);
  assert.equal(json.status, 1);
  assert.equal(JSON.parse(json.stderr).error.code, 'usage');
});

test('Linux puts the launcher under $XDG_RUNTIME_DIR, which Snap and Flatpak browsers can read; other systems keep the credential folder', async () => {
  assert.equal(launcherDirectory('/h/.practonaut/host', { XDG_RUNTIME_DIR: '/run/user/1000' }, 'linux'), '/run/user/1000/practonaut');
  assert.equal(launcherDirectory('/h/.practonaut/host', {}, 'linux'), '/h/.practonaut/host');
  assert.equal(launcherDirectory('/h/.practonaut/host', { XDG_RUNTIME_DIR: 'relative' }, 'linux'), '/h/.practonaut/host');
  assert.equal(launcherDirectory('/h/.practonaut/host', { XDG_RUNTIME_DIR: '/run/user/1000' }, 'darwin'), '/h/.practonaut/host');
});

test('files of ended sessions are removed at the next start; files of live sessions are kept', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-orphans-'));
  try {
    const host = join(dir, 'host'); await writeLauncher(host, url).then(l => l.remove());
    const hex = 'f'.repeat(32), dead = 999_999_999;
    const names = [`session-${dead}-${hex}.token`, `session-${dead}-${hex}.mirror.jsonl`, `open-${dead}-${hex}.html`, `session-${process.pid}-${'e'.repeat(32)}.token`, `session-${process.ppid}-${hex}.token`, 'session-legacy.token', 'notes.txt'];
    for (const name of names) await writeFile(join(host, name), 'x', { mode: 0o600 });
    assert.deepEqual((await removeOrphanedSessionFiles(host)).sort(), [`session-${dead}-${hex}.mirror.jsonl`, `session-${dead}-${hex}.token`]);
    assert.deepEqual(await removeOrphanedLaunchers(host), [`open-${dead}-${hex}.html`]);
    assert.deepEqual((await readdir(host)).sort(), [`session-${process.pid}-${'e'.repeat(32)}.token`, `session-${process.ppid}-${hex}.token`, 'notes.txt', 'session-legacy.token'].sort());
    // A new credential file carries its process id, so a later start can tell whether it is orphaned.
    const token = await createTokenFile(host, 't'); assert.match(token.path, new RegExp(`session-${process.pid}-[0-9a-f]{32}\\.token$`)); await token.remove();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// PADR-0050, decision 4: a full browser budget is refused as a start that fails is, but by its own name.
test('a full browser budget: required stops by name with the counts and the remedy; auto goes on model-only; bench records the reason', async () => {
  const { BrowserBudgetError } = await import('../../src/adapters/browser/ledger.ts');
  const { infraNote } = await import('../../src/bench/run.ts');
  const { budgetDetail } = await import('../../src/cli/browser-start.ts');
  const refused = new BrowserBudgetError({ running: 6, closing: 2 }, 8);
  const probes = { installed: async () => true, starts: async (): Promise<StartResult> => ({ ok: false, detail: budgetDetail(refused), budget: refused }) };
  await assert.rejects(resolveMirror('required', probes), (error: unknown) => error === refused, 'the start check\'s refusal, not browser_start_failed');
  const auto = await resolveMirror('auto', probes);
  assert.deepEqual([auto.mode, auto.reason], ['off', 'start']);
  assert.equal(auto.detail, 'browser_budget_exhausted: no browser could start: 6 running and 2 closing of 8 allowed, and none closed within the launch bound. Wait until they have closed, or restart Practonaut.');
  const started: string[] = [], fake = { url: 'u' } as unknown as RunningHost;
  const full = async (mode: 'required' | 'off'): Promise<RunningHost> => { started.push(mode); if (mode === 'required') throw refused; return fake; };
  await assert.rejects(startHostWithMirror('required', { mode: 'required', fallback: false }, full), (error: unknown) => error === refused);
  const fallback = await startHostWithMirror('auto', { mode: 'required', fallback: false }, full);
  assert.deepEqual([started, fallback.mirror.mode, fallback.mirror.detail?.startsWith('browser_budget_exhausted: ')], [['required', 'required', 'off'], 'off', true]);
  assert.match(infraNote(refused), /^browser_budget_exhausted: /, 'a bench run lost to the budget names it as its infra_error');
});

test('the start check reports a full browser budget as such, after waiting its launch bound', async t => {
  const { BrowserLedger } = await import('../../src/adapters/browser/ledger.ts');
  const { chromiumStarts } = await import('../../src/cli/browser-start.ts');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let result: StartResult | undefined, waited = 0;
  void chromiumStarts(30_000, 'linux-fallback', { chromium: { launch: async () => { throw new Error('must not launch'); } }, ledger: new BrowserLedger(0) }).then(value => { result = value; });
  const answered = (): StartResult | undefined => result;
  while (!answered() && waited < 20_000) { t.mock.timers.tick(500); waited += 500; for (let turn = 0; turn < 5; turn++) await new Promise(done => setImmediate(done)); }
  const answer = answered();
  assert.ok(answer && !answer.ok && answer.budget, 'refused as a full budget, not as a start that failed');
  assert.ok(waited >= 15_000, `it waited its launch bound (${waited} ms)`);
  assert.match(answer.detail, /^browser_budget_exhausted: no browser could start: 0 running and 0 closing of 0 allowed/);
});
