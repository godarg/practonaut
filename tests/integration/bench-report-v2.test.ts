// Report v2 acceptance (roadmap 0.2.0, Must 3; PADR-0039 B) on fixture runs: real benches with
// scripted command agents, the oracle and the built-in failure modes (tests/support/report-states.ts).
// Expected texts come from the task library's own data and from the scripts the agents played, never
// from the renderer: every checker error class with its unmet condition and the action after which
// that condition was last lost (or "never met"); every run state by name with its reason; correct and
// incorrect, grouped and ungrouped boards whose pictures differ, from the schematic and from the real
// engine; board text escaped, never markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from '../../src/library/index.ts';
import { generateVariant } from '../../src/world/variant.ts';
import type { Step } from '../../src/world/types.ts';
import { fixtureBenches, reportPage, reportText, type Fixtures } from '../support/report-states.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const { world } = loadLibrary();
const variant = generateVariant(world, 1);
/** The label of a library task's start step at seed 1 (the world's own variant data). */
const label = (task: string, id: string): string => ((variant.tasks.find(entry => entry.id === task)!.initialState ?? variant.initialState).objects[id] as Step).label;
/** Text of one run's details on a page, without markup. */
function runText(html: string, runId: string): string {
  const start = html.indexOf(`<details class="run" id="run-${runId}"`);
  assert.ok(start >= 0, `no details for ${runId}`);
  const end = html.indexOf('</details>', start);
  return plain(html.slice(start, end));
}
const plain = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

let fixtures: Fixtures, dir: string;
test.before(async () => {
  dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-report-v2-'));
  fixtures = await fixtureBenches(dir, { mirror: true });
}, { timeout: 600_000 });
test.after(async () => { await rm(dir, { recursive: true, force: true }); });

test('every checker error class: a failed run names it with its explanation, the unmet condition and when it was last lost or never met', { timeout: 120_000 }, async () => {
  // Every error class the library's checker can report must be shown by some fixture run.
  const classes = new Set(world.tasks.flatMap(task => task.errorClasses.map(error => error.id)));
  const shownBy = new Map(fixtures.failing.report.runs.flatMap(run => (run.checker?.session.errorClasses ?? []).map(id => [id, run] as const)));
  assert.deepEqual([...classes].filter(id => !shownBy.has(id)), [], 'an error class without a fixture run');
  const html = await reportPage(fixtures.failing, 'en'), text = await reportText(fixtures.failing, 'en');
  for (const id of classes) {
    const run = shownBy.get(id)!, task = variant.tasks.find(entry => entry.id === run.taskId)!;
    const explanation = task.errorClasses.find(error => error.id === id)!.explanation.en;
    assert.match(runText(html, run.id), new RegExp(`Error class ${id} — ${explanation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `${id} in ${run.id}`);
    assert.ok(text.includes(`Error class ${id}: ${explanation}`), `${id} in the terminal`);
  }
  // close-chain: the script renamed a, b, c, d in actions 1 … 4; each label condition was lost then.
  const chain = runText(html, 'close-chain-s1-r1');
  [...'abcd'].forEach((id, index) => {
    const sentence = `One rectangle “${label('close-chain', id)}” in the default style.`;
    assert.ok(chain.includes(`Condition not met — ${sentence} — last lost after action ${index + 1}: rename_step(id: “${label('close-chain', id)}”, label: “Wrong ${index + 1}”)`), sentence);
  });
  assert.ok(chain.includes('Condition not met — The drawing has exactly 3 arrows. — never met'));
  // connect: a→b (1), a refused end (2), b→a by the second client (3): one arrow too many since action 3.
  assert.ok(runText(html, 'connect-s1-r1').includes(`Condition not met — The drawing has exactly 1 arrow. — last lost after action 3: connect(from: “${label('connect', 'b')}”, to: “${label('connect', 'a')}”)`));
  // add-step: deleting b loses its arrow at action 1; the third step was never there.
  const added = runText(html, 'add-step-s1-r1');
  assert.ok(added.includes(`Condition not met — One arrow from “${label('add-step', 'a')}” to “${label('add-step', 'b')}”. — last lost after action 1: delete_step(id: “${label('add-step', 'b')}”)`));
  assert.ok(added.includes('Condition not met — The drawing has exactly 3 steps. — never met'));
  // Failures first: every failed run's details come before every passed run's.
  const solved = await reportPage(fixtures.solved, 'en', 're-verified');
  assert.equal(solved.indexOf('<details class="run" id="run-restyle-flow-s1-r1"'), solved.indexOf('<details class="run"'), 'all passed: plan order');
});

test('every run state is shown by name with its reason', { timeout: 120_000 }, async () => {
  const failing = await reportPage(fixtures.failing, 'en');
  const connect = runText(failing, 'connect-s1-r1');
  assert.ok(connect.includes('Rejected actions — 1 of 3 act calls were refused by the host: precondition_failed ×1 — the action did not fit the board at that moment'), 'rejected actions');
  assert.ok(connect.includes('Two agents — 2 MCP clients changed this board: practonaut-bench, second-agent. Every change counts for this run.'), 'two agents');
  assert.ok(connect.includes('model pn-script-model · 5 turns · 12,300 input and 340 output tokens · cost 0.0123 USD — self-reported by the client'), 'client figures');
  assert.ok(connect.includes('client timing unavailable'), 'a template has no client timing');
  assert.ok(runText(failing, 'decision-s1-r1').includes('No action — the agent changed nothing; the checker judged the start board.'), 'empty');
  // Model-only and consistency-checked: in the header line and where they matter.
  const header = plain(failing.slice(0, failing.indexOf('</header>')));
  assert.match(header, /0\/6 passed · 95 % interval 0–40 % over 6 instances · consistency-checked, not re-verified · model only \(no mirror\) · template: tools not restricted by Practonaut · model pn-script-model \(self-reported\)/);
  assert.ok(runText(failing, 'restyle-flow-s1-r1').includes('Schematic of the judged state — not the real Excalidraw. The bench ran model only (no mirror).'), 'model-only picture');
  assert.ok(plain(failing).includes('consistency-checked, not re-verified: the verdicts in the file add up, but the runs were not re-judged (practonaut report --verify)'));
  assert.match(plain(await reportPage(fixtures.solved, 'en', 're-verified')), /2\/2 passed · 95 % interval 34–100 % over 2 instances · re-verified from the artifacts · model only/);
  assert.ok(runText(await reportPage(fixtures.timeout, 'en'), 'connect-s1-r1').includes('Timeout — the agent was stopped after 2 s, the run’s time limit; the board it left was judged.'), 'timeout');
  const unjudged = runText(await reportPage(fixtures.unjudged, 'en'), 'connect-s1-r1');
  assert.match(unjudged, /Not judged — the run could not be judged \(.+\); it counts as not passed, so an infrastructure fault never raises a score\./, 'unjudged');
  assert.equal(fixtures.unjudged.report.runs[0]!.checker, null);
  // Long German names, in German: the authored labels, the agent's long label and the task without a reference.
  const german = await reportPage(fixtures.german, 'de'), germanRun = runText(german, fixtures.german.report.runs[0]!.id);
  for (const name of ['Rechnungseingangsprüfung', 'Zahlungsfreigabeverfahrensdokumentation', 'Kreditorenstammdatenänderungsantragsprüfung']) assert.ok(germanRun.includes(name), name);
  assert.ok(germanRun.includes('Kein Beispielziel: Diese Aufgabe hat keine geprüfte Referenz.'), 'no example target');
  assert.match(plain(german), /0\/1 bestanden · 95-%-Intervall 0–80 % über 1 Instanz · auf Stimmigkeit geprüft, nicht nachgerechnet · nur Modell \(keine Spiegelung\)/);
  // Without its bench folder the report says why there are no details.
  assert.ok(plain(await reportPage({ report: fixtures.failing.report, directory: null }, 'en')).includes('Run details are not shown: the bench folder was not found next to the report'));
  // The built-in client times its own calls.
  assert.match(runText(await reportPage(fixtures.solved, 'en'), 'group-s1-r1'), /bridge median [\d.]+ ms · client median [\d.]+ ms/);
});

test('pictures: correct and incorrect restyle-flow differ, grouped and ungrouped differ — schematic and real engine; text is never markup', { timeout: 120_000 }, async () => {
  const board = (html: string, runId: string): string => {
    const start = html.indexOf('<figure class="board-figure">', html.indexOf(`id="run-${runId}"`));
    return html.slice(start, html.indexOf('</figure>', start));
  };
  const correct = await reportPage(fixtures.solved, 'en'), wrong = await reportPage(fixtures.failing, 'en');
  const right = board(correct, 'restyle-flow-s1-r1'), blue = board(wrong, 'restyle-flow-s1-r1');
  assert.notEqual(right, blue);
  // The script's only difference is the fill of step c: green in the reference, blue in the wrong run.
  assert.match(right, /<ellipse [^>]*class="sch-step sch-fill-green sch-line-black"/); assert.match(blue, /<ellipse [^>]*class="sch-step sch-fill-blue sch-line-black"/);
  const grouped = board(correct, 'group-s1-r1'), ungrouped = board(wrong, 'group-s1-r1');
  assert.notEqual(grouped, ungrouped);
  const members = ['a', 'b', 'c'].map(id => label('group', id));
  assert.match(grouped, /class="sch-group"/); assert.equal(/class="sch-group"/.test(ungrouped), false);
  assert.ok(plain(grouped).includes('Group 1:') && members.every(member => plain(grouped).includes(`“${member}”`)));
  assert.ok(plain(ungrouped).includes('No groups.'));
  // The real engine: its own export, sanitised; groups only in the legend from the judged state.
  const engine = fixtures.engine!;
  const engineRight = await reportPage(engine.solved, 'en'), engineWrong = await reportPage(engine.failing, 'en');
  for (const html of [engineRight, engineWrong]) {
    assert.match(board(html, 'restyle-flow-s1-r1'), /<svg viewBox="[^"]+" class="engine-board" role="img" aria-label="Final board">/);
    assert.ok(plain(board(html, 'restyle-flow-s1-r1')).includes('Exported by the real Excalidraw 0.18.1 at the end of the run.'));
    assert.equal(/<style|<script|data:|style="|xlink|href="(?!#run-)/i.test(html.slice(html.indexOf('<body>'))), false, 'no style, script, data URI or link but the run anchors in the page body');
  }
  assert.notEqual(board(engineRight, 'restyle-flow-s1-r1'), board(engineWrong, 'restyle-flow-s1-r1'));
  assert.ok(plain(board(engineRight, 'group-s1-r1')).includes('Group 1:') && plain(board(engineWrong, 'group-s1-r1')).includes('No groups.'));
  // Every label of the engine's board reaches the page as text.
  for (const id of ['a', 'b', 'c']) assert.ok(board(engineRight, 'restyle-flow-s1-r1').includes(`>${label('restyle-flow', id)}</text>`), id);
  // The example target is the checked reference's end state for this seed.
  assert.ok(plain(correct).includes('Example target One board that meets every condition: a schematic of the checked reference solution for this seed.'));
});

test('a bench folder that was changed or crafted removes an explanation, never fools or breaks the page', { timeout: 120_000 }, async () => {
  const copy = join(dir, 'crafted'); await cp(fixtures.engine!.failing.directory, copy, { recursive: true });
  const report = structuredClone(fixtures.engine!.failing.report), run = report.runs.find(entry => entry.taskId === 'restyle-flow')!;
  // A changed picture: not shown; the schematic of the judged state says why.
  await writeFile(join(copy, run.id, 'board.svg'), '<svg viewBox="0 0 1 1"><text>Forged board</text></svg>');
  let page = runText(await reportPage({ report, directory: copy }, 'en'), run.id);
  assert.ok(page.includes('The real Excalidraw’s picture differs from the hash the report binds.') && !page.includes('Forged board'));
  // A crafted picture bound by its hash: reduced to the allowlist, its script and handler gone.
  const crafted = '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><text x="1" y="5">&lt;img src=x onerror=alert(3)&gt;</text></svg>';
  await writeFile(join(copy, run.id, 'board.svg'), crafted); run.artifacts!.board = createHash('sha256').update(crafted).digest('hex');
  const html = await reportPage({ report, directory: copy }, 'en');
  assert.equal(/<script|onload|onerror=alert\(3\)>/.test(html), false); assert.ok(html.includes('&lt;img src=x onerror=alert(3)&gt;'));
  // A session whose state is not a state, bound by its hash: the conditions say they cannot be read.
  const session = JSON.parse(await readFile(join(copy, run.id, 'session.json'), 'utf8')) as { state: { objects: Record<string, { label: unknown }> } };
  for (const object of Object.values(session.state.objects)) object.label = { not: 'a label' };
  const text = JSON.stringify(session); await writeFile(join(copy, run.id, 'session.json'), text); run.artifacts!.session = createHash('sha256').update(text).digest('hex');
  page = runText(await reportPage({ report, directory: copy }, 'en'), run.id);
  assert.ok(page.includes('The conditions cannot be shown: the file cannot be read'), page.slice(0, 400));
});

test('CLI: report renders details from the bench folder, --runs names it without --verify, and the HTML has one hashed style and no script', { timeout: 300_000 }, async () => {
  const path = join(fixtures.failing.directory, 'report.json'), html = join(dir, 'failing.html');
  const rendered = spawnSync(process.execPath, [CLI, 'report', path, '--html', html], { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /^0\/6 passed · 95 % interval 0–40 % over 6 instances · consistency-checked, not re-verified/m);
  assert.match(rendered.stdout, /^Failures \(6 of 6 runs\)$/m);
  const moved = spawnSync(process.execPath, [CLI, '--lang', 'de', 'report', path, '--runs', fixtures.failing.directory], { encoding: 'utf8' });
  assert.equal(moved.status, 0, moved.stderr); assert.match(moved.stdout, /Fehlerklasse extra-arrow: Es gibt mehr Pfeile als im Ziel \(1\)/);
  const verified = spawnSync(process.execPath, [CLI, 'report', path, '--verify'], { encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr); assert.match(verified.stdout, /re-verified from the artifacts/);
});
