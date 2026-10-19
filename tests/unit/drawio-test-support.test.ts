// PADR-0049 decision 2.8: the draw.io layer's two test-only variables have strict values, and the layer
// skips by name ("runtime absent", "sandboxed start refused") unless it is required, when either fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DRAWIO_HOME, drawioAvailability, drawioTestRuntime } from '../support/drawio.ts';

test('PN_DRAWIO_REQUIRED is 1 or 0 (unset is 0); anything else stops the run; PN_DRAWIO_HOME is absolute', () => {
  const home = realpathSync(tmpdir());
  assert.deepEqual([drawioTestRuntime({}).required, drawioTestRuntime({}).home], [false, DEFAULT_DRAWIO_HOME]);
  assert.equal(drawioTestRuntime({ PN_DRAWIO_REQUIRED: '1', PN_DRAWIO_HOME: home }).required, true);
  assert.equal(drawioTestRuntime({ PN_DRAWIO_REQUIRED: '0', PN_DRAWIO_HOME: home }).required, false);
  for (const value of ['', 'true', 'yes', '01', ' 1']) assert.throws(() => drawioTestRuntime({ PN_DRAWIO_REQUIRED: value }), /PN_DRAWIO_REQUIRED must be 1 or 0/, JSON.stringify(value));
  assert.throws(() => drawioTestRuntime({ PN_DRAWIO_HOME: 'relative/home' }), /absolute/);
  assert.equal(drawioTestRuntime({ PN_DRAWIO_HOME: home }).runtimePath, join(home, 'apps', 'drawio', '32.4.1', 'draw.war'));
});

test('availability: an absent runtime and a refused sandboxed start skip by name, or fail when required', async () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-support-'));
  try {
    const optional = drawioTestRuntime({ PN_DRAWIO_HOME: home }), required = drawioTestRuntime({ PN_DRAWIO_HOME: home, PN_DRAWIO_REQUIRED: '1' });
    const neverStarts = async () => { throw new Error('the browser is not started before the runtime is there'); };
    const absent = await drawioAvailability(optional, neverStarts as never);
    assert.equal(absent.ok, false); assert.match(!absent.ok ? absent.skip : '', /^draw\.io runtime absent/);
    await assert.rejects(drawioAvailability(required, neverStarts as never), /PN_DRAWIO_REQUIRED=1: draw\.io runtime absent/);
    // A verified runtime and a system that refuses the sandboxed start.
    const verified = async () => ({ ok: true as const }), policies: string[] = [];
    const refused = async (_ms?: number, policy?: string) => { policies.push(String(policy)); return { ok: false as const, detail: 'No usable sandbox!' }; };
    const blocked = await drawioAvailability(optional, refused as never, verified as never);
    assert.equal(blocked.ok, false); assert.match(!blocked.ok ? blocked.skip : '', /^sandboxed Chromium start refused: No usable sandbox!/);
    assert.deepEqual(policies, ['required'], 'started under draw.io\'s own policy');
    await assert.rejects(drawioAvailability(required, refused as never, verified as never), /PN_DRAWIO_REQUIRED=1: sandboxed Chromium start refused/);
    const fine = await drawioAvailability(required, (async () => ({ ok: true, sandbox: true })) as never, verified as never);
    assert.equal(fine.ok, true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
