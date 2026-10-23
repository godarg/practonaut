// The draw.io layer ran (PADR-0049 decision 2.8): a test file that selected nothing, or skipped, still
// exits 0, so CI also requires the layer's summary with three runs over a non-zero number of sequences,
// no disagreement, the pinned release, one Chromium version and, observed in every run, Chromium
// processes none of which ran without its sandbox.   node tools/require-drawio-summary.ts <summary.json>
// The evidence tool also binds the summary to a commit and the planned sequences (review m2c).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DRAWIO_PIN } from '../src/adapters/drawio/pin.ts';

interface Observation { samples?: unknown; processes?: unknown; noSandbox?: unknown }
interface Summary {
  schema?: unknown; commit?: unknown; dirty?: unknown; chromium?: unknown; pin?: { version?: unknown; size?: unknown; sha256?: unknown };
  sandbox?: { policy?: unknown; observed?: unknown }; runs?: Array<{ sequences?: unknown; chromium?: unknown }>; disagreements?: unknown; problems?: unknown;
}
/** What a summary must also match to stand as committed evidence: the commit it describes, made from a
 * clean checkout, and the number of sequences the protocol plans. */
export interface SummaryBinding { commit: string; planned: number }
const counted = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Every reason the summary does not show a complete draw.io run; empty when it does. */
export function summaryProblems(text: string, binding?: SummaryBinding): string[] {
  let summary: Summary;
  try { summary = JSON.parse(text) as Summary; } catch { return ['the summary is not JSON']; }
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) return ['the summary is not an object'];
  const problems: string[] = [];
  if (summary.schema !== 'practonaut.drawio-conformance/2') problems.push('not a draw.io conformance summary (schema practonaut.drawio-conformance/2)');
  if (typeof summary.commit !== 'string' || !/^[0-9a-f]{40}$/.test(summary.commit)) problems.push('it names no commit');
  const pin = summary.pin ?? {};
  if (pin.version !== DRAWIO_PIN.version || pin.size !== DRAWIO_PIN.size || pin.sha256 !== DRAWIO_PIN.sha256) problems.push(`it is not for the pinned draw.io ${DRAWIO_PIN.version}`);
  if (typeof summary.chromium !== 'string' || !/^\d+(\.\d+){1,3}$/.test(summary.chromium)) problems.push('it names no single Chromium version');
  if (!Array.isArray(summary.runs) || summary.runs.length !== 3) problems.push('it does not hold three runs');
  else for (const [index, run] of summary.runs.entries()) {
    if (typeof run.sequences !== 'number' || !(run.sequences > 0)) problems.push(`run ${index + 1} has no sequences`);
    else if (binding && run.sequences !== binding.planned) problems.push(`run ${index + 1} has ${run.sequences} sequences, the protocol plans ${binding.planned}`);
    if (run.chromium !== summary.chromium) problems.push(`run ${index + 1} ran another Chromium`);
  }
  const sandbox = summary.sandbox ?? {}, observed = Array.isArray(sandbox.observed) ? sandbox.observed as Array<Observation | null> : [];
  if (sandbox.policy !== 'required') problems.push('the sandbox policy is not required');
  if (observed.length !== 3) problems.push('the sandbox was not observed in three runs');
  for (const [index, seen] of observed.entries()) {
    if (seen === null || typeof seen !== 'object' || !counted(seen.samples) || !counted(seen.processes) || !counted(seen.noSandbox) || seen.samples < 1 || seen.processes < 1) problems.push(`run ${index + 1}: no Chromium process was observed`);
    else if (seen.noSandbox !== 0) problems.push(`run ${index + 1}: ${seen.noSandbox} Chromium processes ran with --no-sandbox`);
  }
  if (summary.disagreements !== 0) problems.push('the runs disagree');
  if (!Array.isArray(summary.problems) || summary.problems.length) problems.push('the runs reported problems');
  if (binding) {
    if (summary.commit !== binding.commit) problems.push(`it was made on ${String(summary.commit).slice(0, 12)}, not on ${binding.commit.slice(0, 12)}`);
    if (summary.dirty !== false) problems.push('it was made from a checkout with changes not in its commit');
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node tools/require-drawio-summary.ts <summary.json>'); process.exit(2); }
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { console.error('drawio summary: missing; the draw.io layer did not run'); process.exit(1); }
  const problems = summaryProblems(text);
  for (const problem of problems) console.error(`drawio summary: ${problem}`);
  if (problems.length) process.exit(1);
  console.log('drawio summary: three runs, every sequence agreed, Chromium observed with its sandbox');
}
