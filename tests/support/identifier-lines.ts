// Identifiers on a rendered report or compare page that break across lines (design-language §10.5,
// design reviews R1 and R2): every word of an identifier (`.id`, and data that is not a quoted label)
// and every flag (`.flag`) of at most 32 characters must sit on one line, so no identifier is ever
// split at its own hyphens, which reads exactly like the page's hyphenation. A longer word, such as a
// hash, may wrap; so may a quoted label (`.quoted`: the author's text, wrapping like text). An instance
// name in a compare page's table is held to the same: no word of the cell breaks across lines (design
// review R3: "restyle-flow · S" / "eed 1" in a half-width stacked cell). Run in the page by test:a11y
// (`page.evaluate(brokenIdentifiers)`): it measures the line boxes as rendered.
export function brokenIdentifiers(): string[] {
  const broken = new Set<string>();
  for (const element of document.querySelectorAll('.data:not(.quoted), .id, .flag, [aria-labelledby="instances"] td:first-child')) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (const word of text.matchAll(/\S+/gu)) {
        if (word[0].length > 32) continue;
        const range = document.createRange();
        range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
        const lines = new Set([...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => Math.round(rect.top)));
        if (lines.size > 1) broken.add(word[0]);
      }
    }
  }
  return [...broken];
}
