/**
 * Rendering of a validated bench report (PADR-0039 B): a terminal summary and one static HTML page in
 * design system v1 (tokens.css and report.css inlined into one hashed style; no script, no external
 * asset, no `data:` URI). The headline carries the fraction and a 95 % Wilson interval; verification
 * status, mirror, isolation level and the self-reported model follow as chips. Rates are fractions; a
 * percentage appears only where n allows it (rates.ts). Failures come first, each with why it failed,
 * its conditions over time, the board beside an example target at one scale, the trajectory, the call
 * log and the client's own figures. Codes, hashes and the command sit under "Technical details". Every
 * text from a report or a bench folder is escaped; status is spelled out and shaped, never shown by
 * colour alone.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isBenchReportV2, type BenchReport, type BenchRun } from './report.ts';
import { readableText } from '../cli/output.ts';
import { aggregateInstance } from './stats.ts';
import { intervalPercent, number, rateText, type Language } from './rates.ts';
import { fill, sentence, TEXT, type Words } from './report-text.ts';
import { explanationKey, type ConditionDetail, type ReportDetails, type RunDetail, type TrajectoryRow } from './details.ts';
import type { BoardObject } from './schematic.ts';
import { styleNames } from '../world/style-names.ts';

export type Verification = 'consistency-checked' | 're-verified';

/** Report text is data from a file: control, format and bidi characters are shown escaped, never interpreted by a terminal. */
const shown = (value: string): string => readableText(value);
export const escapeHtml = (value: string): string => readableText(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const esc = escapeHtml;

/** Words for the details loader (picture labels and legends) in the page's language. */
export function detailWords(language: Language): { group: string; loose: string; finalBoard: string; target: string } {
  const t = TEXT[language];
  return { group: t.group, loose: t.loose, finalBoard: t.finalBoard, target: t.target };
}

// The kit's status shapes and info mark (src/player/ui/icons.ts), drawn inline: shape first, colour second.
const SHAPES = {
  pass: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M7.7 12.4l3 3 5.6-6" stroke="var(--pn-color-surface)" stroke-width="2.2"/>',
  fail: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M9 9l6 6M15 9l-6 6" stroke="var(--pn-color-surface)" stroke-width="2.2"/>',
  unknown: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.8h.01" stroke-width="2.6"/>',
} as const;
/** A status mark next to its word (the word is what a screen reader reads). */
export function statusIcon(kind: 'pass' | 'fail' | 'unknown'): string {
  return `<svg class="status-icon ${kind}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SHAPES[kind]}</svg>`;
}
const infoIcon = (): string => `<svg class="banner-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SHAPES.info}</svg>`;
/** A banner: a statement about the situation. `tone` neutral (fill), unknown (hatched: something is not known here). */
export function banner(tone: 'neutral' | 'unknown' | 'warning', title: string, body: string): string {
  return `<div class="banner ${tone}" role="note">${infoIcon()}<div class="banner-body"><p class="banner-title">${esc(title)}</p>${body}</div></div>`;
}
/** Facts as neutral chips (a chip is a fact, never an action). */
export function chips(label: string, facts: readonly string[]): string {
  return `<ul class="chips" aria-label="${esc(label)}">${facts.map(fact => `<li class="chip">${esc(fact)}</li>`).join('')}</ul>`;
}
/** A table that stacks into one block per row below 40rem: every cell names its column. */
export function stackedTable(label: string, labelledBy: string | null, head: ReadonlyArray<{ text: string; numeric?: boolean; wide?: boolean }>, rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const region = labelledBy ? `aria-labelledby="${labelledBy}"` : `aria-label="${esc(label)}"`;
  const header = head.map(cell => `<th scope="col"${cell.numeric ? '' : ' class="text"'}>${esc(cell.text)}</th>`).join('');
  const kind = (cell: { numeric?: boolean; wide?: boolean }): string => cell.wide ? ' class="text wide"' : cell.numeric ? '' : ' class="text"';
  const body = rows.map(row => `<tr>${row.map((cell, index) => `<td data-label="${esc(head[index]!.text)}"${kind(head[index]!)}>${cell}</td>`).join('')}</tr>`).join('');
  return `<div class="scroll stack" role="region" ${region} tabindex="0"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
}
/** The first sentence of an explanation (the factual part); the full text stays under Technical details. */
export function firstSentence(text: string): string {
  const match = /^(.+?[.!?])(?:\s+(?=\p{Lu})|$)/u.exec(text.trim());
  return match ? match[1]! : text.trim();
}

/** Instances (task × seed) and how many passed: at least half of all their runs passed; a run that
 * was not judged counts as not passed (PADR-0039 B.1). */
export function instanceOutcome(runs: readonly BenchRun[]): { passed: number; instances: number; repeated: boolean } {
  const byInstance = new Map<string, Array<boolean | null>>();
  for (const run of runs) { const key = `${run.taskId}\u0000${run.seed}`; byInstance.set(key, [...(byInstance.get(key) ?? []), run.checker === null ? null : run.pass]); }
  const outcomes = [...byInstance.values()];
  return { passed: outcomes.filter(repeats => aggregateInstance(repeats).outcome === 'pass').length, instances: outcomes.length, repeated: outcomes.some(repeats => repeats.length > 1) };
}

function isolationText(report: BenchReport, t: Words): string {
  if (!isBenchReportV2(report)) return t.isolationUnrecorded;
  return { 'builtin-baseline': t.isolationBuiltin, 'tool-restricted-preset': t.isolationPreset, 'template-unrestricted': t.isolationTemplate }[report.agent.isolation];
}
function worldText(report: BenchReport, t: Words): string {
  if (!isBenchReportV2(report)) return `${report.environment.library.worldId} ${report.environment.library.version}`;
  const world = report.environment.world;
  return `${world.worldId} ${world.version} (${world.source === 'library' ? t.worldLibrary : t.worldOwn})`;
}

/** The result half of the header line: fractions and the interval (PADR-0039 B.1). */
export function headlineResult(report: BenchReport, language: Language): string[] {
  const t = TEXT[language], s = report.summary, instances = instanceOutcome(report.runs);
  const parts = instances.repeated
    ? [fill(language, t.headlineRuns, { fraction: rateText(s.passed, s.runs, language) }), fill(language, t.headlineInstances, { fraction: rateText(instances.passed, instances.instances, language) })]
    : [fill(language, t.headlinePassed, { fraction: rateText(s.passed, s.runs, language) })];
  if (instances.instances) {
    const interval = intervalPercent(instances.passed, instances.instances);
    parts.push(fill(language, t.interval, { low: interval.low, high: interval.high, instances: fill(language, t.instanceCount, { n: instances.instances }) }));
  } else parts.push(t.intervalNone);
  return parts;
}
/** The provenance half: verification, mirror, isolation and the self-reported model. */
export function provenance(report: BenchReport, language: Language, verification: Verification): string[] {
  const t = TEXT[language];
  const parts = [verification === 're-verified' ? t.reverifiedShort : t.consistencyShort, report.environment.mirror === 'required' ? t.mirrorOn : t.mirrorOff, isolationText(report, t)];
  if (report.agent.kind !== 'builtin') parts.push(modelHeadline(report, language));
  return parts;
}
/** The whole header line (terminal): result, interval, verification, mirror, isolation, model. */
export function headline(report: BenchReport, language: Language, verification: Verification): string[] {
  return [...headlineResult(report, language), ...provenance(report, language, verification)];
}
/** The reported model with where it came from (never verified): the preset client's own init event,
 * or an init line in a command template's output. */
export function modelHeadline(report: BenchReport, language: Language): string {
  const t = TEXT[language], model = report.agent.model;
  if (model === null) return t.modelNone;
  if (report.agent.modelSource === 'client-attested') return fill(language, t.modelSelfClient, { model });
  if (report.agent.modelSource === 'command-output') return fill(language, t.modelSelfCommand, { model });
  return fill(language, t.modelSelf, { model });
}

/** The command as one line, the home folder shown as `~` (a shared report need not name it). */
export function commandLine(command: readonly string[]): string {
  const home = homedir();
  return command.map(word => {
    const short = home && home.length > 1 && word.startsWith(home) && (word.length === home.length || word[home.length] === '/' || word[home.length] === '\\') ? `~${word.slice(home.length)}` : word;
    return short === '' ? "''" : /\s/.test(short) ? `'${short}'` : short;
  }).join(' ');
}
/** bench/2 facts that are identifiers rather than findings: shown under Technical details. */
function technicalFacts(report: BenchReport, t: Words): Array<[label: string, value: string]> {
  const facts: Array<[string, string]> = [];
  if (report.agent.command.length) facts.push([t.commandLabel, commandLine(report.agent.command)]);
  if (!isBenchReportV2(report)) { facts.push([t.worldContentHash, report.environment.library.contentHash]); return facts; }
  facts.push([t.worldContentHash, report.environment.world.contentHash]);
  const generated = report.environment.world.generated;
  if (generated.length) facts.push([t.generated, generated.map(entry => `${entry.taskId} (${entry.id} ${entry.version}, seed ${entry.seed})`).join(', ')]);
  if (report.agent.apiKeySource !== null) facts.push([t.apiKeySource, report.agent.apiKeySource]);
  if (report.agent.keptEnv.length) facts.push([t.keptEnv, report.agent.keptEnv.join(', ')]);
  return facts;
}
const sampleLine = (report: BenchReport, language: Language): string => {
  const t = TEXT[language];
  return `n = ${[fill(language, t.runCount, { n: report.summary.runs }), fill(language, t.seedCount, { n: report.settings.seeds.length }), fill(language, t.repeatCount, { n: report.settings.repeats })].join(' · ')}`;
};
const planLine = (report: BenchReport, language: Language): string => {
  const t = TEXT[language];
  return fill(language, t.tasksSeeds, { plan: [fill(language, t.taskCount, { n: report.settings.tasks.length }), fill(language, t.seedCount, { n: report.settings.seeds.length }), fill(language, t.repeatCount, { n: report.settings.repeats })].join(' × '), timeout: report.settings.timeoutSeconds, actions: report.settings.maxActions });
};
const fixed = (value: number | null, digits: number, language: Language): string => value === null ? '—' : number(value, digits, language);
const seconds = (ms: number | null, language: Language): string => ms === null ? '—' : `${number(ms / 1000, 1, language)} s`;
const referenceCell = (value: number | null, t: Words): string => value === null ? t.noReference : String(value);
function efficiencyText(report: BenchReport, language: Language): { value: string; detail?: string } {
  const t = TEXT[language], tasks = report.summary.byTask, referenced = tasks.filter(task => task.referenceActions !== null).length;
  if (!referenced) return { value: t.noReference };
  const value = fixed(report.summary.efficiencyVsReference, 2, language);
  return referenced < tasks.length ? { value, detail: fill(language, t.referencePartial, { n: referenced, m: tasks.length }) } : { value };
}
/** pass^k for k = repeats: the instances where all k repeats passed, of all instances (null with one repeat). */
function allRepeatsCount(report: BenchReport): { all: number; instances: number } | null {
  const k = report.settings.repeats;
  if (k < 2) return null;
  const instances = new Map<string, BenchRun[]>();
  for (const run of report.runs) { const key = `${run.taskId}\u0000${run.seed}`; instances.set(key, [...(instances.get(key) ?? []), run]); }
  return { all: [...instances.values()].filter(runs => runs.length === k && runs.every(run => run.pass)).length, instances: instances.size };
}
function allRepeats(report: BenchReport, language: Language): string | null {
  const count = allRepeatsCount(report);
  return count === null ? null : fill(language, TEXT[language].passHatAll, { k: report.settings.repeats, fraction: rateText(count.all, count.instances, language) });
}
/** Tokens, turns and cost summed over the runs whose client reported them (self-reported). */
function clientTotals(report: BenchReport, language: Language): string | null {
  if (!isBenchReportV2(report)) return null;
  const t = TEXT[language], runs = report.runs.flatMap(run => run.client ? [run.client] : []);
  if (!runs.length) return null;
  const parts: string[] = [];
  const tokens = runs.flatMap(client => client.tokens ? [client.tokens] : []);
  if (tokens.length) parts.push(fill(language, t.tokensPart, { input: number(tokens.reduce((sum, value) => sum + value.input + value.cacheRead + value.cacheCreation, 0), 0, language), output: number(tokens.reduce((sum, value) => sum + value.output, 0), 0, language) }));
  const turns = runs.flatMap(client => client.turns === null ? [] : [client.turns]);
  if (turns.length) parts.push(fill(language, t.turnsPart, { n: turns.reduce((sum, value) => sum + value, 0) }));
  const costs = runs.flatMap(client => client.costUsd === null ? [] : [client.costUsd]);
  if (costs.length) parts.push(fill(language, t.costPart, { cost: number(costs.reduce((sum, value) => sum + value, 0), 4, language) }));
  return parts.length ? `${fill(language, t.clientTotals, { parts: parts.join(' · ') })}.` : null;
}
/** Failed runs first, each group in plan order. */
const failuresFirst = (runs: readonly BenchRun[]): BenchRun[] => [...runs.filter(run => !run.pass), ...runs.filter(run => run.pass)];
/** How the agent's run ended, in words (the code is under Technical details). */
export const statusWords = (run: BenchRun, t: Words): string => ({ completed: t.statusCompleted, timeout: t.statusTimeout, agent_failed: t.statusAgentFailed, infra_error: t.statusInfra })[run.status];
const historyText = (history: ConditionDetail['history'], language: Language): string => {
  const t = TEXT[language];
  switch (history.kind) {
    case 'start': return t.historyStart;
    case 'since': return fill(language, t.historySince, { action: history.action });
    case 'never': return t.historyNever;
    case 'lost': return fill(language, t.historyLost, { action: history.action });
    case 'unknown': return t.historyUnknown;
  }
};
const codeText = (code: string, t: Words): string => (t as unknown as Record<string, string>)[`code_${code}`] ?? '';
const errorClassesOf = (run: BenchRun): string[] => [...new Set([...(run.checker?.session.errorClasses ?? []), ...(run.checker?.native?.errorClasses ?? [])])];
/** An error class's explanation: the run's stored checker output, else the bundled library's. */
function explanationOf(run: BenchRun, id: string, detail: RunDetail | undefined, details: ReportDetails | undefined, language: Language): string | null {
  const stored = detail?.errors.find(error => error.id === id)?.explanation ?? details?.explanations.get(explanationKey(run.taskId, run.seed, id));
  return stored ? stored[language] : null;
}

/** Why a run ended as it did, each state by name with its reason (PADR-0039 B.3): one item, one colon.
 * `code` (an action as it was called) follows `why` and precedes `tail`, shown as code. */
interface State { name: string; why: string; code?: string; tail?: string; list?: string[] }
function runStates(run: BenchRun, detail: RunDetail | undefined, details: ReportDetails | undefined, report: BenchReport, language: Language): State[] {
  const t = TEXT[language], states: State[] = [];
  if (run.status === 'timeout') states.push({ name: t.stateTimeout, why: fill(language, t.stateTimeoutWhy, { timeout: report.settings.timeoutSeconds }) });
  if (run.status === 'agent_failed') states.push({ name: t.stateAgentFailed, why: run.agentExitCode === null ? t.stateAgentNoStart : fill(language, t.stateAgentFailedWhy, { code: run.agentExitCode }) });
  if (run.status === 'infra_error') states.push({ name: t.stateUnjudged, why: t.stateUnjudgedWhy });
  if (run.status !== 'infra_error' && run.acceptedActions === 0) states.push({ name: t.stateEmpty, why: t.stateEmptyWhy });
  if (run.rejectedActions > 0) states.push({ name: t.stateRejected, why: fill(language, t.stateRejectedWhy, { n: run.rejectedActions, m: run.toolCalls.act }), list: (detail?.rejected ?? []).map(([code, count]) => fill(language, t.rejectedItem, { reason: codeText(code, t) || t.rejectedOther, n: count })) });
  if (detail && detail.clients.length > 1) states.push({ name: t.stateClients, why: fill(language, t.stateClientsWhy, { n: detail.clients.length, names: detail.clients.join(', ') }) });
  const actionText = (number: number): string => detail?.trajectory?.find(row => row.number === number)?.text ?? '';
  let unmet = 0;
  for (const condition of detail?.conditions ?? []) {
    if (condition.met !== false) continue;
    unmet++;
    const action = condition.history.kind === 'lost' ? actionText(condition.history.action) : '';
    states.push(action ? { name: t.stateUnmet, why: `${condition.text[language]} (${historyText(condition.history, language)}, `, code: action, tail: ')' } : { name: t.stateUnmet, why: `${condition.text[language]} (${historyText(condition.history, language)})` });
  }
  const classes = errorClassesOf(run);
  for (const id of classes) { const explanation = explanationOf(run, id, detail, details, language); states.push({ name: fill(language, t.stateErrorClass, { id }), why: explanation ? firstSentence(explanation) : '' }); }
  // A failed run always says why, even when the folder that would name the condition is missing.
  if (!run.pass && run.checker && !unmet && !classes.length && run.status === 'completed' && run.rejectedActions === 0 && run.acceptedActions > 0) states.push({ name: t.stateFailed, why: t.stateFailedWhy });
  return states;
}

export function renderTable(report: BenchReport, language: Language = 'en', details?: ReportDetails, verification: Verification = 'consistency-checked'): string {
  const t = TEXT[language], s = report.summary, lines: string[] = [];
  lines.push(`${t.title}  ${shown(report.agent.name)}`);
  // The header line (PADR-0039 B.1): fraction, interval, verification, mirror, isolation, model.
  lines.push(shown(headline(report, language, verification).join(' · ')));
  if (isBenchReportV2(report) && report.label !== undefined) lines.push(`${t.label}: ${shown(report.label)}`);
  if (isBenchReportV2(report)) lines.push(shown(`${t.world}: ${worldText(report, t)}`));
  for (const [label, value] of technicalFacts(report, t).filter(([label]) => label !== t.commandLabel)) lines.push(shown(`${label}: ${value}`));
  lines.push(sampleLine(report, language));
  if (report.interrupted) lines.push(fill(language, t.interrupted, { runs: report.runs.length, planned: report.interrupted.plannedRuns }));
  lines.push(planLine(report, language));
  lines.push('');
  if (s.infraErrors) lines.push(fill(language, t.infraIncluded, { n: s.infraErrors }));
  const repeats = allRepeats(report, language);
  if (repeats) lines.push(repeats);
  lines.push(`${t.meanActions} ${fixed(s.meanActions, 1, language)}   ${t.meanActionsPassed} ${fixed(s.meanActionsPassed, 1, language)}   ${t.wall} ${seconds(s.meanWallMs, language)}`);
  const efficiency = efficiencyText(report, language);
  lines.push(`${t.efficiency} ${efficiency.value}${efficiency.detail ? `, ${efficiency.detail}` : ''}  (${t.efficiencyDirection})`);
  const totals = clientTotals(report, language);
  if (totals) lines.push(totals);
  lines.push('');
  const header = [t.task, t.runs, t.passed, t.actions, t.reference, t.efficiency];
  const rows = s.byTask.map(task => [shown(task.taskId), String(task.runs), rateText(task.passed, task.runs, language), fixed(task.meanActions, 1, language), referenceCell(task.referenceActions, t), task.referenceActions === null ? t.noReference : fixed(task.efficiency, 2, language)]);
  const widths = header.map((head, column) => Math.max(head.length, ...rows.map(row => row[column]!.length)));
  const format = (row: string[]): string => row.map((cell, column) => column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)).join('  ');
  lines.push(format(header)); lines.push(widths.map(width => '─'.repeat(width)).join('  '));
  for (const row of rows) lines.push(format(row));
  const failed = report.runs.filter(run => !run.pass);
  if (failed.length) {
    lines.push('', fill(language, t.failuresHead, { n: failed.length, runs: fill(language, t.runCount, { n: s.runs }) }));
    for (const run of failed.slice(0, 20)) {
      lines.push(`✗ ${shown(run.id)}  ${statusWords(run, t)}`);
      for (const state of runStates(run, details?.runs.get(run.id), details, report, language)) {
        lines.push(shown(`    ${state.name}${state.why ? `: ${state.why}${state.code ?? ''}${state.tail ?? ''}` : ''}`));
        for (const item of state.list ?? []) lines.push(shown(`      ${item}`));
      }
    }
    if (failed.length > 20) lines.push(fill(language, t.moreFailures, { n: failed.length - 20 }));
  }
  return lines.join('\n') + '\n';
}

/** design/tokens.css in a checkout, the player's copy in an installed package. */
export async function readTokensCss(): Promise<string> {
  const source = import.meta.url.endsWith('.ts');
  return readFile(fileURLToPath(new URL(source ? '../../design/tokens.css' : '../player/assets/tokens.css', import.meta.url)), 'utf8');
}
/** The report stylesheet, beside this module in a checkout and in the build; read when a page is
 * first written, so no other command depends on it. */
let reportCss: string | undefined;
export function reportStylesheet(): string {
  reportCss ??= readFileSync(fileURLToPath(new URL('./report.css', import.meta.url)), 'utf8');
  return reportCss;
}

/** One static page: the hashed style is the only thing the CSP allows. */
export function page(language: Language, title: string, tokensCss: string, body: string): string {
  const style = tokensCss + reportStylesheet(), hash = createHash('sha256').update(style).digest('base64');
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>${style}</style>
</head>
<body>
<main class="page">
${body}
</main>
</body>
</html>
`;
}

const result = (pass: boolean, t: Words): string => `<span class="result ${pass ? 'pass' : 'fail'}">${statusIcon(pass ? 'pass' : 'fail')}${esc(pass ? t.pass : t.fail)}</span>`;
const figure = (label: string, value: string, detail?: string): string => `<div class="figure"><dt>${esc(label)}</dt><dd>${esc(value)}</dd>${detail ? `<dd class="detail">${esc(detail)}</dd>` : ''}</div>`;
/** A "Technical details" disclosure holding label/value pairs (identifiers, codes, hashes). */
function technical(t: Words, facts: ReadonlyArray<[string, string]>): string {
  if (!facts.length) return '';
  return `<details class="tech"><summary>${esc(t.technical)}</summary><dl class="settings">${facts.map(([label, value]) => `<dt>${esc(label)}</dt><dd><code>${esc(value)}</code></dd>`).join('')}</dl></details>`;
}

function conditionsHtml(detail: RunDetail, language: Language): string {
  const t = TEXT[language];
  const missing = (reason: RunDetail['conditionsMissing']): string => reason === 'changed' ? t.missingChanged : reason === 'unreadable' ? t.missingUnreadable : reason === 'not-judged' ? t.missingNotJudged : t.missingNotRecorded;
  if (!detail.conditions) return `<p class="note">${esc(fill(language, t.conditionsMissing, { reason: missing(detail.conditionsMissing) }))}</p>`;
  const items = detail.conditions.map(condition => {
    const kind = condition.met === null ? 'unknown' : condition.met ? 'pass' : 'fail';
    const word = condition.met === null ? t.conditionUnknown : condition.met ? t.conditionMet : t.conditionUnmet;
    return `<li class="condition">${statusIcon(kind)}<div><span class="condition-status ${kind}">${esc(word)}:</span> ${esc(condition.text[language])} <span class="history">(${esc(historyText(condition.history, language))})</span>${condition.formal ? `<span class="formal">${esc(t.formal)}: ${esc(condition.formal[language])}</span>` : ''}</div></li>`;
  }).join('');
  const note = detail.traceError ? `<p class="note">${esc(t.traceMissing)}</p>` : detail.conditionsMissing ? `<p class="note">${esc(fill(language, t.conditionsMissing, { reason: missing(detail.conditionsMissing) }))}</p>` : '';
  return `<ul class="conditions">${items}</ul>${note}`;
}

/** One line per object of a state, every goal-relevant attribute in words, labels in full. */
export function objectLines(objects: readonly BoardObject[], language: Language): string[] {
  const t = TEXT[language], names = styleNames[language] as Record<string, string>;
  const quoted = (value: string): string => language === 'de' ? `„${value}“` : `“${value}”`;
  return objects.map(object => {
    if (object.kind === 'arrow') return fill(language, t.arrowLine, { from: object.from === null ? t.loose : quoted(object.from), to: object.to === null ? t.loose : quoted(object.to) });
    const geometry = fill(language, t.stepGeometry, { width: object.width, height: object.height, x: object.x, y: object.y });
    const style = object.shape === null ? [] : [names[object.shape] ?? object.shape, fill(language, t.stepLine, { stroke: names[object.stroke!] ?? object.stroke! }), object.fill === 'none' ? t.stepNoFill : fill(language, t.stepFill, { fill: names[object.fill!] ?? object.fill! })];
    const place = [...(object.frame !== null ? [fill(language, t.stepFrame, { name: quoted(object.frame) })] : []), ...(object.group !== null ? [`${t.group} ${object.group}`] : [])];
    return `${quoted(object.label)}: ${[...style, geometry, ...place].join(', ')}`;
  });
}

function boardHtml(detail: RunDetail, report: BenchReport, language: Language): string {
  const t = TEXT[language], picture = detail.picture;
  const quoted = (value: string): string => language === 'de' ? `„${value}“` : `“${value}”`;
  const reason = picture?.kind === 'schematic' ? { 'model-only': t.reasonModelOnly, 'no-picture': t.reasonNoPicture, 'picture-unreadable': t.reasonPictureUnreadable, 'picture-changed': t.reasonPictureChanged }[picture.reason] : '';
  const caption = picture?.kind === 'engine' ? fill(language, t.finalEngine, { version: report.environment.excalidraw }) : `${t.finalSchematic} ${reason}`;
  const list = (title: string, items: string[]): string => `<p class="legend-title">${esc(title)}</p><ul class="legend">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
  // A picture wider than the column scrolls inside its frame; a faded edge and a line say so.
  const overflow = { none: 'fits', narrow: 'overflows-phone', wide: 'overflows-desktop' }[detail.overflow];
  const frame = (markup: string, label: string): string => `<div class="board-scroll ${overflow}" role="region" tabindex="0" aria-label="${esc(label)}">${markup}</div>${detail.overflow === 'none' ? '' : `<p class="scroll-hint ${overflow}">${esc(t.scrollHint)}</p>`}`;
  const legend: string[] = [];
  if (detail.objects.length) legend.push(list(t.objectsTitle, objectLines(detail.objects, language)));
  legend.push(detail.groups.length ? list(t.groups, detail.groups.map(group => `${group.name}: ${group.members.map(quoted).join(', ')}`)) : `<p class="legend-title">${esc(t.groups)}</p><p class="meta">${esc(t.noGroups)}</p>`);
  if (detail.frames.length) legend.push(list(t.frames, detail.frames.map(item => item.members.length ? fill(language, t.frameMembers, { name: quoted(item.name), members: item.members.map(quoted).join(', ') }) : fill(language, t.emptyFrame, { name: quoted(item.name) }))));
  const final = picture ? `<figure class="board-figure"><figcaption><span class="figure-title">${esc(t.finalBoard)}</span>${esc(caption)}</figcaption>${frame(picture.markup, t.finalBoard)}${legend.join('')}</figure>` : '';
  const target = detail.target
    ? `<figure class="board-figure"><figcaption><span class="figure-title">${esc(t.target)}</span>${esc(t.targetCaption)}</figcaption>${frame(detail.target, t.target)}${detail.targetObjects.length ? list(t.objectsTitle, objectLines(detail.targetObjects, language)) : ''}</figure>`
    : banner('neutral', t.noTargetTitle, `<p>${esc(detail.targetMissing === 'unreadable' ? t.targetUnreadable : t.noTarget)}</p>`);
  return `<div class="boards">${final}${target}</div>${picture && detail.target ? `<p class="note">${esc(t.pairNote)}</p>` : ''}`;
}

function trajectoryHtml(detail: RunDetail, language: Language): string {
  const t = TEXT[language];
  if (!detail.trajectory) {
    const reason = detail.trajectoryMissing === 'changed' ? t.missingChanged : detail.trajectoryMissing === 'unreadable' ? t.missingUnreadable : t.missingNotRecorded;
    return `<p class="note">${esc(fill(language, t.trajectoryMissing, { reason }))}</p>`;
  }
  if (!detail.trajectory.length) return `<p class="note">${esc(t.trajectoryEmpty)}</p>`;
  const total = detail.conditions?.length ?? 0, byClient = detail.clients.length > 1;
  const row = (entry: TrajectoryRow): string[] => {
    const outcome = entry.outcome === 'accepted' ? esc(fill(language, t.accepted, { revision: entry.revision })) : `${statusIcon('fail')}${esc(fill(language, t.rejectedAs, { reason: codeText(entry.code ?? '', t) || t.rejectedOther }))}`;
    const met = entry.met === null ? t.none : [fill(language, t.metAfter, { met: entry.met, total }), ...(entry.gained.length ? [fill(language, t.gained, { list: entry.gained.join(', ') })] : []), ...(entry.lost.length ? [fill(language, t.lost, { list: entry.lost.join(', ') })] : [])].join(' · ');
    return [String(entry.number), ...(byClient ? [esc(entry.client ?? t.none)] : []), `<code>${esc(entry.text)}</code>`, `<span class="outcome">${outcome}</span>`, esc(met)];
  };
  const head = [{ text: t.trajectoryHead, numeric: true }, ...(byClient ? [{ text: t.trajectoryBy }] : []), { text: t.trajectoryAction, wide: true }, { text: t.trajectoryResult }, { text: t.trajectoryMet }];
  return stackedTable(t.trajectory, null, head, detail.trajectory.map(row));
}

function callsHtml(detail: RunDetail, language: Language): string {
  const t = TEXT[language], calls = detail.calls;
  if (!calls) return `<p class="note">${esc(fill(language, t.callsMissing, { reason: detail.callsMissing === 'changed' ? t.missingChanged : detail.callsMissing === 'unreadable' ? t.missingUnreadable : t.callsMissingNone }))}</p>`;
  const lines = [`${fill(language, t.callsLine, { calls: calls.calls, bytes: `${number(calls.resultBytes / 1024, 1, language)} KB`, bridge: calls.bridgeMedianMs === null ? t.none : number(calls.bridgeMedianMs, 1, language), client: calls.clientMedianMs === null ? t.clientUnavailable : fill(language, t.clientMedian, { ms: number(calls.clientMedianMs, 1, language) }) })}.`,
    fill(language, t.callsTools, { list: calls.byTool.map(([tool, count]) => `${tool} ${count}`).join(', ') || t.none })];
  const failed = calls.codes.reduce((sum, [, count]) => sum + count, 0);
  if (failed) lines.push(fill(language, t.callsFailed, { n: failed }));
  if (calls.dropped) lines.push(fill(language, t.callsDropped, { n: calls.dropped }));
  if (calls.omitted) lines.push(fill(language, calls.omittedAtLeast ? t.callsOmittedMore : t.callsOmitted, { n: calls.omitted }));
  return `${lines.map(line => `<p class="meta">${esc(line)}</p>`).join('')}<p class="note">${esc(t.callsNote)}</p>`;
}

function clientHtml(run: BenchRun, language: Language): string {
  if (!('client' in run) || !run.client) return '';
  const t = TEXT[language], client = run.client, parts: string[] = [];
  if (client.model) parts.push(fill(language, t.clientModel, { model: client.model }));
  if (client.turns !== null) parts.push(fill(language, t.turnsPart, { n: client.turns }));
  if (client.tokens) parts.push(fill(language, t.tokensPart, { input: number(client.tokens.input + client.tokens.cacheRead + client.tokens.cacheCreation, 0, language), output: number(client.tokens.output, 0, language) }));
  if (client.costUsd !== null) parts.push(fill(language, t.costPart, { cost: number(client.costUsd, 4, language) }));
  return parts.length ? `<h3>${esc(t.client)}</h3><p class="meta">${esc(fill(language, t.clientLine, { parts: parts.join(' · ') }))}</p>` : '';
}

/** A run card is open when the run failed or its agent did not complete normally (F15). */
const opensByDefault = (run: BenchRun): boolean => !run.pass || run.status !== 'completed';

function runHtml(run: BenchRun, report: BenchReport, details: ReportDetails | undefined, language: Language): string {
  const t = TEXT[language], detail = details?.runs.get(run.id);
  const states = runStates(run, detail, details, report, language);
  const summary = `<span class="run-title">${result(run.pass, t)}<span>${esc(fill(language, t.runTitle, { task: run.taskId, seed: run.seed, repeat: run.repeat }))}</span></span><span class="run-meta">${esc([fill(language, t.actionCount, { n: run.actions }), statusWords(run, t)].join(' · '))}</span>`;
  const parts: string[] = [];
  if (states.length) parts.push(`<h3>${esc(run.pass ? t.whatHappened : t.why)}</h3><ul class="reasons">${states.map(state => `<li><span class="state">${esc(state.name)}${state.why ? ':' : ''}</span>${state.why ? ` ${esc(state.why)}` : ''}${state.code ? `<code>${esc(state.code)}</code>` : ''}${state.tail ? esc(state.tail) : ''}${state.list?.length ? `<ul class="sublist">${state.list.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>`);
  if (detail) {
    parts.push(`<h3>${esc(t.conditions)}</h3>${conditionsHtml(detail, language)}`);
    if (detail.picture || detail.target || detail.targetMissing) parts.push(`<h3>${esc(t.board)}</h3>${boardHtml(detail, report, language)}`);
    parts.push(`<h3>${esc(t.trajectory)}</h3>${trajectoryHtml(detail, language)}`, `<h3>${esc(t.toolCalls)}</h3>${callsHtml(detail, language)}`);
  } else parts.push(`<p class="note">${esc(t.cardNoFolder)}</p>`);
  parts.push(clientHtml(run, language));
  // Identifiers and codes: under Technical details, never in the normal path.
  const facts: Array<[string, string]> = [[t.runId, run.id], [t.statusCode, run.status]];
  if (run.agentExitCode !== null) facts.push([t.exitCode, String(run.agentExitCode)]);
  if (run.note) facts.push([t.runNote, run.note]);
  if (detail?.rejected.length) facts.push([t.hostCodes, detail.rejected.map(([code, count]) => `${code} ×${count}`).join(', ')]);
  if (detail?.calls?.codes.length) facts.push([t.callCodes, detail.calls.codes.map(([code, count]) => `${code} ×${count}`).join(', ')]);
  if (detail?.traceError) facts.push([t.traceCode, detail.traceError]);
  for (const id of errorClassesOf(run)) { const explanation = explanationOf(run, id, detail, details, language); if (explanation && explanation !== firstSentence(explanation)) facts.push([fill(language, t.fullExplanation, { id }), explanation]); }
  parts.push(technical(t, facts));
  return `<details class="run" id="run-${esc(run.id)}"${opensByDefault(run) ? ' open' : ''}><summary>${summary}</summary><div class="run-body">${parts.join('')}</div></details>`;
}

export function renderHtml(report: BenchReport, tokensCss: string, language: Language = 'en', verification: Verification = 'consistency-checked', details?: ReportDetails): string {
  const t: Words = TEXT[language], s = report.summary, e = report.environment;
  const passHat = allRepeats(report, language), repeated = allRepeatsCount(report), efficiency = efficiencyText(report, language);
  const cards = [
    figure(t.passAt1, rateText(s.passed, s.runs, language), [fill(language, t.passedOf, { runs: fill(language, t.runCount, { n: s.runs }) }), ...(s.infraErrors ? [fill(language, t.infraIncluded, { n: s.infraErrors })] : [])].join(' · ')),
    ...(passHat && repeated ? [figure(fill(language, t.passHat, { k: report.settings.repeats }), rateText(repeated.all, repeated.instances, language), passHat)] : []),
    figure(t.meanActions, fixed(s.meanActions, 1, language), fill(language, t.whenPassed, { value: fixed(s.meanActionsPassed, 1, language) })),
    figure(t.efficiency, efficiency.value, efficiency.detail ? `${efficiency.detail} · ${t.efficiencyDirection}` : t.efficiencyDirection),
    figure(t.wall, seconds(s.meanWallMs, language)),
  ];
  const totals = clientTotals(report, language);
  const taskRows = s.byTask.map(task => [`<code>${esc(task.taskId)}</code>`, String(task.runs), esc(rateText(task.passed, task.runs, language)), esc(fixed(task.meanActions, 1, language)), esc(referenceCell(task.referenceActions, t)), task.referenceActions === null ? esc(t.noReference) : esc(fixed(task.efficiency, 2, language))]);
  const ordered = failuresFirst(report.runs);
  // Result first, so a stacked row on a phone leads with it (F2); error classes wrap.
  const runRows = ordered.map(run => [result(run.pass, t), `<a href="#run-${esc(run.id)}"><code>${esc(run.taskId)}</code></a>`, String(run.seed), String(run.repeat), esc(statusWords(run, t)), String(run.actions), String(run.rejectedActions), String(run.undos), String(run.resets), String(run.toolCalls.total), esc(seconds(run.wallMs, language)), esc(errorClassesOf(run).join(', ') || t.none)]);
  const ended = report.runs.filter(run => run.status !== 'completed');
  const endedList = (['agent_failed', 'timeout', 'infra_error'] as const).flatMap(status => { const count = ended.filter(run => run.status === status).length; return count ? [`${count} ${statusWords({ status } as BenchRun, t)}`] : []; });
  const folderReason = details === undefined || details.folder === 'missing' ? t.folderMissing : details.folder === 'world-changed' ? t.folderWorldChanged : details.folder === 'world-unreadable' ? t.folderWorldUnreadable : null;
  const partial = folderReason ? banner('unknown', t.partialTitle, `<p>${esc(folderReason)} ${esc(t.partialShown)}</p><p>${esc(t.partialFix)} <code>${esc(t.partialCommand)}</code></p>`) : '';
  const facts = [...provenance(report, language, verification), report.createdAt.slice(0, 10)];
  const kind = { builtin: t.kindBuiltin, preset: t.kindPreset, command: t.kindCommand }[report.agent.kind];
  const body = `<header>
<p class="eyebrow">${esc(t.title)}</p>
<h1>${esc(report.agent.name)}</h1>
<p class="headline">${esc(headlineResult(report, language).join(' · '))}</p>
${chips(t.provenance, facts)}
${isBenchReportV2(report) && report.label !== undefined ? `<p class="meta">${esc(`${t.label}: ${report.label}`)}</p>\n` : ''}${report.interrupted ? `<p class="meta">${esc(fill(language, t.interrupted, { runs: report.runs.length, planned: report.interrupted.plannedRuns }))}</p>\n` : ''}<p class="meta">${esc(sampleLine(report, language))}</p>
${ended.length ? `<p class="meta">${esc(fill(language, t.endedNote, { n: ended.length, list: endedList.join(', ') }))}</p>\n` : ''}</header>
<section aria-labelledby="summary"><h2 id="summary">${esc(t.summary)}</h2><dl class="figures ${cards.length === 5 ? 'n5' : 'n4'}">${cards.join('')}</dl>${totals ? `<p class="note">${esc(totals)}</p>` : ''}</section>
<section aria-labelledby="by-task"><h2 id="by-task">${esc(t.byTask)}</h2>${stackedTable(t.byTask, 'by-task', [{ text: t.task }, { text: t.runs, numeric: true }, { text: t.passed, numeric: true }, { text: t.actions, numeric: true }, { text: t.reference, numeric: true }, { text: t.efficiency, numeric: true }], taskRows)}</section>
<section aria-labelledby="runs"><h2 id="runs">${esc(t.runsHeading)}</h2>${stackedTable(t.runsHeading, 'runs', [{ text: t.result }, { text: t.task }, { text: t.seed, numeric: true }, { text: t.repeat, numeric: true }, { text: t.status }, { text: t.actions, numeric: true }, { text: t.rejected, numeric: true }, { text: t.undo, numeric: true }, { text: t.reset, numeric: true }, { text: t.calls, numeric: true }, { text: t.time, numeric: true }, { text: t.errors, wide: true }], runRows)}</section>
<section aria-labelledby="details"><h2 id="details">${esc(t.details)}</h2>${partial}${ordered.map(run => runHtml(run, report, details, language)).join('')}</section>
<section aria-labelledby="settings"><h2 id="settings">${esc(t.settings)}</h2><dl class="settings">
<dt>${esc(t.agent)}</dt><dd>${esc(report.agent.name)} (${esc(kind)})</dd>
<dt>${esc(t.runsLabel)}</dt><dd>${esc(planLine(report, language))}</dd>
<dt>${esc(t.verification)}</dt><dd>${esc(verification === 're-verified' ? (isBenchReportV2(report) ? t.reverifiedWorld : t.reverified) : t.consistency)}</dd>
<dt>${esc(t.isolation)}</dt><dd>${esc(isolationText(report, t))}</dd>
<dt>${esc(t.world)}</dt><dd>${esc(worldText(report, t))}</dd>
<dt>${esc(t.environment)}</dt><dd>${esc(`Practonaut ${e.practonaut} · Excalidraw ${e.excalidraw} · Node ${e.node} · ${e.os.platform} ${e.os.release} ${e.os.arch}`)}</dd>
</dl>${technical(t, technicalFacts(report, t))}<p class="note">${esc(t.note)}</p><p class="note">${esc(t.selfReported)}</p></section>`;
  return page(language, `${t.title}: ${report.agent.name}`, tokensCss, body);
}

export { sentence };
