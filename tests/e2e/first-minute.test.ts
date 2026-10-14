// The first minute (roadmap 0.2.0, Should 7), through the real CLI and a fresh browser:
// `practonaut` without arguments opens the bundled example at once; without Chromium it says in a
// banner that nothing is checked against the real Excalidraw yet and names the one download with its
// size. The public demonstration shows actions landing, the real tool confirming each one (or
// "model only") and the result check judging the end; it can be stopped, is never the person's
// result, and no library or bench reference reaches anything the Player receives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { TOKEN_HEADER } from '../../src/host/protocol.ts';
import { headlessShellMegabytes } from '../../src/cli/chromium-download.ts';
import { scanForHiddenReferences, hiddenReferenceMarkers } from '../support/oracle-scan.ts';
import { PLAYER_STATES, startPlayer } from '../support/player-states.ts';

const main = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

interface Started { child: ChildProcessWithoutNullStreams; url: string; tokenFile: string; output(): string; startedAt: number; stop(): Promise<number | null> }
/** `practonaut --no-open`, exactly as `npx practonaut` starts it, minus the browser launch. */
async function practonaut(env: NodeJS.ProcessEnv): Promise<Started> {
  const startedAt = performance.now();
  const child = spawn(process.execPath, [main, '--no-open'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
  const deadline = Date.now() + 60_000;
  while (!/^Open: (http:\/\/127\.0\.0\.1:\d+\/#code=[0-9a-f]{32})$/m.test(stdout)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`practonaut did not print its link:\n${stdout}\n${stderr}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return { child, startedAt, url: /^Open: (\S+)$/m.exec(stdout)![1]!, tokenFile: /^Token file: (.+)$/m.exec(stdout)![1]!, output: () => stdout + stderr,
    async stop() { if (child.exitCode !== null) return child.exitCode; const exit = new Promise<number | null>(resolve => child.once('exit', resolve)); child.kill('SIGINT'); return exit; } };
}
interface Watched { page: Page; external: string[]; captured: Array<{ where: string; text: string }>; done(): Promise<void> }
/** A fresh profile; requests leaving 127.0.0.1 are blocked and counted; every reply, asset and event the Player receives is kept for the scan. */
async function open(browser: Browser, started: Started): Promise<Watched> {
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce', viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const external: string[] = [], captured: Array<{ where: string; text: string }> = [], pending: Promise<void>[] = [];
  await context.route('**/*', async route => { const target = new URL(route.request().url()); if (target.hostname !== '127.0.0.1') { external.push(target.href); await route.abort(); } else await route.continue(); });
  const page = await context.newPage();
  // Every reply but the event stream (it never ends); the stream is read the same way below.
  page.on('response', response => { if (new URL(response.url()).pathname === '/api/events') return; pending.push(response.body().then(body => { captured.push({ where: `${response.request().method()} ${new URL(response.url()).pathname}`, text: body.toString('utf8') }); }, () => {})); });
  const token = (await readFile(started.tokenFile, 'utf8')).trim();
  const origin = new URL(started.url).origin, stream = new AbortController();
  const events = fetch(origin + '/api/events', { headers: { [TOKEN_HEADER]: token }, signal: stream.signal }).then(async response => {
    const reader = response.body!.getReader(), decoder = new TextDecoder(); let text = '';
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value, { stream: true }); } } catch { /* aborted at the end */ }
    captured.push({ where: 'event stream', text });
  });
  await page.goto(started.url); await page.getByTestId('board').waitFor();
  return { page, external, captured, async done() { stream.abort(); await events; await Promise.all(pending); await context.close(); } };
}
const steps = (page: Page) => page.locator('svg [data-object-type="step"]');

/** Starts the demonstration from its button and returns the milliseconds from `since` to its first step on the board. */
async function watch(page: Page, since: number): Promise<number> {
  await page.getByTestId('demo-start').click();
  await steps(page).first().waitFor();
  return performance.now() - since;
}

test('without Chromium: the Player opens at once, says what is not checked yet, and the demonstration plays, stops and is never the person\'s result', { timeout: 180_000 }, async () => {
  const empty = await mkdtemp(join(await realpath(tmpdir()), 'pn-no-browsers-'));
  const started = await practonaut({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty });
  let browser: Browser | undefined;
  try {
    const size = headlessShellMegabytes();
    assert.match(started.output(), /^Mode: model-only/m);
    assert.match(started.output(), new RegExp(`Run practonaut setup once to enable the mirror \\(one download: Chromium headless shell, about ${size} MB\\)`));
    browser = await chromium.launch({ headless: true });
    const watched = await open(browser, started);
    const { page } = watched;
    const banner = page.getByTestId('model-only-banner');
    assert.equal(await banner.getByText('Not yet checked against the real Excalidraw').count(), 1);
    assert.match(await banner.innerText(), new RegExp(`run practonaut setup once \\(one download: Chromium headless shell, about ${size} MB\\), then start Practonaut again`));
    assert.equal(await page.getByTestId('task-picker').innerText().then(text => text.includes('Build the flow')), true, 'the example opens on its first task');
    assert.equal(await steps(page).count(), 0, 'the board starts empty');

    const firstAction = await watch(page, started.startedAt);
    console.log(`first demonstration action ${Math.round(firstAction)} ms after the command (model-only, source CLI)`);
    const card = page.getByTestId('demonstration');
    await card.and(page.locator('[data-state=finished]')).waitFor({ timeout: 30_000 });
    // Actions landed: the three steps and two arrows of the task's goal, each a Demonstration entry.
    assert.equal(await steps(page).count(), 3);
    assert.equal(await page.getByTestId('connection-list').getByRole('button').count(), 2);
    assert.deepEqual(await page.getByTestId('history-actor').allInnerTexts(), Array(5).fill('Demonstration'));
    assert.equal(await page.getByTestId('demo-actions').innerText().then(text => text.includes('5 of 5 actions on the board')), true);
    // Confirmation state: this session has no real tool, and says so instead of claiming it.
    assert.match(await page.getByTestId('demo-mirror').innerText(), /Model only: not checked in the real Excalidraw/);
    // The result check's verdict, labelled as the demonstration's.
    assert.match(await page.getByTestId('demo-check').innerText(), /All conditions met\./);
    assert.match(await page.locator('.verdict.pass').innerText(), /All conditions met\./);
    assert.equal(await page.getByTestId('demo-verdict-note').count(), 1);
    assert.equal(await page.getByTestId('export-prepare').isDisabled(), true, 'its board cannot be saved as a result (here the session cannot export at all)');
    assert.equal(await page.getByTestId('goal-new-variant').count(), 0, 'its pass is not the person\'s pass');

    // The person's own attempt starts from the task's start.
    await page.getByTestId('demo-own-attempt').click();
    await card.waitFor({ state: 'detached' });
    assert.equal(await steps(page).count(), 0); assert.equal(await page.getByTestId('history-entry').count(), 0);
    assert.equal(await page.getByTestId('model-only-banner').count(), 1, 'the banner stays for the whole session');

    // Stopped after its first action, it does not go on.
    await page.getByTestId('demo-start').click();
    await steps(page).first().waitFor();
    await page.keyboard.press('Escape');
    await card.and(page.locator('[data-state=stopped]')).waitFor();
    const after = await page.getByTestId('history-entry').count();
    await page.waitForTimeout(2500);
    assert.equal(await page.getByTestId('history-entry').count(), after, 'no action after the stop');
    assert.ok(after >= 1 && after < 5);
    assert.match(await page.getByTestId('demo-check').innerText(), /Not checked: the demonstration was stopped/);

    await watched.done();
    // Nothing the Player received carries a library or bench reference; the scan finds a planted one.
    assert.ok(watched.captured.some(item => item.where === 'GET /player.js') && watched.captured.some(item => item.where === 'event stream'), 'assets and events were captured');
    assert.deepEqual(scanForHiddenReferences(watched.captured), []);
    const marker = hiddenReferenceMarkers().find(item => item.source.startsWith('restyle-flow: reference steps'))!;
    const planted = watched.captured.map((item, index) => index === 0 ? { ...item, text: item.text + marker.text } : item);
    assert.deepEqual(scanForHiddenReferences(planted).map(finding => finding.source), [marker.source]);
    assert.deepEqual(watched.external, [], 'no request left 127.0.0.1');
  } finally {
    await browser?.close();
    assert.equal(await started.stop(), 0);
    await rm(empty, { recursive: true, force: true });
  }
});

test('in the real editor the demonstration\'s board refuses an edit and says why in words, not a code', { timeout: 180_000 }, async () => {
  const s = await startPlayer();
  try {
    await PLAYER_STATES.find(state => state.id === 'editor-demonstration')!.enter(s);
    const status = await s.page.getByTestId('phase3-status').innerText();
    assert.match(status, /This board belongs to the demonstration\. Start your own attempt to work on it\./);
    assert.doesNotMatch(status, /demonstration_attempt/);
    assert.equal((await s.observe()).history.every(item => item.actor.kind === 'demonstration'), true, 'the edit did not land');
  } finally { await s.close(); }
});

test('with the real engine: no banner, and the real Excalidraw confirms every demonstrated action before the verdict', { timeout: 180_000 }, async () => {
  const started = await practonaut(process.env);
  let browser: Browser | undefined;
  try {
    assert.match(started.output(), /^Mode: real-engine$/m, 'Chromium is installed in this environment');
    browser = await chromium.launch({ headless: true });
    const watched = await open(browser, started);
    const { page } = watched;
    assert.equal(await page.getByTestId('model-only-banner').count(), 0);
    const firstAction = await watch(page, started.startedAt);
    console.log(`first demonstration action ${Math.round(firstAction)} ms after the command (real engine, source CLI)`);
    await page.getByTestId('demonstration').and(page.locator('[data-state=finished]')).waitFor({ timeout: 60_000 });
    assert.match(await page.getByTestId('demo-mirror').innerText(), /5 of 5 confirmed in the real Excalidraw/);
    assert.match(await page.getByTestId('demo-check').innerText(), /All conditions met\./);
    assert.equal(await page.getByTestId('export-demonstration').count(), 1, 'its board cannot be saved as a result');
    assert.equal(await page.getByTestId('export-prepare').isDisabled(), true);
    const token = (await readFile(started.tokenFile, 'utf8')).trim();
    const view = (await (await fetch(new URL(started.url).origin + '/api/observe', { headers: { [TOKEN_HEADER]: token } })).json()).value;
    assert.deepEqual(view.history.map((item: { mirrorConfirmed: boolean; actor: { kind: string } }) => [item.actor.kind, item.mirrorConfirmed]), Array(5).fill(['demonstration', true]));
    assert.equal(view.result.mode, 'real-engine'); assert.equal(view.result.passed, true);
    await watched.done();
    assert.deepEqual(scanForHiddenReferences(watched.captured), []);
    assert.deepEqual(watched.external, []);
  } finally {
    await browser?.close();
    assert.equal(await started.stop(), 0);
  }
});
