// Shared output never spells out the account name: a path in the home directory outside the cwd is
// shown from ~, on every platform (Windows: backslashes, and the cwd may sit on another drive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { displayPath } from '../../src/cli/output.ts';

test('a path in the home directory outside the cwd is shown from ~ with /', () => {
  const target = join(homedir(), 'pn-display-path-absent', 'nested', 'f.json');
  assert.equal(process.cwd().startsWith(join(homedir(), 'pn-display-path-absent')), false, 'precondition: the cwd is elsewhere');
  assert.equal(displayPath(target), '~/pn-display-path-absent/nested/f.json');
  assert.equal(displayPath(join('rel', 'm.pnworld')), 'rel/m.pnworld');
});
