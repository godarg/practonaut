// The hand-built bench/3 reports behind the registered report and compare states (report-states.ts
// renders them for the accessibility run and the design review; the unit tests read the same pages).
// Every value is written out here; only the summaries are derived, and the validator re-derives them.
import { validateBenchReportV3, type BenchReportV3 } from '../../src/bench/report.ts';
import type { VerificationDetail } from '../../src/bench/render.ts';
import { artifactReport, hash, sessionReport } from './bench-v3.ts';

export interface V3States {
  /** An artifact-judged report: a pass, a run judged on the start file, a run without a verdict. */
  artifact: BenchReportV3;
  /** The same task on two applications, paired by task identity: case 1 on one side only, unequal run counts. */
  excalidraw: BenchReportV3; drawio: BenchReportV3;
  /** A candidate whose identity-paired runs were all unjudged. */
  unjudgedCandidate: BenchReportV3;
  /** A preset report whose client values a newer Practonaut's parser read, and how --verify saw it. */
  claimed: BenchReportV3; claims: VerificationDetail;
  /** Three cases under each world's own task id, one run each: every identity paired at equal counts,
   * one outcome that differs each way between the two configurations. */
  configExcalidraw: BenchReportV3; configDrawio: BenchReportV3;
}

export function v3States(): V3States {
  const artifact = validateBenchReportV3(artifactReport({ flow: { 1: ['pass'], 2: ['absent'], 3: [null] } }));
  const identities = (cases: number[]) => ({ T: Object.fromEntries(cases.map((value, index) => [index + 1, hash(String(value))])) });
  const excalidraw = validateBenchReportV3(sessionReport({ T: { 1: [true], 2: [true], 3: [false], 4: [true], 5: [false] } }, { identities: identities([0, 1, 1, 2, 1]), worldId: 'excalidraw-library', contentHash: hash('a') }));
  const drawio = validateBenchReportV3(sessionReport({ T: { 1: [false], 2: [true], 3: [true], 4: [true], 5: [true] } }, { identities: identities([2, 0, 0, 2, 0]), worldId: 'drawio-library', contentHash: hash('b'), adapterId: 'drawio' }));
  const unjudgedCandidate = validateBenchReportV3(sessionReport({ T: { 1: [null], 2: [null] } }, { identities: { T: { 1: hash('0'), 2: hash('2') } }, worldId: 'drawio-library', contentHash: hash('b'), adapterId: 'drawio' }));
  const claimed = validateBenchReportV3(sessionReport({ T: { 1: [true], 2: [false] } }, { change: value => {
    value.agent = { ...value.agent, kind: 'preset', name: 'claude-code', command: ['claude'], isolation: 'tool-restricted-preset', modelSource: 'client-attested', model: 'claude-haiku-5-5', billing: { class: 'subscription', source: 'preset-requested' } };
    for (const run of value.runs as Array<Record<string, unknown>>) { run.isolation = { level: 'tool-restricted-preset', evidence: 'tools-within-servers' }; run.client = { source: 'client-attested', model: 'claude-haiku-5-5', turns: null, costUsd: null, tokens: null, parser: 'claude-code-stream/2', tools: { names: ['mcp__practonaut__act'], omitted: 0 } }; }
  } }));
  const claims: VerificationDetail = { level: 're-verified', notRederived: ['claude-code-stream/2'], preset: 'not-checked' };
  const cases = (taskId: string) => ({ [taskId]: { 1: hash('0'), 2: hash('1'), 3: hash('2') } });
  const configExcalidraw = validateBenchReportV3(sessionReport({ 'restyle-flow': { 1: [true], 2: [true], 3: [false] } }, { identities: cases('restyle-flow'), worldId: 'excalidraw-library', contentHash: hash('a') }));
  const configDrawio = validateBenchReportV3(sessionReport({ 'restyle-flow-drawio': { 1: [false], 2: [true], 3: [true] } }, { identities: cases('restyle-flow-drawio'), worldId: 'drawio-library', contentHash: hash('b'), adapterId: 'drawio' }));
  return { artifact, excalidraw, drawio, unjudgedCandidate, claimed, claims, configExcalidraw, configDrawio };
}
