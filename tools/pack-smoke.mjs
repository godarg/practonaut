// Exercise installed CLI entry points. The client is the repository's pinned official SDK.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium } from 'playwright-core';
import { launchChromium } from '../src/adapters/excalidraw/chromium.ts';

const [bin, world] = process.argv.slice(2);
assert.ok(bin && world, 'usage: pack-smoke.mjs <installed-bin> <world>');
// On Windows the installed bin is a .cmd shim, which Node does not spawn without a shell; start the
// installed entry it points to with this Node instead (the shim itself is run by test-pack.sh).
const installedMain = join(dirname(bin), '..', 'practonaut', 'dist', 'cli', 'main.js');
const [command, ...prefix] = process.platform === 'win32' ? [process.execPath, installedMain] : [bin];
const serve = spawn(command, [...prefix, 'serve', world, '--seed', '42', '--task', 'T3', '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = ''; let stderr = '';
serve.stdout.on('data', bytes => { stdout += bytes.toString(); });
serve.stderr.on('data', bytes => { stderr += bytes.toString(); });
let browser; let client;
try {
  const deadline = Date.now() + 60_000;
  let origin; let tokenFile; let link;
  while (!origin || !tokenFile || !link) {
    if (serve.exitCode !== null) throw new Error('Installed serve exited before providing its session connection.');
    if (Date.now() > deadline) throw new Error('Installed serve startup timed out.');
    origin = stdout.match(/^Host origin: (http:\/\/127\.0\.0\.1:\d+)$/m)?.[1];
    tokenFile = stdout.match(/^Token file: (.+)$/m)?.[1];
    link = stdout.match(/^Open: (http:\/\/127\.0\.0\.1:\d+\/#code=[0-9a-f]{32})$/m)?.[1];
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(/[?&]token=|authorToken/i.test(stdout), false, 'the printed link carries only the one-use code in its fragment');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  assert.equal(stdout.includes(token), false, 'practice credential contents stay private');
  const resumed = await (await fetch(origin + '/api/resume', { headers: { 'X-Practonaut-Token': token } })).json();
  assert.equal(resumed.ok, true); assert.equal(Object.hasOwn(resumed.value, 'authorToken'), false); assert.equal(Object.hasOwn(resumed.value, 'token'), false);
  // Compared as real paths: Windows mixes 8.3 short names, long names and both separators.
  assert.equal(realpathSync.native(tokenFile).startsWith(realpathSync.native(process.env.PRACTONAUT_HOME)), true, 'installed CLI keeps credentials under PRACTONAUT_HOME');
  // Started like the product's mirror: sandbox first, on Linux once without it if the system refuses it.
  ({ browser } = await launchChromium(chromium, () => ({ headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false })));
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  const external = []; let bootstrapRequests = 0;
  await context.addInitScript(() => {
    window.__packCspViolations=[]; window.addEventListener('securitypolicyviolation', event => window.__packCspViolations.push({blockedURI:event.blockedURI,directive:event.effectiveDirective}));
  });
  const allowed = new Set([origin]);
  if (resumed.value.engineOrigin) { assert.match(resumed.value.engineOrigin, /^http:\/\/127\.0\.0\.1:\d+$/); allowed.add(resumed.value.engineOrigin); }
  await context.route('**/*', async route => {
    const target = new URL(route.request().url());
    if (!allowed.has(target.origin)) { external.push(true); await route.abort(); return; }
    if (target.pathname === '/api/bootstrap') bootstrapRequests++;
    await route.continue();
  });
  const page = await context.newPage();
  await page.goto(link);
  await page.getByTestId('board').waitFor();
  assert.equal(await page.evaluate(() => location.hash), '', 'the code leaves the address bar');
  assert.equal(bootstrapRequests, 1, 'exactly one bootstrap exchange');
  await page.getByTestId('mode-editor').click();
  const editorFrame=page.frames().find(frame=>frame.url().includes('/editor.html'));
  assert.ok(editorFrame, 'installed native editor exists');
  await editorFrame.waitForFunction(()=>Object.hasOwn(window,'__pnEditor'));
  // Each licensed font must load from the local engine origin. Chromium recreates CSS-connected faces
  // ('unloaded') whenever Excalidraw changes a stylesheet, so a check right after a load can see a fresh
  // face: load again (at most 5 times). A face that fails to load ('error') fails the probe at once.
  const installedFonts=await editorFrame.evaluate(async()=>{const result=[];for(const font of ['20px Cascadia','400 20px Assistant','500 20px Assistant','600 20px Assistant','700 20px Assistant']){let faces=[],checked=false,attempts=0;for(;attempts<5&&!checked;attempts++){faces=await document.fonts.load(font,'Package font probe Ä');if(!faces.length||faces.some(face=>face.status==='error'))break;checked=faces.every(face=>face.status==='loaded')&&document.fonts.check(font,'Package font probe Ä');}result.push({font,faces:faces.length,attempts,loaded:checked});}await document.fonts.ready;return result;});
  assert.ok(installedFonts.every(font=>font.faces>0&&font.loaded),`all installed licensed fonts load locally: ${JSON.stringify(installedFonts)}`);
  const csp=await editorFrame.evaluate(()=>window.__packCspViolations);
  const externalFonts=csp.filter(event=>event.directive==='font-src'&&/^https?:/.test(event.blockedURI)&&!allowed.has(new URL(event.blockedURI).origin));
  assert.deepEqual(externalFonts,[],'CSP-blocked font attempts are offline failures');
  await page.getByTestId('mode-board').click();
  await page.getByTestId('board').waitFor();
  client = new Client({ name: 'practonaut-packed-smoke', version: '1.0.0' }, {
    versionNegotiation: { mode: { pin: '2026-07-28' } },
  });
  await client.connect(new StdioClientTransport({ command, args: [...prefix, 'mcp', '--host', origin, '--token-file', tokenFile], stderr: 'pipe' }));
  assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['observe', 'list_actions', 'act', 'undo', 'reset', 'explain_result', 'check_result'].sort());
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true);
    const reply = result.structuredContent ?? JSON.parse(result.content.find(c => c.type === 'text').text);
    assert.equal(reply.ok, true);
    return reply.value;
  };
  let view = await call('observe');
  const hashes = [view.hash];
  for (const action of [
    { name: 'reconnect_end', params: { id: 'ab', end: 'end', target: 'c' } },
    { name: 'disconnect', params: { id: 'bc' } },
    { name: 'delete_step', params: { id: 'b' } },
  ]) {
    const reply = await call('act', { ...action, baseStep: view.step, expectedRevision: view.revision });
    assert.equal(reply.mirrorConfirmed, true);
    view = reply.view; hashes.push(view.hash);
  }
  await page.locator('[data-object-id="b"]').waitFor({ state: 'detached' });
  const response = page.waitForResponse(r => r.url() === origin + '/api/check' && r.request().method() === 'POST');
  await page.getByTestId('check').click();
  const humanCheck = await (await response).json();
  assert.equal(humanCheck.ok, true); assert.equal(humanCheck.value.passed, true);
  const agentCheck = await call('check_result', { expectedRevision: view.revision });
  assert.equal(agentCheck.passed, true); assert.equal(agentCheck.mode, 'real-engine');
  assert.deepEqual(external, []);
  console.log('test:pack: ok installed CLI serve + actual Player + modern MCP stdio + shared mirrored T3');
  console.log(JSON.stringify({ protocol: '2026-07-28', task: 'T3', seed: 42, hashes, playerPassed: true, agentPassed: true, installedFonts, externalFontCspAttempts: externalFonts.length, otherCspViolations: csp.filter(event=>!externalFonts.includes(event)).length }));
} finally {
  await client?.close(); await browser?.close();
  if (serve.exitCode === null) {
    serve.kill('SIGINT');
    let timer;
    try {
      await Promise.race([once(serve, 'close'), new Promise((_, reject) => { timer = setTimeout(() => { serve.kill('SIGKILL'); reject(new Error('Installed serve shutdown timed out.')); }, 15_000); })]);
    } finally { clearTimeout(timer); }
  }
  // Connection capabilities and bootstrap URL are intentionally never logged.
  // Windows cannot deliver SIGINT to another process (Node ends it abruptly), so a clean exit code is a POSIX check.
  if (process.platform !== 'win32') assert.equal(serve.exitCode, 0, 'Installed serve must close cleanly.');
  // The one diagnostic serve may print: the Linux start without the Chromium sandbox (PADR-0032), one line.
  const SANDBOX_NOTICE = /^practonaut: Chromium runs without its sandbox because this Linux system does not allow it [^\n]*\n/;
  const diagnostics = process.platform === 'linux' ? stderr.replace(SANDBOX_NOTICE, '') : stderr;
  assert.equal(diagnostics.length === 0, true, 'Installed serve emitted an unexpected diagnostic.');
}
