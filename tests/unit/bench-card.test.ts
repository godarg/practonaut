// The result card and badge (roadmap 0.2.0, Should 6): n, the interval, verification status, isolation
// level, mirror, self-reported model, runs without a verdict and the caveat travel as real SVG <text>
// nodes; a consistency-checked report says so; no rate finer than 1/n; no ranking words; untrusted
// names escaped; nothing loaded from outside; the same report gives the same bytes; colours are the
// tokens of each theme. Expected strings are written out by hand; token values are read from
// design/tokens.css by a regular expression of this test, not by the renderer's parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BENCH_SCHEMA_V2, summarize, validateBenchReport, validateBenchReportV2, type BenchReport, type BenchReportV2, type BenchRunV2 } from '../../src/bench/report.ts';
import { CARD_SIZE, renderBadge, renderCard } from '../../src/bench/card.ts';
import { cardPaths } from '../../src/cli/bench.ts';
import { parseXml, childElements, textContent, type XmlElement } from '../support/junit-xsd.ts';

const TOKENS = readFileSync(new URL('../../design/tokens.css', import.meta.url), 'utf8');
const hash = (c: string): string => c.repeat(64);
type Outcome = 'pass' | 'fail' | 'unjudged';
interface Options {
  outcomes?: Outcome[]; repeats?: number; mirror?: 'required' | 'off'; kind?: 'builtin' | 'preset' | 'command'; model?: string | null;
  label?: string; name?: string; worldId?: string; interrupted?: number; seeds?: number;
}
/** A valid bench/2 report: one task per run when repeats = 1, otherwise one task with seeds of `repeats` runs each. */
function report(options: Options = {}): BenchReportV2 {
  const outcomes = options.outcomes ?? ['pass', 'pass', 'fail'], repeats = options.repeats ?? 1, mirror = options.mirror ?? 'off', kind = options.kind ?? 'builtin';
  const seeds = options.seeds ?? Math.ceil(outcomes.length / repeats);
  const runs: BenchRunV2[] = outcomes.map((outcome, index) => {
    const seed = Math.floor(index / repeats) + 1, repeat = (index % repeats) + 1, judged = outcome !== 'unjudged';
    return {
      id: `t-s${seed}-r${repeat}`, taskId: 't', seed, repeat, status: judged ? 'completed' : 'infra_error', pass: outcome === 'pass', actions: judged ? 1 : 0, acceptedActions: judged ? 1 : 0, rejectedActions: 0, undos: 0, resets: 0,
      toolCalls: { observe: 1, act: judged ? 1 : 0, undo: 0, reset: 0, check: 0, total: judged ? 2 : 1 }, wallMs: 100, referenceActions: null,
      checker: judged ? { session: { passed: outcome === 'pass', errorClasses: [] }, native: mirror === 'required' ? { passed: outcome === 'pass', errorClasses: [] } : null } : null, agentExitCode: judged ? 0 : null,
      ...(judged ? { artifacts: { session: hash('a'), native: mirror === 'required' ? hash('b') : null, checker: hash('c') } } : {}),
    };
  });
  const model = kind === 'builtin' ? null : options.model === undefined ? 'pn-model-7' : options.model;
  return validateBenchReportV2({
    schema: BENCH_SCHEMA_V2, createdAt: '2026-10-15T09:08:07.654Z', ...(options.label !== undefined ? { label: options.label } : {}),
    environment: { practonaut: '0.2.0-dev.0', excalidraw: '0.18.1', node: 'v22', os: { platform: 'linux', release: '6', arch: 'x64' }, mirror, world: { source: 'own', worldId: options.worldId ?? 'flows', version: '1.0.0', contentHash: hash('d'), package: { path: 'world.pnworld', sha256: hash('e') }, generated: [] } },
    agent: { kind, name: options.name ?? (kind === 'builtin' ? 'oracle' : kind === 'preset' ? 'claude-code' : 'my-agent'), command: kind === 'builtin' ? [] : ['x', '{mcp_config}'], isolation: { builtin: 'builtin-baseline', preset: 'tool-restricted-preset', command: 'template-unrestricted' }[kind],
      model, modelSource: model === null ? 'none' : kind === 'preset' ? 'client-attested' : 'command-output', apiKeySource: null, keptEnv: [] },
    settings: { tasks: ['t'], seeds: Array.from({ length: seeds }, (_, index) => index + 1), repeats, timeoutSeconds: 300, maxActions: 50, mirror, prompt: '' },
    references: null, runs, summary: summarize(runs, repeats),
    ...(options.interrupted ? { interrupted: { plannedRuns: options.interrupted } } : {}),
  });
}
/** Every <text> node's text (its tspans joined as written). */
function texts(svg: string): string[] {
  const out: string[] = [];
  const walk = (node: XmlElement): void => { if (node.name === 'text') out.push(textContent(node)); else for (const child of childElements(node)) walk(child); };
  walk(parseXml(svg));
  return out;
}
const hasText = (svg: string, phrase: string): boolean => texts(svg).some(text => text.includes(phrase));
/** Every class used inside a node. */
function classes(node: XmlElement, out = new Set<string>()): Set<string> {
  for (const name of (node.attributes.get('class') ?? '').split(/\s+/)) if (name) out.add(name);
  for (const child of childElements(node)) classes(child, out);
  return out;
}
/** Each fact on the card with the evidence mark drawn beside it. */
function factMarks(svg: string): Array<[string, 'confirmed' | 'open']> {
  const out: Array<[string, 'confirmed' | 'open']> = [];
  const walk = (node: XmlElement): void => {
    const children = childElements(node), fact = children.find(child => child.name === 'text' && child.attributes.get('class') === 'card-fact');
    if (fact) { out.push([textContent(fact), classes(children.find(child => child.name === 'g')!).has('mark-confirmed') ? 'confirmed' : 'open']); return; }
    for (const child of children) walk(child);
  };
  walk(parseXml(svg));
  return out;
}
const card = (value: BenchReport, language: 'en' | 'de' = 'en', verification: 'consistency-checked' | 're-verified' = 'consistency-checked', theme: 'light' | 'dark' = 'light'): string => renderCard(value, TOKENS, theme, language, verification);
const badge = (value: BenchReport, language: 'en' | 'de' = 'en', verification: 'consistency-checked' | 're-verified' = 'consistency-checked'): string => renderBadge(value, TOKENS, language, verification);

test('the card carries n, the interval, verification, mirror, isolation and the caveat as SVG text nodes, in English and German', () => {
  const value = report({ outcomes: ['pass', 'pass', 'fail'] });
  const en = card(value, 'en', 're-verified');
  // 2 of 3 runs passed; Wilson 2/3: 0.2077 … 0.9385 (by hand), shown 20–94 %.
  for (const phrase of ['2/3 runs passed', '95 % interval 20–94 % over 3 instances', 'n = 3 runs · 3 seeds · 1 repeat', 'Re-verified: every judged run re-judged by the checker from its artifacts',
    'Model only: not checked against the real Excalidraw', 'Built-in baseline: no language model, MCP only', 'Own world: flows 1.0.0',
    'Describes these runs, not the agent or its model in general. Not sealed: the agent ran as the same user as Practonaut.']) assert.ok(hasText(en, phrase), `${phrase}\n${texts(en).join('\n')}`);
  const de = card(value, 'de', 're-verified');
  for (const phrase of ['2/3 Läufe bestanden', '95-%-Intervall 20–94 % über 3 Instanzen', 'n = 3 Läufe · 3 Seeds · 1 Wiederholung', 'Nachgerechnet: Jeder bewertete Lauf wurde vom Prüfer aus seinen Artefakten neu beurteilt',
    'Nur Modell: nicht mit dem echten Excalidraw geprüft', 'Eingebaute Vergleichsbasis: kein Sprachmodell, nur MCP', 'Nicht versiegelt: Der Agent lief unter demselben Benutzer wie Practonaut.']) assert.ok(hasText(de, phrase), `${phrase}\n${texts(de).join('\n')}`);
  assert.match(de, /^<svg [^>]*xml:lang="de"/);
  // The accessible name repeats the whole header line.
  assert.match(en, /<title>Practonaut bench: oracle · 2\/3 passed · 95 % interval 20–94 % over 3 instances · re-verified from the artifacts · model only \(no mirror\) · built-in baseline: no language model, MCP only<\/title>/);
  assert.deepEqual([parseXml(en).attributes.get('width'), parseXml(en).attributes.get('height')], [String(CARD_SIZE.width), String(CARD_SIZE.height)]);
  assert.deepEqual([CARD_SIZE.width, CARD_SIZE.height], [1280, 640]);
});

test('a report that is only consistency-checked yields a card and a badge that say so', () => {
  const value = report();
  const checked = card(value), verified = card(value, 'en', 're-verified');
  assert.ok(hasText(checked, 'Consistency-checked only: the verdicts in the report add up, but the runs were not re-judged'));
  assert.equal(hasText(checked, 'Re-verified'), false);
  assert.equal(hasText(verified, 'Consistency-checked'), false);
  assert.equal(factMarks(checked)[0]![1], 'open', 'not re-judged: the dashed ring, not the confirmed mark');
  assert.equal(factMarks(verified)[0]![1], 'confirmed');
  assert.ok(hasText(card(value, 'de'), 'Nur auf Stimmigkeit geprüft: Die Urteile im Bericht gehen auf, die Läufe wurden aber nicht neu beurteilt'));
  assert.ok(hasText(badge(value), 'consistency-checked only'));
  assert.ok(hasText(badge(value, 'en', 're-verified'), 're-verified'));
  assert.equal(hasText(badge(value, 'en', 're-verified'), 'consistency'), false);
});

test('runs without a verdict are counted on the card and the badge, never hidden; repeats show instances and runs', () => {
  const value = report({ outcomes: ['pass', 'unjudged', 'pass', 'pass', 'fail', 'fail'], repeats: 3 });
  const svg = card(value);
  // Instances: seed 1 has 2 of 3 passed (at least half: passed), seed 2 has 1 of 3: 1/2 instances, 3/6 runs.
  // Wilson 1/2 (by hand): centre 0.5, half-width 0.4054, so 0.0946 … 0.9054, shown 9–91 %.
  for (const phrase of ['1/2', 'instances passed', '3/6 runs passed', '1 run without a verdict, counted as not passed', 'An instance passed when at least half of all its runs passed; a run without a verdict counts as not passed.']) assert.ok(hasText(svg, phrase), `${phrase}\n${texts(svg).join('\n')}`);
  assert.deepEqual(factMarks(svg).find(([text]) => text.includes('without a verdict'))?.[1], 'open');
  assert.ok(hasText(badge(value), '1/2 instances passed · 95 % interval 9–91 % · consistency-checked only · built-in baseline · model only · 1 without a verdict'));
  assert.ok(hasText(card(value, 'de'), '1 Lauf ohne Urteil, als nicht bestanden gezählt'));
  // Two runs: the plural.
  assert.ok(hasText(card(report({ outcomes: ['unjudged', 'unjudged', 'pass'] })), '2 runs without a verdict, counted as not passed'));
});

test('a single run shows 1/1 with its interval; no percentage below n = 100 and none finer than 1/n', () => {
  const single = card(report({ outcomes: ['pass'] }));
  // Wilson 1/1: 0.2065 … 1 (by hand): 20–100 %.
  assert.ok(hasText(single, '1/1 run passed') || (hasText(single, '1/1') && hasText(single, 'run passed')), texts(single).join('\n'));
  assert.ok(hasText(single, '95 % interval 20–100 % over 1 instance'));
  // 1200 runs as 600 instances of two repeats (seeds stop at 1000): the runs and the instances each
  // show the resolution their own denominator allows.
  for (const [n, passed, repeats] of [[6, 5, 1], [99, 50, 1], [150, 113, 1], [1200, 1001, 2]] as const) {
    const value = report({ outcomes: Array.from({ length: n }, (_, index) => index < passed ? 'pass' : 'fail'), repeats });
    for (const svg of [card(value), badge(value)]) {
      const all = texts(svg).join(' ').replace(/\u00a0/g, ' ');
      // The interval and the confidence level are estimates, not observed rates.
      const rest = all.replace(/95 % interval \d+–\d+ %/g, '');
      const fraction = /(\d+)\/(\d+) \((?:[<>] )?(\d+(?:\.\d+)?) %\)/g;
      for (const match of rest.matchAll(fraction)) {
        const m = Number(match[2]);
        assert.ok(m >= 100, `${match[0]}: a percentage below n = 100`);
        assert.equal(match[3]!.split('.')[1]?.length ?? 0, m >= 1000 ? 1 : 0, match[0]);
      }
      assert.equal(rest.replace(fraction, '').includes('%'), false, `n = ${n}: a percentage without its fraction: ${rest}`);
      if (n < 100) assert.equal(/%/.test(rest), false, `n = ${n}: ${rest}`);
    }
  }
  assert.ok(hasText(card(report({ outcomes: Array.from({ length: 1200 }, (_, index) => index < 1001 ? 'pass' : 'fail'), repeats: 2 })), '1001/1200 (83.4 %) runs passed'));
  assert.ok(hasText(card(report({ outcomes: Array.from({ length: 150 }, (_, index) => index < 113 ? 'pass' : 'fail') })), '113/150 (75 %)'));
});

test('model-only, a self-reported model and an unrestricted template are open evidence; the mirror and a restricted preset are confirmed', () => {
  const preset = factMarks(card(report({ kind: 'preset', mirror: 'required' }), 'en', 're-verified'));
  assert.deepEqual(preset, [
    ['Re-verified: every judged run re-judged by the checker from its artifacts', 'confirmed'],
    ['Real Excalidraw mirror: every action confirmed in the real app', 'confirmed'],
    ['Tool-restricted preset: only Practonaut’s MCP tools', 'confirmed'],
    ['Model, self-reported by the client: pn-model-7', 'open'],
  ]);
  const template = factMarks(card(report({ kind: 'command', model: null })));
  assert.deepEqual(template.map(([text, kind]) => `${kind}: ${text}`), [
    'open: Consistency-checked only: the verdicts in the report add up, but the runs were not re-judged', 'open: Model only: not checked against the real Excalidraw',
    'open: Template: tools not restricted by Practonaut', 'open: Model not reported',
  ]);
  assert.ok(hasText(card(report({ kind: 'command' })), 'Model, self-reported in the command output: pn-model-7'));
  assert.ok(hasText(badge(report({ kind: 'command' })), 'tools not restricted'));
  // A bench/1 report did not record its isolation level; the card says so.
  const v1 = validateBenchReport(JSON.parse(readFileSync(new URL('../fixtures/bench/v1/report.json', import.meta.url), 'utf8')));
  assert.ok(hasText(card(v1), 'Isolation not recorded (bench/1)'));
  assert.ok(hasText(card(v1), 'Bundled library: '));
  // An interrupted bench says how much of it ran.
  assert.ok(hasText(card(report({ outcomes: ['pass', 'fail'], seeds: 5, interrupted: 5 })), 'Interrupted: 2 of 5 planned runs finished'));
});

test('untrusted names are escaped; the SVG loads nothing from outside: no script, link, image, font or remote reference', () => {
  const hostile = '<script>alert(1)</script> & "q" \u202Eevil \u0007 </text><image href="https://x.invalid/a.png"/>';
  const value = report({ kind: 'command', name: hostile.slice(0, 64), label: hostile, model: 'pn<model>&"x"', worldId: 'flows' });
  for (const svg of [card(value), card(value, 'de', 'consistency-checked', 'dark'), badge(value)]) {
    const root = parseXml(svg); // well-formed XML: nothing in a name could close or open an element
    assert.equal(root.name, 'svg');
    const names = new Set<string>(), attributes = new Map<string, string>(), styles: string[] = [];
    const walk = (node: XmlElement): void => {
      names.add(node.name);
      for (const [key, value] of node.attributes) attributes.set(key, value);
      if (node.name === 'style') styles.push(textContent(node));
      for (const child of childElements(node)) walk(child);
    };
    walk(root);
    // Only drawing and text elements; no script, image, link, foreign content.
    assert.deepEqual([...names].filter(name => !['svg', 'title', 'style', 'rect', 'line', 'text', 'tspan', 'g', 'circle', 'path'].includes(name)), []);
    assert.deepEqual([...attributes.keys()].filter(key => !['xmlns', 'width', 'height', 'viewBox', 'role', 'aria-label', 'xml:lang', 'class', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'rx', 'cx', 'cy', 'r', 'd', 'transform', 'aria-hidden', 'stroke-dasharray', 'text-anchor', 'textLength', 'lengthAdjust'].includes(key)), []);
    // The style loads nothing: no font, no import, no URL.
    assert.equal(/@import|@font-face|url\(|https?:/i.test(styles.join('')), false);
    assert.equal(attributes.get('xmlns'), 'http://www.w3.org/2000/svg');
  }
  const label = texts(card(value)).find(text => text.startsWith('Label: '))!;
  assert.match(label, /^Label: <script>alert\(1\)<\/script> & "q" \\u\{202e\}evil \\u\{0007\} /);
});

test('the same report gives the same bytes; the colours are the tokens of each theme', () => {
  const value = report({ kind: 'preset', mirror: 'required', outcomes: ['pass', 'unjudged', 'fail'] });
  for (const theme of ['light', 'dark'] as const) assert.equal(card(value, 'en', 're-verified', theme), card(structuredClone(value), 'en', 're-verified', theme));
  assert.equal(badge(value), badge(structuredClone(value)));
  // Token values read straight from tokens.css (light: the default block; dark: the explicit block).
  const block = (selector: string): string => TOKENS.slice(TOKENS.indexOf(selector)).split('}')[0]!;
  const token = (text: string, name: string): string => new RegExp(`${name}:\\s*([^;]+);`).exec(text)![1]!.trim();
  const light = block(':root,\n:root[data-theme="light"]'), dark = block(':root[data-theme="dark"] {');
  const lightCard = card(value, 'en', 're-verified', 'light'), darkCard = card(value, 'en', 're-verified', 'dark');
  assert.ok(lightCard.includes(`.card-bg{fill:${token(light, '--pn-color-surface')}}`), lightCard.slice(0, 400));
  assert.ok(darkCard.includes(`.card-bg{fill:${token(dark, '--pn-color-surface')}}`));
  assert.ok(lightCard.includes(`.mark-confirmed{fill:${token(light, '--pn-color-accent')};stroke:none}`));
  assert.ok(darkCard.includes(`.mark-open{fill:none;stroke:${token(dark, '--pn-color-unknown-icon')};`));
  assert.notEqual(lightCard, darkCard);
  // The badge: light by default, dark where the reader's system prefers it.
  assert.match(badge(value), new RegExp(`\\.badge-bg\\{fill:${token(light, '--pn-color-fill')};.*@media \\(prefers-color-scheme:dark\\)\\{\\.badge-bg\\{fill:${token(dark, '--pn-color-fill')};`));
  // No token is left unresolved, and no rem: the file needs no stylesheet from outside.
  for (const svg of [lightCard, darkCard, badge(value)]) assert.equal(/var\(|rem\b/.test(svg), false);
});

test('no ranking words, no praise, no gamification words on the card or the badge', () => {
  const banned = /#1\b|\bbest\b|\btop\b|\brank|\bwinner|\bleader|\bchampion|\btrophy|\bscore|\bpoints?\b|\blevel\b|\bstreak|\bbadge\b|\bmastery|\bgreat\b|\bexcellent|\bcongrat|!/i;
  const bannedDe = /\bbeste|\bplatz\b|\brang\b|\bsieger|\bpunkte|\bglückwunsch|!/i;
  for (const value of [report(), report({ outcomes: ['pass'] }), report({ kind: 'preset', mirror: 'required' }), report({ outcomes: ['pass', 'unjudged', 'fail', 'pass'], repeats: 2, kind: 'command' })]) {
    for (const verification of ['consistency-checked', 're-verified'] as const) {
      assert.equal(banned.test(texts(card(value, 'en', verification)).join(' ')), false);
      assert.equal(banned.test(texts(badge(value, 'en', verification)).join(' ')), false);
      assert.equal(bannedDe.test(texts(card(value, 'de', verification)).join(' ')), false);
      assert.equal(bannedDe.test(texts(badge(value, 'de', verification)).join(' ')), false);
    }
  }
});

test('long names are cut with an ellipsis in the card; the caveats are never cut', () => {
  const name = 'Kreditorenstammdatenänderungsantragsprüfungsagent-mit-sehr-langem-Namen-1234567890';
  const value = report({ kind: 'command', name: name.slice(0, 64), label: 'Langer deutscher Name: Rechnungseingangsprüfung und Zahlungsfreigabeverfahrensdokumentation für den Monatsabschluss', worldId: 'zahlungsfreigabeverfahrensdokumentation-kreditorenstammdaten-x', outcomes: ['pass', 'unjudged', 'fail', 'pass', 'fail', 'fail'], repeats: 3 });
  const svg = card(value, 'de');
  const all = texts(svg);
  const label = all.find(text => text.startsWith('Bezeichnung: '))!;
  assert.ok(label.endsWith('…'), label);
  for (const phrase of ['Nur auf Stimmigkeit geprüft: Die Urteile im Bericht gehen auf, die Läufe wurden aber nicht neu beurteilt', 'Vorlage: Werkzeuge nicht von Practonaut eingeschränkt', 'Nur Modell: nicht mit dem echten Excalidraw geprüft',
    '1 Lauf ohne Urteil, als nicht bestanden gezählt', 'Eine Instanz gilt als bestanden, wenn mindestens die Hälfte all ihrer Läufe bestand; ein Lauf ohne Urteil zählt als nicht bestanden.',
    'Beschreibt diese Läufe, nicht den Agenten oder sein Modell im Allgemeinen. Nicht versiegelt: Der Agent lief unter demselben Benutzer wie Practonaut.']) assert.ok(all.some(text => text.includes(phrase)), `${phrase}\n${all.join('\n')}`);
  // Every line starts inside the card.
  for (const match of svg.matchAll(/<tspan x="([\d.]+)"/g)) assert.ok(Number(match[1]) >= 0 && Number(match[1]) <= 800, match[0]);
});

test('--card names its four files after the given path', () => {
  assert.deepEqual(cardPaths('out/card'), { light: { svg: 'out/card-light.svg', png: 'out/card-light.png' }, dark: { svg: 'out/card-dark.svg', png: 'out/card-dark.png' } });
  assert.deepEqual(cardPaths('out/card.svg').dark, { svg: 'out/card-dark.svg', png: 'out/card-dark.png' });
  assert.deepEqual(cardPaths('out/card.PNG').light.svg, 'out/card-light.svg');
});
