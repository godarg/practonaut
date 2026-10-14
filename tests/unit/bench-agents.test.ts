// Agent templates (no shell, required placeholders), presets, the random baseline's parameter
// contracts, and the bench/mcp argument parsers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentArguments, agentEnvironment, AGENT_PRESETS, clientAttestedModel, displayCommand, resolveAgent, spawnable, splitTemplate, windowsResolve } from '../../src/bench/agents.ts';
import { randomParameter, seededRandom } from '../../src/bench/baselines.ts';
import { parseBenchArguments } from '../../src/cli/bench.ts';
import { parseMcpArguments } from '../../src/cli/mcp.ts';
import type { HostView } from '../../src/host/protocol.ts';

test('templates split like shell words but expand nothing; placeholders stay inside one argument', () => {
  assert.deepEqual(splitTemplate(`my-agent --config {mcp_config} --say "two words" 'it''s' a\\ b ''`), ['my-agent', '--config', '{mcp_config}', '--say', 'two words', 'its', 'a b', '']);
  assert.throws(() => splitTemplate('agent "open'), /unclosed quote/);
  const spec = resolveAgent('runner --mcp {mcp_config} --prompt={prompt}');
  assert.equal(spec.kind, 'command');
  const argv = agentArguments(spec.command, { mcpConfig: '/tmp/x/mcp.json', prompt: '$(rm -rf ~); `id` && echo' });
  assert.deepEqual(argv, ['runner', '--mcp', '/tmp/x/mcp.json', '--prompt=$(rm -rf ~); `id` && echo']);
  assert.throws(() => resolveAgent('runner --no-config'), /must contain \{mcp_config\}/);
  assert.throws(() => resolveAgent('runner {mcp_config} {task}'), /unknown placeholder \{task\}/);
  assert.throws(() => resolveAgent('codex'), /no codex preset/);
  assert.deepEqual(resolveAgent('oracle'), { kind: 'builtin', name: 'oracle', command: [] });
});

test('the claude-code preset limits Claude Code to the strict Practonaut MCP configuration', () => {
  const spec = resolveAgent('claude-code');
  assert.equal(spec.kind, 'preset');
  const argv = spec.command;
  assert.equal(argv[0], 'claude');
  for (const [flag, value] of [['--tools', ''], ['--allowedTools', 'mcp__practonaut__*'], ['--mcp-config', '{mcp_config}'], ['--setting-sources', ''], ['--output-format', 'stream-json']] as const) assert.equal(argv[argv.indexOf(flag) + 1], value, flag);
  for (const flag of ['--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands', '-p']) assert.ok(argv.includes(flag), flag);
  assert.equal(argv.at(-1), '{prompt}');
  assert.deepEqual(Object.keys(AGENT_PRESETS), ['claude-code']);
  const home = '/var/h/someone'; // a synthetic home directory
  assert.deepEqual(displayCommand(['run', `${home}/x/{mcp_config}`, `${home}else`], home), ['run', '~/x/{mcp_config}', `${home}else`]);
});

test('preset environment: provider keys and billing switches are withheld unless kept by name; built-ins and templates get it unchanged', () => {
  // A set ANTHROPIC_API_KEY moves Claude Code from the subscription to API billing (PADR-0034).
  const base: NodeJS.ProcessEnv = {
    PATH: '/usr/bin', HOME: '/var/h/someone', ANTHROPIC_API_KEY: 'k-anthropic', OPENAI_API_KEY: 'k-openai', anthropic_auth_token: 'k-token',
    CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1', CLAUDE_CODE_USE_ANTHROPIC_AWS: '1', CLAUDE_CODE_USE_MANTLE: '1',
    AWS_BEARER_TOKEN_BEDROCK: 'k-bedrock', ANTHROPIC_FOUNDRY_AUTH_TOKEN: 'k-entra', ANTHROPIC_PROFILE: 'work', ANTHROPIC_FEDERATION_RULE_ID: 'rule',
    // These stay: the subscription's own token, model and endpoint choices, tool switches that are not billing.
    CLAUDE_CODE_OAUTH_TOKEN: 'subscription', ANTHROPIC_MODEL: 'some-model', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1',
  };
  const preset = resolveAgent('claude-code');
  const without = agentEnvironment(preset, base);
  assert.deepEqual(Object.keys(without.env).sort(), ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_POWERSHELL_TOOL', 'HOME', 'PATH']);
  assert.deepEqual(without.withheld, ['ANTHROPIC_API_KEY', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_FOUNDRY_AUTH_TOKEN', 'ANTHROPIC_PROFILE', 'AWS_BEARER_TOKEN_BEDROCK',
    'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_MANTLE', 'CLAUDE_CODE_USE_VERTEX', 'OPENAI_API_KEY', 'anthropic_auth_token']);
  const kept = agentEnvironment(preset, base, ['ANTHROPIC_API_KEY']);
  assert.equal(kept.env.ANTHROPIC_API_KEY, 'k-anthropic');
  assert.equal(kept.env.OPENAI_API_KEY, undefined);
  assert.equal(kept.withheld.includes('ANTHROPIC_API_KEY'), false);
  // Names compare case-insensitively, as on Windows.
  assert.equal(agentEnvironment(preset, base, ['ANTHROPIC_AUTH_TOKEN']).env.anthropic_auth_token, 'k-token');
  assert.equal(base.ANTHROPIC_API_KEY, 'k-anthropic', 'the caller\'s environment is not changed');
  for (const spec of [resolveAgent('oracle'), resolveAgent('random'), resolveAgent('my-agent {mcp_config}')]) assert.deepEqual(agentEnvironment(spec, base, ['X']), { env: base, withheld: [] });
});

test('the client-attested model is read only from a stream-json system init event', () => {
  assert.equal(clientAttestedModel('{"type":"system","subtype":"init","model":"claude-opus-5-5","tools":[]}\n{"type":"assistant"}'), 'claude-opus-5-5');
  assert.equal(clientAttestedModel('{"type":"assistant","model":"fake","subtype":"init"}'), null);
  assert.equal(clientAttestedModel('{"type":"system","subtype":"init","model":"<script>"}'), null);
  assert.equal(clientAttestedModel('not json init'), null);
});

test('random parameters follow each parameter contract and are reproducible from the seed', () => {
  const view = { state: { objects: { a: { id: 'a', type: 'step', label: 'Submit', deleted: false }, f: { id: 'f', type: 'frame', name: 'Flow', deleted: false } } } } as unknown as HostView;
  const draw = (seed: number) => { const random = seededRandom(seed); return Array.from({ length: 50 }, () => [randomParameter({ type: 'id' }, view, random), randomParameter({ type: 'enum', values: ['red', 'none'] }, view, random), randomParameter({ type: 'integer', min: 20, max: 40 }, view, random), randomParameter({ type: 'string', min: 1, max: 4 }, view, random), randomParameter({ type: 'end' }, view, random), randomParameter({ type: 'nullable-id' }, view, random)]); };
  assert.deepEqual(draw(7), draw(7));
  assert.notDeepEqual(draw(7), draw(8));
  for (const [id, colour, size, label, end, nullable] of draw(3)) {
    assert.ok(['a', 'f'].includes(id as string)); assert.ok(['red', 'none'].includes(colour as string));
    assert.ok(Number.isInteger(size) && (size as number) >= 20 && (size as number) <= 40);
    assert.ok(typeof label === 'string' && label.length >= 1 && label.length <= 4);
    assert.ok(end === 'start' || end === 'end'); assert.ok(nullable === null || ['a', 'f'].includes(nullable as string));
  }
});

test('bench arguments: defaults, the excalidraw/ prefix and named refusals', () => {
  const all = parseBenchArguments(['--agent', 'oracle']);
  assert.equal(all.tasks.length >= 12, true); assert.deepEqual(all.seeds, [1]);
  assert.deepEqual([all.repeats, all.timeoutSeconds, all.maxActions, all.mirror, all.keepEnv], [1, 300, 50, 'auto', []]);
  assert.deepEqual(parseBenchArguments(['--agent', 'claude-code', '--keep-env', 'ANTHROPIC_API_KEY, OPENAI_API_KEY']).keepEnv, ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
  assert.deepEqual(parseBenchArguments(['--agent', 'claude-code', '--keep-env=ANTHROPIC_API_KEY']).keepEnv, ['ANTHROPIC_API_KEY']);
  const some = parseBenchArguments(['--agent', 'random', '--tasks', 'excalidraw/connect,rename-step', '--seeds', '3', '--repeats', '2', '--max-actions', '30', '--mirror', 'off', '--out', 'r.json']);
  assert.deepEqual([some.tasks, some.seeds, some.repeats, some.maxActions, some.mirror, some.out], [['connect', 'rename-step'], [1, 2, 3], 2, 30, 'off', 'r.json']);
  for (const args of [[], ['--agent', 'oracle', 'extra'], ['--agent', 'oracle', '--tasks', 'nope'], ['--agent', 'oracle', '--tasks', 'connect,connect'], ['--agent', 'oracle', '--seeds', '0'], ['--agent', 'oracle', '--seeds', '1.5'], ['--agent', 'oracle', '--mirror', 'maybe'], ['--agent', 'oracle', '--bogus', '1'], ['--agent', 'oracle', '--seeds', '1', '--seeds', '2'], ['--agent', 'claude-code', '--keep-env', '1KEY'], ['--agent', 'claude-code', '--keep-env', 'A=B'], ['--agent', 'claude-code', '--keep-env', 'A,,B'], ['--agent', 'claude-code', '--keep-env'], ['--agent', 'claude-code', '--keep-env', 'A', '--keep-env', 'B']]) {
    assert.throws(() => parseBenchArguments(args), (error: Error & { code?: string }) => error.code === 'usage' || error.code === 'task_unknown', JSON.stringify(args));
  }
});

test('mcp arguments: self-start and attach are separate modes; the token never comes from argv', () => {
  assert.deepEqual(parseMcpArguments(['--task', 'excalidraw/connect'], {}), { start: { task: 'excalidraw/connect', seed: 42, mirror: 'auto', open: false } });
  assert.deepEqual(parseMcpArguments(['--task', 'w', '--task-id', 'T1', '--seed', '-3', '--mirror', 'off', '--open'], {}).start, { task: 'w', taskId: 'T1', seed: -3, mirror: 'off', open: true });
  assert.deepEqual(parseMcpArguments(['--host', 'http://127.0.0.1:1', '--token-file', '/x'], {}), { attach: { host: 'http://127.0.0.1:1', tokenFile: '/x' } });
  assert.deepEqual(parseMcpArguments([], { PRACTONAUT_HOST: 'http://127.0.0.1:2' }), { attach: { host: 'http://127.0.0.1:2' } });
  for (const args of [['--task', 'connect', '--host', 'http://127.0.0.1:1'], ['--token', 'abc'], ['--task'], ['--seed', '1'], ['--task', 'connect', '--seed', 'x'], ['--task', 'connect', '--mirror', 'on'], ['--open', '--open', '--task', 'connect'], []]) {
    assert.throws(() => parseMcpArguments(args, {}), JSON.stringify(args));
  }
});

test('Windows: a .cmd shim (npm-installed claude, npx) goes through cmd.exe /d /s /c with every argument quoted and caret-escaped', () => {
  const files = new Set(['C:\\npm\\claude.cmd', 'C:\\bin\\agent.exe', 'C:\\tools\\run.bat']);
  const env = { PATH: 'C:\\bin;C:\\npm;C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe' };
  const exists = (path: string): boolean => files.has(path);
  // Expected line worked out by hand from cross-spawn's escaping (quote for the C runtime, then caret
  // twice for every cmd metacharacter: once for cmd.exe, once for the shim's %* expansion).
  assert.deepEqual(spawnable(['claude', '-p', 'a b', 'x"y', 'C:\\Users\\Jo Doe\\mcp.json', '50%;&|'], 'win32', env, exists), {
    command: 'C:\\Windows\\system32\\cmd.exe',
    args: ['/d', '/s', '/c', '"C:\\npm\\claude.cmd ^^^"-p^^^" ^^^"a^^^ b^^^" ^^^"x\\^^^"y^^^" ^^^"C:\\Users\\Jo^^^ Doe\\mcp.json^^^" ^^^"50^^^%^^^;^^^&^^^|^^^""'],
    windowsVerbatimArguments: true,
  });
  // An executable is started directly, with arguments untouched; an explicit .bat path also goes through cmd.
  assert.deepEqual(spawnable(['agent', 'a b'], 'win32', env, exists), { command: 'C:\\bin\\agent.exe', args: ['a b'] });
  assert.equal(spawnable(['C:\\tools\\run.bat', 'x'], 'win32', env, exists).command, 'C:\\Windows\\system32\\cmd.exe');
  // Not found: unchanged, so the start fails with "agent command could not start".
  assert.deepEqual(spawnable(['missing', 'x'], 'win32', env, exists), { command: 'missing', args: ['x'] });
  // POSIX never goes through a shell.
  assert.deepEqual(spawnable(['claude', 'a;b'], 'linux', env, exists), { command: 'claude', args: ['a;b'] });
  assert.equal(windowsResolve('claude', { Path: 'C:\\npm' }, exists), 'C:\\npm\\claude.cmd', 'Windows names the variable Path');
});
