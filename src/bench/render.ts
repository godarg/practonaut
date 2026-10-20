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
import { BENCH_SCHEMA_V3, type VerdictLevel } from './report.ts';
import { asView, type ArtifactReportView, type BenchReportView, type ReportInput, type SessionReportView, type ViewArtifactRun, type ViewRun, type ViewSessionRun } from './view.ts';
import { readableText } from '../cli/output.ts';
import { aggregateInstance } from './stats.ts';
import { intervalPercent, number, rateText, type Language } from './rates.ts';
import { fill, sentence, TEXT, type Words } from './report-text.ts';
import { explanationKey, type ConditionDetail, type LayoutMark, type ReportDetails, type RunDetail, type TrajectoryRow } from './details.ts';
import type { BoardObject } from './schematic.ts';
import { styleNames } from '../world/style-names.ts';

export type Verification = 'consistency-checked' | 're-verified';
/** What `--verify` established beyond its level (PADR-0044): the parsers whose values it could not
 * re-derive (a newer Practonaut's parser, an unknown preset), and whether a preset's name and command
 * were checked against this Practonaut's. */
export interface VerificationDetail { level: Verification; notRederived?: readonly string[]; preset?: 'checked' | 'not-checked' | null }
export type VerificationInput = Verification | VerificationDetail;
/** `claims`: re-verified, but the client's own values (model, offered tools and so a preset's isolation,
 * billing) are the report's claims — no surface marks them confirmed. */
export interface VerificationFacts { level: Verification; claims: boolean; notRederived: readonly string[]; preset: 'checked' | 'not-checked' | null }
export function verificationFacts(input: VerificationInput): VerificationFacts {
  const detail: VerificationDetail = typeof input === 'string' ? { level: input } : input, notRederived = detail.notRederived ?? [], preset = detail.preset ?? null;
  return { level: detail.level, notRederived, preset, claims: detail.level === 're-verified' && (notRederived.length > 0 || preset === 'not-checked') };
}

/** Report text is data from a file: control, format and bidi characters are shown escaped, never interpreted by a terminal. */
const shown = (value: string): string => readableText(value);
/** Quoted text (a label, a name) inside a sentence: kept as written. */
const QUOTED = /([“„«‚‘"][^“”„«»‚‘’"]*[”“»’"])/u;
/** A number and the word it counts, or a word and its number ("6 runs", "seed 1", "after #3"), stay on
 * one line: a no-break space joins them, outside quoted data, which keeps its own characters; so do
 * the two sides of an equals sign ("p = 0.500", "n = 6"), a comparison and its number ("> 1"), a
 * number and its percent sign ("91 %"), and a range ("9\u201391": a word joiner after the dash). */
const joined = (value: string): string => value.split(QUOTED).map((part, index) => index % 2 ? part : part.replace(/(\d) (?=\p{L})/gu, '$1\u00a0').replace(/(\p{L}) (?=#?\d)/gu, '$1\u00a0').replace(/(\S) = (?=\S)/gu, '$1\u00a0=\u00a0')
  .replace(/(\d) %/gu, '$1\u00a0%').replace(/(\d)\u2013(?=\d)/gu, '$1\u2013\u2060').replace(/([<>\u2264\u2265]) (?=\d)/gu, '$1\u00a0')).join('');
const ENTITIES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value: string): string => joined(readableText(value)).replace(/[&<>"']/g, char => ENTITIES[char]!);
/** A formal condition's text: numbers are not joined to words (joined, "= 3 und" became one run that a
 * narrow line had to cut inside a word, design review R3), and each comparison (left operand, operator,
 * right operand) is one box (`.op`, inline-block, never wider than the line) that moves to the next
 * line whole (design reviews R4, R5). So a line ends on an operator only inside a comparison wider than
 * the line: then the operator ends the line with its left operand ("(s.Beschriftung =" / the label),
 * never alone. A right operand is a word, a quoted string up to its closing quote, or the fixed value
 * "unattached" / "nicht angebunden"; one that fits a line (`ID_MAX`) never breaks inside. */
const FORMAL_OPERAND = String.raw`(?:"(?:[^"\\]|\\.)*"|nicht angebunden|unattached)[)\]]*|\S+`;
const FORMAL_COMPARISON = new RegExp(String.raw`(\S+) ([=≈<>≤≥]) (${FORMAL_OPERAND})`, 'u');
const FORMAL_PAIR = new RegExp(String.raw`(?<=^|\s)([=≈<>≤≥]) (${FORMAL_OPERAND})`, 'u');
const escapeFormal = (value: string): string => {
  const text = (part: string): string => part.replace(/[&<>"']/g, char => ENTITIES[char]!);
  const operand = (part: string): string => text(part.length <= ID_MAX ? part.replace(/ /gu, '\u00a0') : part);
  // An operator whose left operand closed the comparison before it ("… = nicht angebunden) = 1") still
  // travels with its right operand.
  const pairs = (part: string): string => {
    const pieces = part.split(FORMAL_PAIR);
    return pieces.map((piece, index) => index % 3 === 0 ? text(piece) : index % 3 === 1 ? `<span class="op">${text(piece)} ${operand(pieces[index + 1]!)}</span>` : '').join('');
  };
  const parts = readableText(value).split(FORMAL_COMPARISON);
  return parts.map((part, index) => index % 4 === 0 ? pairs(part) : index % 4 === 1 ? `<span class="op">${text(part)} ${text(parts[index + 1]!)} ${operand(parts[index + 2]!)}</span>` : '').join('');
};
/** Escaped, with a number kept with the word it counts ("3 runs") but a word free to break before the
 * number after it ("3 of" / "3 runs"): text in a narrow cell, which must shrink to its cell (R4). */
export const escapeBreakable = (value: string): string => readableText(value).split(QUOTED).map((part, index) => index % 2 ? part : part.replace(/(\d) (?=\p{L})/gu, '$1\u00a0')).join('').replace(/[&<>"']/g, char => ENTITIES[char]!);
const esc = escapeHtml;
/** A command named in prose ("practonaut report", "report --verify") and a command-line flag: code, set
 * in mono like every command; a flag stays on one line, so a reader who copies it gets it whole. */
const COMMAND = String.raw`(?:practonaut )?(?:report|compare|bench)(?= --)|practonaut (?:report|compare|bench|challenge)\b|--[a-z][a-z-]*`;
/** Proper names the page's hyphenation must not split ("Prac-tonaut", "McNe-mar", "Wil-son"). */
export const PROPER_NAMES: readonly string[] = ['Practonaut', 'McNemar', 'Excalidraw', 'Wilson'];
const NAMES = String.raw`(?<![\p{L}\p{N}])(?:${PROPER_NAMES.join('|')})(?![\p{L}\p{N}])`;
/** The longest word kept on one line: an identifier up to this length never breaks, not even at its own
 * hyphens (design-language \u00a710.5, design review R2); a longer one, such as a hash, may wrap. */
export const ID_MAX = 32;
/** Data (a quoted label, an id, a command) as words: each word of at most `ID_MAX` characters one
 * unbreakable unit (`id`); `code`: set in mono. */
export function dataWords(value: string, tag: 'data' | 'code' = 'data'): string {
  const word = (text: string): string => {
    const id = text.length <= ID_MAX;
    return tag === 'code' ? `<code${id ? ' class="id"' : ''}>${esc(text)}</code>` : `<span class="data${id ? ' id' : ''}">${esc(text)}</span>`;
  };
  return readableText(value).split(/(\s+)/u).map((part, index) => index % 2 ? esc(part) : part ? word(part) : '').join('');
}
/** Escaped prose whose quoted parts (labels, names) and the given ids are data, and whose commands and
 * flags are code: never hyphenated; ids, commands and flags each word on one line. `code`: the ids are set as code (mono), as
 * a table or a compare list names a task. Proper names are never hyphenated either. */
export function prose(value: string, ids: readonly string[] = [], idTag: 'data' | 'code' = 'data'): string {
  const names = [...new Set(ids)].filter(Boolean).sort((a, b) => b.length - a.length).map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // An id is matched as a whole word, never inside another (a task "T" is not the T of "The").
  const known = new Set(ids), pattern = new RegExp(`(${[...names.map(name => String.raw`(?<![\p{L}\p{N}_-])${name}(?![\p{L}\p{N}_-])`), COMMAND, NAMES].join('|')})`, 'u');
  const piece = (part: string): string => known.has(part) ? dataWords(part, idTag)
    : part.startsWith('--') ? `<code class="flag">${esc(part)}</code>`
    : PROPER_NAMES.includes(part) ? `<span class="name">${esc(part)}</span>` : dataWords(part, 'code');
  // A quoted label is the author's text: never hyphenated, but it wraps like text (a long German
  // compound may not fit a phone's line); identifiers are the ones that never break.
  return readableText(value).split(QUOTED).map((part, index) => index % 2 ? `<span class="data quoted">${esc(part)}</span>`
    : part.split(pattern).map((text, at) => at % 2 ? piece(text) : esc(text)).join('')).join('');
}

/** Words for the details loader (picture labels and legends) in the page's language. */
export function detailWords(language: Language): { group: string; loose: string; finalBoard: string; target: string; canvas: string } {
  const t = TEXT[language];
  return { group: t.group, loose: t.loose, finalBoard: t.finalBoard, target: t.target, canvas: t.canvas };
}

// The kit's status shapes and info mark (src/player/ui/icons.ts), drawn inline: shape first, colour second.
const SHAPES = {
  pass: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M7.7 12.4l3 3 5.6-6" stroke="var(--pn-color-surface)" stroke-width="2.2"/>',
  fail: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M9 9l6 6M15 9l-6 6" stroke="var(--pn-color-surface)" stroke-width="2.2"/>',
  // No verdict: the kit's dashed ring (a dash means "not known", design-language §7.4).
  unknown: '<circle cx="12" cy="12" r="9" stroke-dasharray="2.4 3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.8h.01" stroke-width="2.6"/>',
  // A warning is the kit's triangle (design-language §7.3), never the info mark.
  warning: '<path d="M10.3 4.9L2.9 17.7A2 2 0 004.6 20.7h14.8a2 2 0 001.7-3L13.7 4.9a2 2 0 00-3.4 0z"/><path d="M12 10v4.5"/><path d="M12 17.4h.01" stroke-width="2.6"/>',
} as const;
/** A status mark next to its word (the word is what a screen reader reads). */
export function statusIcon(kind: 'pass' | 'fail' | 'unknown'): string {
  return `<svg class="status-icon ${kind}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SHAPES[kind]}</svg>`;
}
const bannerIcon = (shape: 'info' | 'warning'): string => `<svg class="banner-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SHAPES[shape]}</svg>`;
/** A banner: a statement about the situation. `tone` neutral (fill), unknown (hatched: something is not
 * known here), warning (the triangle). */
export function banner(tone: 'neutral' | 'unknown' | 'warning', title: string, body: string): string {
  return `<div class="banner ${tone}" role="note">${bannerIcon(tone === 'warning' ? 'warning' : 'info')}<div class="banner-body"><p class="banner-title">${esc(title)}</p>${body}</div></div>`;
}
/** Facts as neutral chips (a chip is a fact, never an action); `ids` inside them (a model, a world) are
 * data. A chip is a flex box, so its words sit in one span: one flex item, one run of text whose spaces
 * stay (each piece a flex item of its own would lose the spaces between them). */
export function chips(label: string, facts: readonly string[], ids: readonly string[] = []): string {
  return `<ul class="chips" aria-label="${esc(label)}">${facts.map(fact => `<li class="chip"><span>${prose(fact, ids)}</span></li>`).join('')}</ul>`;
}
/** A table that stacks into one block per row below 40rem (`many` columns: below 60rem): every cell
 * names its column. `capped` bounds a column of lists (it wraps instead of widening the table); `prose`
 * marks a column of sentences, which may hyphenate (a stacked cell is narrow). */
export function stackedTable(label: string, labelledBy: string | null, head: ReadonlyArray<{ text: string; numeric?: boolean; wide?: boolean; capped?: boolean; prose?: boolean }>, rows: ReadonlyArray<ReadonlyArray<string>>, many = false, compact = false): string {
  const region = labelledBy ? `aria-labelledby="${labelledBy}"` : `aria-label="${esc(label)}"`;
  const header = head.map(cell => `<th scope="col"${cell.capped ? ' class="text capped"' : cell.numeric ? '' : ' class="text"'}>${esc(cell.text)}</th>`).join('');
  const kind = (cell: { numeric?: boolean; wide?: boolean; prose?: boolean }): string => cell.numeric && !cell.wide ? '' : ` class="${['text', ...(cell.wide ? ['wide'] : []), ...(cell.prose ? ['prose'] : [])].join(' ')}"`;
  const body = rows.map(row => `<tr>${row.map((cell, index) => `<td data-label="${esc(head[index]!.text)}"${kind(head[index]!)}>${cell}</td>`).join('')}</tr>`).join('');
  return `<div class="scroll ${many ? 'stack-many' : 'stack'}${compact ? ' compact' : ''}" role="region" ${region} tabindex="0"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
}
/** The first sentence of an explanation (the factual part); the full text stays under Technical details. */
export function firstSentence(text: string): string {
  const match = /^(.+?[.!?])(?:\s+(?=\p{Lu})|$)/u.exec(text.trim());
  return match ? match[1]! : text.trim();
}

/** Instances (task × seed) and how many passed: at least half of all their runs passed; a run that
 * was not judged counts as not passed (PADR-0039 B.1). */
export function instanceOutcome(runs: ReadonlyArray<{ taskId: string; seed: number; checker: unknown; pass: boolean }>): { passed: number; instances: number; repeated: boolean } {
  const byInstance = new Map<string, Array<boolean | null>>();
  for (const run of runs) { const key = `${run.taskId}\u0000${run.seed}`; byInstance.set(key, [...(byInstance.get(key) ?? []), run.checker === null ? null : run.pass]); }
  const outcomes = [...byInstance.values()];
  return { passed: outcomes.filter(repeats => aggregateInstance(repeats).outcome === 'pass').length, instances: outcomes.length, repeated: outcomes.some(repeats => repeats.length > 1) };
}

function isolationText(report: BenchReportView, t: Words): string {
  if (report.agent.isolation === null) return t.isolationUnrecorded;
  return { 'builtin-baseline': t.isolationBuiltin, 'tool-restricted-preset': t.isolationPreset, 'template-unrestricted': t.isolationTemplate }[report.agent.isolation];
}
/** A /1 report named the bundled library without storing a world (no package): id and version only. */
function worldText(report: BenchReportView, t: Words): string {
  const world = report.environment.world;
  if (world.package === null) return `${world.worldId} ${world.version}`;
  return `${world.worldId} ${world.version} (${world.source === 'library' ? t.worldLibrary : t.worldOwn})`;
}
/** How the runs were judged, in words (PADR-0044 decision 1): named on every surface, also for session
 * reports. The short form is a chip or a value in a sentence; the long one explains it in the settings. */
export const levelText = (level: VerdictLevel, language: Language): string => level === 'session' ? TEXT[language].levelSession : TEXT[language].levelArtifact;
export const levelShort = (level: VerdictLevel, language: Language): string => level === 'session' ? TEXT[language].levelSession : TEXT[language].levelArtifactShort;
/** Applications by adapter id, as their own names spell them; another adapter shows its id. */
const APP_NAMES: Readonly<Record<string, string>> = Object.freeze({ excalidraw: 'Excalidraw', drawio: 'draw.io' });
export const appName = (adapterId: string): string => APP_NAMES[adapterId] ?? adapterId;
/** A foreign MCP server's code runs as the same OS user, without a sandbox (PADR-0043 decision 8): every
 * surface says so — the report page in a warning banner, a compare side as a chip. */
export const noSandbox = (report: Pick<BenchReportView, 'toolchain'>, language: Language): string[] => report.toolchain.kind === 'foreign-mcp' ? [TEXT[language].chipNoSandbox] : [];
/** The toolchain in words: Practonaut's own tools (how many; their names are under Technical details),
 * or the foreign server and its reading rules. */
export function toolchainText(report: BenchReportView, language: Language): string {
  const t = TEXT[language], toolchain = report.toolchain;
  if (toolchain.kind === 'foreign-mcp') return fill(language, t.toolchainForeign, { server: toolchain.server.name, version: toolchain.server.version, rules: `${toolchain.rules.format} ${toolchain.rules.version}` });
  return toolchain.tools === null ? t.toolchainPractonautUnrecorded : fill(language, t.toolchainPractonaut, { n: toolchain.tools.length });
}
/** The identifiers in the toolchain's words (server and reading rules), set as data. */
const toolchainIds = (report: BenchReportView): string[] => report.toolchain.kind === 'foreign-mcp' ? [report.toolchain.server.name, report.toolchain.rules.format] : [];
/** The model id and the agent's name inside a chip or a line: data. */
export const agentIds = (report: Pick<BenchReportView, 'agent'>): string[] => [report.agent.name, ...(report.agent.model === null ? [] : [report.agent.model])];

/** The result half of the header line: fractions and the interval (PADR-0039 B.1). */
export function headlineResult(report: BenchReportView, language: Language): string[] {
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
/** The provenance half: how runs were judged, verification, mirror (session level), isolation and the
 * self-reported model. When the client's own values were not re-derived, the verification says so,
 * once; the isolation and the model keep their words (the card marks them with the open mark). A
 * foreign server's missing sandbox is the page's warning banner and its own terminal line. */
export function provenance(report: BenchReportView, language: Language, verification: VerificationInput): string[] {
  const t = TEXT[language], v = verificationFacts(verification);
  const mirror = report.verdictLevel === 'session' ? [report.environment.mirror === 'required' ? t.mirrorOn : t.mirrorOff] : [];
  const parts = [levelShort(report.verdictLevel, language), v.level === 're-verified' ? (v.claims ? t.reverifiedClaimsShort : t.reverifiedShort) : t.consistencyShort, ...mirror, isolationText(report, t)];
  if (report.agent.kind !== 'builtin') parts.push(modelHeadline(report, language));
  return parts;
}
/** The whole header line (terminal): result, interval, verification, mirror, isolation, model. */
export function headline(report: BenchReportView, language: Language, verification: VerificationInput): string[] {
  return [...headlineResult(report, language), ...provenance(report, language, verification)];
}
/** The reported model with where it came from (never verified): the preset client's own init event,
 * or an init line in a command template's output. */
export function modelHeadline(report: Pick<BenchReportView, 'agent'>, language: Language): string {
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
/** Task limits (PADR-0040), a setting of the bench: a task's own, from the stored world, and the
 * session's --checks. */
function limitFacts(report: BenchReportView, t: Words, language: Language): Array<[label: string, value: string]> {
  const facts: Array<[string, string]> = [], limits = report.environment.world.limits ?? [];
  if (limits.length) facts.push([t.taskLimits, limits.map(entry => `${entry.taskId}: ${[...(entry.actions !== undefined ? [fill(language, t.limitActions, { n: entry.actions })] : []), ...(entry.checks !== undefined ? [fill(language, t.limitChecks, { n: entry.checks })] : [])].join(', ')}`).join('; ')]);
  if (report.settings.checks !== undefined) facts.push([t.checksSetting, String(report.settings.checks)]);
  return facts;
}
/** bench/2 facts that are identifiers rather than findings: shown under Technical details. */
function technicalFacts(report: BenchReportView, t: Words): Array<[label: string, value: string]> {
  const facts: Array<[string, string]> = [];
  if (report.agent.command.length) facts.push([t.commandLabel, commandLine(report.agent.command)]);
  facts.push([t.worldContentHash, report.environment.world.contentHash]);
  const generated = report.environment.world.generated;
  if (generated.length) facts.push([t.generated, generated.map(entry => `${entry.taskId} (${entry.id} ${entry.version}, seed ${entry.seed})`).join(', ')]);
  if (report.agent.apiKeySource !== null) facts.push([t.apiKeySource, report.agent.apiKeySource]);
  if (report.agent.keptEnv?.length) facts.push([t.keptEnv, report.agent.keptEnv.join(', ')]);
  // The toolchain's identifiers: Practonaut's tool names, a foreign server's toolchain id.
  if (report.toolchain.kind === 'practonaut' && report.toolchain.tools?.length) facts.push([t.toolNames, report.toolchain.tools.join(', ')]);
  if (report.toolchain.kind === 'foreign-mcp') facts.push([t.toolchainId, report.toolchain.id]);
  return facts;
}
const sampleLine = (report: BenchReportView, language: Language): string => {
  const t = TEXT[language];
  return `n = ${[fill(language, t.runCount, { n: report.summary.runs }), fill(language, t.seedCount, { n: report.settings.seeds.length }), fill(language, t.repeatCount, { n: report.settings.repeats })].join(' · ')}`;
};
const planLine = (report: BenchReportView, language: Language): string => {
  const t = TEXT[language], plan = [fill(language, t.taskCount, { n: report.settings.tasks.length }), fill(language, t.seedCount, { n: report.settings.seeds.length }), fill(language, t.repeatCount, { n: report.settings.repeats })].join(' × ');
  // settings.maxActions caps the agent's calls that reach the session, or at artifact level the proxy's forwarded tool calls (decision 1).
  return report.verdictLevel === 'artifact' ? fill(language, t.tasksSeedsArtifact, { plan, timeout: report.settings.timeoutSeconds, calls: report.settings.maxActions })
    : fill(language, t.tasksSeeds, { plan, timeout: report.settings.timeoutSeconds, actions: report.settings.maxActions });
};
const fixed = (value: number | null, digits: number, language: Language): string => value === null ? '—' : number(value, digits, language);
const seconds = (ms: number | null, language: Language): string => ms === null ? '—' : `${number(ms / 1000, 1, language)} s`;
/** Tasks whose reference is a proven minimal solution (PADR-0040); none for bench/1. */
const minimalTasks = (report: BenchReportView): ReadonlySet<string> => new Set(report.references === 'not-recorded' ? [] : (report.references?.tasks ?? []).filter(task => task.minimal === true).map(task => task.taskId));
const referenceCell = (report: BenchReportView, taskId: string, value: number | null, t: Words): string => value === null ? t.noReference : minimalTasks(report).has(taskId) ? `${value} (${t.minimal})` : String(value);
/** Efficiency only where a validated reference exists; otherwise "no reference". It is "vs minimal
 * length" only when every referenced task's reference is proven minimal, else "vs reference length". */
function efficiencyText(report: SessionReportView, language: Language): { label: string; direction: string; value: string; detail?: string } {
  const t = TEXT[language], tasks = report.summary.byTask, referenced = tasks.filter(task => task.referenceActions !== null), minimal = minimalTasks(report);
  const proven = referenced.filter(task => minimal.has(task.taskId)).length, all = referenced.length > 0 && proven === referenced.length;
  const label = all ? t.efficiencyMinimal : t.efficiency, direction = all ? t.efficiencyMinimalDirection : t.efficiencyDirection;
  if (!referenced.length) return { label, direction, value: t.noReference };
  const value = fixed(report.summary.efficiencyVsReference, 2, language);
  const details = [...(referenced.length < tasks.length ? [fill(language, t.referencePartial, { n: referenced.length, m: tasks.length })] : []), ...(proven && !all ? [fill(language, t.minimalPartial, { n: proven, m: referenced.length })] : [])];
  return { label, direction, value, ...(details.length ? { detail: details.join(', ') } : {}) };
}
/** pass^k for k = repeats: the instances where all k repeats passed, of all instances (null with one repeat). */
function allRepeatsCount(report: BenchReportView): { all: number; instances: number } | null {
  const k = report.settings.repeats;
  if (k < 2) return null;
  const instances = new Map<string, ViewRun[]>();
  for (const run of report.runs) { const key = `${run.taskId}\u0000${run.seed}`; instances.set(key, [...(instances.get(key) ?? []), run]); }
  return { all: [...instances.values()].filter(runs => runs.length === k && runs.every(run => run.pass)).length, instances: instances.size };
}
function allRepeats(report: BenchReportView, language: Language): string | null {
  const count = allRepeatsCount(report);
  return count === null ? null : fill(language, TEXT[language].passHatAll, { k: report.settings.repeats, fraction: rateText(count.all, count.instances, language) });
}
/** Tokens, turns and cost summed over the runs whose client reported them (self-reported). */
function clientTotals(report: BenchReportView, language: Language): string | null {
  const t = TEXT[language], runs = (report.runs as readonly ViewRun[]).flatMap(run => run.client ? [run.client] : []);
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
const failuresFirst = <R extends { pass: boolean }>(runs: readonly R[]): R[] => [...runs.filter(run => !run.pass), ...runs.filter(run => run.pass)];
/** How the agent's run ended, in words (the code is under Technical details). */
export const statusWords = (run: Pick<ViewRun, 'status'>, t: Words): string => ({ completed: t.statusCompleted, timeout: t.statusTimeout, agent_failed: t.statusAgentFailed, infra_error: t.statusInfra })[run.status];
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
export const errorClassesOf = (run: ViewRun): string[] => run.verdictLevel === 'artifact' ? [...(run.checker?.artifact.errorClasses ?? [])] : [...new Set([...(run.checker?.session.errorClasses ?? []), ...(run.checker?.native?.errorClasses ?? [])])];
/** An error class's explanation: the run's stored checker output, else the bundled library's. */
function explanationOf(run: Pick<ViewRun, 'taskId' | 'seed'>, id: string, detail: RunDetail | undefined, details: ReportDetails | undefined, language: Language): string | null {
  const stored = detail?.errors.find(error => error.id === id)?.explanation ?? details?.explanations.get(explanationKey(run.taskId, run.seed, id));
  return stored ? stored[language] : null;
}

/** Why a run ended as it did, each state by name with its reason (PADR-0039 B.3): one item, one colon.
 * `code` (an action as it was called) follows `why` and precedes `tail`, shown as code. */
export interface State { name: string; why: string; code?: string; tail?: string; list?: string[] }
export function runStates(run: ViewSessionRun, detail: RunDetail | undefined, details: ReportDetails | undefined, report: SessionReportView, language: Language): State[] {
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

export function renderTable(input: ReportInput, language: Language = 'en', details?: ReportDetails, verification: VerificationInput = 'consistency-checked'): string {
  const report = asView(input);
  if (report.verdictLevel === 'artifact') return renderArtifactTable(report, language, verification);
  const t = TEXT[language], s = report.summary, lines: string[] = [];
  lines.push(`${t.title}  ${shown(report.agent.name)}`);
  // The header line (PADR-0039 B.1): fraction, interval, verification, mirror, isolation, model.
  lines.push(shown(headline(report, language, verification).join(' · ')));
  if (report.label !== undefined) lines.push(`${t.label}: ${shown(report.label)}`);
  if (report.environment.world.package !== null) lines.push(shown(`${t.world}: ${worldText(report, t)}`));
  for (const [label, value] of [...limitFacts(report, t, language), ...technicalFacts(report, t).filter(([label]) => label !== t.commandLabel)]) lines.push(shown(`${label}: ${value}`));
  lines.push(sampleLine(report, language));
  if (report.interrupted) lines.push(fill(language, t.interrupted, { runs: report.runs.length, planned: report.interrupted.plannedRuns }));
  lines.push(planLine(report, language));
  lines.push('');
  if (s.infraErrors) lines.push(fill(language, t.infraIncluded, { n: s.infraErrors }));
  const repeats = allRepeats(report, language);
  if (repeats) lines.push(repeats);
  lines.push(`${t.meanActions} ${fixed(s.meanActions, 1, language)}   ${t.meanActionsPassed} ${fixed(s.meanActionsPassed, 1, language)}   ${t.wall} ${seconds(s.meanWallMs, language)}`);
  const efficiency = efficiencyText(report, language);
  lines.push(`${efficiency.label} ${efficiency.value}${efficiency.detail ? `, ${efficiency.detail}` : ''}  (${efficiency.direction})`);
  const totals = clientTotals(report, language);
  if (totals) lines.push(totals);
  lines.push('');
  const header = [t.task, t.runs, t.passed, t.actions, t.reference, efficiency.label];
  const rows = s.byTask.map(task => [shown(task.taskId), String(task.runs), rateText(task.passed, task.runs, language), fixed(task.meanActions, 1, language), referenceCell(report, task.taskId, task.referenceActions, t), task.referenceActions === null ? t.noReference : fixed(task.efficiency, 2, language)]);
  const widths = header.map((head, column) => Math.max(head.length, ...rows.map(row => row[column]!.length)));
  const format = (row: string[]): string => row.map((cell, column) => column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)).join('  ');
  lines.push(format(header)); lines.push(widths.map(width => '─'.repeat(width)).join('  '));
  for (const row of rows) lines.push(format(row));
  const failed = report.runs.filter(run => !run.pass);
  if (failed.length) {
    lines.push('', fill(language, t.failuresHead, { n: failed.length, runs: fill(language, t.runCount, { n: s.runs }) }));
    for (const run of failed.slice(0, 20)) {
      // "?" marks a run without a verdict (counted as not passed), "✗" a judged failure.
      lines.push(`${run.checker === null ? '?' : '✗'} ${shown(run.id)}  ${run.checker === null ? t.noVerdictCounted : statusWords(run, t)}`);
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
/** A run's result: pass, fail, or — when the checker gave no verdict — the unknown mark, counted as not passed. */
const runResult = (run: Pick<ViewRun, 'checker' | 'pass'>, t: Words): string => run.checker === null ? `<span class="result unknown">${statusIcon('unknown')}${esc(t.noVerdictCounted)}</span>` : result(run.pass, t);
const figure = (label: string, value: string, detail?: string): string => `<div class="figure"><dt>${esc(label)}</dt><dd>${esc(value)}</dd>${detail ? `<dd class="detail">${esc(detail)}</dd>` : ''}</div>`;
/** A run's error classes in the runs table: each an identifier on one line. */
const errorCell = (run: ViewRun, t: Words): string => errorClassesOf(run).map(id => dataWords(id)).join(', ') || esc(t.none);
/** A "Technical details" disclosure holding label/value pairs (identifiers, codes, hashes). */
function technical(t: Words, facts: ReadonlyArray<[string, string]>): string {
  if (!facts.length) return '';
  return `<details class="tech"><summary>${esc(t.technical)}</summary><dl class="settings">${facts.map(([label, value]) => `<dt>${prose(label)}</dt><dd>${dataWords(value, 'code')}</dd>`).join('')}</dl></details>`;
}

function conditionsHtml(detail: RunDetail, language: Language): string {
  const t = TEXT[language];
  const missing = (reason: RunDetail['conditionsMissing']): string => reason === 'changed' ? t.missingChanged : reason === 'unreadable' ? t.missingUnreadable : reason === 'not-judged' ? t.missingNotJudged : t.missingNotRecorded;
  if (!detail.conditions) return `<p class="note">${esc(fill(language, t.conditionsMissing, { reason: missing(detail.conditionsMissing) }))}</p>`;
  const items = detail.conditions.map((condition, index) => {
    const kind = condition.met === null ? 'unknown' : condition.met ? 'pass' : 'fail';
    const word = condition.met === null ? t.conditionUnknown : condition.met ? t.conditionMet : t.conditionUnmet;
    return `<li class="condition"><span class="condition-number">${index + 1}</span>${statusIcon(kind)}<div><span class="condition-status ${kind}">${esc(word)}:</span> ${prose(condition.text[language])} <span class="history">(${esc(historyText(condition.history, language))})</span>${condition.formal ? `<span class="formal">${esc(t.formal)}: ${escapeFormal(condition.formal[language])}</span>` : ''}</div></li>`;
  }).join('');
  const note = detail.traceError ? `<p class="note">${esc(t.traceMissing)}</p>` : detail.conditionsMissing ? `<p class="note">${esc(fill(language, t.conditionsMissing, { reason: missing(detail.conditionsMissing) }))}</p>` : '';
  return `<ol class="conditions">${items}</ol>${note}`;
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

/** One legend line of an unmet layout clause (PADR-0047 decision 7): what the numbered mark names, in
 * words, never by colour alone. */
export function layoutMarkText(mark: LayoutMark, language: Language): string {
  const t = TEXT[language], quoted = (value: string): string => language === 'de' ? `„${value}“` : `“${value}”`;
  const name = (id: string): string => {
    const value = mark.names[id];
    if (!value) return quoted(id);
    if ('step' in value) return quoted(value.step);
    const end = (label: string | null): string => label === null ? t.layoutLooseEnd : quoted(label);
    return `${end(value.from)} → ${end(value.to)}`;
  };
  const r = mark.reason, clause = mark.clause;
  const tolerance = 'tolerance' in clause ? clause.tolerance : 0;
  const text = r.kind === 'count' ? (() => {
    const scope = (r.selection === 1 && clause.op === 'arrowsClearOfSteps' ? clause.steps : 'arrows' in clause ? clause.arrows : clause.steps).scope;
    const where = scope.kind === 'frame' ? fill(language, t.layoutScopeFrame, { name: quoted(scope.name) }) : scope.kind === 'outside' ? t.layoutScopeOutside : '';
    return fill(language, r.type === 'step' ? t.layoutCountSteps : t.layoutCountArrows, { n: r.expected, scope: where, found: r.found });
  })()
    : r.kind === 'loose' ? fill(language, t.layoutLoose, { arrow: name(r.arrow) })
    : r.kind === 'overlap' ? (clause.op === 'noOverlap' && clause.gap > 0 ? fill(language, t.layoutOverlapGap, { a: name(r.steps[0]), b: name(r.steps[1]), gap: clause.gap }) : fill(language, t.layoutOverlap, { a: name(r.steps[0]), b: name(r.steps[1]) }))
    : r.kind === 'spread' ? fill(language, t.layoutSpread, { a: name(r.steps[0]), b: name(r.steps[1]), tolerance })
    : r.kind === 'projection' ? fill(language, t.layoutProjection, { a: name(r.steps[0]), b: name(r.steps[1]), axis: 'axis' in clause ? clause.axis : 'x' })
    : r.kind === 'gaps' ? fill(language, t.layoutGaps, { a: name(r.smallest[0]), b: name(r.smallest[1]), c: name(r.largest[0]), d: name(r.largest[1]), tolerance })
    : r.kind === 'outside' ? fill(language, t.layoutOutside, { a: name(r.step) })
    : r.kind === 'crossing' ? fill(language, t.layoutCrossing, { a: name(r.arrows[0]), b: name(r.arrows[1]) })
    : fill(language, t.layoutTouch, { a: name(r.arrow), b: name(r.step) });
  return fill(language, t.markLine, { n: mark.number, c: mark.condition, text });
}

function boardHtml(detail: RunDetail, report: SessionReportView, language: Language): string {
  const t = TEXT[language], picture = detail.picture;
  const quoted = (value: string): string => language === 'de' ? `„${value}“` : `“${value}”`;
  const reason = picture?.kind === 'schematic' ? { 'model-only': t.reasonModelOnly, 'no-picture': t.reasonNoPicture, 'picture-unreadable': t.reasonPictureUnreadable, 'picture-changed': t.reasonPictureChanged }[picture.reason] : '';
  const judged = detail.layout?.drawn ? ` ${t.judgedCaption}` : '';
  const caption = (picture?.kind === 'engine' ? `${fill(language, t.finalEngine, { version: report.environment.app.version })}${detail.groupOverlay ? ` ${t.groupOverlay}` : ''}` : `${t.finalSchematic} ${reason}`) + judged;
  const list = (title: string, items: string[]): string => `<p class="legend-title">${esc(title)}</p><ul class="legend">${items.map(item => `<li>${prose(item)}</li>`).join('')}</ul>`;
  // A picture wider than the column scrolls inside its frame; a faded edge and a line say so. When the
  // first difference from the target lies in the right half, both frames open at that end (F3).
  const overflow = { none: 'fits', narrow: 'overflows-phone', wide: 'overflows-desktop' }[detail.overflow];
  const end = detail.overflow !== 'none' && detail.fromEnd ? ' from-end' : '';
  const frame = (markup: string, label: string): string => `<div class="board-scroll ${overflow}${end}" role="region" tabindex="0" aria-label="${esc(label)}">${markup}</div>${detail.overflow === 'none' ? '' : `<p class="scroll-hint ${overflow}">${esc(t.scrollHint)}</p>`}`;
  const legend: string[] = [];
  // The numbered marks of the unmet layout clauses first: what the reader looks for in the picture.
  if (detail.layout?.marks.length) legend.push(list(t.marksTitle, detail.layout.marks.map(mark => layoutMarkText(mark, language))));
  if (detail.objects.length) legend.push(list(t.objectsTitle, objectLines(detail.objects, language)));
  legend.push(detail.groups.length ? list(t.groups, detail.groups.map(group => `${group.name}: ${group.members.map(quoted).join(', ')}`)) : `<p class="legend-title">${esc(t.groups)}</p><p class="meta">${esc(t.noGroups)}</p>`);
  if (detail.frames.length) legend.push(list(t.frames, detail.frames.map(item => item.members.length ? fill(language, t.frameMembers, { name: quoted(item.name), members: item.members.map(quoted).join(', ') }) : fill(language, t.emptyFrame, { name: quoted(item.name) }))));
  const final = picture ? `<figure class="board-figure"><figcaption><span class="figure-title">${esc(t.finalBoard)}</span>${prose(caption)}</figcaption>${frame(picture.markup, t.finalBoard)}${legend.join('')}</figure>` : '';
  const target = detail.target
    ? `<figure class="board-figure"><figcaption><span class="figure-title">${esc(t.target)}</span>${esc(t.targetCaption + judged)}</figcaption>${frame(detail.target, t.target)}${detail.targetObjects.length ? list(t.objectsTitle, objectLines(detail.targetObjects, language)) : ''}</figure>`
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
  // A label and a single item stay on one line ("lost: 3"); a longer list wraps after its commas.
  const conditionList = (template: string, items: readonly number[]): string => { const text = fill(language, template, { list: items.join(', ') }); return items.length === 1 ? text.replace(': ', ':\u00a0') : text; };
  const row = (entry: TrajectoryRow): string[] => {
    // The result takes a full stacked row (R4), so its counted phrase stays whole ("(revision 1)", R5).
    const outcome = entry.outcome === 'accepted' ? esc(fill(language, t.accepted, { revision: entry.revision })) : `${statusIcon('fail')}${esc(fill(language, t.rejectedAs, { reason: codeText(entry.code ?? '', t) || t.rejectedOther }))}`;
    const met = entry.met === null ? t.none : [fill(language, t.metAfter, { met: entry.met, total }), ...(entry.gained.length ? [conditionList(t.gained, entry.gained)] : []), ...(entry.lost.length ? [conditionList(t.lost, entry.lost)] : [])].join(' · ');
    return [String(entry.number), ...(byClient ? [entry.client ? dataWords(entry.client) : esc(t.none)] : []), `<code>${esc(entry.text)}</code>`, `<span class="outcome">${outcome}</span>`, esc(met)];
  };
  const head = [{ text: t.trajectoryHead, numeric: true }, ...(byClient ? [{ text: t.trajectoryBy, wide: true }] : []), { text: t.trajectoryAction, wide: true }, { text: t.trajectoryResult, wide: true }, { text: t.trajectoryMet, wide: true }];
  return stackedTable(t.trajectory, null, head, detail.trajectory.map(row));
}

function callsHtml(detail: RunDetail, language: Language): string {
  const t = TEXT[language], calls = detail.calls;
  if (!calls) return `<p class="note">${esc(fill(language, t.callsMissing, { reason: detail.callsMissing === 'changed' ? t.missingChanged : detail.callsMissing === 'unreadable' ? t.missingUnreadable : t.callsMissingNone }))}</p>`;
  const lines = [`${fill(language, t.callsLine, { calls: calls.calls, bytes: `${number(calls.resultBytes / 1024, 1, language)} KB`, bridge: calls.bridgeMedianMs === null ? t.none : number(calls.bridgeMedianMs, 1, language), client: calls.clientMedianMs === null ? t.clientUnavailable : fill(language, t.clientMedian, { ms: number(calls.clientMedianMs, 1, language) }) })}.`,
    fill(language, t.callsTools, { list: calls.byTool.map(([tool, count]) => `${tool} ${count}`).join(', ') || t.none })];
  // The runs table's host calls are the host's own count (the bridge's start-up read included), not this log's.
  if (detail.run.toolCalls.total !== calls.calls) lines.push(fill(language, t.callsHost, { n: detail.run.toolCalls.total }));
  const failed = calls.codes.reduce((sum, [, count]) => sum + count, 0);
  if (failed) lines.push(fill(language, t.callsFailed, { n: failed }));
  if (calls.dropped) lines.push(fill(language, t.callsDropped, { n: calls.dropped }));
  if (calls.omitted) lines.push(fill(language, calls.omittedAtLeast ? t.callsOmittedMore : t.callsOmitted, { n: calls.omitted }));
  return `${lines.map(line => `<p class="meta">${esc(line)}</p>`).join('')}<p class="note">${esc(t.callsNote)}</p>`;
}

function clientHtml(run: ViewRun, language: Language): string {
  if (!run.client) return '';
  const t = TEXT[language], client = run.client, parts: string[] = [];
  if (client.model) parts.push(fill(language, t.clientModel, { model: client.model }));
  if (client.turns !== null) parts.push(fill(language, t.turnsPart, { n: client.turns }));
  if (client.tokens) parts.push(fill(language, t.tokensPart, { input: number(client.tokens.input + client.tokens.cacheRead + client.tokens.cacheCreation, 0, language), output: number(client.tokens.output, 0, language) }));
  if (client.costUsd !== null) parts.push(fill(language, t.costPart, { cost: number(client.costUsd, 4, language) }));
  return parts.length ? `<h3>${esc(t.client)}</h3><p class="meta">${prose(fill(language, t.clientLine, { parts: parts.join(' · ') }), client.model ? [client.model] : [])}</p>` : '';
}

/** A run card is open when the run failed or its agent did not complete normally (F15). */
const opensByDefault = (run: Pick<ViewRun, 'pass' | 'status'>): boolean => !run.pass || run.status !== 'completed';

function runHtml(run: ViewSessionRun, report: SessionReportView, details: ReportDetails | undefined, language: Language): string {
  const t = TEXT[language], detail = details?.runs.get(run.id);
  const states = runStates(run, detail, details, report, language);
  const summary = `<span class="run-title">${runResult(run, t)}<span>${prose(fill(language, t.runTitle, { task: run.taskId, seed: run.seed, repeat: run.repeat }), [run.taskId])}</span></span><span class="run-meta">${esc([fill(language, t.actionCount, { n: run.actions }), statusWords(run, t)].join(' · '))}</span>`;
  const parts: string[] = [];
  const heading = run.checker === null ? t.whyNoVerdict : run.pass ? t.whatHappened : t.why;
  if (states.length) parts.push(`<h3>${esc(heading)}</h3><ul class="reasons">${states.map(state => `<li><span class="state">${prose(state.name, errorClassesOf(run))}${state.why ? ':' : ''}</span>${state.why ? ` ${prose(state.why, detail?.clients ?? [])}` : ''}${state.code ? `<code>${esc(state.code)}</code>` : ''}${state.tail ? esc(state.tail) : ''}${state.list?.length ? `<ul class="sublist">${state.list.map(item => `<li>${prose(item)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>`);
  if (detail) {
    parts.push(`<h3>${esc(t.conditions)}</h3>${conditionsHtml(detail, language)}`);
    if (detail.picture || detail.target || detail.targetMissing) parts.push(`<h3>${esc(t.board)}</h3>${boardHtml(detail, report, language)}`);
    parts.push(`<h3>${esc(t.trajectory)}</h3>${trajectoryHtml(detail, language)}`, `<h3>${esc(t.toolCalls)}</h3>${callsHtml(detail, language)}`);
  } else parts.push(`<p class="note">${esc(t.cardNoFolder)}</p>`);
  parts.push(clientHtml(run, language));
  // Identifiers and codes: under Technical details, never in the normal path.
  const facts: Array<[string, string]> = [[t.runId, run.id], [t.levelLabel, levelText(run.verdictLevel, language)], [t.statusCode, run.status]];
  if (run.agentExitCode !== null) facts.push([t.exitCode, String(run.agentExitCode)]);
  if (run.note) facts.push([t.runNote, run.note]);
  if (run.failure && run.failure !== 'not-recorded') facts.push([t.failureReason, failureText(run.failure)]);
  if (detail?.rejected.length) facts.push([t.hostCodes, detail.rejected.map(([code, count]) => `${code} ×${count}`).join(', ')]);
  if (detail?.calls?.codes.length) facts.push([t.callCodes, detail.calls.codes.map(([code, count]) => `${code} ×${count}`).join(', ')]);
  if (detail?.traceError) facts.push([t.traceCode, detail.traceError]);
  for (const id of errorClassesOf(run)) { const explanation = explanationOf(run, id, detail, details, language); if (explanation && explanation !== firstSentence(explanation)) facts.push([fill(language, t.fullExplanation, { id }), explanation]); }
  parts.push(technical(t, facts));
  return `<details class="run" id="run-${esc(run.id)}"${opensByDefault(run) ? ' open' : ''}><summary>${summary}</summary><div class="run-body">${parts.join('')}</div></details>`;
}

export function renderHtml(input: ReportInput, tokensCss: string, language: Language = 'en', verification: VerificationInput = 'consistency-checked', details?: ReportDetails): string {
  const report = asView(input);
  if (report.verdictLevel === 'artifact') return renderArtifactHtml(report, tokensCss, language, verification, details);
  const t: Words = TEXT[language], s = report.summary, e = report.environment;
  const passHat = allRepeats(report, language), repeated = allRepeatsCount(report), efficiency = efficiencyText(report, language);
  const cards = [
    figure(t.passAt1, rateText(s.passed, s.runs, language), [fill(language, t.passedOf, { runs: fill(language, t.runCount, { n: s.runs }) }), ...(s.infraErrors ? [fill(language, t.infraIncluded, { n: s.infraErrors })] : [])].join(' · ')),
    ...(passHat && repeated ? [figure(fill(language, t.passHat, { k: report.settings.repeats }), rateText(repeated.all, repeated.instances, language), passHat)] : []),
    figure(t.meanActions, fixed(s.meanActions, 1, language), fill(language, t.whenPassed, { value: fixed(s.meanActionsPassed, 1, language) })),
    figure(efficiency.label, efficiency.value, efficiency.detail ? `${efficiency.detail} · ${efficiency.direction}` : efficiency.direction),
    figure(t.wall, seconds(s.meanWallMs, language)),
  ];
  const totals = clientTotals(report, language);
  const taskRows = s.byTask.map(task => [dataWords(task.taskId, 'code'), String(task.runs), esc(rateText(task.passed, task.runs, language)), esc(fixed(task.meanActions, 1, language)), esc(referenceCell(report, task.taskId, task.referenceActions, t)), task.referenceActions === null ? esc(t.noReference) : esc(fixed(task.efficiency, 2, language))]);
  const ordered = failuresFirst(report.runs);
  // Result first, so a stacked row on a phone leads with it (F2); error classes wrap.
  const runRows = ordered.map(run => [runResult(run, t), `<a href="#run-${esc(run.id)}">${dataWords(run.taskId, 'code')}</a>`, String(run.seed), String(run.repeat), esc(statusWords(run, t)), String(run.actions), String(run.rejectedActions), String(run.undos), String(run.resets), String(run.toolCalls.total), esc(seconds(run.wallMs, language)), errorCell(run, t)]);
  const ended = report.runs.filter(run => run.status !== 'completed');
  const endedList = (['agent_failed', 'timeout', 'infra_error'] as const).flatMap(status => { const count = ended.filter(run => run.status === status).length; return count ? [`${count} ${statusWords({ status }, t)}`] : []; });
  const folderReason = details === undefined || details.folder === 'missing' ? t.folderMissing : details.folder === 'world-changed' ? t.folderWorldChanged : details.folder === 'world-unreadable' ? t.folderWorldUnreadable : null;
  // The command breaks between its words, never inside a flag.
  const command = esc(t.partialCommand).replace(/--[a-z][a-z-]*/gu, flag => `<span class="flag">${flag}</span>`);
  const partial = folderReason ? banner('unknown', t.partialTitle, `<p>${esc(folderReason)} ${esc(t.partialShown)}</p><p>${esc(t.partialFix)} <code>${command}</code></p>`) : '';
  const facts = [...provenance(report, language, verification), report.createdAt.slice(0, 10)];
  // Failed runs, linked from the top: on a phone the first "why" is otherwise screens away.
  const failed = ordered.filter(run => !run.pass), shownFailed = failed.slice(0, 12);
  const jump = failed.length ? `<nav class="jump" aria-label="${esc(t.jumpFailed)}"><span class="jump-title">${esc(t.jumpFailed)}:</span> ${shownFailed.map(run => `<a href="#run-${esc(run.id)}">${prose(fill(language, t.runTitle, { task: run.taskId, seed: run.seed, repeat: run.repeat }), [run.taskId])}</a>`).join('<span aria-hidden="true"> · </span>')}${failed.length > shownFailed.length ? ` ${esc(fill(language, t.jumpMore, { n: failed.length - shownFailed.length }))}` : ''}</nav>\n` : '';
  const kind = { builtin: t.kindBuiltin, preset: t.kindPreset, command: t.kindCommand }[report.agent.kind];
  const body = `<header>
<p class="eyebrow">${esc(t.title)}</p>
<h1>${esc(report.agent.name)}</h1>
<p class="headline">${esc(headlineResult(report, language).join(' · '))}</p>
${chips(t.provenance, facts, agentIds(report))}
${report.label !== undefined ? `<p class="meta">${esc(`${t.label}: ${report.label}`)}</p>\n` : ''}${report.interrupted ? `<p class="meta">${esc(fill(language, t.interrupted, { runs: report.runs.length, planned: report.interrupted.plannedRuns }))}</p>\n` : ''}<p class="meta">${esc(sampleLine(report, language))}</p>
${ended.length ? `<p class="meta">${esc(fill(language, t.endedNote, { n: ended.length, list: endedList.join(', ') }))} <a href="#run-${esc(ended[0]!.id)}">${esc(fill(language, t.endedLink, { n: ended.length }))}</a></p>\n` : ''}${jump}</header>
${partial}<section aria-labelledby="summary"><h2 id="summary">${esc(t.summary)}</h2><dl class="figures ${cards.length === 5 ? 'n5' : 'n4'}">${cards.join('')}</dl>${totals ? `<p class="note">${esc(totals)}</p>` : ''}</section>
<section aria-labelledby="by-task"><h2 id="by-task">${esc(t.byTask)}</h2>${stackedTable(t.byTask, 'by-task', [{ text: t.task }, { text: t.runs, numeric: true }, { text: t.passed, numeric: true }, { text: t.actions, numeric: true }, { text: t.reference, numeric: true }, { text: efficiency.label, numeric: true }], taskRows)}</section>
<section aria-labelledby="runs"><h2 id="runs">${esc(t.runsHeading)}</h2>${stackedTable(t.runsHeading, 'runs', [{ text: t.result }, { text: t.task }, { text: t.seed, numeric: true }, { text: t.repeat, numeric: true }, { text: t.status }, { text: t.actions, numeric: true }, { text: t.rejected, numeric: true }, { text: t.undo, numeric: true }, { text: t.reset, numeric: true }, { text: t.calls, numeric: true }, { text: t.time, numeric: true }, { text: t.errors, wide: true, capped: true }], runRows, true)}</section>
<section aria-labelledby="details"><h2 id="details">${esc(t.details)}</h2>${ordered.map(run => runHtml(run, report, details, language)).join('')}</section>
<section aria-labelledby="settings"><h2 id="settings">${esc(t.settings)}</h2><dl class="settings">
<dt>${esc(t.agent)}</dt><dd>${prose(`${report.agent.name} (${kind})`, [report.agent.name])}</dd>
<dt>${esc(t.runsLabel)}</dt><dd>${esc(planLine(report, language))}</dd>
<dt>${esc(t.verification)}</dt><dd>${prose(verificationFacts(verification).claims ? t.reverifiedClaims : verificationFacts(verification).level === 're-verified' ? (e.world.package !== null ? t.reverifiedWorld : t.reverified) : t.consistency)}</dd>
<dt>${esc(t.levelLabel)}</dt><dd>${esc(levelText(report.verdictLevel, language))}</dd>
<dt>${esc(t.isolation)}</dt><dd>${esc(isolationText(report, t))}</dd>
<dt>${esc(t.toolchain)}</dt><dd>${prose(toolchainText(report, language), toolchainIds(report))}</dd>
<dt>${esc(t.world)}</dt><dd>${prose(worldText(report, t), [report.environment.world.worldId])}</dd>
${limitFacts(report, t, language).map(([label, value]) => `<dt>${prose(label)}</dt><dd>${prose(value, (report.environment.world.limits ?? []).map(entry => entry.taskId))}</dd>\n`).join('')}<dt>${esc(t.environment)}</dt><dd>${esc(environmentLine(report))}</dd>
</dl>${technical(t, technicalFacts(report, t))}<p class="note">${prose(t.note)}</p><p class="note">${prose(report.readFrom === BENCH_SCHEMA_V3 && !verificationFacts(verification).claims ? t.selfReportedV3 : t.selfReported)}</p></section>`;
  return page(language, `${t.title}: ${report.agent.name}`, tokensCss, body);
}

/** A run's failure as identifiers (Technical details): reason, the parser and the client's own code. */
const failureText = (failure: NonNullable<Exclude<ViewRun['failure'], 'not-recorded'>>): string =>
  [failure.reason, ...(failure.parser ? [failure.parser] : []), ...(failure.code ? [failure.code] : []), `beforeModelWork=${failure.beforeModelWork === null ? 'unknown' : String(failure.beforeModelWork)}`].join(' · ');
/** Practonaut, the application the runs used (or whose conversion the reading rules follow), Node and the OS. */
const environmentLine = (report: BenchReportView): string => {
  const e = report.environment;
  return `Practonaut ${e.practonaut} · ${appName(e.app.adapterId)} ${e.app.version} · Node ${e.node} · ${e.os.platform} ${e.os.release} ${e.os.arch}`;
};
const judgedFileText = (run: ViewArtifactRun, t: Words): string => run.checker === null ? t.none : { read: t.resultRead, absent: t.resultAbsent, unreadable: t.resultUnreadable }[run.checker.result];

/** An artifact-judged report in the terminal (PADR-0044 decision 1): no session, so no action figures,
 * trajectory or board; the proxy's forwarded calls, the judged file of each run, and the missing sandbox. */
function renderArtifactTable(report: ArtifactReportView, language: Language, verification: VerificationInput): string {
  const t = TEXT[language], s = report.summary, lines: string[] = [];
  lines.push(`${t.title}  ${shown(report.agent.name)}`, shown(headline(report, language, verification).join(' · ')));
  if (report.label !== undefined) lines.push(`${t.label}: ${shown(report.label)}`);
  lines.push(shown(`${t.world}: ${worldText(report, t)}`), shown(`${t.toolchain}: ${toolchainText(report, language)}`));
  for (const [label, value] of technicalFacts(report, t).filter(([label]) => label !== t.commandLabel)) lines.push(shown(`${label}: ${value}`));
  lines.push(sampleLine(report, language));
  if (report.interrupted) lines.push(fill(language, t.interrupted, { runs: report.runs.length, planned: report.interrupted.plannedRuns }));
  lines.push(planLine(report, language), t.noSandbox, '');
  if (s.infraErrors) lines.push(fill(language, t.infraIncluded, { n: s.infraErrors }));
  const repeats = allRepeats(report, language);
  if (repeats) lines.push(repeats);
  lines.push(`${fill(language, t.proxyCallsTotal, { n: s.proxyCalls })}   ${t.wall} ${seconds(s.meanWallMs, language)}`, '');
  const header = [t.task, t.runs, t.passed], rows = s.byTask.map(task => [shown(task.taskId), String(task.runs), rateText(task.passed, task.runs, language)]);
  const widths = header.map((head, column) => Math.max(head.length, ...rows.map(row => row[column]!.length)));
  const format = (row: string[]): string => row.map((cell, column) => column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)).join('  ');
  lines.push(format(header), widths.map(width => '─'.repeat(width)).join('  '), ...rows.map(format));
  const failed = report.runs.filter(run => !run.pass);
  if (failed.length) {
    lines.push('', fill(language, t.failuresHead, { n: failed.length, runs: fill(language, t.runCount, { n: s.runs }) }));
    for (const run of failed.slice(0, 20)) lines.push(`${run.checker === null ? '?' : '✗'} ${shown(run.id)}  ${run.checker === null ? t.noVerdictCounted : `${statusWords(run, t)} · ${t.judgedFile}: ${judgedFileText(run, t)}`}`);
    if (failed.length > 20) lines.push(fill(language, t.moreFailures, { n: failed.length - 20 }));
  }
  return lines.join('\n') + '\n';
}

/** Why an artifact-judged run ended as it did, each state by name in words (PADR-0039 B.3, the session
 * card's grammar): how the agent ended, why there is no verdict, the file the checker judged and each
 * error class with the first sentence of its explanation. Identifiers stay under Technical details. */
export function artifactStates(run: ViewArtifactRun, report: ArtifactReportView, details: ReportDetails | undefined, language: Language): State[] {
  const t = TEXT[language], states: State[] = [];
  if (run.status === 'timeout') states.push({ name: t.stateTimeout, why: fill(language, t.stateTimeoutArtifactWhy, { timeout: report.settings.timeoutSeconds }) });
  if (run.status === 'agent_failed') states.push({ name: t.stateAgentFailed, why: run.agentExitCode === null ? t.stateAgentNoStart : fill(language, t.stateAgentFailedWhy, { code: run.agentExitCode }) });
  if (run.checker === null) {
    const reason = run.failure && run.failure !== 'not-recorded' ? (t as unknown as Record<string, string>)[`failureWhy_${run.failure.reason}`] : undefined;
    states.push({ name: t.stateUnjudged, why: reason ? fill(language, t.stateUnjudgedReason, { reason }) : t.stateUnjudgedWhy });
    return states;
  }
  if (run.pass) return states;
  states.push({ name: t.stateJudgedFile, why: { read: t.stateJudgedRead, absent: t.stateJudgedAbsent, unreadable: t.stateJudgedUnreadable }[run.checker.result] });
  const classes = errorClassesOf(run);
  for (const id of classes) { const explanation = explanationOf(run, id, undefined, details, language); states.push({ name: fill(language, t.stateErrorClass, { id }), why: explanation ? firstSentence(explanation) : '' }); }
  if (!classes.length) states.push({ name: t.stateFailed, why: t.stateFailedArtifactWhy });
  return states;
}

/** An artifact-judged report as one static page: header with how runs were judged and the missing
 * sandbox, the summary without action figures, by task, the runs with the file each was judged on and
 * why it failed, the settings and how it is scored. */
function renderArtifactHtml(report: ArtifactReportView, tokensCss: string, language: Language, verification: VerificationInput, details: ReportDetails | undefined): string {
  const t: Words = TEXT[language], s = report.summary;
  const passHat = allRepeats(report, language), repeated = allRepeatsCount(report);
  const cards = [
    figure(t.passAt1, rateText(s.passed, s.runs, language), [fill(language, t.passedOf, { runs: fill(language, t.runCount, { n: s.runs }) }), ...(s.infraErrors ? [fill(language, t.infraIncluded, { n: s.infraErrors })] : [])].join(' · ')),
    ...(passHat && repeated ? [figure(fill(language, t.passHat, { k: report.settings.repeats }), rateText(repeated.all, repeated.instances, language), passHat)] : []),
    figure(t.proxyCalls, String(s.proxyCalls)), figure(t.wall, seconds(s.meanWallMs, language)),
  ];
  const ordered = failuresFirst(report.runs);
  const taskRows = s.byTask.map(task => [dataWords(task.taskId, 'code'), String(task.runs), esc(rateText(task.passed, task.runs, language))]);
  const resultOf = (run: ViewArtifactRun): string => run.checker === null ? `<span class="result unknown">${statusIcon('unknown')}${esc(t.noVerdictCounted)}</span>` : result(run.pass, t);
  const runRows = ordered.map(run => [resultOf(run), `<a href="#run-${esc(run.id)}">${dataWords(run.taskId, 'code')}</a>`, String(run.seed), String(run.repeat), esc(statusWords(run, t)), esc(judgedFileText(run, t)), String(run.proxy.calls), esc(seconds(run.wallMs, language)), errorCell(run, t)]);
  const runTitle = (run: ViewArtifactRun): string => prose(fill(language, t.runTitle, { task: run.taskId, seed: run.seed, repeat: run.repeat }), [run.taskId]);
  const runCards = ordered.map(run => {
    const states = artifactStates(run, report, details, language), classes = errorClassesOf(run);
    const heading = run.checker === null ? t.whyNoVerdict : run.pass ? t.whatHappened : t.why;
    const reasons = states.length ? `<h3>${esc(heading)}</h3><ul class="reasons">${states.map(state => `<li><span class="state">${prose(state.name, classes)}${state.why ? ':' : ''}</span>${state.why ? ` ${prose(state.why)}` : ''}</li>`).join('')}</ul>` : '';
    const facts: Array<[string, string]> = [[t.runId, run.id], [t.levelLabel, levelText(run.verdictLevel, language)], [t.statusCode, run.status]];
    if (run.agentExitCode !== null) facts.push([t.exitCode, String(run.agentExitCode)]);
    if (run.note) facts.push([t.runNote, run.note]);
    if (run.failure && run.failure !== 'not-recorded') facts.push([t.failureReason, failureText(run.failure)]);
    for (const id of classes) { const explanation = explanationOf(run, id, undefined, details, language); if (explanation && explanation !== firstSentence(explanation)) facts.push([fill(language, t.fullExplanation, { id }), explanation]); }
    const meta = [fill(language, t.proxyCallCount, { n: run.proxy.calls }), statusWords(run, t)].join(' · ');
    return `<details class="run" id="run-${esc(run.id)}"${opensByDefault(run) ? ' open' : ''}><summary><span class="run-title">${resultOf(run)}<span>${runTitle(run)}</span></span><span class="run-meta">${esc(meta)}</span></summary><div class="run-body">${reasons}${clientHtml(run, language)}${technical(t, facts)}</div></details>`;
  });
  // Runs not passed, linked from the top as on the session page.
  const failed = ordered.filter(run => !run.pass), shownFailed = failed.slice(0, 12);
  const jump = failed.length ? `<nav class="jump" aria-label="${esc(t.jumpFailed)}"><span class="jump-title">${esc(t.jumpFailed)}:</span> ${shownFailed.map(run => `<a href="#run-${esc(run.id)}">${runTitle(run)}</a>`).join('<span aria-hidden="true"> · </span>')}${failed.length > shownFailed.length ? ` ${esc(fill(language, t.jumpMore, { n: failed.length - shownFailed.length }))}` : ''}</nav>\n` : '';
  const kind = { builtin: t.kindBuiltin, preset: t.kindPreset, command: t.kindCommand }[report.agent.kind];
  const v = verificationFacts(verification);
  const body = `<header>
<p class="eyebrow">${esc(t.title)}</p>
<h1>${esc(report.agent.name)}</h1>
<p class="headline">${esc(headlineResult(report, language).join(' · '))}</p>
${chips(t.provenance, [...provenance(report, language, verification), report.createdAt.slice(0, 10)], agentIds(report))}
${report.label !== undefined ? `<p class="meta">${esc(`${t.label}: ${report.label}`)}</p>\n` : ''}${report.interrupted ? `<p class="meta">${esc(fill(language, t.interrupted, { runs: report.runs.length, planned: report.interrupted.plannedRuns }))}</p>\n` : ''}<p class="meta">${esc(sampleLine(report, language))}</p>
${jump}</header>
${banner('warning', t.cardNoSandbox, `<p>${prose(t.noSandbox)}</p>`)}
<section aria-labelledby="summary"><h2 id="summary">${esc(t.summary)}</h2><dl class="figures ${cards.length === 4 ? 'n4' : 'n3'}">${cards.join('')}</dl></section>
<section aria-labelledby="by-task"><h2 id="by-task">${esc(t.byTask)}</h2>${stackedTable(t.byTask, 'by-task', [{ text: t.task, wide: true }, { text: t.runs, numeric: true }, { text: t.passed, numeric: true }], taskRows, false, true)}</section>
<section aria-labelledby="runs"><h2 id="runs">${esc(t.runsHeading)}</h2>${stackedTable(t.runsHeading, 'runs', [{ text: t.result }, { text: t.task }, { text: t.seed, numeric: true }, { text: t.repeat, numeric: true }, { text: t.status }, { text: t.judgedFile }, { text: t.proxyCalls, numeric: true }, { text: t.time, numeric: true }, { text: t.errors, wide: true, capped: true }], runRows, true)}</section>
<section aria-labelledby="details"><h2 id="details">${esc(t.details)}</h2><p class="note">${esc(t.artifactBoardNote)}</p>${runCards.join('')}</section>
<section aria-labelledby="settings"><h2 id="settings">${esc(t.settings)}</h2><dl class="settings">
<dt>${esc(t.agent)}</dt><dd>${prose(`${report.agent.name} (${kind})`, [report.agent.name])}</dd>
<dt>${esc(t.runsLabel)}</dt><dd>${esc(planLine(report, language))}</dd>
<dt>${esc(t.verification)}</dt><dd>${prose(v.claims ? t.reverifiedClaims : v.level === 're-verified' ? t.reverifiedWorld : t.consistency)}</dd>
<dt>${esc(t.levelLabel)}</dt><dd>${esc(levelText(report.verdictLevel, language))}</dd>
<dt>${esc(t.isolation)}</dt><dd>${esc(isolationText(report, t))}</dd>
<dt>${esc(t.toolchain)}</dt><dd>${prose(toolchainText(report, language), toolchainIds(report))}</dd>
<dt>${esc(t.world)}</dt><dd>${prose(worldText(report, t), [report.environment.world.worldId])}</dd>
<dt>${esc(t.environment)}</dt><dd>${esc(environmentLine(report))}</dd>
</dl>${technical(t, technicalFacts(report, t))}<p class="note">${prose(t.noteArtifact)}</p><p class="note">${prose(t.selfReportedArtifact)}</p></section>`;
  return page(language, `${t.title}: ${report.agent.name}`, tokensCss, body);
}

export { sentence };
