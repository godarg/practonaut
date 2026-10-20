// The 0.3.0 gate (PADR-0042 as amended on acceptance): units, the probe plan, the pre-probe, the
// declaration /2 and the gate with its ledger bindings, and the fixes of the gate tool's review (PR #71):
// every run on a round's instances in one repeat check whatever its purpose, plan or declaration;
// funding read from the ledger; a lost run-end record voids a judged run; a non-run counts against
// passing. Reports, ledgers and outcomes are hand-built (tests/support/challenge-round.ts); every
// expected number is counted by hand from the outcome tables below, and every refusal is named by its
// code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateBenchReportV3, type SessionRunV3 } from '../../src/bench/report.ts';
import { checkRetune, developmentDigest, fileHash, funded, fundingAt, heldOutSeeds, refuseRecordedProbe, refuseRedeclaration, validateDeclaration, RoundError, type Declaration } from '../../src/challenge/declaration.ts';
import { attests, computeGate, exemptRun, mergeAgentRuns, preflightGate, probeRuns, renderGate, GateInputError, type GateReport } from '../../src/challenge/gate.ts';
import { checkUnit, PREREGISTERED_UNITS, UnitError } from '../../src/challenge/units.ts';
import { heldOutSeedsV1, validateDeclarationV1, validateLedgerV1 } from '../../src/challenge/round-020.ts';
import { parseLedger, roundStarts, type RoundBody } from '../../src/challenge/ledger.ts';
import { HAIKU, OPUS, SONNET, UNIT, admissionOf, builtinRun, declarationOf, declaredOf, first, gateReport, hash, heldReport, inputOf, ledgerOf, planOf, presetRun, probeRecordOf, probeReport, report, roundLedger, roundOf, GENERATOR, HELD_WORLD, PROBE_WORLD } from '../support/challenge-round.ts';

const round = roundOf(3);
const ladder = (strong: boolean[], middle: boolean[], weak: boolean[], options: { opus?: Parameters<typeof heldReport>[3]; sonnet?: Parameters<typeof heldReport>[3]; haiku?: Parameters<typeof heldReport>[3] } = {}): GateReport[] =>
  [heldReport(round, OPUS, strong, options.opus), heldReport(round, SONNET, middle, options.sonnet), heldReport(round, HAIKU, weak, options.haiku)];
const passing = (): GateReport[] => ladder(first(round, 15), first(round, 10), first(round, 4));
const refused = (work: () => unknown, code: string, message?: RegExp): void => assert.throws(work, (error: unknown) => (error instanceof GateInputError || error instanceof RoundError || error instanceof UnitError) && error.code === code && (!message || message.test(error.message)), `${code}${message ? ` ${message.source}` : ''}`);
const declared = (extra: Partial<Declaration> = {}, budget: Partial<Declaration['budget']> = {}): unknown => declarationOf(round.plan, round.record, extra, budget);
const zero = { preProbe: 7, heldOut: 78, total: 85, exempt: 0, planned: 85, other: 0 };

test('the hand-built round is valid bench/3 at session level, and its files validate', () => {
  for (const source of [...round.probe, ...passing(), heldReport(round, 'oracle', round.tasks.map(() => true)), heldReport(round, 'random', round.tasks.map(() => false))]) assert.doesNotThrow(() => validateBenchReportV3(source.report), source.report.agent.name);
  assert.doesNotThrow(() => validateDeclaration(round.declaration));
  assert.equal(round.record.passed, 3); assert.equal(round.record.admitted, true);
  assert.equal(round.seeds.length, 26);
});

test('units: preregistered, approved by name (review: gate-maintainer-approval-not-by-name), refused on a foreign toolchain when they rely on Practonaut\'s host, and named when no generator or toolchain exists', () => {
  assert.ok(PREREGISTERED_UNITS.length <= 10);
  assert.deepEqual(PREREGISTERED_UNITS.filter(unit => unit.endsWith('.practonaut')), ['layout.practonaut', 'human-edit.practonaut']);
  refused(() => checkUnit('repair.practonaut', false), 'unit_not_preregistered', /--maintainer-approved-unit repair\.practonaut/);
  assert.equal(checkUnit('repair.practonaut', true).level, 'session');
  for (const family of ['limited-checks', 'tight-budget', 'human-edit']) refused(() => checkUnit(`${family}.excalidraw-mcp-0.3.2`, true), 'unit_family_toolchain');
  refused(() => checkUnit('repair.excalidraw-mcp-0.3.2', false), 'toolchain_unavailable');
  refused(() => checkUnit('repair.some-server-1.0.0', true), 'toolchain_unknown');
  refused(() => checkUnit('layout.practonaut', false), 'family_unavailable', /no generator in this Practonaut yet/);
  refused(() => checkUnit('repair', true), 'unit_invalid');
  // The plan and the declaration record which unit the maintainer approved; another unit's approval refuses.
  assert.equal(planOf().maintainerApprovedUnit, UNIT);
  refused(() => planOf({ maintainerApprovedUnit: null }), 'unit_not_preregistered');
  refused(() => planOf({ maintainerApprovedUnit: 'injection.practonaut' }), 'unit_approval_mismatch', /approved injection\.practonaut, not repair\.practonaut/);
  refused(() => validateDeclaration(declared({ maintainerApprovedUnit: 'injection.practonaut' })), 'unit_approval_mismatch');
});

test('the probe plan: shape B, Opus through claude-code, seven distinct seeds, the round and probe limits, the family cap', () => {
  assert.equal(planOf().seeds.length, 7);
  refused(() => planOf({ shape: 'A' }), 'shape_a_refused');
  refused(() => planOf({ agent: { preset: 'codex', model: OPUS } }), 'ladder_preset_refused');
  refused(() => planOf({ agent: { preset: 'claude-code', model: SONNET } }), 'probe_agent_not_strongest');
  refused(() => planOf({ seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }), 'shape_b_sizes');
  refused(() => planOf({ round: 3 }), 'round_limit');
  refused(() => planOf({ probe: 3 }), 'probe_retune_exhausted');
  refused(() => planOf({ bench: { ...planOf().bench, maxActions: 60 } }), 'max_actions_above_cap', /above the repair cap of 50/);
  // A retune: probe 2 after a refused probe 1, a newer generator version, new seeds; once.
  const one = planOf(), two = { ...planOf(), probe: 2, generator: { ...GENERATOR, version: '1.1.0' }, seeds: [11, 12, 13, 14, 15, 16, 17] };
  assert.doesNotThrow(() => checkRetune(two, { plan: one, admitted: false }));
  refused(() => checkRetune(two, { plan: one, admitted: true }), 'probe_retune_invalid', /only a refused unit is retuned/);
  refused(() => checkRetune({ ...two, generator: GENERATOR }, { plan: one, admitted: false }), 'probe_retune_invalid', /a new generator version/);
  refused(() => checkRetune({ ...two, seeds: [7, 12, 13, 14, 15, 16, 17] }, { plan: one, admitted: false }), 'probe_retune_invalid', /new seeds/);
  refused(() => checkRetune(two, null), 'probe_retune_invalid');
  refused(() => checkRetune(one, { plan: one, admitted: false }), 'probe_retune_invalid', /probe 1 of this unit and round exists already/);
});

test('the pre-probe admits at 1–5 of 7 passes (shape B, no extension)', () => {
  for (const [passes, admitted] of [[0, false], [1, true], [3, true], [5, true], [6, false], [7, false]] as const) {
    const plan = planOf(), probe = [probeReport(passes)];
    const record = probeRecordOf(plan, probe, ledgerOf([{ reports: probe, purpose: 'pre-probe', basis: fileHash(plan) }]));
    assert.equal(record.passed, passes); assert.equal(record.admitted, admitted, `${passes} of 7`);
    if (!admitted) refused(() => validateDeclaration(declarationOf(plan, record)), 'unit_not_admitted');
  }
});

test('a pre-probe under another plan of the round is refused unless that plan\'s pre-probe was recorded as refused (review: gate-preprobe-reroll-by-replan)', () => {
  const plan = round.plan, other = planOf({ difficulty: '2' });
  // Plan 1's pre-probe (6 of 7, which would refuse the unit) is dropped and the same instances pre-probed
  // again under another probe-1 plan: refused, whatever the second pre-probe gives.
  const first7 = probeReport(6), again = probeReport(3);
  const ledger = ledgerOf([{ reports: [first7], purpose: 'pre-probe', basis: fileHash(other) }, { reports: [again], purpose: 'pre-probe', basis: fileHash(plan) }]);
  refused(() => probeRuns({ plan, planHash: fileHash(plan), worldContentHash: PROBE_WORLD, reports: [again], ledger, folders: new Map() }), 'probe_replanned', /under another plan .* not recorded as refused/);
  // A retune (probe 2 on new seeds) follows a probe 1 the ledger recorded as refused: allowed.
  const two = planOf({ probe: 2, seeds: [11, 12, 13, 14, 15, 16, 17] }), retuned = probeReport(3, { probeSeeds: two.seeds, world: hash('b') });
  const refusedOne: RoundBody = { kind: 'round', event: 'refused', unit: UNIT, round: 1, probe: 1, plan: fileHash(other), record: hash('2'), declaration: null, world: PROBE_WORLD, heldOutRuns: 0 };
  const retune = ledgerOf([{ reports: [first7], purpose: 'pre-probe', basis: fileHash(other) }, { round: refusedOne }, { reports: [retuned], purpose: 'pre-probe', basis: fileHash(two) }]);
  assert.equal(probeRuns({ plan: two, planHash: fileHash(two), worldContentHash: hash('b'), reports: [retuned], ledger: retune, folders: new Map() }).passed, 3);
  // Both pre-probes count for the round: the starts of either plan belong to it.
  assert.equal(roundStarts(retune, UNIT, 1).length, 14);
});

test('the declaration /2: every refusal of PADR-0042 by name', () => {
  assert.doesNotThrow(() => validateDeclaration(declared()));
  const agent = (model: string, preset = 'claude-code', billing: 'subscription' | 'local' | 'api-key' | 'unknown' = 'subscription') => ({ preset, client: preset, model, attestation: 'client-attested' as const, billing });
  const three = [agent(OPUS), agent(SONNET), agent(HAIKU)];
  refused(() => validateDeclaration(declared({ shape: 'A' })), 'shape_a_refused');
  // PADR-0046: no preset but claude-code is gate-eligible in 0.3.0.
  for (const preset of ['codex', 'codex-oss', 'opencode-local', 'gemini-cli']) refused(() => validateDeclaration(declared({ ladder: [agent(OPUS), { ...agent(SONNET, preset) }, agent(HAIKU)] })), 'ladder_preset_refused', new RegExp(`names ${preset}`));
  refused(() => validateDeclaration(declared({ ladder: [agent(OPUS), agent(SONNET, 'claude-code', 'local'), agent(HAIKU)] })), 'shape_a_refused', /local ladder agent/);
  refused(() => validateDeclaration(declared({ ladder: [agent(OPUS), agent(HAIKU)], pair: { strongest: OPUS, weakest: HAIKU } })), 'ladder_too_small');
  refused(() => validateDeclaration(declared({ ladder: [...three, agent('claude-opus-4-1')] })), 'too_many_subscription_agents');
  refused(() => validateDeclaration(declared({ heldOut: { instances: 23 } })), 'round_too_small');
  refused(() => validateDeclaration(declared({ heldOut: { instances: 27 } })), 'round_formula_exceeded', /\(held-out 27 \+ pre-probe 7\) × 3 subscription agents = 102 exceeds 100/);
  refused(() => validateDeclaration(declared({ heldOut: { instances: 25 } })), 'shape_b_sizes');
  refused(() => validateDeclaration(declared({ ladder: [agent(OPUS), { ...agent(SONNET), attestation: 'not-attested' }, agent(HAIKU)] })), 'gate_pair_not_attested');
  refused(() => validateDeclaration(declared({ ladder: [agent(SONNET), agent(OPUS), agent(HAIKU)], pair: { strongest: SONNET, weakest: HAIKU } })), 'ladder_order');
  refused(() => validateDeclaration(declared({ pair: { strongest: SONNET, weakest: HAIKU } })), 'gate_pair_fixed');
  refused(() => validateDeclaration(declared({ round: 3, alpha: 0.025 })), 'round_limit');
  refused(() => validateDeclaration(declared({ alpha: 0.025 })), 'alpha_invalid');
  refused(() => validateDeclaration(declared({ round: 2, alpha: 0.025 })), 'previous_round');
  refused(() => validateDeclaration(declared({ previous: { declaration: hash('1'), low: 1, high: 2 } })), 'previous_round');
  // A second round whose seeds fall into the first round's range (the round enters the derivation, so
  // the overlap is constructed: the first round named a range that holds one of the second's seeds).
  const second = heldOutSeeds({ ...round.declaration, round: 2 });
  refused(() => validateDeclaration(declared({ round: 2, alpha: 0.025, previous: { declaration: hash('1'), low: second[25]!, high: second[25]! + 25 } })), 'heldout_overlap');
  assert.doesNotThrow(() => validateDeclaration(declared({ round: 2, alpha: 0.025, previous: { declaration: hash('1'), low: second[25]! + 1, high: second[25]! + 26 } })));
  refused(() => validateDeclaration(declared({}, { formula: 98 })), 'declaration_invalid');
  refused(() => validateDeclaration(declared({ bench: { ...round.plan.bench, maxActions: 51 } })), 'max_actions_above_cap');
});

test('funding is read from the ledger: declared rounds keep their unstarted held-out runs, earlier admissions theirs, and two foreign rounds (review: gate-funding-ignores-declared-rounds, budget-funding-working-tree-only)', () => {
  const ours = round.groups.findIndex(group => 'round' in group && typeof group.round === 'object' && group.round !== null && (group.round as RoundBody).event === 'admitted');
  const base = ledgerOf(round.groups.slice(0, ours + 1));
  const admission = base.records.length - 1;
  // Alone: the 7 pre-probe runs counted, two foreign rounds (2 × 99) kept.
  assert.deepEqual(fundingAt(base, UNIT, 1, admission), { before: 7, reserved: 198 });
  const event = (unit: string, kind: RoundBody['event'], extra: Partial<RoundBody> = {}): { round: RoundBody } => ({ round: { kind: 'round', event: kind, unit, round: 1, probe: 1, plan: hash('3'), record: hash('4'), declaration: kind === 'declared' ? hash('5') : null, world: hash('6'), heldOutRuns: kind === 'declared' ? 78 : 0, ...extra } });
  // Another unit declared and not started: its 78 held-out runs are kept (they were free before).
  const declaredOther = ledgerOf([...round.groups.slice(0, ours + 1), event('injection.practonaut', 'admitted'), event('injection.practonaut', 'declared')]);
  assert.deepEqual(fundingAt(declaredOther, UNIT, 1, admission), { before: 7, reserved: 198 + 78 });
  // After 26 of its held-out runs started (on its held-out world), 52 are kept.
  const started = heldReport({ ...round, heldWorld: hash('6') }, OPUS, first(round, 0));
  const partly = ledgerOf([...round.groups.slice(0, ours + 1), event('injection.practonaut', 'admitted'), event('injection.practonaut', 'declared'), { reports: [started], purpose: 'held-out', basis: hash('5'), unit: 'injection.practonaut', round: 1 }]);
  assert.deepEqual(fundingAt(partly, UNIT, 1, admission), { before: 7 + 26, reserved: 198 + 52 });
  // A unit admitted before ours and not declared keeps 78; one admitted after ours, or refused, keeps none.
  const earlier = ledgerOf([event('layout.practonaut', 'admitted'), ...round.groups.slice(0, ours + 1)]);
  assert.deepEqual(fundingAt(earlier, UNIT, 1, earlier.records.length - 1), { before: 7, reserved: 198 + 78 });
  const later = ledgerOf([...round.groups.slice(0, ours + 1), event('layout.practonaut', 'admitted'), event('human-edit.practonaut', 'refused')]);
  assert.deepEqual(fundingAt(later, UNIT, 1, admission), { before: 7, reserved: 198 });
  // A declared foreign round takes one of the two foreign rounds.
  const foreign = ledgerOf([...round.groups.slice(0, ours + 1), event('repair.excalidraw-mcp-0.3.2', 'admitted'), event('repair.excalidraw-mcp-0.3.2', 'declared')]);
  assert.deepEqual(fundingAt(foreign, UNIT, 1, admission), { before: 7, reserved: 99 + 78 });
  // 800 − 78 held-out − 198 reserved − 40 = 484 runs before the round.
  assert.doesNotThrow(() => validateDeclaration(declared({}, { before: 484 })));
  refused(() => validateDeclaration(declared({}, { before: 485 })), 'unit_not_funded', /admitted, not gated for budget/);
  assert.equal(funded({ before: 682, reserved: 0, leave: 40, cap: 800 }, 78), true);
  assert.equal(funded({ before: 683, reserved: 0, leave: 40, cap: 800 }, 78), false);
  // The gate re-derives the figures from the ledger the declaration counted.
  const wrong = roundOf(3, planOf(), {}, { reserved: 0 });
  refused(() => computeGate(inputOf(wrong, [heldReport(wrong, OPUS, first(wrong, 15)), heldReport(wrong, SONNET, first(wrong, 10)), heldReport(wrong, HAIKU, first(wrong, 4))])), 'budget_mismatch', /\(7 counted, 0 reserved\) is not what the release ledger it counted gives \(7, 198\)/);
});

test('digest /2: canonical content in UTF-16 code-unit order, never a locale; the held-out seeds name the unit', () => {
  const runs = [
    { model: 'b', taskId: 'repair-10', seed: 10, pass: true, hash: 'h1', log: '[]' },
    { model: 'B', taskId: 'repair-9', seed: 9, pass: false, hash: 'h2', log: '[]' },
    { model: 'b', taskId: 'repair-1', seed: 1, pass: false, hash: 'h3', log: '[]' },
  ];
  // Written by hand: "B" (0x42) sorts before "b" (0x62), "repair-1" before "repair-10"; keys sorted.
  const text = '{"digest":"practonaut.challenge-development/2","runs":[{"hash":"h2","log":"[]","model":"B","pass":false,"seed":9,"taskId":"repair-9"},{"hash":"h3","log":"[]","model":"b","pass":false,"seed":1,"taskId":"repair-1"},{"hash":"h1","log":"[]","model":"b","pass":true,"seed":10,"taskId":"repair-10"}]}';
  assert.equal(developmentDigest([...runs].reverse()), createHash('sha256').update(text).digest('hex'));
  const seedText = `{"development":"${round.declaration.development.digest}","generator":"1.0.0","release":"0.3.0","round":1,"seeds":"practonaut.challenge-seeds/2","unit":"repair.practonaut"}`;
  const base = 1_000_000 + Number(BigInt(`0x${createHash('sha256').update(seedText).digest('hex').slice(0, 12)}`) % 900_000_000n);
  assert.deepEqual(round.seeds, Array.from({ length: 26 }, (_, index) => base + index));
  assert.notDeepEqual(heldOutSeeds({ ...round.declaration, unit: 'injection.practonaut' }), round.seeds);
});

test('a whole round: the verdict and every number, counted by hand', () => {
  const result = computeGate(inputOf(round, passing()));
  // Opus 15/26, Sonnet 10/26, Haiku 4/26 (the first k instances): 11 discordant for Opus, none for Haiku.
  assert.equal(result.verdict, 'passes');
  assert.deepEqual([result.strongest.passed, result.agents[3]!.passed, result.weakest.passed], [15, 10, 4]);
  assert.deepEqual([result.discordant.strongestOnly, result.discordant.weakestOnly], [11, 0]);
  assert.ok(Math.abs(result.discordant.p - 2 * 0.5 ** 11) < 1e-12);
  assert.deepEqual(result.spend, zero);
  assert.deepEqual([result.ledger.counted, result.ledger.cap, result.builtin], [85, 800, { oracle: 26, random: 26 }]);
  const markdown = renderGate(result);
  assert.match(markdown, /\*\*Verdict: the unit passes round 1\.\*\* ladder: Claude models only\./);
  assert.match(markdown, /\| budget \| 85 model runs counted \(78 held-out \+ 7 pre-probe\); release 85 of 800 \|/);
  assert.match(markdown, /Opus passed 3 of 7 \(admitted at 1–5\)/);
  // Headroom: 21 of 26 (80.8 %) is above 80 %; 20 of 26 (76.9 %) is within.
  assert.equal(computeGate(inputOf(round, ladder(first(round, 21), first(round, 10), first(round, 4)))).verdict, 'does not pass');
  assert.equal(computeGate(inputOf(round, ladder(first(round, 20), first(round, 10), first(round, 4)))).verdict, 'passes');
  // Discrimination: Haiku 10 of 26 against Opus 15: 19.2 points.
  assert.equal(computeGate(inputOf(round, ladder(first(round, 15), first(round, 10), first(round, 10)))).criteria.find(c => c.name === 'difference')!.met, false);
});

test('a weakest-agent non-run counts against passing: leaving out Haiku\'s runs cannot make a pair discordant (review: gate-missing-weakest-runs-inflate-discordance)', () => {
  // Opus 10/26, Sonnet 8/26, Haiku 6/26 (nested): b = 4, c = 0, p = 0.125, 15.4 points — does not pass.
  const full = computeGate(inputOf(round, ladder(first(round, 10), first(round, 8), first(round, 6))));
  assert.deepEqual([full.discordant.strongestOnly, full.verdict], [4, 'does not pass']);
  // Haiku's runs on three instances Opus passed (6–8) left out (under 5 %). Counted as failures they
  // would make b = 7, p = 0.0156 and 26.9 points — a pass. Counted as Haiku's passes: b = 1, 3.8 points.
  const holes = heldReport(round, HAIKU, first(round, 6), { run: (task, index) => index >= 6 && index <= 8 ? null : presetRun(task, index < 6, HAIKU) });
  const thinned = computeGate(inputOf(round, [heldReport(round, OPUS, first(round, 10)), heldReport(round, SONNET, first(round, 8)), holes]));
  assert.deepEqual([thinned.weakest.missing, thinned.weakest.passed, thinned.discordant.strongestOnly, thinned.verdict], [3, 6, 1, 'does not pass']);
  assert.match(thinned.criteria.find(c => c.name === 'difference')!.value, /^3\.8 points \(3 instances the weakest did not run counted as passed\)/);
});

test('a second round decides at α = 0.025 on new instances; the report states the bound over both rounds (review: gate-bonferroni-label)', () => {
  // Opus 6/26, Haiku 0/26: b = 6, c = 0, p = 2 × 0.5⁶ = 0.03125 — below 0.05, not below 0.025.
  const one = computeGate(inputOf(round, ladder(first(round, 6), first(round, 3), first(round, 0))));
  assert.ok(Math.abs(one.discordant.p - 0.03125) < 1e-12); assert.equal(one.verdict, 'passes');
  const second = roundOf(3, planOf({ round: 2, seeds: [21, 22, 23, 24, 25, 26, 27] }), { alpha: 0.025, previous: { declaration: fileHash(round.declaration), low: round.seeds[0]!, high: round.seeds.at(-1)! } }, {}, { probe: hash('a'), held: hash('b') });
  const reports = [heldReport(second, OPUS, first(second, 6)), heldReport(second, SONNET, first(second, 3)), heldReport(second, HAIKU, first(second, 0))];
  const input = { ...inputOf(second, reports), previousSeeds: round.seeds };
  const two = computeGate(input);
  assert.equal(two.alpha, 0.025); assert.equal(two.criteria.find(c => c.name === 'mcnemar')!.met, false); assert.equal(two.verdict, 'does not pass');
  const markdown = renderGate(two);
  assert.match(markdown, /α = 0\.025 \(second round: with the first at 0\.05, the false-pass bound over both rounds is 0\.075\)/);
  assert.equal(markdown.includes('Bonferroni'), false);
  refused(() => computeGate({ ...input, previousSeeds: second.seeds }), 'heldout_overlap');
  refused(() => computeGate({ ...input, previousSeeds: [] }), 'previous_round');
});

test('every model run is bound to its two pushed ledger records (PADR-0044 decision 8)', () => {
  const reports = passing(), input = inputOf(round, reports);
  // A run without a start entry: a run made outside the guard.
  refused(() => computeGate({ ...input, ledger: { ...input.ledger, ledger: roundLedger(round, reports.slice(0, 2)) } }), 'run_outside_ledger', /has no start entry in the pushed release ledger/);
  // A model-run folder in the bench roots without a start entry.
  refused(() => computeGate({ ...input, outside: [{ bench: '20261102T100000Z-ffff', run: `${round.tasks[0]}-s1-r1` }] }), 'run_outside_ledger', /1 model run folder of this round's tasks holds no start entry/);
  // The ladder's runs recorded under another purpose are not the round's held-out runs.
  const developed = ledgerOf([...round.groups, { reports, purpose: 'development', basis: null, unit: null, round: null }]);
  refused(() => computeGate({ ...input, ledger: { ...input.ledger, ledger: developed } }), 'ledger_mismatch');
  // A report that binds another judged session, stdout or failure than its run-end record.
  const edited = structuredClone(reports); (edited[0]!.report.runs[0]!.artifacts as { session: string }).session = hash('7');
  refused(() => computeGate({ ...input, ladder: edited }), 'ledger_hash_mismatch', /the report binds other hashes/);
  const restdout = structuredClone(reports); restdout[0]!.report.runs[1]!.stdout = { sha256: hash('8'), bytes: 1 };
  refused(() => computeGate({ ...input, ladder: restdout }), 'ledger_hash_mismatch');
  // Another toolchain in the records.
  const tooled = ledgerOf([...round.groups, { reports, purpose: 'held-out', basis: fileHash(round.declaration), toolchain: 'excalidraw-mcp-0.3.2' }]);
  refused(() => computeGate({ ...input, ledger: { ...input.ledger, ledger: tooled } }), 'toolchain_mismatch');
  // The admission and the declaration must be registered in the ledger.
  refused(() => computeGate({ ...input, ledger: { ...input.ledger, ledger: ledgerOf([...round.groups.slice(0, -1), { reports, purpose: 'held-out', basis: fileHash(round.declaration) }]) } }), 'declaration_unrecorded');
  const unadmitted = validateDeclaration(declarationOf(round.plan, round.record, {}, {}, ledgerOf(round.groups.slice(0, 1))));
  const withoutAdmission = ledgerOf([round.groups[0]!, { round: declaredOf({ ...round, declaration: unadmitted }, HELD_WORLD) }, { reports, purpose: 'held-out', basis: fileHash(unadmitted) }]);
  refused(() => computeGate({ ...input, declaration: unadmitted, ledger: { ...input.ledger, ledger: withoutAdmission } }), 'probe_unrecorded');
  // The pre-probe record and the pre-probe world are the plan's.
  refused(() => computeGate({ ...input, probeWorld: hash('a') }), 'round_files_mismatch');
});

test('a re-declaration after held-out runs started is refused, and every run on a held-out instance counts for the round (review: gate-heldout-reroll-by-redeclaration)', () => {
  // Ladder 1 under the declaration as declared: Haiku 10 — the round would not pass.
  const ladder1 = ladder(first(round, 15), first(round, 10), first(round, 10));
  assert.equal(computeGate(inputOf(round, ladder1)).verdict, 'does not pass');
  // The round was declared before under another hash (same held-out seeds and world) and ladder 1 ran
  // under it; the gated declaration came later and ladder 2 ran on the same instances.
  const again: RoundBody = { ...declaredOf(round, HELD_WORLD), declaration: hash('e') };
  const ladder2 = ladder(first(round, 15), first(round, 10), first(round, 4));
  const ledger = ledgerOf([...round.groups.slice(0, -1), { round: again }, { reports: ladder1, purpose: 'held-out', basis: hash('e') }, round.groups.at(-1)!, { reports: ladder2, purpose: 'held-out', basis: fileHash(round.declaration) }]);
  refused(() => computeGate({ ...inputOf(round, ladder2), ledger: { ledger, versions: [] } }), 'round_redeclared', /has a held-out run under another declaration/);
  // declare refuses before it: a registered declaration whose held-out world has runs, under any purpose.
  assert.doesNotThrow(() => refuseRedeclaration(ledgerOf(round.groups), UNIT, 1));
  refused(() => refuseRedeclaration(roundLedger(round, ladder1.slice(0, 1)), UNIT, 1), 'round_redeclared', /was declared before and its held-out runs started/);
  refused(() => refuseRedeclaration(ledgerOf([...round.groups, { reports: ladder1.slice(0, 1), purpose: 'development', basis: null, unit: null, round: null }]), UNIT, 1), 'round_redeclared');
  // And a pre-probe record is made once.
  assert.doesNotThrow(() => refuseRecordedProbe(ledgerOf(round.groups.slice(0, 1)), round.plan));
  refused(() => refuseRecordedProbe(ledgerOf(round.groups), round.plan), 'probe_recorded');
});

test('runs on a held-out instance under any purpose are in the repeat check and count for the round (Codex counterexample; review: budget-outside-scan-any-purpose)', () => {
  const reports = passing();
  // 26 completed runs of the held-out tasks recorded as development runs before the ladder: best-of-N.
  const extra = heldReport(round, HAIKU, first(round, 26));
  const before = ledgerOf([...round.groups, { reports: [extra], purpose: 'development', basis: null, unit: null, round: null }, { reports, purpose: 'held-out', basis: fileHash(round.declaration) }]);
  refused(() => computeGate({ ...inputOf(round, reports), ledger: { ledger: before, versions: [] } }), 'best_of_n', /after its judged run .* purpose development/);
  // After the ladder: the latest judged run of an instance is not the round's.
  const after = ledgerOf([...round.groups, { reports, purpose: 'held-out', basis: fileHash(round.declaration) }, { reports: [extra], purpose: 'development', basis: null, unit: null, round: null }]);
  refused(() => computeGate({ ...inputOf(round, reports), ledger: { ledger: after, versions: [] } }), 'best_of_n', /was run again for claude-haiku-5-5 after its judged run .* purpose held-out/);
  // And a development run as the only judged run of an instance is not the round's run either.
  const alone = ledgerOf([...round.groups, { reports: reports.slice(0, 2), purpose: 'held-out', basis: fileHash(round.declaration) }, { reports: [heldReport(round, HAIKU, first(round, 4))], purpose: 'development', basis: null, unit: null, round: null }]);
  refused(() => computeGate({ ...inputOf(round, reports.slice(0, 2)), ledger: { ledger: alone, versions: [] } }), 'best_of_n', /is a development run on this round's instance/);
  // Unjudged ones (infra errors) are counted for the round and named, not refused: 85 + 26.
  const failed = heldReport(round, HAIKU, first(round, 0), { run: task => presetRun(task, null, HAIKU, { failure: { reason: 'api_error', parser: 'claude-code-stream/1', code: '529', beforeModelWork: true } }) });
  const counted = computeGate({ ...inputOf(round, reports), ledger: { ledger: ledgerOf([...round.groups, { reports: [failed], purpose: 'example', basis: null, unit: null, round: null }, { reports, purpose: 'held-out', basis: fileHash(round.declaration) }]), versions: [] } });
  assert.deepEqual(counted.spend, { preProbe: 7, heldOut: 104, total: 111, exempt: 0, planned: 85, other: 26 });
  assert.deepEqual([counted.verdict, counted.voidReason], ['void', 'budget']);
  assert.match(renderGate(counted), /111 model runs counted \(104 held-out \+ 7 pre-probe; 26 of them under another plan, declaration or purpose\)/);
});

test('a judged run whose run-end record is lost is void: never scored, never benched again; an unjudged one may be (review: gate-run-end-lock-window)', () => {
  const reports = passing(), opus = reports[0]!;
  // Opus's passing runs on instances 12–14 without their run-end records: Opus 12/26, b = 8, c = 0.
  const skip = opus.report.runs.slice(12, 15).map(run => `${opus.bench}/${run.id}`);
  const three = computeGate(inputOf(round, reports, { skipEnd: skip }));
  assert.deepEqual([three.strongest.passed, three.strongest.unrecorded, three.discordant.strongestOnly, three.verdict], [12, 3, 8, 'passes']);
  // 4 of 78 ladder runs (5.1 %) void the round.
  const four = computeGate(inputOf(round, reports, { skipEnd: [...skip, `${opus.bench}/${opus.report.runs[11]!.id}`] }));
  assert.deepEqual([four.verdict, four.voidReason], ['void', 'infrastructure']);
  // Benched again after the verdict was on disk: refused, whether the report or only the folder shows it.
  const again = heldReport(round, OPUS, first(round, 15), { createdAt: '2026-11-02T11:00:00.000Z', run: (task, index) => index >= 12 && index < 15 ? presetRun(task, true, OPUS) : null });
  refused(() => computeGate(inputOf(round, [...reports, again], { skipEnd: skip })), 'best_of_n');
  const unlisted = { ...opus, report: { ...opus.report, runs: opus.report.runs.filter((_, index) => index < 12 || index > 14) } };
  const lostLedger = roundLedger(round, [opus, ...reports.slice(1), again], [], { skipEnd: skip });
  const base = inputOf(round, [unlisted, ...reports.slice(1), again]);
  refused(() => computeGate({ ...base, ledger: { ledger: lostLedger, versions: [] }, folders: new Map(skip.map(key => [key.replace('/', '\u0000'), 'judged'] as const)) }), 'best_of_n');
  // A folder that is gone counts as judged too; only a folder without a verdict lets the task run again.
  refused(() => computeGate({ ...base, ledger: { ledger: lostLedger, versions: [] }, folders: new Map(skip.map(key => [key.replace('/', '\u0000'), 'missing'] as const)) }), 'best_of_n');
  const resumed = computeGate({ ...base, ledger: { ledger: lostLedger, versions: [] }, folders: new Map(skip.map(key => [key.replace('/', '\u0000'), 'unjudged'] as const)) });
  assert.deepEqual([resumed.strongest.passed, resumed.strongest.unrecorded, resumed.strongest.reports], [15, 0, 2]);
  // But a judged and recorded run benched again is best-of-N.
  refused(() => computeGate(inputOf(round, [...reports, again])), 'best_of_n');
});

test('no best-of-N in the ledger, and the latest judged run of every agent and task is given to the gate', () => {
  const reports = passing();
  // A later judged run of the same task for Opus in a bench the gate is not given.
  const hidden = heldReport(round, OPUS, first(round, 15), { run: (task, index) => index === 0 ? presetRun(task, true, OPUS) : null });
  refused(() => computeGate({ ...inputOf(round, reports), ledger: { ledger: roundLedger(round, [...reports, hidden]), versions: [] } }), 'best_of_n', new RegExp(`task ${round.tasks[0]} was run again for ${OPUS}`));
  // An infra_error the gate is given, then a judged run of the same task in a bench it is not given.
  const stopped = heldReport(round, OPUS, first(round, 15), { run: (task, index) => index === 0 ? presetRun(task, null, OPUS) : presetRun(task, index < 15, OPUS) });
  const later = heldReport(round, OPUS, first(round, 15), { createdAt: '2026-11-02T11:00:00.000Z', run: (task, index) => index === 0 ? presetRun(task, true, OPUS) : null });
  const withLater = roundLedger(round, [stopped, later, ...reports.slice(1)]);
  refused(() => computeGate({ ...inputOf(round, [stopped, ...reports.slice(1)]), ledger: { ledger: withLater, versions: [] } }), 'run_not_given', new RegExp(`the latest run of ${round.tasks[0]} for ${OPUS} .* was judged but not given to the gate`));
  assert.equal(computeGate({ ...inputOf(round, [stopped, later, ...reports.slice(1)]), ledger: { ledger: withLater, versions: [] } }).strongest.passed, 15);
});

test('attestation only from re-derived evidence (bench/3 review): a run not re-derived is not attested, never the report\'s claim', () => {
  const reports = passing(), opus = reports[0]!;
  const passingRuns = opus.report.runs.filter(run => run.pass).slice(0, 2).map(run => run.id);
  const unread = { ...opus, rederived: new Set([...opus.rederived].filter(id => !passingRuns.includes(id))) };
  const result = computeGate(inputOf(round, [unread, reports[1]!, reports[2]!]));
  assert.deepEqual([result.strongest.passed, result.strongest.unattested], [13, 2]);
  const run = opus.report.runs[0]!;
  assert.equal(attests(opus, run, OPUS), true);
  assert.equal(attests({ rederived: new Set() }, run, OPUS), false);
  assert.equal(attests(opus, { ...run, client: { ...run.client!, parser: 'claude-code-stream/2' } }, OPUS), false);
  assert.equal(attests(opus, { ...run, client: { ...run.client!, source: 'command-output' } }, OPUS), false);
  assert.equal(attests(opus, run, SONNET), false);
  const plan = round.plan, probe = probeReport(3);
  const notRead = { ...probe, rederived: new Set([...probe.rederived].slice(1)) };
  refused(() => probeRecordOf(plan, [notRead], ledgerOf([{ reports: [notRead], purpose: 'pre-probe', basis: fileHash(plan) }])), 'probe_unattested');
  const other = heldReport(round, SONNET, first(round, 10), { run: (task, index) => presetRun(task, index < 10, SONNET, { clientModel: index === 0 ? HAIKU : SONNET }) });
  refused(() => computeGate(inputOf(round, [reports[0]!, other, reports[2]!])), 'run_on_other_model');
});

test('exemption only from structure (bench/3 review): a usage limit or login error before model work, re-derived from the run\'s own stdout', () => {
  const run = presetRun(round.tasks[0]!, null, OPUS), source = gateReport(report(OPUS, [run], HELD_WORLD, GENERATOR));
  assert.equal(exemptRun(run, source), true);
  const not = (value: SessionRunV3, from: Pick<GateReport, 'rederived' | 'failures'> = source, why = ''): void => assert.equal(exemptRun(value, from), false, why);
  not(run, { ...source, rederived: new Set() }, 'not re-derived');
  not(run, { ...source, failures: new Map([[run.id, null]]) }, 'the stdout gives no failure');
  not(run, { ...source, failures: new Map([[run.id, { reason: 'usage_limit', parser: 'claude-code-stream/1', code: 'rejected', beforeModelWork: false }]]) }, 'the stdout shows model work');
  not({ ...run, failure: { reason: 'runner', parser: null, code: null, beforeModelWork: null }, note: 'the client reported a usage or rate limit (copied words)' }, source, 'a runner reason with the note\'s words');
  not({ ...run, failure: { ...run.failure!, reason: 'api_error' } }, source, 'an API error is never exempt');
  not({ ...run, failure: { ...run.failure!, parser: 'x/1' } }, source, 'a parser this Practonaut does not ship');
  not({ ...run, toolCalls: { ...run.toolCalls, act: 1, total: 1 } }, source, 'a host call');
  not({ ...run, client: { ...run.client!, tokens: { input: 1, output: 0, cacheRead: 0, cacheCreation: 0 } } }, source, 'tokens');
  const stopped = heldReport(round, OPUS, first(round, 15), { run: (task, index) => index < 10 ? presetRun(task, true, OPUS) : index === 10 ? presetRun(task, null, OPUS) : null });
  const resumed = heldReport(round, OPUS, first(round, 15), { createdAt: '2026-11-02T11:00:00.000Z', run: (task, index) => index >= 10 ? presetRun(task, index < 15, OPUS) : null });
  const result = computeGate(inputOf(round, [stopped, resumed, ...passing().slice(1)]));
  assert.deepEqual([result.strongest.passed, result.strongest.reports, result.spend], [15, 2, { ...zero, exempt: 1 }]);
  const apiError = heldReport(round, OPUS, first(round, 15), { run: (task, index) => index < 10 ? presetRun(task, true, OPUS) : index === 10 ? presetRun(task, null, OPUS, { failure: { reason: 'api_error', parser: 'claude-code-stream/1', code: '529', beforeModelWork: true } }) : null });
  assert.equal(computeGate(inputOf(round, [apiError, resumed, ...passing().slice(1)])).spend.total, 86);
  const unread = gateReport(stopped.report, stopped.bench, { failures: { [stopped.report.runs[10]!.id]: null } });
  assert.equal(computeGate(inputOf(round, [unread, resumed, ...passing().slice(1)])).spend.total, 86);
});

test('the void rule counts infrastructure errors, missing and unattested runs over the pair and the declared ladder; more than 100 runs in a round is void for budget', () => {
  const infra = (count: number) => heldReport(round, SONNET, first(round, 10), { run: (task, index) => presetRun(task, index < count ? null : index < 10, SONNET, { failure: { reason: 'api_error', parser: 'claude-code-stream/1', code: '529', beforeModelWork: true } }) });
  const [opus, , haiku] = passing();
  const three = computeGate(inputOf(round, [opus!, infra(3), haiku!]));
  assert.deepEqual([three.verdict, three.infraShare], ['passes', 3 / 78]);
  assert.deepEqual([computeGate(inputOf(round, [opus!, infra(4), haiku!])).verdict, computeGate(inputOf(round, [opus!, infra(4), haiku!])).voidReason], ['void', 'infrastructure']);
  const missing = heldReport(round, HAIKU, first(round, 4), { run: (task, index) => index < 4 ? null : presetRun(task, false, HAIKU) });
  assert.equal(computeGate(inputOf(round, [opus!, passing()[1]!, missing])).weakest.missing, 4);
  assert.equal(computeGate(inputOf(round, [opus!, passing()[1]!, missing])).verdict, 'void');
  const sonnet = passing()[1]!, hidden = sonnet.report.runs.slice(20, 24).map(run => run.id);
  const four = computeGate(inputOf(round, [opus!, { ...sonnet, rederived: new Set([...sonnet.rederived].filter(id => !hidden.includes(id))) }, haiku!]));
  assert.deepEqual([four.agents[3]!.unattested, four.verdict, four.voidReason], [4, 'void', 'infrastructure']);
  const failed = heldReport(round, SONNET, first(round, 10), { run: (task, index) => index < 16 ? presetRun(task, null, SONNET, { failure: { reason: 'api_error', parser: 'claude-code-stream/1', code: '529', beforeModelWork: true } }) : null });
  const rerun = heldReport(round, SONNET, first(round, 10), { createdAt: '2026-11-02T11:00:00.000Z' });
  const result = computeGate(inputOf(round, [opus!, failed, rerun, haiku!]));
  assert.deepEqual([result.spend.total, result.verdict, result.voidReason], [101, 'void', 'budget']);
});

test('ladder agents: the declared preset and model, the billing class, the tools restricted, one prompt, one key source and one release line per client, the pinned Practonaut', () => {
  const [opus, sonnet, haiku] = passing();
  const swap = (value: GateReport): ReturnType<typeof inputOf> => inputOf(round, [opus!, value, haiku!]);
  const changed = (change: (value: GateReport['report']) => void): GateReport => { const copy = structuredClone(sonnet!.report); change(copy); return gateReport(copy, sonnet!.bench); };
  refused(() => computeGate(swap(changed(value => { value.agent.name = 'codex'; }))), 'ladder_preset_refused');
  refused(() => computeGate(swap(changed(value => { value.agent.requestedModel = { value: 'claude-sonnet-4-5', source: 'preset-requested' }; }))), 'ladder_model_mismatch');
  refused(() => computeGate(swap(changed(value => { value.agent.billing = { class: 'api-key', source: 'preset-requested' }; }))), 'billing_mismatch');
  refused(() => computeGate(swap(heldReport(round, SONNET, first(round, 10), { run: (task, index) => presetRun(task, index < 10, SONNET, { tools: ['mcp__practonaut__act', 'Bash'] }) }))), 'ladder_not_restricted');
  refused(() => computeGate(swap(changed(value => { value.settings.prompt = 'another prompt'; }))), 'prompt_differs');
  refused(() => computeGate(swap(changed(value => { value.agent.apiKeySource = 'ANTHROPIC_API_KEY'; }))), 'api_key_source_differs');
  refused(() => computeGate(swap(heldReport(round, SONNET, first(round, 10), { run: (task, index) => presetRun(task, index < 10, SONNET, { version: '2.2.0' }) }))), 'client_version_line');
  const patched = computeGate(swap(heldReport(round, SONNET, first(round, 10), { run: (task, index) => presetRun(task, index < 10, SONNET, { version: '2.1.3' }) })));
  assert.deepEqual(patched.clientVersions.map(entry => entry.version), ['2.1.0', '2.1.3']);
  refused(() => computeGate(swap(changed(value => { value.environment.practonaut = '0.3.0'; }))), 'practonaut_version');
  refused(() => computeGate(swap(changed(value => { value.settings.maxActions = 40; }))), 'settings_mismatch');
  refused(() => computeGate(swap(changed(value => { value.environment.world.contentHash = hash('3'); }))), 'set_mismatch');
});

test('the gate holds to its files: the plan and record the declaration follows from, the digested pre-probe runs, the baselines, the preflight', () => {
  const input = inputOf(round, passing());
  refused(() => computeGate({ ...input, plan: planOf({ seeds: [1, 2, 3, 4, 5, 6, 8] }) }), 'round_files_mismatch');
  refused(() => computeGate({ ...input, probe: { ...input.probe, passed: 2 } }), 'round_files_mismatch');
  const rerun = probeReport(3, { runs: (task, pass) => presetRun(task, task === 'repair-7' ? true : pass, OPUS) });
  refused(() => computeGate({ ...input, development: [rerun], ledger: { ...input.ledger, ledger: ledgerOf([{ reports: [rerun], purpose: 'pre-probe', basis: fileHash(round.plan) }, ...round.groups.slice(1), { reports: input.ladder as GateReport[], purpose: 'held-out', basis: fileHash(round.declaration) }]) } }), 'ledger_rewritten', /the pre-probe record counted \(15 records\)/);
  refused(() => computeGate({ ...input, declaration: { ...input.declaration, budget: { ...input.declaration.budget, ledger: { records: 15, head: hash('7') } } } }), 'ledger_rewritten', /the declaration counted/);
  const probe = round.probe[0]!, other = new Map(probe.sessions!); other.set(probe.report.runs[0]!.id, { hash: 'state-other', log: [] });
  refused(() => computeGate({ ...input, development: [{ ...probe, sessions: other }] }), 'development_mismatch', /are not the ones the declaration digests/);
  const sonnetProbe = probeReport(3, { requested: SONNET });
  refused(() => probeRecordOf(round.plan, [sonnetProbe], ledgerOf([{ reports: [sonnetProbe], purpose: 'pre-probe', basis: fileHash(round.plan) }])), 'ladder_model_mismatch');
  refused(() => computeGate({ ...input, oracle: [heldReport(round, 'oracle', round.tasks.map(() => true), { run: (task, index) => index === 0 ? null : builtinRun(task, true) })] }), 'baseline_incomplete');
  refused(() => preflightGate({ ...input, oracle: [heldReport(round, 'oracle', round.tasks.map((_, index) => index > 0))] }), 'preflight_refused', /the oracle passes 25 of 26/);
  refused(() => preflightGate({ ...input, nearMisses: { ...input.nearMisses, passed: 1 } }), 'preflight_refused', /1 near misses pass the checker/);
  assert.equal(preflightGate(input).ladderRunsSpent, 78);
});

test('mergeAgentRuns: the latest report counts after an infra_error; a judged run benched again is refused', () => {
  const at = (runs: Array<{ id: string; taskId: string; status: string }>, createdAt: string, bench: string) => ({ report: { createdAt, runs }, bench });
  const merged = mergeAgentRuns([at([{ id: 'a-s1-r1', taskId: 'a', status: 'infra_error' }], '2026-11-02T10:00:00Z', 'b1'), at([{ id: 'a-s1-r1', taskId: 'a', status: 'completed' }], '2026-11-02T11:00:00Z', 'b2')], 'x');
  assert.equal(merged.get('a')!.bench, 'b2');
  refused(() => mergeAgentRuns([at([{ id: 'a-s1-r1', taskId: 'a', status: 'completed' }], '2026-11-02T10:00:00Z', 'b1'), at([{ id: 'a-s1-r1', taskId: 'a', status: 'completed' }], '2026-11-02T11:00:00Z', 'b2')], 'x'), 'best_of_n');
});

test('the 0.2.0 rounds stay readable: every committed /1 declaration and ledger validates by its own rules', () => {
  const folder = fileURLToPath(new URL('../../docs/benchmarks/challenge/', import.meta.url));
  const names = readdirSync(folder);
  const declarations = names.filter(name => name.endsWith('.declaration.json')), ledgers = names.filter(name => name.endsWith('.ledger.json'));
  assert.equal(declarations.length, 5); assert.equal(ledgers.length, 5);
  for (const name of declarations) {
    const value = validateDeclarationV1(JSON.parse(readFileSync(join(folder, name), 'utf8')));
    assert.equal(heldOutSeedsV1(value).length, 26);
  }
  assert.deepEqual(ledgers.map(name => validateLedgerV1(JSON.parse(readFileSync(join(folder, name), 'utf8'))).spent.total), [87, 87, 87, 87, 87]);
  refused(() => validateDeclaration(JSON.parse(readFileSync(join(folder, declarations[0]!), 'utf8'))), 'declaration_invalid');
});
void parseLedger; void admissionOf;
