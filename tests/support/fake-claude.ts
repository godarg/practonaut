// A stand-in `claude` for preset benches without a language model: started like Claude Code by the
// claude-code preset, it prints a stream-json init line naming the model in PN_FAKE_MODEL (and
// Claude Code's version, PN_FAKE_VERSION or 2.1.0), and then acts as PN_FAKE_MODE says:
//   observe        (default) observe the task once through the MCP server the preset's --mcp-config
//                  names, print a success result, exit 0; the task fails
//   usage-limit    a rate_limit_event that is not allowed and an is_error result "usage limit
//                  reached", no tool call, exit 1 (as Claude Code does when a subscription limit is hit)
//   api-error      an is_error result "API Error: 529 … overloaded", no tool call, exit 1
//   max-turns      observe, then an error_max_turns result, exit 1 (the agent's own failure)
//   agent-error    observe, then an error_during_execution result, exit 1 (the agent's own failure)
//   too-long       observe, then an is_error result "API Error: 400 … prompt is too long", exit 1
//                  (the agent's own context overflow)
//   login-expired  an is_error result "OAuth token has expired", status 401, no tool call, exit 1
//   silent-crash   no output and no tool call, exit 1
// With PN_FAKE_STATE=<dir>, every start appends one line to <dir>/started.log (a start that never came
// leaves no line). With PN_FAKE_SOLVE=<file> (JSON { oracles: <dir>, tasks: { <model>: [<task id>, …] } }),
// after its observe the stand-in plays the reference of each listed task from <dir>/<task id>.json through
// act and calls check_result, so the task passes; the other tasks fail as before.
// With PN_FAKE_LIMIT_AFTER=<n> and PN_FAKE_STATE=<dir>, the first n starts observe and every later
// one hits the usage limit. With PN_FAKE_SLEEP_AFTER=<n> and PN_FAKE_STATE=<dir>, the first n starts
// observe and the next one observes and then never ends (its pid in <dir>/sleeper.pid): a bench to
// kill mid-run.
// Its init event lists the tools and MCP servers Claude Code offers the model, as Claude Code 2.1.299–2.1.301
// do for the preset (the seven mcp__practonaut__ tools, the one server practonaut); PN_FAKE_TOOLS (comma-separated)
// lists others instead, for example a shell tool.
//   fakeClaude(dir) writes an executable `claude` into dir; put dir first on PATH.
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// A file: URL, not a path: on Windows the ESM loader refuses an absolute path ("C:" is no URL
// scheme), the stand-in would end before its first tool call and every run would be an infra_error.
const CLIENT = new URL('../../src/bench/mcp-client.ts', import.meta.url).href;

export async function fakeClaude(dir: string): Promise<void> {
  const script = join(dir, 'fake-claude.mjs');
  await writeFile(script, `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = event => process.stdout.write(JSON.stringify(event) + '\\n');
if (process.env.PN_FAKE_STATE) appendFileSync(join(process.env.PN_FAKE_STATE, 'started.log'), (process.env.PN_FAKE_MODEL ?? '') + '\\n');
let mode = process.env.PN_FAKE_MODE ?? 'observe';
if (process.env.PN_FAKE_LIMIT_AFTER !== undefined && process.env.PN_FAKE_STATE) {
  const counter = join(process.env.PN_FAKE_STATE, 'starts');
  const starts = (existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0) + 1;
  writeFileSync(counter, String(starts));
  mode = starts > Number(process.env.PN_FAKE_LIMIT_AFTER) ? 'usage-limit' : 'observe';
}
let sleep = false;
if (process.env.PN_FAKE_SLEEP_AFTER !== undefined && process.env.PN_FAKE_STATE) {
  const counter = join(process.env.PN_FAKE_STATE, 'sleep-starts');
  const starts = (existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0) + 1;
  writeFileSync(counter, String(starts));
  if (starts > Number(process.env.PN_FAKE_SLEEP_AFTER)) { sleep = true; writeFileSync(join(process.env.PN_FAKE_STATE, 'sleeper.pid'), String(process.pid)); }
}
if (mode === 'silent-crash') process.exit(1);
const tools = process.env.PN_FAKE_TOOLS !== undefined ? process.env.PN_FAKE_TOOLS.split(',') : ['act', 'check_result', 'explain_result', 'list_actions', 'observe', 'reset', 'undo'].map(tool => 'mcp__practonaut__' + tool);
out({ type: 'system', subtype: 'init', tools, mcp_servers: [{ name: 'practonaut', status: 'connected' }], model: process.env.PN_FAKE_MODEL ?? null, apiKeySource: 'none', claude_code_version: process.env.PN_FAKE_VERSION ?? '2.1.0' });
if (mode === 'usage-limit') {
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } });
  out({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1760000000', num_turns: 1, total_cost_usd: 0 });
  process.exit(1);
}
if (mode === 'login-expired') {
  out({ type: 'result', subtype: 'success', is_error: true, result: 'OAuth token has expired. Please run /login', api_error_status: 401, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } });
  process.exit(1);
}
if (mode === 'api-error') {
  out({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', num_turns: 1, total_cost_usd: 0 });
  process.exit(1);
}
const { StdioMcpClient } = await import(${JSON.stringify(CLIENT)});
const at = process.argv.indexOf('--mcp-config');
const server = JSON.parse(readFileSync(process.argv[at + 1], 'utf8')).mcpServers.practonaut;
const client = await StdioMcpClient.start(server, { cwd: process.cwd(), env: process.env });
const view = await client.call('observe', {});
if (process.env.PN_FAKE_SOLVE && view.ok) {
  const solve = JSON.parse(readFileSync(process.env.PN_FAKE_SOLVE, 'utf8'));
  if ((solve.tasks[process.env.PN_FAKE_MODEL ?? ''] ?? []).includes(view.value.task.id)) {
    const oracle = JSON.parse(readFileSync(join(solve.oracles, view.value.task.id + '.json'), 'utf8'));
    let step = view.value.step, revision = view.value.revision; const created = [];
    for (const [index, action] of oracle.steps.entries()) {
      const params = {};
      for (const [key, value] of Object.entries(action.params)) params[key] = value !== null && typeof value === 'object' ? (created[value.created] ?? '') : value;
      const reply = await client.call('act', { name: action.name, params, baseStep: step, expectedRevision: revision });
      if (!reply.ok) break;
      step = reply.value.step; revision = reply.value.revision; created[index] = reply.value.created[0] ?? '';
    }
    await client.call('check_result', { expectedRevision: revision });
  }
}
if (sleep) await new Promise(() => {});
await client.close();
if (mode === 'max-turns') { out({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 30, total_cost_usd: 0 }); process.exit(1); }
if (mode === 'too-long') { out({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 210000 tokens > 200000 maximum"}}', num_turns: 9, total_cost_usd: 0 }); process.exit(1); }
if (mode === 'agent-error') { out({ type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 2, total_cost_usd: 0 }); process.exit(1); }
out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } });
`);
  if (process.platform === 'win32') await writeFile(join(dir, 'claude.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
  else { await writeFile(join(dir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`); await chmod(join(dir, 'claude'), 0o755); }
}
