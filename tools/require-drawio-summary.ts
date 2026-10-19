// The draw.io layer ran (PADR-0049 decision 2.8): a test file that selected nothing, or skipped, still
// exits 0, so CI also requires the layer's summary with three runs over a non-zero number of sequences
// and no disagreement.   node tools/require-drawio-summary.ts <summary.json>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface Summary { schema?: unknown; runs?: Array<{ sequences?: unknown }>; disagreements?: unknown; problems?: unknown }
/** Every reason the summary does not show a complete draw.io run; empty when it does. */
export function summaryProblems(text: string): string[] {
  let summary: Summary;
  try { summary = JSON.parse(text) as Summary; } catch { return ['the summary is not JSON']; }
  const problems: string[] = [];
  if (summary.schema !== 'practonaut.drawio-conformance/1') problems.push('not a draw.io conformance summary');
  if (!Array.isArray(summary.runs) || summary.runs.length !== 3) problems.push('it does not hold three runs');
  else for (const [index, run] of summary.runs.entries()) if (typeof run.sequences !== 'number' || !(run.sequences > 0)) problems.push(`run ${index + 1} has no sequences`);
  if (summary.disagreements !== 0) problems.push('the runs disagree');
  if (!Array.isArray(summary.problems) || summary.problems.length) problems.push('the runs reported problems');
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
  console.log('drawio summary: three runs, every sequence agreed');
}
