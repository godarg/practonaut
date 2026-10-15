// A minimal agent for `practonaut bench`, without a language model: the plumbing every command
// template needs. bench starts it like this (each file named by its absolute path):
//
//   practonaut bench --agent "node /abs/path/minimal-agent.mjs {mcp_config} /abs/path/plan.json" …
//
// The agent's working directory is the run folder's empty `agent/` subfolder, so a relative path
// does not resolve there. What this script prints on stderr is kept as <run folder>/agent.stderr; a
// script that cannot start ends the run as infra_error ("without a single tool call"), and only that
// file says why.
//
// It reads the generated MCP configuration, starts the server it names (mcpServers.practonaut:
// command, args, env) over stdio, calls observe, plays each action of the plan with act — baseStep
// and expectedRevision always from the latest reply — and ends with check_result. A real agent
// chooses each action from what observe and act return; here the plan stands in for that choice.
//
// plan.json: {"steps": [{"name": "connect", "params": {"from": "a", "to": "b"}}, …]}. The oracle.json
// that `practonaut tasks from-scenes` writes has this shape; a parameter {"created": k} is the id the
// k-th action created. With --mistake the last action is left out, so the goal is not met.
//
// Needs the MCP SDK beside this file: npm install @modelcontextprotocol/client@2.3.1
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const [configPath, planPath, mode] = process.argv.slice(2);
if (!configPath || !planPath) {
  console.error('usage: minimal-agent.mjs <mcp_config> <plan.json> [--mistake]');
  process.exit(2);
}
const server = JSON.parse(readFileSync(configPath, 'utf8')).mcpServers.practonaut;
const plan = JSON.parse(readFileSync(planPath, 'utf8')).steps;
const steps = mode === '--mistake' ? plan.slice(0, -1) : plan;

const client = new Client({ name: 'minimal-agent', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: server.command, args: server.args, env: server.env }));

/** One Practonaut tool call. Every reply is JSON text: {"ok": true, "value": …} or {"ok": false, "error": {"code": …}}. */
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  return JSON.parse(result.content.find(part => part.type === 'text').text);
}

const observed = await call('observe', {});
if (!observed.ok) throw new Error(`observe refused: ${observed.error.code}`);
let { step, revision } = observed.value;
const created = [];
for (const action of steps) {
  const params = Object.fromEntries(Object.entries(action.params).map(([key, value]) =>
    [key, value !== null && typeof value === 'object' ? created[value.created] : value]));
  const reply = await call('act', { name: action.name, params, baseStep: step, expectedRevision: revision });
  if (!reply.ok) { console.error(`act ${action.name} refused: ${reply.error.code}`); break; }
  ({ step, revision } = reply.value);
  created.push(reply.value.created[0]);
}
const check = await call('check_result', { expectedRevision: revision });
console.log(check.ok ? `check_result: ${check.value.passed ? 'passed' : 'not passed'}` : `check_result refused: ${check.error.code}`);
await client.close();
