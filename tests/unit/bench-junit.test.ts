// JUnit XML from a bench report (bench --junit, report --junit): valid against the published JUnit
// schema (Windy Road's JUnit.xsd, encoded independently in tests/support/junit-xsd.ts), one test case
// per run in plan order, a judged failure as <failure> naming its error classes, a run without a
// verdict as <error> (never a failure with an invented reason), every untrusted string escaped.
// Expected values are written out by hand next to each case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCH_SCHEMA_V2, summarize, validateBenchReportV2, type BenchReportV2, type BenchRunV2 } from '../../src/bench/report.ts';
import { renderJunit, xmlEscape } from '../../src/bench/junit.ts';
import { childElements, parseXml, textContent, validateJunit, XmlError, type XmlElement } from '../support/junit-xsd.ts';

const hash = (c: string): string => c.repeat(64);
type Outcome = 'pass' | 'fail' | 'unjudged';
function run(taskId: string, seed: number, repeat: number, outcome: Outcome, errorClasses: string[] = [], note?: string): BenchRunV2 {
  const judged = outcome !== 'unjudged';
  return {
    id: `${taskId}-s${seed}-r${repeat}`, taskId, seed, repeat, status: judged ? 'completed' : 'infra_error', pass: outcome === 'pass', actions: judged ? 2 : 0, acceptedActions: judged ? 2 : 0, rejectedActions: 0, undos: 0, resets: 0,
    toolCalls: { observe: 1, act: judged ? 2 : 0, undo: 0, reset: 0, check: 0, total: judged ? 3 : 1 }, wallMs: 1234 + seed * 10 + repeat, referenceActions: null,
    checker: judged ? { session: { passed: outcome === 'pass', errorClasses }, native: null } : null, agentExitCode: judged ? 0 : null,
    ...(note !== undefined ? { note } : {}), ...(judged ? { artifacts: { session: hash('a'), native: null, checker: hash('c') } } : {}),
  };
}
/** Two tasks × seeds 3, 1 × two repeats; `connect` passes except one failure, `restyle` has a run without verdict. */
function report(options: { label?: string; name?: string; runs?: BenchRunV2[] } = {}): BenchReportV2 {
  const runs = options.runs ?? [
    run('connect', 3, 1, 'pass'), run('connect', 3, 2, 'fail', ['extra-arrow', 'loose-arrow']), run('connect', 1, 1, 'pass'), run('connect', 1, 2, 'pass'),
    run('restyle', 3, 1, 'fail'), run('restyle', 3, 2, 'unjudged', [], 'checker.json could not be written: EISDIR'), run('restyle', 1, 1, 'pass'), run('restyle', 1, 2, 'pass'),
  ];
  return validateBenchReportV2({
    schema: BENCH_SCHEMA_V2, createdAt: '2026-10-15T09:08:07.654Z', ...(options.label !== undefined ? { label: options.label } : {}),
    environment: { practonaut: '0.2.0-dev.0', excalidraw: '0.18.1', node: 'v22', os: { platform: 'linux', release: '6', arch: 'x64' }, mirror: 'off', world: { source: 'own', worldId: 'flows', version: '1.0.0', contentHash: hash('d'), package: { path: 'world.pnworld', sha256: hash('e') }, generated: [] } },
    agent: { kind: 'command', name: options.name ?? 'my-agent', command: ['my-agent', '{mcp_config}'], isolation: 'template-unrestricted', model: 'pn-model', modelSource: 'command-output', apiKeySource: null, keptEnv: [] },
    settings: { tasks: ['connect', 'restyle'], seeds: [3, 1], repeats: 2, timeoutSeconds: 300, maxActions: 50, mirror: 'off', prompt: '' },
    references: null, runs, summary: summarize(runs, 2),
  });
}
const valid = (xml: string): XmlElement => { assert.deepEqual(validateJunit(xml), [], xml); return parseXml(xml); };
const attribute = (node: XmlElement, name: string): string => node.attributes.get(name) ?? '';

test('a bench report is valid JUnit XML: one suite per task in plan order, one test case per run by seed (plan order) and repeat', () => {
  const root = valid(renderJunit(report()));
  assert.equal(root.name, 'testsuites');
  const suites = childElements(root, 'testsuite');
  assert.deepEqual(suites.map(suite => [attribute(suite, 'name'), attribute(suite, 'id'), attribute(suite, 'package')]), [['connect', '0', 'flows'], ['restyle', '1', 'flows']]);
  // Seeds in the plan's order (3 before 1), then repeats.
  assert.deepEqual(childElements(suites[0]!, 'testcase').map(testcase => attribute(testcase, 'name')), ['connect seed 3 repeat 1', 'connect seed 3 repeat 2', 'connect seed 1 repeat 1', 'connect seed 1 repeat 2']);
  // The instance (task × seed) is the class, so a CI view groups the repeats of an instance.
  assert.deepEqual(childElements(suites[1]!, 'testcase').map(testcase => attribute(testcase, 'classname')), ['flows.restyle.seed-3', 'flows.restyle.seed-3', 'flows.restyle.seed-1', 'flows.restyle.seed-1']);
  // Counts by hand: connect 4 tests, 1 failure; restyle 4 tests, 1 failure, 1 error (the run without a verdict).
  assert.deepEqual(suites.map(suite => ['tests', 'failures', 'errors'].map(name => attribute(suite, name))), [['4', '1', '0'], ['4', '1', '1']]);
  // Times are the runner's wall times from the report (seconds): connect 1265+1266+1245+1246 ms.
  assert.equal(attribute(suites[0]!, 'time'), '5.022');
  assert.equal(attribute(childElements(suites[0]!, 'testcase')[0]!, 'time'), '1.265');
  // The schema's timestamp has no fraction and no zone; the host name is never the machine's.
  assert.deepEqual([attribute(suites[0]!, 'timestamp'), attribute(suites[0]!, 'hostname')], ['2026-10-15T09:08:07', 'localhost']);
});

test('a judged failure is a <failure> naming its error classes; a run without a verdict is an <error>, never a failure', () => {
  const suites = childElements(valid(renderJunit(report())), 'testsuite');
  const failed = childElements(childElements(suites[0]!, 'testcase')[1]!);
  assert.deepEqual(failed.map(node => node.name), ['failure']);
  assert.equal(attribute(failed[0]!, 'type'), 'extra-arrow loose-arrow');
  assert.match(attribute(failed[0]!, 'message'), /Error class extra-arrow\b.*Error class loose-arrow\b/);
  // No error class and no bench folder: the failure says the goal was not met and where the condition is shown.
  const plain = childElements(childElements(suites[1]!, 'testcase')[0]!)[0]!;
  assert.deepEqual([plain.name, attribute(plain, 'type')], ['failure', 'goal-not-met']);
  assert.match(attribute(plain, 'message'), /^Not passed: the checker found the goal not met; which condition is shown with the bench folder\.$/);
  const unjudged = childElements(childElements(suites[1]!, 'testcase')[1]!);
  assert.deepEqual(unjudged.map(node => [node.name, attribute(node, 'type')]), [['error', 'no-verdict']]);
  assert.match(attribute(unjudged[0]!, 'message'), /^No verdict: the run could not be judged, so it counts as not passed/);
  assert.match(textContent(unjudged[0]!), /Runner note: checker\.json could not be written: EISDIR/);
  // Passed runs carry no child at all.
  assert.deepEqual(childElements(childElements(suites[0]!, 'testcase')[0]!), []);
  // German: the same structure, the reasons in German.
  const german = childElements(valid(renderJunit(report(), 'de')), 'testsuite');
  assert.match(attribute(childElements(childElements(german[1]!, 'testcase')[1]!)[0]!, 'message'), /^Kein Urteil: der Lauf ließ sich nicht beurteilen/);
});

test('every suite carries n, isolation level, verification status and the header line', () => {
  for (const verification of ['consistency-checked', 're-verified'] as const) {
    const suite = childElements(valid(renderJunit(report({ label: 'nightly' }), 'en', verification)), 'testsuite')[0]!;
    const properties = new Map(childElements(childElements(suite, 'properties')[0]!, 'property').map(node => [attribute(node, 'name'), attribute(node, 'value')]));
    assert.equal(properties.get('practonaut.verification'), verification);
    assert.deepEqual(['practonaut.runs', 'practonaut.runs.passed', 'practonaut.runs.unjudged', 'practonaut.isolation', 'practonaut.mirror', 'practonaut.label', 'practonaut.model.selfReported'].map(name => properties.get(name)), ['8', '5', '1', 'template-unrestricted', 'off', 'nightly', 'pn-model']);
    const out = textContent(childElements(suite, 'system-out')[0]!);
    // Instances by hand: connect s3 1/2 (at least half: passed), connect s1 2/2, restyle s3 0/2 (one not judged), restyle s1 2/2.
    assert.match(out, /^5\/8 runs passed · 3\/4 instances passed/);
    assert.match(out, verification === 're-verified' ? /re-verified from the artifacts/ : /consistency-checked, not re-verified/);
    assert.match(out, /compare --fail-on-regression gates on instance regressions/);
  }
});

test('untrusted text is escaped, and characters XML 1.0 does not allow are written as visible escapes', () => {
  const hostile = 'A&B <b>"q" \'s\' ]]> \u0007bell \u202Eevil \t\ttab\nline \uD800lone \uFFFE end';
  const xml = renderJunit(report({ label: hostile, name: 'agent <x> & "y"', runs: [run('connect', 3, 1, 'pass'), run('connect', 3, 2, 'unjudged', [], hostile), run('connect', 1, 1, 'pass'), run('connect', 1, 2, 'pass'), run('restyle', 3, 1, 'pass'), run('restyle', 3, 2, 'pass'), run('restyle', 1, 1, 'pass'), run('restyle', 1, 2, 'pass')] }));
  const root = valid(xml);
  // No raw markup and no illegal character survives (validateJunit's reader checks every character).
  assert.equal(xml.includes('<b>'), false);
  assert.equal(xml.includes(']]>'), false, '"]]>" is escaped in text');
  const properties = new Map(childElements(childElements(childElements(root, 'testsuite')[0]!, 'properties')[0]!, 'property').map(node => [attribute(node, 'name'), attribute(node, 'value')]));
  assert.equal(properties.get('practonaut.label'), 'A&B <b>"q" \'s\' ]]> \\u{0007}bell \\u{202e}evil \\u{0009}\\u{0009}tab\\u{000a}line \\u{d800}lone \\u{fffe} end');
  assert.equal(properties.get('practonaut.agent'), 'agent <x> & "y"');
  assert.equal(xmlEscape('<&>"\''), '&lt;&amp;&gt;&quot;&apos;');
  // The note of a run without a verdict, in the error's body, escaped the same way.
  assert.match(textContent(childElements(childElements(childElements(root, 'testsuite')[0]!, 'testcase')[1]!)[0]!), /Runner note: A&B <b>"q" 's' \]\]> \\u\{0007\}bell/);
});

test('the same report gives the same bytes, whatever the order of its runs within a task', () => {
  const first = renderJunit(report()), again = renderJunit(report());
  assert.equal(first, again);
  // The same runs, seeds and repeats listed in another order (tasks keep their first appearance).
  const value = report();
  const shuffled = report({ runs: [value.runs[3]!, value.runs[1]!, value.runs[0]!, value.runs[2]!, value.runs[7]!, value.runs[5]!, value.runs[6]!, value.runs[4]!] });
  assert.equal(renderJunit(shuffled), first);
});

test('the validator itself rejects what JUnit.xsd forbids (negative controls)', () => {
  const good = renderJunit(report());
  assert.deepEqual(validateJunit(good), []);
  const broken: Array<[string, string, RegExp]> = [
    ['missing hostname', good.replace(' hostname="localhost"', ''), /required attribute hostname is missing/],
    ['undeclared attribute', good.replace('<testsuite name="connect"', '<testsuite skipped="0" name="connect"'), /attribute skipped is not declared/],
    ['skipped element', good.replace('<testcase name="connect seed 3 repeat 1" classname="flows.connect.seed-3" time="1.265"/>', '<testcase name="connect seed 3 repeat 1" classname="flows.connect.seed-3" time="1.265"><skipped/></testcase>'), /<skipped> is not allowed in a testcase/],
    ['timestamp with zone', good.replace('timestamp="2026-10-15T09:08:07"', 'timestamp="2026-10-15T09:08:07Z"'), /is not a valid ISO8601_DATETIME_PATTERN/],
    ['impossible date', good.replace('timestamp="2026-10-15T09:08:07"', 'timestamp="2026-02-30T09:08:07"'), /is not a valid ISO8601_DATETIME_PATTERN/],
    ['time not a decimal', good.replace('time="1.265"', 'time="1,265"'), /is not a valid xs:decimal/],
    ['tests not an int', good.replace('tests="4"', 'tests="four"'), /is not a valid xs:int/],
    ['id not incremented', good.replace('id="1"', 'id="2"'), /id must be 1/],
    ['attributes on testsuites', good.replace('<testsuites>', '<testsuites tests="8">'), /attribute tests is not declared/],
    ['system-err missing', good.replace('<system-err></system-err>', ''), /content must be properties, testcase\*, system-out, system-err/],
    ['properties after a testcase', good.replace(/<properties>[\s\S]*?<\/properties>\n/, '').replace('<system-out>', '<properties></properties><system-out>'), /content must be properties/],
    ['failure and error together', good.replace('</failure></testcase>', '</failure><error type="x"/></testcase>'), /at most one <error> or <failure>/],
    ['failure without type', good.replace('<failure type="extra-arrow loose-arrow"', '<failure'), /required attribute type is missing/],
    ['text between suites', good.replace('</testsuite>\n  <testsuite', '</testsuite>stray<testsuite'), /text is not allowed here/],
    ['element inside system-out', good.replace('<system-out>', '<system-out><b/>'), /element <b> is not allowed in text content/],
    ['empty property name', good.replace('name="practonaut.report"', 'name=" "'), /not a valid xs:token \(minLength 1\)/],
    ['content inside a property', good.replace('<property name="practonaut.report" value="practonaut.bench/2"/>', '<property name="practonaut.report" value="practonaut.bench/2"> </property>'), /empty content model/],
  ];
  for (const [name, xml, problem] of broken) {
    assert.notEqual(xml, good, `${name}: the mutation applies`);
    assert.match(validateJunit(xml).join('\n'), problem, name);
  }
  const malformed: Array<[string, string]> = [
    ['control character', good.replace('localhost', 'local\u0007host')], ['lone surrogate', good.replace('localhost', 'local\uDC00host')],
    ['bare ampersand', good.replace('localhost', 'local&host')], ['undeclared entity', good.replace('localhost', 'local&nbsp;host')],
    ['reference to an illegal character', good.replace('localhost', 'local&#1;host')], ['unclosed element', good.replace('</testsuites>', '')],
    ['DOCTYPE', good.replace('<testsuites>', '<!DOCTYPE x><testsuites>')], ['CDATA', good.replace('<system-err></system-err>', '<system-err><![CDATA[x]]></system-err>')],
    ['repeated attribute', good.replace('hostname="localhost"', 'hostname="localhost" hostname="x"')], ['"<" in an attribute', good.replace('localhost', 'local<host')],
  ];
  for (const [name, xml] of malformed) {
    assert.match(validateJunit(xml)[0] ?? '', /^not well-formed XML/, name);
    assert.throws(() => parseXml(xml), XmlError, name);
  }
});
