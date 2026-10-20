import { cliText } from './messages.ts';
import { createBridge, McpConfigurationError } from "../mcp/bridge.ts";
import { startMcpStdio } from "../mcp/server.ts";
import { toolSchemasFor, type McpBridgeConfig } from "../mcp/contracts.ts";
import { checksOption, fallbackNotice, resolveMirror, resolvePracticeSource, startHostWithMirror, type MirrorChoice } from './serve.ts';
import { openInBrowser, writePreferredLauncher } from './open-browser.ts';
import { RuntimeError } from './runtime.ts';
import { WorldError } from '../world/preflight.ts';
import { safeText } from './output.ts';
import { startHost } from '../host/server.ts';
import { HOST_LIMITS } from '../host/limits.ts';
import { resolvedDataPaths } from '../platform/paths.ts';
import type { RunningHost } from '../host/protocol.ts';
import { inlineOptionValues } from './options.ts';
import { BrowserBudgetError } from '../adapters/browser/ledger.ts';
import { deferCommandEnd } from './browser-exit.ts';

/** Self-start: `--task` (with optional `--task-id`, `--seed`, `--mirror`, `--open`). Attach: `--host` + `--token-file`. */
export interface McpArguments {
  attach?: { host?: string; tokenFile?: string };
  start?: { task: string; taskId?: string; seed: number; mirror: MirrorChoice; open: boolean; checks?: number };
  /** `--call-log <file>`: one JSON line per tool call (tool, result code, result bytes, bridge time). */
  callLog?: string;
}
const VALUED = ['--host', '--token-file', '--task', '--task-id', '--seed', '--mirror', '--call-log', '--checks'];
export function parseMcpArguments(given: string[], env: NodeJS.ProcessEnv = process.env): McpArguments {
  const args = inlineOptionValues(given, VALUED);
  const flags: Record<string, string> = {}; let open = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (key === '--open') { if (open) throw new McpConfigurationError('invalid_request'); open = true; continue; }
    const value = args[++i];
    if (!VALUED.includes(key) || !value || value.startsWith('--') || Object.hasOwn(flags, key)) throw new McpConfigurationError('invalid_request');
    flags[key] = value;
  }
  const attachFlags = '--host' in flags || '--token-file' in flags, startFlags = ['--task', '--task-id', '--seed', '--mirror', '--checks'].some(key => key in flags) || open;
  if (attachFlags && startFlags) throw new McpConfigurationError('invalid_request');
  const callLog = flags['--call-log'] === undefined ? {} : { callLog: flags['--call-log'] };
  if (startFlags) {
    const task = flags['--task'];
    if (!task) throw new RuntimeError('usage', cliText('mcpUsage'));
    const seedText = flags['--seed'] ?? '42';
    if (!/^-?\d+$/.test(seedText) || !Number.isSafeInteger(Number(seedText))) throw new RuntimeError('usage', cliText('seedUsage'));
    const mirror = flags['--mirror'] ?? 'auto';
    if (mirror !== 'auto' && mirror !== 'required' && mirror !== 'off') throw new RuntimeError('usage', cliText('mirrorUsage'));
    const checks = flags['--checks'] === undefined ? {} : { checks: checksOption(flags['--checks']) };
    return { start: { task, seed: Number(seedText), mirror, open, ...(flags['--task-id'] ? { taskId: flags['--task-id'] } : {}), ...checks }, ...callLog };
  }
  const host = flags['--host'] ?? env.PRACTONAUT_HOST, tokenFile = flags['--token-file'] ?? env.PRACTONAUT_TOKEN_FILE;
  if (!host) throw new RuntimeError('usage', cliText('mcpUsage'));
  return { attach: { host, ...(tokenFile === undefined ? {} : { tokenFile }) }, ...callLog };
}

/** The end of an MCP session, once: the stdio server, the launcher, then the host, whose close removes
 * its token file. Each step is tried on its own, so one that fails (a launcher file that cannot be
 * removed) never skips the host's close. Only then has the command's shutdown finished, and `finish`
 * reports the browser ledger and arms the 35 s rule (PADR-0050, decision 9) — with `hostClosed` false
 * when the host's close failed: then it reports, says so, and arms nothing that could exit past it. */
export function mcpShutdown(steps: { handle: { close(): Promise<unknown> }; launcher: () => { remove(): Promise<unknown> } | undefined; host: Pick<RunningHost, 'close'> | undefined; finish: (hostClosed: boolean) => Promise<unknown> }): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  return () => stopping ??= (async () => {
    for (const step of [() => steps.handle.close(), () => steps.launcher()?.remove()]) { try { await step(); } catch { process.exitCode = 3; } }
    let hostClosed = true;
    try { await steps.host?.close(); } catch { process.exitCode = 3; hostClosed = false; }
    await steps.finish(hostClosed);
  })();
}

/** stdout is exclusively JSON-RPC. Credentials may be inherited, never supplied in argv. In
 * self-start mode the session is owned by this process: it ends when the client closes stdin. */
export async function commandMcp(args: string[]): Promise<number> {
  let host: RunningHost | undefined;
  try {
    const parsed = parseMcpArguments(args);
    let config: McpBridgeConfig;
    if (parsed.start) {
      const { world, taskId } = await resolvePracticeSource(parsed.start.task, parsed.start.taskId);
      const paths = await resolvedDataPaths(), seed = parsed.start.seed;
      const started = await startHostWithMirror(parsed.start.mirror, await resolveMirror(parsed.start.mirror), (mode, notice) => startHost(world, { seed, taskId, mirror: mode, tokenDirectory: paths.host, localDirectory: paths.home, ...(notice ? { modelOnly: notice } : {}), ...(parsed.start!.checks !== undefined ? { checks: parsed.start!.checks } : {}) }));
      host = started.host; const mirror = started.mirror;
      process.stderr.write(fallbackNotice(mirror));
      // The session credential stays in this process; the one-use watch link goes to stderr only.
      config = { host: host.origin, token: host.token };
      process.stderr.write(cliText('mcpReady', { task: safeText(taskId), world: safeText(world.id), seed: parsed.start.seed, mode: mirror.mode === 'required' ? 'real-engine' : cliText('modelOnly') }));
      process.stderr.write(cliText('mcpWatch', { url: host.url }));
    } else {
      const token = process.env.PRACTONAUT_SESSION_TOKEN;
      config = { host: parsed.attach!.host!, ...(parsed.attach!.tokenFile === undefined ? {} : { tokenFile: parsed.attach!.tokenFile }), ...(token === undefined ? {} : { token }) };
    }
    const bridge = await createBridge(config);
    // The act tool lists exactly the session world's actions; without a host reply the generic
    // vocabulary stays and the host still rejects anything its world does not define.
    const listed = await bridge.call("list_actions", {});
    const handle = startMcpStdio(bridge, { onerror: () => { process.stderr.write(cliText("mcpInput")); }, schemas: toolSchemasFor(listed.ok ? listed.value : undefined), ...(listed.ok ? { actions: listed.value } : {}), ...(parsed.callLog ? { callLog: parsed.callLog } : {}) });
    let launcher: Awaited<ReturnType<typeof writePreferredLauncher>> | undefined;
    if (parsed.start?.open && host) {
      try {
        launcher = await writePreferredLauncher((await resolvedDataPaths()).host, host.url);
        setTimeout(() => { void launcher?.remove(); }, HOST_LIMITS.bootstrapTtlMs).unref();
        process.stderr.write(await openInBrowser(launcher.path) ? cliText('openStarted', { url: host.url }) : cliText('openFailed', { url: host.url }));
      } catch { process.stderr.write(cliText('openFailed', { url: host.url })); }
    }
    const end = deferCommandEnd();
    const shutDown = mcpShutdown({ handle, launcher: () => launcher, host, finish: async hostClosed => {
      if (hostClosed) return end();
      process.stderr.write(cliText('closeFailed'));
      return end({ armExit: false });
    } });
    const stop = (): void => { void shutDown(); };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, stop);
    // When the client goes away the bridge stops; a self-started session's host and mirror close with it.
    process.stdin.once('end', stop); process.stdin.once('close', stop);
    return 0;
  } catch (error) {
    await host?.close().catch(() => {});
    if (error instanceof McpConfigurationError) process.stderr.write(cliText("mcpRefused", { code: error.code }));
    // A refused world (an application this Practonaut does not have, PADR-0045) keeps its named code
    // and exit 2, as with play and serve; stdout stays clean for JSON-RPC.
    else if (error instanceof RuntimeError || error instanceof WorldError || error instanceof BrowserBudgetError) throw error;
    else process.stderr.write(cliText("mcpStart"));
    return 3;
  }
}
