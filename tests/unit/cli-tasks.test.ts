// tasks list | show | from-scenes. play <task-id> needs the built Player: tests/integration/cli-play.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWorld } from '../../src/world/schema.ts';
import { box, scene, arrow } from '../support/scenes.ts';

const main = new URL('../../src/cli/main.ts', import.meta.url).pathname;
const cli = (args: string[], cwd?: string) => spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', timeout: 60_000, ...(cwd ? { cwd } : {}) });

test('tasks list and show describe the bundled library in both languages', () => {
  const list = cli(['tasks', 'list']);
  assert.equal(list.status, 0, list.stderr);
  for (const id of ['add-step', 'insert-between', 'decision', 'two-frames']) assert.match(list.stdout, new RegExp(`^  ${id} `, 'm'));
  const json = JSON.parse(cli(['tasks', 'list', '--json']).stdout) as { tasks: Array<{ id: string; difficulty: number; actions: number }> };
  assert.ok(json.tasks.length >= 12);
  const shown = cli(['--lang', 'de', 'tasks', 'show', 'connect']);
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /Zeichne einen Pfeil von „Request“ nach „Approve“\./);
  assert.match(shown.stdout, /Ein Pfeil von „Request“ nach „Approve“\./);
  assert.doesNotMatch(shown.stdout, /\{\{/);
  assert.doesNotMatch(cli(['tasks', 'show', 'connect']).stdout, /connect \{"from"/);
  assert.match(cli(['tasks', 'show', 'connect', '--oracle']).stdout, /0\. connect \{"from":"a","to":"b"\}/);
  const unknown = cli(['tasks', 'show', 'nope']);
  assert.equal(unknown.status, 2); assert.match(unknown.stderr, /task_unknown/);
  assert.equal(cli(['tasks']).status, 1);
  assert.equal(cli(['tasks', 'show']).status, 1);
});

test('tasks from-scenes writes a playable world and its oracle beside it, refuses what it cannot check', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-scenes-'));
  try {
    await writeFile(join(dir, 'start.excalidraw'), scene([box('a', 'Draft', 100, 100), box('b', 'Send', 400, 100)]));
    await writeFile(join(dir, 'goal.excalidraw'), scene([box('a', 'Draft', 100, 100), box('b', 'Send', 400, 100), arrow('ab', 'a', 'b')]));
    const made = cli(['tasks', 'from-scenes', 'start.excalidraw', 'goal.excalidraw', '--out', 'out', '--task', 'link'], dir);
    assert.equal(made.status, 0, made.stderr);
    assert.match(made.stdout, /the goal scene passes, the start scene fails/);
    const world = validateWorld(JSON.parse(await readFile(join(dir, 'out', 'world', 'world.json'), 'utf8')));
    assert.deepEqual(world.tasks.map(t => t.id), ['link']);
    const oracle = JSON.parse(await readFile(join(dir, 'out', 'oracle.json'), 'utf8')) as { steps: Array<{ name: string }> };
    assert.deepEqual(oracle.steps.map(s => s.name), ['connect']);
    // The world directory packs like any world source: the oracle is not inside it.
    assert.equal(cli(['pack', 'out/world', '--out', 'task.pnworld'], dir).status, 0);
    assert.equal(cli(['tasks', 'from-scenes', 'start.excalidraw', 'goal.excalidraw', '--out', 'out'], dir).status, 1);
    assert.equal(cli(['tasks', 'from-scenes', 'start.excalidraw', 'goal.excalidraw', '--out', 'out', '--force'], dir).status, 0);
    const same = cli(['tasks', 'from-scenes', 'start.excalidraw', 'start.excalidraw', '--out', 'same'], dir);
    assert.equal(same.status, 2); assert.match(same.stderr, /scenes_identical/);
    assert.equal(cli(['tasks', 'from-scenes', 'start.excalidraw', '--out', 'x'], dir).status, 1);
    assert.equal(cli(['tasks', 'from-scenes', 'start.excalidraw', 'goal.excalidraw', '--out', 'x', '--layout', 'absolute'], dir).status, 1);
    assert.equal(cli(['tasks', 'from-scenes', 'missing.excalidraw', 'goal.excalidraw', '--out', 'x'], dir).status, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('tasks from-scenes --out naming a file is a named error, readable in German too', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-scenes-file-'));
  try {
    await writeFile(join(dir, 'start.excalidraw'), scene([box('a', 'Draft', 100, 100), box('b', 'Send', 400, 100)]));
    await writeFile(join(dir, 'goal.excalidraw'), scene([box('a', 'Draft', 100, 100), box('b', 'Send', 400, 100), arrow('ab', 'a', 'b')]));
    await writeFile(join(dir, 'notes.txt'), 'mine\n');
    for (const out of ['notes.txt', 'notes.txt/task']) {
      const result = cli(['tasks', 'from-scenes', 'start.excalidraw', 'goal.excalidraw', '--out', out], dir);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /--out notes\.txt(?:\/task)? is a file, not a folder.*\[usage\]/);
      assert.doesNotMatch(result.stderr, /ENOTDIR/); assert.equal(result.stderr.includes(dir), false, 'no absolute path');
    }
    assert.equal(await readFile(join(dir, 'notes.txt'), 'utf8'), 'mine\n', 'the file is left alone');
    const german = cli(['--lang', 'de', 'tasks', 'from-scenes', 'start.excalidraw', 'goal.excalidraw', '--out', 'notes.txt'], dir);
    assert.match(german.stderr, /ist eine Datei, kein Ordner; .*Einen neuen oder vorhandenen Ordner wählen \[usage\]/);
    assert.doesNotMatch(german.stderr, /\\u\{/, 'catalogue letters are shown, not escaped');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('tasks from-scenes never writes through a link in the output folder', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-scenes-link-'));
  try {
    await writeFile(join(dir, 'start.excalidraw'), scene([box('a', 'A', 0, 0), box('b', 'B', 300, 0)]));
    await writeFile(join(dir, 'goal.excalidraw'), scene([box('a', 'A', 0, 0), box('b', 'B', 300, 0), arrow('ab', 'a', 'b')]));
    await mkdir(join(dir, 'outside'));
    const outside = async () => (await readdir(join(dir, 'outside'))).sort();
    const run = (out: string, force = false) => cli(['tasks', 'from-scenes', 'start.excalidraw', 'goal.excalidraw', '--out', out, ...(force ? ['--force'] : [])], dir);
    // `world` inside the output folder is a link to another folder.
    await mkdir(join(dir, 'a')); await symlink(join(dir, 'outside'), join(dir, 'a', 'world'));
    const viaWorld = run('a'); assert.equal(viaWorld.status, 1); assert.match(viaWorld.stderr, /a\/world is a symbolic link or junction; from-scenes does not write through links/);
    // The output folder itself is a link.
    await symlink(join(dir, 'outside'), join(dir, 'b'));
    const viaRoot = run('b'); assert.equal(viaRoot.status, 1); assert.match(viaRoot.stderr, /b is a symbolic link or junction/);
    // A file target is a link (with --force too): the link is refused, never written through or replaced.
    await mkdir(join(dir, 'c', 'world'), { recursive: true }); await writeFile(join(dir, 'outside', 'victim.json'), 'keep');
    await symlink(join(dir, 'outside', 'victim.json'), join(dir, 'c', 'world', 'world.json'));
    const viaFile = run('c', true); assert.equal(viaFile.status, 1); assert.match(viaFile.stderr, /world\.json is a symbolic link or junction/);
    assert.equal(await readFile(join(dir, 'outside', 'victim.json'), 'utf8'), 'keep');
    await symlink(join(dir, 'outside', 'victim.json'), join(dir, 'c', 'oracle.json')); await rm(join(dir, 'c', 'world', 'world.json'));
    assert.equal(run('c', true).status, 1); assert.equal(await readFile(join(dir, 'outside', 'victim.json'), 'utf8'), 'keep');
    assert.deepEqual(await outside(), ['victim.json'], 'nothing was written outside');
    // A link above the output folder is the user's choice and is followed (macOS /tmp, a moved home).
    await mkdir(join(dir, 'real')); await symlink(join(dir, 'real'), join(dir, 'chosen'));
    const above = run(join('chosen', 'new', 'task')); assert.equal(above.status, 0, above.stderr);
    assert.ok((await lstat(join(dir, 'real', 'new', 'task', 'world', 'world.json'))).isFile());
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('tasks from-scenes writes concrete prompts, checks resizes, and names the task after the output folder', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-scenes-text-'));
  try {
    await writeFile(join(dir, 'start.excalidraw'), scene([box('a', 'Pack', 100, 100), box('s', 'Ship', 400, 100), box('d', 'Done', 700, 100)]));
    await writeFile(join(dir, 'goal.excalidraw'), scene([box('a', 'Pack', 100, 100, { shape: 'ellipse' }), box('s', 'Ship', 400, 100, { fill: '#b2f2bb' }), box('d', 'Done', 760, 100, { width: 260, height: 120 })]));
    const made = cli(['tasks', 'from-scenes', 'start.excalidraw', 'goal.excalidraw', '--out', 'Ship Flow'], dir);
    assert.equal(made.status, 0, made.stderr);
    assert.match(made.stdout, /Task written: 3 steps, 0 arrows, 0 frames in the goal; \d+ goal conditions, \d+ error classes\.\nChecked: .*the reference solution \(\d actions\) passes; \d near miss(?:es fail| fails)\./);
    const world = validateWorld(JSON.parse(await readFile(join(dir, 'Ship Flow', 'world', 'world.json'), 'utf8')));
    assert.deepEqual([world.id, world.tasks[0]!.id], ['ship-flow', 'ship-flow']);
    const task = world.tasks[0]!;
    assert.equal(task.prompt.en, 'Make “Pack” an ellipse. Resize “Done” to 260 × 120. Fill “Ship” green.');
    assert.equal(task.prompt.de, 'Mache „Pack“ zur Ellipse. Ändere die Größe von „Done“ auf 260 × 120. Fülle „Ship“ grün.');
    assert.doesNotMatch(task.prompt.en, /Restyle|Move/, 'no vague verbs, and an unchecked move is not asked for');
    assert.ok(task.conditionTexts!.some(text => text.en === '“Done” is 260 × 120 (± 8 px).'), 'the resize is a condition');
    const fallback = cli(['tasks', 'from-scenes', 'start.excalidraw', 'goal.excalidraw', '--out', '___'], dir);
    assert.equal(fallback.status, 0, fallback.stderr);
    assert.equal(validateWorld(JSON.parse(await readFile(join(dir, '___', 'world', 'world.json'), 'utf8'))).tasks[0]!.id, 'drawn-task');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
