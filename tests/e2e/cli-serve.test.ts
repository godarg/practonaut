// The real quickstart: `practonaut serve` prints a one-use link; a fresh browser context (as the
// user's own browser would be) opens it, solves T3, exports through normal downloads and checks the
// pair independently. Runs once with the default mirror (auto) and once model-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { packWorld } from '../../src/package/index.ts';
import { TOKEN_HEADER } from '../../src/host/protocol.ts';
import { writeLauncher } from '../../src/cli/open-browser.ts';
import { pathToFileURL, fileURLToPath} from 'node:url';

const main = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const LINK = /^Open: (http:\/\/127\.0\.0\.1:\d+\/#code=([0-9a-f]{32}))$/gm;

interface Served { child: ChildProcessWithoutNullStreams; output(): string; links(): Array<{ url: string; code: string }>; stop(): Promise<number | null> }
async function serve(args: string[]): Promise<Served> {
  const child = spawn(process.execPath, [main, 'serve', 'examples/worlds/flow-diagram', '--task', 'T3', '--no-open', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += String(data); });
  child.stderr.on('data', data => { stderr += String(data); });
  const links = (): Array<{ url: string; code: string }> => [...stdout.matchAll(LINK)].map(m => ({ url: m[1]!, code: m[2]! }));
  await waitFor(() => links().length > 0 && /Ctrl\+C/.test(stdout), () => `serve did not print its link:\n${stdout}\n${stderr}`, () => child.exitCode !== null);
  return { child, output: () => stdout + stderr, links, async stop() {
    if (child.exitCode !== null) return child.exitCode;
    const exit = new Promise<number | null>(resolveExit => child.once('exit', resolveExit));
    child.kill('SIGINT'); return exit;
  } };
}
async function waitFor(ready: () => boolean, message: () => string, failed: () => boolean = () => false, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (failed() || Date.now() > deadline) throw new Error(message());
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
}
/** A context as fresh as a new browser profile; requests leaving 127.0.0.1 are counted and blocked. */
async function open(browser: Browser, url: string): Promise<{ page: Page; external: string[] }> {
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
  const external: string[] = [];
  await context.route('**/*', async route => { const target = new URL(route.request().url()); if (target.protocol !== 'file:' && target.hostname !== '127.0.0.1') { external.push(target.href); await route.abort(); } else await route.continue(); });
  const page = await context.newPage();
  await page.goto(url); await page.getByTestId('board').waitFor();
  return { page, external };
}
const object = (page: Page, id: string) => page.locator(`[data-object-id="${id}"]`).first();
async function committed(page: Page, operation: () => Promise<unknown>): Promise<void> {
  const reply = page.waitForResponse(r => r.url().endsWith('/api/act') && r.request().method() === 'POST');
  await operation();
  const body = await (await reply).json() as { ok: boolean };
  assert.equal(body.ok, true, JSON.stringify(body));
}
async function solveT3(page: Page): Promise<{ passed: boolean; mode: string }> {
  await page.getByTestId('show-connections').click();
  await object(page, 'ab').click(); await page.getByTestId('action-rewire-end').click();
  await committed(page, () => object(page, 'c').click());
  await object(page, 'bc').click(); await committed(page, () => page.getByTestId('action-delete').click());
  await object(page, 'b').click(); await committed(page, () => page.getByTestId('action-delete').click());
  const check = page.waitForResponse(r => r.url().endsWith('/api/check') && r.request().method() === 'POST');
  await page.getByTestId('check').click();
  const reply = await (await check).json() as { ok: boolean; value: { passed: boolean; mode: string } };
  assert.equal(reply.ok, true);
  return reply.value;
}
const bootstrap = (origin: string, code: string) => fetch(origin + '/api/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });

for (const mirror of ['auto', 'off'] as const) {
  test(`serve --mirror ${mirror}: printed link opens in a fresh browser, T3 is solved, the code works once`, { timeout: 150_000 }, async () => {
    const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-serve-'));
    const served = await serve(mirror === 'auto' ? [] : ['--mirror', 'off']);
    let browser: Browser | undefined;
    try {
      const [{ url, code }] = served.links() as [{ url: string; code: string }];
      const origin = new URL(url).origin;
      const out = served.output();
      // Chromium is installed in this environment, so auto resolves to the real mirror.
      assert.match(out, mirror === 'auto' ? /^Mode: real-engine$/m : /^Mode: model-only/m);
      const tokenFile = /^Token file: (.+)$/m.exec(out)![1]!;
      assert.equal(tokenFile.startsWith(process.env.PRACTONAUT_HOME!), true, 'credentials live under PRACTONAUT_HOME, not the current directory');
      const token = (await readFile(tokenFile, 'utf8')).trim();
      assert.equal(out.includes(token), false, 'the session token is never printed');
      assert.equal(url.includes(token), false);

      browser = await chromium.launch({ headless: true });
      const { page, external } = await open(browser, url);
      assert.equal(await page.evaluate(() => location.hash), '', 'the one-use code is removed from the address bar');
      assert.equal(new URL(page.url()).hash, '');
      const result = await solveT3(page);
      assert.equal(result.passed, true);
      assert.equal(result.mode === 'real-engine', mirror === 'auto');
      // A session started with --mirror off says so, and how to get the real engine instead.
      if (mirror === 'off') assert.match(await page.getByTestId('model-only-banner').innerText(), /Not yet checked against the real Excalidraw[\s\S]*started with --mirror off[\s\S]*Start Practonaut without that option/, 'the Player names the remedy');
      else assert.equal(await page.getByTestId('model-only-banner').count(), 0);

      // The used code is refused, before and after a new link was issued.
      const replay = await bootstrap(origin, code); assert.equal(replay.status, 401); assert.equal((await replay.json()).error.code, 'bootstrap_used');
      served.child.stdin.write('o\n');
      await waitFor(() => served.links().length === 2, () => 'no second link after o + Enter');
      const second = served.links()[1]!;
      assert.notEqual(second.code, code);
      // What the browser receives from `open`/`xdg-open`/`cmd start`: the private launcher file.
      const launcher = await writeLauncher(join(dir, 'launch'), second.url);
      const other = await open(browser, pathToFileURL(launcher.path).href);
      assert.equal(new URL(other.page.url()).origin, origin, 'the launcher forwards to the session');
      assert.equal(await other.page.evaluate(() => location.hash), '');
      assert.equal((await bootstrap(origin, second.code)).status, 401, 'the second link is one-use too');

      if (mirror === 'auto') {
        // Exports are normal browser downloads; the pair checks independently.
        const world = join(dir, 'flow.pnworld'); await writeFile(world, await packWorld('examples/worlds/flow-diagram'));
        await page.getByTestId('export-prepare').click(); await page.getByTestId('export-session').waitFor();
        const files: Record<string, string> = {};
        for (const which of ['session', 'native'] as const) {
          const download = page.waitForEvent('download');
          await page.getByTestId(`export-${which}`).click();
          const file = await download; files[which] = join(dir, file.suggestedFilename()); await file.saveAs(files[which]!);
        }
        const check = spawnSync(process.execPath, [main, 'check', files.native!, '--world', world, '--pair', files.session!], { encoding: 'utf8', timeout: 60_000 });
        assert.equal(check.status, 0, check.stderr);
        assert.equal(JSON.parse(check.stdout).passed, true);
      }
      assert.deepEqual([...external, ...other.external], [], 'no request left 127.0.0.1');
      const observed = await (await fetch(origin + '/api/observe', { headers: { [TOKEN_HEADER]: token } })).json();
      assert.equal(observed.value.practiceEvidence, mirror === 'auto');

      await browser.close(); browser = undefined;
      assert.equal(await served.stop(), 0, 'Ctrl+C closes cleanly');
      assert.equal(await lstat(tokenFile).then(() => false, () => true), true, 'credential removed');
      assert.equal(await fetch(origin).then(() => false, () => true), true, 'listener closed');
      assert.doesNotMatch(served.output(), /\n\s+at |node:internal/, 'no stack traces');
    } finally {
      await browser?.close();
      if (served.child.exitCode === null) served.child.kill('SIGKILL');
      await rm(dir, { recursive: true, force: true });
    }
  });
}
