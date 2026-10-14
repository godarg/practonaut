// A stand-in `claude` for preset benches without a language model: started like Claude Code by the
// claude-code preset, it prints a stream-json init line naming the model in PN_FAKE_MODEL (and a
// result line), observes the task once through the MCP server the preset's --mcp-config names, and
// ends without changing anything. Every run it makes fails the task.
//   fakeClaude(dir) writes an executable `claude` into dir; put dir first on PATH.
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT = fileURLToPath(new URL('../../src/bench/mcp-client.ts', import.meta.url));

export async function fakeClaude(dir: string): Promise<void> {
  const script = join(dir, 'fake-claude.mjs');
  await writeFile(script, `import { readFileSync } from 'node:fs';
const { StdioMcpClient } = await import(${JSON.stringify(CLIENT)});
const at = process.argv.indexOf('--mcp-config');
const server = JSON.parse(readFileSync(process.argv[at + 1], 'utf8')).mcpServers.practonaut;
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', model: process.env.PN_FAKE_MODEL ?? null, apiKeySource: 'none' }) + '\\n');
const client = await StdioMcpClient.start(server, { cwd: process.cwd(), env: process.env });
await client.call('observe', {});
await client.close();
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }) + '\\n');
`);
  if (process.platform === 'win32') await writeFile(join(dir, 'claude.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
  else { await writeFile(join(dir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`); await chmod(join(dir, 'claude'), 0o755); }
}
