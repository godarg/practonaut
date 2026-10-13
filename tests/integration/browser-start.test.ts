// Chromium is installed but does not start (Linux sandbox under AppArmor, missing libraries, a
// damaged download). The test builds a Playwright browser cache whose Chromium executables exist
// and exit with the Linux sandbox error, and points PLAYWRIGHT_BROWSERS_PATH at it: a real failed
// launch at the process boundary, no seam in the product. Needs the real Playwright Chromium to copy
// the layout from (this layer runs after `npm run bootstrap`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { chromium } from 'playwright-core';

const main = new URL('../../src/cli/main.ts', import.meta.url).pathname;
const FAKE = '#!/bin/sh\necho "[0101/000000.000000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox! If you are running on Ubuntu 23.10+ or another Linux distro that has disabled unprivileged user namespaces with AppArmor, see https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md" >&2\nexit 1\n';

/** A browser cache with the real layout (same revision directories and file names) and failing executables. */
async function brokenCache(): Promise<{ root: string; env: NodeJS.ProcessEnv }> {
  const real = chromium.executablePath();
  let revision = dirname(real);
  while (!/^chromium-\d+$/.test(basename(revision))) revision = dirname(revision);
  const realRoot = dirname(revision), root = await mkdtemp(join(await realpath(tmpdir()), 'pn-broken-chromium-'));
  const shellDir = basename(revision).replace('chromium-', 'chromium_headless_shell-');
  const shells = (await readdir(join(realRoot, shellDir), { recursive: true })).map(String).filter(name => /(?:^|[\\/])(?:chrome-headless-shell|headless_shell)$/.test(name));
  assert.ok(shells.length > 0, 'the real headless shell was found');
  for (const executable of [relative(realRoot, real), ...shells.map(name => join(shellDir, name))]) {
    await mkdir(dirname(join(root, executable)), { recursive: true });
    await writeFile(join(root, executable), FAKE); await chmod(join(root, executable), 0o755);
  }
  return { root, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: root } };
}

async function play(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const child = spawn(process.execPath, [main, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
  const deadline = Date.now() + 60_000;
  while (!/Open: http/.test(stdout) && child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  if (child.exitCode === null) child.kill('SIGINT');
  const code = child.exitCode ?? await new Promise<number | null>(resolve => child.once('exit', resolve));
  return { stdout, stderr, code };
}

test('installed Chromium that does not start: auto runs model-only with a clear message, required is a named error, doctor says so', { timeout: 180_000, skip: process.platform === 'win32' }, async () => {
  const { root, env } = await brokenCache();
  const home = await mkdtemp(join(await realpath(tmpdir()), 'pn-home-'));
  const withHome = { ...env, PRACTONAUT_HOME: home };
  try {
    const auto = await play(['play', 'connect', '--no-open'], withHome);
    assert.equal(auto.code, 0, auto.stderr);
    assert.match(auto.stderr, /Chromium is installed but did not start \(Chromium sandboxing failed!\), so this session runs model-only/);
    assert.match(auto.stdout, /Mode: model-only/); assert.match(auto.stdout, /Open: http:\/\/127\.0\.0\.1:\d+\/#code=/);
    assert.doesNotMatch(auto.stderr, /\n\s+at /, 'no stack trace');

    const required = spawnSync(process.execPath, [main, 'play', 'connect', '--no-open', '--mirror', 'required'], { env: withHome, encoding: 'utf8', timeout: 90_000 });
    assert.equal(required.status, 3, required.stderr);
    assert.match(required.stderr, /did not start \(Chromium sandboxing failed!\).*\[browser_start_failed\]/s); assert.match(required.stderr, /--mirror off/);
    // The catalogue message keeps its line breaks and letters; nothing of it is shown as \u{…}.
    assert.doesNotMatch(required.stderr, /\\u\{/); assert.match(required.stderr, /real Excalidraw mirror\.\n(?:On Linux|Run )/);
    const german = spawnSync(process.execPath, [main, '--lang', 'de', 'play', 'connect', '--no-open', '--mirror', 'required'], { env: withHome, encoding: 'utf8', timeout: 90_000 });
    assert.equal(german.status, 3, german.stderr); assert.match(german.stderr, /Oder --mirror off für eine reine Modellsitzung\. \[browser_start_failed\]/); assert.doesNotMatch(german.stderr, /\\u\{/);
    assert.doesNotMatch(required.stderr, /\n\s+at /);

    // The MCP self-start falls back the same way and still serves tools.
    const mcp = spawn(process.execPath, [main, 'mcp', '--task', 'excalidraw/connect'], { env: withHome, stdio: ['pipe', 'pipe', 'pipe'] });
    let mcpOut = '', mcpErr = ''; mcp.stdout.on('data', chunk => { mcpOut += String(chunk); }); mcp.stderr.on('data', chunk => { mcpErr += String(chunk); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
    const deadline = Date.now() + 60_000;
    while (!mcpOut.includes('"id":1') && mcp.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    mcp.stdin.end();
    const mcpCode = mcp.exitCode ?? await new Promise<number | null>(resolve => mcp.once('exit', resolve));
    assert.match(mcpOut, /"result":\{"protocolVersion".*"id":1/, mcpErr); assert.equal(mcpCode, 0, mcpErr);
    assert.match(mcpErr, /installed but did not start/); assert.doesNotMatch(mcpErr, /\n\s+at /);

    const doctor = spawnSync(process.execPath, [main, 'doctor', '--adapter'], { env: withHome, encoding: 'utf8', timeout: 90_000 });
    assert.equal(doctor.status, 3, doctor.stdout + doctor.stderr);
    assert.match(doctor.stdout, /FAIL\s+chromium start\s+installed but does not start: Chromium sandboxing failed!/);
    const relaxed = spawnSync(process.execPath, [main, 'doctor'], { env: withHome, encoding: 'utf8', timeout: 90_000 });
    assert.equal(relaxed.status, 0, 'without --adapter the start check only warns'); assert.match(relaxed.stdout, /warn\s+chromium start/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});

test('the real Chromium passes the start check', { timeout: 120_000 }, () => {
  const doctor = spawnSync(process.execPath, [main, 'doctor', '--adapter', '--json'], { encoding: 'utf8', timeout: 90_000 });
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  const checks = (JSON.parse(doctor.stdout) as { checks: Array<{ name: string; ok: boolean }> }).checks;
  assert.deepEqual(checks.find(check => check.name === 'chromium start'), { name: 'chromium start', required: true, ok: true, detail: 'starts (headless, sandbox on)' });
});
