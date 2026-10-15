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
/** The page as a reader sees it before opening any "Technical details". */
const normalPath = (html: string): string => html.replace(/<details class="tech">[\s\S]*?<\/details>/g, '');
/** The first sentence of a library explanation (the factual part; the rest coaches a learner). */
const firstOf = (text: string): string => text.split(/(?<=[.!?])\s+(?=\p{Lu})/u)[0]!;
const plain = (html: string): string => html.replace(/<\/?code>/g, '').replace(/<span class="data">([^<]*)<\/span>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

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
    // The factual first sentence in the normal path, the whole explanation under Technical details.
    assert.ok(runText(normalPath(html), run.id).includes(`Error class ${id}: ${firstOf(explanation)}`), `${id} in ${run.id}`);
    assert.ok(runText(html, run.id).includes(`Error class ${id} ${explanation}`), `${id} in full under Technical details`);
    assert.ok(text.includes(`Error class ${id}: ${firstOf(explanation)}`), `${id} in the terminal`);
  }
  // One item, one colon: no reason in a "Why it failed" list carries a dash.
  for (const list of html.matchAll(/<ul class="reasons">([\s\S]*?)<\/ul><h3>/g)) assert.equal(plain(list[1]!).includes(' — '), false, plain(list[1]!));
  // close-chain: the script renamed a, b, c, d in actions 1 … 4; each label condition was lost then.
  const chain = runText(html, 'close-chain-s1-r1');
  [...'abcd'].forEach((id, index) => {
    const sentence = `One rectangle “${label('close-chain', id)}” in the default style.`;
    assert.ok(chain.includes(`Not met: ${sentence} (last lost after #${index + 1}, rename_step(id: “${label('close-chain', id)}”, label: “Wrong ${index + 1}”))`), sentence);
  });
  assert.ok(chain.includes('Not met: The drawing has exactly 3 arrows. (never met)'));
  // The trajectory names each accepted action's revision (never a "step", which is a box here).
  for (const revision of [1, 2, 3, 4]) assert.ok(chain.includes(`accepted (revision ${revision})`), `revision ${revision}`);
  // connect: a→b (1), a refused end (2), b→a by the second client (3): one arrow too many since action 3.
  assert.ok(runText(html, 'connect-s1-r1').includes(`Not met: The drawing has exactly 1 arrow. (last lost after #3, connect(from: “${label('connect', 'b')}”, to: “${label('connect', 'a')}”))`));
  // add-step: deleting b loses its arrow at action 1; the third step was never there.
  const added = runText(html, 'add-step-s1-r1');
  assert.ok(added.includes(`Not met: One arrow from “${label('add-step', 'a')}” to “${label('add-step', 'b')}”. (last lost after #1, delete_step(id: “${label('add-step', 'b')}”))`));
  assert.ok(added.includes('Not met: The drawing has exactly 3 steps. (never met)'));
  // Failures first: every failed run's details come before every passed run's.
  const solved = await reportPage(fixtures.solved, 'en', 're-verified');
  assert.equal(solved.indexOf('<details class="run" id="run-restyle-flow-s1-r1"'), solved.indexOf('<details class="run"'), 'all passed: plan order');
});

test('every run state is shown by name with its reason', { timeout: 120_000 }, async () => {
  const failing = await reportPage(fixtures.failing, 'en');
  const connect = runText(failing, 'connect-s1-r1');
  assert.ok(connect.includes('Rejected actions: 1 of 3 act calls were refused by the host. the action did not fit the board at that moment (1 ×)'), 'rejected actions');
  assert.ok(connect.includes('Two agents: 2 MCP clients changed this board (practonaut-bench, second-agent); every change counts for this run.'), 'two agents');
  // One colon per reason: none of the states names its reason with a second colon (code aside).
  for (const item of failing.matchAll(/<ul class="reasons">([\s\S]*?)<\/ul><h3>/g)) for (const li of item[1]!.split('<li>').slice(1)) assert.ok(plain(li.replace(/<code>[\s\S]*?<\/code>/g, '')).split(':').length <= 2, plain(li));
  // The goal conditions are numbered: the trajectory's "now met" and "lost" name them by these numbers.
  assert.match(connect, /^.*Goal conditions 1 Met: /);
  assert.ok(runText(failing, 'close-chain-s1-r1').includes('lost: 6, 9'), 'the trajectory names conditions by number');
  assert.ok(connect.includes('Self-reported by the client: model pn-script-model · 5 turns · 12,300 input and 340 output tokens · cost 0.0123 USD.'), 'client figures');
  assert.ok(connect.includes('client timing unavailable'), 'a template has no client timing');
  assert.ok(runText(failing, 'decision-s1-r1').includes('No action: the agent changed nothing; the checker judged the start board.'), 'empty');
  // Codes stay under Technical details; the normal path says the same in words.
  for (const code of ['precondition_failed', 'not ok', 'agent_failed', 'infra_error']) assert.equal(normalPath(failing).includes(code), false, code);
  assert.ok(connect.includes('Codes of refused actions precondition_failed ×1'), 'the code is still there for whoever looks for it');
  // Model-only and consistency-checked: the result and interval in the headline, the provenance as chips.
  const header = plain(failing.slice(0, failing.indexOf('</header>')));
  assert.match(header, /0\/6 passed · 95 % interval 0–40 % over 6 instances consistency-checked, not re-verified model only \(no mirror\) template: tools not restricted by Practonaut model pn-script-model \(self-reported, from the command output\) \d{4}-\d{2}-\d{2}/);
  assert.equal((failing.match(/pn-script-model \(self-reported/g) ?? []).length, 1, 'the model is named once');
  assert.ok(runText(failing, 'restyle-flow-s1-r1').includes('Schematic of the judged state, not the real Excalidraw. The bench ran model only (no mirror).'), 'model-only picture');
  assert.ok(plain(failing).includes('consistency-checked, not re-verified: the verdicts in the file add up, but the runs were not re-judged (practonaut report --verify)'));
  assert.match(plain(await reportPage(fixtures.solved, 'en', 're-verified')), /2\/2 passed · 95 % interval 34–100 % over 2 instances re-verified from the artifacts model only/);
  assert.ok(runText(await reportPage(fixtures.timeout, 'en'), 'connect-s1-r1').includes('Timed out: the agent was stopped after 6 s, the run’s time limit; the board it left was judged.'), 'timeout');
  const unjudgedPage = await reportPage(fixtures.unjudged, 'en'), unjudged = runText(unjudgedPage, 'connect-s1-r1');
  assert.ok(unjudged.includes('No verdict: the run could not be judged, so it counts as not passed; an infrastructure fault never raises a score.'), 'unjudged');
  // No verdict is not a failure: the unknown mark (a dashed ring) and the words, in the table and on the card.
  assert.equal((unjudgedPage.match(/<span class="result unknown"><svg class="status-icon unknown"[^>]*><circle [^>]*stroke-dasharray/g) ?? []).length, 2);
  assert.ok(unjudged.includes('Why there is no verdict') && !unjudged.includes('Why it failed'));
  // The runner's note (it names the fault) is under Technical details, not in the reason.
  assert.ok(unjudged.includes(`Runner note ${fixtures.unjudged.report.runs[0]!.note}`)); assert.equal(runText(normalPath(unjudgedPage), 'connect-s1-r1').includes(fixtures.unjudged.report.runs[0]!.note!), false);
  assert.equal(fixtures.unjudged.report.runs[0]!.checker, null);
  // An agent that acted and then failed: its board is judged (the arrow it drew passes connect).
  const crashed = fixtures.crashed.report.runs[0]!;
  assert.deepEqual([crashed.status, crashed.agentExitCode, crashed.pass], ['agent_failed', 7, true]);
  const crashedPage = await reportPage(fixtures.crashed, 'en'), crashedText = runText(crashedPage, crashed.id);
  assert.ok(crashedText.includes('Agent failed: the agent ended with exit code 7; the board it left was judged.'), crashedText.slice(0, 300));
  // It passed, but its agent did not end normally: its card is open and the header says so.
  assert.ok(crashedPage.includes(`<details class="run" id="run-${crashed.id}" open>`), 'an agent that failed opens its card');
  assert.ok(plain(crashedPage.slice(0, crashedPage.indexOf('</header>'))).includes('1 run did not complete normally (1 agent failed); its card is open below.'));
  assert.ok(crashedPage.includes(`<a href="#run-${crashed.id}">its card is open below.</a>`), 'the note links the card');
  assert.equal((await reportPage(fixtures.solved, 'en')).includes(' open>'), false, 'passing runs that ended normally stay closed');
  // Long German names, in German: the authored labels, the agent's long label and the task without a reference.
  const german = await reportPage(fixtures.german, 'de'), germanRun = runText(german, fixtures.german.report.runs[0]!.id);
  for (const name of ['Rechnungseingangsprüfung', 'Zahlungsfreigabeverfahrensdokumentation', 'Kreditorenstammdatenänderungsantragsprüfung']) assert.ok(germanRun.includes(name), name);
  assert.ok(germanRun.includes('Kein Beispielziel Diese Aufgabe hat keine geprüfte Referenz.'), 'no example target');
  assert.equal(/class="no-picture"|stroke-dasharray|dashed/.test(german.slice(german.indexOf('<body>'))), false, 'no dashed box for a missing target');
  assert.match(plain(german), /0\/1 bestanden · 95-%-Intervall 0–80 % über 1 Instanz auf Stimmigkeit geprüft, nicht nachgerechnet nur Modell \(keine Spiegelung\)/);
  // Without its bench folder: one banner says what is missing, what still shows and how to fix it;
  // every card says in a line what it cannot show, and error classes keep their explanation (the
  // report's world is the bundled library).
  const noFolder = await reportPage({ report: fixtures.failing.report, directory: null }, 'en');
  // The banner sits right under the header, before the summary; the header links every run that did not pass.
  assert.ok(noFolder.indexOf('Run details are partial') > noFolder.indexOf('</header>') && noFolder.indexOf('Run details are partial') < noFolder.indexOf('<section aria-labelledby="summary">'));
  const jump = noFolder.slice(noFolder.indexOf('<nav class="jump"'), noFolder.indexOf('</nav>'));
  assert.deepEqual([...jump.matchAll(/href="#run-([^"]+)"/g)].map(match => match[1]), fixtures.failing.report.runs.filter(run => !run.pass).map(run => run.id));
  assert.ok(plain(noFolder).includes('Run details are partial The bench folder was not found next to the report. Shown: each run’s result, how it ended and its error classes.'));
  assert.ok(plain(noFolder).includes('To show them: practonaut report <report.json> --runs <bench folder>'));
  assert.equal((noFolder.match(/Conditions, board, trajectory and calls need the bench folder\./g) ?? []).length, fixtures.failing.report.runs.length);
  assert.ok(runText(noFolder, 'connect-s1-r1').includes('Error class extra-arrow: There are more arrows than the goal has (1).'));
  // A failed run without an error class still says why.
  assert.ok(runText(noFolder, 'restyle-flow-s1-r1').includes('Not passed: the checker found the goal not met'));
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
    assert.match(board(html, 'restyle-flow-s1-r1'), /<svg viewBox="[^"]+" class="engine-board pw-\d+" role="img" aria-label="Final board">/);
    assert.ok(plain(board(html, 'restyle-flow-s1-r1')).includes('Exported by the real Excalidraw 0.18.1 at the end of the run. report --verify checks only the hash of this picture, not what it shows.'));
    assert.equal(/<style|<script|data:|style="|xlink|href="(?!#run-)/i.test(html.slice(html.indexOf('<body>'))), false, 'no style, script, data URI or link but the run anchors in the page body');
  }
  assert.notEqual(board(engineRight, 'restyle-flow-s1-r1'), board(engineWrong, 'restyle-flow-s1-r1'));
  assert.ok(plain(board(engineRight, 'group-s1-r1')).includes('Group 1:') && plain(board(engineWrong, 'group-s1-r1')).includes('No groups.'));
  // Every label of the engine's board reaches the page as text.
  for (const id of ['a', 'b', 'c']) assert.ok(board(engineRight, 'restyle-flow-s1-r1').includes(`>${label('restyle-flow', id)}</text>`), id);
  // The example target is the checked reference's end state for this seed.
  assert.ok(plain(correct).includes('Example target One board that meets every condition: a schematic of the checked reference solution for this seed.'));
  // A pair is drawn in one viewBox (one scale, one coordinate system), schematic and real engine, and
  // the target names its objects in full too.
  for (const [html, runId] of [[wrong, 'restyle-flow-s1-r1'], [correct, 'group-s1-r1'], [engineWrong, 'restyle-flow-s1-r1'], [engineRight, 'group-s1-r1']] as const) {
    const start = html.indexOf(`id="run-${runId}"`), pictures = [...html.slice(start, html.indexOf('</details>', start)).matchAll(/<svg viewBox="([^"]+)" class="(?:engine-board|schematic) (pw-\d+)"/g)];
    assert.equal(pictures.length, 2, runId);
    assert.deepEqual(pictures[0]!.slice(1), pictures[1]!.slice(1), `${runId}: final board and target share viewBox and size`);
    const target = html.slice(html.indexOf('<span class="figure-title">Example target</span>', start));
    assert.ok(plain(target.slice(0, target.indexOf('</figure>'))).includes('On the board (labels in full)'), `${runId}: target objects`);
  }
  // Excalidraw's own background rectangle is left out of its export (the frame's canvas shows instead).
  assert.equal(board(engineRight, 'restyle-flow-s1-r1').includes('fill="#ffffff"'), false);
  // Groups appear on both pictures of a pair: the export shows none, so the judged state's outline is laid
  // over it (in the shared viewBox) and the caption says where it comes from.
  const groupRun = engineRight.slice(engineRight.indexOf('id="run-group-s1-r1"'), engineRight.indexOf('</details>', engineRight.indexOf('id="run-group-s1-r1"')));
  const pictureAt = groupRun.indexOf('<svg viewBox'), exported = groupRun.slice(pictureAt, groupRun.indexOf('</svg>', pictureAt) + 6);
  assert.match(exported, /class="engine-board pw-\d+"[\s\S]*<rect [^>]*class="sch-group-outline"\/><text [^>]*class="sch-group-label">Group 1<\/text><\/svg>$/);
  assert.ok(plain(groupRun).includes('The group outline is drawn from the judged state: an export shows no groups.'));
  assert.match(groupRun.slice(groupRun.indexOf('Example target')), /class="sch-group"/);
  // A pair that scrolls opens where the first difference lies: the wrong fill of "Done" is at the right.
  const wrongPair = engineWrong.slice(engineWrong.indexOf('id="run-restyle-flow-s1-r1"'), engineWrong.indexOf('</details>', engineWrong.indexOf('id="run-restyle-flow-s1-r1"')));
  assert.equal((wrongPair.match(/<div class="board-scroll overflows-phone from-end"/g) ?? []).length, 2, 'both frames of the pair open at the right end');
  // The runs table (twelve columns) stacks below 60rem; its error-class column is capped.
  assert.match(wrong, /<div class="scroll stack-many" role="region" aria-labelledby="runs"/); assert.match(wrong, /<th scope="col" class="text capped">error classes<\/th>/);
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

test('a forged condition trace bound by its hash is never shown as history', { timeout: 120_000 }, async () => {
  const copy = join(dir, 'forged-trace'); await cp(fixtures.failing.directory, copy, { recursive: true });
  const report = structuredClone(fixtures.failing.report), run = report.runs.find(entry => entry.taskId === 'connect')!;
  const original = JSON.parse(await readFile(join(copy, run.id, 'trace.json'), 'utf8')) as { points: Array<{ seq: number; met: string }> };
  const before = runText(await reportPage({ report, directory: copy }, 'en'), run.id);
  assert.ok(before.includes('last lost after #3'), 'the genuine trace gives the history');
  // Every condition met after a mutation the log does not have (seq 999): bound by a recomputed hash.
  const forged = { ...original, points: [...original.points, { seq: 999, step: 9, met: '11111' }] };
  const text = JSON.stringify(forged) + '\n'; await writeFile(join(copy, run.id, 'trace.json'), text);
  run.artifacts!.trace = createHash('sha256').update(text).digest('hex');
  const page = runText(await reportPage({ report, directory: copy }, 'en'), run.id);
  assert.equal(page.includes('last lost after #') || page.includes('met since #'), false, 'no history from a forged trace');
  assert.ok(page.includes('The conditions cannot be shown: the file cannot be read'));
  // And --verify refuses it by name.
  await writeFile(join(copy, 'report.json'), JSON.stringify(report));
  const refused = spawnSync(process.execPath, [CLI, 'report', join(copy, 'report.json'), '--verify'], { encoding: 'utf8' });
  assert.equal(refused.status, 2); assert.match(refused.stderr, /condition trace.*\[bench_report_invalid\]/);
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
