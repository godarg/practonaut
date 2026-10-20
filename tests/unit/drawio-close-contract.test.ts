// PADR-0050 for the draw.io adapter (decisions 2, 4, 6 and 8): the real createDrawioAdapter, on a small
// fixture archive under an injected pin, over a stand-in browser whose page answers the host page's
// protocol as draw.io would (the last diagram loaded is the one exported). The adapter starts on a slot
// of the ledger it is given, with the shell's sink as its proxy; its close and terminate pass the
// caller's deadline down and report the outcome; under the mirror, a close and a recovery come back at
// the deadline they passed down, and a mirror close stops a replacement start through its abort.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserBudgetError, BrowserLedger } from '../../src/adapters/browser/ledger.ts';
import { CloseRequested, type CloseResult } from '../../src/adapters/browser/close.ts';
import { createDrawioAdapter, type DrawioSeams } from '../../src/adapters/drawio/index.ts';
import type { XmlNode } from '../../src/adapters/drawio/writer.ts';
import { ADAPTER_REGISTRY, type AdapterRegistry } from '../../src/adapters/registry.ts';
import type { AdapterOptions } from '../../src/adapters/types.ts';
import { parseXml } from '../../src/checker/drawio.ts';
import { Session } from '../../src/core/index.ts';
import { createProductionMirror } from '../../src/host/mirror.ts';
import { createPracticeController } from '../../src/host/session.ts';
import { loadLibraryOf, taskWorld } from '../../src/library/index.ts';
import type { State } from '../../src/world/types.ts';
import { buildZip } from '../support/zipwriter.ts';
import { FakeBrowser, FakeContext, FakePage, advance, fakeChromium, flush } from '../support/fake-browser.ts';

const LAUNCH = { env: {}, platform: 'darwin' as const, memo: { unavailable: false } };
const { world: library } = loadLibraryOf('drawio');
const world = taskWorld(library, 'connect');
const initial: State = new Session(world, 0, 'connect').state;

/** The host page's protocol as draw.io answers it: a load replaces the diagram, an export returns it,
 * and the cell table is the diagram's cells. `failing` makes every call throw, as a page that broke. */
type Element = { name: string; attrs: Record<string, string>; children: Array<Element | string> };
const toNode = (element: Element): XmlNode => ({ name: element.name, attrs: { ...element.attrs }, children: element.children.filter((child): child is Element => typeof child !== 'string').map(toNode) });
class DrawioPage extends FakePage {
  xml = '<mxGraphModel><root/></mxGraphModel>';
  failing = false;
  async waitForFunction(): Promise<boolean> { return true; }
  override async evaluate(_expression: unknown, argument?: unknown): Promise<unknown> {
    if (this.failing) throw new Error('the page broke');
    if (Array.isArray(argument)) {
      const message = argument[0] as { action: string; xml?: string; format?: string };
      if (message.action === 'load') { this.xml = message.xml!; return {}; }
      if (message.action === 'export') return message.format === 'xml' ? { xml: this.xml } : { data: 'data:image/png;base64,iVBORw0KGgo=' };
    }
    if (typeof argument === 'string') {
      const model = parseXml(argument) as unknown as Element, root = model.children.find((child): child is Element => typeof child !== 'string')!;
      return { cells: root.children.filter((child): child is Element => typeof child !== 'string').map(toNode) };
    }
    return undefined;
  }
}
class DrawioContext extends FakeContext {
  override async newPage(): Promise<FakePage> { const page = new DrawioPage(); this.pages.push(page); return page; }
}
class DrawioBrowser extends FakeBrowser {
  override async newContext(): Promise<FakeContext> {
    if (this.hangNewContext) await new Promise(() => {});
    const context = new DrawioContext(this.contextClose); this.contexts.push(context); return context;
  }
  page(): DrawioPage { return this.contexts.at(-1)!.pages.at(-1) as DrawioPage; }
}

/** A fixture archive under an injected pin, so the adapter's own start reaches the browser. */
function fixture(t: TestContext): Pick<DrawioSeams, 'runtimePath' | 'pin' | 'allowlist'> {
  const archive = buildZip([{ name: 'index.html', data: Buffer.from('<!doctype html><title>stand-in</title>') }]);
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-close-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const runtimePath = join(dir, 'stand-in.war'); writeFileSync(runtimePath, archive);
  return { runtimePath, pin: { version: '0.0.1-test', asset: 'stand-in.war', size: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }, allowlist: ['index.html'] };
}
/** The registry's draw.io entry with the real factory on the test's archive, ledger and browsers. */
function drawioRegistry(t: TestContext, ledger: BrowserLedger, browsers: () => ReturnType<typeof fakeChromium>, starts: Array<{ signal: AbortSignal | undefined }> = []): AdapterRegistry {
  const seams = fixture(t);
  const create = (state: State, options: AdapterOptions = {}) => { starts.push({ signal: options.signal }); return createDrawioAdapter(state, options, undefined, { ...seams, ledger, chromium: browsers().chromium, launchContext: LAUNCH }); };
  return { drawio: { ...ADAPTER_REGISTRY.drawio, create } };
}
function sinkAnswers(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('data', data => { socket.destroy(); resolve(data.toString().startsWith('HTTP/1.1 403')); });
    socket.once('error', () => resolve(false));
  });
}
async function timed<T>(t: TestContext, promise: Promise<T>, limitMs = 40_000): Promise<{ value: T; atMs: number }> {
  let value: { v: T } | undefined;
  void promise.then(v => { value = { v }; });
  const atMs = await advance(t, () => value !== undefined, limitMs);
  assert.ok(value, `still pending after ${atMs} ms of mock time`);
  return { value: value.v, atMs };
}
const around = (atMs: number, expected: number): void => assert.ok(atMs >= expected && atMs <= expected + 500, `settled at ${atMs} ms, expected ${expected} ms`);

test('the draw.io adapter starts on a slot of the budget with the shell\'s sink as its proxy; close and terminate pass the caller\'s deadline down and come back abandoned there', async t => {
  const ledger = new BrowserLedger(), seams = fixture(t);
  for (const method of ['terminate', 'close'] as const) {
    const fake = fakeChromium(new DrawioBrowser('held'));
    const adapter = await createDrawioAdapter(initial, {}, undefined, { ...seams, ledger, chromium: fake.chromium, launchContext: LAUNCH });
    assert.deepEqual(ledger.records().at(-1)!.owner, 'mirror', 'the start took a mirror slot');
    const port = Number(new URL(fake.calls[0]!.proxy!.server).port);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    // A deadline 2 s ahead, well before the contract's default of 8 s: the adapter must hand it down.
    const { value, atMs } = await timed(t, adapter[method](performance.now() + 2_000));
    assert.deepEqual(value, { outcome: 'abandoned' }, method); around(atMs, 2_000);
    t.mock.timers.reset();
    assert.equal(ledger.records().at(-1)!.slot, 'held', `${method}: the slot stays until the end is proven`);
    assert.equal(await sinkAnswers(port), true, `${method}: the sink keeps its port while the slot is held`);
    fake.browser.closing.finish(); await flush();
    assert.deepEqual([ledger.records().at(-1)!.end, ledger.records().at(-1)!.slot], ['proven', 'proof'], method);
    await flush();
    assert.equal(await sinkAnswers(port), false, `${method}: the sink closed with the release`);
  }
  assert.equal(ledger.unreleased(), 0);
});

test('the review\'s counterexample on draw.io: the mirror\'s close and a recovery\'s dispose come back abandoned at the deadline passed down, never failed by a safety timer', async t => {
  const ledger = new BrowserLedger(), registry = drawioRegistry(t, ledger, () => fakeChromium(new DrawioBrowser('held')));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const mirror = await createProductionMirror(initial, undefined, world, registry);
  const closed = await timed(t, mirror.close(performance.now() + 2_000));
  assert.deepEqual(closed.value, { outcome: 'abandoned' }); around(closed.atMs, 2_000);
  // A recovery: the old browser's close is abandoned at the contract's 8 s, and the replacement starts.
  const browsers: DrawioBrowser[] = [];
  const recoveringRegistry = drawioRegistry(t, ledger, () => { const browser = new DrawioBrowser('held'); browsers.push(browser); return fakeChromium(browser); });
  const recovering = await createProductionMirror(initial, undefined, world, recoveringRegistry);
  browsers[0]!.page().failing = true;
  await recovering.snapshot().catch(() => undefined);
  const old: CloseResult[] = [];
  const recovery = recovering.recover(initial, result => { old.push(result); });
  recovery.catch(() => undefined); // A failure is reported by the await below, not as unhandled.
  // Part one runs on the fake clock: the old browser's close comes back abandoned at the 8 s it was given.
  const atOld = await advance(t, () => old.length > 0, 40_000);
  assert.deepEqual(old, [{ outcome: 'abandoned' }]); around(atOld, 8_000);
  // Part two, the replacement's start, waits on real reads (the archive, the sink's port) and needs no
  // timer; the fake clock stands still meanwhile. Ticking it while those reads ran made the recovery's
  // time depend on the machine (CI: 8,750 to 39,000 ms of fake time in 20 to 35 ms of real time).
  await recovery;
  assert.equal(browsers.length, 2, 'the replacement started on a slot of its own');
  assert.equal(ledger.unreleased(), 3, 'every browser whose end is not proven keeps its slot');
  for (const browser of browsers) browser.closing.finish();
  await flush();
});

test('a session close while a draw.io recovery\'s replacement is still launching: the abort reaches the adapter\'s start, the mirror settles cancelled, and the late browser goes to its one close', async t => {
  const ledger = new BrowserLedger(), starts: Array<{ signal: AbortSignal | undefined }> = [];
  const first = new DrawioBrowser(), browsers = [fakeChromium(first), fakeChromium(new DrawioBrowser(), false)];
  const registry = drawioRegistry(t, ledger, () => browsers[starts.length - 1]!, starts);
  const controller = await createPracticeController(world, { seed: 0, taskId: 'connect' }, state => createProductionMirror(state, undefined, world, registry));
  first.page().failing = true;
  const acting = controller.act({ expectedRevision: 0, action: { name: 'move_step', params: { id: Object.keys(initial.objects).find(id => initial.objects[id]!.type === 'step')!, x: 900, y: 900 } } });
  for (let turn = 0; turn < 100 && browsers[1]!.calls.length === 0; turn++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(browsers[1]!.calls.length, 1, 'the replacement is launching');
  const started = performance.now();
  const result = await controller.close(started + 2_000);
  assert.ok(performance.now() - started < 1_000, 'the close did not wait for the replacement\'s start');
  assert.deepEqual(result, { outcome: 'cancelled' });
  assert.ok(starts[1]!.signal?.aborted && starts[1]!.signal.reason instanceof CloseRequested, 'the adapter\'s start received the abort with the close\'s deadline');
  assert.equal((await acting).ok, false);
  browsers[1]!.release(); await flush();
  assert.equal(browsers[1]!.browser.closing.calls, 1, 'the late replacement went to its one close');
  assert.equal(ledger.unreleased(), 0);
});

test('a draw.io start that finds the budget full waits within its launch bound and is refused by name; nothing is launched', async t => {
  const ledger = new BrowserLedger(0), fake = fakeChromium(new DrawioBrowser());
  const started = performance.now();
  // A launch bound of 5.4 s keeps 5 s for the launch: the slot wait is 0.4 s.
  await assert.rejects(createDrawioAdapter(initial, {}, undefined, { ...fixture(t), ledger, chromium: fake.chromium, launchContext: LAUNCH, launchMs: 5_400 }), (error: unknown) => error instanceof BrowserBudgetError && error.code === 'browser_budget_exhausted');
  const waited = performance.now() - started;
  assert.ok(waited >= 350 && waited < 3_000, `waited ${Math.round(waited)} ms for a slot`);
  assert.deepEqual([fake.calls.length, ledger.records().length], [0, 0], 'no browser launched, no entry left');
});
