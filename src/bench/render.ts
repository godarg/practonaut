/**
 * Rendering of a validated bench report (PADR-0039 B): a terminal summary and one static HTML page in
 * design system v1 (tokens.css and report.css inlined into one hashed style; no script, no external
 * asset, no `data:` URI). The header line carries the fraction, a 95 % Wilson interval, the
 * verification status, mirror, isolation level and "self-reported" next to a model. Rates are
 * fractions; a percentage appears only where n allows it (rates.ts). Failures come first, each with
 * why it failed, its conditions over time, the board, an example target, the trajectory, the call log
 * and the client's own figures. Every text from a report or a bench folder is escaped; status is
 * spelled out, never shown by colour alone.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isBenchReportV2, type BenchReport, type BenchRun } from './report.ts';
import { readableText } from '../cli/output.ts';
import { aggregateInstance } from './stats.ts';
import { intervalPercent, number, rateText, type Language } from './rates.ts';
import { fill, TEXT, type Words } from './report-text.ts';
import type { ConditionDetail, ReportDetails, RunDetail, TrajectoryRow } from './details.ts';
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

/** Instances (task × seed) and how many passed: at least half of their judged runs passed; an
 * instance without a judged run counts as not passed (PADR-0039 B.1). */
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

/** The header line (PADR-0039 B.1), as its parts. */
export function headline(report: BenchReport, language: Language, verification: Verification): string[] {
  const t = TEXT[language], s = report.summary, instances = instanceOutcome(report.runs);
  const parts = instances.repeated
    ? [fill(language, t.headlineRuns, { fraction: rateText(s.passed, s.runs, language) }), fill(language, t.headlineInstances, { fraction: rateText(instances.passed, instances.instances, language) })]
    : [fill(language, t.headlinePassed, { fraction: rateText(s.passed, s.runs, language) })];
  if (instances.instances) {
    const interval = intervalPercent(instances.passed, instances.instances);
    parts.push(fill(language, t.interval, { low: interval.low, high: interval.high, instances: fill(language, t.instanceCount, { n: instances.instances }) }));
  } else parts.push(t.intervalNone);
  parts.push(verification === 're-verified' ? t.reverifiedShort : t.consistencyShort, report.environment.mirror === 'required' ? t.mirrorOn : t.mirrorOff, isolationText(report, t));
  if (report.agent.kind !== 'builtin') parts.push(modelHeadline(report, language));
  return parts;
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
const modelText = (report: BenchReport, t: Words): string => report.agent.model === null ? t.modelUnknown
  : report.agent.modelSource === 'client-attested' ? `${report.agent.model} (${t.modelClientAttested})`
    : report.agent.modelSource === 'command-output' ? `${report.agent.model} (${t.modelCommandOutput})` : report.agent.model;

/** bench/2 facts about the run's setting: world, generated instances, client-reported key source, kept names. */
function settingFacts(report: BenchReport, t: Words): Array<[label: string, value: string]> {
  if (!isBenchReportV2(report)) return [];
  const facts: Array<[string, string]> = [[t.world, worldText(report, t)], [t.contentHash, report.environment.world.contentHash]];
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
  return parts.length ? fill(language, t.clientTotals, { parts: parts.join(' · ') }) : null;
}
/** Failed runs first, each group in plan order. */
const failuresFirst = (runs: readonly BenchRun[]): BenchRun[] => [...runs.filter(run => !run.pass), ...runs.filter(run => run.pass)];
const statusWords = (run: BenchRun, t: Words): string => run.status === 'timeout' ? t.stateTimeout : run.status === 'agent_failed' ? t.stateAgentFailed : run.status === 'infra_error' ? t.stateUnjudged : '';
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

/** Why a run ended as it did, each state by name with its reason (PADR-0039 B.3). */
interface State { name: string; why: string; list?: string[] }
function runStates(run: BenchRun, detail: RunDetail | undefined, report: BenchReport, language: Language): State[] {
  const t = TEXT[language], states: State[] = [];
  if (run.status === 'timeout') states.push({ name: t.stateTimeout, why: fill(language, t.stateTimeoutWhy, { timeout: report.settings.timeoutSeconds }) });
  if (run.status === 'agent_failed') states.push({ name: t.stateAgentFailed, why: run.agentExitCode === null ? t.stateAgentNoStart : fill(language, t.stateAgentFailedWhy, { code: run.agentExitCode }) });
  if (run.status === 'infra_error') states.push({ name: t.stateUnjudged, why: fill(language, t.stateUnjudgedWhy, { note: run.note ?? 'infra_error' }) });
  if (run.status !== 'infra_error' && run.acceptedActions === 0) states.push({ name: t.stateEmpty, why: t.stateEmptyWhy });
  if (run.rejectedActions > 0) states.push({ name: t.stateRejected, why: fill(language, t.stateRejectedWhy, { n: run.rejectedActions, m: run.toolCalls.act }), list: (detail?.rejected ?? []).map(([code, count]) => `${fill(language, t.rejectCodes, { code, n: count })}${codeText(code, t) ? ` — ${codeText(code, t)}` : ''}`) });
  if (detail && detail.clients.length > 1) states.push({ name: t.stateClients, why: fill(language, t.stateClientsWhy, { n: detail.clients.length, names: detail.clients.join(', ') }) });
  const actionText = (number: number): string => detail?.trajectory?.find(row => row.number === number)?.text ?? '';
  for (const condition of detail?.conditions ?? []) {
    if (condition.met !== false) continue;
    const history = condition.history.kind === 'lost' && actionText(condition.history.action) ? fill(language, t.historyLostAction, { action: condition.history.action, text: actionText(condition.history.action) }) : historyText(condition.history, language);
    states.push({ name: t.stateUnmet, why: `${condition.text[language]} — ${history}` });
  }
  const explained = new Map((detail?.errors ?? []).map(error => [error.id, error.explanation[language]]));
  const classes = [...new Set([...(run.checker?.session.errorClasses ?? []), ...(run.checker?.native?.errorClasses ?? [])])];
  for (const id of classes) states.push({ name: `${t.stateErrorClass} ${id}`, why: explained.get(id) ?? '' });
  return states;
}

export function renderTable(report: BenchReport, language: Language = 'en', details?: ReportDetails, verification: Verification = 'consistency-checked'): string {
  const t = TEXT[language], s = report.summary, lines: string[] = [];
  lines.push(`${t.title}  ${shown(report.agent.name)}`);
  // The header line (PADR-0039 B.1): fraction, interval, verification, mirror, isolation, model.
  lines.push(shown(headline(report, language, verification).join(' · ')));
  if (isBenchReportV2(report) && report.label !== undefined) lines.push(`${t.label}: ${shown(report.label)}`);
  for (const [label, value] of settingFacts(report, t)) lines.push(shown(`${label}: ${value}`));
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
      lines.push(`✗ ${shown(run.id)}${statusWords(run, t) ? `  ${statusWords(run, t)}` : ''}`);
      for (const state of runStates(run, details?.runs.get(run.id), report, language)) {
        lines.push(shown(`    ${state.name}${state.why ? `: ${state.why}` : ''}`));
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

const result = (pass: boolean, t: Words): string => `<span class="result ${pass ? 'pass' : 'fail'}"><span aria-hidden="true">${pass ? '✓' : '✗'}</span>${esc(pass ? t.pass : t.fail)}</span>`;
const figure = (label: string, value: string, detail?: string): string => `<div class="figure"><dt>${esc(label)}</dt><dd>${esc(value)}</dd>${detail ? `<dd class="detail">${esc(detail)}</dd>` : ''}</div>`;

function conditionsHtml(detail: RunDetail, language: Language): string {
  const t = TEXT[language];
  const missing = (reason: RunDetail['conditionsMissing']): string => reason === 'changed' ? t.missingChanged : reason === 'unreadable' ? t.missingUnreadable : reason === 'not-judged' ? t.missingNotJudged : t.missingNotRecorded;
  if (!detail.conditions) return `<p class="note">${esc(fill(language, t.conditionsMissing, { reason: missing(detail.conditionsMissing) }))}</p>`;
  const items = detail.conditions.map(condition => {
    const status = condition.met === null ? `<span class="condition-status">${esc(t.conditionUnknown)}</span>` : `<span class="condition-status ${condition.met ? 'met' : 'unmet'}"><span aria-hidden="true">${condition.met ? '✓' : '✗'} </span>${esc(condition.met ? t.conditionMet : t.conditionUnmet)}</span>`;
    return `<li>${status} — ${esc(condition.text[language])} <span class="history">(${esc(historyText(condition.history, language))})</span>${condition.formal ? `<span class="formal">${esc(t.formal)}: ${esc(condition.formal[language])}</span>` : ''}</li>`;
  }).join('');
  const note = detail.traceError ? `<p class="note">${esc(fill(language, t.traceMissing, { code: detail.traceError }))}</p>` : detail.conditionsMissing ? `<p class="note">${esc(fill(language, t.conditionsMissing, { reason: missing(detail.conditionsMissing) }))}</p>` : '';
  return `<ol class="conditions">${items}</ol>${note}`;
}

/** One line per object of the judged state, every goal-relevant attribute in words, labels in full. */
export function objectLines(objects: readonly BoardObject[], language: Language): string[] {
  const t = TEXT[language], names = styleNames[language] as Record<string, string>;
  const quoted = (value: string): string => language === 'de' ? `„${value}“` : `“${value}”`;
  return objects.map(object => {
    if (object.kind === 'arrow') return fill(language, t.arrowLine, { from: object.from === null ? t.loose : quoted(object.from), to: object.to === null ? t.loose : quoted(object.to) });
    const geometry = fill(language, t.stepGeometry, { width: object.width, height: object.height, x: object.x, y: object.y });
    const style = object.shape === null ? [] : [names[object.shape] ?? object.shape, fill(language, t.stepLine, { stroke: names[object.stroke!] ?? object.stroke! }), object.fill === 'none' ? t.stepNoFill : fill(language, t.stepFill, { fill: names[object.fill!] ?? object.fill! })];
    const place = [...(object.frame !== null ? [fill(language, t.stepFrame, { name: quoted(object.frame) })] : []), ...(object.group !== null ? [`${t.group} ${object.group}`] : [])];
    return `${quoted(object.label)} — ${[...style, geometry, ...place].join(', ')}`;
  });
}

function boardHtml(detail: RunDetail, report: BenchReport, language: Language): string {
  const t = TEXT[language], picture = detail.picture;
  const reason = picture?.kind === 'schematic' ? { 'model-only': t.reasonModelOnly, 'no-picture': t.reasonNoPicture, 'picture-unreadable': t.reasonPictureUnreadable, 'picture-changed': t.reasonPictureChanged }[picture.reason] : '';
  const caption = picture?.kind === 'engine' ? fill(language, t.finalEngine, { version: report.environment.excalidraw }) : `${t.finalSchematic} ${reason}`;
  const legend: string[] = [];
  legend.push(`<p class="legend-title">${esc(t.groups)}</p>`);
  legend.push(detail.groups.length ? `<ul class="legend">${detail.groups.map(group => `<li>${esc(`${group.name}: ${group.members.map(member => `“${member}”`).join(', ')}`)}</li>`).join('')}</ul>` : `<p class="meta">${esc(t.noGroups)}</p>`);
  if (detail.objects.length) legend.push(`<p class="legend-title">${esc(t.objectsTitle)}</p><ul class="legend">${objectLines(detail.objects, language).map(line => `<li>${esc(line)}</li>`).join('')}</ul>`);
  if (detail.frames.length) legend.push(`<p class="legend-title">${esc(t.frames)}</p><ul class="legend">${detail.frames.map(frame => `<li>${esc(frame.members.length ? fill(language, t.frameMembers, { name: `“${frame.name}”`, members: frame.members.map(member => `“${member}”`).join(', ') }) : fill(language, t.emptyFrame, { name: `“${frame.name}”` }))}</li>`).join('')}</ul>`);
  const final = picture ? `<figure class="board-figure"><div class="board-scroll" role="region" tabindex="0" aria-label="${esc(t.finalBoard)}">${picture.markup}</div><figcaption><span class="figure-title">${esc(t.finalBoard)}</span>${esc(caption)}</figcaption>${legend.join('')}</figure>` : '';
  const target = detail.target ? `<figure class="board-figure"><div class="board-scroll" role="region" tabindex="0" aria-label="${esc(t.target)}">${detail.target}</div><figcaption><span class="figure-title">${esc(t.target)}</span>${esc(t.targetCaption)}</figcaption></figure>`
    : `<div class="board-figure"><p class="no-picture">${esc(detail.targetMissing === 'unreadable' ? t.targetUnreadable : t.noTarget)}</p></div>`;
  return `<div class="boards">${final}${target}</div>`;
}

function trajectoryHtml(detail: RunDetail, language: Language): string {
  const t = TEXT[language];
  if (!detail.trajectory) {
    const reason = detail.trajectoryMissing === 'changed' ? t.missingChanged : detail.trajectoryMissing === 'unreadable' ? t.missingUnreadable : t.missingNotRecorded;
    return `<p class="note">${esc(fill(language, t.trajectoryMissing, { reason }))}</p>`;
  }
  if (!detail.trajectory.length) return `<p class="note">${esc(t.trajectoryEmpty)}</p>`;
  const total = detail.conditions?.length ?? 0, byClient = detail.clients.length > 1;
  const row = (entry: TrajectoryRow): string => {
    const outcome = entry.outcome === 'accepted' ? fill(language, t.accepted, { step: entry.step }) : fill(language, t.rejectedAs, { code: entry.code ?? 'rejected' });
    const met = entry.met === null ? t.none : [fill(language, t.metAfter, { met: entry.met, total }), ...(entry.gained.length ? [fill(language, t.gained, { list: entry.gained.join(', ') })] : []), ...(entry.lost.length ? [fill(language, t.lost, { list: entry.lost.join(', ') })] : [])].join(' · ');
    return `<tr><td>${entry.number}</td>${byClient ? `<td class="text">${esc(entry.client ?? t.none)}</td>` : ''}<td class="text wrap"><code>${esc(entry.text)}</code></td><td class="text">${entry.outcome === 'accepted' ? '' : '<span aria-hidden="true">✗ </span>'}${esc(outcome)}</td><td class="text">${esc(met)}</td></tr>`;
  };
  return `<div class="scroll" role="region" tabindex="0" aria-label="${esc(t.trajectory)}"><table><thead><tr><th scope="col">${esc(t.trajectoryHead)}</th>${byClient ? `<th scope="col" class="text">${esc(t.trajectoryBy)}</th>` : ''}<th scope="col" class="text">${esc(t.trajectoryAction)}</th><th scope="col" class="text">${esc(t.trajectoryResult)}</th><th scope="col" class="text">${esc(t.trajectoryMet)}</th></tr></thead><tbody>${detail.trajectory.map(row).join('')}</tbody></table></div>`;
}

function callsHtml(detail: RunDetail, language: Language): string {
  const t = TEXT[language], calls = detail.calls;
  if (!calls) return `<p class="note">${esc(fill(language, t.callsMissing, { reason: detail.callsMissing === 'changed' ? t.missingChanged : detail.callsMissing === 'unreadable' ? t.missingUnreadable : t.callsMissingNone }))}</p>`;
  const lines = [fill(language, t.callsLine, { calls: calls.calls, bytes: `${number(calls.resultBytes / 1024, 1, language)} KB`, bridge: calls.bridgeMedianMs === null ? t.none : number(calls.bridgeMedianMs, 1, language), client: calls.clientMedianMs === null ? t.clientUnavailable : fill(language, t.clientMedian, { ms: number(calls.clientMedianMs, 1, language) }) }),
    fill(language, t.callsTools, { list: calls.byTool.map(([tool, count]) => `${tool} ${count}`).join(', ') || t.none })];
  if (calls.codes.length) lines.push(fill(language, t.callsCodes, { list: calls.codes.map(([code, count]) => `${code} ${count}`).join(', ') }));
  if (calls.dropped) lines.push(fill(language, t.callsDropped, { n: calls.dropped }));
  if (calls.omitted) lines.push(fill(language, t.callsOmitted, { n: calls.omitted }));
  return `${lines.map(line => `<p class="meta">${esc(line)}</p>`).join('')}<p class="note">${esc(t.callsNote)}</p>`;
}

function clientHtml(run: BenchRun, language: Language): string {
  if (!('client' in run) || !run.client) return '';
  const t = TEXT[language], client = run.client, parts: string[] = [];
  if (client.model) parts.push(fill(language, t.clientModel, { model: client.model }));
  if (client.turns !== null) parts.push(fill(language, t.turnsPart, { n: client.turns }));
  if (client.tokens) parts.push(fill(language, t.tokensPart, { input: number(client.tokens.input + client.tokens.cacheRead + client.tokens.cacheCreation, 0, language), output: number(client.tokens.output, 0, language) }));
  if (client.costUsd !== null) parts.push(fill(language, t.costPart, { cost: number(client.costUsd, 4, language) }));
  return `<h3>${esc(t.client)}</h3><p class="meta">${esc(fill(language, t.clientLine, { parts: parts.join(' · ') }))}</p>`;
}

function runHtml(run: BenchRun, report: BenchReport, details: ReportDetails | undefined, language: Language): string {
  const t = TEXT[language], detail = details?.runs.get(run.id);
  const states = runStates(run, detail, report, language);
  const summary = `${result(run.pass, t)} <span>${esc(fill(language, t.runTitle, { task: run.taskId, seed: run.seed, repeat: run.repeat }))}</span> · ${esc(fill(language, t.actionCount, { n: run.actions }))}${statusWords(run, t) ? ` · ${esc(statusWords(run, t))}` : ''}`;
  const parts: string[] = [];
  if (states.length) parts.push(`<h3>${esc(run.pass ? t.whatHappened : t.why)}</h3><ul class="reasons">${states.map(state => `<li><span class="state">${esc(state.name)}</span>${state.why ? ` — ${esc(state.why)}` : ''}${state.list?.length ? `<ul class="sublist">${state.list.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>`);
  if (detail) {
    parts.push(`<h3>${esc(t.conditions)}</h3>${conditionsHtml(detail, language)}`);
    if (detail.picture || detail.target || detail.targetMissing) parts.push(`<h3>${esc(t.board)}</h3>${boardHtml(detail, report, language)}`);
    parts.push(`<h3>${esc(t.trajectory)}</h3>${trajectoryHtml(detail, language)}`, `<h3>${esc(t.toolCalls)}</h3>${callsHtml(detail, language)}`);
  }
  parts.push(clientHtml(run, language));
  return `<details class="run" id="run-${esc(run.id)}"${run.pass ? '' : ' open'}><summary>${summary}</summary><div class="run-body">${parts.join('')}</div></details>`;
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
  const taskRows = s.byTask.map(task => `<tr><td><code>${esc(task.taskId)}</code></td><td>${task.runs}</td><td>${esc(rateText(task.passed, task.runs, language))}</td><td>${esc(fixed(task.meanActions, 1, language))}</td><td>${esc(referenceCell(task.referenceActions, t))}</td><td>${task.referenceActions === null ? esc(t.noReference) : esc(fixed(task.efficiency, 2, language))}</td></tr>`).join('');
  const ordered = failuresFirst(report.runs);
  const runRows = ordered.map(run => `<tr><td><a href="#run-${esc(run.id)}"><code>${esc(run.taskId)}</code></a></td><td>${run.seed}</td><td>${run.repeat}</td><td class="text">${result(run.pass, t)}</td><td>${run.actions}</td><td>${run.rejectedActions}</td><td>${run.undos}</td><td>${run.resets}</td><td>${run.toolCalls.total}</td><td>${esc(seconds(run.wallMs, language))}</td><td class="text">${esc(run.status)}</td><td class="text">${esc([...new Set([...(run.checker?.session.errorClasses ?? []), ...(run.checker?.native?.errorClasses ?? [])])].join(', ') || t.none)}</td></tr>`).join('');
  const command = report.agent.command.length ? `<div class="scroll command" role="region" aria-label="${esc(t.commandLabel)}" tabindex="0"><code>${esc(report.agent.command.map(word => word === '' ? "''" : /\s/.test(word) ? `'${word}'` : word).join(' '))}</code></div>` : esc(t.builtin);
  const folderReason = details === undefined || details.folder === 'missing' ? t.folderMissing : details.folder === 'world-changed' ? t.folderWorldChanged : details.folder === 'world-unreadable' ? t.folderWorldUnreadable : null;
  const body = `<header>
<p class="eyebrow">${esc(t.title)}</p>
<h1>${esc(report.agent.name)}</h1>
<p class="headline">${esc(headline(report, language, verification).join(' · '))}</p>
${isBenchReportV2(report) && report.label !== undefined ? `<p class="meta">${esc(`${t.label}: ${report.label}`)}</p>\n` : ''}${report.interrupted ? `<p class="meta">${esc(fill(language, t.interrupted, { runs: report.runs.length, planned: report.interrupted.plannedRuns }))}</p>\n` : ''}<p class="meta">${esc([report.createdAt.slice(0, 10), sampleLine(report, language), report.agent.kind === 'builtin' ? t.builtin : `${t.model}: ${modelText(report, t)}`].join(' · '))}</p>
</header>
<section aria-labelledby="summary"><h2 id="summary">${esc(t.summary)}</h2><dl class="figures ${cards.length === 5 ? 'n5' : 'n4'}">${cards.join('')}</dl>${totals ? `<p class="note">${esc(totals)}</p>` : ''}</section>
<section aria-labelledby="by-task"><h2 id="by-task">${esc(t.byTask)}</h2><div class="scroll" role="region" aria-labelledby="by-task" tabindex="0"><table><thead><tr><th scope="col">${esc(t.task)}</th><th scope="col">${esc(t.runs)}</th><th scope="col">${esc(t.passed)}</th><th scope="col">${esc(t.actions)}</th><th scope="col">${esc(t.reference)}</th><th scope="col">${esc(t.efficiency)}</th></tr></thead><tbody>${taskRows}</tbody></table></div></section>
<section aria-labelledby="runs"><h2 id="runs">${esc(t.runsHeading)}</h2><div class="scroll" role="region" aria-labelledby="runs" tabindex="0"><table><thead><tr><th scope="col">${esc(t.task)}</th><th scope="col">${esc(t.seed)}</th><th scope="col">${esc(t.repeat)}</th><th scope="col" class="text">${esc(t.result)}</th><th scope="col">${esc(t.actions)}</th><th scope="col">${esc(t.rejected)}</th><th scope="col">${esc(t.undo)}</th><th scope="col">${esc(t.reset)}</th><th scope="col">${esc(t.calls)}</th><th scope="col">${esc(t.time)}</th><th scope="col" class="text">${esc(t.status)}</th><th scope="col" class="text">${esc(t.errors)}</th></tr></thead><tbody>${runRows}</tbody></table></div></section>
<section aria-labelledby="details"><h2 id="details">${esc(t.details)}</h2>${folderReason ? `<p class="note">${esc(fill(language, t.detailsMissing, { reason: folderReason }))}</p>` : ''}${ordered.map(run => runHtml(run, report, details, language)).join('')}</section>
<section aria-labelledby="settings"><h2 id="settings">${esc(t.settings)}</h2><dl class="settings">
<dt>${esc(t.agent)}</dt><dd>${esc(report.agent.name)} (${esc(report.agent.kind)})</dd>
<dt>${esc(t.commandLabel)}</dt><dd>${command}</dd>
<dt>${esc(t.runs)}</dt><dd>${esc(planLine(report, language))}</dd>
<dt>${esc(t.verification)}</dt><dd>${esc(verification === 're-verified' ? (isBenchReportV2(report) ? t.reverifiedWorld : t.reverified) : t.consistency)}</dd>
<dt>${esc(t.isolation)}</dt><dd>${esc(isolationText(report, t))}</dd>
${settingFacts(report, t).slice(1).map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>\n`).join('')}<dt>${esc(t.environment)}</dt><dd>${esc(`Practonaut ${e.practonaut} · Excalidraw ${e.excalidraw} · Node ${e.node} · ${e.os.platform} ${e.os.release} ${e.os.arch} · ${worldText(report, t)}`)}</dd>
</dl><p class="note">${esc(t.note)}</p><p class="note">${esc(t.selfReported)}</p></section>`;
  return page(language, `${t.title}: ${report.agent.name}`, tokensCss, body);
}
