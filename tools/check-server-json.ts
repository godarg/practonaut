// MCP Registry entry: server.json must be valid against the pinned server.json schema and agree with
// package.json, without network access.
//   node tools/check-server-json.ts [root]   exits 1 and names every problem.
// The schema is vendored byte-for-byte from the URL in server.json's `$schema`
// (tools/vendor/mcp-registry/README.md); its sha256 is pinned here, so an edit to it is a failure,
// not a silently different check. server.json is not part of the npm package; `mcpName` is.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv, type ErrorObject } from 'ajv';

export const SCHEMA_URL = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
export const SCHEMA_FILE = fileURLToPath(new URL('./vendor/mcp-registry/server.schema.2025-12-11.json', import.meta.url));
export const SCHEMA_SHA256 = '3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0';
/** The official registry accepts npm packages only from this registry (official-registry-requirements.md). */
const NPM_REGISTRY = 'https://registry.npmjs.org';

interface PackageJson { name?: unknown; version?: unknown; mcpName?: unknown }
interface ServerPackage { registryType?: unknown; registryBaseUrl?: unknown; identifier?: unknown; version?: unknown; transport?: { type?: unknown } }
interface ServerJson { $schema?: unknown; name?: unknown; version?: unknown; packages?: ServerPackage[] }

/** The pinned schema, refused when its bytes are not the pinned ones. */
export function loadSchema(file: string = SCHEMA_FILE): object {
  const bytes = readFileSync(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== SCHEMA_SHA256) throw new Error(`pinned schema ${file} has sha256 ${sha256}, expected ${SCHEMA_SHA256}`);
  return JSON.parse(bytes.toString('utf8')) as object;
}

function describe(error: ErrorObject): string {
  return `${error.instancePath || '/'} ${error.message ?? 'is invalid'}${error.params && Object.keys(error.params).length ? ' ' + JSON.stringify(error.params) : ''}`;
}

/** Every problem with server.json against the schema and package.json; empty when it is consistent. */
export function serverJsonProblems(server: unknown, pkg: PackageJson, schema: object = loadSchema()): string[] {
  const ajv = new Ajv({ allErrors: true, strict: false });
  // The schema's only format; WHATWG URL parsing with an explicit scheme, as the registry requires.
  ajv.addFormat('uri', (value: string) => /^[a-z][a-z0-9+.-]*:/i.test(value) && URL.canParse(value));
  const validate = ajv.compile(schema);
  const problems = validate(server) ? [] : (validate.errors ?? []).map(error => `schema: ${describe(error)}`);
  const s = (server ?? {}) as ServerJson;
  if (s.$schema !== SCHEMA_URL) problems.push(`$schema must be ${SCHEMA_URL} (the pinned schema), not ${JSON.stringify(s.$schema)}`);
  if (typeof pkg.mcpName !== 'string' || s.name !== pkg.mcpName) problems.push(`name ${JSON.stringify(s.name)} must equal package.json mcpName ${JSON.stringify(pkg.mcpName)}`);
  if (s.version !== pkg.version) problems.push(`version ${JSON.stringify(s.version)} must equal package.json version ${JSON.stringify(pkg.version)}`);
  const npm = (Array.isArray(s.packages) ? s.packages : []).filter(entry => entry?.registryType === 'npm');
  if (npm.length !== 1) problems.push(`exactly one npm package entry expected, found ${npm.length}`);
  for (const entry of npm) {
    if (entry.identifier !== pkg.name) problems.push(`npm identifier ${JSON.stringify(entry.identifier)} must equal package.json name ${JSON.stringify(pkg.name)}`);
    if (entry.version !== pkg.version) problems.push(`npm package version ${JSON.stringify(entry.version)} must equal package.json version ${JSON.stringify(pkg.version)}`);
    if (entry.registryBaseUrl !== undefined && entry.registryBaseUrl !== NPM_REGISTRY) problems.push(`npm registryBaseUrl must be ${NPM_REGISTRY}`);
    if (entry.transport?.type !== 'stdio') problems.push('npm package transport must be stdio');
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? process.cwd();
  const read = (name: string): unknown => JSON.parse(readFileSync(join(root, name), 'utf8'));
  const problems = serverJsonProblems(read('server.json'), read('package.json') as PackageJson);
  if (problems.length) {
    process.stderr.write(`registry:check: server.json is not a valid MCP Registry entry for this package:\n${problems.map(problem => `  ${problem}`).join('\n')}\n`);
    process.exitCode = 1;
  } else process.stdout.write('registry:check: server.json is valid against the pinned schema and matches package.json\n');
}
