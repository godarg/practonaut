import { cliText } from './messages.ts';
import { createBridge, McpConfigurationError } from "../mcp/bridge.ts";
import { startMcpStdio } from "../mcp/server.ts";
import { toolSchemasFor, type McpBridgeConfig } from "../mcp/contracts.ts";
import { fallbackNotice, resolveMirror, resolvePracticeSource, startHostWithMirror, type MirrorChoice } from './serve.ts';
import { openInBrowser, writePreferredLauncher } from './open-browser.ts';
import { RuntimeError } from './runtime.ts';
import { safeText } from './output.ts';
import { startHost } from '../host/server.ts';
import { HOST_LIMITS } from '../host/limits.ts';
import { resolvedDataPaths } from '../platform/paths.ts';
import type { RunningHost } from '../host/protocol.ts';
import { inlineOptionValues } from './options.ts';

/** Self-start: `--task` (with optional `--task-id`, `--seed`, `--mirror`, `--open`). Attach: `--host` + `--token-file`. */
export interface McpArguments {
  attach?: { host?: string; tokenFile?: string };
  start?: { task: string; taskId?: string; seed: number; mirror: MirrorChoice; open: boolean };
}
const VALUED = ['--host', '--token-file', '--task', '--task-id', '--seed', '--mirror'];
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
  const attachFlags = '--host' in flags || '--token-file' in flags, startFlags = ['--task', '--task-id', '--seed', '--mirror'].some(key => key in flags) || open;
  if (attachFlags && startFlags) throw new McpConfigurationError('invalid_request');
  if (startFlags) {
    const task = flags['--task'];
    if (!task) throw new RuntimeError('usage', cliText('mcpUsage'));
    const seedText = flags['--seed'] ?? '42';
    if (!/^-?\d+$/.test(seedText) || !Number.isSafeInteger(Number(seedText))) throw new RuntimeError('usage', cliText('seedUsage'));
    const mirror = flags['--mirror'] ?? 'auto';
    if (mirror !== 'auto' && mirror !== 'required' && mirror !== 'off') throw new RuntimeError('usage', cliText('mirrorUsage'));
    return { start: { task, seed: Number(seedText), mirror, open, ...(flags['--task-id'] ? { taskId: flags['--task-id'] } : {}) } };
  }
  const host = flags['--host'] ?? env.PRACTONAUT_HOST, tokenFile = flags['--token-file'] ?? env.PRACTONAUT_TOKEN_FILE;
  if (!host) throw new RuntimeError('usage', cliText('mcpUsage'));
  return { attach: { host, ...(tokenFile === undefined ? {} : { tokenFile }) } };
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
      const started = await startHostWithMirror(parsed.start.mirror, await resolveMirror(parsed.start.mirror), mode => startHost(world, { seed, taskId, mirror: mode, tokenDirectory: paths.host, localDirectory: paths.home }));
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
    const handle = startMcpStdio(bridge, { onerror: () => { process.stderr.write(cliText("mcpInput")); }, schemas: toolSchemasFor(listed.ok ? listed.value : undefined) });
    let launcher: Awaited<ReturnType<typeof writePreferredLauncher>> | undefined;
    if (parsed.start?.open && host) {
      try {
        launcher = await writePreferredLauncher((await resolvedDataPaths()).host, host.url);
        setTimeout(() => { void launcher?.remove(); }, HOST_LIMITS.bootstrapTtlMs).unref();
        process.stderr.write(await openInBrowser(launcher.path) ? cliText('openStarted', { url: host.url }) : cliText('openFailed', { url: host.url }));
      } catch { process.stderr.write(cliText('openFailed', { url: host.url })); }
    }
    let stopped = false;
    const owned = host;
    const stop = (): void => {
      if (stopped) return; stopped = true;
      void (async () => {
        try { await handle.close(); await launcher?.remove(); await owned?.close(); }
        catch { process.exitCode = 3; }
      })();
    };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, stop);
    // When the client goes away the bridge stops; a self-started session's host and mirror close with it.
    process.stdin.once('end', stop); process.stdin.once('close', stop);
    return 0;
  } catch (error) {
    await host?.close().catch(() => {});
    if (error instanceof McpConfigurationError) process.stderr.write(cliText("mcpRefused", { code: error.code }));
    else if (error instanceof RuntimeError) throw error;
    else process.stderr.write(cliText("mcpStart"));
    return 3;
  }
}
