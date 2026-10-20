// Git as a test sets it up: a configuration file of the test's own (an identity, `main` as the first
// branch of a new repository, no signing) and no system configuration, so a test never depends on the
// developer's or the CI runner's git setup — a runner has no identity and names a new repository's
// first branch `master`, a developer's machine may name it `main` in a system file. `isolateGit()` sets
// it for the test process and every child process it starts, and removes the file on exit.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function isolateGit(): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pn-gitconfig-')), file = join(dir, 'gitconfig');
  writeFileSync(file, '[user]\n\tname = Practonaut Test\n\temail = test@example.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n');
  process.env.GIT_CONFIG_GLOBAL = file;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.on('exit', () => { rmSync(dir, { recursive: true, force: true }); });
  return file;
}
