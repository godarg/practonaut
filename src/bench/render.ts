/**
 * Rendering of a validated bench report: a plain terminal table and one static HTML page in
 * design system v1 (tokens.css inlined, no script, no external asset, CSP pinned to the inline
 * style's hash). Status is spelled out, never shown by colour alone.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isBenchReportV2, type BenchReport } from './report.ts';
import { readableText } from '../cli/output.ts';

type Language = 'en' | 'de';
const TEXT = {
  en: { title: 'Practonaut bench', agent: 'Agent', model: 'model', modelUnknown: 'not reported', mirrorOn: 'real Excalidraw mirror', mirrorOff: 'model only (no mirror)', summary: 'Summary', runs: 'runs', run1: 'run', passed: 'passed', seeds: 'seeds', seed1: 'seed', repeats: 'repeats', repeat1: 'repeat', tasks: 'tasks', task1: 'task', passAt1: 'pass@1', passHat: 'pass^{k}', meanActions: 'mean actions', meanActionsPassed: 'mean actions when passed', whenPassed: 'when passed: {value}', efficiency: 'efficiency vs reference', efficiencyDirection: '> 1 = fewer actions than the reference solution', passedOf: '{passed} of {runs} runs passed', infraIncluded: '{n} not judged (infrastructure), counted as not passed', passHatAll: 'all {k} repeats of a task and seed pass', wall: 'mean time per run', verification: 'Verification', interrupted: 'interrupted: {runs} of {planned} planned runs finished; the run in progress was not scored', consistency: 'consistency-checked, not re-verified: the verdicts in the file add up, but the runs were not re-judged (practonaut report --verify)', reverified: 're-verified: every judged run was re-judged by the checker from its artifacts', byTask: 'By task', task: 'task', actions: 'actions', reference: 'reference', run: 'run', seed: 'seed', repeat: 'repeat', result: 'result', pass: 'pass', fail: 'fail', status: 'agent exit', runsHeading: 'Runs', rejected: 'rejected', undo: 'undo', reset: 'reset', calls: 'host calls', selfReported: 'Not re-checked by report --verify: what the runner counted while the agent worked (rejected, undo, reset, host calls, time) and the agent exit status, and what the client said about itself (model, API key source).', errors: 'error classes', time: 'time', none: '—', environment: 'Environment', settings: 'Settings', note: 'How this is scored: after the agent stops, a separate checker process judges the host’s final session (its history replayed independently) and, with the mirror, the real Excalidraw export. The agent’s own output is never read for scoring. A model name is what the client reported about itself and is not verified. pass^k follows τ-bench: the chance that all k repeats of a task and seed pass.', commandLabel: 'Command', builtin: 'built-in baseline, no language model', tasksSeeds: '{plan}, timeout {timeout} s, at most {actions} act, undo or reset calls per run', isolation: 'Isolation', isolationBuiltin: 'built-in baseline: no language model, MCP only', isolationPreset: 'tool-restricted preset', isolationTemplate: 'template: tools not restricted by Practonaut', isolationUnrecorded: 'not recorded (bench/1)', world: 'World', worldLibrary: 'bundled library', worldOwn: 'own world', noReference: 'no reference', referencePartial: 'over {n} of {m} tasks with a validated reference', apiKeySource: 'API key source (client-reported)', keptEnv: 'Kept with --keep-env', label: 'Label', generated: 'Generated instances', reverifiedWorld: 're-verified: every judged run was re-judged by the checker from its artifacts, against the world stored with the runs', contentHash: 'Content hash (SHA-256)', modelClientAttested: 'client-attested', modelCommandOutput: 'from the command output' },
  de: { title: 'Practonaut-Bench', agent: 'Agent', model: 'Modell', modelUnknown: 'nicht gemeldet', mirrorOn: 'echte Excalidraw-Spiegelung', mirrorOff: 'nur Modell (keine Spiegelung)', summary: 'Übersicht', runs: 'Läufe', run1: 'Lauf', passed: 'bestanden', seeds: 'Seeds', seed1: 'Seed', repeats: 'Wiederholungen', repeat1: 'Wiederholung', tasks: 'Aufgaben', task1: 'Aufgabe', passAt1: 'pass@1', passHat: 'pass^{k}', meanActions: 'Aktionen im Mittel', meanActionsPassed: 'Aktionen im Mittel, wenn bestanden', whenPassed: 'wenn bestanden: {value}', efficiency: 'Effizienz gegenüber Referenz', efficiencyDirection: '> 1 = weniger Aktionen als die Referenzlösung', passedOf: '{passed} von {runs} Läufen bestanden', infraIncluded: '{n} nicht bewertet (Infrastruktur), zählen als nicht bestanden', passHatAll: 'alle {k} Wiederholungen einer Aufgabe mit einem Seed bestehen', wall: 'Zeit je Lauf im Mittel', verification: 'Prüfung', interrupted: 'abgebrochen: {runs} von {planned} geplanten Läufen beendet; der laufende Lauf wurde nicht bewertet', consistency: 'auf Stimmigkeit geprüft, nicht nachgerechnet: Die Urteile in der Datei gehen auf, die Läufe wurden aber nicht neu beurteilt (practonaut report --verify)', reverified: 'nachgerechnet: Jeder bewertete Lauf wurde vom Prüfer aus seinen Artefakten neu beurteilt', byTask: 'Nach Aufgabe', task: 'Aufgabe', actions: 'Aktionen', reference: 'Referenz', run: 'Lauf', seed: 'Seed', repeat: 'Wdh.', result: 'Ergebnis', pass: 'bestanden', fail: 'nicht bestanden', status: 'Agent-Ende', runsHeading: 'Läufe', rejected: 'abgelehnt', undo: 'Rückg.', reset: 'Neustart', calls: 'Host-Aufrufe', selfReported: 'Von report --verify nicht nachgeprüft: was der Runner zählte, während der Agent arbeitete (abgelehnt, Rückg., Neustart, Host-Aufrufe, Zeit), das Agent-Ende und die Selbstauskunft des Clients (Modell, Quelle des API-Schlüssels).', errors: 'Fehlerklassen', time: 'Zeit', none: '—', environment: 'Umgebung', settings: 'Einstellungen', note: 'So wird bewertet: Nach dem Ende des Agenten beurteilt ein getrennter Prüfprozess die letzte Sitzung des Hosts (ihre Historie unabhängig nachgerechnet) und, mit Spiegelung, den echten Excalidraw-Export. Die Ausgabe des Agenten fließt nie in die Bewertung ein. Ein Modellname ist die Selbstauskunft des Clients und nicht geprüft. pass^k folgt τ-bench: die Wahrscheinlichkeit, dass alle k Wiederholungen einer Aufgabe mit einem Seed bestehen.', commandLabel: 'Befehl', builtin: 'eingebaute Vergleichsbasis ohne Sprachmodell', tasksSeeds: '{plan}, Zeitlimit {timeout} s, höchstens {actions} Aufrufe von act, undo oder reset je Lauf', isolation: 'Isolation', isolationBuiltin: 'eingebaute Vergleichsbasis: kein Sprachmodell, nur MCP', isolationPreset: 'Voreinstellung mit eingeschränkten Werkzeugen', isolationTemplate: 'Vorlage: Werkzeuge nicht von Practonaut eingeschränkt', isolationUnrecorded: 'nicht erfasst (bench/1)', world: 'Welt', worldLibrary: 'mitgelieferte Bibliothek', worldOwn: 'eigene Welt', noReference: 'keine Referenz', referencePartial: 'über {n} von {m} Aufgaben mit geprüfter Referenz', apiKeySource: 'Quelle des API-Schlüssels (Angabe des Clients)', keptEnv: 'Mit --keep-env weitergegeben', label: 'Bezeichnung', generated: 'Erzeugte Instanzen', reverifiedWorld: 'nachgerechnet: Jeder bewertete Lauf wurde vom Prüfer aus seinen Artefakten neu beurteilt, mit der zusammen mit den Läufen gespeicherten Welt', contentHash: 'Inhalts-Hash (SHA-256)', modelClientAttested: 'Selbstauskunft des Clients', modelCommandOutput: 'aus der Ausgabe des Befehls' },
} as const;
type Words = { -readonly [K in keyof typeof TEXT.en]: string };

const fixed = (value: number | null, digits = 2): string => value === null ? '—' : value.toFixed(digits);
/** Report text is data from a file: control, format and bidi characters are shown escaped, never interpreted by a terminal. */
const shown = (value: string): string => readableText(value);
const counted = (language: Language, count: number, one: string, other: string): string => `${count} ${new Intl.PluralRules(language).select(count) === 'one' ? one : other}`;
/** `n = 6 runs · 1 seed · 2 repeats` */
function sampleLine(report: BenchReport, t: Words, language: Language): string {
  return `n = ${[counted(language, report.summary.runs, t.run1, t.runs), counted(language, report.settings.seeds.length, t.seed1, t.seeds), counted(language, report.settings.repeats, t.repeat1, t.repeats)].join(' · ')}`;
}
function planLine(report: BenchReport, t: Words, language: Language): string {
  return [counted(language, report.settings.tasks.length, t.task1, t.tasks), counted(language, report.settings.seeds.length, t.seed1, t.seeds), counted(language, report.settings.repeats, t.repeat1, t.repeats)].join(' × ');
}
const percent = (value: number): string => `${(value * 100).toFixed(1)} %`;
const seconds = (ms: number | null): string => ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`;
function fill(template: string, values: Record<string, string | number>): string { return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? '')); }
/** What Practonaut restricted about the agent's tools (bench/2); a /1 report did not record it. */
function isolationText(report: BenchReport, t: Words): string {
  if (!isBenchReportV2(report)) return t.isolationUnrecorded;
  return { 'builtin-baseline': t.isolationBuiltin, 'tool-restricted-preset': t.isolationPreset, 'template-unrestricted': t.isolationTemplate }[report.agent.isolation];
}
function worldText(report: BenchReport, t: Words): string {
  if (!isBenchReportV2(report)) return `${report.environment.library.worldId} ${report.environment.library.version}`;
  const world = report.environment.world;
  return `${world.worldId} ${world.version} (${world.source === 'library' ? t.worldLibrary : t.worldOwn})`;
}
/** bench/2 facts about the run's setting: isolation, world, generated instances, client-reported key source. */
function settingFacts(report: BenchReport, t: Words): Array<[label: string, value: string]> {
  if (!isBenchReportV2(report)) return [];
  const facts: Array<[string, string]> = [[t.isolation, isolationText(report, t)], [t.world, worldText(report, t)], [t.contentHash, report.environment.world.contentHash]];
  const generated = report.environment.world.generated;
  if (generated.length) facts.push([t.generated, generated.map(entry => `${entry.taskId} (${entry.id} ${entry.version}, seed ${entry.seed})`).join(', ')]);
  if (report.agent.apiKeySource !== null) facts.push([t.apiKeySource, report.agent.apiKeySource]);
  if (report.agent.keptEnv.length) facts.push([t.keptEnv, report.agent.keptEnv.join(', ')]);
  return facts;
}
/** The reported model and, for /2, where it came from (never verified). */
function modelText(report: BenchReport, t: Words): string {
  if (report.agent.model === null) return t.modelUnknown;
  if (!isBenchReportV2(report) || report.agent.modelSource === 'none') return report.agent.model;
  return `${report.agent.model} (${report.agent.modelSource === 'client-attested' ? t.modelClientAttested : t.modelCommandOutput})`;
}
const referenceCell = (value: number | null, t: Words): string => value === null ? t.noReference : String(value);
/** Efficiency only where a validated reference exists; otherwise "no reference". */
function efficiencyText(report: BenchReport, value: number | null, t: Words): { value: string; detail?: string } {
  const tasks = report.summary.byTask, referenced = tasks.filter(task => task.referenceActions !== null).length;
  if (!referenced) return { value: t.noReference };
  return referenced < tasks.length ? { value: fixed(value), detail: fill(t.referencePartial, { n: referenced, m: tasks.length }) } : { value: fixed(value) };
}

export function renderTable(report: BenchReport, language: Language = 'en'): string {
  const t: Words = TEXT[language], s = report.summary;
  const lines: string[] = [];
  lines.push(`${t.title}  ${shown(report.agent.name)}  ${report.agent.kind === 'builtin' ? t.builtin : `${t.model} ${shown(modelText(report, t))}`}  ${report.environment.mirror === 'required' ? t.mirrorOn : t.mirrorOff}`);
  if (isBenchReportV2(report) && report.label !== undefined) lines.push(`${t.label}: ${shown(report.label)}`);
  for (const [label, value] of settingFacts(report, t)) lines.push(shown(`${label}: ${value}`));
  lines.push(sampleLine(report, t, language));
  if (report.interrupted) lines.push(fill(t.interrupted, { runs: report.runs.length, planned: report.interrupted.plannedRuns }));
  lines.push(fill(t.tasksSeeds, { plan: planLine(report, t, language), timeout: report.settings.timeoutSeconds, actions: report.settings.maxActions }));
  lines.push('');
  lines.push(`${counted(language, s.runs, t.run1, t.runs)}, ${s.passed} ${t.passed} (${percent(s.passAt1)})${s.infraErrors ? `, ${fill(t.infraIncluded, { n: s.infraErrors })}` : ''}`);
  lines.push(`${t.passAt1} ${fixed(s.passAt1)}   ${s.passHatK.map(entry => `${fill(t.passHat, { k: entry.k })} ${fixed(entry.value)}`).join('   ')}`);
  lines.push(`${t.meanActions} ${fixed(s.meanActions, 1)}   ${t.meanActionsPassed} ${fixed(s.meanActionsPassed, 1)}   ${t.wall} ${seconds(s.meanWallMs)}`);
  const efficiency = efficiencyText(report, s.efficiencyVsReference, t);
  lines.push(`${t.efficiency} ${efficiency.value}${efficiency.detail ? `, ${efficiency.detail}` : ''}  (${t.efficiencyDirection})`);
  lines.push('');
  const header = [t.task, t.runs, t.passed, t.passAt1, t.actions, t.reference, t.efficiency];
  const rows = s.byTask.map(task => [shown(task.taskId), String(task.runs), String(task.passed), fixed(task.passAt1), fixed(task.meanActions, 1), referenceCell(task.referenceActions, t), task.referenceActions === null ? t.noReference : fixed(task.efficiency)]);
  const widths = header.map((head, column) => Math.max(head.length, ...rows.map(row => row[column]!.length)));
  const format = (row: string[]): string => row.map((cell, column) => column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)).join('  ');
  lines.push(format(header)); lines.push(widths.map(width => '─'.repeat(width)).join('  '));
  for (const row of rows) lines.push(format(row));
  return lines.join('\n') + '\n';
}

const escape = (value: string): string => readableText(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const STYLE = `
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:light dark}
body{margin:0;background:var(--pn-color-bg);color:var(--pn-color-text);font-family:var(--pn-font-sans);font-size:var(--pn-text-subhead);line-height:var(--pn-leading-subhead)}
.page{max-width:var(--pn-page-max);margin:0 auto;padding:var(--pn-space-10) var(--pn-gutter) var(--pn-space-16)}
.eyebrow{margin:0 0 var(--pn-space-2);font-size:var(--pn-text-caption);line-height:var(--pn-leading-caption);letter-spacing:.06em;text-transform:uppercase;color:var(--pn-color-text-secondary)}
h1{margin:0;font-size:var(--pn-text-title1);line-height:var(--pn-leading-title1);font-weight:700}
h2{margin:0 0 var(--pn-space-3);font-size:var(--pn-text-title3);line-height:var(--pn-leading-title3);font-weight:600}
.meta{margin:var(--pn-space-2) 0 0;color:var(--pn-color-text-secondary);font-size:var(--pn-text-footnote);line-height:var(--pn-leading-footnote)}
section{margin-top:var(--pn-space-10)}
.figures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--pn-space-3);margin:0}
.figures.n5 .figure:first-child{grid-column:1/-1}
@media (min-width:40rem){.figures.n4{grid-template-columns:repeat(4,minmax(0,1fr))}.figures.n5{grid-template-columns:repeat(6,minmax(0,1fr))}.figures.n5 .figure{grid-column:span 2}.figures.n5 .figure:nth-child(-n+2){grid-column:span 3}}
@media (min-width:60rem){.figures.n5{grid-template-columns:repeat(5,minmax(0,1fr))}.figures.n5 .figure,.figures.n5 .figure:nth-child(-n+2){grid-column:auto}}
.figure{background:var(--pn-color-surface);border:1px solid var(--pn-color-separator);border-radius:var(--pn-radius-md);padding:var(--pn-space-3) var(--pn-space-4)}
.figure dt{font-size:var(--pn-text-footnote);line-height:var(--pn-leading-footnote);color:var(--pn-color-text-secondary)}
.figure dd{margin:var(--pn-space-1) 0 0;font-size:var(--pn-text-title2);line-height:var(--pn-leading-title2);font-weight:600;font-variant-numeric:tabular-nums}
.figure dd.detail{font-size:var(--pn-text-footnote);line-height:var(--pn-leading-footnote);font-weight:400;color:var(--pn-color-text-secondary)}
.scroll:focus-visible{outline:var(--pn-focus-width) solid var(--pn-color-focus);outline-offset:var(--pn-focus-offset)}
.scroll{overflow-x:auto;border:1px solid var(--pn-color-separator);border-radius:var(--pn-radius-md);background:var(--pn-color-surface)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:var(--pn-space-2) var(--pn-space-3);text-align:right;white-space:nowrap;border-bottom:1px solid var(--pn-color-separator)}
th:first-child,td:first-child{text-align:left}
tbody tr:last-child td{border-bottom:0}
th{font-size:var(--pn-text-footnote);line-height:var(--pn-leading-footnote);font-weight:600;color:var(--pn-color-text-secondary)}
td.text{text-align:left}
.result{display:inline-flex;align-items:center;gap:var(--pn-space-1);font-weight:600}
.result.pass{color:var(--pn-color-success-fg)}
.result.fail{color:var(--pn-color-danger-fg)}
code{font-family:var(--pn-font-mono);font-size:var(--pn-text-footnote)}
.settings{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:var(--pn-space-1) var(--pn-space-4);font-size:var(--pn-text-footnote);line-height:var(--pn-leading-footnote)}
.settings dt{color:var(--pn-color-text-secondary)}
.settings dd{margin:0;overflow-wrap:anywhere;min-width:0}
.command{padding:var(--pn-space-2) var(--pn-space-3)}
.command code{white-space:pre}
.note{max-width:var(--pn-measure);color:var(--pn-color-text-secondary);font-size:var(--pn-text-footnote);line-height:var(--pn-leading-footnote)}
`;

/** design/tokens.css in a checkout, the player's copy in an installed package. */
export async function readTokensCss(): Promise<string> {
  const source = import.meta.url.endsWith('.ts');
  return readFile(fileURLToPath(new URL(source ? '../../design/tokens.css' : '../player/assets/tokens.css', import.meta.url)), 'utf8');
}

export function renderHtml(report: BenchReport, tokensCss: string, language: Language = 'en', verification: 'consistency-checked' | 're-verified' = 'consistency-checked'): string {
  const t: Words = TEXT[language], s = report.summary, e = report.environment;
  const result = (pass: boolean): string => `<span class="result ${pass ? 'pass' : 'fail'}"><span aria-hidden="true">${pass ? '✓' : '✗'}</span>${escape(pass ? t.pass : t.fail)}</span>`;
  // Each figure once, with its context as a second line: pass@1 carries the passed count, pass^k
  // only appears for k >= 2 (pass^1 is pass@1), mean actions carries the passed-only mean.
  const figure = (label: string, value: string, detail?: string): string => `<div class="figure"><dt>${escape(label)}</dt><dd>${escape(value)}</dd>${detail ? `<dd class="detail">${escape(detail)}</dd>` : ''}</div>`;
  const widest = s.passHatK[s.passHatK.length - 1]!;
  const cards = [
    figure(t.passAt1, fixed(s.passAt1), [fill(t.passedOf, { passed: s.passed, runs: s.runs }), ...(s.infraErrors ? [fill(t.infraIncluded, { n: s.infraErrors })] : [])].join(' · ')),
    ...(widest.k >= 2 ? [figure(fill(t.passHat, { k: widest.k }), fixed(widest.value), [fill(t.passHatAll, { k: widest.k }), ...s.passHatK.slice(1, -1).map(entry => `${fill(t.passHat, { k: entry.k })} ${fixed(entry.value)}`)].join(' · '))] : []),
    figure(t.meanActions, fixed(s.meanActions, 1), fill(t.whenPassed, { value: fixed(s.meanActionsPassed, 1) })),
    ((efficiency) => figure(t.efficiency, efficiency.value, efficiency.detail ? `${efficiency.detail} · ${t.efficiencyDirection}` : t.efficiencyDirection))(efficiencyText(report, s.efficiencyVsReference, t)),
    figure(t.wall, seconds(s.meanWallMs)),
  ];
  const figures = cards.join('');
  const taskRows = s.byTask.map(task => `<tr><td><code>${escape(task.taskId)}</code></td><td>${task.runs}</td><td>${task.passed}</td><td>${fixed(task.passAt1)}</td><td>${fixed(task.meanActions, 1)}</td><td>${escape(referenceCell(task.referenceActions, t))}</td><td>${task.referenceActions === null ? escape(t.noReference) : fixed(task.efficiency)}</td></tr>`).join('');
  const runRows = report.runs.map(run => `<tr><td><code>${escape(run.taskId)}</code></td><td>${run.seed}</td><td>${run.repeat}</td><td class="text">${result(run.pass)}</td><td>${run.actions}</td><td>${run.rejectedActions}</td><td>${run.undos}</td><td>${run.resets}</td><td>${run.toolCalls.total}</td><td>${seconds(run.wallMs)}</td><td class="text">${escape(run.status)}</td><td class="text">${escape([...new Set([...(run.checker?.session.errorClasses ?? []), ...(run.checker?.native?.errorClasses ?? [])])].join(', ') || t.none)}</td></tr>`).join('');
  const command = report.agent.command.length ? `<div class="scroll command" role="region" aria-label="${escape(t.commandLabel)}" tabindex="0"><code>${escape(report.agent.command.map(word => word === '' ? "''" : /\s/.test(word) ? `'${word}'` : word).join(' '))}</code></div>` : escape(t.builtin);
  const style = tokensCss + STYLE, hash = createHash('sha256').update(style).digest('base64');
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${escape(`${t.title}: ${report.agent.name}`)}</title>
<style>${style}</style>
</head>
<body>
<main class="page">
<header>
<p class="eyebrow">${escape(t.title)}</p>
<h1>${escape(report.agent.name)}</h1>
<p class="meta">${escape(sampleLine(report, t, language))}</p>
${isBenchReportV2(report) && report.label !== undefined ? `<p class="meta">${escape(`${t.label}: ${report.label}`)}</p>\n` : ''}${report.interrupted ? `<p class="meta">${escape(fill(t.interrupted, { runs: report.runs.length, planned: report.interrupted.plannedRuns }))}</p>\n` : ''}<p class="meta">${escape([report.createdAt.slice(0, 10), report.agent.kind === 'builtin' ? t.builtin : `${t.model}: ${modelText(report, t)}`, e.mirror === 'required' ? t.mirrorOn : t.mirrorOff].join(' · '))}</p>
</header>
<section aria-labelledby="summary"><h2 id="summary">${escape(t.summary)}</h2><dl class="figures n${cards.length}">${figures}</dl></section>
<section><h2 id="by-task">${escape(t.byTask)}</h2><div class="scroll" role="region" aria-labelledby="by-task" tabindex="0"><table><thead><tr><th scope="col">${escape(t.task)}</th><th scope="col">${escape(t.runs)}</th><th scope="col">${escape(t.passed)}</th><th scope="col">${escape(t.passAt1)}</th><th scope="col">${escape(t.actions)}</th><th scope="col">${escape(t.reference)}</th><th scope="col">${escape(t.efficiency)}</th></tr></thead><tbody>${taskRows}</tbody></table></div></section>
<section><h2 id="runs">${escape(t.runsHeading)}</h2><div class="scroll" role="region" aria-labelledby="runs" tabindex="0"><table><thead><tr><th scope="col">${escape(t.task)}</th><th scope="col">${escape(t.seed)}</th><th scope="col">${escape(t.repeat)}</th><th scope="col" class="text">${escape(t.result)}</th><th scope="col">${escape(t.actions)}</th><th scope="col">${escape(t.rejected)}</th><th scope="col">${escape(t.undo)}</th><th scope="col">${escape(t.reset)}</th><th scope="col">${escape(t.calls)}</th><th scope="col">${escape(t.time)}</th><th scope="col" class="text">${escape(t.status)}</th><th scope="col" class="text">${escape(t.errors)}</th></tr></thead><tbody>${runRows}</tbody></table></div></section>
<section aria-labelledby="settings"><h2 id="settings">${escape(t.settings)}</h2><dl class="settings">
<dt>${escape(t.agent)}</dt><dd>${escape(report.agent.name)} (${escape(report.agent.kind)})</dd>
<dt>${escape(t.commandLabel)}</dt><dd>${command}</dd>
<dt>${escape(t.runsHeading)}</dt><dd>${escape(fill(t.tasksSeeds, { plan: planLine(report, t, language), timeout: report.settings.timeoutSeconds, actions: report.settings.maxActions }))}</dd>
<dt>${escape(t.verification)}</dt><dd>${escape(verification === 're-verified' ? (isBenchReportV2(report) ? t.reverifiedWorld : t.reverified) : t.consistency)}</dd>
<dt>${escape(t.isolation)}</dt><dd>${escape(isolationText(report, t))}</dd>
${settingFacts(report, t).slice(2).map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>\n`).join('')}<dt>${escape(t.environment)}</dt><dd>${escape(`Practonaut ${e.practonaut} · Excalidraw ${e.excalidraw} · Node ${e.node} · ${e.os.platform} ${e.os.release} ${e.os.arch} · ${worldText(report, t)}`)}</dd>
</dl><p class="note">${escape(t.note)}</p><p class="note">${escape(t.selfReported)}</p></section>
</main>
</body>
</html>
`;
}
