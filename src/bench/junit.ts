/**
 * A bench report as JUnit XML, for CI systems that show test results (`bench --junit`, `report
 * --junit`). The format is the Apache Ant JUnit schema as published by Windy Road (JUnit.xsd of
 * github.com/windyroad/JUnit-Schema at commit 332b8f3f, Apache License 2.0), which most CI test views
 * read:
 *
 *   <testsuites>                           one <testsuite> per benched task, in plan order
 *     <testsuite name package id timestamp hostname tests failures errors time>
 *       <properties>                       n, isolation level, verification status, mirror, world …
 *       <testcase name classname time>     one per run, by seed (plan order) and repeat
 *         <failure message type>…          a judged run that did not pass: unmet conditions, error classes
 *         <error message type>…            a run without a verdict (not judged): counted as not passed
 *       <system-out>                       the report's header line; <system-err/> stays empty
 *
 * A run without a checker verdict is never a <failure> with an invented reason: JUnit's <error>
 * ("the test could not be evaluated") is what it is, and it still counts as not passed. It is not
 * <skipped> either: a skipped test did not run and is left out of a pass/fail count, while this run was
 * planned, ran and counts as not passed (every run counts). This file never writes <skipped>.
 *
 * Deterministic for the same report, language, verification level and bench folder: no clock, no host
 * name (the schema requires one; it is always `localhost`), times are the runner's wall times from
 * the report. Every string from a report or a bench folder (labels, names, board text, notes) is
 * escaped for XML, and characters XML 1.0 does not allow (controls, lone surrogates, U+FFFE/FFFF) are
 * written as visible `\u{…}` escapes, as the terminal output shows them.
 */
import { readableText } from '../cli/output.ts';
import { asView, type BenchReportView, type ReportInput, type ViewRun } from './view.ts';
import { fill, TEXT } from './report-text.ts';
import type { Language } from './rates.ts';
import { errorClassesOf, headline, runStates, statusWords, verificationFacts, type State, type VerificationInput } from './render.ts';
import type { ReportDetails } from './details.ts';
import { BENCH_SCHEMA_V3 } from './report.ts';

/** Text from a report, safe for XML 1.0 content and attributes: every control, format and private-use
 * character (readableText) and every lone surrogate becomes a visible escape; markup characters
 * become entity references. Newlines are not kept here: multi-line text is escaped line by line. */
export function xmlEscape(value: string): string {
  return displayText(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}
/** Text as it is shown: control, format and private-use characters and lone surrogates as visible
 * `\u{…}` escapes (idempotent: an escape is plain ASCII). What a reader sees, and what is measured. */
export function displayText(value: string): string {
  return readableText(value).replace(/\p{Cs}/gu, char => `\\u{${char.charCodeAt(0).toString(16)}}`);
}
/** An `xs:token` value: escaped, whitespace collapsed, never empty. */
const token = (value: string, fallback: string): string => xmlEscape(value).replace(/\s+/g, ' ').trim() || fallback;
const multiline = (lines: readonly string[]): string => lines.map(xmlEscape).join('\n');
const seconds = (ms: number): string => (ms / 1000).toFixed(3);

/** One reason line: "Name: why." (a reason that already ends a sentence keeps its own mark). */
function reasonLine(state: State): string {
  const text = state.why ? `${state.name}: ${state.why}${state.code ?? ''}${state.tail ?? ''}` : state.name;
  return /[.!?)]$/.test(text) ? text : `${text}.`;
}

function testcase(run: ViewRun, report: BenchReportView, worldId: string, details: ReportDetails | undefined, language: Language): string {
  const t = TEXT[language];
  const head = `<testcase name="${token(`${run.taskId} seed ${run.seed} repeat ${run.repeat}`, run.id)}" classname="${token(`${worldId}.${run.taskId}.seed-${run.seed}`, run.taskId)}" time="${seconds(run.wallMs)}"`;
  if (run.pass) return `${head}/>`;
  // An artifact-judged run has no session to explain it: how it ended and which file was judged (PADR-0044 decision 1).
  const states: State[] = run.verdictLevel === 'session' && report.verdictLevel === 'session' ? runStates(run, details?.runs.get(run.id), details, report, language)
    : [{ name: statusWords(run, t), why: run.verdictLevel === 'artifact' && run.checker ? { read: t.resultRead, absent: t.resultAbsent, unreadable: t.resultUnreadable }[run.checker.result] : run.checker === null ? t.stateUnjudgedWhy : '' }];
  // The message is one line; the body adds each reason's details (what each refusal meant), the run id and the runner's note.
  const reasonsOf = (ordered: readonly State[]): string[] => [...ordered.flatMap(state => [reasonLine(state), ...(state.list ?? []).map(item => `  ${item}`)]), fill(language, t.junitRun, { id: run.id }), ...(run.note ? [fill(language, t.junitNote, { note: run.note })] : [])];
  if (run.checker === null) {
    // No verdict: the run could not be judged. Said as an error, never as a failure with a reason.
    const lines = states.map(reasonLine);
    const body = reasonsOf(states);
    return `${head}><error type="no-verdict" message="${xmlEscape(lines.join(' ') || t.stateUnjudged)}">${multiline(body)}</error></testcase>`;
  }
  // A judged run that did not pass: the unmet conditions and error classes first, then the rest.
  const first = (state: State): number => state.name === t.stateUnmet ? 0 : state.name.startsWith(fill(language, t.stateErrorClass, { id: '' })) ? 1 : 2;
  const ordered = [...states].sort((a, b) => first(a) - first(b)), lines = ordered.map(reasonLine);
  const classes = errorClassesOf(run);
  const body = reasonsOf(ordered);
  return `${head}><failure type="${xmlEscape(classes.length ? classes.join(' ') : 'goal-not-met')}" message="${xmlEscape(lines.join(' ') || t.stateFailed)}">${multiline(body)}</failure></testcase>`;
}

/** The facts every suite carries (vision principle 4: n, isolation, verification travel with every surface). */
function properties(report: BenchReportView, verification: VerificationInput, language: Language): Array<[string, string]> {
  const v = verificationFacts(verification);
  const world = report.environment.world, app = report.environment.app;
  const unjudged = (report.runs as readonly ViewRun[]).filter(run => run.checker === null).length;
  const facts: Array<[string, string]> = [
    ['practonaut.report', report.readFrom], ['practonaut.version', report.environment.practonaut], ['practonaut.created', report.createdAt],
    ['practonaut.verdictLevel', report.verdictLevel],
    // Only a /3 report's --verify re-derives the client's own values from its bound stdout; a /1 or /2
    // report's stay self-reported (as its page says), so no property claims either.
    ['practonaut.verification', v.level], ...(v.level === 're-verified' && report.readFrom === BENCH_SCHEMA_V3 ? [['practonaut.verification.clientValues', v.claims ? 'not re-derived: the report\'s claims' : 're-derived'] as [string, string]] : []),
    ...(v.notRederived.length ? [['practonaut.verification.parsersNotShipped', v.notRederived.join(', ')] as [string, string]] : []), ...(v.preset === 'not-checked' ? [['practonaut.verification.preset', 'not checked'] as [string, string]] : []), ['practonaut.runs', String(report.runs.length)], ['practonaut.runs.passed', String(report.summary.passed)],
    ['practonaut.runs.unjudged', String(unjudged)], ['practonaut.agent', report.agent.name], ['practonaut.agent.kind', report.agent.kind],
    ['practonaut.isolation', report.agent.isolation ?? 'not-recorded'], ...(report.environment.mirror !== undefined ? [['practonaut.mirror', report.environment.mirror] as [string, string]] : []),
    ['practonaut.app', `${app.adapterId} ${app.version}`], ['practonaut.toolchain', report.toolchain.id],
    ...(report.toolchain.kind === 'foreign-mcp' ? [['practonaut.sandbox', TEXT[language].noSandbox] as [string, string]] : []),
    ['practonaut.world', `${world.worldId} ${world.version}`], ['practonaut.world.contentHash', world.contentHash],
    ['practonaut.plan', `tasks=${report.settings.tasks.length} seeds=${report.settings.seeds.length} repeats=${report.settings.repeats} maxActions=${report.settings.maxActions} timeoutSeconds=${report.settings.timeoutSeconds}`],
  ];
  if (report.agent.model !== null) facts.push(['practonaut.model.selfReported', report.agent.model], ['practonaut.model.source', report.agent.modelSource]);
  if (report.label !== undefined) facts.push(['practonaut.label', report.label]);
  if (report.interrupted) facts.push(['practonaut.interrupted', `${report.runs.length} of ${report.interrupted.plannedRuns} planned runs`]);
  return facts;
}

/** The JUnit XML of a validated report. `details` (the bench folder) names the unmet conditions; without
 * it a failure still names its error classes and says where the conditions are shown. */
export function renderJunit(input: ReportInput, language: Language = 'en', verification: VerificationInput = 'consistency-checked', details?: ReportDetails): string {
  const report = asView(input);
  const t = TEXT[language];
  const worldId = report.environment.world.worldId;
  // The schema's timestamp has no fraction and no zone: the report's creation time, in UTC.
  const timestamp = report.createdAt.slice(0, 19);
  const props = properties(report, verification, language).map(([name, value]) => `<property name="${token(name, 'practonaut')}" value="${xmlEscape(value)}"/>`).join('\n      ');
  const header = [headline(report, language, verification).join(' · '), ...(report.interrupted ? [fill(language, t.interrupted, { runs: report.runs.length, planned: report.interrupted.plannedRuns })] : []), t.junitGate];
  const seedOrder = new Map(report.settings.seeds.map((seed, index) => [seed, index]));
  const suites = report.settings.tasks.map((taskId, index) => {
    const runs = (report.runs as readonly ViewRun[]).filter(run => run.taskId === taskId).sort((a, b) => (seedOrder.get(a.seed)! - seedOrder.get(b.seed)!) || a.repeat - b.repeat);
    const errors = runs.filter(run => run.checker === null).length, failures = runs.filter(run => run.checker !== null && !run.pass).length;
    const time = seconds(runs.reduce((sum, run) => sum + run.wallMs, 0));
    return `  <testsuite name="${token(taskId, 'task')}" package="${token(worldId, 'world')}" id="${index}" timestamp="${timestamp}" hostname="localhost" tests="${runs.length}" failures="${failures}" errors="${errors}" time="${time}">
    <properties>
      ${props}
    </properties>
${runs.map(run => `    ${testcase(run, report, worldId, details, language)}`).join('\n')}
    <system-out>${multiline(header)}</system-out>
    <system-err></system-err>
  </testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>\n`;
}
