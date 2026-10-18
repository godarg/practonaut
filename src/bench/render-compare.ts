/**
 * `practonaut compare` output (PADR-0039 C): whether there is an instance regression, the rate verdict
 * with its counts and exact p, each side's instance rate with its interval and provenance, instance
 * regressions and fixes, other flips, runs that were not judged, instances that were not compared and
 * why, and the differences that do not refuse a comparison. Terminal and one static HTML page in
 * design system v1, like the report; two reports that cannot be compared get a page that names every
 * difference. Text from the reports is escaped.
 */
import { agentKindDiffers, isolationOf, levelsDiffer, type Comparison, type Difference, type InstancePair } from './compare.ts';
import { intervalPercent, number, rateText, type Language } from './rates.ts';
import { fill, sentence, TEXT, type Words } from './report-text.ts';
import { banner, chips, escapeHtml as esc, levelText, modelHeadline, noSandbox, page, prose, stackedTable, statusIcon, type Verification } from './render.ts';
import { asView, type BenchReportView, type ReportInput } from './view.ts';
import { readableText } from '../cli/output.ts';

/** One side: its report (read through the view, any version), how it was verified and the name it goes by (label or file name). */
export interface CompareInput { report: ReportInput; verification: Verification; name?: string }
interface Side { report: BenchReportView; verification: Verification; name?: string }
const toSide = (input: CompareInput): Side => ({ ...input, report: asView(input.report) });

const nameOf = (input: Side): string => input.name ?? input.report.label ?? input.report.agent.name;
const heading = (baseline: Side, candidate: Side, language: Language): string => fill(language, TEXT[language].compareHeading, { baseline: nameOf(baseline), candidate: nameOf(candidate) });
const pValue = (p: number, language: Language): string => p < 0.001 ? '< 0.001' : number(p, 3, language);
function verdictText(comparison: Comparison, language: Language): string {
  const t = TEXT[language], values = { p: pValue(comparison.p, language), b: comparison.discordant.baselineOnly, c: comparison.discordant.candidateOnly };
  return fill(language, { improvement: t.verdictImprovement, decline: t.verdictDecline, not_distinguishable: t.verdictNone, nothing_paired: t.verdictNothing, no_equal_runs: t.verdictNoEqualRuns }[comparison.verdict], values);
}
/** A difference's values in words where they are levels (PADR-0044 decision 1); others as recorded. */
const differenceValue = (difference: Difference, value: string, language: Language): string => difference.field === 'verdictLevel' && (value === 'session' || value === 'artifact') ? levelText(value, language) : value;
/** Whether there is an instance regression, in one phrase. */
const regressionText = (comparison: Comparison, language: Language): string => {
  const t = TEXT[language];
  // Across worlds no flip is a regression (PADR-0044 decision 3): said as such, never as too few repeats.
  if (comparison.pairing === 'identity') return t.regressionsIdentity;
  return comparison.regressions.length ? fill(language, t.regressionCount, { n: comparison.regressions.length }) : comparison.regressionSignal ? t.regressionsNone : t.regressionsSingle;
};
function sideText(side: Comparison['baseline'], language: Language): string {
  const t = TEXT[language];
  if (!side.instances) return t.intervalNone;
  const interval = intervalPercent(side.passed, side.instances);
  return `${fill(language, t.sideRate, { fraction: rateText(side.passed, side.instances, language), low: interval.low, high: interval.high })} ${fill(language, t.pairedOver, { n: side.instances })}`;
}
/** What travels with each side (vision §6 principle 4): agent, label, model with its source, mirror,
 * isolation level, verification status and date. */
function sideFacts(input: Side, t: Words, language: Language): string[] {
  const report = input.report;
  // A built-in has no model: its isolation chip already says "no language model", once.
  const model = report.agent.kind === 'builtin' ? [] : [modelHeadline(report, language)];
  const isolation = { 'builtin-baseline': t.isolationBuiltin, 'tool-restricted-preset': t.isolationPreset, 'template-unrestricted': t.isolationTemplate }[isolationOf(report)];
  const mirror = report.verdictLevel === 'artifact' ? [] : [report.environment.mirror === 'required' ? t.mirrorOn : t.mirrorOff];
  return [report.agent.name, ...(report.label !== undefined ? [report.label] : []), levelText(report.verdictLevel, language), ...model, ...mirror, isolation, ...noSandbox(report, language), input.verification === 're-verified' ? t.reverifiedShort : t.consistencyShort, report.createdAt.slice(0, 10)];
}
/** The side of a flip that had no verdict at all (every run unjudged), if any: it did not fail, it was
 * not judged, and it counts as not passed. */
const noVerdictSide = (pair: InstancePair): 'baseline' | 'candidate' | null => {
  const down = pair.flip === 'single-down' || pair.flip === 'changed-down', up = pair.flip === 'single-up' || pair.flip === 'changed-up';
  return down && pair.candidate!.judged === 0 ? 'candidate' : up && pair.baseline!.judged === 0 ? 'baseline' : null;
};
/** How a pair is named: its task and seed, or across worlds each side's task ids and seeds. */
const pairName = (pair: InstancePair, language: Language): { task: string; seed: string | number } => {
  if (!pair.names) return { task: pair.taskId, seed: pair.seed };
  const none = TEXT[language].none, side = (names: string[]): string => names.join(', ') || none;
  return { task: fill(language, TEXT[language].identityNames, { baseline: side(pair.names.baseline), candidate: side(pair.names.candidate) }), seed: '' };
};
const flipLine = (pair: InstancePair, language: Language): string => {
  const t = TEXT[language], b = pair.baseline!, c = pair.candidate!;
  const values = { ...pairName(pair, language), bp: b.passed, bn: b.judged, br: b.repeats, bu: b.unjudged, cp: c.passed, cn: c.judged, cr: c.repeats, cu: c.unjudged };
  const missing = noVerdictSide(pair);
  if (missing) return identityLine(fill(language, missing === 'candidate' ? t.noVerdictDown : t.noVerdictUp, values), pair);
  const line = { regression: t.regressionLine, fix: t.fixLine, 'single-down': t.singleDown, 'single-up': t.singleUp, 'changed-down': t.changedDown, 'changed-up': t.changedUp, 'config-down': t.configDown, 'config-up': t.configUp }[pair.flip ?? 'single-up'];
  return identityLine(fill(language, line, values), pair);
};
/** Across worlds a row names both sides' task ids and seeds, not one task and seed. */
const identityLine = (line: string, pair: InstancePair): string => pair.names ? line.replace(/ · (?:seed|Seed) :/u, ':') : line;
const sideName = (side: InstancePair['side'], t: Words): string => side === 'baseline' ? t.sideBaseline : side === 'candidate' ? t.sideCandidate : t.sideBoth;
const notComparedLine = (pair: InstancePair, language: Language): string => identityLine(fill(language, TEXT[language].missingSide, { ...pairName(pair, language), side: sideName(pair.side, TEXT[language]) }), pair);
/** One line per side of a paired instance that holds runs that were not judged. */
const unjudgedLines = (pair: InstancePair, language: Language): string[] => {
  const t = TEXT[language];
  return (['baseline', 'candidate'] as const).flatMap(side => pair[side]!.unjudged ? [identityLine(fill(language, t.unjudgedLine, { ...pairName(pair, language), n: pair[side]!.unjudged, side: sideName(side, t) }), pair)] : []);
};
const caveatLine = (caveat: Comparison['caveats'][number], language: Language): string => {
  const t = TEXT[language];
  const field = { timeout: t.caveatTimeout, repeats: t.caveatRepeats, practonaut: t.caveatPractonaut, reportVersion: t.caveatReportVersion, isolationBasis: t.caveatIsolationBasis, toolchain: t.caveatToolchain, rules: t.caveatRules, clientVersion: t.caveatClientVersion, clientSettings: t.caveatClientSettings, sharedIdentities: t.caveatSharedIdentities, runCounts: t.caveatRunCounts, identityPairing: t.caveatIdentityPairing }[caveat.field];
  return fill(language, t.caveatLine, { field, baseline: caveat.baseline, candidate: caveat.candidate });
};
const rulesText = (comparison: Comparison, t: Words): string => comparison.pairing === 'identity' ? t.compareRulesIdentity : t.compareRules;

export function renderCompareTable(baselineInput: CompareInput, candidateInput: CompareInput, comparison: Comparison, language: Language = 'en'): string {
  const baseline = toSide(baselineInput), candidate = toSide(candidateInput);
  const t = TEXT[language], lines: string[] = [];
  lines.push(readableText(`${t.compareTitle}  ${heading(baseline, candidate, language)}`));
  lines.push(readableText(`${t.baseline}: ${sideFacts(baseline, t, language).join(' · ')}`), readableText(`${t.candidate}: ${sideFacts(candidate, t, language).join(' · ')}`), '');
  lines.push(`${t.compareSummary}: ${verdictText(comparison, language)}`);
  lines.push(`  ${t.baseline}: ${sideText(comparison.baseline, language)}`, `  ${t.candidate}: ${sideText(comparison.candidate, language)}`, '');
  lines.push(`${t.regressions}:${comparison.regressions.length ? '' : ` ${regressionText(comparison, language)}`}`);
  for (const pair of comparison.regressions) lines.push(readableText(`  ✗ ${flipLine(pair, language)}`));
  if (comparison.fixes.length) { lines.push(`${t.fixes}:`); for (const pair of comparison.fixes) lines.push(readableText(`  ✓ ${flipLine(pair, language)}`)); }
  // A flip that rests on a side without any verdict is listed with the runs not judged ("?"), as on the page.
  const changed = comparison.changedFlips.filter(pair => !noVerdictSide(pair)), single = comparison.singleFlips.filter(pair => !noVerdictSide(pair));
  if (changed.length) { lines.push(`${t.changedFlips}:`); for (const pair of changed) lines.push(readableText(`  ${flipLine(pair, language)}`)); }
  const config = comparison.configFlips.filter(pair => !noVerdictSide(pair));
  if (config.length) { lines.push(`${t.configFlips}:`); for (const pair of config) lines.push(readableText(`  ${flipLine(pair, language)}`)); }
  if (single.length) { lines.push(`${t.singleFlips}:`); for (const pair of single) lines.push(readableText(`  ${flipLine(pair, language)}`)); }
  if (comparison.withUnjudged.length) { lines.push(`${t.unjudgedHeading}:`); for (const pair of comparison.withUnjudged) for (const line of noVerdictSide(pair) ? [flipLine(pair, language)] : unjudgedLines(pair, language)) lines.push(readableText(`  ? ${line}`)); }
  if (comparison.notCompared.length) { lines.push(`${t.notCompared}:`); for (const pair of comparison.notCompared) lines.push(readableText(`  ${notComparedLine(pair, language)}`)); }
  if (comparison.incomplete.length) lines.push(`${t.incompleteTitle}: ${fill(language, t.incompleteBody, { n: comparison.incomplete.length })}`);
  if (comparison.caveats.length) { lines.push(`${t.caveats}:`); for (const caveat of comparison.caveats) lines.push(readableText(`  ${caveatLine(caveat, language)}`)); }
  lines.push('', `${t.rulesHeading}: ${rulesText(comparison, t)}`);
  return lines.join('\n') + '\n';
}

/** An instance's outcome on one side: pass or fail with passed/all repeats, and its unjudged runs; no
 * verdict at all when none of its runs was judged. */
const outcome = (aggregate: InstancePair['baseline'], t: Words, language: Language): string => {
  if (aggregate === null) return t.outcomeMissing;
  if (aggregate.repeats > 0 && aggregate.judged === 0) return fill(language, t.outcomeNoVerdict, { u: aggregate.unjudged, n: aggregate.repeats });
  const shown = fill(language, aggregate.outcome === 'pass' ? t.outcomePass : t.outcomeFail, { p: aggregate.passed, n: aggregate.repeats });
  return aggregate.unjudged ? fill(language, t.outcomeUnjudged, { outcome: shown, u: aggregate.unjudged }) : shown;
};
/** The same outcome as a table cell: its status mark (pass, fail, or the unknown mark) beside the words. */
const outcomeCell = (aggregate: InstancePair['baseline'], t: Words, language: Language): string => {
  const kind = aggregate === null ? null : aggregate.judged === 0 ? 'unknown' : aggregate.outcome === 'pass' ? 'pass' : 'fail';
  return `<span class="outcome">${kind ? statusIcon(kind) : ''}${esc(outcome(aggregate, t, language))}</span>`;
};
type Mark = 'pass' | 'fail' | 'unknown' | undefined;
// (A list item may carry its own mark: [text, mark].)
const list = (items: ReadonlyArray<string | [string, Mark]>, mark?: Mark, ids: readonly string[] = []): string => `<ul class="flips">${items.map(item => { const [text, own] = typeof item === 'string' ? [item, mark] : item; return `<li>${own ? statusIcon(own) : ''}<span>${prose(text, ids)}</span></li>`; }).join('')}</ul>`;
const side = (title: string, input: Side, rate: Comparison['baseline'], t: Words, language: Language): string => `<div class="figure"><dt>${esc(title)}</dt><dd>${esc(rate.instances ? rateText(rate.passed, rate.instances, language) : t.none)}</dd><dd class="detail">${esc(sideText(rate, language))}</dd><dd class="detail">${chips(title, sideFacts(input, t, language))}</dd></div>`;

export function renderCompareHtml(baselineInput: CompareInput, candidateInput: CompareInput, comparison: Comparison, tokensCss: string, language: Language = 'en'): string {
  const baseline = toSide(baselineInput), candidate = toSide(candidateInput);
  const t = TEXT[language];
  const flipWord = (pair: InstancePair): string => noVerdictSide(pair) ? t.flipNoVerdict : pair.flip === 'regression' ? t.flipRegression : pair.flip === 'fix' ? t.flipFix : pair.flip === 'changed-down' || pair.flip === 'changed-up' ? t.flipChanged : pair.flip === 'config-down' || pair.flip === 'config-up' ? t.flipConfig : pair.flip ? t.flipSingle : t.flipNone;
  const rows = comparison.pairs.map(pair => [pair.names ? prose(pairName(pair, language).task, [...pair.names.baseline, ...pair.names.candidate]) : `<code>${esc(pair.taskId)}</code> · ${pair.seed}`, outcomeCell(pair.baseline, t, language), outcomeCell(pair.candidate, t, language), esc(pair.kind === 'paired' ? flipWord(pair) : notComparedLine(pair, language))]);
  const ids = comparison.pairs.map(pair => pair.taskId);
  // A flip that rests on a side without any verdict is not a change of outcome: it is listed with the
  // runs not judged, under the unknown mark (it did not fail; it was not judged).
  const flips = (pairs: readonly InstancePair[]): string[] => pairs.filter(pair => !noVerdictSide(pair)).map(pair => flipLine(pair, language));
  const unjudged = comparison.withUnjudged.flatMap(pair => noVerdictSide(pair) ? [flipLine(pair, language)] : unjudgedLines(pair, language));
  const sections: string[] = [];
  if (comparison.fixes.length) sections.push(`<h3>${esc(t.fixes)}</h3>${list(comparison.fixes.map(pair => flipLine(pair, language)), 'pass', ids)}`);
  if (flips(comparison.changedFlips).length) sections.push(`<h3>${esc(t.changedFlips)}</h3>${list(flips(comparison.changedFlips), undefined, ids)}`);
  if (flips(comparison.configFlips).length) sections.push(`<h3>${esc(t.configFlips)}</h3>${list(flips(comparison.configFlips), undefined, ids)}`);
  if (flips(comparison.singleFlips).length) sections.push(`<h3>${esc(t.singleFlips)}</h3>${list(flips(comparison.singleFlips), undefined, ids)}`);
  if (unjudged.length) sections.push(`<h3>${esc(t.unjudgedHeading)}</h3>${list(unjudged, 'unknown', ids)}`);
  if (comparison.notCompared.length) sections.push(`<h3>${esc(t.notCompared)}</h3>${list(comparison.notCompared.map(pair => notComparedLine(pair, language)), undefined, ids)}`);
  const body = `<header>
<p class="eyebrow">${esc(t.compareTitle)}</p>
<h1>${esc(heading(baseline, candidate, language))}</h1>
<p class="headline">${esc(sentence(regressionText(comparison, language)))}</p>
<p class="verdict">${esc(sentence(verdictText(comparison, language)))}</p>
</header>
${comparison.incomplete.length ? banner('warning', t.incompleteTitle, `<p>${esc(fill(language, t.incompleteBody, { n: comparison.incomplete.length }))}</p>`) : ''}
<section aria-labelledby="sides"><h2 id="sides">${esc(t.compareSides)}</h2><dl class="sides">${side(t.baseline, baseline, comparison.baseline, t, language)}${side(t.candidate, candidate, comparison.candidate, t, language)}</dl></section>
<section aria-labelledby="regressions"><h2 id="regressions">${esc(t.regressions)}</h2>${comparison.regressions.length ? list(comparison.regressions.map(pair => flipLine(pair, language)), 'fail', ids) : `<p class="lead">${esc(sentence(regressionText(comparison, language)))}</p>`}${sections.join('')}</section>
<section aria-labelledby="instances"><h2 id="instances">${esc(t.instancesHeading)}</h2>${stackedTable(t.instancesHeading, 'instances', [{ text: t.instance }, { text: t.baselineOutcome }, { text: t.candidateOutcome }, { text: t.changeColumn }], rows)}</section>
${comparison.caveats.length ? `<section aria-labelledby="caveats"><h2 id="caveats">${esc(t.caveats)}</h2>${list(comparison.caveats.map(caveat => caveatLine(caveat, language)))}</section>\n` : ''}<section aria-labelledby="rules"><h2 id="rules">${esc(t.rulesHeading)}</h2><p class="note">${esc(rulesText(comparison, t))}</p></section>`;
  return page(language, `${t.compareTitle}: ${heading(baseline, candidate, language)}`, tokensCss, body);
}

/** The page for two reports that cannot be compared: every difference, and what to do. */
export function renderIncomparableHtml(baselineInput: CompareInput, candidateInput: CompareInput, found: readonly Difference[], tokensCss: string, language: Language = 'en'): string {
  const baseline = toSide(baselineInput), candidate = toSide(candidateInput);
  const t = TEXT[language];
  const field = (difference: Difference): string => (t as unknown as Record<string, string>)[`field_${difference.field}`] ?? difference.field;
  const items = found.map(difference => fill(language, t.caveatLine, { field: field(difference), baseline: differenceValue(difference, difference.baseline, language), candidate: differenceValue(difference, difference.candidate, language) }));
  const body = `<header>
<p class="eyebrow">${esc(t.compareTitle)}</p>
<h1>${esc(heading(baseline, candidate, language))}</h1>
<p class="headline">${esc(sentence(t.incomparableTitle))}</p>
</header>
${banner('warning', t.incomparableDiffers, `<p>${esc(t.incomparableLead)}</p>${list(items, 'fail')}<p>${esc(levelsDiffer(found) ? t.incomparableFixLevel : agentKindDiffers(found) ? t.incomparableFixAgentKind : t.incomparableFix)}</p>`)}
<section aria-labelledby="sides"><h2 id="sides">${esc(t.compareSides)}</h2><dl class="sides"><div class="figure"><dt>${esc(t.baseline)}</dt><dd class="detail">${chips(t.baseline, sideFacts(baseline, t, language))}</dd></div><div class="figure"><dt>${esc(t.candidate)}</dt><dd class="detail">${chips(t.candidate, sideFacts(candidate, t, language))}</dd></div></dl></section>
<section aria-labelledby="rules"><h2 id="rules">${esc(t.rulesHeading)}</h2><p class="note">${esc(t.compareRules)}</p></section>`;
  return page(language, `${t.compareTitle}: ${heading(baseline, candidate, language)}`, tokensCss, body);
}
