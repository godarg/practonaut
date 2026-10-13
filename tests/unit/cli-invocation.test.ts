// Suggested commands mirror how the CLI was started, and counts get the right plural form.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { invocationName, withInvocation } from '../../src/cli/invocation.ts';
import { cliText, pluralForm, setCliLanguage } from '../../src/cli/messages.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

test('npx and npm exec set npm_command=exec; anything else is the plain bin name', () => {
  // npm 10 sets npm_command=exec for `npx <pkg>` and `npm exec <pkg>` (measured with a local package).
  assert.equal(invocationName({ npm_command: 'exec' }), 'npx practonaut');
  assert.equal(invocationName({ npm_command: 'run-script' }), 'practonaut');
  assert.equal(invocationName({}), 'practonaut');
});

test('help suggestions are rewritten, but not names, paths, schemas or an existing npx line', () => {
  const help = 'Usage: practonaut bench --agent x\n  practonaut --version\n(same as: practonaut play)\n  claude mcp add practonaut -- npx -y practonaut mcp --task t\nWrites practonaut.bench/1 to ~/.practonaut/bench\npractonaut: error';
  assert.equal(withInvocation(help, 'npx practonaut'), 'Usage: npx practonaut bench --agent x\n  npx practonaut --version\n(same as: npx practonaut play)\n  claude mcp add practonaut -- npx -y practonaut mcp --task t\nWrites practonaut.bench/1 to ~/.practonaut/bench\npractonaut: error');
  assert.equal(withInvocation(help, 'practonaut'), help);
});

test('catalogue texts carry the invocation, and the CLI prints it when started through npx', () => {
  assert.match(cliText('tasksShowPlay', { id: 'connect', cli: 'npx practonaut' }), /npx practonaut play connect/);
  const env = { ...process.env, npm_command: 'exec' };
  const viaNpx = spawnSync(process.execPath, [CLI, 'tasks', 'list'], { encoding: 'utf8', env });
  assert.equal(viaNpx.status, 0, viaNpx.stderr); assert.match(viaNpx.stdout, /Open one: npx practonaut play <task-id>   Details: npx practonaut tasks show <task-id>/);
  assert.match(spawnSync(process.execPath, [CLI, 'bench', '--help'], { encoding: 'utf8', env }).stdout, /^Usage: npx practonaut bench /);
  const plain = spawnSync(process.execPath, [CLI, 'tasks', 'list'], { encoding: 'utf8', env: { ...process.env, npm_command: 'run-script' } });
  assert.match(plain.stdout, /Open one: practonaut play <task-id>/);
});

test('counts take the plural form of the CLI language (Intl.PluralRules)', () => {
  assert.equal(pluralForm(1, 'run', 'runs', 'en'), 'run'); assert.equal(pluralForm(0, 'run', 'runs', 'en'), 'runs'); assert.equal(pluralForm(2, 'Lauf', 'Läufe', 'de'), 'Läufe');
  try {
    setCliLanguage('en');
    assert.equal(cliText('benchStart', { runs: 1, agent: 'oracle', mode: 'model only' }), 'practonaut bench: 1 run with agent oracle, model only\n');
    assert.equal(cliText('benchStart', { runs: 6, agent: 'oracle', mode: 'model only' }), 'practonaut bench: 6 runs with agent oracle, model only\n');
    assert.match(cliText('doctorFailed', { count: 1 }), /1 required check failed/);
    assert.match(cliText('doctorFailed', { count: 2 }), /2 required checks failed/);
    setCliLanguage('de');
    assert.equal(cliText('benchStart', { runs: 1, agent: 'oracle', mode: 'nur Modell' }), 'practonaut bench: 1 Lauf mit Agent oracle, nur Modell\n');
    assert.match(cliText('doctorFailed', { count: 1 }), /1 Pflichtprüfung fehlgeschlagen/);
  } finally { setCliLanguage('en'); }
});
