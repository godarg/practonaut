// The 0.3.0 gate (PADR-0042 as amended on acceptance): units, the probe plan, the pre-probe, the
// declaration /2 and the gate with its ledger bindings. Reports, ledgers and outcomes are hand-built
// (tests/support/challenge-round.ts); every expected number is counted by hand from the outcome tables
// below, and every refusal is named by its code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateBenchReportV3, type SessionRunV3 } from '../../src/bench/report.ts';
import { checkRetune, developmentDigest, fileHash, funded, heldOutSeeds, reservedRuns, validateDeclaration, validatePlan, RoundError, type Declaration } from '../../src/challenge/declaration.ts';
import { attests, computeGate, exemptRun, mergeAgentRuns, preflightGate, renderGate, GateInputError, type GateReport } from '../../src/challenge/gate.ts';
import { checkUnit, PREREGISTERED_UNITS, UnitError } from '../../src/challenge/units.ts';
import { heldOutSeedsV1, validateDeclarationV1, validateLedgerV1 } from '../../src/challenge/round-020.ts';
import { parseLedger } from '../../src/challenge/ledger.ts';
import { HAIKU, OPUS, SONNET, builtinRun, declarationOf, first, gateReport, hash, heldReport, inputOf, ledgerOf, planOf, presetRun, probeRecordOf, probeReport, report, roundOf, GENERATOR, HELD_WORLD, type Round } from '../support/challenge-round.ts';

const round = roundOf(3);
const ladder = (strong: boolean[], middle: boolean[], weak: boolean[], options: { opus?: Parameters<typeof heldReport>[3]; sonnet?: Parameters<typeof heldReport>[3]; haiku?: Parameters<typeof heldReport>[3] } = {}): GateReport[] =>
  [heldReport(round, OPUS, strong, options.opus), heldReport(round, SONNET, middle, options.sonnet), heldReport(round, HAIKU, weak, options.haiku)];
const passing = (): GateReport[] => ladder(first(round, 15), first(round, 10), first(round, 4));
const refused = (work: () => unknown, code: string, message?: RegExp): void => assert.throws(work, (error: unknown) => (error instanceof GateInputError || error instanceof RoundError || error instanceof UnitError) && error.code === code && (!message || message.test(error.message)), `${code}${message ? ` ${message.source}` : ''}`);
const declared = (extra: Partial<Declaration> = {}, budget: Partial<Declaration['budget']> = {}): unknown => declarationOf(round.plan, round.record, extra, budget);

test('the hand-built round is valid bench/3 at session level, and its files validate', () => {
  for (const source of [...round.probe, ...passing(), heldReport(round, 'oracle', round.tasks.map(() => true)), heldReport(round, 'random', round.tasks.map(() => false))]) assert.doesNotThrow(() => validateBenchReportV3(source.report), source.report.agent.name);
  assert.doesNotThrow(() => validateDeclaration(round.declaration));
  assert.equal(round.record.passed, 3); assert.equal(round.record.admitted, true);
  assert.equal(round.seeds.length, 26);
});

test('units: preregistered, approved by name, refused on a foreign toolchain when they rely on Practonaut\'s host, and named when no generator or toolchain exists', () => {
  assert.ok(PREREGISTERED_UNITS.length <= 10);
  assert.deepEqual(PREREGISTERED_UNITS.filter(unit => unit.endsWith('.practonaut')), ['layout.practonaut', 'human-edit.practonaut']);
  refused(() => checkUnit('repair.practonaut', false), 'unit_not_preregistered', /--maintainer-approved-unit repair\.practonaut/);
  assert.equal(checkUnit('repair.practonaut', true).level, 'session');
  for (const family of ['limited-checks', 'tight-budget', 'human-edit']) refused(() => checkUnit(`${family}.excalidraw-mcp-0.3.2`, true), 'unit_family_toolchain');
  refused(() => checkUnit('repair.excalidraw-mcp-0.3.2', false), 'toolchain_unavailable');
  refused(() => checkUnit('repair.some-server-1.0.0', true), 'toolchain_unknown');
  refused(() => checkUnit('layout.practonaut', false), 'family_unavailable', /no generator in this Practonaut yet/);
  refused(() => checkUnit('repair', true), 'unit_invalid');
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
  refused(() => planOf({ maintainerApprovedUnit: false }), 'unit_not_preregistered');
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

test('admitted, funded or deferred: a round is funded while it fits and still leaves 40 runs (PADR-0042 decision 8)', () => {
  // 800 − 78 held-out − 198 reserved for two foreign rounds − 40 = 484 runs before the round.
  assert.equal(reservedRuns('practonaut', 0, 0), 198); assert.equal(reservedRuns('practonaut', 2, 0), 2 * 78 + 198); assert.equal(reservedRuns('practonaut', 0, 2), 0);
  assert.equal(reservedRuns('excalidraw-mcp-0.3.2', 1, 0), 78);
  assert.doesNotThrow(() => validateDeclaration(declared({}, { before: 484 })));
  refused(() => validateDeclaration(declared({}, { before: 485 })), 'unit_not_funded', /admitted, not gated for budget/);
  assert.equal(funded({ before: 682, reserved: 0, leave: 40, cap: 800 }, 78), true);
  assert.equal(funded({ before: 683, reserved: 0, leave: 40, cap: 800 }, 78), false);
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
  // The seeds: 26 from 1 000 000 + the first 12 hex digits of SHA-256 over the canonical JSON, mod 9e8.
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
  // 7 pre-probe and 3 × 26 held-out runs counted; the release ledger counts the same 85.
  assert.deepEqual(result.spend, { preProbe: 7, heldOut: 78, total: 85, exempt: 0, planned: 85 });
  assert.deepEqual([result.ledger.counted, result.ledger.cap, result.builtin], [85, 800, { oracle: 26, random: 26 }]);
  assert.equal(result.alpha, 0.05);
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

test('a second round decides at α = 0.025 on new instances', () => {
  // Opus 6/26, Haiku 0/26: b = 6, c = 0, p = 2 × 0.5⁶ = 0.03125 — below 0.05, not below 0.025.
  const one = computeGate(inputOf(round, ladder(first(round, 6), first(round, 3), first(round, 0))));
  assert.ok(Math.abs(one.discordant.p - 0.03125) < 1e-12); assert.equal(one.verdict, 'passes');
  const plan = planOf({ round: 2 }), probe = [probeReport(3)], record = probeRecordOf(plan, probe, ledgerOf([{ reports: probe, purpose: 'pre-probe', basis: fileHash(plan), round: 2 }]));
  const declaration = validateDeclaration({ ...declarationOf(plan, record), round: 2, alpha: 0.025, previous: { declaration: fileHash(round.declaration), low: round.seeds[0]!, high: round.seeds.at(-1)! } });
  const seeds = heldOutSeeds(declaration), second: Round = { plan, probe, record, declaration, seeds, tasks: seeds.map(seed => `repair-${seed}`) };
  const reports = [heldReport(second, OPUS, first(second, 6)), heldReport(second, SONNET, first(second, 3)), heldReport(second, HAIKU, first(second, 0))];
  const input = { ...inputOf(second, reports), ledger: { ledger: ledgerOf([{ reports: probe, purpose: 'pre-probe', basis: fileHash(plan), round: 2 }, { reports, purpose: 'held-out', basis: fileHash(declaration), round: 2 }]), versions: [] }, previousSeeds: round.seeds };
  const two = computeGate(input);
  assert.equal(two.alpha, 0.025); assert.equal(two.criteria.find(c => c.name === 'mcnemar')!.met, false); assert.equal(two.verdict, 'does not pass');
  refused(() => computeGate({ ...input, previousSeeds: seeds }), 'heldout_overlap');
  refused(() => computeGate({ ...input, previousSeeds: [] }), 'previous_round');
});

test('every model run is bound to its two pushed ledger records (PADR-0044 decision 8)', () => {
  const reports = passing(), input = inputOf(round, reports);
  // A run without a start entry: a run made outside the guard.
  const missing = ledgerOf([{ reports: round.probe, purpose: 'pre-probe', basis: fileHash(round.plan) }, { reports: reports.slice(0, 2), purpose: 'held-out', basis: fileHash(round.declaration) }]);
  refused(() => computeGate({ ...input, ledger: { ...input.ledger, ledger: missing } }), 'run_outside_ledger', /has no start entry in the pushed release ledger/);
  // A model-run folder in the bench roots without a start entry.
  refused(() => computeGate({ ...input, outside: [{ bench: '20261102T100000Z-ffff', run: `${round.tasks[0]}-s1-r1` }] }), 'run_outside_ledger', /1 model run folder of this round's tasks holds no start entry/);
  // Start entries of another declaration (or purpose) are not this round's.
  const other = ledgerOf([{ reports: round.probe, purpose: 'pre-probe', basis: fileHash(round.plan) }, { reports, purpose: 'held-out', basis: hash('5') }]);
  refused(() => computeGate({ ...input, ledger: { ...input.ledger, ledger: other } }), 'ledger_mismatch');
  // A report that binds another judged session, stdout or failure than its run-end record.
  const edited = structuredClone(reports); (edited[0]!.report.runs[0]!.artifacts as { session: string }).session = hash('7');
  refused(() => computeGate({ ...input, ladder: edited }), 'ledger_hash_mismatch', /the report binds other hashes/);
  const restdout = structuredClone(reports); restdout[0]!.report.runs[1]!.stdout = { sha256: hash('8'), bytes: 1 };
  refused(() => computeGate({ ...input, ladder: restdout }), 'ledger_hash_mismatch');
  // Another toolchain in the records.
  const tooled = ledgerOf([{ reports: round.probe, purpose: 'pre-probe', basis: fileHash(round.plan) }, { reports, purpose: 'held-out', basis: fileHash(round.declaration), toolchain: 'excalidraw-mcp-0.3.2' }]);
  refused(() => computeGate({ ...input, ledger: { ...input.ledger, ledger: tooled } }), 'toolchain_mismatch');
  // The ledger as parsed: a record whose chain is broken is refused before anything is read.
  const lines = input.ledger.ledger.text.split('\n');
  lines[2] = lines[2]!.replace('"status":"completed"', '"status":"timeout"');
  assert.throws(() => parseLedger(lines.join('\n')), (error: unknown) => (error as { code?: string }).code === 'ledger_invalid');
});

test('a run without its run-end record counts, is never scored, and its task may be benched again; more than 5 % of them voids the round', () => {
  const reports = passing(), opus = reports[0]!;
  // Opus's passing runs on instances 12–14 without their run-end records: Opus 12/26, b = 8, c = 0.
  const skip = opus.report.runs.slice(12, 15).map(run => `${opus.bench}/${run.id}`);
  const three = computeGate(inputOf(round, reports, { skipEnd: skip }));
  assert.deepEqual([three.strongest.passed, three.strongest.unrecorded, three.discordant.strongestOnly, three.verdict], [12, 3, 8, 'passes']);
  // 4 of 78 ladder runs (5.1 %) void the round.
  const four = computeGate(inputOf(round, reports, { skipEnd: [...skip, `${opus.bench}/${opus.report.runs[11]!.id}`] }));
  assert.deepEqual([four.verdict, four.voidReason], ['void', 'infrastructure']);
  // Benched again: the later run counts.
  const again = heldReport(round, OPUS, first(round, 15), { createdAt: '2026-11-02T11:00:00.000Z', run: (task, index) => index >= 12 && index < 15 ? presetRun(task, true, OPUS) : null });
  const resumed = computeGate(inputOf(round, [...reports, again], { skipEnd: skip }));
  assert.deepEqual([resumed.strongest.passed, resumed.strongest.unrecorded, resumed.strongest.reports], [15, 0, 2]);
  // But a judged and recorded run benched again is best-of-N.
  refused(() => computeGate(inputOf(round, [...reports, again])), 'best_of_n');
});

test('no best-of-N in the ledger, and the latest judged run of every agent and task is given to the gate', () => {
  const reports = passing(), opus = reports[0]!;
  // A later judged run of the same task for Opus in a bench the gate is not given.
  const hidden = heldReport(round, OPUS, first(round, 15), { run: (task, index) => index === 0 ? presetRun(task, true, OPUS) : null });
  const ledger = ledgerOf([{ reports: round.probe, purpose: 'pre-probe', basis: fileHash(round.plan) }, { reports: [...reports, hidden], purpose: 'held-out', basis: fileHash(round.declaration) }]);
  refused(() => computeGate({ ...inputOf(round, reports), ledger: { ledger, versions: [] } }), 'best_of_n', new RegExp(`task ${round.tasks[0]} was run again for ${OPUS}`));
  // An infra_error the gate is given, then a judged run of the same task in a bench it is not given.
  const stopped = heldReport(round, OPUS, first(round, 15), { run: (task, index) => index === 0 ? presetRun(task, null, OPUS) : presetRun(task, index < 15, OPUS) });
  const later = heldReport(round, OPUS, first(round, 15), { createdAt: '2026-11-02T11:00:00.000Z', run: (task, index) => index === 0 ? presetRun(task, true, OPUS) : null });
  const withLater = ledgerOf([{ reports: round.probe, purpose: 'pre-probe', basis: fileHash(round.plan) }, { reports: [stopped, later, ...reports.slice(1)], purpose: 'held-out', basis: fileHash(round.declaration) }]);
  refused(() => computeGate({ ...inputOf(round, [stopped, ...reports.slice(1)]), ledger: { ledger: withLater, versions: [] } }), 'run_not_given', new RegExp(`the latest run of ${round.tasks[0]} for ${OPUS} .* was judged but not given to the gate`));
  // Given, it counts.
  assert.equal(computeGate({ ...inputOf(round, [stopped, later, ...reports.slice(1)]), ledger: { ledger: withLater, versions: [] } }).strongest.passed, 15);
  void opus;
});

test('attestation only from re-derived evidence (bench/3 review): a run not re-derived is not attested, never the report\'s claim', () => {
  const reports = passing(), opus = reports[0]!;
  const passingRuns = opus.report.runs.filter(run => run.pass).slice(0, 2).map(run => run.id);
  const unread = { ...opus, rederived: new Set([...opus.rederived].filter(id => !passingRuns.includes(id))) };
  const result = computeGate(inputOf(round, [unread, reports[1]!, reports[2]!]));
  assert.deepEqual([result.strongest.passed, result.strongest.unattested], [13, 2]);
  // attests(): re-derived, client-attested, a shipped parser, the declared model.
  const run = opus.report.runs[0]!;
  assert.equal(attests(opus, run, OPUS), true);
  assert.equal(attests({ rederived: new Set() }, run, OPUS), false);
  assert.equal(attests(opus, { ...run, client: { ...run.client!, parser: 'claude-code-stream/2' } }, OPUS), false);
  assert.equal(attests(opus, { ...run, client: { ...run.client!, source: 'command-output' } }, OPUS), false);
  assert.equal(attests(opus, run, SONNET), false);
  // The pre-probe: a run that does not attest Opus is refused.
  const plan = round.plan, probe = probeReport(3);
  const notRead = { ...probe, rederived: new Set([...probe.rederived].slice(1)) };
  refused(() => probeRecordOf(plan, [notRead], ledgerOf([{ reports: [notRead], purpose: 'pre-probe', basis: fileHash(plan) }])), 'probe_unattested');
  // A run whose re-derived client names another model refuses the round.
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
  // In a round: Opus stopped by a usage limit after ten runs and resumed; the refused run is listed, not counted.
  const stopped = heldReport(round, OPUS, first(round, 15), { run: (task, index) => index < 10 ? presetRun(task, true, OPUS) : index === 10 ? presetRun(task, null, OPUS) : null });
  const resumed = heldReport(round, OPUS, first(round, 15), { createdAt: '2026-11-02T11:00:00.000Z', run: (task, index) => index >= 10 ? presetRun(task, index < 15, OPUS) : null });
  const reports = [stopped, resumed, ...passing().slice(1)];
  const result = computeGate(inputOf(round, reports));
  assert.deepEqual([result.strongest.passed, result.strongest.reports, result.spend], [15, 2, { preProbe: 7, heldOut: 78, total: 78 + 7, exempt: 1, planned: 85 }]);
  // The same run with an API error is counted: 86.
  const apiError = heldReport(round, OPUS, first(round, 15), { run: (task, index) => index < 10 ? presetRun(task, true, OPUS) : index === 10 ? presetRun(task, null, OPUS, { failure: { reason: 'api_error', parser: 'claude-code-stream/1', code: '529', beforeModelWork: true } }) : null });
  assert.equal(computeGate(inputOf(round, [apiError, resumed, ...passing().slice(1)])).spend.total, 86);
  // Not re-derived from its stdout: counted as well.
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
  // Unattested runs count the same: four of Sonnet's runs not re-derived void the round.
  const sonnet = passing()[1]!, hidden = sonnet.report.runs.slice(20, 24).map(run => run.id);
  const four = computeGate(inputOf(round, [opus!, { ...sonnet, rederived: new Set([...sonnet.rederived].filter(id => !hidden.includes(id))) }, haiku!]));
  assert.deepEqual([four.agents[3]!.unattested, four.verdict, four.voidReason], [4, 'void', 'infrastructure']);
  // Budget: 16 reruns after counted API errors make the round's held-out runs 94 + 7 = 101.
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
  // Another pre-probe run in its place: the ledger the record and the declaration counted is no longer
  // a prefix of the gated one.
  refused(() => computeGate({ ...input, development: [rerun], ledger: { ...input.ledger, ledger: ledgerOf([{ reports: [rerun], purpose: 'pre-probe', basis: fileHash(round.plan) }, { reports: input.ladder as GateReport[], purpose: 'held-out', basis: fileHash(round.declaration) }]) } }), 'ledger_rewritten', /the pre-probe record counted \(15 records\)/);
  refused(() => computeGate({ ...input, declaration: { ...input.declaration, budget: { ...input.declaration.budget, ledger: { records: 15, head: hash('7') } } } }), 'ledger_rewritten', /the declaration counted/);
  // The same outcomes from another board (another action log): only the digest tells.
  const probe = round.probe[0]!, other = new Map(probe.sessions!); other.set(probe.report.runs[0]!.id, { hash: 'state-other', log: [] });
  refused(() => computeGate({ ...input, development: [{ ...probe, sessions: other }] }), 'development_mismatch', /are not the ones the declaration digests/);
  // A pre-probe report that requested another model than the plan's.
  const sonnetProbe = probeReport(3, { requested: SONNET });
  refused(() => probeRecordOf(round.plan, [sonnetProbe], ledgerOf([{ reports: [sonnetProbe], purpose: 'pre-probe', basis: fileHash(round.plan) }])), 'ladder_model_mismatch');
  refused(() => computeGate({ ...input, oracle: [heldReport(round, 'oracle', round.tasks.map(() => true), { run: (task, index) => index === 0 ? null : builtinRun(task, true) })] }), 'baseline_incomplete');
  refused(() => preflightGate({ ...input, oracle: [heldReport(round, 'oracle', round.tasks.map((_, index) => index > 0))] }), 'preflight_refused', /the oracle passes 25 of 26/);
  refused(() => preflightGate({ ...input, nearMisses: { ...input.nearMisses, passed: 1 } }), 'preflight_refused', /1 near misses pass the checker/);
  assert.equal(preflightGate(input).ladderRunsSpent, 78);
});

test('mergeAgentRuns: the latest report counts after an infra_error; a judged and recorded run benched again is refused', () => {
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
  // Their spend, as committed: 87 each, 470 for the release with the 35 before the rounds.
  assert.deepEqual(ledgers.map(name => validateLedgerV1(JSON.parse(readFileSync(join(folder, name), 'utf8'))).spent.total), [87, 87, 87, 87, 87]);
  // None is a 0.3.0 file: the 0.3.0 tools read their own folder and ledger only.
  refused(() => validateDeclaration(JSON.parse(readFileSync(join(folder, declarations[0]!), 'utf8'))), 'declaration_invalid');
});
void validatePlan;
