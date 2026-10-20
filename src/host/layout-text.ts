/**
 * What the Player, the check result and MCP say about a layout clause (PADR-0047 decisions 6 and 7):
 * its formal text, its plain sentence (EN/DE) and its public overlay — the clause's operator and
 * parameters with each selection as type, tagged scope and count. All three are lossless projections
 * of the goal clause alone; nothing here reads a board, a reference or a near miss.
 */
import { selectionScope } from '../world/layout.ts';
import type { Anchor, Axis, LayoutPredicate, Localized, Selection } from '../world/types.ts';
import type { LayoutOverlay, LayoutScope } from './protocol.ts';

const scopeOf = (selection: Selection): LayoutScope => {
  const scope = selectionScope(selection);
  // World validation admits only the three shapes; anything else never reaches a view.
  if (!scope) throw new Error('a layout selection outside the three shapes');
  return { type: selection.type, scope, count: selection.count };
};
/** The public overlay of a layout clause. */
export function layoutOverlay(p: LayoutPredicate): LayoutOverlay {
  switch (p.op) {
    case 'noOverlap': return { op: p.op, steps: scopeOf(p.select), gap: p.gap };
    case 'aligned': return { op: p.op, steps: scopeOf(p.select), axis: p.axis, anchor: p.anchor, tolerance: p.tolerance };
    case 'evenlySpaced': return { op: p.op, steps: scopeOf(p.select), axis: p.axis, tolerance: p.tolerance };
    case 'within': return { op: p.op, steps: scopeOf(p.select), canvas: { x: p.x, y: p.y, width: p.width, height: p.height } };
    case 'arrowsNoCrossing': return { op: p.op, arrows: scopeOf(p.select) };
    case 'arrowsClearOfSteps': return { op: p.op, arrows: scopeOf(p.select), steps: scopeOf(p.steps) };
  }
}

type Language = 'en' | 'de';
const NOUN = { en: { step: 'step', arrow: 'arrow' }, de: { step: 'Schritt', arrow: 'Pfeil' } } as const;
/** The formal form of a selection: `16 × step [s]: (in frame "Lane A")`. */
function formalSelection(selection: Selection, language: Language): string {
  const scope = selectionScope(selection)!;
  const where = scope.kind === 'all' ? (language === 'en' ? 'all' : 'alle')
    : scope.kind === 'outside' ? (language === 'en' ? 'outside frames' : 'außerhalb von Rahmen')
      : `${language === 'en' ? 'in frame' : 'im Rahmen'} ${JSON.stringify(scope.name)}`;
  return `${selection.count} × ${NOUN[language][selection.type]} [${selection.as}]: (${where})`;
}
const ANCHOR_FORMAL = { en: { start: 'start', center: 'centre', end: 'end' }, de: { start: 'Anfang', center: 'Mitte', end: 'Ende' } } as const;
/** The formal text of a layout clause (decision 6), shown beside its sentence. */
export function layoutFormal(p: LayoutPredicate, language: Language): string {
  const en = language === 'en', select = formalSelection(p.select, language);
  switch (p.op) {
    case 'noOverlap': return `${en ? 'no two overlap' : 'keine zwei überlappen'}: ${select}; ${en ? 'gap' : 'Abstand'} ≥ ${p.gap} px`;
    case 'aligned': return `${en ? 'aligned on' : 'ausgerichtet auf'} ${p.axis}, ${ANCHOR_FORMAL[language][p.anchor]}: ${select}; ± ${p.tolerance} px`;
    case 'evenlySpaced': return `${en ? `evenly spaced along ${p.axis}, no overlap along ${p.axis}` : `gleichmäßig verteilt entlang ${p.axis}, ohne Überlappung entlang ${p.axis}`}: ${select}; ± ${p.tolerance} px`;
    case 'within': return `${en ? 'inside' : 'innerhalb'} (${p.x}, ${p.y})–(${p.x + p.width}, ${p.y + p.height}): ${select}`;
    case 'arrowsNoCrossing': return `${en ? 'no two cross' : 'keine zwei kreuzen sich'}: ${select}`;
    case 'arrowsClearOfSteps': return `${en ? 'clear of steps' : 'frei von Schritten'}: ${select}; ${formalSelection(p.steps, language)}`;
  }
}

/** "the 8 steps in “Lane A”" / "den 8 Schritten in „Lane A“" (German in the dative, so one phrase fits
 * every sentence). */
export function selectionPhrase(selection: Selection, language: Language): string {
  const scope = selectionScope(selection)!, n = selection.count;
  if (language === 'en') {
    const noun = n === 1 ? NOUN.en[selection.type] : `${NOUN.en[selection.type]}s`;
    return `the ${n} ${noun}${scope.kind === 'frame' ? ` in “${scope.name}”` : scope.kind === 'outside' ? ' outside any frame' : ''}`;
  }
  const noun = n === 1 ? NOUN.de[selection.type] : selection.type === 'step' ? 'Schritten' : 'Pfeilen';
  return `${n === 1 ? 'dem' : 'den'} ${n} ${noun}${scope.kind === 'frame' ? ` in „${scope.name}“` : scope.kind === 'outside' ? ' außerhalb von Rahmen' : ''}`;
}
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const ANCHOR_EN: Record<Axis, Record<Anchor, string>> = { y: { start: 'their top edges', center: 'the y-coordinates of their centres', end: 'their bottom edges' }, x: { start: 'their left edges', center: 'the x-coordinates of their centres', end: 'their right edges' } };
const ANCHOR_DE: Record<Axis, Record<Anchor, string>> = { y: { start: 'die Oberkanten', center: 'die y-Koordinaten der Mittelpunkte', end: 'die Unterkanten' }, x: { start: 'die linken Kanten', center: 'die x-Koordinaten der Mittelpunkte', end: 'die rechten Kanten' } };
const JUDGED_EN = 'An arrow counts as the straight line between the centres of the two steps it joins, however it is drawn';
const JUDGED_DE = 'Ein Pfeil zählt als gerade Linie zwischen den Mittelpunkten der beiden Schritte, die er verbindet, wie auch immer er gezeichnet ist';
const ATTACHED = { en: 'Every arrow must be attached at both ends.', de: 'Jeder Pfeil muss an beiden Enden angebunden sein.' } as const;

/** The plain sentence of a layout clause (decision 6): the judged geometry and how many objects the
 * condition is about. */
export function layoutSentence(p: LayoutPredicate): Localized {
  const en = selectionPhrase(p.select, 'en'), de = selectionPhrase(p.select, 'de');
  switch (p.op) {
    case 'noOverlap': return p.gap === 0
      ? { en: `No two of ${en} overlap: their boxes (position and size) share no area; edges may touch.`, de: `Von ${de} überlappen sich keine zwei: ihre Boxen (Position und Größe) haben keine gemeinsame Fläche; Kanten dürfen sich berühren.` }
      : { en: `No two of ${en} come closer than ${p.gap} px: their boxes are at least ${p.gap} px apart horizontally or vertically.`, de: `Von ${de} kommen sich keine zwei näher als ${p.gap} px: zwischen ihren Boxen liegen waagerecht oder senkrecht mindestens ${p.gap} px.` };
    case 'aligned': return {
      en: `${capital(en)} sit in one ${p.axis === 'y' ? 'row' : 'column'}: ${ANCHOR_EN[p.axis][p.anchor]} differ by at most ${p.tolerance} px.`,
      de: `Bei ${de} weichen ${ANCHOR_DE[p.axis][p.anchor]} höchstens ${p.tolerance} px voneinander ab: sie stehen in einer ${p.axis === 'y' ? 'Zeile' : 'Spalte'}.`,
    };
    case 'evenlySpaced': return p.axis === 'x'
      ? { en: `${capital(en)} stand side by side without overlapping horizontally, and the horizontal gaps between neighbouring boxes differ by at most ${p.tolerance} px.`, de: `Bei ${de} überlappen sich die Boxen waagerecht nicht, und die waagerechten Lücken zwischen benachbarten Boxen weichen höchstens ${p.tolerance} px voneinander ab.` }
      : { en: `${capital(en)} stand one above the other without overlapping vertically, and the vertical gaps between neighbouring boxes differ by at most ${p.tolerance} px.`, de: `Bei ${de} überlappen sich die Boxen senkrecht nicht, und die senkrechten Lücken zwischen benachbarten Boxen weichen höchstens ${p.tolerance} px voneinander ab.` };
    case 'within': return {
      en: `Every box of ${en} lies entirely inside the canvas from (${p.x}, ${p.y}) to (${p.x + p.width}, ${p.y + p.height}).`,
      de: `Alle Boxen von ${de} liegen ganz innerhalb der Arbeitsfläche von (${p.x}, ${p.y}) bis (${p.x + p.width}, ${p.y + p.height}).`,
    };
    case 'arrowsNoCrossing': return {
      en: `No two of ${en} cross or touch. ${JUDGED_EN}; arrows that share a step may meet at its centre, and arrows between the same two steps are not compared. ${ATTACHED.en}`,
      de: `Von ${de} kreuzen oder berühren sich keine zwei. ${JUDGED_DE}; Pfeile mit einem gemeinsamen Schritt dürfen sich in dessen Mittelpunkt treffen, Pfeile zwischen denselben zwei Schritten werden nicht verglichen. ${ATTACHED.de}`,
    };
    case 'arrowsClearOfSteps': {
      const steps = { en: selectionPhrase(p.steps, 'en'), de: selectionPhrase(p.steps, 'de') };
      return {
        en: `None of ${en} touches the box of any of ${steps.en} other than the two it joins. An arrow counts as the straight line between the centres of its two steps, however it is drawn. ${ATTACHED.en}`,
        de: `Keiner von ${de} berührt die Box eines von ${steps.de} außer den beiden, die er verbindet. Ein Pfeil zählt als gerade Linie zwischen den Mittelpunkten seiner beiden Schritte, wie auch immer er gezeichnet ist. ${ATTACHED.de}`,
      };
    }
  }
}
