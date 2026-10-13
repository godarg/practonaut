import { readFile, lstat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

/** The committed font/notice inventory (src/adapters/excalidraw/assets/LICENSES.json). */
export interface AssetInventory {
  fonts: Array<{ file?: string; licenseText: string }>;
  embeddedComponents: Array<{ name: string; licenseText: string }>;
  nativePreviewFonts: { fonts: Array<{ path: string }>; notice: { path: string } };
  [key: string]: unknown;
}

/** Every local file the inventory names (fonts and license texts), relative to the asset root. */
export function inventoryFiles(inventory: AssetInventory): string[] {
  const files = new Set<string>();
  for (const font of inventory.fonts ?? []) { if (font.file) files.add(font.file); files.add(font.licenseText); }
  for (const component of inventory.embeddedComponents ?? []) files.add(component.licenseText);
  for (const font of inventory.nativePreviewFonts?.fonts ?? []) files.add(font.path);
  if (inventory.nativePreviewFonts?.notice?.path) files.add(inventory.nativePreviewFonts.notice.path);
  return [...files].sort();
}

/**
 * Presence check for the engine's local assets: every file named in LICENSES.json exists as a
 * regular file under `assetRoot`. Content is not pinned; changing a font or notice never breaks
 * the build, a missing one does.
 */
export async function assertAssetsPresent(assetRoot: string): Promise<{ inventory: AssetInventory; files: string[] }> {
  const inventory = JSON.parse(await readFile(resolve(assetRoot, 'LICENSES.json'), 'utf8')) as AssetInventory;
  const files = inventoryFiles(inventory);
  if (!files.length) throw new Error('LICENSES.json names no asset files');
  const missing: string[] = [];
  for (const file of files) {
    if (isAbsolute(file) || file.split('/').some(part => !part || part === '..' || part === '.')) throw new Error(`Unsafe asset path in LICENSES.json: ${file}`);
    try {
      if (!(await lstat(resolve(assetRoot, file))).isFile()) missing.push(file);
    } catch { missing.push(file); }
  }
  if (missing.length) throw new Error(`Engine assets missing: ${missing.join(', ')}`);
  return { inventory, files };
}
