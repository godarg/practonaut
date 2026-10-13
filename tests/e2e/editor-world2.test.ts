import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Frame, type Page } from 'playwright';
import { loadLibrary } from '../../src/library/index.ts';
import { startHost } from '../../src/host/server.ts';
import { TOKEN_HEADER, type HostReply, type HostView } from '../../src/host/protocol.ts';
import type { Action, StepV2 } from '../../src/world/types.ts';

const { world: library } = loadLibrary();
// The expected native values come from Excalidraw 0.18.1's own colour picker (first row), not from the player.
const STROKE = { black: '#1e1e1e', red: '#e03131', green: '#2f9e44', blue: '#1971c2', orange: '#f08c00' } as const;
const FILL = { none: 'transparent', red: '#ffc9c9', green: '#b2f2bb', blue: '#a5d8ff', yellow: '#ffec99' } as const;
interface Native { id: string; type: string; isDeleted: boolean; width: number; height: number; strokeColor: string; backgroundColor: string; groupIds: string[]; containerId?: string | null; originalText?: string }

async function editorFrame(page: Page): Promise<Frame> {
  const handle = await page.getByTestId('real-editor').elementHandle(); const frame = await handle!.contentFrame(); assert.ok(frame);
  await frame.waitForFunction(() => !!(window as unknown as { __pnEditor: unknown }).__pnEditor);
  return frame;
}
const nativeOf = (frame: Frame, id: string): Promise<Native | undefined> => frame.evaluate(id => (window as unknown as { __pnEditor: { read(): Native[] } }).__pnEditor.read().find(e => e.id === id && !e.isDeleted), id);

test('the Excalidraw tab opens after every world/2 style change and shows that state', { timeout: 240_000 }, async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'pn-editor-v2-'));
  const host = await startHost(library, { phase3: true, taskId: 'restyle-flow', seed: 42, localDirectory: directory, tokenDirectory: join(directory, 'credentials') });
  const browser = await chromium.launch({ headless: true });
  const call = async <T>(route: string, payload?: unknown): Promise<T> => {
    const reply = await (await fetch(`${host.origin}/api/${route}`, { method: payload === undefined ? 'GET' : 'POST', headers: { [TOKEN_HEADER]: host.token, 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) })).json() as HostReply<T>;
    assert.equal(reply.ok, true, JSON.stringify(reply)); return (reply as { ok: true; value: T }).value;
  };
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })).newPage();
    await page.goto(host.url); await page.getByTestId('phase3').waitFor();
    await page.getByTestId('phase3-status').filter({ hasText: /ready|bereit/ }).waitFor({ timeout: 20_000 });
    await page.getByTestId('language-en').click();
    const start = await call<HostView>('observe');
    const steps = Object.values(start.state.objects).filter((o): o is StepV2 => o.type === 'step' && !o.deleted).sort((a, b) => a.x - b.x);
    const [first, second] = [steps[0]!, steps[1]!];
    const changes: Array<{ name: string; action: Action; see(native: Native, all: Native[]): void }> = [
      { name: 'shape', action: { name: 'set_style', params: { id: first.id, shape: 'ellipse', stroke: first.stroke, fill: first.fill } }, see: n => assert.equal(n.type, 'ellipse') },
      { name: 'stroke', action: { name: 'set_style', params: { id: first.id, shape: 'ellipse', stroke: 'red', fill: first.fill } }, see: n => assert.equal(n.strokeColor, STROKE.red) },
      { name: 'fill', action: { name: 'set_style', params: { id: second.id, shape: 'diamond', stroke: 'blue', fill: 'green' } }, see: (_n, all) => { const d = all.find(e => e.id === second.id)!; assert.deepEqual([d.type, d.strokeColor, d.backgroundColor], ['diamond', STROKE.blue, FILL.green]); } },
      { name: 'group', action: { name: 'group_steps', params: { id: first.id, with: second.id } }, see: (n, all) => { assert.equal(n.groupIds.length, 1); assert.deepEqual(all.find(e => e.id === second.id)!.groupIds, n.groupIds); } },
      { name: 'resize', action: { name: 'resize_step', params: { id: first.id, width: 260, height: 120 } }, see: n => assert.deepEqual([n.width, n.height], [260, 120]) },
    ];
    for (const change of changes) {
      const before = await call<HostView>('observe');
      await call('act', { expectedRevision: before.revision, action: { ...change.action, baseStep: before.step } });
      // The practice view takes the change from the event stream; then the tab is opened as a person would.
      await page.waitForFunction(revision => (document.querySelector('.history-list')?.children.length ?? 0) === revision, (await call<HostView>('observe')).history.length);
      await page.getByTestId('mode-editor').click();
      await page.waitForFunction(() => document.body.dataset.workspace === 'editor', undefined, { timeout: 20_000 }).catch(async error => {
        throw new Error(`${change.name}: the Excalidraw tab did not open (${await page.getByTestId('phase3-status').innerText()})`, { cause: error });
      });
      const frame = await editorFrame(page);
      const all = await frame.evaluate(() => (window as unknown as { __pnEditor: { read(): Native[] } }).__pnEditor.read().filter(e => !e.isDeleted));
      const native = await nativeOf(frame, first.id); assert.ok(native, `${change.name}: step missing in the editor`);
      change.see(native, all);
      // "In the drawing surface now" names the steps that are really there, whatever their shape.
      const listed = await page.locator('.native-objects__list').innerText();
      for (const step of steps) assert.match(listed, new RegExp(step.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${change.name}: ${step.label} missing in the object list`);
      await page.getByTestId('mode-board').click();
      await page.waitForFunction(() => document.body.dataset.workspace === 'board');
    }
  } finally { await browser.close(); await host.close(); await rm(directory, { recursive: true, force: true }); }
});
