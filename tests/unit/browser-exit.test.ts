// PADR-0050, decision 9: how a command ends while a browser's end is not proven. Its writes go out
// first, in the CLI's language; then an unreferenced timer fires 35 s after the last close request and
// calls `process.exit` if the ledger still holds an entry it has not released, so Playwright's exit
// handler ends what it still tracks. Never before the command's own shutdown has finished; for
// `practonaut mcp`, whose `main` returns at once, only after `stop()` closed the host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright-core';
import { BrowserLedger } from '../../src/adapters/browser/ledger.ts';
import { afterMain, deferCommandEnd, finishCommand, ledgerLines, resetCommandEnd } from '../../src/cli/browser-exit.ts';
import { mcpShutdown } from '../../src/cli/mcp.ts';
import { cliText, setCliLanguage } from '../../src/cli/messages.ts';
import { FakeBrowser, advance, flush } from '../support/fake-browser.ts';

/** Codex's combined path: a close that fulfils after the connection dropped, its child still alive. */
async function unproven(ledger: BrowserLedger, browser = new FakeBrowser()): Promise<FakeBrowser> {
  const lease = (await ledger.reserve('mirror', { waitMs: 15_000 }));
  await lease.launch(() => Promise.resolve({ browser: browser as unknown as Browser, sandbox: true }));
  browser.disconnect();
  assert.deepEqual(await lease.close(), { outcome: 'closed' }, 'the promise result is closed');
  return browser;
}
function recorder() {
  const events: string[] = [];
  // Signal handlers go to the recorder, never to this test process.
  const signals = new Map<string, () => void>();
  return { events, signals, settings: { write: async (text: string) => { events.push(`write ${text.trim()}`); }, flush: async () => { events.push('flush'); }, exit: (code?: number) => { events.push(`exit ${String(code)}`); },
    onSignal: (signal: string, handler: () => void) => { signals.set(signal, handler); return () => { signals.delete(signal); }; } } };
}

test('the combined path keeps the slot, and the command exits 35 s after its last close request, after its writes', async t => {
  setCliLanguage('en');
  const ledger = new BrowserLedger();
  await unproven(ledger);
  assert.equal(ledger.unreleased(), 1, 'no proof: the slot is held');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { events, settings } = recorder();
  await finishCommand({ ledger, ...settings });
  assert.deepEqual(events, [
    'flush',
    'write practonaut: browser 1 (mirror): closed; process end not proven (disconnected before its close); its slot is held until Practonaut exits; directory cleanup unconfirmed.',
  ], 'the command\'s output is flushed and the ledger reported before anything else; no promise of Playwright\'s 30 s for a browser it no longer closes');
  await advance(t, () => events.length > 2, 34_500);
  assert.equal(events.length, 2, 'no exit before 35 s');
  await advance(t, () => events.length > 2, 1_000);
  assert.equal(events[2], `exit ${String(process.exitCode)}`, 'process.exit with the command\'s own exit code');
});

test('no exit when the browser\'s end is proven before the rule fires', async t => {
  const ledger = new BrowserLedger(), browser = new FakeBrowser('held'), lease = await ledger.reserve('render-check', { waitMs: 15_000 });
  await lease.launch(() => Promise.resolve({ browser: browser as unknown as Browser, sandbox: true }));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  void lease.close();
  await advance(t, () => false, 8_000);
  const { events, settings } = recorder();
  await finishCommand({ ledger, ...settings });
  assert.match(events[2] ?? '', /Waiting for 1 browser to close/);
  browser.closing.finish(); await flush();
  await advance(t, () => false, 40_000);
  assert.equal(events.some(event => event.startsWith('exit')), false, 'a released ledger never exits the process');
});

test('the rule fires at once when 35 s have passed since the last close request; nothing is armed when all is released', async t => {
  const ledger = new BrowserLedger();
  await unproven(ledger);
  const past = performance.now() - 40_000;
  Object.defineProperty(ledger, 'lastCloseRequestAt', { get: () => past });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const late = recorder();
  await finishCommand({ ledger, ...late.settings });
  await advance(t, () => late.events.length > 3, 0); t.mock.timers.tick(0); await flush();
  assert.match(late.events.at(-1) ?? '', /^exit /);
  const empty = recorder();
  assert.equal(await finishCommand({ ledger: new BrowserLedger(), ...empty.settings }), undefined);
  assert.deepEqual(empty.events, ['flush'], 'no lines and no timer for a ledger without later outcomes');
});

test('the ledger\'s lines name each statement in German as well', async () => {
  const ledger = new BrowserLedger(), browser = new FakeBrowser('held'), lease = await ledger.reserve('report-card', { waitMs: 15_000 });
  await lease.launch(() => Promise.resolve({ browser: browser as unknown as Browser, sandbox: true }));
  const rejected = await ledger.reserve('start-check', { waitMs: 15_000 });
  await rejected.launch(() => Promise.reject(new Error('Timeout'))).catch(() => undefined);
  await lease.close(performance.now()); // Abandoned at once.
  setCliLanguage('de');
  try {
    assert.deepEqual(ledgerLines(ledger), [
      'practonaut: Browser 1 (Berichtskarte): Schließen bei Fristende aufgegeben, läuft noch; Prozessende noch nicht belegt; Aufräumen der Verzeichnisse unbestätigt.\n',
      'practonaut: Browser 2 (Startprüfung): Start abgelehnt; Prozessende nicht belegt; ein beim Start erzeugter Prozess endet womöglich noch, daher bleibt sein Platz 35 s nach der Ablehnung belegt; Aufräumen der Verzeichnisse unbestätigt.\n',
    ]);
  } finally { setCliLanguage('en'); }
  browser.closing.finish();
});

test('practonaut mcp: the command\'s end comes only after stop() closed the host, and only once', async () => {
  const order: string[] = [];
  let closeHost!: () => void;
  const stop = mcpShutdown({
    handle: { close: async () => { order.push('stdio closed'); } },
    launcher: () => ({ remove: async () => { order.push('launcher removed'); } }),
    host: { close: () => new Promise<void>(done => { closeHost = () => { order.push('host closed, token removed'); done(); }; }) },
    finish: async () => { order.push('command end'); },
  });
  const first = stop(), second = stop();
  await flush();
  assert.deepEqual(order, ['stdio closed', 'launcher removed'], 'nothing ends the command while the host is open');
  closeHost(); await Promise.all([first, second]);
  assert.deepEqual(order, ['stdio closed', 'launcher removed', 'host closed, token removed', 'command end']);
});

test('a deferred command is not finished when main returns', async () => {
  resetCommandEnd();
  const ledger = new BrowserLedger(); await unproven(ledger);
  const { events, settings } = recorder();
  const finish = deferCommandEnd({ ledger, ...settings });
  await afterMain({ ledger, ...settings });
  assert.deepEqual(events, [], 'main\'s end did nothing');
  const rule = await finish();
  assert.ok(rule, 'the deferred end armed the rule');
  rule.cancel();
  assert.equal(events.length, 2, 'the deferred end reported');
  resetCommandEnd();
});

// Review of PR #69 (Codex 1): the rule read the last close request once, when it was armed. A browser
// whose launch arrives late goes to its one close after that; the exit must still wait 35 s from it.
test('the 35 s rule follows a close requested after it was armed', async t => {
  const ledger = new BrowserLedger(); await unproven(ledger);
  let last = 0, now = 0;
  Object.defineProperty(ledger, 'lastCloseRequestAt', { get: () => last });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { events, settings } = recorder();
  await finishCommand({ ledger, ...settings, now: () => now });
  const pass = async (until: number): Promise<void> => { while (now < until) { t.mock.timers.tick(250); now += 250; await flush(); } };
  await pass(10_000);
  last = 10_000; // A late browser's one close is requested now.
  await pass(44_750);
  assert.equal(events.some(event => event.startsWith('exit')), false, 'no exit 35 s after the first request, nor before 35 s after the late one');
  await pass(45_500);
  assert.equal(events.filter(event => event.startsWith('exit')).length, 1, 'the exit comes 35 s after the latest request');
});

// Review of PR #69 (effects-5): Ctrl+C during the wait killed Node past Playwright's exit handler.
test('while the rule waits, a signal ends the command through process.exit with its signal code', async t => {
  const ledger = new BrowserLedger(); await unproven(ledger);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { events, signals, settings } = recorder();
  await finishCommand({ ledger, ...settings });
  assert.deepEqual([...signals.keys()].sort(), ['SIGHUP', 'SIGINT', 'SIGTERM']);
  signals.get('SIGINT')!();
  assert.equal(events.at(-1), 'exit 130');
  assert.equal(signals.size, 0, 'the other handlers are removed');
  await advance(t, () => false, 40_000);
  assert.equal(events.filter(event => event.startsWith('exit')).length, 1, 'the rule does not exit a second time');
  const quiet = recorder();
  await finishCommand({ ledger: new BrowserLedger(), ...quiet.settings });
  assert.equal(quiet.signals.size, 0, 'no handler when nothing is held');
});

// Review of PR #69 (effects-4): the wait line counted entries with nothing of Playwright's left.
test('the wait line counts only browsers whose close or launch still runs', async () => {
  setCliLanguage('en');
  const ledger = new BrowserLedger();
  const rejected = await ledger.reserve('start-check', { waitMs: 1 });
  await rejected.launch(() => Promise.reject(new Error('Chromium sandbox policy'))).catch(() => undefined);
  await unproven(ledger);
  const only = recorder();
  const rule = await finishCommand({ ledger, ...only.settings });
  rule?.cancel();
  assert.equal(only.events.some(event => event.includes('Waiting for')), false, 'a rejected launch and a disconnected browser are not browsers Playwright still closes');
  assert.match(only.events[1] ?? '', /launch rejected; process end not proven; a process the launch spawned may still be ending, so its slot is held for 35 s after the rejection/);
  const closing = new FakeBrowser('held'), lease = await ledger.reserve('render-check', { waitMs: 1 });
  await lease.launch(() => Promise.resolve({ browser: closing as unknown as Browser, sandbox: true }));
  void lease.close(performance.now());
  await flush();
  const one = recorder();
  (await finishCommand({ ledger, ...one.settings }))?.cancel();
  assert.equal(one.events.at(-1), 'write practonaut: Waiting for 1 browser to close; Playwright ends it within 30 s of the request.');
  closing.closing.finish();
});

// Review of PR #69 (Codex 2, contract-mcp-finish-host-open, effects-2): a failing step skipped the
// host's close, and the command's end still armed the rule with the host open.
test('practonaut mcp: every shutdown step is tried on its own, and the rule is armed only once the host closed', async () => {
  const saved = process.exitCode;
  try {
    const order: string[] = [];
    const failing = mcpShutdown({
      handle: { close: async () => { order.push('stdio'); throw new Error('stdio close failed'); } },
      launcher: () => ({ remove: async () => { order.push('launcher'); throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } }),
      host: { close: async () => { order.push('host closed'); } },
      finish: async hostClosed => { order.push(`command end, host closed: ${hostClosed}`); },
    });
    await failing();
    assert.deepEqual(order, ['stdio', 'launcher', 'host closed', 'command end, host closed: true']);
    assert.equal(process.exitCode, 3, 'the failed steps set the exit code');
    const ends: boolean[] = [];
    await mcpShutdown({ handle: { close: async () => {} }, launcher: () => undefined, host: { close: async () => { throw new Error('Session shutdown could not be fully confirmed'); } }, finish: async hostClosed => { ends.push(hostClosed); } })();
    assert.deepEqual(ends, [false], 'a host that did not close is reported as such');
    const ledger = new BrowserLedger(); await unproven(ledger);
    const { events, signals, settings } = recorder();
    assert.equal(await finishCommand({ ledger, ...settings, armExit: false }), undefined, 'no rule is armed past a host that did not close');
    assert.equal(signals.size, 0);
    assert.match(events.join('\n'), /browser 1 \(mirror\)/, 'the ledger is still reported');
  } finally { process.exitCode = saved; }
});

// Review of PR #69 (effects-9): German texts for a count of 1.
test('the budget and wait texts agree with a count of 1 in German and English', () => {
  setCliLanguage('de');
  try {
    assert.match(cliText('benchBudgetRuns', { n: 1 }), /^1 Lauf konnte nicht bewertet werden/);
    assert.match(cliText('benchBudgetRuns', { n: 2 }), /^2 Läufe konnten nicht bewertet werden/);
    assert.match(cliText('browsersWaiting', { count: 1 }), /von 1 Browser; Playwright beendet ihn spätestens/);
    assert.match(cliText('browsersWaiting', { count: 2 }), /von 2 Browsern; Playwright beendet sie spätestens/);
    assert.match(cliText('browserBudgetExhausted', { running: 7, closing: 1, budget: 8 }), /7 laufen und 1 schließt gerade/);
    assert.match(cliText('browserBudgetExhausted', { running: 1, closing: 7, budget: 8 }), /1 läuft und 7 schließen gerade/);
  } finally { setCliLanguage('en'); }
  assert.match(cliText('browsersWaiting', { count: 1 }), /Waiting for 1 browser to close; Playwright ends it within/);
});

// The real CLI, per command kind: a preload puts the combined path into the process ledger with its
// close request 40 s back and keeps Node alive as Playwright's pipes would. The command must do its
// work, end its shutdown (a host closed, its credential removed), write the ledger's lines, and only
// then exit through the rule with its own exit code.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLI = join(ROOT, 'src/cli/main.ts'), PRELOAD = join(ROOT, 'tests/support/exit-rule-preload.ts');
interface Ended { code: number | null; stdout: string; stderr: string }
async function cli(args: string[], home: string, options: { stdin?: string; interruptWhen?: RegExp } = {}): Promise<Ended> {
  // Each command its own PRACTONAUT_HOME: the credentials counted at its exit are its own.
  const own = await mkdtemp(join(home, `${args[0]}-`));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', PRELOAD, CLI, ...args], { cwd: home, env: { ...process.env, PRACTONAUT_HOME: own }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', interrupted = false;
    const limit = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${args[0]} did not exit: ${stderr}`)); }, 60_000);
    child.stdout.on('data', chunk => { stdout += chunk; if (options.interruptWhen && !interrupted && options.interruptWhen.test(stdout)) { interrupted = true; child.kill('SIGINT'); } });
    child.stderr.on('data', chunk => { stderr += chunk; });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    child.on('close', code => { clearTimeout(limit); resolve({ code, stdout, stderr }); });
  });
}
function endedThroughRule(name: string, ended: Ended): void {
  assert.equal(ended.code, 0, `${name}: ${ended.stderr}`);
  const lines = ended.stderr.split('\n');
  const ledger = lines.findIndex(line => line.includes('browser 1 (mirror): closed; process end not proven'));
  // The preload's browser disconnected before its close: nothing of Playwright's is left to wait for.
  assert.equal(lines.some(line => line.includes('Waiting for')), false, `${name}: no wait promised`);
  // Every credential under the home counts, bench runs' included (review of PR #69, effects-7).
  const exit = lines.findIndex(line => line.startsWith('[exit-rule] process.exit(0) tokens=0'));
  assert.ok(ledger >= 0 && exit > ledger, `${name}: the ledger's lines, then the exit, with no credential left:\n${ended.stderr}`);
}

test('every command kind ends through the rule only after its own shutdown (real CLI)', { timeout: 180_000 }, async () => {
  const home = await mkdtemp(join(realpathSync(tmpdir()), 'pn-exit-rule-'));
  try {
    const world = join(home, 'flow.pnworld'), actions = join(home, 'actions.json');
    await writeFile(actions, '[]');
    const packed = await cli(['pack', join(ROOT, 'examples/worlds/flow-diagram'), '--out', world, '--json'], home);
    endedThroughRule('pack', packed);
    const kinds: Array<[string, Promise<Ended>, (ended: Ended) => void]> = [
      ['validate', cli(['validate', world, '--json'], home), ended => assert.equal(JSON.parse(ended.stdout).ok, true)],
      ['run', cli(['run', world, '--seed', '1', '--actions', actions, '--mirror', 'off'], home), ended => assert.equal(JSON.parse(ended.stdout).ok, true)],
      ['tasks', cli(['tasks', 'list', '--json'], home), ended => assert.ok(ended.stdout.length > 0)],
      // practonaut mcp: main returns at once; the session ends when stdin closes and stop() has closed the host.
      ['mcp', cli(['mcp', '--task', 'connect', '--mirror', 'off'], home, { stdin: '' }), ended => assert.match(ended.stderr, /\n.*connect/)],
      ['bench', cli(['bench', '--agent', 'oracle', '--tasks', 'connect', '--mirror', 'off', '--out', join(home, 'bench.json')], home), ended => assert.match(ended.stdout, /bench\.json/)],
    ];
    // serve and play stop on Ctrl+C (POSIX: a signal to the test's own child).
    if (process.platform !== 'win32') kinds.push(['play', cli(['play', 'connect', '--no-open', '--mirror', 'off'], home, { interruptWhen: /#code=/ }), ended => assert.match(ended.stdout, /#code=/)]);
    for (const [name, running, check] of kinds) { const ended = await running; check(ended); endedThroughRule(name, ended); }
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('the real CLI names a full browser budget with the counts and the remedy, in English and German, exit 3', { timeout: 120_000 }, async () => {
  const home = await mkdtemp(join(realpathSync(tmpdir()), 'pn-budget-'));
  try {
    const world = join(home, 'flow.pnworld'), actions = join(home, 'actions.json');
    await writeFile(actions, '[]');
    assert.equal(spawnSync(process.execPath, [CLI, 'pack', join(ROOT, 'examples/worlds/flow-diagram'), '--out', world], { cwd: home, encoding: 'utf8' }).status, 0);
    const run = (...lang: string[]) => spawnSync(process.execPath, ['--import', join(ROOT, 'tests/support/budget-full-preload.ts'), CLI, ...lang, 'run', world, '--seed', '1', '--actions', actions, '--mirror', 'required'], { cwd: home, encoding: 'utf8', timeout: 60_000, env: { ...process.env, PRACTONAUT_HOME: home } });
    const english = run(), german = run('--lang', 'de');
    assert.equal(english.status, 3, english.stderr);
    assert.equal(english.stderr.trim(), 'practonaut: no browser could start: 5 running and 3 closing of 8 allowed, and none closed within the launch bound. Wait until they have closed, or restart Practonaut. [browser_budget_exhausted]');
    assert.equal(german.status, 3, german.stderr);
    assert.match(german.stderr, /kein Browser konnte starten: 5 laufen und 3 schließen gerade, 8 sind erlaubt.*Practonaut neu starten\. \[browser_budget_exhausted\]/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

// Review of PR #69 (effects-8): the bench's count of runs lost to the budget had no test.
test('a bench counts the runs it lost to the browser budget after its table, in English and German', { timeout: 180_000 }, async () => {
  const home = await mkdtemp(join(realpathSync(tmpdir()), 'pn-bench-budget-'));
  try {
    const bench = (out: string, ...lang: string[]) => spawnSync(process.execPath, ['--import', join(ROOT, 'tests/support/budget-mirror-full-preload.ts'), CLI, ...lang, 'bench', '--agent', 'oracle', '--tasks', 'connect', '--mirror', 'required', '--out', join(home, out)], { cwd: home, encoding: 'utf8', timeout: 120_000, env: { ...process.env, PRACTONAUT_HOME: home } });
    const english = bench('en.json'), german = bench('de.json', '--lang', 'de');
    assert.equal(english.status, 0, english.stderr);
    assert.match(english.stdout, /\n1 run could not be judged because no browser slot became free \(browser_budget_exhausted\); see each run's note\.\n/);
    assert.match(german.stdout, /\n1 Lauf konnte nicht bewertet werden, weil kein Browser-Platz frei wurde \(browser_budget_exhausted\)/);
    const report = JSON.parse(await readFile(join(home, 'en.json'), 'utf8')) as { sessions?: Array<{ runs: Array<{ status: string; note?: string }> }>; runs?: Array<{ status: string; note?: string }> };
    const runs = report.runs ?? report.sessions?.flatMap(session => session.runs) ?? [];
    assert.deepEqual(runs.map(run => [run.status, run.note?.startsWith('browser_budget_exhausted: ')]), [['infra_error', true]], 'the run\'s note names the budget');
  } finally { await rm(home, { recursive: true, force: true }); }
});

// Review of PR #69 (effects-4): a refused sandbox setting launched nothing, yet held a slot for 35 s
// and the command promised to wait for a browser.
test('a refused sandbox setting leaves no ledger line and no wait (doctor --adapter)', { timeout: 120_000 }, async () => {
  const home = await mkdtemp(join(realpathSync(tmpdir()), 'pn-doctor-policy-'));
  try {
    const doctor = spawnSync(process.execPath, [CLI, 'doctor', '--adapter'], { cwd: home, encoding: 'utf8', timeout: 60_000, env: { ...process.env, PRACTONAUT_HOME: home, PRACTONAUT_CHROMIUM_SANDBOX: 'yes' } });
    assert.equal(doctor.status, 3, doctor.stderr);
    assert.equal(/launch rejected|Waiting for/.test(doctor.stderr), false, doctor.stderr);
  } finally { await rm(home, { recursive: true, force: true }); }
});
