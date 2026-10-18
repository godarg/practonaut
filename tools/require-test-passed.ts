// Fails unless a TAP report from `node --test --test-reporter=tap` shows exactly one top-level test
// whose name starts with the given prefix as passed (not skipped, not todo) and no failed test.
// A name pattern that matches nothing still exits 0 in Node's runner; this makes that a failure
// (`.github/workflows/native-open-repeat.yml`, issue #45).
//
//   node tools/require-test-passed.ts <report.tap> <name prefix>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Null when satisfied, otherwise the reason. Only top-level (unindented) result lines count. */
export function requireTestPassed(tap: string, prefix: string): string | null {
  const results = tap.replace(/\r\n/g, '\n').split('\n').flatMap(line => {
    const match = /^(not ok|ok) \d+ - (.*)$/.exec(line);
    if (!match) return [];
    const directive = /\s#\s*(SKIP|TODO)\b/i.exec(match[2]!);
    return [{ ok: match[1] === 'ok', name: (directive ? match[2]!.slice(0, directive.index) : match[2]!).trim(), directive: directive?.[1]?.toUpperCase() ?? null }];
  });
  const failed = results.filter(result => !result.ok);
  if (failed.length) return `failed: ${failed.map(result => result.name).join('; ')}`;
  const named = results.filter(result => result.name.startsWith(prefix));
  if (named.length !== 1) return `expected exactly one test named "${prefix}…", found ${named.length}`;
  if (named[0]!.directive) return `"${named[0]!.name}" was reported as ${named[0]!.directive}, not run`;
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, prefix] = process.argv.slice(2);
  if (!file || !prefix) { console.error('usage: node tools/require-test-passed.ts <report.tap> <name prefix>'); process.exit(2); }
  const reason = requireTestPassed(readFileSync(file, 'utf8'), prefix);
  if (reason) { console.error(`require-test-passed: ${reason}`); process.exit(1); }
  console.log(`require-test-passed: "${prefix}…" passed`);
}
