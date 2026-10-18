/**
 * The result card and badge of a bench report (roadmap 0.2.0, Should 6): `report --card` draws a
 * 1280 × 640 card, light and dark; `report --badge` a badge. Both are SVG files that need nothing from
 * outside: no script, no font, no image, no link; the card's PNG is drawn from the same SVG by
 * card-png.ts.
 *
 * What they carry (vision principle 4): the fraction with its 95 % Wilson interval (rates.ts: never a
 * rate finer than 1/n), n, the verification status (re-verified, or consistency-checked only), the
 * isolation level, the mirror, the self-reported model, runs without a verdict by count, and the caveat
 * that a bench describes these runs and is not sealed. Every caveat is a real <text> node, never an
 * image of text. Status is never colour alone: each fact has its word and its evidence mark (design
 * language 7.4: a filled accent disc with a check where it is confirmed, a dashed ring where it is not).
 * No ranking words, no praise.
 *
 * Values come from design/tokens.css: the rules of card.css are copied into the SVG's own <style> with
 * every token replaced by its value (the card: one file per theme; the badge: light, and dark by
 * prefers-color-scheme). Text from the report (agent name, label, model, world id) is escaped, with
 * control, format and bidi characters shown as \u{…}. No clock, no randomness, no machine name: the
 * same report, language and verification level give the same bytes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asView, type BenchReportView, type ReportInput, type ViewRun } from './view.ts';
import { intervalPercent, rateText, type Language } from './rates.ts';
import { fill, TEXT, type Words } from './report-text.ts';
import { headline, instanceOutcome, verificationFacts, type VerificationInput } from './render.ts';
import { displayText, xmlEscape } from './junit.ts';

/** The card's pixel size (a 2:1 social-preview image). */
export const CARD_SIZE = Object.freeze({ width: 1280, height: 640 });
/** The card is laid out in 800 × 400 units of the design language's type scale and drawn at 1.6×. */
const VIEW = Object.freeze({ width: 800, height: 400 });
export type Theme = 'light' | 'dark';

// ---- tokens ----

export type TokenMap = ReadonlyMap<string, string>;
/** The token values of each theme: the theme-independent `:root` block plus the light block, or the
 * explicit dark block (design/tokens.css keeps the system-preference dark block identical to it). */
export function tokenThemes(css: string): Record<Theme, TokenMap> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: Record<'base' | Theme, Map<string, string>> = { base: new Map(), light: new Map(), dark: new Map() };
  let depth = 0, start = 0, bodyStart = 0, selector = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (depth === 0) { selector = text.slice(start, i).replace(/\s+/g, ' ').trim(); bodyStart = i + 1; } depth++; }
    else if (text[i] === '}') {
      depth--;
      if (depth !== 0) continue;
      // Top-level rules only: the @media blocks (narrow screens, reduced motion, the system dark block) are skipped.
      const target = selector === ':root' ? blocks.base : selector === ':root, :root[data-theme="light"]' ? blocks.light : selector === ':root[data-theme="dark"]' ? blocks.dark : null;
      if (target) for (const match of text.slice(bodyStart, i).matchAll(/(--pn-[\w-]+)\s*:\s*([^;]+);/g)) target.set(match[1]!, match[2]!.trim());
      start = i + 1;
    }
  }
  const themes = { light: new Map([...blocks.base, ...blocks.light]), dark: new Map([...blocks.base, ...blocks.dark]) };
  // Fail closed: a card drawn without its colours or type scale would be wrong, not just plain.
  for (const theme of Object.values(themes)) for (const name of ['--pn-color-text', '--pn-color-surface', '--pn-text-display', '--pn-space-10']) if (!theme.has(name)) throw new Error(`design/tokens.css: ${name} is missing`);
  return themes;
}
/** A value with every token replaced (recursively) and rem written as px (16 px each), as an SVG file
 * outside any page has no stylesheet to take them from. */
function resolve(value: string, tokens: TokenMap, depth = 0): string {
  if (depth > 8) throw new Error(`design/tokens.css: tokens refer to each other too deeply (${value})`);
  const replaced = value.replace(/var\(\s*(--pn-[\w-]+)\s*\)/g, (_, name: string) => {
    const found = tokens.get(name);
    if (found === undefined) throw new Error(`card.css uses ${name}, which design/tokens.css does not declare`);
    return resolve(found, tokens, depth + 1);
  });
  return replaced.replace(/(-?\d*\.?\d+)rem\b/g, (_, number: string) => `${Math.round(Number(number) * 16 * 10_000) / 10_000}px`);
}
/** A token's value as a number of px (or a plain number). */
function numeric(name: string, tokens: TokenMap): number {
  const value = Number.parseFloat(resolve(`var(${name})`, tokens));
  if (!Number.isFinite(value)) throw new Error(`design/tokens.css: ${name} is not a number`);
  return value;
}

/** card.css, read when a card is first drawn (beside this module in a checkout and in the build). */
let cardCss: string | undefined;
function cardStylesheet(): string {
  cardCss ??= readFileSync(fileURLToPath(new URL('./card.css', import.meta.url)), 'utf8');
  return cardCss;
}
type Rules = ReadonlyMap<string, ReadonlyArray<[string, string]>>;
/** The rules of card.css: `.class` → its declarations (card.css holds no nesting and no at-rules). */
function rules(): Rules {
  const out = new Map<string, Array<[string, string]>>();
  for (const match of cardStylesheet().replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = match[2]!.split(';').map(part => part.trim()).filter(Boolean).map(part => [part.slice(0, part.indexOf(':')).trim(), part.slice(part.indexOf(':') + 1).trim()] as [string, string]);
    out.set(match[1]!.trim(), declarations);
  }
  return out;
}
/** The rules whose class starts with one of `prefixes`, every token replaced by its value in `tokens`. */
function stylesheet(tokens: TokenMap, prefixes: readonly string[]): string {
  const css = [...rules()].filter(([selector]) => prefixes.some(prefix => selector.startsWith(`.${prefix}`)))
    .map(([selector, declarations]) => `${selector}{${declarations.map(([property, value]) => `${property}:${resolve(value, tokens)}`).join(';')}}`).join('');
  // The style sits inside an XML file: nothing in it may open markup or an entity.
  if (/[<&]/.test(css)) throw new Error('card.css or design/tokens.css would put < or & into the SVG style');
  return css;
}

// ---- text measurement ----

/** Advance widths in 1/1000 em, for each character the wider of DejaVu Sans (the default sans of most
 * Linux systems) and Verdana, the widest common sans fonts. The card is drawn with whatever font the
 * reader's system resolves from the token's stack (the SVG carries none), so a line is broken by an
 * estimate that no common font exceeds; a narrower font (SF Pro, Segoe UI, Roboto, Arial) leaves room
 * at the end of a line instead of running past its column. */
const ASCII = [352, 401, 459, 838, 636, 1076, 780, 275, 454, 454, 636, 838, 364, 454, 364, 454, 636, 636, 636, 636, 636, 636, 636, 636, 636, 636, 454, 454, 838, 838, 838, 545,
  1000, 684, 686, 698, 771, 632, 575, 775, 752, 421, 455, 693, 557, 863, 748, 787, 603, 787, 695, 684, 616, 732, 684, 989, 685, 615, 685, 454, 454, 454, 838, 636,
  636, 613, 635, 550, 635, 615, 352, 635, 634, 278, 344, 592, 278, 974, 634, 612, 635, 635, 427, 521, 394, 634, 592, 818, 592, 592, 525, 636, 454, 636, 838];
const OTHER: Readonly<Record<string, number>> = { '·': 364, '–': 636, '—': 1000, '…': 1000, '“': 518, '”': 518, '„': 518, '‘': 318, '’': 318, '‚': 318, '«': 644, '»': 644, '×': 838, '→': 838, 'ß': 630, '€': 636, '°': 542, '\u00a0': 352 };
/** Bold faces of both are about 15 % wider; SAFETY covers rounding and kerning. */
const SAFETY = 1.02, BOLD = 1.15;
/** The wide estimate over the middle of common fonts (narrow ones are about 15 % below it). */
const BADGE_MIDDLE = 1.08;
function advance(char: string): number {
  const code = char.codePointAt(0)!;
  if (code >= 32 && code <= 126) return ASCII[code - 32]!;
  if (OTHER[char] !== undefined) return OTHER[char];
  // A letter with a diacritic is as wide as its base letter.
  const base = char.normalize('NFD').replace(/\p{M}/gu, '');
  if (base.length === 1 && base !== char) return advance(base);
  return code >= 0x2e80 ? 1000 : 750;
}
interface Metrics { size: number; leading: number; tracking: number; bold: boolean }
function width(text: string, metrics: Metrics): number {
  let sum = 0, count = 0;
  for (const char of text) { sum += advance(char); count++; }
  return (sum / 1000) * metrics.size * SAFETY * (metrics.bold ? BOLD : 1) + count * metrics.tracking * metrics.size;
}
/** The type role a card.css class uses: size, leading, tracking and weight from its tokens. */
function metricsOf(className: string, tokens: TokenMap, all: Rules): Metrics {
  const declarations = new Map(all.get(`.${className}`) ?? []);
  const size = /var\(--pn-text-([\w-]+)\)/.exec(declarations.get('font-size') ?? '')?.[1];
  if (!size) throw new Error(`card.css: .${className} has no type role`);
  const tracking = declarations.get('letter-spacing'), weight = declarations.get('font-weight');
  return { size: numeric(`--pn-text-${size}`, tokens), leading: numeric(`--pn-leading-${size}`, tokens), tracking: tracking ? Number.parseFloat(resolve(tracking, tokens)) : 0, bold: weight ? Number(resolve(weight, tokens)) >= 600 : false };
}

/** Lines of at most `max` units; a word longer than a line is broken where it must be. Past `lines`
 * lines the last one ends with an ellipsis (user text only: no caveat is ever cut, see layout). */
function wrap(raw: string, max: number, metrics: Metrics, lines = Infinity): string[] {
  // Measured as it is shown: a control or bidi character takes the room of its \u{…} escape.
  const text = displayText(raw);
  const fits = (line: string): boolean => width(line, metrics) <= max;
  const out: string[] = [];
  let current = '';
  for (const word of text.split(' ').filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) { current = candidate; continue; }
    if (current) out.push(current);
    current = '';
    let rest = word;
    while (!fits(rest)) {
      let cut = [...rest].length - 1;
      while (cut > 1 && !fits([...rest].slice(0, cut).join(''))) cut--;
      out.push([...rest].slice(0, cut).join('')); rest = [...rest].slice(cut).join('');
    }
    current = rest;
  }
  if (current) out.push(current);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  let last = `${kept[lines - 1]} ${out.slice(lines).join(' ')}`;
  while (last && !fits(`${last}…`)) last = [...last].slice(0, -1).join('');
  kept[lines - 1] = `${last.trimEnd()}…`;
  return kept;
}

// ---- drawing ----

const num = (value: number): string => String(Math.round(value * 100) / 100);
const baseline = (top: number, metrics: Metrics): number => top + (metrics.leading + 0.72 * metrics.size) / 2;
/** One <text> node per paragraph, a <tspan> per line; a space ends every line but the last, so the
 * node's text is the paragraph itself. */
function paragraph(className: string, lines: readonly string[], x: number, top: number, metrics: Metrics, anchor: 'start' | 'end' = 'start'): string {
  const spans = lines.map((line, index) => `<tspan x="${num(x)}" ${index === 0 ? `y="${num(baseline(top, metrics))}"` : `dy="${num(metrics.leading)}"`}>${xmlEscape(line)}${index < lines.length - 1 ? ' ' : ''}</tspan>`).join('');
  return `<text class="${className}"${anchor === 'end' ? ' text-anchor="end"' : ''}>${spans}</text>`;
}
/** An evidence mark at 16 units (the kit's 24-unit shapes): confirmed, or not confirmed (dashed ring). */
function mark(kind: 'confirmed' | 'open', x: number, top: number): string {
  const shape = kind === 'confirmed' ? '<circle cx="12" cy="12" r="10" class="mark-confirmed"/><path d="M7.7 12.4l3 3 5.6-6" class="mark-check"/>' : '<circle cx="12" cy="12" r="9" class="mark-open" stroke-dasharray="2.4 3"/>';
  return `<g transform="translate(${num(x)} ${num(top)}) scale(${num(16 / 24)})" aria-hidden="true">${shape}</g>`;
}
interface Block { markup: string; height: number }
/** A column of blocks; when it is taller than `room`, it is drawn smaller as a whole, so no caveat is cut. */
function column(blocks: readonly Block[], gap: number, x: number, top: number, room: number): string {
  let y = 0;
  const parts: string[] = [];
  for (const block of blocks) { parts.push(`<g transform="translate(0 ${num(y)})">${block.markup}</g>`); y += block.height + gap; }
  const height = Math.max(0, y - gap), scale = height > room ? room / height : 1;
  return `<g transform="translate(${num(x)} ${num(top)})${scale < 1 ? ` scale(${num(Math.floor(scale * 1000) / 1000)})` : ''}">${parts.join('')}</g>`;
}

interface Fact { kind: 'confirmed' | 'open'; text: string }
/** The evidence of a report, in words: verification, mirror, isolation, model, runs without a verdict, interruption. */
function facts(report: BenchReportView, verification: VerificationInput, language: Language): Fact[] {
  const t = TEXT[language], out: Fact[] = [];
  // Only a re-verified report confirms what it says about the mirror and the isolation;
  // otherwise these are claims of the file, with the same words and the open mark.
  const v = verificationFacts(verification), confirmed = v.level === 're-verified' ? 'confirmed' : 'open';
  out.push(v.level === 're-verified' ? { kind: 'confirmed', text: t.cardReverified } : { kind: 'open', text: t.cardConsistency });
  // Values a parser this Practonaut does not ship read stay the report's claims: never a confirmed mark.
  if (v.claims) out.push({ kind: 'open', text: t.cardClientClaims });
  if (report.verdictLevel === 'session') out.push(report.environment.mirror === 'required' ? { kind: confirmed, text: t.cardMirrorOn } : { kind: 'open', text: t.cardMirrorOff });
  if (report.toolchain.kind === 'foreign-mcp') out.push({ kind: 'open', text: t.cardNoSandbox });
  const isolation = report.agent.isolation, presetConfirmed = v.claims ? 'open' : confirmed;
  out.push(isolation === 'builtin-baseline' ? { kind: confirmed, text: t.cardIsolationBuiltin } : isolation === 'tool-restricted-preset' ? { kind: presetConfirmed, text: t.cardIsolationPreset }
    : isolation === 'template-unrestricted' ? { kind: 'open', text: t.cardIsolationTemplate } : { kind: 'open', text: t.cardIsolationUnrecorded });
  if (report.agent.kind !== 'builtin') {
    const model = report.agent.model;
    out.push({ kind: 'open', text: model === null ? t.cardModelNone : fill(language, report.agent.modelSource === 'command-output' ? t.cardModelCommand : t.cardModelClient, { model }) });
  }
  const unjudged = (report.runs as readonly ViewRun[]).filter(run => run.checker === null).length;
  if (unjudged) out.push({ kind: 'open', text: fill(language, t.cardUnjudged, { n: unjudged }) });
  if (report.interrupted) out.push({ kind: 'open', text: fill(language, t.cardInterrupted, { runs: report.runs.length, planned: report.interrupted.plannedRuns }) });
  return out;
}
/** The headline numbers in one unit, the instance the interval is over: with one run per instance
 * "16/16 passed … over 16 instances (one run each)", with repeats "10/12 instances passed" and the runs. */
function result(report: BenchReportView, language: Language): { fraction: string; words: string; interval: string; runs: string | null } {
  const t = TEXT[language], instances = instanceOutcome(report.runs), s = report.summary;
  const interval = intervalPercent(instances.passed, instances.instances);
  const intervalText = fill(language, instances.repeated ? t.interval : t.cardIntervalOnce, { low: interval.low, high: interval.high, instances: fill(language, t.instanceCount, { n: instances.instances }) });
  if (!instances.repeated) return { fraction: rateText(s.passed, s.runs, language), words: t.cardWordsPassed, interval: intervalText, runs: null };
  return { fraction: rateText(instances.passed, instances.instances, language), words: fill(language, t.cardWordsInstances, { n: instances.instances }), interval: intervalText, runs: rateText(s.passed, s.runs, language) };
}
const worldLine = (report: BenchReportView, t: Words, language: Language): string => {
  const world = report.environment.world;
  return fill(language, world.source === 'library' ? t.cardWorldLibrary : t.cardWorldOwn, { world: world.worldId, version: world.version });
};
/** The accessible name: the report's whole header line, as the terminal prints it. */
const accessibleName = (report: BenchReportView, language: Language, verification: VerificationInput): string => `${TEXT[language].title}: ${report.agent.name} · ${headline(report, language, verification).join(' · ')}`;

/** The card of a report in one theme: an SVG of 1280 × 640 px. */
export function renderCard(input: ReportInput, tokensCss: string, theme: Theme, language: Language = 'en', verification: VerificationInput = 'consistency-checked'): string {
  const report = asView(input);
  const t = TEXT[language], tokens = tokenThemes(tokensCss)[theme], all = rules();
  const m = (className: string): Metrics => metricsOf(className, tokens, all);
  const space = (step: number): number => numeric(`--pn-space-${step}`, tokens);
  const padX = space(8), padY = space(6), contentWidth = VIEW.width - 2 * padX, right = VIEW.width - padX;
  const parts: string[] = [`<rect class="card-bg" width="${VIEW.width}" height="${VIEW.height}"/>`];

  // Header: what this is and when, whose runs, the label.
  const eyebrow = m('card-eyebrow'), title = m('card-title'), label = m('card-label');
  // The verdict level beside what this is, also for a session report (PADR-0044 decision 1).
  const level = report.verdictLevel === 'session' ? t.badgeLevelSession : t.badgeLevelArtifact;
  parts.push(paragraph('card-eyebrow', [`${t.title} · ${level}`.toLocaleUpperCase(language)], padX, padY, eyebrow), paragraph('card-date', [report.createdAt.slice(0, 10)], right, padY, m('card-date'), 'end'));
  let y = padY + eyebrow.leading + space(2);
  parts.push(paragraph('card-title', wrap(report.agent.name, contentWidth, title, 1), padX, y, title));
  y += title.leading;
  if (report.label !== undefined) { parts.push(paragraph('card-label', wrap(`${t.label}: ${report.label}`, contentWidth, label, 1), padX, y, label)); y += label.leading; }
  y += space(3);
  parts.push(`<line class="card-divider" x1="${padX}" y1="${num(y)}" x2="${right}" y2="${num(y)}"/>`);
  const top = y + space(3);

  // Footer, from the bottom: the world, then the caveat about what these runs describe and that they are not sealed.
  const footer = m('card-footer');
  const caveat = wrap(t.cardCaveat, contentWidth, footer);
  const caveatTop = VIEW.height - padY - caveat.length * footer.leading, worldTop = caveatTop - footer.leading;
  parts.push(paragraph('card-footer', wrap(worldLine(report, t, language), contentWidth, footer, 1), padX, worldTop, footer), paragraph('card-footer', caveat, padX, caveatTop, footer));
  const room = worldTop - space(3) - top;

  // Left: the result. The fraction is the headline; the words follow on its line when they fit.
  const gutter = space(8), leftWidth = (contentWidth - gutter) * 0.47, rightX = padX + leftWidth + gutter, rightWidth = right - rightX;
  const numbers = result(report, language), words = m('card-words');
  const heroIn = (className: 'card-fraction' | 'card-fraction-compact'): Block => {
    const fraction = m(className);
    if (width(numbers.fraction, fraction) + space(2) + width(numbers.words, words) <= leftWidth) {
      return { markup: `<text class="${className}" x="0" y="${num(baseline(0, fraction))}">${xmlEscape(numbers.fraction)}<tspan class="card-words" dx="${space(1)}"> ${xmlEscape(numbers.words)}</tspan></text>`, height: fraction.leading };
    }
    const lines = wrap(numbers.words, leftWidth, words);
    return { markup: paragraph(className, [numbers.fraction], 0, 0, fraction) + paragraph('card-words', lines, 0, fraction.leading, words), height: fraction.leading + lines.length * words.leading };
  };
  const text = (className: string, value: string): Block => { const metrics = m(className), lines = wrap(value, leftWidth, metrics); return { markup: paragraph(className, lines, 0, 0, metrics), height: lines.length * metrics.leading }; };
  // n, and with repeats the runs that passed beside it: "n = 18 runs, 14/18 passed · 3 seeds · 3 repeats".
  const runs = fill(language, t.runCount, { n: report.summary.runs });
  const n = `n = ${[numbers.runs ? fill(language, t.cardRunsPassed, { runs, fraction: numbers.runs }) : runs, fill(language, t.seedCount, { n: report.settings.seeds.length }), fill(language, t.repeatCount, { n: report.settings.repeats })].join(' · ')}`;
  // The fraction in Display and the sample in Subhead, or one role down each (Large Title, Footnote)
  // when the column would not fit otherwise, as the facts do.
  const leftIn = (compact: boolean): { blocks: Block[]; gap: number; height: number } => {
    const secondary = compact ? 'card-rule-text' : 'card-sample', gap = compact ? space(1) : space(2);
    const blocks = [heroIn(compact ? 'card-fraction-compact' : 'card-fraction'), text('card-interval', numbers.interval), text(secondary, n), ...(numbers.runs ? [text('card-rule-text', t.cardInstanceRule)] : [])];
    return { blocks, gap, height: blocks.reduce((sum, block) => sum + block.height, 0) + gap * (blocks.length - 1) };
  };
  const regularLeft = leftIn(false), left = regularLeft.height <= room ? regularLeft : leftIn(true);
  parts.push(column(left.blocks, left.gap, padX, top, room));

  // Right: the evidence behind the number, each fact with its mark and its words. When the facts do not
  // fit in Subhead they are set in Footnote, the next role of the type scale (never an ad-hoc size); only
  // what still does not fit is drawn smaller as a whole.
  const markSize = 16, textX = markSize + space(2), items = facts(report, verification, language);
  const evidenceIn = (className: 'card-fact' | 'card-fact-compact', gap: number): { blocks: Block[]; height: number } => {
    const fact = m(className);
    const blocks = items.map(item => {
      const lines = wrap(item.text, rightWidth - textX, fact);
      return { markup: mark(item.kind, 0, (fact.leading - markSize) / 2) + paragraph(className, lines, textX, 0, fact), height: lines.length * fact.leading };
    });
    return { blocks, height: blocks.reduce((sum, block) => sum + block.height, 0) + gap * (blocks.length - 1) };
  };
  const regular = evidenceIn('card-fact', space(3));
  const evidence = regular.height <= room ? { ...regular, gap: space(3) } : { ...evidenceIn('card-fact-compact', space(1)), gap: space(1) };
  parts.push(column(evidence.blocks, evidence.gap, rightX, top, room));

  const name = xmlEscape(accessibleName(report, language, verification));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_SIZE.width}" height="${CARD_SIZE.height}" viewBox="0 0 ${VIEW.width} ${VIEW.height}" role="img" aria-label="${name}" xml:lang="${language}">`
    + `<title>${name}</title><style>${stylesheet(tokens, ['card-', 'mark-'])}</style>${parts.join('')}</svg>\n`;
}

/** The badge: one line in a chip, light, and dark where the reader's system prefers it. */
export function renderBadge(input: ReportInput, tokensCss: string, language: Language = 'en', verification: VerificationInput = 'consistency-checked'): string {
  const report = asView(input);
  const t = TEXT[language], themes = tokenThemes(tokensCss), tokens = themes.light, all = rules();
  const metrics = metricsOf('badge-text', tokens, all), name = { ...metrics, bold: true };
  const instances = instanceOutcome(report.runs), interval = intervalPercent(instances.passed, instances.instances);
  const fraction = instances.repeated ? fill(language, t.badgeInstances, { fraction: rateText(instances.passed, instances.instances, language) }) : fill(language, t.headlinePassed, { fraction: rateText(report.summary.passed, report.summary.runs, language) });
  const isolation = report.agent.isolation === null ? t.badgeUnrecorded : { 'builtin-baseline': t.badgeBuiltin, 'tool-restricted-preset': t.badgePreset, 'template-unrestricted': t.badgeTemplate }[report.agent.isolation];
  const unjudged = (report.runs as readonly ViewRun[]).filter(run => run.checker === null).length;
  const level = report.verdictLevel === 'session' ? t.badgeLevelSession : t.badgeLevelArtifact;
  const parts = [fraction, fill(language, t.badgeInterval, { low: interval.low, high: interval.high }), level, verificationFacts(verification).level === 're-verified' ? (verificationFacts(verification).claims ? t.badgeReverifiedClaims : t.badgeReverified) : t.badgeConsistency, isolation,
    ...(report.toolchain.kind === 'foreign-mcp' ? [t.badgeNoSandbox] : []), ...(report.environment.mirror === 'off' ? [t.badgeModelOnly] : []), ...(unjudged ? [fill(language, t.badgeUnjudged, { n: unjudged })] : []), ...(report.interrupted ? [t.badgeInterrupted] : [])];
  const rest = ` · ${parts.join(' · ')}`;
  const pad = numeric('--pn-space-2', tokens), height = numeric('--pn-space-6', tokens), hairline = numeric('--pn-stroke-hairline', tokens);
  // The text is held to its width by textLength, so it fits its chip in any font. That width sits
  // between narrow fonts (SF Pro, Segoe UI) and the wide ones the card's estimate covers (DejaVu Sans,
  // Verdana): spacing grows or shrinks by a few percent instead of opening up in a narrow font.
  const textWidth = Math.ceil((width(t.badgeName, name) + width(rest, metrics)) / BADGE_MIDDLE), total = textWidth + 2 * pad;
  const label = xmlEscape(accessibleName(report, language, verification));
  const style = `${stylesheet(tokens, ['badge-'])}@media (prefers-color-scheme:dark){${stylesheet(themes.dark, ['badge-'])}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${height}" viewBox="0 0 ${total} ${height}" role="img" aria-label="${label}" xml:lang="${language}">`
    + `<title>${label}</title><style>${style}</style>`
    + `<rect class="badge-bg" x="${num(hairline / 2)}" y="${num(hairline / 2)}" width="${num(total - hairline)}" height="${num(height - hairline)}" rx="${num((height - hairline) / 2)}"/>`
    + `<text class="badge-text" x="${pad}" y="${num(baseline(0, { ...metrics, leading: height }))}" textLength="${textWidth}" lengthAdjust="spacing"><tspan class="badge-name">${xmlEscape(t.badgeName)}</tspan>${xmlEscape(rest)}</text></svg>\n`;
}
