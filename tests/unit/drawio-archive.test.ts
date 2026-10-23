// PADR-0049 decisions 3.2 and 3.3: the draw.io archive is served from memory, only from an allowlist,
// under normative zip limits. Hostile fixtures come from the independent writer in
// tests/support/zipwriter.ts, never from the reader's own code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDrawioArchive, safeEntryName, ARCHIVE_LIMITS } from '../../src/adapters/drawio/archive.ts';
import { DrawioRuntimeError } from '../../src/adapters/drawio/runtime.ts';
import { buildZip, type HostileEntry } from '../support/zipwriter.ts';

const html = Buffer.from('<!doctype html><title>app</title>');
const script = Buffer.from('console.log("app");'.repeat(50));
const agentFile = Buffer.from('# instructions addressed to coding agents');
const good = (): HostileEntry[] => [
  { name: 'index.html', data: html },
  { name: 'js/', data: Buffer.alloc(0), method: 0, unixMode: 0o040755 },
  { name: 'js/app.min.js', data: script },
  { name: 'js/diagramly/CLAUDE.md', data: agentFile },
  { name: 'WEB-INF/web.xml', data: Buffer.from('<web-app/>') },
];
const ALLOW = ['index.html', 'js/app.min.js'];
const refused = (pattern: RegExp) => (error: unknown): boolean => error instanceof DrawioRuntimeError && error.code === 'app_runtime_unverified' && pattern.test(error.message);

test('only allowlisted files are served; agent-instruction files, WEB-INF and directories never are', async () => {
  const archive = await openDrawioArchive(buildZip(good()), ALLOW);
  assert.deepEqual(await archive.read('index.html'), html);
  assert.deepEqual(await archive.read('js/app.min.js'), script);
  for (const name of ['js/diagramly/CLAUDE.md', 'WEB-INF/web.xml', 'js/', 'missing.js']) {
    assert.equal(archive.serves(name), false, name);
    await assert.rejects(archive.read(name), refused(/not served/), name);
  }
});

test('concurrent requests for one entry share one inflation, and each entry is inflated once', async () => {
  const archive = await openDrawioArchive(buildZip(good()), ALLOW);
  const all = await Promise.all(Array.from({ length: 12 }, () => archive.read('js/app.min.js')));
  assert.ok(all.every(bytes => bytes.equals(script)));
  assert.equal(archive.inflations, 1);
  await archive.read('index.html'); await archive.read('index.html');
  assert.equal(archive.inflations, 2);
});

test('the archive is refused for each broken limit or trick', async () => {
  const cases: Array<[string, HostileEntry[], RegExp, Partial<typeof ARCHIVE_LIMITS>?]> = [
    ['too many entries', good(), /more than 3 entries/, { entries: 3 }],
    ['an entry over the per-entry limit', good(), /an entry over 100 bytes/, { entryBytes: 100 }],
    ['more than the total', good(), /in total/, { totalBytes: 900 }],
    ['the allowlist declares too much', good(), /served files declare more/, { allowlistBytes: 900 }],
    ['a compression ratio over 100', [...good(), { name: 'zeros.bin', data: Buffer.alloc(1024 * 1024) }], /compression ratio over 100/],
    ['a duplicate name', [...good(), { name: 'index.html', data: html }], /duplicate/],
    ['a link entry', [...good(), { name: 'js/link.js', data: Buffer.from('index.html'), method: 0, unixMode: 0o120777 }], /link entry/],
    ['an encrypted entry', [...good(), { name: 'secret.bin', data: Buffer.from('x'), flags: 0x0801 }], /encrypted/],
    ['an unknown method', [...good(), { name: 'odd.bin', data: Buffer.from('x'), method: 12 }], /compression method 12/],
    ['a local name that differs', [...good(), { name: 'js/main.js', localName: 'js/evil.js', data: script }], /local-header name/],
    ['a local method that differs', [...good(), { name: 'js/main2.js', localMethod: 0, data: script }], /local-header method/],
    ['an allowlisted entry missing', good().filter(entry => entry.name !== 'js/app.min.js'), /lacks js\/app\.min\.js/],
  ];
  for (const [name, entries, pattern, limits] of cases) {
    await assert.rejects(openDrawioArchive(buildZip(entries), ALLOW, { ...ARCHIVE_LIMITS, ...limits }), refused(pattern), name);
  }
  // Names a reader could resolve outside the archive: refused by the zip library or by the name rule.
  for (const bad of ['../x.js', '/abs.js', 'a\\b.js', 'C:x.js']) await assert.rejects(openDrawioArchive(buildZip([...good(), { name: bad, data: html }]), ALLOW), refused(/./), bad);
  assert.equal(safeEntryName('js/app.min.js'), true); assert.equal(safeEntryName('js/'), true);
  for (const bad of ['', '/a', 'a/../b', './a', 'a\\b', 'C:a', 'a\u0001b', 'a//b']) assert.equal(safeEntryName(bad), false, JSON.stringify(bad));
  await assert.rejects(openDrawioArchive(Buffer.from('not a zip'), ALLOW), refused(/not a readable zip/));
});

test('an entry that inflates beyond its declared size, or fails its CRC, is refused when read', async () => {
  const lying = await openDrawioArchive(buildZip([...good().filter(entry => entry.name !== 'js/app.min.js'), { name: 'js/app.min.js', data: script, lieUncompressedSize: 40 }]), ALLOW);
  await assert.rejects(lying.read('js/app.min.js'), refused(/beyond its declared size|another size/));
  const damaged = await openDrawioArchive(buildZip([...good().filter(entry => entry.name !== 'index.html'), { name: 'index.html', data: html, crc: 1234 }]), ALLOW);
  await assert.rejects(damaged.read('index.html'), refused(/CRC-32/));
});
