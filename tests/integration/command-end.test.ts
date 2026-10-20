// PADR-0050, decision 9, with the real CLI for the commands that start a session host (they need the
// Player build, which the unit layer does not have): `practonaut mcp`, `bench` and `play` end through
// the 35 s rule only after their own shutdown, with no credential left anywhere under their home; a
// bench counts the runs it lost to the browser budget. No browser is launched: the preloads put a
// stand-in entry into the ledger or refuse every mirror start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, cliUnderRule, endedThroughRule, preload, type Ended } from '../support/command-end.ts';

test('mcp, bench and play end through the rule only after their own shutdown (real CLI)', { timeout: 180_000 }, async () => {
  const home = await mkdtemp(join(realpathSync(tmpdir()), 'pn-exit-rule-hosts-'));
  try {
    const kinds: Array<[string, Promise<Ended>, (ended: Ended) => void]> = [
      // practonaut mcp: main returns at once; the session ends when stdin closes and stop() has closed the host.
      ['mcp', cliUnderRule(['mcp', '--task', 'connect', '--mirror', 'off'], home, { stdin: '' }), ended => assert.match(ended.stderr, /\n.*connect/)],
      ['bench', cliUnderRule(['bench', '--agent', 'oracle', '--tasks', 'connect', '--mirror', 'off', '--out', join(home, 'bench.json')], home), ended => assert.match(ended.stdout, /bench\.json/)],
    ];
    // serve and play stop on Ctrl+C (POSIX: a signal to the test's own child).
    if (process.platform !== 'win32') kinds.push(['play', cliUnderRule(['play', 'connect', '--no-open', '--mirror', 'off'], home, { interruptWhen: /#code=/ }), ended => assert.match(ended.stdout, /#code=/)]);
    for (const [name, running, check] of kinds) { const ended = await running; check(ended); endedThroughRule(name, ended); }
  } finally { await rm(home, { recursive: true, force: true }); }
});

// Review of PR #69 (effects-8): the bench's count of runs lost to the budget had no test.
test('a bench counts the runs it lost to the browser budget after its table, in English and German', { timeout: 180_000 }, async () => {
  const home = await mkdtemp(join(realpathSync(tmpdir()), 'pn-bench-budget-'));
  try {
    const bench = (out: string, ...lang: string[]) => spawnSync(process.execPath, ['--import', preload('budget-mirror-full-preload.ts'), CLI, ...lang, 'bench', '--agent', 'oracle', '--tasks', 'connect', '--mirror', 'required', '--out', join(home, out)], { cwd: home, encoding: 'utf8', timeout: 120_000, env: { ...process.env, PRACTONAUT_HOME: home } });
    const english = bench('en.json'), german = bench('de.json', '--lang', 'de');
    assert.equal(english.status, 0, english.stderr);
    assert.match(english.stdout, /\n1 run could not be judged because no browser slot became free \(browser_budget_exhausted\); see each run's note\.\n/);
    assert.match(german.stdout, /\n1 Lauf konnte nicht bewertet werden, weil kein Browser-Platz frei wurde \(browser_budget_exhausted\)/);
    const report = JSON.parse(await readFile(join(home, 'en.json'), 'utf8')) as { sessions?: Array<{ runs: Array<{ status: string; note?: string }> }>; runs?: Array<{ status: string; note?: string }> };
    const runs = report.runs ?? report.sessions?.flatMap(session => session.runs) ?? [];
    assert.deepEqual(runs.map(run => [run.status, run.note?.startsWith('browser_budget_exhausted: ')]), [['infra_error', true]], 'the run\'s note names the budget');
  } finally { await rm(home, { recursive: true, force: true }); }
});
