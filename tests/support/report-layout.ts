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
