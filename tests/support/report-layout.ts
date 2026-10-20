// Layout defects on a rendered report or compare page that the design reviews found (R3 to R5),
// measured as rendered by test:a11y (`page.evaluate(layoutDefects)`) at every width and theme:
// - a formal condition: no word that fits a line is cut inside ("u" / "nd"); a comparison (left operand,
//   operator, right operand) breaks only when it is wider than the line, and then after its operator,
//   which ends the line with its left operand: a line never ends on an operator otherwise, and an
//   operator never stands alone on a line; a right operand of several words (a quoted string, the fixed
//   value "nicht angebunden") that fits a line is never split;
// - a stacked table: its trailing cell never sits alone at half the row's width beside an empty half,
//   and a compare's instance cell takes the whole row;
// - no line in a table cell starts with a lone count and its closing parenthesis ("1)"), nor with the
//   single item of a label ("verloren:" / "3");
// - a percentage written with its hyphen ("95-%") never splits across lines ("95-" / "%-Intervall");
// - no table cell's content is wider than its cell ("(3 von 3 Läufen" past the card's edge);
// - a compact table fills its column wherever it stacks (a stub of a card at 320 px).
// A "word" is a run of text without a breaking space (a no-break space joins it).
export function layoutDefects(): string[] {
  const defects: string[] = [];
  type Word = { text: string; tops: number[]; width: number };
  const measure = (range: Range): { tops: number[]; width: number } => {
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    return { tops: [...new Set(rects.map(rect => Math.round(rect.top)))].sort((a, b) => a - b), width: rects.reduce((sum, rect) => sum + rect.width, 0) };
  };
  const textNodes = (element: Element): Text[] => {
    const nodes: Text[] = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
    return nodes;
  };
  const wordsOf = (element: Element): Word[] => textNodes(element).flatMap(node => [...(node.textContent ?? '').matchAll(/[^\s ]+(?: +[^\s ]+)*/gu)].flatMap(word => {
    const range = document.createRange();
    range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
    const measured = measure(range);
    return measured.tops.length ? [{ text: word[0], ...measured }] : [];
  }));
  const first = (word: Word): number => word.tops[0]!, last = (word: Word): number => word.tops[word.tops.length - 1]!;
  const operators = new Set(['=', '≈', '<', '>', '≤', '≥']);
  for (const formal of document.querySelectorAll('.formal')) {
    const words = wordsOf(formal), line = formal.clientWidth, space = 5;
    words.forEach((word, index) => {
      if (word.tops.length > 1 && word.width < line) defects.push(`formal word "${word.text}" is cut across lines`);
      const before = words[index - 1], after = words[index + 1];
      if (!operators.has(word.text) || !before || !after) return;
      const endsLine = first(after) > last(word), startsLine = first(word) > last(before);
      if (endsLine && startsLine) defects.push(`formal operator "${word.text}" stands alone on a line`);
      else if (endsLine && before.width + word.width + after.width + 2 * space <= line) defects.push(`formal line ends on "${word.text}" although its comparison fits a line`);
    });
    // A right operand of several words, across the text nodes it may span.
    const nodes = textNodes(formal), text = nodes.map(node => node.textContent ?? '').join('');
    const at = (offset: number): [Text, number] => { let rest = offset; for (const node of nodes) { const length = (node.textContent ?? '').length; if (rest <= length) return [node, rest]; rest -= length; } return [nodes[nodes.length - 1]!, (nodes[nodes.length - 1]!.textContent ?? '').length]; };
    for (const operand of text.matchAll(/"(?:[^"\\]|\\.)*"|nicht[\s ]angebunden/gu)) {
      if (!/[\s ]/u.test(operand[0])) continue;
      const range = document.createRange(), start = at(operand.index), end = at(operand.index + operand[0].length);
      range.setStart(start[0], start[1]); range.setEnd(end[0], end[1]);
      const measured = measure(range);
      if (measured.tops.length > 1 && measured.width <= line) defects.push(`formal operand ${operand[0]} is split across lines`);
    }
  }
  for (const row of document.querySelectorAll('table tbody tr')) {
    const cells = [...row.querySelectorAll('td')].filter(cell => cell.getClientRects().length);
    if (cells.length < 2 || getComputedStyle(cells[0]!).display !== 'block') continue;
    const full = row.getBoundingClientRect().width, trailing = cells[cells.length - 1]!, top = Math.round(trailing.getBoundingClientRect().top);
    const alone = cells.slice(0, -1).every(cell => Math.round(cell.getBoundingClientRect().top) !== top);
    if (alone && trailing.getBoundingClientRect().width < full / 2) defects.push(`stacked trailing cell "${(trailing.textContent ?? '').slice(0, 30)}" sits alone at half a row`);
    if (row.closest('[aria-labelledby="instances"]') && cells[0]!.getBoundingClientRect().width < full / 2) defects.push(`stacked instance cell "${(cells[0]!.textContent ?? '').slice(0, 30)}" takes half a row`);
  }
  for (const cell of document.querySelectorAll('td')) {
    if (!cell.getClientRects().length) continue;
    if (cell.scrollWidth > cell.clientWidth + 1) defects.push(`cell "${(cell.textContent ?? '').slice(0, 30)}" is ${cell.scrollWidth - cell.clientWidth} px wider than its cell`);
    const words = wordsOf(cell);
    words.forEach((word, index) => {
      const before = words[index - 1];
      if (!before || first(word) <= last(before)) return;
      if (/^\d+\)/u.test(word.text)) defects.push(`a line in cell "${(cell.textContent ?? '').slice(0, 30)}" starts with "${word.text}"`);
      if (/:$/u.test(before.text) && /^\d+$/u.test(word.text)) defects.push(`a label's single item "${before.text} ${word.text}" is split across lines`);
    });
  }
  for (const node of textNodes(document.body)) for (const percent of (node.textContent ?? '').matchAll(/\d+[-\u2011]%/gu)) {
    const range = document.createRange();
    range.setStart(node, percent.index); range.setEnd(node, percent.index + percent[0].length);
    if (measure(range).tops.length > 1) defects.push(`"${percent[0]}" splits across lines`);
  }
  for (const region of document.querySelectorAll('.scroll.compact')) {
    const table = region.querySelector('table'), column = region.parentElement;
    if (table && column && getComputedStyle(table).display === 'block' && region.getBoundingClientRect().width < column.getBoundingClientRect().width - 1) defects.push('a stacked compact table is narrower than its column');
  }
  return defects;
}

/**
 * Defects of a report's board pictures, as rendered (design review L1-F4, L1-F5, L1-F6):
 * - the report's own overlay text on a picture (the layout area's label, a mark's label) is never under
 *   the export's dark filter, and its contrast is at least 4.5:1 against what it is set on;
 * - no judged line runs through a text of its picture as the report draws it;
 * - a picture that scrolls opens with at least one step's label in its window.
 */
export function pictureDefects(): string[] {
  const defects: string[] = [];
  const rgb = (value: string): [number, number, number] | null => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(value); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
  const luminance = ([r, g, b]: [number, number, number]): number => { const c = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b); };
  const contrast = (a: [number, number, number], b: [number, number, number]): number => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };
  for (const text of document.querySelectorAll('.sch-judged-label, .sch-mark-number')) {
    if (!text.getClientRects().length) continue;
    for (let node: Element | null = text; node && node.tagName.toLowerCase() !== 'body'; node = node.parentElement) if (getComputedStyle(node).filter !== 'none') { defects.push(`overlay text "${text.textContent}" is under a filter`); break; }
    const fill = rgb(getComputedStyle(text).fill);
    const on = text.classList.contains('sch-mark-number') ? rgb(getComputedStyle(text.previousElementSibling!).fill) : rgb(getComputedStyle(text.closest('.board-scroll')!).backgroundColor);
    if (fill && on && contrast(fill, on) < 4.5) defects.push(`overlay text "${text.textContent}" has contrast ${contrast(fill, on).toFixed(2)}:1`);
  }
  // No judged line (segment, box, layout area) shows inside a text of its picture, as rendered: the
  // picture's own texts in the report's font, sampled along each line and tested against its clip.
  for (const svg of document.querySelectorAll('svg.engine-board, svg.schematic')) {
    if (!svg.getClientRects().length) continue;
    const texts = [...svg.querySelectorAll('text')].filter(text => !text.closest('.sch-judged')).map(text => text.getBoundingClientRect()).filter(box => box.width > 0);
    for (const element of svg.querySelectorAll('.sch-judged-segment, .sch-judged-canvas, .sch-judged-box')) {
      const owner = element.closest('[clip-path]');
      const d = owner ? svg.querySelector(`${(owner.getAttribute('clip-path') ?? '').replace(/^url\((#[^)]*)\)$/, '$1')} path`)?.getAttribute('d') ?? '' : '';
      const rects = [...d.matchAll(/M (-?[\d.e+]+) (-?[\d.e+]+) h (-?[\d.e+]+) v (-?[\d.e+]+) h -?[\d.e+]+ Z/g)].map(m => m.slice(1, 5).map(Number));
      const shows = (x: number, y: number): boolean => !owner || rects.filter(([rx, ry, w, h]) => x > rx! && x < rx! + w! && y > ry! && y < ry! + h!).length % 2 === 1;
      const n = (name: string): number => Number(element.getAttribute(name));
      const edges: Array<[number, number, number, number]> = element.tagName === 'line' ? [[n('x1'), n('y1'), n('x2'), n('y2')]]
        : [[n('x'), n('y'), n('x') + n('width'), n('y')], [n('x'), n('y') + n('height'), n('x') + n('width'), n('y') + n('height')], [n('x'), n('y'), n('x'), n('y') + n('height')], [n('x') + n('width'), n('y'), n('x') + n('width'), n('y') + n('height')]];
      const matrix = (element as SVGGraphicsElement).getScreenCTM();
      if (!matrix) continue;
      for (const [x1, y1, x2, y2] of edges) for (let i = 0; i <= 200; i++) {
        const x = x1 + (x2 - x1) * i / 200, y = y1 + (y2 - y1) * i / 200, sx = matrix.a * x + matrix.c * y + matrix.e, sy = matrix.b * x + matrix.d * y + matrix.f;
        if (shows(x, y) && texts.some(box => sx > box.left + 1 && sx < box.right - 1 && sy > box.top + 1 && sy < box.bottom - 1)) { defects.push(`a judged line (${element.getAttribute('class')}) runs through a text at ${Math.round(x)}, ${Math.round(y)}`); break; }
      }
    }
  }
  for (const frame of document.querySelectorAll('.board-scroll')) {
    if (!frame.getClientRects().length || frame.scrollWidth <= frame.clientWidth + 1) continue;
    const window = frame.getBoundingClientRect();
    const labels = [...frame.querySelectorAll('svg.schematic text.sch-label, svg.engine-board .engine-content text')].filter(text => text.classList.contains('sch-label') || parseFloat(text.getAttribute('font-size') ?? '0') >= 18);
    if (!labels.some(text => { const box = text.getBoundingClientRect(); return box.width > 0 && box.right > window.left && box.left < window.right; })) defects.push(`the picture "${frame.getAttribute('aria-label')}" opens without a step in view`);
  }
  return defects;
}
