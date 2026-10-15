// The CI recipe's two workflow files (roadmap 0.2.0, Should 5): every action pinned by commit SHA; the
// repository's own check runs only by hand, outside the required checks, with read-only permissions,
// and benches exactly the plan its committed baseline was made with (otherwise compare would refuse
// the pair); the copyable example pins an exact Practonaut version, keeps secrets out of commands,
// gates with --fail-on-regression and benches the three repeats an instance regression needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REGRESSION_REPEATS } from '../../src/bench/stats.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(root + path, 'utf8');
const CHECK = '.github/workflows/ci-recipe-check.yml', EXAMPLE = 'examples/ci/practonaut-bench.yml';
const workflows = [...readdirSync(root + '.github/workflows').filter(name => name.endsWith('.yml')).map(name => `.github/workflows/${name}`), EXAMPLE];
/** Top-level keys of a block (`on:`, `permissions:`) by indentation: the lines indented one level below it. */
function block(text: string, key: string): string[] {
  const lines = text.split('\n'), start = lines.findIndex(line => line === `${key}:`);
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) { if (/^\S/.test(line)) break; const match = /^ {2}([A-Za-z_-]+):/.exec(line); if (match) out.push(match[1]!); }
  return out;
}
/** The practonaut bench command of a workflow, as one line. */
function benchCommand(text: string): string {
  const lines = text.split('\n'), start = lines.findIndex(line => line.includes('practonaut bench '));
  let command = lines[start]!.slice(lines[start]!.indexOf('practonaut bench '));
  // Continued lines (a trailing backslash) belong to the same command.
  for (let index = start; lines[index]!.trimEnd().endsWith('\\'); index++) command = `${command.trimEnd().slice(0, -1)} ${lines[index + 1]!.trim()}`;
  return `${command} `;
}

test('every action in every workflow and in the example is pinned to a full commit SHA', () => {
  for (const file of workflows) {
    const uses = [...read(file).matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map(match => match[1]!);
    for (const action of uses) assert.match(action, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${file}: ${action}`);
  }
});

test('the repository check runs only by hand, outside the required checks, with read-only permissions', () => {
  const text = read(CHECK);
  assert.deepEqual(block(text, 'on'), ['workflow_dispatch']);
  assert.deepEqual(block(text, 'permissions'), ['contents']);
  assert.match(text, /^permissions:\n {2}contents: read\n/m);
  const names = [...text.matchAll(/^ {4}name: (.+)$/gm)].map(match => match[1]!.trim());
  assert.ok(names.length > 0);
  // The required checks are `test (<os>)` and `secret scan` (ci.yml); a job of this workflow must never answer for them.
  for (const name of names) assert.equal(/^test \(|^secret scan$/.test(name), false, name);
  assert.match(text, /plant_regression:\n\s+description: .+\n\s+type: boolean\n\s+default: false/);
});

test('the repository check benches the plan its committed baseline was made with, and gates on it', () => {
  const baseline = JSON.parse(read('tests/fixtures/ci-recipe/baseline.json')) as { settings: { seeds: number[]; repeats: number; maxActions: number }; environment: { mirror: string }; agent: { name: string } };
  const command = benchCommand(read(CHECK));
  assert.match(command, new RegExp(`--agent ${baseline.agent.name} `));
  assert.match(command, new RegExp(`--seed-list ${baseline.settings.seeds.join(',')} `));
  assert.match(command, new RegExp(`--repeats ${baseline.settings.repeats} `));
  assert.match(command, new RegExp(`--max-actions ${baseline.settings.maxActions} `));
  assert.match(command, new RegExp(`--mirror ${baseline.environment.mirror}\\b`));
  assert.ok(baseline.settings.repeats >= REGRESSION_REPEATS, 'the baseline has the repeats an instance regression needs');
  assert.match(read(CHECK), /practonaut compare "\$BASELINE" "\$BENCH\/report\.json" --fail-on-regression/);
});

test('the example pins an exact Practonaut version, keeps secrets out of commands and gates on instance regressions', () => {
  const text = read(EXAMPLE);
  assert.match(text, /^ {2}PRACTONAUT: practonaut@\d+\.\d+\.\d+$/m);
  assert.match(text, /^ {2}CLAUDE_CODE: '@anthropic-ai\/claude-code@\d+\.\d+\.\d+'$/m);
  assert.equal(/@latest\b|practonaut@\^|practonaut@~/.test(text), false);
  // A secret only ever becomes an environment variable of a step, never part of a command line.
  for (const line of text.split('\n').filter(line => line.includes('secrets.'))) assert.match(line, /^\s+#?\s*[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}$/, line);
  const command = benchCommand(text);
  assert.match(command, /--agent claude-code /);
  assert.ok(Number(/--repeats (\d+)/.exec(command)![1]) >= REGRESSION_REPEATS);
  assert.match(command, /--mirror required /);
  assert.match(command, /--junit "\$OUT\/junit\.xml"/);
  assert.match(text, /practonaut compare "\$BASELINE" "\$BENCH\/report\.json" --fail-on-regression/);
  assert.match(text, /practonaut setup/);
  assert.match(text, /^permissions:\n {2}contents: read\n/m);
});
