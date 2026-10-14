/**
 * `practonaut compare` output (PADR-0039 C): the verdict with its counts and exact p, each side's
 * instance rate with its interval, instance regressions and fixes, single-run flips, instances that
 * were not compared and why, and the differences that do not refuse a comparison. Terminal and one
 * static HTML page in design system v1, like the report. Text from the reports is escaped.
 */
import { isBenchReportV2, type BenchReport } from './report.ts';
import { isolationOf, type Comparison, type InstancePair } from './compare.ts';
import { intervalPercent, number, rateText, type Language } from './rates.ts';
import { fill, TEXT, type Words } from './report-text.ts';
import { escapeHtml as esc, modelHeadline, page, type Verification } from './render.ts';
import { readableText } from '../cli/output.ts';

export interface CompareInput { report: BenchReport; verification: Verification }

const pValue = (p: number, language: Language): string => p < 0.001 ? '< 0.001' : number(p, 3, language);
function verdictText(comparison: Comparison, language: Language): string {
  const t = TEXT[language], values = { p: pValue(comparison.p, language), b: comparison.discordant.baselineOnly, c: comparison.discordant.candidateOnly };
  return fill(language, comparison.verdict === 'improvement' ? t.verdictImprovement : comparison.verdict === 'decline' ? t.verdictDecline : t.verdictNone, values);
}
function sideText(side: Comparison['baseline'], language: Language): string {
  const t = TEXT[language];
  if (!side.instances) return t.intervalNone;
  const interval = intervalPercent(side.passed, side.instances);
  return `${fill(language, t.sideRate, { fraction: rateText(side.passed, side.instances, language), low: interval.low, high: interval.high })} ${fill(language, t.pairedOver, { n: side.instances })}`;
}
/** What travels with each side (vision §6 principle 4): agent, label, model with its source, mirror,
 * isolation level, verification status and date. */
function sideFacts(input: CompareInput, t: Words, language: Language): string {
  const report = input.report;
  const model = report.agent.kind === 'builtin' ? t.builtin : modelHeadline(report, language);
  const isolation = { 'builtin-baseline': t.isolationBuiltin, 'tool-restricted-preset': t.isolationPreset, 'template-unrestricted': t.isolationTemplate }[isolationOf(report)];
  return [report.agent.name, ...(isBenchReportV2(report) && report.label !== undefined ? [report.label] : []), model, report.environment.mirror === 'required' ? t.mirrorOn : t.mirrorOff, isolation, input.verification === 're-verified' ? t.reverifiedShort : t.consistencyShort, report.createdAt.slice(0, 10)].join(' · ');
}
const flipLine = (pair: InstancePair, language: Language): string => {
  const t = TEXT[language], b = pair.baseline!, c = pair.candidate!;
  const values = { task: pair.taskId, seed: pair.seed, bp: b.passed, bn: b.judged, cp: c.passed, cn: c.judged };
  const line = { regression: t.regressionLine, fix: t.fixLine, 'single-down': t.singleDown, 'single-up': t.singleUp, 'changed-down': t.changedDown, 'changed-up': t.changedUp }[pair.flip ?? 'single-up'];
  return fill(language, line, values);
};
const notComparedLine = (pair: InstancePair, language: Language): string => {
  const t = TEXT[language], side = pair.side === 'baseline' ? t.sideBaseline : pair.side === 'candidate' ? t.sideCandidate : t.sideBoth;
  return fill(language, pair.kind === 'missing' ? t.missingSide : t.unjudgedSide, { task: pair.taskId, seed: pair.seed, side });
};
const caveatLine = (caveat: Comparison['caveats'][number], language: Language): string => {
  const t = TEXT[language];
  return fill(language, t.caveatLine, { field: { timeout: t.caveatTimeout, repeats: t.caveatRepeats, practonaut: t.caveatPractonaut }[caveat.field], baseline: caveat.baseline, candidate: caveat.candidate });
};
const regressionsSummary = (comparison: Comparison, t: Words): string => !comparison.regressionSignal ? t.regressionsSingle : comparison.regressions.length ? '' : t.regressionsNone;

export function renderCompareTable(baseline: CompareInput, candidate: CompareInput, comparison: Comparison, language: Language = 'en'): string {
  const t = TEXT[language], lines: string[] = [];
  lines.push(t.compareTitle);
  lines.push(readableText(`${t.baseline}: ${sideFacts(baseline, t, language)}`), readableText(`${t.candidate}: ${sideFacts(candidate, t, language)}`), '');
  lines.push(`${t.compareSummary}: ${verdictText(comparison, language)}`);
  lines.push(`  ${t.baseline}: ${sideText(comparison.baseline, language)}`, `  ${t.candidate}: ${sideText(comparison.candidate, language)}`, '');
  lines.push(`${t.regressions}:${comparison.regressions.length ? '' : ` ${regressionsSummary(comparison, t)}`}`);
  for (const pair of comparison.regressions) lines.push(readableText(`  ✗ ${flipLine(pair, language)}`));
  if (comparison.fixes.length) { lines.push(`${t.fixes}:`); for (const pair of comparison.fixes) lines.push(readableText(`  ✓ ${flipLine(pair, language)}`)); }
  if (comparison.changedFlips.length) { lines.push(`${t.changedFlips}:`); for (const pair of comparison.changedFlips) lines.push(readableText(`  ${flipLine(pair, language)}`)); }
  if (comparison.singleFlips.length) { lines.push(`${t.singleFlips}:`); for (const pair of comparison.singleFlips) lines.push(readableText(`  ${flipLine(pair, language)}`)); }
  if (comparison.notCompared.length) { lines.push(`${t.notCompared}:`); for (const pair of comparison.notCompared) lines.push(readableText(`  ${notComparedLine(pair, language)}`)); }
  if (comparison.caveats.length) { lines.push(`${t.caveats}:`); for (const caveat of comparison.caveats) lines.push(readableText(`  ${caveatLine(caveat, language)}`)); }
  lines.push('', t.compareRules);
  return lines.join('\n') + '\n';
}

const outcome = (aggregate: InstancePair['baseline'], t: Words, language: Language): string => aggregate === null ? t.outcomeMissing : aggregate.outcome === 'unjudged' ? t.outcomeNone : fill(language, aggregate.outcome === 'pass' ? t.outcomePass : t.outcomeFail, { p: aggregate.passed, n: aggregate.judged });

export function renderCompareHtml(baseline: CompareInput, candidate: CompareInput, comparison: Comparison, tokensCss: string, language: Language = 'en'): string {
  const t = TEXT[language];
  const list = (items: string[], marker = ''): string => `<ul class="flips">${items.map(item => `<li>${marker ? `<span aria-hidden="true">${marker} </span>` : ''}${esc(item)}</li>`).join('')}</ul>`;
  const side = (title: string, input: CompareInput, rate: Comparison['baseline']): string => `<div class="figure"><dt>${esc(title)}</dt><dd>${esc(rate.instances ? rateText(rate.passed, rate.instances, language) : t.none)}</dd><dd class="detail">${esc(sideText(rate, language))}</dd><dd class="detail">${esc(sideFacts(input, t, language))}</dd></div>`;
  const flipWord = (pair: InstancePair): string => pair.flip === 'regression' ? t.flipRegression : pair.flip === 'fix' ? t.flipFix : pair.flip === 'changed-down' || pair.flip === 'changed-up' ? t.flipChanged : pair.flip ? t.flipSingle : t.flipNone;
  const rows = comparison.pairs.map(pair => `<tr><td><code>${esc(pair.taskId)}</code> · ${pair.seed}</td><td class="text">${esc(outcome(pair.baseline, t, language))}</td><td class="text">${esc(outcome(pair.candidate, t, language))}</td><td class="text">${esc(pair.kind === 'paired' ? flipWord(pair) : notComparedLine(pair, language))}</td></tr>`).join('');
  const regressionNote = regressionsSummary(comparison, t);
  const body = `<header>
<p class="eyebrow">${esc(t.compareTitle)}</p>
<h1>${esc(`${baseline.report.agent.name} → ${candidate.report.agent.name}`)}</h1>
<p class="headline">${esc([comparison.regressions.length ? fill(language, t.regressionCount, { n: comparison.regressions.length }) : regressionNote, verdictText(comparison, language)].join(' · '))}</p>
</header>
<section aria-labelledby="sides"><h2 id="sides">${esc(t.compareSummary)}</h2><dl class="sides">${side(t.baseline, baseline, comparison.baseline)}${side(t.candidate, candidate, comparison.candidate)}</dl></section>
<section aria-labelledby="regressions"><h2 id="regressions">${esc(t.regressions)}</h2>${comparison.regressions.length ? list(comparison.regressions.map(pair => flipLine(pair, language)), '✗') : `<p class="verdict">${esc(regressionNote)}</p>`}
${comparison.fixes.length ? `<h3>${esc(t.fixes)}</h3>${list(comparison.fixes.map(pair => flipLine(pair, language)), '✓')}` : ''}${comparison.changedFlips.length ? `<h3>${esc(t.changedFlips)}</h3>${list(comparison.changedFlips.map(pair => flipLine(pair, language)))}` : ''}${comparison.singleFlips.length ? `<h3>${esc(t.singleFlips)}</h3>${list(comparison.singleFlips.map(pair => flipLine(pair, language)))}` : ''}${comparison.notCompared.length ? `<h3>${esc(t.notCompared)}</h3>${list(comparison.notCompared.map(pair => notComparedLine(pair, language)))}` : ''}</section>
<section aria-labelledby="instances"><h2 id="instances">${esc(t.instancesHeading)}</h2><div class="scroll" role="region" aria-labelledby="instances" tabindex="0"><table><thead><tr><th scope="col">${esc(t.instance)}</th><th scope="col" class="text">${esc(t.baselineOutcome)}</th><th scope="col" class="text">${esc(t.candidateOutcome)}</th><th scope="col" class="text">${esc(t.compareSummary)}</th></tr></thead><tbody>${rows}</tbody></table></div></section>
${comparison.caveats.length ? `<section aria-labelledby="caveats"><h2 id="caveats">${esc(t.caveats)}</h2>${list(comparison.caveats.map(caveat => caveatLine(caveat, language)))}</section>\n` : ''}<section aria-labelledby="rules"><h2 id="rules">${esc(t.rulesHeading)}</h2><p class="note">${esc(t.compareRules)}</p></section>`;
  return page(language, `${t.compareTitle}: ${baseline.report.agent.name} → ${candidate.report.agent.name}`, tokensCss, body);
}
