/**
 * A strict validator for JUnit XML, written for the tests from the published schema, independently of
 * the code that writes the files (src/bench/junit.ts).
 *
 * Schema: the Apache Ant JUnit XML schema as published by Windy Road, `JUnit.xsd` of
 * https://github.com/windyroad/JUnit-Schema at commit 332b8f3f (2018, the version that added
 * <skipped>), Apache License 2.0. Its rules, as encoded below:
 *
 * - The root is <testsuites> (no attributes; zero or more <testsuite>) or a single <testsuite>.
 * - <testsuite> (type "testsuite"): required attributes name (xs:token, minLength 1), timestamp
 *   (xs:dateTime restricted to the pattern [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}),
 *   hostname (xs:token, minLength 1), tests, failures, errors (xs:int), time (xs:decimal); optional
 *   skipped (xs:int); inside
 *   <testsuites> also package (xs:token) and id (xs:int; the schema's annotation: "starts at 0 for the
 *   first testsuite and is incremented by 1"). No other attribute. Content, in this order: exactly one
 *   <properties>, zero or more <testcase>, exactly one <system-out>, exactly one <system-err>.
 * - <properties>: zero or more <property name="xs:token, minLength 1" value="xs:string"/> (empty).
 * - <testcase>: required name (xs:token), classname (xs:token), time (xs:decimal); content: optionally
 *   one of <skipped>, <error> or <failure>. <error> and <failure> have text content ("pre-string"), a
 *   required type (xs:string) and an optional message (xs:string). <skipped> is accepted with text
 *   content and an optional message; Practonaut never writes it, so its content model is not pinned
 *   further here.
 * - <system-out>, <system-err>: text only.
 * Element-only content may hold whitespace between elements; an element with an empty content model
 * (<property>) holds nothing at all.
 *
 * XML well-formedness is checked by a reader of its own (XML 1.0): an optional declaration, no DOCTYPE,
 * no processing instruction or CDATA, every character a legal XML 1.0 Char (no C0 control except tab,
 * newline and carriage return, no lone surrogate, no U+FFFE/U+FFFF), only the five predefined entities
 * and character references to legal characters, quoted attributes without `<`, no repeated attribute,
 * no `]]>` in text, matching end tags, one root element.
 */

export interface XmlElement { name: string; attributes: Map<string, string>; children: Array<XmlElement | string> }

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const isXmlChar = (code: number): boolean => code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);

export class XmlError extends Error {}

/** Parses a whole document (strict XML 1.0 subset); throws XmlError naming the first problem. */
export function parseXml(text: string): XmlElement {
  // Every code unit pair must be a legal XML Char (a lone surrogate is not a character at all).
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new XmlError(`lone high surrogate at ${i}`);
      i++; continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) throw new XmlError(`lone low surrogate at ${i}`);
    if (!isXmlChar(unit)) throw new XmlError(`character U+${unit.toString(16).padStart(4, '0')} at ${i} is not allowed in XML 1.0`);
  }
  let at = 0;
  const fail = (message: string): never => { throw new XmlError(`${message} (at ${at})`); };
  const space = (): void => { while (at < text.length && /[ \t\r\n]/.test(text[at]!)) at++; };
  const name = (): string => {
    const match = /^[A-Za-z_:][A-Za-z0-9._:-]*/.exec(text.slice(at, at + 256));
    if (!match) fail('expected a name');
    at += match![0].length; return match![0];
  };
  const references = (raw: string): string => raw.replace(/&([^;&]*);|&/g, (whole, ref: string | undefined) => {
    if (ref === undefined) fail('a bare & (not a reference)');
    if (ref!.startsWith('#')) {
      const code = /^#x[0-9A-Fa-f]+$/.test(ref!) ? parseInt(ref!.slice(2), 16) : /^#[0-9]+$/.test(ref!) ? parseInt(ref!.slice(1), 10) : NaN;
      if (!Number.isFinite(code) || !isXmlChar(code)) fail(`character reference &${ref}; is not a legal character`);
      return String.fromCodePoint(code);
    }
    const value = ENTITIES[ref!];
    if (value === undefined) fail(`undeclared entity &${ref};`);
    return value!;
  });
  const misc = (): void => {
    for (;;) {
      space();
      if (text.startsWith('<!--', at)) {
        const end = text.indexOf('-->', at + 4);
        if (end < 0) fail('unterminated comment');
        if (text.slice(at + 4, end).includes('--')) fail('"--" inside a comment');
        at = end + 3; continue;
      }
      return;
    }
  };
  if (text.startsWith('<?xml', 0)) {
    const end = text.indexOf('?>');
    if (end < 0) fail('unterminated declaration');
    const declaration = text.slice(0, end + 2);
    if (!/^<\?xml\s+version\s*=\s*(["'])1\.0\1(\s+encoding\s*=\s*(["'])[A-Za-z][A-Za-z0-9._-]*\3)?(\s+standalone\s*=\s*(["'])(yes|no)\5)?\s*\?>$/.test(declaration)) fail('malformed XML declaration');
    at = end + 2;
  }
  misc();
  if (text.startsWith('<!DOCTYPE', at)) fail('a DOCTYPE is not accepted');
  const element = (): XmlElement => {
    if (text[at] !== '<') fail('expected an element');
    at++;
    const tag = name(), attributes = new Map<string, string>();
    for (;;) {
      const before = at; space();
      if (text.startsWith('/>', at)) { at += 2; return { name: tag, attributes, children: [] }; }
      if (text[at] === '>') { at++; break; }
      if (at === before) fail('attributes must be separated by white space');
      const key = name(); space();
      if (text[at] !== '=') fail(`attribute ${key} without a value`);
      at++; space();
      const quote = text[at];
      if (quote !== '"' && quote !== "'") fail(`attribute ${key} is not quoted`);
      const end = text.indexOf(quote!, at + 1);
      if (end < 0) fail(`attribute ${key} is not terminated`);
      const raw = text.slice(at + 1, end);
      if (raw.includes('<')) fail(`"<" inside attribute ${key}`);
      if (attributes.has(key)) fail(`attribute ${key} repeated`);
      // Attribute-value normalisation (XML 1.0 §3.3.3): literal white space characters become spaces.
      attributes.set(key, references(raw.replace(/[\t\n\r]/g, ' ')));
      at = end + 1;
    }
    const children: Array<XmlElement | string> = [];
    for (;;) {
      if (at >= text.length) fail(`<${tag}> is not closed`);
      if (text.startsWith('</', at)) {
        at += 2;
        const closing = name(); space();
        if (closing !== tag || text[at] !== '>') fail(`end tag </${closing}> does not close <${tag}>`);
        at++; return { name: tag, attributes, children };
      }
      if (text.startsWith('<!--', at)) { const end = text.indexOf('-->', at + 4); if (end < 0) fail('unterminated comment'); at = end + 3; continue; }
      if (text.startsWith('<![CDATA[', at) || text.startsWith('<?', at) || text.startsWith('<!', at)) fail('CDATA, processing instructions and declarations are not accepted in content');
      if (text[at] === '<') { children.push(element()); continue; }
      const end = text.indexOf('<', at), raw = text.slice(at, end < 0 ? text.length : end);
      if (raw.includes(']]>')) fail('"]]>" in text');
      children.push(references(raw)); at += raw.length;
    }
  };
  const root = element();
  misc();
  if (at !== text.length) fail('content after the root element');
  return root;
}

// ---- XML Schema datatypes, as JUnit.xsd uses them ----
const collapse = (value: string): string => value.replace(/[\t\n\r ]+/g, ' ').trim();
const isToken = (value: string, minLength = 0): boolean => collapse(value).length >= minLength;
const isInt = (value: string): boolean => { const v = collapse(value); if (!/^[+-]?[0-9]+$/.test(v)) return false; const n = Number(v); return n >= -2147483648 && n <= 2147483647; };
const isDecimal = (value: string): boolean => /^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$/.test(collapse(value));
/** ISO8601_DATETIME_PATTERN: xs:dateTime restricted to YYYY-MM-DDThh:mm:ss (no fraction, no zone). */
function isTimestamp(value: string): boolean {
  const v = collapse(value), match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})$/.exec(v);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year === 0 || days === undefined || day < 1 || day > days) return false;
  // xs:dateTime allows 24:00:00 as the end of a day, nothing else past 23:59:59.
  return (hour <= 23 && minute <= 59 && second <= 59) || (hour === 24 && minute === 0 && second === 0);
}

/** Every rule of JUnit.xsd the document breaks (empty: valid). */
export function validateJunit(text: string): string[] {
  let root: XmlElement;
  try { root = parseXml(text); } catch (error) { return [`not well-formed XML: ${(error as Error).message}`]; }
  const problems: string[] = [];
  const at = (path: string, message: string): void => { problems.push(`${path}: ${message}`); };
  const elements = (node: XmlElement, path: string, allowText: boolean): XmlElement[] => {
    const out: XmlElement[] = [];
    for (const child of node.children) {
      if (typeof child !== 'string') out.push(child);
      else if (!allowText && child.trim() !== '') at(path, `text is not allowed here: ${JSON.stringify(child.slice(0, 40))}`);
    }
    return out;
  };
  const attributes = (node: XmlElement, path: string, rules: Record<string, { required: boolean; valid: (value: string) => boolean; type: string }>): void => {
    for (const key of node.attributes.keys()) if (!Object.hasOwn(rules, key)) at(path, `attribute ${key} is not declared`);
    for (const [key, rule] of Object.entries(rules)) {
      const value = node.attributes.get(key);
      if (value === undefined) { if (rule.required) at(path, `required attribute ${key} is missing`); continue; }
      if (!rule.valid(value)) at(path, `attribute ${key}="${value}" is not a valid ${rule.type}`);
    }
  };
  const textOnly = (node: XmlElement, path: string): void => { for (const child of node.children) if (typeof child !== 'string') at(path, `element <${child.name}> is not allowed in text content`); };
  const anyString = { valid: (): boolean => true, type: 'xs:string' };
  const suiteAttributes = (aggregated: boolean) => ({
    name: { required: true, valid: (v: string) => isToken(v, 1), type: 'xs:token (minLength 1)' },
    timestamp: { required: true, valid: isTimestamp, type: 'ISO8601_DATETIME_PATTERN' },
    hostname: { required: true, valid: (v: string) => isToken(v, 1), type: 'xs:token (minLength 1)' },
    tests: { required: true, valid: isInt, type: 'xs:int' }, failures: { required: true, valid: isInt, type: 'xs:int' }, errors: { required: true, valid: isInt, type: 'xs:int' },
    skipped: { required: false, valid: isInt, type: 'xs:int' },
    time: { required: true, valid: isDecimal, type: 'xs:decimal' },
    ...(aggregated ? { package: { required: true, valid: (v: string) => isToken(v), type: 'xs:token' }, id: { required: true, valid: isInt, type: 'xs:int' } } : {}),
  });
  const suite = (node: XmlElement, path: string, aggregated: boolean): void => {
    attributes(node, path, suiteAttributes(aggregated));
    const children = elements(node, path, false), names = children.map(child => child.name);
    // properties, testcase*, system-out, system-err: exactly this sequence.
    const shape = names.length >= 3 && names[0] === 'properties' && names.at(-2) === 'system-out' && names.at(-1) === 'system-err' && names.slice(1, -2).every(name => name === 'testcase');
    if (!shape) { at(path, `content must be properties, testcase*, system-out, system-err; found ${names.join(', ') || 'nothing'}`); return; }
    const properties = children[0]!;
    attributes(properties, `${path}/properties`, {});
    elements(properties, `${path}/properties`, false).forEach((property, index) => {
      const where = `${path}/properties/property[${index}]`;
      if (property.name !== 'property') { at(where, `<${property.name}> is not allowed in properties`); return; }
      attributes(property, where, { name: { required: true, valid: (v: string) => isToken(v, 1), type: 'xs:token (minLength 1)' }, value: { required: true, ...anyString } });
      if (property.children.length) at(where, 'property has an empty content model');
    });
    children.slice(1, -2).forEach((testcase, index) => {
      const where = `${path}/testcase[${index}]`;
      attributes(testcase, where, { name: { required: true, valid: (v: string) => isToken(v), type: 'xs:token' }, classname: { required: true, valid: (v: string) => isToken(v), type: 'xs:token' }, time: { required: true, valid: isDecimal, type: 'xs:decimal' } });
      const outcome = elements(testcase, where, false);
      if (outcome.length > 1) at(where, `at most one <skipped>, <error> or <failure>, found ${outcome.map(child => child.name).join(', ')}`);
      for (const child of outcome) {
        if (child.name === 'skipped') { attributes(child, `${where}/skipped`, { message: { required: false, ...anyString } }); textOnly(child, `${where}/skipped`); continue; }
        if (child.name !== 'error' && child.name !== 'failure') { at(where, `<${child.name}> is not allowed in a testcase`); continue; }
        attributes(child, `${where}/${child.name}`, { type: { required: true, ...anyString }, message: { required: false, ...anyString } });
        textOnly(child, `${where}/${child.name}`);
      }
    });
    for (const output of children.slice(-2)) { attributes(output, `${path}/${output.name}`, {}); textOnly(output, `${path}/${output.name}`); }
  };
  if (root.name === 'testsuites') {
    attributes(root, 'testsuites', {});
    elements(root, 'testsuites', false).forEach((child, index) => {
      if (child.name !== 'testsuite') { at('testsuites', `<${child.name}> is not allowed here`); return; }
      suite(child, `testsuites/testsuite[${index}]`, true);
      if (child.attributes.get('id') !== undefined && collapse(child.attributes.get('id')!) !== String(index)) at(`testsuites/testsuite[${index}]`, `id must be ${index} (starts at 0, incremented by 1)`);
    });
  } else if (root.name === 'testsuite') suite(root, 'testsuite', false);
  else at(root.name, 'the root must be <testsuites> or <testsuite>');
  return problems;
}

/** Child elements of a node with the given name (test helper). */
export const childElements = (node: XmlElement, name?: string): XmlElement[] => node.children.filter((child): child is XmlElement => typeof child !== 'string' && (name === undefined || child.name === name));
/** All text inside a node. */
export const textContent = (node: XmlElement): string => node.children.map(child => typeof child === 'string' ? child : textContent(child)).join('');
