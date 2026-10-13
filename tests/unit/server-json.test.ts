// The MCP Registry entry is checked offline against the pinned schema and against package.json.
// Every negative case changes one field of the real server.json and must be refused by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_FILE, loadSchema, serverJsonProblems } from '../../tools/check-server-json.ts';

// `any`: the negative variants mutate arbitrary nested fields of the parsed JSON on purpose.
const server = JSON.parse(await readFile('server.json', 'utf8')) as Record<string, any>;
const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { name: string; version: string; mcpName: string };
const variant = (change: (copy: Record<string, any>) => void): Record<string, any> => { const copy = structuredClone(server); change(copy); return copy; };

test('the repository server.json is a valid registry entry for this package', () => {
  assert.deepEqual(serverJsonProblems(server, pkg), []);
  assert.equal(pkg.mcpName, 'io.github.godarg/practonaut', 'package.json carries the registry name (ownership proof on npm)');
  assert.deepEqual(server.packages[0].packageArguments.map((argument: { value: string }) => argument.value), ['mcp', '--task', 'excalidraw/connect']);
});

test('schema violations are refused', () => {
  const cases: Array<[string, (copy: Record<string, any>) => void, RegExp]> = [
    ['name without namespace', copy => { copy.name = 'practonaut'; copy.packages[0].identifier = 'practonaut'; }, /schema: \/name must match pattern/],
    ['description over 100 characters', copy => { copy.description = 'x'.repeat(101); }, /schema: \/description must NOT have more than 100 characters/],
    ['missing description', copy => { delete copy.description; }, /schema: \/ must have required property 'description'/],
    ['package version "latest"', copy => { copy.packages[0].version = 'latest'; }, /schema: \/packages\/0\/version must NOT be valid/],
    ['missing transport', copy => { delete copy.packages[0].transport; }, /schema: \/packages\/0 must have required property 'transport'/],
    ['unknown transport', copy => { copy.packages[0].transport = { type: 'tcp' }; }, /schema: \/packages\/0\/transport/],
    ['positional argument without value or hint', copy => { copy.packages[0].packageArguments[0] = { type: 'positional' }; }, /schema: \/packages\/0\/packageArguments\/0/],
    ['repository URL that is not a URI', copy => { copy.repository.url = 'github.com/godarg/practonaut'; }, /schema: \/repository\/url must match format "uri"/],
  ];
  for (const [label, change, expected] of cases) {
    const problems = serverJsonProblems(variant(change), pkg);
    assert.ok(problems.some(problem => expected.test(problem)), `${label}: ${problems.join(' | ') || 'accepted'}`);
  }
});

test('disagreement with package.json is refused', () => {
  const cases: Array<[string, Record<string, any>, typeof pkg, RegExp]> = [
    ['other name than mcpName', server, { ...pkg, mcpName: 'io.github.someone/else' }, /must equal package.json mcpName/],
    ['no mcpName', server, { name: pkg.name, version: pkg.version } as typeof pkg, /must equal package.json mcpName/],
    ['server version behind', variant(copy => { copy.version = '0.0.9'; }), pkg, /^version "0.0.9" must equal package.json version/],
    ['npm version behind', variant(copy => { copy.packages[0].version = '0.0.9'; }), pkg, /npm package version "0.0.9"/],
    ['other npm identifier', variant(copy => { copy.packages[0].identifier = 'practonaut-fork'; }), pkg, /npm identifier "practonaut-fork"/],
    ['mirror registry', variant(copy => { copy.packages[0].registryBaseUrl = 'https://registry.example.org'; }), pkg, /registryBaseUrl must be https:\/\/registry.npmjs.org/],
    ['other schema URL', variant(copy => { copy.$schema = 'https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json'; }), pkg, /\$schema must be/],
    ['no npm entry', variant(copy => { copy.packages = []; }), pkg, /exactly one npm package entry expected, found 0/],
  ];
  for (const [label, candidate, packageJson, expected] of cases) {
    const problems = serverJsonProblems(candidate, packageJson);
    assert.ok(problems.some(problem => expected.test(problem)), `${label}: ${problems.join(' | ') || 'accepted'}`);
  }
});

test('a changed copy of the pinned schema is refused before it is used', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pn-registry-schema-'));
  try {
    const copy = join(directory, 'server.schema.json');
    await writeFile(copy, (await readFile(SCHEMA_FILE, 'utf8')).replace('"maxLength": 100', '"maxLength": 1000'));
    assert.throws(() => loadSchema(copy), /sha256/);
    assert.doesNotThrow(() => loadSchema());
  } finally { await rm(directory, { recursive: true, force: true }); }
});
