// A challenge round without a language model (PADR-0040): development reports from the claude-code
// preset (a stand-in `claude` that observes and stops), a round declaration made from them, the
// held-out set generated from the declaration alone, and the gate's refusals of changed set files and
// undeclared development reports. The whole round through the gate (oracle, random and ladder
// benches on 26 instances, every report re-verified, every near miss replayed) takes about fifteen
// minutes on a busy machine; it runs with PN_CHALLENGE_ROUND=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeClaude } from '../support/fake-claude.ts';
import { declarationHash, heldOutSeeds, validateDeclaration, type Declaration } from '../../src/challenge/declaration.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const TOOL = fileURLToPath(new URL('../../tools/challenge.ts', import.meta.url));
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-5-5';
type Json = Record<string, any>;
const json = async (path: string): Promise<Json> => JSON.parse(await readFile(path, 'utf8')) as Json;
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const benchRoot = (): string => join(process.env.PRACTONAUT_HOME!, 'bench');

/** A tight-budget round up to its held-out set: development benches, the declaration, the set. */
async function declaredRound(dir: string) {
  const bin = join(dir, 'bin'); await mkdir(bin); await fakeClaude(bin);
  const pathKey = Object.keys(process.env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...process.env, [pathKey]: bin + delimiter + (process.env[pathKey] ?? '') };
  const tool = (args: string[]) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', env });
  const bench = async (agent: string, setDir: string, model?: string): Promise<string> => {
    const before = new Set(await readdir(benchRoot()).catch(() => [] as string[]));
    const args = ((await json(join(setDir, 'instances.json'))).bench.args as string[]).slice(1);
    const result = spawnSync(process.execPath, [CLI, 'bench', '--agent', agent, ...args, '--mirror', 'off'], { encoding: 'utf8', env: { ...env, ...(model ? { PN_FAKE_MODEL: model } : {}) } });
    assert.equal(result.status, 0, result.stderr);
    const created = (await readdir(benchRoot())).filter(name => !before.has(name));
    assert.equal(created.length, 1);
    return join(benchRoot(), created[0]!, 'report.json');
  };
  /** The same preset runs reported under another model (the client's model is self-reported);
   * `spaced` writes the file with other white space (the same report, other bytes). */
  let copies = 0;
  const relabel = async (report: string, model: string, options: { runModel?: (index: number) => string; spaced?: boolean } = {}): Promise<string> => {
    const folder = join(dir, `relabelled-${++copies}`); await cp(join(report, '..'), folder, { recursive: true });
    const value = await json(join(folder, 'report.json')); value.agent.model = model;
    value.runs.forEach((run: Json, index: number) => { run.client.model = options.runModel?.(index) ?? model; });
    await writeFile(join(folder, 'report.json'), options.spaced ? JSON.stringify(value, null, 1) : JSON.stringify(value));
    return join(folder, 'report.json');
  };
  assert.equal(tool(['generate', 'tight-budget', '--set', 'dev', '--count', '3', '--difficulty', '1', '--out', join(dir, 'dev')]).status, 0);
  const devOpus = await bench('claude-code', join(dir, 'dev'), OPUS);
  const dev = [devOpus, await relabel(devOpus, SONNET), await relabel(devOpus, HAIKU)];
  const declarations = join(dir, 'declarations'); await mkdir(declarations);
  const declarationPath = join(declarations, 'tight-budget-round-1.declaration.json');
  const declare = (reports: string[], runs: string) => tool(['declare', '--family', 'tight-budget', '--round', '1', '--difficulty', '1', '--dev', reports.join(','), '--release-runs', runs, '--out', declarationPath]);
  return { env, tool, bench, relabel, dev, declare, declarationPath };
}

test('a round is declared from its development reports, its held-out set follows from the declaration, and the gate refuses changed set files and undeclared development reports', { timeout: 600_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-challenge-round-'));
  try {
    const { tool, relabel, dev, declare, declarationPath } = await declaredRound(dir);
    const [devOpus, devSonnet, devHaiku] = dev as [string, string, string];
    let refused = declare([devHaiku, devOpus, devSonnet], '34');
    assert.equal(refused.status, 2); assert.match(refused.stderr, /--release-runs 34 is below the 35 model runs the release has used or declared/);
    refused = declare([devHaiku, devOpus, await relabel(devOpus, SONNET, { runModel: index => index === 1 ? OPUS : SONNET })], '35');
    assert.equal(refused.status, 2); assert.match(refused.stderr, /run tight-budget-2-s1-r1 of the claude-sonnet-5-5 report ran on claude-opus-5-5/);
    // Another declaration in the folder counts 87 more runs before the next round.
    await writeFile(join(declarationPath, '..', 'repair-round-1.declaration.json'), '{}');
    refused = declare([devHaiku, devOpus, devSonnet], '35');
    assert.equal(refused.status, 2); assert.match(refused.stderr, /below the 122 model runs the release has used or declared \(35 before preregistration, 1 declared round of 87\)/);
    await rm(join(declarationPath, '..', 'repair-round-1.declaration.json'));
    // The reports in any order: the tiers are ordered by capability.
    const declared = declare([devHaiku, devOpus, devSonnet], '35');
    assert.equal(declared.status, 0, declared.stderr);
    // Every agent failed every development instance: the tie goes to the capability order.
    assert.match(declared.stdout, /strongest claude-opus-5-5, weakest claude-haiku-5-5/);
    assert.match(declared.stdout, /release runs after this round: 122 of 500/);
    const declaration: Declaration = validateDeclaration(await json(declarationPath));
    assert.deepEqual(declaration.ladder, [OPUS, SONNET, HAIKU]);
    assert.deepEqual(declaration.development.seeds, [1, 2, 3]);
    assert.deepEqual(declaration.development.reports.map(report => report.sha256), [sha256(await readFile(devOpus)), sha256(await readFile(devSonnet)), sha256(await readFile(devHaiku))]);
    assert.deepEqual(declaration.bench, { mirror: 'off', timeoutSeconds: 600, maxActions: 50, checks: null });

    // The held-out set: from the declaration only.
    refused = tool(['generate', 'tight-budget', '--set', 'heldout', '--round', '1', '--seed', '1000000', '--out', join(dir, 'x')]);
    assert.equal(refused.status, 1); assert.match(refused.stderr, /a held-out set is generated from its round declaration/);
    refused = tool(['generate', 'tight-budget', '--set', 'heldout', '--declaration', declarationPath, '--seed', '1000000', '--out', join(dir, 'x')]);
    assert.equal(refused.status, 1); assert.match(refused.stderr, /--seed is fixed by the declaration/);
    const made = tool(['generate', 'tight-budget', '--set', 'heldout', '--declaration', declarationPath, '--out', join(dir, 'heldout')]);
    assert.equal(made.status, 0, made.stderr);
    const seeds = heldOutSeeds(declaration), manifest = await json(join(dir, 'heldout', 'instances.json'));
    assert.deepEqual(manifest.seeds, seeds);
    assert.equal(manifest.declaration.sha256, declarationHash(declaration));
    for (const entry of manifest.instances) {
      assert.equal(entry.oracle.sha256, sha256(await readFile(join(dir, 'heldout', 'oracles', `${entry.taskId}.json`))));
      assert.ok(entry.oracle.nearMisses >= 1);
    }

    // Changed set files are refused before any report is read (the report paths do not exist).
    let gates = 0;
    const gate = (setDir: string, reports: { dev: string[]; oracle: string; random: string; ladder: string[] }) => tool(['gate', '--declaration', declarationPath, '--set', setDir,
      '--dev', reports.dev.join(','), '--oracle', reports.oracle, '--random', reports.random, '--ladder', reports.ladder.join(','), '--out', join(dir, `gate-${++gates}.md`)]);
    const none = { dev: ['a', 'b', 'c'], oracle: 'o', random: 'r', ladder: ['x', 'y', 'z'] };
    const changedSet = async (change: (setDir: string) => Promise<void>): Promise<ReturnType<typeof tool>> => {
      const copy = join(dir, `set-${++gates}`); await cp(join(dir, 'heldout'), copy, { recursive: true }); await change(copy); return gate(copy, none);
    };
    const first = manifest.instances[0].taskId as string;
    refused = await changedSet(async copy => { const path = join(copy, 'oracles', `${first}.json`), oracle = await json(path); oracle.nearMisses = []; await writeFile(path, JSON.stringify(oracle, null, 2) + '\n'); });
    assert.equal(refused.status, 2); assert.match(refused.stderr, new RegExp(`oracles/${first}\\.json does not match the SHA-256 instances\\.json records`));
    refused = await changedSet(async copy => {
      const path = join(copy, 'oracles', `${first}.json`), oracle = await json(path); oracle.nearMisses = []; const text = JSON.stringify(oracle, null, 2) + '\n'; await writeFile(path, text);
      const changed = await json(join(copy, 'instances.json')); changed.instances[0].oracle = { sha256: sha256(text), nearMisses: 0 }; await writeFile(join(copy, 'instances.json'), JSON.stringify(changed));
    });
    assert.equal(refused.status, 2); assert.match(refused.stderr, new RegExp(`oracles/${first}\\.json is not the regenerated reference and near misses`));
    // An easier world under the held-out labels: its limit raised.
    refused = await changedSet(async copy => { const path = join(copy, 'world', 'world.json'), world = await json(path); world.tasks[0].limits = { actions: 40 }; await writeFile(path, JSON.stringify(world)); });
    assert.equal(refused.status, 2); assert.match(refused.stderr, /world\/world\.json is not the world the generator makes from the declaration/);
    // A development report that is not the declared file (the same content, other bytes): refused
    // after the development reports are re-verified, before any held-out report is read.
    refused = gate(join(dir, 'heldout'), { ...none, dev: [devOpus, await relabel(devOpus, SONNET, { spaced: true }), devHaiku] });
    assert.equal(refused.status, 2); assert.match(refused.stderr, /the development report of claude-sonnet-5-5 is not the file the declaration names/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the whole round through the gate: oracle, random and the ladder on the 26 held-out instances', { timeout: 2_400_000, skip: process.env.PN_CHALLENGE_ROUND === '1' ? false : 'about fifteen minutes; run with PN_CHALLENGE_ROUND=1' }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-challenge-gate-'));
  try {
    const { tool, bench, relabel, dev, declare, declarationPath } = await declaredRound(dir);
    assert.equal(declare(dev, '35').status, 0);
    const declaration = validateDeclaration(await json(declarationPath)), seeds = heldOutSeeds(declaration);
    assert.equal(tool(['generate', 'tight-budget', '--set', 'heldout', '--declaration', declarationPath, '--out', join(dir, 'heldout')]).status, 0);
    const oracle = await bench('oracle', join(dir, 'heldout')), random = await bench('random', join(dir, 'heldout'));
    const ladderOpus = await bench('claude-code', join(dir, 'heldout'), OPUS);
    const ladder = [ladderOpus, await relabel(ladderOpus, SONNET), await relabel(ladderOpus, HAIKU)];
    const out = join(dir, 'tight-budget-round1.md');
    const gated = tool(['gate', '--declaration', declarationPath, '--set', join(dir, 'heldout'), '--dev', dev.join(','), '--oracle', oracle, '--random', random, '--ladder', ladder.join(','), '--out', out]);
    assert.equal(gated.status, 0, gated.stderr);
    assert.match(gated.stdout, /tight-budget round 1: does not pass/);
    const markdown = await readFile(out, 'utf8');
    assert.match(markdown, /\| oracle \| 26\/26 \| oracle passes 100 % \| yes \|/);
    assert.match(markdown, /\| random \| 0\/26 \(0\.0 %\) \| random passes ≤ 5 % \| yes \|/);
    assert.match(markdown, /\| near-misses \| (\d+)\/\1 fail \| every near miss fails \| yes \|/);
    assert.match(markdown, /\| headroom \| 0\/26 \(0\.0 %\) \|.*\| no \|/);
    assert.match(markdown, new RegExp(`\\| Held-out instances \\| 26 \\(generator seeds ${seeds[0]}–${seeds.at(-1)}, derived from the declaration`));
    assert.match(markdown, /\| budget \| 87 model runs \(78 gate \+ 9 development\); release 122 of 500 \|/);
    // A ladder report of another model's runs: refused (review S3).
    const mixed = await relabel(ladderOpus, SONNET, { runModel: index => index % 2 ? OPUS : SONNET });
    const refused = tool(['gate', '--declaration', declarationPath, '--set', join(dir, 'heldout'), '--dev', dev.join(','), '--oracle', oracle, '--random', random, '--ladder', [ladderOpus, mixed, ladder[2]!].join(','), '--out', join(dir, 'other.md')]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /of the claude-sonnet-5-5 report ran on claude-opus-5-5/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
