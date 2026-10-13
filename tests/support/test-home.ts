// Preloaded by every test command (`node --import ./tests/support/test-home.ts`). Each test process
// gets its own private, temporary PRACTONAUT_HOME, so no test reads or writes ~/.practonaut.
// Child processes started by a test inherit it through the environment.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(realpathSync(tmpdir()), 'pn-home-'));
process.env.PRACTONAUT_HOME = home;
process.on('exit', () => { rmSync(home, { recursive: true, force: true }); });
