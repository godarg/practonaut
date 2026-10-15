/**
 * A minimal MCP stdio client for the built-in baselines. It starts the server named in a bench MCP
 * configuration exactly as an external agent would, so oracle and random take the same path:
 * MCP JSON-RPC → `practonaut mcp` bridge → host. Newline-delimited JSON-RPC 2.0 only.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { PACKAGE_VERSION } from '../version.ts';
import type { HostReply } from '../host/protocol.ts';

export interface McpServerEntry { command: string; args: string[]; env?: Record<string, string> }
/** One `tools/call` as this client saw it: the request id, the tool and the client round trip in
 * milliseconds (sent to answered), which the bridge cannot see (PADR-0039). */
export interface ClientCall { id: number; tool: string; ms: number }
export const MCP_CLIENT_PROTOCOL = '2025-11-25';
const REQUEST_MS = 60_000;

export class McpClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'McpClientError'; this.code = code; }
}

export class StdioMcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private next = 1;
  private exited = false;
  /** Every `tools/call` this client made, in order, with its round trip. */
  readonly calls: ClientCall[] = [];
  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let message: { id?: unknown; result?: unknown; error?: { message?: unknown } };
      try { message = JSON.parse(line) as typeof message; } catch { return; }
      if (typeof message.id !== 'number') return;
      const waiter = this.pending.get(message.id); if (!waiter) return;
      this.pending.delete(message.id); clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new McpClientError('mcp_error', String(message.error.message ?? 'MCP error')));
      else waiter.resolve(message.result);
    });
    child.stderr.resume();
    child.on('exit', () => { this.exited = true; for (const [, waiter] of this.pending) { clearTimeout(waiter.timer); waiter.reject(new McpClientError('mcp_closed', 'MCP server exited')); } this.pending.clear(); });
  }
  static async start(entry: McpServerEntry, options: { cwd: string; env: NodeJS.ProcessEnv; clientName?: string }): Promise<StdioMcpClient> {
    const child = spawn(entry.command, entry.args, { cwd: options.cwd, env: { ...options.env, ...(entry.env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
    const client = new StdioMcpClient(child);
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new McpClientError('mcp_spawn', 'MCP server could not start'))); });
    const init = await client.request('initialize', { protocolVersion: MCP_CLIENT_PROTOCOL, capabilities: {}, clientInfo: { name: options.clientName ?? 'practonaut-bench', version: PACKAGE_VERSION } }) as { protocolVersion?: unknown };
    if (typeof init?.protocolVersion !== 'string') throw new McpClientError('mcp_protocol', 'MCP server did not complete initialization');
    client.notify('notifications/initialized');
    return client;
  }
  private send(message: object): void {
    if (this.exited) throw new McpClientError('mcp_closed', 'MCP server exited');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  notify(method: string, params?: object): void { this.send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }); }
  request(method: string, params: object): Promise<unknown> { return this.dispatch(method, params).reply; }
  private dispatch(method: string, params: object): { id: number; reply: Promise<unknown> } {
    const id = this.next++;
    return { id, reply: this.reply(id, method, params) };
  }
  private reply(id: number, method: string, params: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new McpClientError('mcp_timeout', `MCP ${method} timed out`)); }, REQUEST_MS);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, params }); } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error as Error); }
    });
  }
  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const result = await this.request('tools/list', {}) as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
    return result.tools ?? [];
  }
  /** Calls one Practonaut tool and returns its JSON reply (`{ok, value}` or `{ok:false, error}`). */
  async call<T>(name: string, input: object): Promise<HostReply<T>> {
    const started = performance.now(), sent = this.dispatch('tools/call', { name, arguments: input });
    const result = await sent.reply as { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown };
    this.calls.push({ id: sent.id, tool: name, ms: Math.round((performance.now() - started) * 10) / 10 });
    if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent as HostReply<T>;
    const text = result.content?.find(part => part.type === 'text')?.text;
    if (typeof text !== 'string') throw new McpClientError('mcp_protocol', `tool ${name} returned no text`);
    return JSON.parse(text) as HostReply<T>;
  }
  async close(): Promise<void> {
    if (this.exited) return;
    const exited = new Promise<void>(resolve => this.child.once('exit', () => resolve()));
    this.child.stdin.end();
    const timer = setTimeout(() => { this.child.kill('SIGKILL'); }, 10_000);
    await exited; clearTimeout(timer);
  }
}
