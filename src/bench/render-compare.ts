/**
 * `practonaut compare` output (PADR-0039 C): whether there is an instance regression, the rate verdict
 * with its counts and exact p, each side's instance rate with its interval and provenance, instance
 * regressions and fixes, other flips, runs that were not judged, instances that were not compared and
 * why, and the differences that do not refuse a comparison. Terminal and one static HTML page in
 * design system v1, like the report; two reports that cannot be compared get a page that names every
 * difference. Text from the reports is escaped.
 */
import { isBenchReportV2, type BenchReport } from './report.ts';
import { isolationOf, type Comparison, type Difference, type InstancePair } from './compare.ts';
import { intervalPercent, number, rateText, type Language } from './rates.ts';
import { fill, sentence, TEXT, type Words } from './report-text.ts';
import { banner, chips, escapeHtml as esc, modelHeadline, page, stackedTable, statusIcon, type Verification } from './render.ts';
import { readableText } from '../cli/output.ts';

/** One side: its report, how it was verified and the name it goes by (label or file name). */
export interface CompareInput { report: BenchReport; verification: Verification; name?: string }

const nameOf = (input: CompareInput): string => input.name ?? (isBenchReportV2(input.report) && input.report.label !== undefined ? input.report.label : input.report.agent.name);
const heading = (baseline: CompareInput, candidate: CompareInput, language: Language): string => fill(language, TEXT[language].compareHeading, { baseline: nameOf(baseline), candidate: nameOf(candidate) });
const pValue = (p: number, language: Language): string => p < 0.001 ? '< 0.001' : number(p, 3, language);
function verdictText(comparison: Comparison, language: Language): string {
  const t = TEXT[language], values = { p: pValue(comparison.p, language), b: comparison.discordant.baselineOnly, c: comparison.discordant.candidateOnly };
  return fill(language, { improvement: t.verdictImprovement, decline: t.verdictDecline, not_distinguishable: t.verdictNone, nothing_paired: t.verdictNothing }[comparison.verdict], values);
}
/** Whether there is an instance regression, in one phrase. */
const regressionText = (comparison: Comparison, language: Language): string => {
  const t = TEXT[language];
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
function sideFacts(input: CompareInput, t: Words, language: Language): string[] {
  const report = input.report;
  const model = report.agent.kind === 'builtin' ? t.builtin : modelHeadline(report, language);
  const isolation = { 'builtin-baseline': t.isolationBuiltin, 'tool-restricted-preset': t.isolationPreset, 'template-unrestricted': t.isolationTemplate }[isolationOf(report)];
  return [report.agent.name, ...(isBenchReportV2(report) && report.label !== undefined ? [report.label] : []), model, report.environment.mirror === 'required' ? t.mirrorOn : t.mirrorOff, isolation, input.verification === 're-verified' ? t.reverifiedShort : t.consistencyShort, report.createdAt.slice(0, 10)];
}
const flipLine = (pair: InstancePair, language: Language): string => {
  const t = TEXT[language], b = pair.baseline!, c = pair.candidate!;
  const values = { task: pair.taskId, seed: pair.seed, bp: b.passed, bn: b.judged, br: b.repeats, cp: c.passed, cn: c.judged, cr: c.repeats };
  const line = { regression: t.regressionLine, fix: t.fixLine, 'single-down': t.singleDown, 'single-up': t.singleUp, 'changed-down': t.changedDown, 'changed-up': t.changedUp }[pair.flip ?? 'single-up'];
  return fill(language, line, values);
};
const sideName = (side: InstancePair['side'], t: Words): string => side === 'baseline' ? t.sideBaseline : side === 'candidate' ? t.sideCandidate : t.sideBoth;
const notComparedLine = (pair: InstancePair, language: Language): string => fill(language, TEXT[language].missingSide, { task: pair.taskId, seed: pair.seed, side: sideName(pair.side, TEXT[language]) });
/** One line per side of a paired instance that holds runs that were not judged. */
const unjudgedLines = (pair: InstancePair, language: Language): string[] => {
  const t = TEXT[language];
  return (['baseline', 'candidate'] as const).flatMap(side => pair[side]!.unjudged ? [fill(language, t.unjudgedLine, { task: pair.taskId, seed: pair.seed, n: pair[side]!.unjudged, side: sideName(side, t) })] : []);
};
const caveatLine = (caveat: Comparison['caveats'][number], language: Language): string => {
  const t = TEXT[language];
  return fill(language, t.caveatLine, { field: { timeout: t.caveatTimeout, repeats: t.caveatRepeats, practonaut: t.caveatPractonaut }[caveat.field], baseline: caveat.baseline, candidate: caveat.candidate });
};

export function renderCompareTable(baseline: CompareInput, candidate: CompareInput, comparison: Comparison, language: Language = 'en'): string {
  const t = TEXT[language], lines: string[] = [];
  lines.push(readableText(`${t.compareTitle}  ${heading(baseline, candidate, language)}`));
  lines.push(readableText(`${t.baseline}: ${sideFacts(baseline, t, language).join(' · ')}`), readableText(`${t.candidate}: ${sideFacts(candidate, t, language).join(' · ')}`), '');
  lines.push(`${t.compareSummary}: ${verdictText(comparison, language)}`);
  lines.push(`  ${t.baseline}: ${sideText(comparison.baseline, language)}`, `  ${t.candidate}: ${sideText(comparison.candidate, language)}`, '');
  lines.push(`${t.regressions}:${comparison.regressions.length ? '' : ` ${regressionText(comparison, language)}`}`);
  for (const pair of comparison.regressions) lines.push(readableText(`  ✗ ${flipLine(pair, language)}`));
  if (comparison.fixes.length) { lines.push(`${t.fixes}:`); for (const pair of comparison.fixes) lines.push(readableText(`  ✓ ${flipLine(pair, language)}`)); }
  if (comparison.changedFlips.length) { lines.push(`${t.changedFlips}:`); for (const pair of comparison.changedFlips) lines.push(readableText(`  ${flipLine(pair, language)}`)); }
  if (comparison.singleFlips.length) { lines.push(`${t.singleFlips}:`); for (const pair of comparison.singleFlips) lines.push(readableText(`  ${flipLine(pair, language)}`)); }
  if (comparison.withUnjudged.length) { lines.push(`${t.unjudgedHeading}:`); for (const pair of comparison.withUnjudged) for (const line of unjudgedLines(pair, language)) lines.push(readableText(`  ${line}`)); }
  if (comparison.notCompared.length) { lines.push(`${t.notCompared}:`); for (const pair of comparison.notCompared) lines.push(readableText(`  ${notComparedLine(pair, language)}`)); }
  if (comparison.incomplete.length) lines.push(`${t.incompleteTitle}: ${fill(language, t.incompleteBody, { n: comparison.incomplete.length })}`);
  if (comparison.caveats.length) { lines.push(`${t.caveats}:`); for (const caveat of comparison.caveats) lines.push(readableText(`  ${caveatLine(caveat, language)}`)); }
  lines.push('', `${t.rulesHeading}: ${t.compareRules}`);
  return lines.join('\n') + '\n';
}

/** An instance's outcome on one side: pass or fail with passed/all repeats, and its unjudged runs. */
const outcome = (aggregate: InstancePair['baseline'], t: Words, language: Language): string => {
  if (aggregate === null) return t.outcomeMissing;
  const shown = fill(language, aggregate.outcome === 'pass' ? t.outcomePass : t.outcomeFail, { p: aggregate.passed, n: aggregate.repeats });
  return aggregate.unjudged ? fill(language, t.outcomeUnjudged, { outcome: shown, u: aggregate.unjudged }) : shown;
};
const list = (items: string[], mark?: 'pass' | 'fail'): string => `<ul class="flips">${items.map(item => `<li>${mark ? statusIcon(mark) : ''}<span>${esc(item)}</span></li>`).join('')}</ul>`;
const side = (title: string, input: CompareInput, rate: Comparison['baseline'], t: Words, language: Language): string => `<div class="figure"><dt>${esc(title)}</dt><dd>${esc(rate.instances ? rateText(rate.passed, rate.instances, language) : t.none)}</dd><dd class="detail">${esc(sideText(rate, language))}</dd><dd class="detail">${chips(title, sideFacts(input, t, language))}</dd></div>`;

export function renderCompareHtml(baseline: CompareInput, candidate: CompareInput, comparison: Comparison, tokensCss: string, language: Language = 'en'): string {
  const t = TEXT[language];
  const flipWord = (pair: InstancePair): string => pair.flip === 'regression' ? t.flipRegression : pair.flip === 'fix' ? t.flipFix : pair.flip === 'changed-down' || pair.flip === 'changed-up' ? t.flipChanged : pair.flip ? t.flipSingle : t.flipNone;
  const rows = comparison.pairs.map(pair => [`<code>${esc(pair.taskId)}</code> · ${pair.seed}`, esc(outcome(pair.baseline, t, language)), esc(outcome(pair.candidate, t, language)), esc(pair.kind === 'paired' ? flipWord(pair) : notComparedLine(pair, language))]);
  const sections: string[] = [];
  if (comparison.fixes.length) sections.push(`<h3>${esc(t.fixes)}</h3>${list(comparison.fixes.map(pair => flipLine(pair, language)), 'pass')}`);
  if (comparison.changedFlips.length) sections.push(`<h3>${esc(t.changedFlips)}</h3>${list(comparison.changedFlips.map(pair => flipLine(pair, language)))}`);
  if (comparison.singleFlips.length) sections.push(`<h3>${esc(t.singleFlips)}</h3>${list(comparison.singleFlips.map(pair => flipLine(pair, language)))}`);
  if (comparison.withUnjudged.length) sections.push(`<h3>${esc(t.unjudgedHeading)}</h3>${list(comparison.withUnjudged.flatMap(pair => unjudgedLines(pair, language)))}`);
  if (comparison.notCompared.length) sections.push(`<h3>${esc(t.notCompared)}</h3>${list(comparison.notCompared.map(pair => notComparedLine(pair, language)))}`);
  const body = `<header>
<p class="eyebrow">${esc(t.compareTitle)}</p>
<h1>${esc(heading(baseline, candidate, language))}</h1>
<p class="headline">${esc(sentence(regressionText(comparison, language)))}</p>
<p class="verdict">${esc(sentence(verdictText(comparison, language)))}</p>
</header>
${comparison.incomplete.length ? banner('warning', t.incompleteTitle, `<p>${esc(fill(language, t.incompleteBody, { n: comparison.incomplete.length }))}</p>`) : ''}
<section aria-labelledby="sides"><h2 id="sides">${esc(t.compareSides)}</h2><dl class="sides">${side(t.baseline, baseline, comparison.baseline, t, language)}${side(t.candidate, candidate, comparison.candidate, t, language)}</dl></section>
<section aria-labelledby="regressions"><h2 id="regressions">${esc(t.regressions)}</h2>${comparison.regressions.length ? list(comparison.regressions.map(pair => flipLine(pair, language)), 'fail') : `<p class="lead">${esc(sentence(regressionText(comparison, language)))}</p>`}${sections.join('')}</section>
<section aria-labelledby="instances"><h2 id="instances">${esc(t.instancesHeading)}</h2>${stackedTable(t.instancesHeading, 'instances', [{ text: t.instance }, { text: t.baselineOutcome }, { text: t.candidateOutcome }, { text: t.changeColumn }], rows)}</section>
${comparison.caveats.length ? `<section aria-labelledby="caveats"><h2 id="caveats">${esc(t.caveats)}</h2>${list(comparison.caveats.map(caveat => caveatLine(caveat, language)))}</section>\n` : ''}<section aria-labelledby="rules"><h2 id="rules">${esc(t.rulesHeading)}</h2><p class="note">${esc(t.compareRules)}</p></section>`;
  return page(language, `${t.compareTitle}: ${heading(baseline, candidate, language)}`, tokensCss, body);
}

/** The page for two reports that cannot be compared: every difference, and what to do. */
export function renderIncomparableHtml(baseline: CompareInput, candidate: CompareInput, found: readonly Difference[], tokensCss: string, language: Language = 'en'): string {
  const t = TEXT[language];
  const field = (difference: Difference): string => (t as unknown as Record<string, string>)[`field_${difference.field}`] ?? difference.field;
  const items = found.map(difference => fill(language, t.caveatLine, { field: field(difference), baseline: difference.baseline, candidate: difference.candidate }));
  const body = `<header>
<p class="eyebrow">${esc(t.compareTitle)}</p>
<h1>${esc(heading(baseline, candidate, language))}</h1>
<p class="headline">${esc(sentence(t.incomparableTitle))}</p>
</header>
${banner('warning', t.incomparableDiffers, `<p>${esc(t.incomparableLead)}</p>${list(items, 'fail')}<p>${esc(t.incomparableFix)}</p>`)}
<section aria-labelledby="sides"><h2 id="sides">${esc(t.compareSides)}</h2><dl class="sides"><div class="figure"><dt>${esc(t.baseline)}</dt><dd class="detail">${chips(t.baseline, sideFacts(baseline, t, language))}</dd></div><div class="figure"><dt>${esc(t.candidate)}</dt><dd class="detail">${chips(t.candidate, sideFacts(candidate, t, language))}</dd></div></dl></section>
<section aria-labelledby="rules"><h2 id="rules">${esc(t.rulesHeading)}</h2><p class="note">${esc(t.compareRules)}</p></section>`;
  return page(language, `${t.compareTitle}: ${heading(baseline, candidate, language)}`, tokensCss, body);
}
