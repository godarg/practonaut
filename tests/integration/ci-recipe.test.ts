// The CI recipe (roadmap 0.2.0, Should 5), run locally with the commands of
// .github/workflows/ci-recipe-check.yml and examples/ci/practonaut-bench.yml: the oracle agent benches
// the fixture world (two instances × three repeats, real mirror) with --junit, the report is rendered,
// and compare --fail-on-regression gates against the committed baseline. Without the planted
// regression the gate passes (exit 0); with it — a valid reference that does not fit the action
// budget, so every candidate repeat ends with an extra arrow — it fails with instance_regression.
// Both JUnit files validate against the published JUnit schema (tests/support/junit-xsd.ts) and parse in
// Chromium's own XML parser.
//
// The committed baseline (tests/fixtures/ci-recipe/baseline.json) was made with the same command and
// tests/fixtures/ci-recipe/oracle.json; this test also shows that it is still comparable with a fresh
// bench (same world content, grid, mirror, budget and isolation), or compare would refuse it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childElements, parseXml, validateJunit, type XmlElement } from '../support/junit-xsd.ts';
import { launchBrowser } from '../support/browser.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../fixtures/ci-recipe/', import.meta.url));
const practonaut = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: process.env });
const benchRoot = (): string => join(process.env.PRACTONAUT_HOME!, 'bench');
const benches = async (): Promise<Set<string>> => new Set(await readdir(benchRoot()).catch(() => [] as string[]));

/** `bench` as the recipe runs it; returns the new bench folder and the JUnit file. */
async function benchCandidate(out: string, oracle: string, name: string): Promise<{ folder: string; junit: string }> {
  const before = await benches(), junit = join(out, `${name}.xml`);
  const result = practonaut('bench', '--agent', 'oracle', '--world', join(FIXTURE, 'world'), '--oracle', join(FIXTURE, oracle),
    '--seed-list', '1,2', '--repeats', '3', '--max-actions', '3', '--mirror', 'required', '--label', name, '--junit', junit);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /JUnit XML: /);
  const created = [...await benches()].filter(entry => !before.has(entry));
  assert.equal(created.length, 1, `one new bench folder: ${created.join(', ')}`);
  return { folder: join(benchRoot(), created[0]!), junit };
}
const testcases = (root: XmlElement): XmlElement[] => childElements(root, 'testsuite').flatMap(suite => childElements(suite, 'testcase'));

test('the CI recipe passes against the committed baseline and fails on a planted instance regression; both JUnit files validate', { timeout: 300_000 }, async () => {
  const out = await mkdtemp(join(realpathSync(tmpdir()), 'pn-ci-recipe-'));
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    /** Chromium's XML parser: a parse error comes back as a <parsererror> element. */
    const chromiumParses = async (xml: string): Promise<boolean> => page.evaluate(text => new DOMParser().parseFromString(text, 'application/xml').getElementsByTagName('parsererror').length === 0, xml);

    // 1. The candidate as it is: the gate passes.
    const good = await benchCandidate(out, 'oracle.json', 'candidate');
    const goodXml = await readFile(good.junit, 'utf8');
    assert.deepEqual(validateJunit(goodXml), []);
    assert.equal(await chromiumParses(goodXml), true);
    const goodCases = testcases(parseXml(goodXml));
    assert.equal(goodCases.length, 6, 'one test case per run: 1 task × 2 seeds × 3 repeats');
    assert.deepEqual(goodCases.flatMap(testcase => childElements(testcase).map(child => child.name)), [], 'every run passed');
    const rendered = practonaut('report', join(good.folder, 'report.json'), '--html', join(out, 'report.html'));
    assert.equal(rendered.status, 0, rendered.stderr);
    const gate = practonaut('compare', join(FIXTURE, 'baseline.json'), join(good.folder, 'report.json'), '--fail-on-regression', '--html', join(out, 'compare.html'));
    assert.equal(gate.status, 0, gate.stderr);
    assert.match(gate.stdout, /no instance regression/);

    // 2. The planted regression: a valid four-action reference under a budget of three.
    const bad = await benchCandidate(out, 'oracle-regressed.json', 'planted');
    const badXml = await readFile(bad.junit, 'utf8');
    assert.deepEqual(validateJunit(badXml), []);
    assert.equal(await chromiumParses(badXml), true);
    const badCases = testcases(parseXml(badXml));
    assert.equal(badCases.length, 6);
    for (const testcase of badCases) {
      const [failure, ...rest] = childElements(testcase);
      assert.equal(rest.length, 0);
      assert.equal(failure?.name, 'failure', testcase.attributes.get('name'));
      // The error class and the unmet condition, with the action after which it was last lost.
      assert.equal(failure!.attributes.get('type'), 'extra-arrow');
      assert.match(failure!.attributes.get('message')!, /^Not met: The drawing has exactly 2 arrows\. \(last lost after #3, connect\(from: “Draft”, to: “Send”\)\) Error class extra-arrow: /);
    }
    const failed = practonaut('compare', join(FIXTURE, 'baseline.json'), join(bad.folder, 'report.json'), '--fail-on-regression', '--html', join(out, 'compare-planted.html'));
    assert.equal(failed.status, 2, failed.stdout);
    assert.match(failed.stderr, /2 instance regressions .*review-and-send seed 1, review-and-send seed 2 \[instance_regression\]/);
    // The page is written before the gate fails, so CI can upload it.
    assert.match(await readFile(join(out, 'compare-planted.html'), 'utf8'), /<!doctype html>/);
  } finally {
    await browser.close();
    await rm(out, { recursive: true, force: true });
  }
});
