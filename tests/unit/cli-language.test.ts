import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { CLI_CATALOG } from '../../src/cli/messages.ts';
const main = new URL('../../src/cli/main.ts', import.meta.url).pathname;
const cli = (args: string[]) => spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', timeout: 30_000 });
test('German CLI help and usage errors use the selected catalog, without changing machine codes', () => {
  const help = cli(['--lang', 'de', '--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Verwendung:/);
  assert.match(cli(['--lang', 'de', 'bench', '--help']).stdout, /Befehlsvorlage bekommt \{mcp_config\}/);
  assert.match(cli(['--lang', 'de', 'eval']).stderr, /eval wurde durch practonaut bench ersetzt/);
  for (const command of ['validate', 'pack', 'run', 'serve', 'check', 'record', 'compile', 'eval', 'bench', 'report', 'mcp']) {
    // serve without a world starts the bundled one, so its usage error is two worlds.
    const r = cli(['--lang', 'de', command, ...(command === 'serve' ? ['a', 'b'] : [])]);
    assert.equal(r.status, 1, `${command}: ${r.stdout}${r.stderr}`);
    assert.ok(!/needs|requires|exactly|takes no|unknown/.test(r.stderr), `${command}: ${r.stderr}`);
  }
  const runtime = cli(['--lang', 'de', 'run', '--json']);
  assert.equal(JSON.parse(runtime.stderr).error.code, 'usage');
  assert.match(JSON.parse(runtime.stderr).error.message, /Eingabepfad/);
});
test('both CLI catalogs retain exactly the same interpolation parameters', () => {
  for (const [key, entry] of Object.entries(CLI_CATALOG)) {
    const parameters = (value: string) => [...value.matchAll(/\{([A-Za-z]+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(parameters(entry.en), parameters(entry.de), key);
    assert.ok(entry.en.length && entry.de.length, key);
  }
});
test('missing recording returns a bounded code rather than an OS stack/path', () => {
  const r = cli(['--lang', 'de', 'record', 'review', 'does-not-exist', '--json']);
  assert.equal(r.status, 2, r.stderr);
  const error = JSON.parse(r.stderr).error;
  assert.equal(error.code, 'recording_missing');
  assert.match(error.message, /nicht vorhanden/);
  assert.doesNotMatch(r.stderr, /ENOENT|\/Users\/|at commandRecord|node:internal/);
});
