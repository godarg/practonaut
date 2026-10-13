import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { packWorldWithManifest } from '../../src/package/packer.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const main = join(root, 'src/cli/main.ts');
test('public pack and validate refuse draft, missing-schema and missing-rights worlds without replacing an output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pn-cli-admission-'));
  try {
    const valid = JSON.parse(await readFile(join(root, 'examples/worlds/flow-diagram/world.json'), 'utf8'));
    const noRights = structuredClone(valid); delete noRights.rights;
    const cases = [ { id: 'absent', value: { id: 'absent' } },
      { id: 'draft', value: { id: 'draft', schema: 'practonaut.world/0-draft' } },
      { id: 'rights', value: noRights } ];
    for (const item of cases) {
      const src = join(dir, item.id); await mkdir(join(src, 'assets'), { recursive: true });
      await writeFile(join(src, 'world.json'), JSON.stringify(item.value));
      // The archive primitive deliberately lets tests construct invalid semantic input.
      const { bytes } = await packWorldWithManifest(src);
      const archive = join(dir, `${item.id}.pnworld`); await writeFile(archive, bytes);
      const target = join(dir, `${item.id}-output.pnworld`);
      const marker = Buffer.from('existing output must survive rejection'); await writeFile(target, marker);
      for (const args of [['pack', src, '--out', target, '--json'], ['validate', archive, '--json']]) {
        const result = spawnSync(process.execPath, [main, ...args], { cwd: dir, encoding: 'utf8', timeout: 30_000 });
        assert.equal(result.status, 2, `${item.id}: ${args[0]}: ${result.stdout}${result.stderr}`);
        const reply = JSON.parse((result.stdout || result.stderr).trim());
        assert.equal(reply.ok, false); assert.equal(reply.error.code, 'E_WORLD_INVALID');
      }
      assert.deepEqual(await readFile(target), marker);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
