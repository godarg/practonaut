// Release guard: a published package must not point at the `OWNER` placeholder.
//   node tools/check-release-placeholders.ts [root]   exits 1 and lists every file and line that still
//   contains the placeholder (package.json, issue templates, root documents); docs/release.md, which
//   explains the replacement, and archived decision records are not checked.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.argv[2] ?? process.cwd();
const PLACEHOLDER = /\bOWNER\b/;
const files = ['package.json', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'SUPPORT.md', 'CHANGELOG.md'];
const templates = join(root, '.github', 'ISSUE_TEMPLATE');
try { for (const name of readdirSync(templates)) if (statSync(join(templates, name)).isFile()) files.push(join('.github', 'ISSUE_TEMPLATE', name)); } catch { /* no templates */ }
const found: string[] = [];
for (const file of files) {
  let text: string;
  try { text = readFileSync(join(root, file), 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, index) => { if (PLACEHOLDER.test(line)) found.push(`${relative(root, join(root, file)).split(sep).join('/')}:${index + 1}: ${line.trim()}`); });
}
if (found.length) {
  process.stderr.write(`release: the OWNER placeholder is still in ${found.length} line(s); replace it with the repository owner first (docs/release.md):\n${found.map(line => `  ${line}`).join('\n')}\n`);
  process.exitCode = 1;
} else process.stdout.write('release: no OWNER placeholder left\n');
