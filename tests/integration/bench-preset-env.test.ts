// The claude-code preset through the real CLI and runner: a stand-in `claude` on PATH records the
// environment it was started with. Provider keys and billing switches never reach it unless
// --keep-env names them (PADR-0034); the notice names variables, never their values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const KEYS = { ANTHROPIC_API_KEY: 'pn-test-anthropic-value', OPENAI_API_KEY: 'pn-test-openai-value', CLAUDE_CODE_USE_BEDROCK: '1' };

/** A folder with an executable `claude` that writes the names of its environment, and the values of
 * the test's own fake keys, to PN_ENV_DUMP, then exits without touching the session. */
async function fakeClaude(dir: string): Promise<void> {
  const script = join(dir, 'fake-claude.mjs');
  await writeFile(script, `import { writeFileSync } from 'node:fs';
const names = Object.keys(process.env);
const values = Object.fromEntries(${JSON.stringify(Object.keys(KEYS))}.filter(name => name in process.env).map(name => [name, process.env[name]]));
writeFileSync(process.env.PN_ENV_DUMP, JSON.stringify({ names, values, mcpConfig: process.argv.includes('--mcp-config') }));
`);
  if (process.platform === 'win32') await writeFile(join(dir, 'claude.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
  else { await writeFile(join(dir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`); await chmod(join(dir, 'claude'), 0o755); }
}

test('the claude-code preset withholds provider keys unless --keep-env names them; other agents refuse --keep-env', { timeout: 180_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-preset-env-'));
  try {
    await fakeClaude(dir);
    const pathKey = Object.keys(process.env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
    const env = { ...process.env, ...KEYS, [pathKey]: dir + delimiter + (process.env[pathKey] ?? '') };
    const bench = (dump: string, ...extra: string[]) => spawnSync(process.execPath, [CLI, 'bench', '--agent', 'claude-code', '--tasks', 'connect', '--mirror', 'off', '--timeout', '60', ...extra], { encoding: 'utf8', env: { ...env, PN_ENV_DUMP: dump } });
    const read = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as { names: string[]; values: Record<string, string>; mcpConfig: boolean };

    const plain = bench(join(dir, 'plain.json'));
    assert.equal(plain.status, 0, plain.stderr);
    const seen = await read(join(dir, 'plain.json'));
    assert.equal(seen.mcpConfig, true, 'the stand-in was started as the preset');
    for (const name of Object.keys(KEYS)) assert.equal(seen.names.includes(name), false, `${name} reached the agent`);
    assert.deepEqual(seen.values, {});
    assert.match(plain.stderr, /does not pass ANTHROPIC_API_KEY, CLAUDE_CODE_USE_BEDROCK, OPENAI_API_KEY to the agent/);
    for (const value of Object.values(KEYS).filter(value => value !== '1')) assert.equal(plain.stderr.includes(value), false, 'a value in the notice');

    const kept = bench(join(dir, 'kept.json'), '--keep-env', 'ANTHROPIC_API_KEY');
    assert.equal(kept.status, 0, kept.stderr);
    const keptSeen = await read(join(dir, 'kept.json'));
    assert.deepEqual(keptSeen.values, { ANTHROPIC_API_KEY: KEYS.ANTHROPIC_API_KEY });
    assert.equal(keptSeen.names.includes('OPENAI_API_KEY') || keptSeen.names.includes('CLAUDE_CODE_USE_BEDROCK'), false);
    assert.match(kept.stderr, /does not pass CLAUDE_CODE_USE_BEDROCK, OPENAI_API_KEY to the agent/);

    // A command template is the user's own command: it gets the environment unchanged, so --keep-env
    // would mean nothing there and is refused before any run starts.
    const refused = spawnSync(process.execPath, [CLI, 'bench', '--agent', 'oracle', '--keep-env', 'ANTHROPIC_API_KEY'], { encoding: 'utf8', env });
    assert.equal(refused.status, 1, refused.stderr);
    assert.match(refused.stderr, /--keep-env applies only to a preset agent/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
