// Cross-checks the process-tree memory sampler: lists every process whose command line points into
// Playwright's browser cache and compares it with the descendants of this Node process.
//   node spikes/drawio/memcheck.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { processTreeRss, startDrawio } from './harness.ts';

const app = await startDrawio();
try {
  const tree = await processTreeRss();
  const { stdout } = await promisify(execFile)('ps', ['-A', '-o', 'pid=,ppid=,rss=,comm=']);
  const browserProcesses = stdout.trim().split('\n').filter(line => /ms-playwright|Chromium|chrome/i.test(line)).map(line => {
    const [pid, ppid, rss, ...rest] = line.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), rssBytes: Number(rss) * 1024, name: rest.join(' ').split('/').at(-1) };
  });
  const total = browserProcesses.reduce((s, p) => s + p.rssBytes, 0);
  process.stdout.write(JSON.stringify({ tree, browserProcessesByName: browserProcesses, browserProcessesTotalBytes: total, nodePid: process.pid }, null, 1) + '\n');
} finally { await app.close(); }
