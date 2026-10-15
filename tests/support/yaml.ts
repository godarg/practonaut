/**
 * A reader for the YAML subset the repository's GitHub workflows use, for tests that check a
 * workflow's structure (tests/unit/ci-workflows.test.ts). Block mappings and sequences by indentation,
 * `- key: value` items, literal and folded block scalars (`|`, `|-`, `>`), single- and double-quoted
 * scalars, flow sequences of scalars (`[a, 'b']`) and comments. Every scalar stays a string (no YAML
 * 1.1 booleans: `on` is the key "on"). Anything outside the subset throws, so a test never reads a
 * structure the file does not have.
 */
export type Yaml = string | null | Yaml[] | { [key: string]: Yaml };

const indentOf = (line: string): number => line.length - line.trimStart().length;
const skippable = (line: string): boolean => line.trim() === '' || line.trimStart().startsWith('#');
const KEY = /^([A-Za-z_][\w.-]*):(?:\s+|$)/;

/** The text without a trailing ` # comment` (a # inside quotes is text). */
function withoutComment(text: string): string {
  let quote: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) { if (char === quote) quote = null; continue; }
    if ((char === '"' || char === "'") && (index === 0 || /[\s[,]/.test(text[index - 1]!))) quote = char;
    else if (char === '#' && (index === 0 || /\s/.test(text[index - 1]!))) return text.slice(0, index).trimEnd();
  }
  return text.trimEnd();
}
function scalar(raw: string, where: number): Yaml {
  const text = withoutComment(raw).trim();
  if (text === '' || text === '~' || text === 'null') return text === '' ? null : text;
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new Error(`line ${where}: unterminated single-quoted scalar`);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new Error(`line ${where}: unterminated double-quoted scalar`);
    return JSON.parse(text) as string;
  }
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new Error(`line ${where}: unterminated flow sequence`);
    const inner = text.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map(item => scalar(item, where));
  }
  if (text.startsWith('{') || text.startsWith('&') || text.startsWith('*') || text.startsWith('!')) throw new Error(`line ${where}: ${text[0]} is outside the supported subset`);
  return text;
}

export function parseYaml(source: string): Yaml {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let at = 0;
  const skip = (): void => { while (at < lines.length && skippable(lines[at]!)) at++; };
  const block = (parent: number, style: string): string => {
    const taken: string[] = [];
    while (at < lines.length && (lines[at]!.trim() === '' || indentOf(lines[at]!) > parent)) taken.push(lines[at++]!);
    while (taken.length && taken.at(-1)!.trim() === '') taken.pop();
    const indent = Math.min(...taken.filter(line => line.trim() !== '').map(indentOf));
    const body = taken.map(line => line.slice(Math.min(indent, indentOf(line))));
    const text = style.startsWith('>') ? body.join(' ').replace(/ {2,}/g, ' ') : body.join('\n');
    return style.endsWith('-') ? text : `${text}\n`;
  };
  const value = (rest: string, indent: number, where: number): Yaml => {
    const text = withoutComment(rest).trim();
    if (/^[|>][-+]?$/.test(text)) return block(indent, text);
    if (text !== '') return scalar(text, where);
    skip();
    if (at >= lines.length) return null;
    const next = lines[at]!, nextIndent = indentOf(next);
    if (nextIndent > indent) return node(nextIndent);
    if (nextIndent === indent && /^-(\s|$)/.test(next.trimStart())) return sequence(indent);
    return null;
  };
  const mapping = (indent: number): Yaml => {
    const out: { [key: string]: Yaml } = {};
    for (;;) {
      skip();
      if (at >= lines.length) return out;
      const line = lines[at]!, own = indentOf(line), content = line.trim();
      if (own < indent || (own === indent && /^-(\s|$)/.test(content))) return out;
      if (own > indent) throw new Error(`line ${at + 1}: unexpected indentation`);
      const key = KEY.exec(content);
      if (!key) throw new Error(`line ${at + 1}: expected "key: value", found ${JSON.stringify(content.slice(0, 40))}`);
      if (Object.hasOwn(out, key[1]!)) throw new Error(`line ${at + 1}: key ${key[1]} repeated`);
      const where = ++at;
      out[key[1]!] = value(content.slice(key[0].length), indent, where);
    }
  };
  const sequence = (indent: number): Yaml => {
    const out: Yaml[] = [];
    for (;;) {
      skip();
      if (at >= lines.length) return out;
      const line = lines[at]!, content = line.trim();
      if (indentOf(line) !== indent || !/^-(\s|$)/.test(content)) return out;
      const item = content.slice(1).trim();
      if (KEY.test(item)) { lines[at] = `${' '.repeat(indent + 2)}${item}`; out.push(mapping(indent + 2)); continue; }
      const where = ++at;
      out.push(item === '' ? value('', indent, where) : scalar(item, where));
    }
  };
  const node = (indent: number): Yaml => /^-(\s|$)/.test(lines[at]!.trimStart()) ? sequence(indent) : mapping(indent);
  skip();
  if (at >= lines.length) return null;
  const root = node(indentOf(lines[at]!));
  skip();
  if (at < lines.length) throw new Error(`line ${at + 1}: content after the document`);
  return root;
}
