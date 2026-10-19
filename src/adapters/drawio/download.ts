/**
 * `practonaut setup --app drawio`: the opt-in download of the pinned draw.io release (PADR-0049
 * decision 2). Nothing here runs implicitly: only the setup command calls it.
 *
 * - Redirects are followed by hand, at most `redirects`, and a hop to a scheme outside
 *   `allowedSchemes` is refused before it is followed. The product allows exactly `https:`; the set is
 *   a named seam so tests can use a plain-HTTP stand-in on 127.0.0.1.
 * - Connecting and the response headers within `connectMs`, no stall longer than `stallMs`, the whole
 *   chain (redirects, body, retries) within `totalMs`. A network error, HTTP 429 or 5xx, a connect
 *   timeout or a stall is retried after each of `retryDelaysMs`; a size or hash mismatch never is.
 * - One setup at a time per version directory: a lock file that appears whole or not at all (written
 *   to a temp file, then hard-linked to its name, which fails when the name exists); one that cannot be
 *   read is judged by its own modification time; a release removes only this setup's own lock. The
 *   body streams into a partial file unique to this setup, through a SHA-256 and a byte counter. Only a complete file
 *   whose size and SHA-256 equal the pin is kept: flush and sync, rename over the target (retried on
 *   Windows while a reader holds it), sync the directory on POSIX, then read the target whole again and
 *   re-hash it before success is reported.
 */
import { createHash, randomBytes } from 'node:crypto';
import { link, lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ensurePrivateDirectory, EXCLUSIVE_CREATE, READ_NOFOLLOW, syncDirectory } from '../../platform/private-fs.ts';
import { DRAWIO_PIN } from './pin.ts';
import { drawioRuntimeDirectory, drawioRuntimeStatus, readDrawioRuntime, type DrawioPin } from './runtime.ts';

export interface InstallLimits { connectMs: number; stallMs: number; totalMs: number; redirects: number; retryDelaysMs: readonly number[]; renameRetries: number; renameDelayMs: number }
export const INSTALL_LIMITS: Readonly<InstallLimits> = Object.freeze({ connectMs: 30_000, stallMs: 30_000, totalMs: 600_000, redirects: 5, retryDelaysMs: Object.freeze([2_000, 8_000]), renameRetries: 10, renameDelayMs: 200 });
/** The product's only scheme. */
export const PRODUCT_SCHEMES: ReadonlySet<string> = Object.freeze(new Set(['https:'])) as ReadonlySet<string>;

export type InstallCode = 'app_download_failed' | 'app_download_mismatch' | 'app_install_busy';
/** Why a setup stopped, from a closed list, so a test can assert the reason by name. */
export type InstallReason = 'network' | 'http' | 'scheme' | 'redirects' | 'connect' | 'stall' | 'deadline' | 'size' | 'sha256' | 'busy' | 'not_file' | 'rename' | 'verify';
export class DrawioInstallError extends Error {
  readonly code: InstallCode; readonly reason: InstallReason; readonly details: Readonly<Record<string, string | number>>;
  constructor(code: InstallCode, reason: InstallReason, message: string, details: Record<string, string | number> = {}) {
    super(message); this.name = 'DrawioInstallError'; this.code = code; this.reason = reason; this.details = details;
  }
}
export interface InstallPin extends DrawioPin { readonly source: string }
export interface InstallOptions {
  home: string;
  /** Named seam: the URL schemes a download may use. The product passes `PRODUCT_SCHEMES`. */
  allowedSchemes: ReadonlySet<string>;
  pin?: InstallPin;
  limits?: Partial<InstallLimits>;
  /** Test seams: the network, the clock's waits, the clock the deadline is read from, the rename (to
   * simulate a held file), and a pause while this setup's lock is being written (to hold a second setup
   * in that window). */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  rename?: (from: string, to: string) => Promise<void>;
  lockPause?: () => Promise<void>;
}
export interface InstallResult { status: 'installed' | 'already'; path: string; bytes: number; sha256: string; replaced: boolean; attempts: number }

const LOCK = '.setup.lock';
const failed = (reason: InstallReason, message: string, details: Record<string, string | number> = {}): DrawioInstallError => new DrawioInstallError('app_download_failed', reason, message, details);
const retryable = (error: unknown): boolean => error instanceof DrawioInstallError && ['network', 'http', 'connect', 'stall'].includes(error.reason) && (error.reason !== 'http' || Number(error.details.status) === 429 || Number(error.details.status) >= 500);
/** The waits between attempts. The timer keeps Node alive: a setup waiting to retry may be the only
 * thing left running, and the wait must end in the retry or a named failure (review m2c, Codex 5). */
const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

interface HeldLock { pid?: unknown; started?: unknown; token?: unknown; ino: number; mtimeMs: number; readable: boolean }
/** The lock as it is now, or undefined when there is none: its content, if it parses, and its identity. */
async function readLock(path: string): Promise<HeldLock | undefined> {
  let handle;
  try { handle = await open(path, READ_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try {
    const info = await handle.stat(), text = await handle.readFile({ encoding: 'utf8' });
    try {
      const held = JSON.parse(text) as unknown;
      if (held !== null && typeof held === 'object' && !Array.isArray(held)) { const h = held as Record<string, unknown>; return { pid: h.pid, started: h.started, token: h.token, ino: info.ino, mtimeMs: info.mtimeMs, readable: true }; }
    } catch { /* unreadable: judged by the file's own modification time */ }
    return { ino: info.ino, mtimeMs: info.mtimeMs, readable: false };
  } finally { await handle.close(); }
}
const sameLock = (a: HeldLock, b: HeldLock): boolean => a.ino === b.ino && a.mtimeMs === b.mtimeMs && a.readable === b.readable && a.token === b.token;
/** The temp file of a setup that has not linked its lock yet. */
const LOCK_TEMP = /^\.setup\.lock\.[0-9]+\.[0-9a-f]{32}\.tmp$/;
const staleAfterMs = (limits: InstallLimits): number => limits.totalMs + 60_000;

/**
 * One setup per version directory (decision 2.3; review m2c, runtime-2). The lock holds this process id,
 * its start and a random token. It is written whole to a temp file first and then hard-linked to the
 * lock name, which fails when the name exists, so no other setup ever sees it half written. A held lock
 * stays held while it is younger than the whole chain may take and its process exists; one that cannot
 * be read (damaged, or left by an older version) is judged by its own modification time. A stale lock is
 * removed only when a second read still finds that same lock. The release removes the lock only while
 * it holds this setup's own token.
 */
async function takeLock(directory: string, limits: InstallLimits, pause?: () => Promise<void>): Promise<() => Promise<void>> {
  const path = join(directory, LOCK), token = randomBytes(16).toString('hex');
  const temp = join(directory, `${LOCK}.${process.pid}.${token}.tmp`);
  const out = await open(temp, EXCLUSIVE_CREATE, 0o600);
  try { await pause?.(); await out.writeFile(JSON.stringify({ pid: process.pid, started: Date.now(), token })); await out.sync(); } finally { await out.close(); }
  const busy = (held?: HeldLock): DrawioInstallError => new DrawioInstallError('app_install_busy', 'busy', 'another setup of this draw.io version is running', typeof held?.pid === 'number' ? { pid: held.pid } : {});
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await link(temp, path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const held = await readLock(path);
        if (held === undefined) continue;
        const started = held.readable && typeof held.started === 'number' ? held.started : held.mtimeMs;
        // Stale when older than the whole chain may take, or when its process is gone. Signal 0
        // delivers no signal; it only asks whether the process exists.
        let gone = false;
        if (held.readable && typeof held.pid === 'number' && Number.isSafeInteger(held.pid) && held.pid > 0 && held.pid !== process.pid) { try { process.kill(held.pid, 0); } catch (probe) { gone = (probe as NodeJS.ErrnoException).code === 'ESRCH'; } }
        if (Date.now() - started <= staleAfterMs(limits) && !gone) throw busy(held);
        const again = await readLock(path);
        if (again !== undefined && !sameLock(held, again)) throw busy(again);
        if (again !== undefined) await unlink(path).catch(() => undefined);
        continue;
      }
      return async () => { const now = await readLock(path).catch(() => undefined); if (now?.readable && now.token === token) await unlink(path).catch(() => undefined); };
    }
    throw busy();
  } finally { await unlink(temp).catch(() => undefined); }
}
/** Partial files of earlier setups, and lock temp files of setups that died: under the lock no partial
 * belongs to a running setup, and a running setup holds its temp file for a moment only. */
async function removeStalePartials(directory: string, pin: DrawioPin, limits: InstallLimits): Promise<void> {
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    if (name.startsWith(`.${pin.asset}.`) && name.endsWith('.partial')) await unlink(path).catch(() => undefined);
    else if (LOCK_TEMP.test(name)) { const info = await lstat(path).catch(() => undefined); if (info && Date.now() - info.mtimeMs > staleAfterMs(limits)) await unlink(path).catch(() => undefined); }
  }
}
async function renameOver(from: string, to: string, limits: InstallLimits, renameImpl: (from: string, to: string) => Promise<void>, sleep: (ms: number) => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await renameImpl(from, to); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // On Windows a reader that holds the file for the moment of its read makes the rename fail.
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '') || attempt >= limits.renameRetries) throw failed('rename', `the verified download could not replace the kept file (${code ?? 'error'})`);
      await sleep(limits.renameDelayMs);
    }
  }
}
/** Keeps a verified partial file: sync, rename over the target, sync the directory, read back. */
async function keep(partial: string, directory: string, pin: DrawioPin, limits: InstallLimits, options: InstallOptions): Promise<string> {
  const target = join(directory, pin.asset);
  await renameOver(partial, target, limits, options.rename ?? rename, options.sleep ?? defaultSleep);
  await syncDirectory(directory);
  try { await readDrawioRuntime(target, pin); }
  catch (error) { await unlink(target).catch(() => undefined); throw failed('verify', `the kept file does not verify after it was renamed: ${error instanceof Error ? error.message : 'error'}`); }
  return target;
}
async function prepare(options: InstallOptions): Promise<{ pin: InstallPin; limits: InstallLimits; directory: string; replaced: boolean; release: () => Promise<void> } | InstallResult> {
  const pin = options.pin ?? DRAWIO_PIN, limits = { ...INSTALL_LIMITS, ...options.limits };
  const directory = drawioRuntimeDirectory(options.home, pin);
  await ensurePrivateDirectory(directory);
  const release = await takeLock(directory, limits, options.lockPause);
  try {
    const status = await drawioRuntimeStatus(join(directory, pin.asset), pin);
    if (status.ok) { await release(); return { status: 'already', path: join(directory, pin.asset), bytes: pin.size, sha256: pin.sha256, replaced: false, attempts: 0 }; }
    await removeStalePartials(directory, pin, limits);
    return { pin, limits, directory, replaced: status.code === 'app_runtime_unverified', release };
  } catch (error) { await release(); throw error; }
}
const partialPath = (directory: string, pin: DrawioPin): string => join(directory, `.${pin.asset}.${process.pid}.${randomBytes(6).toString('hex')}.partial`);

/** Downloads the pinned release unless a verified copy is already kept. */
export async function installDrawio(options: InstallOptions): Promise<InstallResult> {
  const prepared = await prepare(options);
  if ('status' in prepared) return prepared;
  const { pin, limits, directory, replaced, release } = prepared;
  const fetchImpl = options.fetch ?? fetch, sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => performance.now());
  const deadlineAt = now() + limits.totalMs;
  const remaining = (): number => deadlineAt - now();
  let attempts = 0;
  try {
    for (;;) {
      attempts++;
      const partial = partialPath(directory, pin);
      try {
        await downloadOnce(pin, partial, limits, options.allowedSchemes, fetchImpl, remaining);
        const path = await keep(partial, directory, pin, limits, options);
        return { status: 'installed', path, bytes: pin.size, sha256: pin.sha256, replaced, attempts };
      } catch (error) {
        await unlink(partial).catch(() => undefined);
        const delay = limits.retryDelaysMs[attempts - 1];
        if (!retryable(error) || delay === undefined || remaining() <= delay) throw error;
        await sleep(delay);
        if (remaining() <= 0) throw failed('deadline', `the download did not finish within ${limits.totalMs} ms`);
      }
    }
  } finally { await release(); }
}

/** Verifies a `draw.war` fetched by other means and keeps it the same way. */
export async function installDrawioFrom(file: string, options: Omit<InstallOptions, 'allowedSchemes' | 'fetch'>): Promise<InstallResult> {
  const prepared = await prepare({ ...options, allowedSchemes: PRODUCT_SCHEMES });
  if ('status' in prepared) return prepared;
  const { pin, limits, directory, replaced, release } = prepared;
  const partial = partialPath(directory, pin);
  try {
    const info = await lstat(file).catch(() => undefined);
    if (!info || info.isSymbolicLink() || !info.isFile()) throw new DrawioInstallError('app_download_mismatch', 'not_file', 'the given file is not a regular file');
    // The file is hashed whatever its size, so a refusal prints both SHA-256 values (decision 2.5;
    // review m2c, runtime-3). A file of the pinned size is read whole and kept from memory; any other
    // is only streamed through the hash.
    const handle = await open(file, READ_NOFOLLOW), hash = createHash('sha256');
    let bytes: Buffer | undefined, length = 0;
    try {
      if (info.size === pin.size) { bytes = await handle.readFile(); hash.update(bytes); length = bytes.length; }
      else {
        const chunk = Buffer.alloc(1024 * 1024);
        for (let read; (read = (await handle.read(chunk, 0, chunk.length, null)).bytesRead) > 0;) { hash.update(chunk.subarray(0, read)); length += read; }
      }
    } finally { await handle.close(); }
    const sha256 = hash.digest('hex');
    if (bytes === undefined || length !== pin.size || sha256 !== pin.sha256) throw new DrawioInstallError('app_download_mismatch', length !== pin.size ? 'size' : 'sha256', length !== pin.size ? `the given file has ${length} bytes, the pin ${pin.size}` : 'the given file is not the pinned release', { expectedBytes: pin.size, actualBytes: length, expectedSha256: pin.sha256, actualSha256: sha256 });
    const out = await open(partial, EXCLUSIVE_CREATE, 0o600);
    try { await out.writeFile(bytes); await out.sync(); } finally { await out.close(); }
    const path = await keep(partial, directory, pin, limits, { ...options, allowedSchemes: PRODUCT_SCHEMES });
    return { status: 'installed', path, bytes: pin.size, sha256: pin.sha256, replaced, attempts: 1 };
  } catch (error) { await unlink(partial).catch(() => undefined); throw error; }
  finally { await release(); }
}

/** One attempt: redirects by hand, deadlines, the body through a hash and a counter into `partial`. */
async function downloadOnce(pin: InstallPin, partial: string, limits: InstallLimits, schemes: ReadonlySet<string>, fetchImpl: typeof fetch, remaining: () => number): Promise<void> {
  const controller = new AbortController();
  let current = new URL(pin.source), hops = 0, response: Response;
  for (;;) {
    if (!schemes.has(current.protocol)) throw failed('scheme', `a hop to ${current.protocol} is not allowed`, { scheme: current.protocol });
    if (remaining() <= 0) throw failed('deadline', `the download did not finish within ${limits.totalMs} ms`);
    // A timer cut short by the absolute deadline reports the deadline: a timer may fire a fraction of a
    // millisecond before the clock it was computed from says the time is up.
    const timeout = Math.min(limits.connectMs, Math.max(1, remaining())), byDeadline = timeout < limits.connectMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(byDeadline || remaining() <= 0 ? failed('deadline', `the download did not finish within ${limits.totalMs} ms`) : failed('connect', `no response headers within ${limits.connectMs} ms`)); }, timeout); });
    try { response = await Promise.race([fetchImpl(current, { redirect: 'manual', signal: controller.signal }), stopped]); }
    catch (error) { if (error instanceof DrawioInstallError) throw error; throw failed('network', `the request failed: ${error instanceof Error ? error.message.slice(0, 120) : 'error'}`); }
    finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw failed('http', 'a redirect without a location', { status: response.status });
      hops++;
      if (hops > limits.redirects) throw failed('redirects', `more than ${limits.redirects} redirects`, { redirects: hops });
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel().catch(() => undefined); throw failed('http', `HTTP ${response.status}`, { status: response.status }); }
    break;
  }
  const hash = createHash('sha256'), out = await open(partial, EXCLUSIVE_CREATE, 0o600);
  const reader = response.body!.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const wait = Math.min(limits.stallMs, Math.max(1, remaining())), byDeadline = wait < limits.stallMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(byDeadline || remaining() <= 0 ? failed('deadline', `the download did not finish within ${limits.totalMs} ms`) : failed('stall', `no data for ${limits.stallMs} ms`)), wait); });
      let part: ReadableStreamReadResult<Uint8Array>;
      try { part = await Promise.race([reader.read(), stalled]); }
      catch (error) { if (error instanceof DrawioInstallError) throw error; throw failed('network', 'the download broke off'); }
      finally { clearTimeout(timer); }
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > pin.size) throw new DrawioInstallError('app_download_mismatch', 'size', `more than the pinned ${pin.size} bytes`, { expectedBytes: pin.size, actualBytes: bytes, expectedSha256: pin.sha256 });
      hash.update(part.value);
      await out.write(part.value);
    }
    const sha256 = hash.digest('hex');
    if (bytes !== pin.size) throw new DrawioInstallError('app_download_mismatch', 'size', `${bytes} bytes, the pin ${pin.size}`, { expectedBytes: pin.size, actualBytes: bytes, expectedSha256: pin.sha256, actualSha256: sha256 });
    if (sha256 !== pin.sha256) throw new DrawioInstallError('app_download_mismatch', 'sha256', 'the download is not the pinned release', { expectedBytes: pin.size, actualBytes: bytes, expectedSha256: pin.sha256, actualSha256: sha256 });
    await out.sync();
  } catch (error) {
    controller.abort();
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { await out.close(); }
}
