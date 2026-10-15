// A scripted external agent for bench tests, started from a command template like a real one.
//   node tests/support/bench-agent.ts <mode> <mcp-config>
// solve   : read the generated MCP config, start the server it names, draw the connect arrow.
// claim   : act on nothing and print a forged success line (output must never be scored).
// sleep   : never finish, never start the MCP server (an infra_error: no tool call at all).
// observe-sleep: start the MCP server, observe once, then never finish (timeout path).
// plant   : leave files named like the judged artifacts in PRACTONAUT_HOME and its parent, then solve.
// plant-dir: put a folder where the run's checker.json goes (PRACTONAUT_HOME/..), then solve.
// plant-log: put a folder where the run's mutation log goes, then solve.
// plant-board: put a folder where the run's board.svg goes (a mirror run's picture), then solve.
// stubborn: ignore SIGTERM and never finish; its pid goes to <state>/pids.json (forced-stop path).
// tasks   : write the task list of a full observe to <PN_TEST_AGENT_STATE>/tasks.json, then exit.
// family  : the first run (per PN_TEST_AGENT_STATE folder) claims and exits; later runs start a child
//           and both sleep; their pids go to <state>/pids.json (interrupt path).
// init    : print a stream-json system/init line (model pn-test-model, apiKeySource none), then solve.
// snoop   : look for the reference solution (PN_SNOOP_NEEDLE) everywhere it can reach: every file in the bench folder
//           (PRACTONAUT_HOME/../..) and every MCP reply; findings go to PRACTONAUT_HOME/snoop.json.
// crash   : draw the connect arrow, then exit with code 7 (an agent that fails after acting).
// script  : play the steps PN_TEST_AGENT_SCRIPT (a JSON file) names for the observed task:
//           { "<task id>": { "clients"?: [names], "print"?: [stdout lines], "steps": [step, …] } }
//           step: { "act": name, "params": {…}, "client"?: n } | { "undo": true } | { "reset": true }
//           | { "check": true } | { "sleep": true }; a param { "created": k } is the id the k-th act made.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { StdioMcpClient } from '../../src/bench/mcp-client.ts';
import type { HostView } from '../../src/host/protocol.ts';

const [mode, configPath] = process.argv.slice(2);
const text = readFileSync(configPath!, 'utf8');
// The configuration names a token file; a session token value must never appear in it.
if (/[0-9a-f]{64}/.test(text)) { process.stderr.write('token value in MCP config\n'); process.exit(9); }
const server = (JSON.parse(text) as { mcpServers: { practonaut: { command: string; args: string[]; env?: Record<string, string> } } }).mcpServers.practonaut;
if (mode === 'claim') { process.stdout.write('{"pass":true,"verdict":"passed","steps":1}\n'); process.exit(0); }
if (mode === 'family') {
  const state = process.env.PN_TEST_AGENT_STATE!, first = join(state, 'first');
  if (!existsSync(first)) { writeFileSync(first, ''); process.exit(0); }
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(join(state, 'pids.json'), JSON.stringify({ agent: process.pid, child: child.pid }));
  setInterval(() => {}, 1000);
}
else if (mode === 'sleep') { setInterval(() => {}, 1000); }
// Starts its MCP server (the bridge's start-up read reaches the host), observes once, then sleeps:
// a timeout of an agent that did work, not an infrastructure error (PADR-0040).
else if (mode === 'observe-sleep') {
  const client = await StdioMcpClient.start(server, { cwd: process.cwd(), env: process.env });
  await client.call('observe', {});
  setInterval(() => {}, 1000);
}
else if (mode === 'stubborn') {
  process.on('SIGTERM', () => {});
  writeFileSync(join(process.env.PN_TEST_AGENT_STATE!, 'pids.json'), JSON.stringify({ agent: process.pid }));
  setInterval(() => {}, 1000);
}
else if (mode === 'snoop') {
  // PN_SNOOP_NEEDLE: the reference solution's action sequence as JSON, given by the test. Compared
  // without whitespace, so any serialization of it (compact or indented) is found.
  const home = process.env.PRACTONAUT_HOME!, bench = join(home, '..', '..');
  const flat = (text: string): string => text.replace(/\s+/g, '');
  const needle = flat(process.env.PN_SNOOP_NEEDLE ?? '');
  if (needle.length < 20) { process.stderr.write('PN_SNOOP_NEEDLE missing\n'); process.exit(5); }
  const files = (readdirSync(bench, { recursive: true }) as string[]).map(String).filter(name => statSync(join(bench, name)).isFile());
  const hits = files.filter(name => flat(readFileSync(join(bench, name)).toString('utf8')).includes(needle));
  const client = await StdioMcpClient.start(server, { cwd: process.cwd(), env: process.env });
  const replies = [JSON.stringify(await client.call('observe', {})), JSON.stringify(await client.call('list_actions', {})), JSON.stringify(await client.call('explain_result', {})), JSON.stringify(await client.listTools())];
  await client.close();
  writeFileSync(join(home, 'snoop.json'), JSON.stringify({ files, hits, replyHits: replies.filter(text => flat(text).includes(needle)).length }));
  process.exit(0);
}
else if (mode === 'script') {
  type Step = { act?: string; params?: Record<string, unknown>; client?: number; undo?: true; reset?: true; check?: true; sleep?: true };
  const scripts = JSON.parse(readFileSync(process.env.PN_TEST_AGENT_SCRIPT!, 'utf8')) as Record<string, { clients?: string[]; print?: string[]; steps: Step[] }>;
  const clients = [await StdioMcpClient.start(server, { cwd: process.cwd(), env: process.env })];
  const first = await clients[0]!.call<{ task: { id: string }; step: number; revision: number }>('observe', {});
  if (!first.ok) process.exit(3);
  const script = scripts[first.value.task.id];
  if (!script) process.exit(5);
  for (const name of script.clients ?? []) clients.push(await StdioMcpClient.start(server, { cwd: process.cwd(), env: process.env, clientName: name }));
  for (const line of script.print ?? []) process.stdout.write(line + '\n');
  let position = { step: first.value.step, revision: first.value.revision };
  const created: string[] = [];
  const resync = async (): Promise<void> => { const seen = await clients[0]!.call<{ step: number; revision: number }>('observe', {}); if (seen.ok) position = { step: seen.value.step, revision: seen.value.revision }; };
  for (const step of script.steps) {
    if (step.sleep) await new Promise(() => {});
    const client = clients[step.client ?? 0]!;
    if (step.check) { await client.call('check_result', { expectedRevision: position.revision }); continue; }
    const reply = step.act
      ? await client.call<{ step: number; revision: number; created: string[] }>('act', { name: step.act, params: Object.fromEntries(Object.entries(step.params ?? {}).map(([key, value]) => [key, value !== null && typeof value === 'object' && 'created' in value ? created[(value as { created: number }).created] ?? 'missing' : value])), baseStep: position.step, expectedRevision: position.revision })
      : await client.call<{ step: number; revision: number; created: string[] }>(step.undo ? 'undo' : 'reset', { expectedRevision: position.revision, ...(step.reset ? { confirmed: true } : {}) });
    if (reply.ok) { position = { step: reply.value.step, revision: reply.value.revision }; if (step.act) created.push(reply.value.created[0] ?? ''); }
    else { if (step.act) created.push(''); await resync(); }
  }
  for (const client of clients) await client.close();
  process.exit(0);
}
else {
  const home = process.env.PRACTONAUT_HOME!;
  if (mode === 'init') process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', model: 'pn-test-model', apiKeySource: 'none', tools: [] }) + '\n');
  if (mode === 'plant') for (const directory of [home, join(home, '..')]) for (const name of ['session.json', 'checker.json', 'native.excalidraw']) writeFileSync(join(directory, name), '{"forged":true}');
  if (mode === 'plant-dir') mkdirSync(join(home, '..', 'checker.json'), { recursive: true });
  if (mode === 'plant-log') mkdirSync(join(home, '..', 'mutations.jsonl'), { recursive: true });
  if (mode === 'plant-board') mkdirSync(join(home, '..', 'board.svg'), { recursive: true });
  const client = await StdioMcpClient.start(server, { cwd: process.cwd(), env: process.env });
  if (mode === 'tasks') {
    const full = await client.call<HostView>('observe', { detail: 'full', lang: 'both' });
    writeFileSync(join(process.env.PN_TEST_AGENT_STATE!, 'tasks.json'), JSON.stringify(full.ok ? full.value.tasks : null));
    await client.close(); process.exit(0);
  }
  const observed = await client.call<Pick<HostView, 'step' | 'revision'>>('observe', {});
  if (!observed.ok) process.exit(3);
  const view = observed.value;
  const reply = await client.call('act', { name: 'connect', params: { from: 'a', to: 'b' }, baseStep: view.step, expectedRevision: view.revision });
  await client.close();
  process.exit(mode === 'crash' ? 7 : reply.ok ? 0 : 4);
}
