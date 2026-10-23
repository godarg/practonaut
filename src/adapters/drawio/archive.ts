/**
 * The verified draw.io archive, read in memory and served from an allowlist (PADR-0049 decisions 3.2
 * and 3.3). Opening checks every entry of the central directory against normative limits and reads
 * every entry's local header from the buffer; nothing is inflated then. Only allowlisted entries are
 * ever inflated, each at most once per archive, with zlib's `maxOutputLength` set to its declared size,
 * then checked for size and CRC-32. Concurrent requests for one entry share one pending inflation, so
 * the inflated files held never exceed the allowlist's declared total.
 *
 * The pinned archive meets every rule (measured over all 3,318 entries, spikes/drawio/results/shell.json);
 * a violation means another file and is refused as `app_runtime_unverified`.
 */
import yauzl from 'yauzl';
import { crc32, inflateRawSync } from 'node:zlib';
import { DrawioRuntimeError } from './runtime.ts';

export interface ArchiveLimits { entries: number; entryBytes: number; totalBytes: number; ratio: number; allowlistBytes: number }
const MIB = 1024 * 1024;
export const ARCHIVE_LIMITS: Readonly<ArchiveLimits> = Object.freeze({ entries: 4_096, entryBytes: 32 * MIB, totalBytes: 256 * MIB, ratio: 100, allowlistBytes: 32 * MIB });

export interface DrawioArchive {
  /** True for an allowlisted file entry the app may load. */
  serves(name: string): boolean;
  /** An allowlisted entry's bytes (refused for anything else). */
  read(name: string): Promise<Buffer>;
  /** How many inflations ran (each allowlisted entry at most once). */
  readonly inflations: number;
}

const refuse = (detail: string): never => { throw new DrawioRuntimeError('app_runtime_unverified', `the draw.io archive is refused: ${detail}`); };
const S_IFMT = 0o170000, S_IFLNK = 0o120000;
const LOCAL_SIGNATURE = 0x04034b50, LOCAL_LENGTH = 30;
/** Relative, forward slashes, no `..` or `.`, no drive letter, no control character. */
export function safeEntryName(name: string): boolean {
  return name.length > 0 && name.length <= 512 && !name.startsWith('/') && !name.includes('\\') && !/^[A-Za-z]:/.test(name)
    && name.replace(/\/$/, '').split('/').every(part => part !== '' && part !== '..' && part !== '.' && !/[\u0000-\u001f\u007f]/.test(part));
}

/** Opens the archive held in `buffer`; `allowlist` names the only entries that may be served. */
export async function openDrawioArchive(buffer: Buffer, allowlist: readonly string[], limits: ArchiveLimits = ARCHIVE_LIMITS): Promise<DrawioArchive> {
  let zip: yauzl.ZipFile;
  try { zip = await new Promise<yauzl.ZipFile>((ok, fail) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true, decodeStrings: true }, (error, file) => error ? fail(error) : ok(file))); }
  catch (error) { return refuse(`not a readable zip (${error instanceof Error ? error.message.slice(0, 80) : 'error'})`); }
  const files = new Map<string, yauzl.Entry>(), names = new Set<string>();
  let count = 0, total = 0;
  try {
    await new Promise<void>((ok, fail) => {
      zip.on('error', fail); zip.on('end', () => ok());
      zip.on('entry', (entry: yauzl.Entry) => {
        try {
          if (++count > limits.entries) refuse(`more than ${limits.entries} entries`);
          const name = entry.fileName;
          if (!safeEntryName(name)) refuse(`an unsafe entry name`);
          if (names.has(name)) refuse(`a duplicate entry name`);
          names.add(name);
          if (((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) refuse('a link entry');
          if (entry.generalPurposeBitFlag & 0x0001) refuse('an encrypted entry');
          if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) refuse(`compression method ${entry.compressionMethod}`);
          // The local header, read by us from the buffer: same name bytes and method as the directory.
          const at = entry.relativeOffsetOfLocalHeader;
          if (at + LOCAL_LENGTH > buffer.length || buffer.readUInt32LE(at) !== LOCAL_SIGNATURE) refuse('a missing local header');
          const nameLength = buffer.readUInt16LE(at + 26);
          if (!buffer.subarray(at + LOCAL_LENGTH, at + LOCAL_LENGTH + nameLength).equals(entry.fileNameRaw)) refuse('a local-header name that differs from the central directory');
          if (buffer.readUInt16LE(at + 8) !== entry.compressionMethod) refuse('a local-header method that differs from the central directory');
          if (!name.endsWith('/')) {
            if (entry.uncompressedSize > limits.entryBytes) refuse(`an entry over ${limits.entryBytes} bytes`);
            if (entry.uncompressedSize > limits.ratio * Math.max(1, entry.compressedSize)) refuse(`a compression ratio over ${limits.ratio}`);
            total += entry.uncompressedSize;
            if (total > limits.totalBytes) refuse(`more than ${limits.totalBytes} bytes inflated in total`);
            files.set(name, entry);
          }
          zip.readEntry();
        } catch (error) { fail(error); }
      });
      zip.readEntry();
    });
  } catch (error) {
    zip.close();
    if (error instanceof DrawioRuntimeError) throw error;
    return refuse(`its directory does not read (${error instanceof Error ? error.message.slice(0, 80) : 'error'})`);
  }
  zip.close();
  const allowed = new Set(allowlist);
  let declared = 0;
  for (const name of allowed) {
    const entry = files.get(name);
    if (!entry) refuse(`it lacks ${name}, which the pinned app loads`);
    declared += entry!.uncompressedSize;
  }
  if (declared > limits.allowlistBytes) refuse(`the served files declare more than ${limits.allowlistBytes} bytes`);
  const pending = new Map<string, Promise<Buffer>>();
  let inflations = 0;
  const inflate = (entry: yauzl.Entry): Buffer => {
    inflations++;
    const at = entry.relativeOffsetOfLocalHeader;
    const start = at + LOCAL_LENGTH + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
    const compressed = buffer.subarray(start, start + entry.compressedSize);
    let data: Buffer;
    if (entry.compressionMethod === 0) data = Buffer.from(compressed);
    else {
      try { data = inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.uncompressedSize) }); }
      catch { return refuse(`${entry.fileName} inflates beyond its declared size or is damaged`); }
    }
    if (data.length !== entry.uncompressedSize) refuse(`${entry.fileName} has another size than declared`);
    if ((crc32(data) >>> 0) !== (entry.crc32 >>> 0)) refuse(`${entry.fileName} fails its CRC-32`);
    return data;
  };
  return {
    serves: name => allowed.has(name),
    read: name => {
      if (!allowed.has(name)) return Promise.reject(new DrawioRuntimeError('app_runtime_unverified', `${name} is not served`));
      let entry = pending.get(name);
      if (!entry) { entry = Promise.resolve().then(() => inflate(files.get(name)!)); pending.set(name, entry); }
      return entry;
    },
    get inflations() { return inflations; },
  };
}
