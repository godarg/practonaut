// PADR-0045: the shared browser shell's network boundary against the real Chromium. A page served
// from the shell's one named origin tries every channel it has to reach a host that is not named —
// HTTP, beacon, EventSource, image, prefetch, popup, page and frame WebSockets, dedicated, shared,
// blob: and data: workers (each with fetch, WebSocket, importScripts and a FontFace load), WebRTC
// (STUN over UDP, TURN over TCP to an address and to a host name), preconnect and DNS-prefetch
// hints. The target is a listener on 127.0.0.1 that stands in for a public host: Chromium's own
// local-network checks, which apply only to private targets, are switched off for this test, so
// they cannot hide a missing guard. Nothing may arrive (no HTTP request, WebSocket, TCP connection
// or UDP packet), no hinted host name may be resolved (Chromium's net log), and what the shell can
// see is recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type LaunchOptions } from 'playwright-core';
import { startShell } from '../../src/adapters/browser/shell.ts';

const LOCAL_NETWORK_CHECKS_OFF = '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults';

test('no channel of a shell page reaches a host that is not named; what the shell sees is recorded', { timeout: 120_000 }, async () => {
  const arrived: string[] = [];
  const server = createServer((request, response) => { arrived.push(`http ${request.url}`); response.end('x'); });
  server.on('upgrade', (request, socket) => { arrived.push(`websocket ${request.url}`); socket.destroy(); });
  // Every TCP connection counts, also one that never sends HTTP (TURN, a preconnect).
  server.on('connection', () => arrived.push('tcp'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const scratch = await mkdtemp(join(await realpath(tmpdir()), 'pn-shell-network-')), netLog = join(scratch, 'netlog.json');
  const udp = createSocket('udp4'); udp.on('message', () => arrived.push('udp'));
  await new Promise<void>(resolve => udp.bind(0, '127.0.0.1', resolve));
  const target = `127.0.0.1:${(server.address() as AddressInfo).port}`, stun = `127.0.0.1:${(udp.address() as AddressInfo).port}`;
  const inWorker = (tag: string): string => `fetch('http://${target}/${tag}-fetch').catch(()=>{});try{new WebSocket('ws://${target}/${tag}-ws')}catch(e){}`
    + `;try{importScripts('http://${target}/${tag}-import')}catch(e){};try{const f=new FontFace('x','url(http://${target}/${tag}-font)');self.fonts.add(f);f.load().catch(()=>{})}catch(e){}`;
  const blob = (tag: string): string => `URL.createObjectURL(new Blob([${JSON.stringify(inWorker(tag))}],{type:'text/javascript'}))`;
  // A frame document as a JS expression; the closing tag is split so the page's own script stays whole.
  const frame = (tag: string): string => `'<'+'script>'+${JSON.stringify(`try{new WebSocket("ws://${target}/${tag}-ws")}catch(e){};fetch("http://${target}/${tag}-fetch").catch(()=>{})`)}+'<'+'/script>'`;
  const page = `<!doctype html><img src="http://${target}/img"><link rel="prefetch" href="http://${target}/prefetch">
    <link rel="preconnect" href="http://${target}"><link rel="preconnect" href="https://preconnect-hint.example"><link rel="dns-prefetch" href="//dns-hint.example"><a href="http://anchor-hint.example/">x</a><script>
    const attempt = f => { try { f(); } catch (e) {} };
    attempt(() => new WebSocket('ws://${target}/page-ws'));
    fetch('http://${target}/page-fetch').catch(() => {});
    attempt(() => navigator.sendBeacon('http://${target}/beacon', 'x'));
    attempt(() => new EventSource('http://${target}/sse'));
    attempt(() => new Worker('/worker.js'));
    attempt(() => new Worker(${blob('blob-worker')}));
    attempt(() => new SharedWorker('/shared.js'));
    attempt(() => new SharedWorker(${blob('blob-shared')}));
    attempt(() => new SharedWorker('data:text/javascript,' + encodeURIComponent(${JSON.stringify(inWorker('data-shared'))})));
    attempt(() => { const f = document.createElement('iframe'); f.srcdoc = ${frame('frame')}; document.body.appendChild(f); });
    attempt(() => { const f = document.createElement('iframe'); f.src = 'data:text/html,' + encodeURIComponent(${frame('data-frame')}); document.body.appendChild(f); });
    attempt(() => window.open('http://${target}/popup'));
    attempt(() => { const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:${stun}' }, { urls: 'turn:${target}?transport=tcp', username: 'x', credential: 'x' }, { urls: 'turn:turn-probe.example:3478?transport=tcp', username: 'x', credential: 'x' }] }); peer.createDataChannel('x'); peer.createOffer().then(offer => peer.setLocalDescription(offer)); });
  </script>`;
  const served: Record<string, { body: string; contentType: string }> = {
    '/': { body: page, contentType: 'text/html' },
    '/worker.js': { body: inWorker('worker'), contentType: 'text/javascript' },
    '/shared.js': { body: inWorker('shared'), contentType: 'text/javascript' },
  };
  const launcher = { launch: (options: LaunchOptions = {}) => chromium.launch({ ...options, args: [...(options.args ?? []), LOCAL_NETWORK_CHECKS_OFF, `--log-net-log=${netLog}`, '--net-log-capture-mode=Everything'] }) };
  const shell = await startShell({ chromium: launcher, origins: { 'http://app.invalid': async path => served[path] } }, async started => { await started.page.goto('http://app.invalid/'); });
  let closed = false;
  try {
    // Recorded by the shell: the WebSocket route, the HTTP route and the policy's reports. TURN over
    // TCP and a shared worker's reports reach the sink proxy, which refuses them and records nothing.
    const expected = [`ws://${target}/page-ws`, `ws://${target}/frame-ws`, `ws://${target}/data-frame-ws`, `http://${target}/popup`,
      ...['page-fetch', 'beacon', 'sse', 'worker-fetch', 'blob-worker-fetch', 'frame-fetch', 'data-frame-fetch'].map(name => `policy:connect-src:http://${target}/${name}`),
      ...['worker-ws', 'blob-worker-ws'].map(name => `policy:connect-src:ws://${target}/${name}`),
      ...['worker-import', 'blob-worker-import'].map(name => `policy:script-src-elem:http://${target}/${name}`),
      ...['worker-font', 'blob-worker-font'].map(name => `policy:font-src:http://${target}/${name}`),
      `policy:img-src:http://${target}/img`];
    const deadline = Date.now() + 20_000;
    while (expected.some(entry => !shell.networkAttempts().includes(entry)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    await new Promise(resolve => setTimeout(resolve, 2_000)); // late shared-worker and WebRTC attempts
    assert.deepEqual(arrived, [], 'nothing reached the host that is not named');
    const recorded = shell.networkAttempts();
    for (const entry of expected) assert.ok(recorded.includes(entry), `${entry} recorded in ${JSON.stringify(recorded)}`);
    // The net log is complete once the browser has closed: no hinted name was looked up.
    await shell.close(); closed = true;
    const log = await readFile(netLog, 'utf8');
    for (const name of ['preconnect-hint.example', 'dns-hint.example', 'anchor-hint.example']) assert.equal(log.includes(name), false, `${name} resolved`);
  } finally { if (!closed) await shell.close(); server.close(); udp.close(); await rm(scratch, { recursive: true, force: true }); }
});
