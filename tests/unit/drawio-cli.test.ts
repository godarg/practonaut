// PADR-0049 decisions 1.3, 1.4, 2.1 and 7.2: a downloaded app runtime is checked before any browser
// check or start and refused by name; Chromium is started under the adapter's sandbox policy;
// `setup --app drawio` names the file, source, size and SHA-256 first, warns when the sandboxed start
// is refused, and maps its failures to named codes; `doctor --adapter` lists the runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fallbackNotice, modelOnlyNotice, resolveMirror, type MirrorProbes } from '../../src/cli/serve.ts';
import { commandSetup } from '../../src/cli/setup.ts';
import { RuntimeError } from '../../src/cli/runtime.ts';
import { runChecks } from '../../src/cli/doctor.ts';
import { DrawioInstallError } from '../../src/adapters/drawio/download.ts';
import { validateWorld } from '../../src/world/schema.ts';
import type { RuntimeStatus } from '../../src/adapters/registry.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const library = JSON.parse(readFileSync(join(root, 'tasks/excalidraw/world/world.json'), 'utf8')) as Record<string, unknown>;
const drawioRaw = { ...library, id: 'drawio-cli-test', app: { adapterId: 'drawio', versionRange: '32.4.1' }, provenance: { ...(library.provenance as object), appVersion: '32.4.1' } };
const drawioWorld = validateWorld(drawioRaw);
const excalidrawWorld = validateWorld(library);
function probes(runtime: RuntimeStatus, started = { ok: true as const, sandbox: true }) {
  const calls: string[] = [];
  const value: MirrorProbes = {
    runtime: async registration => { calls.push(`runtime:${registration.id}`); return runtime; },
    installed: async () => { calls.push('installed'); return true; },
    starts: async policy => { calls.push(`starts:${policy}`); return started as never; },
  };
  return { calls, value };
}
const missing: RuntimeStatus = { ok: false, code: 'app_runtime_missing', detail: 'the draw.io runtime is not installed' };

test('a missing or damaged draw.io runtime is refused by name before any browser check; auto runs model-only and names the setup option', async () => {
  const required = probes(missing);
  await assert.rejects(resolveMirror('required', required.value, drawioWorld), (error: unknown) => error instanceof RuntimeError && error.code === 'app_runtime_missing' && /setup --app drawio/.test(error.message) && /48442174|48,442,174/.test(error.message));
  assert.deepEqual(required.calls, ['runtime:drawio'], 'no Chromium check, no start');
  const damaged = probes({ ok: false, code: 'app_runtime_unverified', detail: 'size 12' });
  await assert.rejects(resolveMirror('required', damaged.value, drawioWorld), (error: unknown) => error instanceof RuntimeError && error.code === 'app_runtime_unverified' && /size 12/.test(error.message));
  const auto = probes(missing);
  const resolved = await resolveMirror('auto', auto.value, drawioWorld);
  assert.deepEqual([resolved.mode, resolved.fallback, resolved.reason, resolved.app], ['off', true, 'app-missing', 'drawio']);
  assert.match(fallbackNotice(resolved), /draw\.io is not installed.*setup --app drawio/s);
  const notice = modelOnlyNotice('auto', resolved);
  assert.equal(notice?.reason, 'missing'); assert.match(notice?.command ?? '', /setup --app drawio$/); assert.equal(notice?.download?.megabytes, 48);
  assert.match(notice?.download?.name ?? '', /draw\.io 32\.4\.1 \(draw\.war\)/);
});

test('Chromium is started under each adapter\'s policy; a refused sandboxed start for draw.io is browser_start_failed by name', async () => {
  const ok = probes({ ok: true });
  assert.equal((await resolveMirror('required', ok.value, drawioWorld)).mode, 'required');
  assert.deepEqual(ok.calls, ['runtime:drawio', 'installed', 'starts:required']);
  const excalidraw = probes(missing);
  await resolveMirror('required', excalidraw.value, excalidrawWorld);
  assert.deepEqual(excalidraw.calls, ['installed', 'starts:linux-fallback'], 'Excalidraw has no downloaded runtime to check');
  // A restrictive Linux: the sandboxed start is refused, and draw.io does not try without it.
  const refused = probes({ ok: true }, { ok: false, detail: 'No usable sandbox!' } as never);
  await assert.rejects(resolveMirror('required', refused.value, drawioWorld), (error: unknown) => error instanceof RuntimeError && error.code === 'browser_start_failed' && /AppArmor|sandbox/i.test(error.message));
  const auto = await resolveMirror('auto', probes({ ok: true }, { ok: false, detail: 'No usable sandbox!' } as never).value, drawioWorld);
  assert.deepEqual([auto.mode, auto.reason], ['off', 'start']);
});

async function captured(run: () => Promise<number>): Promise<{ code: number | undefined; out: string; error?: unknown }> {
  const write = process.stdout.write.bind(process.stdout), errWrite = process.stderr.write.bind(process.stderr);
  let out = '';
  process.stdout.write = ((chunk: string | Uint8Array) => { out += String(chunk); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { out += String(chunk); return true; }) as typeof process.stderr.write;
  try { return { code: await run(), out }; } catch (error) { return { code: undefined, out, error }; }
  finally { process.stdout.write = write; process.stderr.write = errWrite; }
}

test('setup --app drawio: Chromium first, the sandbox said before the download, file, source, size and SHA-256 named, failures by name', async () => {
  const order: string[] = [];
  const installed = { status: 'installed' as const, path: '/h/apps/drawio/32.4.1/draw.war', bytes: 48_442_174, sha256: 'b8'.padEnd(64, '0'), replaced: false, attempts: 1 };
  const seams = {
    home: '/h',
    chromium: async () => { order.push('chromium'); return 0; },
    starts: async (policy: string) => { order.push(`starts:${policy}`); return { ok: false as const, detail: 'No usable sandbox!' }; },
    install: async (options: { home: string; allowedSchemes: ReadonlySet<string> }) => { order.push(`install:${options.home}:${[...options.allowedSchemes].join(',')}`); return installed; },
  };
  const ran = await captured(() => commandSetup(['--app', 'drawio'], seams as never));
  assert.equal(ran.code, 0, String(ran.error));
  assert.deepEqual(order, ['chromium', 'starts:required', 'install:/h:https:']);
  const before = ran.out.slice(0, ran.out.indexOf('is ready'));
  for (const fact of ['draw.war', '48442174', 'b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820', 'https://github.com/jgraph/drawio/releases/download/v32.4.1/draw.war', 'not affiliated with, endorsed or sponsored by draw.io Ltd or draw.io AG', 'model-only']) assert.ok(before.includes(fact), fact);
  // Chromium's own setup failing stops before anything of draw.io.
  order.length = 0;
  assert.equal((await captured(() => commandSetup(['--app', 'drawio'], { ...seams, chromium: async () => 3 } as never))).code, 3);
  assert.equal(order.length, 0, 'nothing of draw.io ran');
  // Each install failure becomes a named RuntimeError (exit 3 in main).
  for (const [error, code] of [[new DrawioInstallError('app_download_failed', 'deadline', 'too slow'), 'app_download_failed'], [new DrawioInstallError('app_download_mismatch', 'sha256', 'other', { expectedBytes: 1, actualBytes: 1, expectedSha256: 'a', actualSha256: 'b' }), 'app_download_mismatch'], [new DrawioInstallError('app_install_busy', 'busy', 'busy'), 'app_install_busy']] as const) {
    const failed = await captured(() => commandSetup(['--app', 'drawio'], { ...seams, install: async () => { throw error; } } as never));
    assert.ok(failed.error instanceof RuntimeError && failed.error.code === code, code);
  }
  // --from goes through its own check; bad arguments are a usage error.
  const from = await captured(() => commandSetup(['--app', 'drawio', '--from', '/tmp/draw.war'], { ...seams, installFrom: async (file: string) => { order.push(`from:${file}`); return installed; } } as never));
  assert.equal(from.code, 0); assert.ok(order.includes('from:/tmp/draw.war'));
  for (const args of [['--app'], ['--app', 'bpmnjs'], ['--app', 'drawio', '--from'], ['--from', 'x']]) assert.equal((await captured(() => commandSetup(args, seams as never))).code, 1, args.join(' '));
});

test('doctor --adapter lists the draw.io runtime and its sandboxed start, and says the platform is not yet verified', async () => {
  const checks = await runChecks('runtime', root, true, async () => ({ ok: true, sandbox: true }), { runtime: async () => missing, platform: 'linux' });
  const runtime = checks.find(check => check.name === 'app runtime drawio');
  assert.ok(runtime); assert.equal(runtime.required, false); assert.equal(runtime.ok, false);
  assert.match(runtime.detail, /setup --app drawio/); assert.match(runtime.detail, /not yet verified on this platform/);
});

test('play a draw.io world with --mirror required and no runtime: app_runtime_missing, exit 3, before the browser check', { timeout: 120_000 }, () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-cli-'));
  try {
    const source = join(dir, 'world'); mkdirSync(source);
    writeFileSync(join(source, 'world.json'), JSON.stringify(drawioRaw));
    const result = spawnSync(process.execPath, [join(root, 'src/cli/main.ts'), 'play', source, '--mirror', 'required', '--no-open', '--json'], { cwd: dir, encoding: 'utf8', timeout: 60_000, input: '',
      // An empty home and no browsers: a command that checked Chromium first would answer browser_runtime_missing.
      env: { ...process.env, PRACTONAUT_HOME: join(dir, 'home'), PLAYWRIGHT_BROWSERS_PATH: join(dir, 'no-browsers') } });
    assert.equal(result.status, 3, result.stdout + result.stderr);
    const reply = JSON.parse((result.stdout || result.stderr).trim());
    assert.equal(reply.error.code, 'app_runtime_missing'); assert.match(reply.error.message, /setup --app drawio/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
