/**
 * `practonaut compare` output (PADR-0039 C): whether there is an instance regression, the rate verdict
 * with its counts and exact p, each side's instance rate with its interval and provenance, instance
 * regressions and fixes, other flips, runs that were not judged, instances that were not compared and
 * why, and the differences that do not refuse a comparison. Terminal and one static HTML page in
 * design system v1, like the report; two reports that cannot be compared get a page that names every
 * difference. Text from the reports is escaped; every word comes from the catalogue, so instance names
 * are built here from the comparison's task ids and seeds.
 */
import { isolationOf, refusalHint, type CompareOptions, type Comparison, type Difference, type InstanceName, type InstancePair, type SideRate } from './compare.ts';
import { intervalPercent, number, rateText, type Language } from './rates.ts';
import { fill, sentence, TEXT, type Words } from './report-text.ts';
import { agentIds, appName, banner, chips, escapeHtml as esc, levelShort, modelHeadline, noSandbox, page, prose, stackedTable, statusIcon, verificationFacts, type VerificationInput } from './render.ts';
import { asView, type BenchReportView, type ReportInput } from './view.ts';
import { readableText } from '../cli/output.ts';

/** One side: its report (read through the view, any version), how it was verified and the name it goes by (label or file name). */
export interface CompareInput { report: ReportInput; verification: VerificationInput; name?: string }
interface Side { report: BenchReportView; verification: VerificationInput; name?: string }
const toSide = (input: CompareInput): Side => ({ ...input, report: asView(input.report) });

const nameOf = (input: Side): string => input.name ?? input.report.label ?? input.report.agent.name;
const heading = (baseline: Side, candidate: Side, language: Language): string => fill(language, TEXT[language].compareHeading, { baseline: nameOf(baseline), candidate: nameOf(candidate) });
const pValue = (p: number, language: Language): string => p < 0.001 ? '< 0.001' : number(p, 3, language);
/** A line of its own (a list item) starts with a capital letter. */
const capital = (text: string, language: Language): string => text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
function verdictText(comparison: Comparison, language: Language): string {
  const t = TEXT[language], values = { p: pValue(comparison.p, language), b: comparison.discordant.baselineOnly, c: comparison.discordant.candidateOnly };
  return fill(language, { improvement: t.verdictImprovement, decline: t.verdictDecline, not_distinguishable: t.verdictNone, nothing_paired: t.verdictNothing, no_equal_runs: t.verdictNoEqualRuns }[comparison.verdict], values);
}
/** A difference's values in words where they say how runs were judged (PADR-0044 decision 1); others as recorded. */
const differenceValue = (difference: Difference, value: string, language: Language): string => difference.field === 'verdictLevel' && (value === 'session' || value === 'artifact') ? levelShort(value, language) : value;
/** Whether there is an instance regression, in one phrase. Across worlds no flip is a regression
 * (PADR-0044 decision 3): said as such in the section, never as too few repeats. */
const regressionText = (comparison: Comparison, language: Language): string => {
  const t = TEXT[language];
  if (comparison.pairing === 'identity') return t.regressionsIdentity;
  return comparison.regressions.length ? fill(language, t.regressionCount, { n: comparison.regressions.length }) : comparison.regressionSignal ? t.regressionsNone : t.regressionsSingle;
};
/** The page's result in one phrase: across worlds, how many task identities were paired; otherwise
 * whether there is an instance regression. */
const headlineText = (comparison: Comparison, language: Language): string => comparison.pairing === 'identity'
  ? fill(language, TEXT[language].identityHeadline, { paired: comparison.paired, total: comparison.pairs.length }) : regressionText(comparison, language);
/** A side's rate with its interval; without a rate, why (no identity with equal run counts, or none paired). */
function sideText(side: SideRate, comparison: Comparison, language: Language): string {
  const t = TEXT[language];
  if (!side.instances) return comparison.verdict === 'no_equal_runs' ? t.noRateUnequal : t.intervalNone;
  const interval = intervalPercent(side.passed, side.instances);
  return `${fill(language, t.sideRate, { fraction: rateText(side.passed, side.instances, language), low: interval.low, high: interval.high })} ${fill(language, t.pairedOver, { n: side.instances })}`;
}
/** The counted instances of a side that hold no verdict at all: they count as not passed, and say so. */
const noVerdictText = (side: SideRate, language: Language): string | null => side.noVerdict ? fill(language, TEXT[language].sideNoVerdict, { n: side.noVerdict }) : null;
/** What travels with each side (vision §6 principle 4): when the two differ, the application and the
 * world first; then agent, label, how runs were judged, model with its source, mirror, isolation, a
 * foreign server's missing sandbox, verification status (once, also when the client's own values were
 * not re-derived) and date. */
function sideFacts(input: Side, other: Side, t: Words, language: Language): string[] {
  const report = input.report, world = report.environment.world, otherWorld = other.report.environment.world;
  const app = report.environment.app.adapterId !== other.report.environment.app.adapterId ? [appName(report.environment.app.adapterId)] : [];
  const worldFact = world.worldId !== otherWorld.worldId || world.version !== otherWorld.version ? [fill(language, t.sideWorld, { world: world.worldId, version: world.version })] : [];
  const v = verificationFacts(input.verification);
  // A built-in has no model: its isolation chip already says "no language model", once.
  const model = report.agent.kind === 'builtin' ? [] : [modelHeadline(report, language)];
  const isolation = { 'builtin-baseline': t.isolationBuiltin, 'tool-restricted-preset': t.isolationPreset, 'template-unrestricted': t.isolationTemplate }[isolationOf(report)];
  const mirror = report.verdictLevel === 'artifact' ? [] : [report.environment.mirror === 'required' ? t.mirrorOn : t.mirrorOff];
  return [...app, ...worldFact, report.agent.name, ...(report.label !== undefined ? [report.label] : []), levelShort(report.verdictLevel, language), ...model, ...mirror, isolation, ...noSandbox(report, language), v.level === 're-verified' ? (v.claims ? t.reverifiedClaimsShort : t.reverifiedShort) : t.consistencyShort, report.createdAt.slice(0, 10)];
}
/** The identifiers among a side's facts: data, never hyphenated. */
const sideIds = (input: Side): string[] => [...agentIds(input.report), input.report.environment.world.worldId, ...(input.report.label !== undefined ? [input.report.label] : [])];
/** The side of a flip that had no verdict at all (every run unjudged), if any: it did not fail, it was
 * not judged, and it counts as not passed. */
const noVerdictSide = (pair: InstancePair): 'baseline' | 'candidate' | null => {
  const down = pair.flip === 'single-down' || pair.flip === 'changed-down' || pair.flip === 'config-down', up = pair.flip === 'single-up' || pair.flip === 'changed-up' || pair.flip === 'config-up';
  return down && pair.candidate!.judged === 0 ? 'candidate' : up && pair.baseline!.judged === 0 ? 'baseline' : null;
};
/** One instance in the page's language ("T · seed 2", „T · Seed 2"). */
const instanceText = (name: InstanceName, language: Language): string => fill(language, TEXT[language].instanceName, { task: name.taskId, seed: name.seed });
const namesText = (names: readonly InstanceName[], language: Language): string => names.length ? names.map(name => instanceText(name, language)).join(', ') : TEXT[language].noInstance;
/** How a pair is named: its task and seed, or across worlds each side's instances that hold the identity. */
const pairText = (pair: InstancePair, language: Language): string => pair.names
  ? fill(language, TEXT[language].identityNames, { baseline: namesText(pair.names.baseline, language), candidate: namesText(pair.names.candidate, language) })
  : instanceText(pair, language);
/** The task ids a pair names (data in a line). */
const pairIds = (pair: InstancePair): string[] => pair.names ? [...pair.names.baseline, ...pair.names.candidate].map(name => name.taskId) : [pair.taskId];
const flipLine = (pair: InstancePair, language: Language): string => {
  const t = TEXT[language], b = pair.baseline!, c = pair.candidate!;
  const values = { name: pairText(pair, language), bp: b.passed, bn: b.judged, br: b.repeats, bu: b.unjudged, cp: c.passed, cn: c.judged, cr: c.repeats, cu: c.unjudged };
  const missing = noVerdictSide(pair);
  if (missing) return fill(language, missing === 'candidate' ? t.noVerdictDown : t.noVerdictUp, values);
  const line = { regression: t.regressionLine, fix: t.fixLine, 'single-down': t.singleDown, 'single-up': t.singleUp, 'changed-down': t.changedDown, 'changed-up': t.changedUp, 'config-down': t.configDown, 'config-up': t.configUp }[pair.flip ?? 'single-up'];
  return fill(language, line, values);
};
const sideName = (side: InstancePair['side'], t: Words): string => side === 'baseline' ? t.sideBaseline : side === 'candidate' ? t.sideCandidate : t.sideBoth;
const notComparedLine = (pair: InstancePair, language: Language): string => fill(language, TEXT[language].missingSide, { name: pairText(pair, language), side: sideName(pair.side, TEXT[language]) });
/** One line per side of a paired instance that holds runs that were not judged. */
const unjudgedLines = (pair: InstancePair, language: Language): string[] => {
  const t = TEXT[language];
  return (['baseline', 'candidate'] as const).flatMap(side => pair[side]!.unjudged ? [fill(language, t.unjudgedLine, { name: pairText(pair, language), n: pair[side]!.unjudged, side: sideName(side, t) })] : []);
};
/** Caveat fields whose values are identifiers (versions, ids, worlds): data on the page. */
const IDENTIFIER_CAVEATS: ReadonlySet<Comparison['caveats'][number]['field']> = new Set(['practonaut', 'reportVersion', 'toolchain', 'rules', 'clientVersion', 'clientSettings', 'identityPairing']);
const caveatLine = (caveat: Comparison['caveats'][number], language: Language): string => {
  const t = TEXT[language];
  const field = { timeout: t.caveatTimeout, repeats: t.caveatRepeats, practonaut: t.caveatPractonaut, reportVersion: t.caveatReportVersion, isolationBasis: t.caveatIsolationBasis, toolchain: t.caveatToolchain, rules: t.caveatRules, clientVersion: t.caveatClientVersion, clientSettings: t.caveatClientSettings, sharedIdentities: t.caveatSharedIdentities, identityPairing: t.caveatIdentityPairing }[caveat.field];
  return capital(fill(language, t.caveatLine, { field, baseline: caveat.baseline, candidate: caveat.candidate }), language);
};
/** Across worlds, each paired identity with a different number of runs on the two sides: left out of the rate. */
const runCountLines = (comparison: Comparison, language: Language): string[] => comparison.pairs.filter(pair => pair.unequalRuns).map(pair => fill(language, TEXT[language].runCountsLine, { name: pairText(pair, language), b: pair.baseline!.repeats, c: pair.candidate!.repeats }));
/** Every caveat line with the identifiers it holds. */
const caveatItems = (comparison: Comparison, language: Language): Array<{ text: string; ids: string[] }> => [
  ...comparison.caveats.map(caveat => ({ text: caveatLine(caveat, language), ids: IDENTIFIER_CAVEATS.has(caveat.field) ? [caveat.baseline, caveat.candidate] : [] })),
  ...comparison.pairs.filter(pair => pair.unequalRuns).map((pair, index) => ({ text: runCountLines(comparison, language)[index]!, ids: pairIds(pair) })),
];
const rulesText = (comparison: Comparison, t: Words): string => comparison.pairing === 'identity' ? t.compareRulesIdentity : t.compareRules;

export function renderCompareTable(baselineInput: CompareInput, candidateInput: CompareInput, comparison: Comparison, language: Language = 'en'): string {
  const baseline = toSide(baselineInput), candidate = toSide(candidateInput);
  const t = TEXT[language], lines: string[] = [];
  lines.push(readableText(`${t.compareTitle}  ${heading(baseline, candidate, language)}`));
  if (comparison.pairing === 'identity') lines.push(sentence(headlineText(comparison, language)));
  lines.push(readableText(`${t.baseline}: ${sideFacts(baseline, candidate, t, language).join(' · ')}`), readableText(`${t.candidate}: ${sideFacts(candidate, baseline, t, language).join(' · ')}`), '');
  lines.push(`${t.compareSummary}: ${verdictText(comparison, language)}`);
  const sideLine = (rate: SideRate): string => [sideText(rate, comparison, language), ...(noVerdictText(rate, language) ? [`? ${noVerdictText(rate, language)}`] : [])].join(' · ');
  lines.push(`  ${t.baseline}: ${sideLine(comparison.baseline)}`, `  ${t.candidate}: ${sideLine(comparison.candidate)}`, '');
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
  const caveats = caveatItems(comparison, language);
  if (caveats.length) { lines.push(`${t.caveats}:`); for (const caveat of caveats) lines.push(readableText(`  ${caveat.text}`)); }
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
/** A template filled with markup: its own words escaped, the values given as HTML. */
const fillHtml = (template: string, values: Readonly<Record<string, string>>): string =>
  template.split(/(\{\w+\})/u).map(part => { const key = /^\{(\w+)\}$/u.exec(part)?.[1]; return key !== undefined && key in values ? values[key]! : esc(part); }).join('');
/** An instance name in a table cell: the task id in mono, one unit from task to seed (it breaks only
 * inside a long task id). */
const instanceHtml = (name: InstanceName, language: Language): string => prose(instanceText(name, language).replace(/ · /gu, ' · '), [name.taskId], 'code');
const namesHtml = (names: readonly InstanceName[], language: Language): string => names.length ? names.map(name => instanceHtml(name, language)).join(', ') : esc(TEXT[language].noInstance);
type Mark = 'pass' | 'fail' | 'unknown' | undefined;
// (A list item may carry its own mark: [text, mark].)
const list = (items: ReadonlyArray<string | [string, Mark]>, mark?: Mark, ids: readonly string[] = []): string => `<ul class="flips">${items.map(item => { const [text, own] = typeof item === 'string' ? [item, mark] : item; return `<li>${own ? statusIcon(own) : ''}<span>${prose(text, ids)}</span></li>`; }).join('')}</ul>`;
/** Items that each hold their own identifiers. */
const idList = (items: ReadonlyArray<{ text: string; ids: readonly string[] }>, mark?: Mark): string => `<ul class="flips">${items.map(item => `<li>${mark ? statusIcon(mark) : ''}<span>${prose(item.text, item.ids)}</span></li>`).join('')}</ul>`;
const side = (title: string, input: Side, other: Side, rate: SideRate, comparison: Comparison, t: Words, language: Language): string => {
  const unknown = noVerdictText(rate, language);
  return `<div class="figure"><dt>${esc(title)}</dt><dd>${esc(rate.instances ? rateText(rate.passed, rate.instances, language) : t.none)}</dd><dd class="detail">${esc(sideText(rate, comparison, language))}</dd>${unknown ? `<dd class="detail"><span class="result unknown">${statusIcon('unknown')}${esc(unknown)}</span></dd>` : ''}<dd class="detail">${chips(title, sideFacts(input, other, t, language), sideIds(input))}</dd></div>`;
};

export function renderCompareHtml(baselineInput: CompareInput, candidateInput: CompareInput, comparison: Comparison, tokensCss: string, language: Language = 'en'): string {
  const baseline = toSide(baselineInput), candidate = toSide(candidateInput);
  const t = TEXT[language];
  const flipWord = (pair: InstancePair): string => noVerdictSide(pair) ? t.flipNoVerdict : pair.flip === 'regression' ? t.flipRegression : pair.flip === 'fix' ? t.flipFix : pair.flip === 'changed-down' || pair.flip === 'changed-up' ? t.flipChanged : pair.flip === 'config-down' || pair.flip === 'config-up' ? t.flipConfig : pair.flip ? t.flipSingle : t.flipNone;
  // The separator between the two sides ends a line, never starts one.
  const nameCell = (pair: InstancePair): string => pair.names
    ? fillHtml(t.identityNames.replace(' · ', ' · '), { baseline: namesHtml(pair.names.baseline, language), candidate: namesHtml(pair.names.candidate, language) })
    : `<code>${esc(pair.taskId)}</code> · ${pair.seed}`;
  // A pair not compared says only which side lacks a run: the row already names it.
  const changeCell = (pair: InstancePair): string => esc(pair.kind === 'paired' ? flipWord(pair) : fill(language, t.missingShort, { side: sideName(pair.side, t) }));
  const rows = comparison.pairs.map(pair => [nameCell(pair), outcomeCell(pair.baseline, t, language), outcomeCell(pair.candidate, t, language), changeCell(pair)]);
  const ids = comparison.pairs.flatMap(pairIds);
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
  const caveats = caveatItems(comparison, language);
  const body = `<header>
<p class="eyebrow">${esc(t.compareTitle)}</p>
<h1>${esc(heading(baseline, candidate, language))}</h1>
<p class="headline">${esc(sentence(headlineText(comparison, language)))}</p>
<p class="verdict">${prose(sentence(verdictText(comparison, language)))}</p>
</header>
${comparison.incomplete.length ? banner('warning', t.incompleteTitle, `<p>${prose(fill(language, t.incompleteBody, { n: comparison.incomplete.length }))}</p>`) : ''}
<section aria-labelledby="sides"><h2 id="sides">${esc(t.compareSides)}</h2><dl class="sides">${side(t.baseline, baseline, candidate, comparison.baseline, comparison, t, language)}${side(t.candidate, candidate, baseline, comparison.candidate, comparison, t, language)}</dl></section>
<section aria-labelledby="regressions"><h2 id="regressions">${esc(t.regressions)}</h2>${comparison.regressions.length ? list(comparison.regressions.map(pair => flipLine(pair, language)), 'fail', ids) : `<p class="lead">${esc(sentence(regressionText(comparison, language)))}</p>`}${sections.join('')}</section>
<section aria-labelledby="instances"><h2 id="instances">${esc(t.instancesHeading)}</h2>${stackedTable(t.instancesHeading, 'instances', [{ text: t.instance }, { text: t.baselineOutcome }, { text: t.candidateOutcome }, { text: t.changeColumn, prose: true }], rows)}</section>
${caveats.length ? `<section aria-labelledby="caveats"><h2 id="caveats">${esc(t.caveats)}</h2>${idList(caveats)}</section>\n` : ''}<section aria-labelledby="rules"><h2 id="rules">${esc(t.rulesHeading)}</h2><p class="note">${prose(rulesText(comparison, t))}</p></section>`;
  return page(language, `${t.compareTitle}: ${heading(baseline, candidate, language)}`, tokensCss, body);
}

/** The page for two reports that cannot be compared: every difference, and what to do. A regression
 * gate's refusal says why the gate refuses (two worlds, or two readings of results); runs judged in
 * different ways get no instance rules, which do not apply to them. */
export function renderIncomparableHtml(baselineInput: CompareInput, candidateInput: CompareInput, found: readonly Difference[], tokensCss: string, language: Language = 'en', options: CompareOptions = {}): string {
  const baseline = toSide(baselineInput), candidate = toSide(candidateInput);
  const t = TEXT[language], hint = refusalHint(found, baseline.report, candidate.report, options);
  const field = (difference: Difference): string => (t as unknown as Record<string, string>)[`field_${difference.field}`] ?? difference.field;
  const items = found.map(difference => {
    const values = { baseline: differenceValue(difference, difference.baseline, language), candidate: differenceValue(difference, difference.candidate, language) };
    // Recorded values are identifiers (worlds, ids, versions), except how runs were judged, which is words.
    return { text: capital(fill(language, t.caveatLine, { field: field(difference), ...values }), language), ids: difference.field === 'verdictLevel' ? [] : [difference.baseline, difference.candidate] };
  });
  const lead = hint === 'gate' ? (found.some(difference => difference.field === 'world') ? t.incomparableLeadGateWorld : t.incomparableLeadGateRules) : t.incomparableLead;
  const fix = { level: t.incomparableFixLevel, agentKind: t.incomparableFixAgentKind, gate: t.incomparableFixGate, settings: t.incomparableFix }[hint];
  const body = `<header>
<p class="eyebrow">${esc(t.compareTitle)}</p>
<h1>${esc(heading(baseline, candidate, language))}</h1>
<p class="headline">${esc(sentence(t.incomparableTitle))}</p>
</header>
${banner('warning', t.incomparableDiffers, `<p>${esc(lead)}</p>${idList(items, 'fail')}<p>${prose(fix)}</p>`)}
<section aria-labelledby="sides"><h2 id="sides">${esc(t.compareSides)}</h2><dl class="sides"><div class="figure"><dt>${esc(t.baseline)}</dt><dd class="detail">${chips(t.baseline, sideFacts(baseline, candidate, t, language), sideIds(baseline))}</dd></div><div class="figure"><dt>${esc(t.candidate)}</dt><dd class="detail">${chips(t.candidate, sideFacts(candidate, baseline, t, language), sideIds(candidate))}</dd></div></dl></section>
${hint === 'level' ? '' : `<section aria-labelledby="rules"><h2 id="rules">${esc(t.rulesHeading)}</h2><p class="note">${esc(t.compareRules)}</p></section>`}`;
  return page(language, `${t.compareTitle}: ${heading(baseline, candidate, language)}`, tokensCss, body);
}
