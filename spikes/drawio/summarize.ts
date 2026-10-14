// Condenses the local result files (.local/spikes/drawio/results/) into results/summary.json, which is
// committed. It keeps numbers, counts and short reasons only: no local paths, no raw XML.
//   node spikes/drawio/summarize.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIN_FILE, RESULTS_DIR, SUMMARY_DIR, WEBAPP_DIR } from './paths.ts';
import { URL_PARAMETERS, DEFAULT_CONFIG } from './harness.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const read = (name: string): Json | null => { const file = join(RESULTS_DIR, `${name}.json`); return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Json : null; };
const mb = (bytes: number): number => Math.round(bytes / 1e4) / 100;
const median = (values: number[]): number => { const s = [...values].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };
function dirSize(dir: string): { files: number; bytes: number } {
  let files = 0, bytes = 0;
  for (const name of readdirSync(dir)) { const p = join(dir, name), s = statSync(p); if (s.isDirectory()) { const d = dirSize(p); files += d.files; bytes += d.bytes; } else { files++; bytes += s.size; } }
  return { files, bytes };
}

const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as Json;
const replays = [1, 2, 3].map(n => read(`replay-run${n}`)).filter((r): r is Json => r !== null);
const coverage = [1, 2, 3].map(n => read(`coverage-run${n}`)).filter((r): r is Json => r !== null);
const start = read('start'), negative = read('negative'), stability = read('stability'), probes = read('probes');
const firstNegative = existsSync(join(RESULTS_DIR, 'first-pass', 'negative.json')) ? JSON.parse(readFileSync(join(RESULTS_DIR, 'first-pass', 'negative.json'), 'utf8')) as Json : null;
const explore = Object.fromEntries(['merge', 'merge-sync', 'patch', 'params', 'render'].map(m => [m, read(`explore-${m}`)]).filter(([, v]) => v !== null).map(([k, v]) => {
  const { failures, ...head } = v as Json;
  return [k, { ...head, ...(Array.isArray(failures) ? { failureExamples: failures.slice(0, 5) } : {}) }];
}));

// Cross-run agreement of the projected read-back, step by step.
const key = (s: Json): string => `${s.task}/${s.caseId}/${s.sequence}`;
let compared = 0, disagreements = 0;
if (replays.length === 3) {
  const maps = replays.map(r => new Map((r.sequences as Json[]).map(s => [key(s), s])));
  for (const [k, s1] of maps[0]!) s1.steps.forEach((step: Json, i: number) => { compared++; const hashes = new Set([step.readHash, maps[1]!.get(k)?.steps[i]?.readHash, maps[2]!.get(k)?.steps[i]?.readHash]); if (hashes.size !== 1) disagreements++; });
}
const coverageAgree = (mode: string): boolean => new Set(coverage.map(r => (r.modes[mode].steps as Json[]).map(s => s.readHash).join())).size === 1;
const unpacked = existsSync(WEBAPP_DIR) ? dirSize(WEBAPP_DIR) : null;

const summary = {
  schema: 'practonaut.spike-drawio-summary/1',
  pin: { tag: pin.tag, asset: pin.asset, published: pin.published, bytes: pin.size, sha256: pin.sha256 },
  environment: replays[0]?.environment ?? start?.environment ?? null,
  protocol: { urlParameters: URL_PARAMETERS, configure: DEFAULT_CONFIG, writePath: 'load (complete predicted after-state)', readBack: 'export format=xml', scriptInAppFrame: false },
  a_sourcePatches: { servedFilesMatchReleaseInEveryRun: replays.every(r => r.served.allMatchRelease) && replays.length === 3, servedFiles: replays[0]?.served.files, servedPaths: replays[0]?.served.paths },
  b_externalRequests: {
    blockedPerReplayRun: replays.map(r => r.denied.length), blockedInCoverage: coverage.map(r => r.denied.length), blockedInNegative: negative?.cases.reduce((n: number, c: Json) => Math.max(n, c.denied.length), 0) ?? null, blockedInProbes: probes?.denied.length ?? null,
    blockedInColdStarts: start?.cold.map((c: Json) => c.denied), missingLocalFilesPerReplayRun: replays.map(r => r.missing.length),
    withoutStealthParameters: explore.params ? { params: explore.params.params, blocked: explore.params.denied, roundTripOk: explore.params.roundTripOk } : 'not measured',
  },
  c_actionsAndRoundTrips: {
    runs: replays.map(r => ({ run: r.run, ...r.totals, wallSeconds: Math.round(r.wallMs / 100) / 10 })),
    crossRunAgreement: { stepsCompared: compared, projectionDisagreements: disagreements },
    actionsUsedByLibrary: [...new Set(replays[0]?.sequences.flatMap((s: Json) => s.steps.map((st: Json) => st.action)).filter(Boolean))].sort(),
    coverage: coverage.map(r => ({ run: r.run, nativeGroupsOnly: { ok: r.modes.refuse.ok, roundTripsOk: r.modes.refuse.steps.filter((s: Json) => s.ok).length, roundTrips: r.modes.refuse.steps.length, inexpressible: r.modes.refuse.inexpressible.map((i: Json) => ({ step: i.index, action: i.action, reason: 'group members in different frames; a draw.io cell has one parent' })) }, withDataAttributeGroups: { ok: r.modes['data-attribute'].ok, roundTripsOk: r.modes['data-attribute'].steps.filter((s: Json) => s.ok).length, roundTrips: r.modes['data-attribute'].steps.length }, actionsCovered: r.modes.refuse.actionsCovered })),
    coverageRunsAgree: coverage.length === 3 && coverageAgree('refuse') && coverageAgree('data-attribute'),
  },
  d_silentChanges: negative ? {
    cases: negative.cases.map((c: Json) => ({ id: c.id, appChanged: c.appChanged, detectedByProjectionCheck: c.detectedByProjection, detectedWithWriteCheck: c.detected, loadEventEchoesInput: c.loadEventEchoesInput, how: [...(c.diff.length ? ['declared-set diff'] : []), ...(c.cellDiff.length ? ['write check'] : []), ...c.issues.map((i: Json) => `integrity:${i.code}`), ...c.unmodeled.map((i: Json) => `unmodeled:${i.code}`), ...(c.parseError ? ['parse error'] : [])], requestsToLocalOrigin: c.newMissingRequests, dialogs: c.dialogs.length })),
    silentWithWriteCheck: negative.silentCases, silentWithProjectionCheckOnly: negative.silentForProjectionCheck,
    firstPassSilent: firstNegative?.silentCases ?? null,
  } : null,
  e_startMemoryDownload: {
    start: start ? { definition: start.definition, coldMs: start.cold.map((c: Json) => Math.round(c.firstLoadMs)), coldInitMs: start.cold.map((c: Json) => Math.round(c.initMs)), coldMedianMs: Math.round(start.coldMedianMs), coldMaxMs: Math.round(start.coldMaxMs), warmMs: start.warm.map((w: Json) => Math.round(w.firstLoadMs)), replayRunStartsMs: replays.map(r => Math.round(r.startTimings.firstLoadMs)) } : null,
    memory: { peakChromiumTreeMB: replays.map(r => mb(r.memory.peakChromium)), peakNodeMB: replays.map(r => mb(r.memory.peakNode)), chromiumProcesses: replays.map(r => r.memory.peakProcesses), samples: replays.map(r => r.memory.samples) },
    download: { releaseAssetMB: mb(pin.size), unpackedMB: unpacked ? mb(unpacked.bytes) : null, unpackedFiles: unpacked?.files ?? null, loadedByAppMB: replays[0] ? mb(replays[0].served.bytes) : null, loadedByAppFiles: replays[0]?.served.files ?? null },
  },
  latency: { perReplayRun: replays.map(r => r.latency), medianLoadMs: median(replays.map(r => r.latency.loadMedianMs)), medianExportMs: median(replays.map(r => r.latency.exportMedianMs)) },
  q5_exportStability: stability ? { tasks: stability.tasks.length, varyingRawAttributes: [...new Set(stability.tasks.flatMap((t: Json) => t.varyingAttributes))], projectionsIdentical: stability.tasks.every((t: Json) => t.projectionIdentical), projectionsEqualPrediction: stability.tasks.every((t: Json) => t.projectionEqualsPrediction), compressedExport: { honoured: stability.compressed.exportIsCompressed, projectionEqualsPrediction: stability.compressed.projectionEqualsPrediction } } : null,
  counterProbes: probes ? { cases: probes.results.length, allFail: probes.allFail } : null,
  exploratory: explore,
};
mkdirSync(SUMMARY_DIR, { recursive: true });
writeFileSync(join(SUMMARY_DIR, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
process.stdout.write(`wrote spikes/drawio/results/summary.json\n`);
