// Layout defects on a rendered report or compare page that the design reviews found (R3, R4), measured
// as rendered by test:a11y (`page.evaluate(layoutDefects)`) at every width and theme:
// - a formal condition's line never ends on an operator ("=" alone at a line end, its operand on the
//   next line) unless operator and operand could not share a line, and no word of it shorter than a
//   line is cut inside ("u" / "nd");
// - in a stacked compare table the instance and the change column each take the whole row (a sentence
//   squeezed into a half-width cell beside an empty half);
// - no table cell's content is wider than its cell ("(3 von 3 Läufen" past the card's edge);
// - a compact table fills its column wherever it stacks (a stub of a card at 320 px).
export function layoutDefects(): string[] {
  const defects: string[] = [];
  const wordsOf = (element: Element): Array<{ text: string; tops: number[]; width: number }> => {
    const words: Array<{ text: string; tops: number[]; width: number }> = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const word of (node.textContent ?? '').matchAll(/\S+/gu)) {
        const range = document.createRange();
        range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
        const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
        const tops = [...new Set(rects.map(rect => Math.round(rect.top)))].sort((a, b) => a - b);
        if (tops.length) words.push({ text: word[0], tops, width: rects.reduce((sum, rect) => sum + rect.width, 0) });
      }
    }
    return words;
  };
  const operators = new Set(['=', '≈', '<', '>', '≤', '≥']);
  for (const formal of document.querySelectorAll('.formal')) {
    const words = wordsOf(formal), line = formal.clientWidth, space = 5;
    words.forEach((word, index) => {
      // A word cut across lines although it fits a line by itself.
      if (word.tops.length > 1 && word.width < line) defects.push(`formal word "${word.text}" is cut across lines`);
      const next = words[index + 1];
      if (operators.has(word.text) && next && next.tops[0]! > word.tops[word.tops.length - 1]! && word.width + space + next.width <= line) defects.push(`formal line ends on "${word.text}"`);
    });
  }
  for (const row of document.querySelectorAll('[aria-labelledby="instances"] tbody tr')) {
    const cells = [...row.querySelectorAll('td')];
    if (cells.length < 2 || getComputedStyle(cells[0]!).display !== 'block') continue;
    const full = row.getBoundingClientRect().width;
    for (const cell of [cells[0]!, cells[cells.length - 1]!]) if (cell.getBoundingClientRect().width < full / 2) defects.push(`stacked cell "${(cell.textContent ?? '').slice(0, 30)}" takes half a row`);
  }
  for (const cell of document.querySelectorAll('td')) {
    if (cell.getClientRects().length && cell.scrollWidth > cell.clientWidth + 1) defects.push(`cell "${(cell.textContent ?? '').slice(0, 30)}" is ${cell.scrollWidth - cell.clientWidth} px wider than its cell`);
  }
  for (const region of document.querySelectorAll('.scroll.compact')) {
    const table = region.querySelector('table'), column = region.parentElement;
    if (table && column && getComputedStyle(table).display === 'block' && region.getBoundingClientRect().width < column.getBoundingClientRect().width - 1) defects.push('a stacked compact table is narrower than its column');
  }
  return defects;
}
