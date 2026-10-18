/**
 * Where the downloaded draw.io release is kept and how it is read (PADR-0049 decision 2.6).
 *
 * `<PRACTONAUT_HOME>/apps/drawio/<version>/draw.war`. Every read opens the file without following a
 * link, refuses anything but a regular file and any size other than the pin's before reading, reads
 * it whole into one buffer and hashes that buffer. Callers serve only from the returned buffer, so
 * nothing on disk is read after the check and no handle stays open.
 */
import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { practonautHome } from '../../platform/paths.ts';
import { READ_NOFOLLOW } from '../../platform/private-fs.ts';
import { DRAWIO_PIN } from './pin.ts';

export interface DrawioPin { readonly version: string; readonly asset: string; readonly size: number; readonly sha256: string }
export type RuntimeCode = 'app_runtime_missing' | 'app_runtime_unverified';
export class DrawioRuntimeError extends Error {
  readonly code: RuntimeCode;
  constructor(code: RuntimeCode, message: string) { super(message); this.name = 'DrawioRuntimeError'; this.code = code; }
}

/** The version directory and the archive path under a Practonaut home. */
export function drawioRuntimeDirectory(home: string, pin: DrawioPin = DRAWIO_PIN): string { return join(home, 'apps', 'drawio', pin.version); }
export function drawioRuntimePath(home: string = practonautHome(), pin: DrawioPin = DRAWIO_PIN): string { return join(drawioRuntimeDirectory(home, pin), pin.asset); }

/** The whole kept archive, checked against the pin, or a named refusal. */
export async function readDrawioRuntime(path: string = drawioRuntimePath(), pin: DrawioPin = DRAWIO_PIN): Promise<Buffer> {
  // A link is refused on every platform; O_NOFOLLOW adds the same on POSIX at open time.
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined; throw error; });
  if (!info) throw new DrawioRuntimeError('app_runtime_missing', 'the draw.io runtime is not installed');
  if (info.isSymbolicLink() || !info.isFile()) throw new DrawioRuntimeError('app_runtime_unverified', 'the kept draw.io runtime is not a regular file');
  let handle;
  try { handle = await open(path, READ_NOFOLLOW); }
  catch { throw new DrawioRuntimeError('app_runtime_unverified', 'the kept draw.io runtime cannot be opened as a regular file'); }
  try {
    const st = await handle.stat();
    if (!st.isFile()) throw new DrawioRuntimeError('app_runtime_unverified', 'the kept draw.io runtime is not a regular file');
    // Refused before it is read: nothing larger than the pin is ever buffered.
    if (st.size !== pin.size) throw new DrawioRuntimeError('app_runtime_unverified', `the kept draw.io runtime has ${st.size} bytes, the pin ${pin.size}`);
    const buffer = Buffer.alloc(pin.size);
    let filled = 0;
    while (filled < pin.size) {
      const { bytesRead } = await handle.read(buffer, filled, pin.size - filled, filled);
      if (bytesRead === 0) throw new DrawioRuntimeError('app_runtime_unverified', 'the kept draw.io runtime ended early');
      filled += bytesRead;
    }
    const extra = await handle.read(Buffer.alloc(1), 0, 1, pin.size);
    if (extra.bytesRead !== 0) throw new DrawioRuntimeError('app_runtime_unverified', 'the kept draw.io runtime grew while it was read');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    if (sha256 !== pin.sha256) throw new DrawioRuntimeError('app_runtime_unverified', `the kept draw.io runtime has SHA-256 ${sha256}, the pin ${pin.sha256}`);
    return buffer;
  } finally { await handle.close(); }
}

/** For the CLI's check before Chromium: present and verified, or the named reason. */
export async function drawioRuntimeStatus(path: string = drawioRuntimePath(), pin: DrawioPin = DRAWIO_PIN): Promise<{ ok: true } | { ok: false; code: RuntimeCode; detail: string }> {
  try { await readDrawioRuntime(path, pin); return { ok: true }; }
  catch (error) { if (error instanceof DrawioRuntimeError) return { ok: false, code: error.code, detail: error.message }; throw error; }
}
