import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertAssetsPresent, inventoryFiles } from '../../src/adapters/excalidraw/asset-integrity.ts';

const ASSETS = resolve('src/adapters/excalidraw/assets');

test('every font and notice named in LICENSES.json is present', async () => {
  const { files } = await assertAssetsPresent(ASSETS);
  for (const required of ['fonts/Cascadia/CascadiaCode-Regular.woff2', 'fonts/Cascadia/LICENSE', 'fonts/Excalifont/LICENSE', 'licenses/embedded-harfbuzzjs.txt']) assert.ok(files.includes(required), required);
  assert.equal(files.filter(file => file.startsWith('fonts/Excalifont/') && file.endsWith('.woff2')).length, 7);
});

test('asset check is presence only: changed bytes pass, a missing file fails', async () => {
  const copy = await mkdtemp(join(tmpdir(), 'pn-assets-'));
  try {
    await cp(ASSETS, copy, { recursive: true });
    const font = join(copy, 'fonts/Cascadia/CascadiaCode-Regular.woff2');
    await writeFile(font, Buffer.concat([await readFile(font), Buffer.from([0])]));
    await assertAssetsPresent(copy);
    await rm(join(copy, 'fonts/Excalifont/LICENSE'));
    await assert.rejects(assertAssetsPresent(copy), /Engine assets missing: fonts\/Excalifont\/LICENSE/);
  } finally { await rm(copy, { recursive: true, force: true }); }
});

test('inventory paths must stay inside the asset root', async () => {
  const copy = await mkdtemp(join(tmpdir(), 'pn-assets-'));
  try {
    const inventory = JSON.parse(await readFile(join(ASSETS, 'LICENSES.json'), 'utf8'));
    inventory.embeddedComponents[0].licenseText = '../outside.txt';
    await writeFile(join(copy, 'LICENSES.json'), JSON.stringify(inventory));
    assert.ok(inventoryFiles(inventory).includes('../outside.txt'));
    await assert.rejects(assertAssetsPresent(copy), /Unsafe asset path/);
  } finally { await rm(copy, { recursive: true, force: true }); }
});
