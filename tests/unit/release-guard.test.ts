// The release workflow refuses to publish while package metadata or templates still name the
// `OWNER` placeholder. The guard is run as the workflow runs it, on prepared folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const guard = new URL('../../tools/check-release-placeholders.ts', import.meta.url).pathname;
const run = (root: string) => spawnSync(process.execPath, [guard, root], { encoding: 'utf8' });

test('release guard: OWNER in package.json or an issue template fails with every line named; a filled repository passes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pn-release-guard-'));
  try {
    await mkdir(join(dir, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
    await writeFile(join(dir, 'package.json'), '{\n  "homepage": "https://github.com/OWNER/practonaut#readme"\n}\n');
    await writeFile(join(dir, '.github', 'ISSUE_TEMPLATE', 'config.yml'), 'contact_links:\n  - url: https://github.com/OWNER/practonaut/discussions\n');
    await mkdir(join(dir, 'docs')); await writeFile(join(dir, 'docs', 'release.md'), 'Replace `OWNER` with the account.\n');
    const placeholder = run(dir);
    assert.equal(placeholder.status, 1);
    assert.match(placeholder.stderr, /OWNER placeholder is still in 2 line\(s\)/);
    assert.match(placeholder.stderr, /package\.json:2: "homepage"/); assert.match(placeholder.stderr, /\.github\/ISSUE_TEMPLATE\/config\.yml:2:/);
    assert.doesNotMatch(placeholder.stderr, /docs\/release\.md:\d/, 'the release guide may explain the placeholder');
    await writeFile(join(dir, 'package.json'), '{\n  "homepage": "https://github.com/example/practonaut#readme"\n}\n');
    await writeFile(join(dir, '.github', 'ISSUE_TEMPLATE', 'config.yml'), 'contact_links:\n  - url: https://github.com/example/practonaut/discussions\n');
    const filled = run(dir); assert.equal(filled.status, 0, filled.stderr);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the release workflow runs the guard in its prepare job, before anything is built or published', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  const prepare = workflow.slice(workflow.indexOf('  prepare:'), workflow.indexOf('  publish:'));
  assert.ok(prepare.includes('node tools/check-release-placeholders.ts'));
  assert.ok(prepare.indexOf('check-release-placeholders') < prepare.indexOf('npm pack'));
});
