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
import { isBenchReportV2, type BenchReport, type BenchRun } from './report.ts';
import { fill, TEXT } from './report-text.ts';
import type { Language } from './rates.ts';
import { errorClassesOf, headline, runStates, type State, type Verification } from './render.ts';
import type { ReportDetails } from './details.ts';

/** Text from a report, safe for XML 1.0 content and attributes: every control, format and private-use
 * character (readableText) and every lone surrogate becomes a visible escape; markup characters
 * become entity references. Newlines are not kept here: multi-line text is escaped line by line. */
export function xmlEscape(value: string): string {
  return readableText(value)
    .replace(/\p{Cs}/gu, char => `\\u{${char.charCodeAt(0).toString(16)}}`)
    .replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
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

function testcase(run: BenchRun, report: BenchReport, worldId: string, details: ReportDetails | undefined, language: Language): string {
  const t = TEXT[language];
  const head = `<testcase name="${token(`${run.taskId} seed ${run.seed} repeat ${run.repeat}`, run.id)}" classname="${token(`${worldId}.${run.taskId}.seed-${run.seed}`, run.taskId)}" time="${seconds(run.wallMs)}"`;
  if (run.pass) return `${head}/>`;
  const states = runStates(run, details?.runs.get(run.id), details, report, language);
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
function properties(report: BenchReport, verification: Verification): Array<[string, string]> {
  const v2 = isBenchReportV2(report);
  const world = v2 ? report.environment.world : { worldId: report.environment.library.worldId, version: report.environment.library.version, contentHash: report.environment.library.contentHash };
  const unjudged = report.runs.filter(run => run.checker === null).length;
  const facts: Array<[string, string]> = [
    ['practonaut.report', report.schema], ['practonaut.version', report.environment.practonaut], ['practonaut.created', report.createdAt],
    ['practonaut.verification', verification], ['practonaut.runs', String(report.runs.length)], ['practonaut.runs.passed', String(report.summary.passed)],
    ['practonaut.runs.unjudged', String(unjudged)], ['practonaut.agent', report.agent.name], ['practonaut.agent.kind', report.agent.kind],
    ['practonaut.isolation', v2 ? report.agent.isolation : 'not-recorded'], ['practonaut.mirror', report.environment.mirror],
    ['practonaut.world', `${world.worldId} ${world.version}`], ['practonaut.world.contentHash', world.contentHash],
    ['practonaut.plan', `tasks=${report.settings.tasks.length} seeds=${report.settings.seeds.length} repeats=${report.settings.repeats} maxActions=${report.settings.maxActions} timeoutSeconds=${report.settings.timeoutSeconds}`],
  ];
  if (report.agent.model !== null) facts.push(['practonaut.model.selfReported', report.agent.model], ['practonaut.model.source', report.agent.modelSource]);
  if (v2 && report.label !== undefined) facts.push(['practonaut.label', report.label]);
  if (report.interrupted) facts.push(['practonaut.interrupted', `${report.runs.length} of ${report.interrupted.plannedRuns} planned runs`]);
  return facts;
}

/** The JUnit XML of a validated report. `details` (the bench folder) names the unmet conditions; without
 * it a failure still names its error classes and says where the conditions are shown. */
export function renderJunit(report: BenchReport, language: Language = 'en', verification: Verification = 'consistency-checked', details?: ReportDetails): string {
  const t = TEXT[language];
  const worldId = isBenchReportV2(report) ? report.environment.world.worldId : report.environment.library.worldId;
  // The schema's timestamp has no fraction and no zone: the report's creation time, in UTC.
  const timestamp = report.createdAt.slice(0, 19);
  const props = properties(report, verification).map(([name, value]) => `<property name="${token(name, 'practonaut')}" value="${xmlEscape(value)}"/>`).join('\n      ');
  const header = [headline(report, language, verification).join(' · '), ...(report.interrupted ? [fill(language, t.interrupted, { runs: report.runs.length, planned: report.interrupted.plannedRuns })] : []), t.junitGate];
  const seedOrder = new Map(report.settings.seeds.map((seed, index) => [seed, index]));
  const suites = report.settings.tasks.map((taskId, index) => {
    const runs = report.runs.filter(run => run.taskId === taskId).sort((a, b) => (seedOrder.get(a.seed)! - seedOrder.get(b.seed)!) || a.repeat - b.repeat);
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
