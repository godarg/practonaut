/**
 * Living gallery of the design system. Built by `npm run design:gallery`; never shipped in the
 * player bundle. Every component appears in every state it has, in both themes. Add a component
 * to the kit, add its states here.
 */
import { banner, button, card, checkField, chip, disclosure, emptyState, evidence, h, icon, listPicker, openSheet, segmented, selectField, statusIcon, textArea, textField } from '../ui/components.ts';
import { iconMarkup } from '../ui/icons.ts';
import { drawBoard } from '../ui/board-art.ts';
import type { BoardScene } from '../ui/board-art.ts';
import type { IconName } from '../ui/icons.ts';
import { miniature } from '../ui/miniature.ts';
import { step, stepper } from '../ui/stepper.ts';

declare const __TOKENS__: { colors: string[]; text: string[]; radii: string[]; space: string[] };
const root = document.getElementById('app')!;
let theme: 'system' | 'light' | 'dark' = 'system';
let mode = 'a';

function section(title: string, ...children: Array<Node | string>): HTMLElement {
  return h('section', { class: 'gallery-section', attrs: { 'aria-labelledby': `g-${title}` } }, h('h2', { class: 't-title2', id: `g-${title}`, text: title }), ...children);
}
function row(...children: Array<Node | string>): HTMLElement { return h('div', { class: 'gallery-row' }, ...children); }

function foundations(): HTMLElement {
  const type = h('div', { class: 'gallery-stack' });
  for (const [name, text] of [['display', 'Aus einer Vorführung wird eine Übung'], ['large', 'Übung erstellen'], ['title1', 'Schritt entfernen und Kette schließen'], ['title2', 'Ziel festlegen'], ['title3', 'Aufnahme prüfen'], ['body', 'Entferne Review draft aus dem bestehenden Ablauf und verbinde die verbleibenden Schritte.'], ['subhead', 'Praxisnahe Beschriftung für Bedienelemente und Listenzeilen.'], ['footnote', 'Hinweis und Sekundärtext, höchstens zwei Zeilen.'], ['caption', 'Caption und Chips']] as const) {
    type.append(h('div', { class: 'gallery-type' }, h('span', { class: 't-footnote t-secondary', text: name }), h('span', { class: `t-${name}`, text })));
  }
  type.append(h('p', { class: 't-eyebrow', text: 'Eyebrow label' }));
  const swatches = h('div', { class: 'gallery-swatches' });
  for (const name of __TOKENS__.colors) swatches.append(h('div', { class: 'gallery-swatch' }, h('span', { class: 'gallery-swatch__chip', vars: { '--_c': `var(--pn-color-${name})` } }), h('span', { class: 't-caption', text: name })));
  const radii = row(...__TOKENS__.radii.map(name => h('div', { class: 'gallery-radius', vars: { '--_r': `var(--pn-radius-${name})` } }, h('span', { class: 't-caption', text: name }))));
  const shadows = row(...['raised', 'floating', 'sheet'].map(name => h('div', { class: 'gallery-shadow', vars: { '--_s': `var(--pn-shadow-${name})` } }, h('span', { class: 't-footnote', text: name }))));
  return section('Foundations', type, swatches, radii, shadows);
}

function controls(): HTMLElement {
  const variants = row(...(['primary', 'secondary', 'tinted', 'plain', 'quiet', 'danger', 'danger-solid'] as const).map(variant => button({ label: variant, variant })));
  const sizes = row(button({ label: 'Small', size: 'sm', variant: 'primary' }), button({ label: 'Medium', variant: 'primary' }), button({ label: 'Large', size: 'lg', variant: 'primary' }), button({ label: 'With icon', icon: 'plus', variant: 'primary' }), button({ label: 'Disabled', disabled: true, variant: 'primary' }), button({ label: 'Busy', busy: true, variant: 'primary' }));
  const icons = row(button({ label: 'Rückgängig', icon: 'undo', iconOnly: true }), button({ label: 'Zurücksetzen', icon: 'reset', iconOnly: true }), button({ label: 'Hinweis', icon: 'lightbulb', iconOnly: true, variant: 'tinted' }), button({ label: 'Löschen', icon: 'trash', iconOnly: true, variant: 'danger' }), button({ label: 'Gewählt', icon: 'move', pressed: true }), button({ label: 'Ungewählt', icon: 'move', pressed: false }));
  const seg = row(segmented({ key: 'g1', label: 'Modus', items: [{ id: 'a', label: 'Üben' }, { id: 'b', label: 'Erstellen' }], value: mode, onChange: id => { mode = id; paint(); } }), segmented({ key: 'g2', label: 'Sprache', size: 'sm', items: [{ id: 'en', label: 'EN' }, { id: 'de', label: 'DE' }], value: 'de', onChange: () => undefined }), segmented({ key: 'g3', label: 'Darstellung', size: 'sm', items: [{ id: 's', label: 'System', icon: 'contrast' }, { id: 'l', label: 'Hell', icon: 'sun' }, { id: 'd', label: 'Dunkel', icon: 'moon' }], value: 's', onChange: () => undefined }));
  const chips = row(chip('Neutral'), chip('Bestätigt', { tone: 'accent', icon: 'check' }), chip('Erfüllt', { tone: 'success', icon: 'check' }), chip('Nicht erfüllt', { tone: 'danger', icon: 'x' }), chip('Nicht geprüft', { tone: 'warning', icon: 'warning' }), chip('Kein Urteil', { tone: 'unknown', icon: 'helpCircle' }), chip('Aufnahme läuft', { tone: 'danger' }));
  const fields = h('div', { class: 'gallery-form' },
    textField({ id: 'g-title', label: 'Projektname', hint: 'Erscheint in der Liste gespeicherter Projekte.', value: 'Ablauf reparieren' }).root,
    textField({ id: 'g-empty', label: 'Autor', value: '' }).root,
    selectField({ id: 'g-select', label: 'Quelle wählen', value: 'h', options: [{ value: 'h', label: 'Ein Mensch' }, { value: 's', label: 'Ein Skript oder Agent' }] }).root,
    selectField({ id: 'g-cap', label: 'Aufgabe', ariaLabel: 'Aufgabe', value: 'h', capsule: true, bare: true, options: [{ value: 'h', label: 'Schritt entfernen und Kette schließen' }, { value: 's', label: 'Variante' }] }).root,
    listPicker({ id: 'g-picker', label: 'Aufgabe wählen', value: 'a', currentWord: 'aktuell', items: [{ value: 'a', label: 'Schritt einfügen', detail: '4 Aktionen', meter: { value: 2, max: 3, label: 'Schwierigkeit 2 von 3, Referenzlösung' } }, { value: 'b', label: 'Pfeil umhängen', detail: '1 Aktion', meter: { value: 1, max: 3, label: 'Schwierigkeit 1 von 3, Referenzlösung' } }, { value: 'c', label: 'Liste in einen gestalteten Ablauf verwandeln' }], onPick: () => undefined }),
    checkField({ id: 'g-c1', label: 'Ich erlaube lokale Aufnahme und stelle die Inhalte unter CC0-1.0 bereit.', checked: false }).root,
    checkField({ id: 'g-c2', label: 'Ausgewählt', checked: true }).root,
    checkField({ id: 'g-c3', label: 'Nicht verfügbar', checked: false, disabled: true }).root,
    textArea({ id: 'g-ta', label: 'Technische Details (JSON)', value: '{\n  "schema": "practonaut.author/1"\n}', mono: true, rows: 4 }).root);
  return section('Controls', variants, sizes, icons, seg, chips, fields);
}

function feedback(): HTMLElement {
  const banners = h('div', { class: 'gallery-stack' },
    banner({ tone: 'accent', title: 'Lokal auf diesem Rechner', text: 'Kein Remote-Modell erforderlich.' }),
    banner({ tone: 'success', title: 'Alle Bedingungen erfüllt', text: 'Dein Ergebnis erfüllt alle Bedingungen dieser Übung.' }),
    banner({ tone: 'danger', title: 'Aktion abgelehnt', text: 'Der Pfeil ist nicht an beiden Enden verbunden.' }),
    banner({ tone: 'warning', title: 'Zeichenfläche geändert', text: 'Prüfe das Ergebnis erneut.' }),
    banner({ tone: 'unknown', title: 'Noch nicht modelliert', text: 'Diese Aktion kennt die Übung noch nicht. Die Arbeitsfläche ist unverändert.' }));
  const statuses = row(...(['pending', 'met', 'unmet', 'stale'] as const).flatMap(kind => [statusIcon(kind), h('span', { class: 't-footnote', text: kind })]));
  const evidences = row(evidence('confirmed', 'Bestätigt'), evidence('observed', 'Beobachtet'), evidence('hypothesis', 'Hypothese'), evidence('refuted', 'Widerlegt'));
  const skeleton = h('div', { class: 'gallery-stack' }, h('div', { class: 'pn-skeleton gallery-skeleton' }), h('div', { class: 'pn-skeleton gallery-skeleton gallery-skeleton--short' }));
  const empty = card({ title: 'Verlauf' }, emptyState({ icon: 'clock', title: 'Noch keine Aktionen', text: 'Jede Änderung erscheint hier mit ihrer Folge.' }));
  const sheet = row(button({ label: 'Sheet öffnen', variant: 'tinted', onClick: () => { const opener = document.activeElement as HTMLElement; const sheet = openSheet({ title: 'Diesen Versuch zurücksetzen?', text: 'Die Arbeitsfläche kehrt zum Anfang der Aufgabe zurück. Deine bisherigen Aktionen werden geleert.', restoreFocus: () => opener, actions: [{ label: 'Arbeitsfläche zurücksetzen', variant: 'danger-solid', onClick: () => sheet.close() }, { label: 'Weiterarbeiten', variant: 'secondary', onClick: () => sheet.close() }] }); } }), disclosure({ summary: 'Technische Details' }, h('p', { class: 't-footnote t-secondary', text: 'Nur für Fortgeschrittene.' })));
  return section('Feedback', banners, statuses, evidences, skeleton, empty, sheet);
}


function boardScene(overrides: Partial<BoardScene> = {}): BoardScene {
  return {
    name: 'Board', frameName: 'Draft flow', selectedId: 'a',
    steps: [{ id: 'a', label: 'Collect draft', x: 120, y: 200, width: 180, height: 100 }, { id: 'b', label: 'Review draft', x: 380, y: 200, width: 180, height: 100 }, { id: 'c', label: 'Publish draft', x: 640, y: 200, width: 180, height: 100 }],
    arrows: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }],
    ...overrides,
  };
}
function canvas(scene: BoardScene, caption: string): HTMLElement {
  const frame = h('div', { class: 'canvas gallery-canvas' }, h('div', { class: 'canvas__scroll' }, drawBoard(scene, { compact: window.matchMedia('(max-width: 47.99em)').matches })), h('p', { class: 'canvas__coach', text: caption }));
  frame.querySelector('svg')!.removeAttribute('data-testid');
  return frame;
}
function patterns(): HTMLElement {
  const palette = h('div', { class: 'practice-palette pn-floating gallery-palette' },
    button({ label: 'Schritt', icon: 'plus', variant: 'tool' }), h('span', { class: 'pn-floating__divider' }),
    button({ label: 'Verschieben', icon: 'move', variant: 'tool' }), button({ label: 'Umbenennen', icon: 'pencil', variant: 'tool' }), button({ label: 'Verbinden', icon: 'connect', variant: 'tool' }),
    button({ label: 'Löschen', icon: 'trash', variant: 'tool-danger' }));
  const goals = card({ title: 'Ziel', class: 'inspector-card' },
    h('div', { class: 'verdict fail' }, icon('xCircle'), h('p', { text: 'Dein Ergebnis erfüllt diese Übungsbedingungen noch nicht.' })),
    h('ul', { class: 'goal-list' },
      h('li', { class: 'goal-item goal-item--unmet' }, statusIcon('unmet'), h('div', {}, h('span', { class: 'condition-status', text: 'Nicht erfüllt' }), h('p', { class: 'goal-item__text', text: 'Genau zwei Schritte „Collect draft“ und „Publish draft“, verbunden durch einen Pfeil.' }))),
      h('li', { class: 'goal-item goal-item--met' }, statusIcon('met'), h('div', {}, h('span', { class: 'condition-status', text: 'Erfüllt' }), h('p', { class: 'goal-item__text', text: 'Der Rahmen „Draft flow“ ist vorhanden.' }))),
      h('li', { class: 'goal-item' }, statusIcon('pending'), h('div', {}, h('span', { class: 'condition-status', text: 'Noch nicht geprüft' }), h('p', { class: 'goal-item__text', text: 'Kein Pfeil mit offenem Ende.' })))),
    button({ label: 'Ergebnis prüfen', icon: 'check', variant: 'primary', size: 'lg', block: true }));
  const hints = card({ title: 'Hinweise', class: 'inspector-card', actions: [h('span', { class: 'hint-dots' }, h('span', { class: 'hint-dot is-open' }), h('span', { class: 'hint-dot' }), h('span', { class: 'hint-dot' }))] },
    h('div', { class: 'hint-list' }, h('div', { class: 'hint' }, icon('lightbulb'), h('p', { text: 'Ein Pfeil bleibt nur gültig, wenn beide Enden an einem Schritt hängen.' }))),
    button({ label: 'Nächsten Hinweis öffnen', icon: 'lightbulb', block: true }));
  const history = card({ title: 'Verlauf', class: 'inspector-card', actions: [button({ label: 'Rückgängig', icon: 'undo', variant: 'plain', size: 'sm' }), button({ label: 'Zurücksetzen', icon: 'reset', variant: 'plain', size: 'sm' })] },
    h('ol', { class: 'history-list' },
      h('li', { class: 'history-entry' }, h('span', { class: 'history-entry__index', text: '1' }), h('div', { class: 'history-entry__body' }, h('p', {}, h('span', { class: 'history-entry__then', text: 'Zu diesem Zeitpunkt: ' }), 'Schritt „Review draft“ gelöscht.'), h('p', { class: 'history-entry__consequence', text: 'Zwei Pfeilenden sind nicht mehr an einen Schritt angebunden.' })))));
  const chips = h('div', { class: 'tray-list' }, button({ label: 'Collect draft', size: 'sm', pressed: true, class: 'tray-chip' }), button({ label: 'Review draft', size: 'sm', class: 'tray-chip' }), button({ label: 'Loose arrow → Publish draft', size: 'sm', class: 'tray-chip tray-chip--loose' }));
  return section('Patterns',
    h('div', { class: 'gallery-stack' }, h('h3', { class: 't-title3', text: 'Board: selected' }), canvas(boardScene(), 'Wähle einen Schritt oder eine Verbindung.')),
    h('div', { class: 'gallery-stack' }, h('h3', { class: 't-title3', text: 'Board: picked up' }), canvas(boardScene({ pickedId: 'b', steps: boardScene().steps.map(step => step.id === 'b' ? { ...step, at: { x: 380, y: 240 } } : step), selectedId: 'b' }), 'Schritt aufgenommen. Pfeiltasten bewegen ihn; Enter platziert.')),
    h('div', { class: 'gallery-stack' }, h('h3', { class: 't-title3', text: 'Board: pending connection and loose ends' }), canvas(boardScene({ selectedId: 'c', connect: { from: 'a', to: 'c' }, arrows: [{ id: 'ab', from: 'a', to: null }, { id: 'bc', from: null, to: 'c' }] }), 'Wähle ein Ziel; Enter bestätigt, Escape bricht ab.')),
    h('div', { class: 'gallery-stack' }, h('h3', { class: 't-title3', text: 'Tool palette and tray' }), palette, chips),
    h('div', { class: 'gallery-pair' }, goals, h('div', { class: 'gallery-stack' }, hints, history)));
}

function icons(): HTMLElement {
  const grid = h('div', { class: 'gallery-icons' });
  for (const name of Object.keys(iconMarkup) as IconName[]) grid.append(h('div', { class: 'gallery-icon' }, icon(name, 'lg'), h('span', { class: 't-caption', text: name })));
  return section('Icons', grid);
}

/** Create-flow components (styles in css/create.css): stepper states and miniature diagrams. */
function flow(): HTMLElement {
  const steps = stepper({ label: 'Schritte' },
    step({ index: 1, title: 'Planen', summary: '„Ablauf reparieren“ · 3 Schritte benannt', state: 'done', open: false, position: 'Schritt 1 von 3, erledigt.' }),
    step({ index: 2, title: 'Aufnehmen', summary: 'Noch keine Vorführung', state: 'current', open: true, position: 'Schritt 2 von 3, aktueller Schritt.' }, h('p', { class: 't-subhead t-secondary', text: 'Nur der aktuelle Schritt ist offen; er hat genau eine primäre Aktion.' }), row(button({ label: 'Vorführung aufnehmen', icon: 'record', variant: 'primary' }))),
    step({ index: 3, title: 'Prüfen', summary: 'Nach der Aufnahme', state: 'upcoming', open: false, position: 'Schritt 3 von 3, noch nicht begonnen.' }));
  const graph = { steps: [{ id: 'a', label: 'Entwurf sammeln', y: 0 }, { id: 'b', label: 'Entwurf prüfen', y: 1 }, { id: 'c', label: 'Entwurf veröffentlichen', y: 2 }], arrows: [{ id: 'ab', from: 'a', to: 'b', tag: 'A' }, { id: 'bc', from: 'b', to: 'c', tag: 'B' }] };
  const after = { steps: [graph.steps[0]!, graph.steps[2]!], arrows: [{ id: 'ab', from: 'a', to: null }, { id: 'bc', from: null, to: 'c' }] };
  const slots = ['a', 'b', 'c'], anchors = { ab: { from: 'a', to: 'b' }, bc: { from: 'b', to: 'c' } };
  const minis = row(
    miniature(graph, { label: 'Vorher: drei Schritte, einer wird entfernt', caption: 'Vorher', slots, removed: new Set(['b']) }),
    miniature(after, { label: 'Nachher: zwei lose Enden', caption: 'Nachher', slots, anchors, changed: new Set(['ab', 'bc']) }),
    miniature({ steps: graph.steps.slice(0, 2), arrows: [{ id: 'loop', from: 'a', to: 'a' }, { id: 'free', from: null, to: null }] }, { label: 'Selbstschleife und freier Pfeil', caption: 'Sonderfälle' }),
    miniature(after, { label: 'Schmal', caption: 'Schmal', slots, anchors, narrow: true }),
    miniature(after, { label: '', slots, anchors, compact: true }));
  return section('Create flow', steps, minis);
}

function paint(): void {
  document.documentElement.lang = 'de';
  if (theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  const bar = h('header', { class: 'gallery-bar' }, h('h1', { class: 't-title3', text: 'Practonaut design system' }), segmented({ key: 'gallery-theme', label: 'Darstellung', size: 'sm', items: [{ id: 'system', label: 'System' }, { id: 'light', label: 'Hell' }, { id: 'dark', label: 'Dunkel' }], value: theme, onChange: id => { theme = id as typeof theme; paint(); }, testid: 'gallery-theme' }));
  root.replaceChildren(bar, h('main', { class: 'gallery-main' }, foundations(), controls(), feedback(), patterns(), flow(), icons()));
}
window.matchMedia('(max-width: 47.99em)').addEventListener('change', () => paint());
paint();
