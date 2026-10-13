import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareAgentMcpEntry } from '../../tools/agent-runs.ts';

const host = { origin: 'http://127.0.0.1:12345', tokenFile: '/private/fixture/session-token' };
const digest = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
// Only the --version process boundary is stubbed. This is no installed-product or agent-run evidence.
async function fixture() {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'pn-entry-test-'));
  const path = join(directory, 'node_modules/practonaut/dist/cli/main.js');
  const bytes = '#!/usr/bin/env node\nif(process.argv.length!==3||process.argv[2]!=="--version")process.exit(90);process.stdout.write("0.1.0\\n");\n';
  await mkdir(join(directory, 'node_modules/practonaut/dist/cli'), { recursive: true });
  await writeFile(path, bytes, { mode: 0o700 });
  return { directory, path, bytes, request: { path, sha256: digest(bytes), version: '0.1.0' } };
}

test('the original caller retains its explicitly labeled source wrapper', async () => {
  const entry = await prepareAgentMcpEntry(host);
  const source = fileURLToPath(new URL('../../src/cli/mcp.ts', import.meta.url));
  assert.equal(entry.evidence.mode, 'source-wrapper');
  assert.equal(entry.evidence.entryPath, source);
  assert.equal(entry.evidence.entrySha256, undefined);
  assert.equal(entry.evidence.entryVersion, undefined);
  assert.equal(entry.config.command, process.execPath);
  assert.deepEqual(entry.config.args, ['--input-type=module', '-e', `const {commandMcp}=await import(${JSON.stringify(source)});process.exitCode=await commandMcp(process.argv.slice(1));`, '--', '--host', host.origin, '--token-file', host.tokenFile]);
  await entry.assertUnchanged();
});

test('a pinned installed entry configures the real CLI mcp subcommand on that same host', async () => {
  const f = await fixture();
  try {
    const entry = await prepareAgentMcpEntry(host, f.request);
    assert.equal(entry.evidence.mode, 'installed-cli');
    assert.equal(entry.evidence.entryPath, f.path);
    assert.equal(entry.evidence.entrySha256, digest(f.bytes));
    assert.equal(entry.evidence.entrySize, Buffer.byteLength(f.bytes));
    assert.equal(entry.evidence.entryVersion, '0.1.0');
    assert.equal(entry.evidence.nodeVersion, process.version);
    assert.deepEqual(entry.config, { command: process.execPath, args: [f.path, 'mcp', '--host', host.origin, '--token-file', host.tokenFile] });
    assert.deepEqual(entry.evidence.invocation, entry.config);
    await entry.assertUnchanged();
    await writeFile(f.path, f.bytes + '// changed after probe\n');
    await assert.rejects(entry.assertUnchanged(), /changed/i);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('another source or entry is refused before a version process can run', async () => {
  const f = await fixture();
  try {
    for (const path of [fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url)), join(f.directory, 'dist/cli/main.js'), 'node_modules/practonaut/dist/cli/main.js', f.path.replace('main.js', 'mcp.js')]) {
      await assert.rejects(prepareAgentMcpEntry(host, { ...f.request, path }), /installed.*entry/i);
    }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('the whole-file hash and actual version must match explicit caller expectations', async () => {
  const f = await fixture();
  try {
    await assert.rejects(prepareAgentMcpEntry(host, { ...f.request, sha256: '0'.repeat(64) }), /hash/i);
    await assert.rejects(prepareAgentMcpEntry(host, { ...f.request, sha256: '' }), /hash/i);
    await assert.rejects(prepareAgentMcpEntry(host, { ...f.request, version: '0.2.0' }), /version/i);
    await assert.rejects(prepareAgentMcpEntry(host, { ...f.request, version: '' }), /version/i);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('symlinks, directories and non-executable files cannot be selected as an installed entry', async () => {
  const f = await fixture();
  try {
    await chmod(f.path, 0o600);
    await assert.rejects(prepareAgentMcpEntry(host, f.request), /executable regular file/i);
    await rm(f.path);
    await mkdir(f.path);
    await assert.rejects(prepareAgentMcpEntry(host, f.request), /executable regular file/i);
    await rm(f.path, { recursive: true });
    const target = join(f.directory, 'version-only-fixture.js');
    await writeFile(target, f.bytes, { mode: 0o700 });
    await symlink(target, f.path);
    await assert.rejects(prepareAgentMcpEntry(host, f.request), /executable regular file/i);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
