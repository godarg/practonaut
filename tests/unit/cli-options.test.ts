// `--option=value` is accepted wherever `--option value` is (the form MCP registries render for
// named arguments), splits at the first `=`, and an empty inline value is refused like a missing one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inlineOptionValues } from '../../src/cli/options.ts';
import { parseServeArguments } from '../../src/cli/serve.ts';
import { parseMcpArguments } from '../../src/cli/mcp.ts';
import { parseBenchArguments } from '../../src/cli/bench.ts';
import { RuntimeError } from '../../src/cli/runtime.ts';

const main = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const usage = (error: unknown): boolean => error instanceof RuntimeError && error.code === 'usage';

test('only option-position tokens of valued options are split, at the first =', () => {
  assert.deepEqual(inlineOptionValues(['--out=a=b.json', 'x'], ['--out']), ['--out', 'a=b.json', 'x']);
  assert.deepEqual(inlineOptionValues(['--task='], ['--task']), ['--task', '']);
  // A value that looks like an option stays one token; booleans, unknown options and everything after -- are untouched.
  assert.deepEqual(inlineOptionValues(['--agent', '--model=x', '--json=1', '--other=2', '--', '--out=y'], ['--agent', '--out']), ['--agent', '--model=x', '--json=1', '--other=2', '--', '--out=y']);
});

test('play/serve: --task=, --seed=, --mirror= mean the same as the spaced form; empty and boolean= are refused', () => {
  assert.deepEqual(parseServeArguments(['w', '--task=T3', '--seed=-7', '--mirror=off', '--no-open']), parseServeArguments(['w', '--task', 'T3', '--seed', '-7', '--mirror', 'off', '--no-open']));
  for (const bad of [['--task='], ['--seed='], ['--mirror=sometimes'], ['--no-open=1'], ['--task=T3', '--task', 'T3']]) assert.throws(() => parseServeArguments(bad), usage, bad.join(' '));
});

test('mcp: --task=excalidraw/connect starts the same session as --task excalidraw/connect; empty is refused', () => {
  assert.deepEqual(parseMcpArguments(['--task=excalidraw/connect', '--seed=3', '--mirror=off'], {}), parseMcpArguments(['--task', 'excalidraw/connect', '--seed', '3', '--mirror', 'off'], {}));
  for (const bad of [['--task='], ['--open=1'], ['--task=excalidraw/connect', '--task=excalidraw/connect']]) assert.throws(() => parseMcpArguments(bad, {}), bad.join(' '));
});

test('bench: inline values, values containing =, and empty values', () => {
  const inline = parseBenchArguments(['--agent=oracle', '--tasks=connect', '--seeds=2', '--repeats=2', '--out=runs/a=b.json']);
  assert.deepEqual(inline, parseBenchArguments(['--agent', 'oracle', '--tasks', 'connect', '--seeds', '2', '--repeats', '2', '--out', 'runs/a=b.json']));
  assert.equal(inline.out, 'runs/a=b.json');
  for (const bad of [['--agent=oracle', '--out='], ['--agent='], ['--agent', 'oracle', '--out', '']]) assert.throws(() => parseBenchArguments(bad), usage, bad.join(' '));
});

test('the real CLI: --lang=de selects German, an empty inline value is a usage error, pack --out= writes there', async () => {
  const empty = spawnSync(process.execPath, [main, '--lang=de', 'play', '--task='], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(empty.status, 1, empty.stderr); assert.match(empty.stderr, /^practonaut: Option --task benötigt einen Wert \[usage\]$/m);
  const directory = await mkdtemp(join(tmpdir(), 'pn-inline-'));
  try {
    const out = join(directory, 'a=b.pnworld');
    const packed = spawnSync(process.execPath, [main, 'pack', 'examples/worlds/flow-diagram', `--out=${out}`], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(packed.status, 0, packed.stderr); assert.ok((await stat(out)).size > 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
