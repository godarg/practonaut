import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('setup explicitly provisions Chromium and propagates installer failure at the process boundary', async () => {
  // Under `npx practonaut` the installed Playwright lives below a `_npx` cache folder.
  const dir = await mkdtemp(join(tmpdir(), '_npx-pn-setup-boundary-'));
  try {
    await mkdir(join(dir, 'node_modules/playwright-core'), { recursive: true });
    await cp(new URL('../../src/cli/setup.ts', import.meta.url), join(dir, 'setup.ts'));
    await cp(new URL('../../src/cli/messages.ts', import.meta.url), join(dir, 'messages.ts'));
    await cp(new URL('../../src/cli/invocation.ts', import.meta.url), join(dir, 'invocation.ts'));
    await cp(new URL('../../src/cli/output.ts', import.meta.url), join(dir, 'output.ts'));
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await writeFile(join(dir, 'node_modules/playwright-core/package.json'), '{"name":"playwright-core","type":"module","exports":{"./package.json":"./package.json"}}');
    await writeFile(join(dir, 'node_modules/playwright-core/cli.js'), `
      import assert from 'node:assert/strict';
      // Playwright's own check (isLikelyNpxGlobal): a CLI path containing _npx prints a warning box.
      if (process.argv[1].includes('_npx')) console.error('WARNING: It looks like you are running npx playwright install without first installing your project dependencies');
      assert.deepEqual(process.argv.slice(2), ['install', 'chromium', ...(process.argv.includes('--dry-run') ? ['--dry-run'] : [])]);
      console.log('installer-boundary:' + JSON.stringify(process.argv.slice(2)));
      process.exitCode = process.argv.includes('--dry-run') ? 0 : Number(process.env.PN_TEST_INSTALL_EXIT);
    `);
    await writeFile(join(dir, 'entry.ts'), "import {commandSetup} from './setup.ts'; process.exitCode=await commandSetup(process.argv.slice(2));");
    const run = (exit: number, args: string[] = []) => spawnSync(process.execPath, [join(dir, 'entry.ts'), ...args], {
      env: { ...process.env, PN_TEST_INSTALL_EXIT: String(exit) }, encoding: 'utf8', timeout: 10_000,
    });
    const green = run(0);
    assert.equal(green.status, 0, green.stderr);
    assert.match(green.stdout, /installer-boundary:\["install","chromium","--dry-run"\]/);
    assert.match(green.stdout, /installer-boundary:\["install","chromium"\]/);
    assert.doesNotMatch(green.stderr, /WARNING: It looks like you are running/, 'no Playwright npx warning box under npx practonaut');
    const failed = run(7);
    assert.equal(failed.status, 3, failed.stdout + failed.stderr);
    assert.doesNotMatch(failed.stdout, /provisioning completed/);
    const usage = run(0, ['--unexpected']);
    assert.equal(usage.status, 1);
    assert.doesNotMatch(usage.stdout, /installer-boundary/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
