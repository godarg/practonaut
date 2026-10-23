/**
 * One draw.io adapter start in a fresh process (PADR-0049 decision 3.6): prints the time from process
 * start to the end of the adapter's start (its first `load`, read back and checked), the peak RSS of
 * this Node process and of its Chromium process tree, the browser's version and what its processes
 * were started with (review m2c, runtime-1), as one JSON line.
 *   node --import ./tests/support/test-home.ts tests/support/drawio-start.ts
 */
import { createDrawioAdapter } from '../../src/adapters/drawio/index.ts';
import { stepV2 } from './world-v2.ts';
import { drawioTestRuntime } from './drawio.ts';
import { chromiumTreeRss, descendantCommands, observeSandbox } from './drawio-run.ts';

let chromium: string | null = null;
const adapter = await createDrawioAdapter({ objects: { a: stepV2('a', 'Receive', 100, 100), b: stepV2('b', 'Ship', 400, 100) } }, {}, { ready: browser => { chromium = browser.version(); } }, { runtimePath: drawioTestRuntime().runtimePath });
const firstLoadMs = performance.now();
const chromiumTree = chromiumTreeRss();
const sandbox = observeSandbox(null, descendantCommands());
const refused = adapter.networkAttempts();
await adapter.close();
process.stdout.write(JSON.stringify({ firstLoadMs, nodeRss: process.resourceUsage().maxRSS * 1024, chromiumTree, chromium, sandbox, refused }) + '\n');
