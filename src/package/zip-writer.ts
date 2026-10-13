// Deterministic ZIP writer for the packer. Derived from the runtime-parity spike's fixture writer
// and hardened: it only writes what the reader accepts.
// - every entry STORED (method 0): output bytes do not depend on the zlib version of the Node
//   build, so the same input gives byte-identical archives across machines and Node releases;
// - fixed DOS timestamp 1980-01-01 00:00:00, fixed "version made by" (Unix, 2.0), mode 0644;
// - no extra fields, no comments, no data descriptors, no directory entries, no zip64;
// - names must pass the reader's name policy; entries are written in the given order.
import { crc32 } from "node:zlib";
import { PackageError } from "./errors.ts";
import type { Limits } from "./limits.ts";
import { checkEntryName, foldName } from "./paths.ts";

export interface WriterEntry {
  name: string;
  data: Uint8Array;
}

const DOS_TIME = 0x0000; // 00:00:00
const DOS_DATE = 0x0021; // 1980-01-01 (year 0, month 1, day 1)
const VERSION = 20; // 2.0: deflate/stored, no zip64
const MADE_BY = (3 << 8) | VERSION; // Unix
const MODE_FILE = 0o100644;

export function writeStoredZip(entries: readonly WriterEntry[], limits: Limits): Buffer {
  if (entries.length > limits.maxEntries) throw new PackageError("E_TOO_MANY_ENTRIES", `${entries.length} > ${limits.maxEntries}`);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let total = 0;
  for (const e of entries) {
    checkEntryName(e.name, limits, false);
    if (seen.has(foldName(e.name))) throw new PackageError("E_DUPLICATE_ENTRY", "duplicate entry", e.name);
    seen.add(foldName(e.name));
    if (e.data.length > limits.maxEntryBytes) throw new PackageError("E_ENTRY_TOO_LARGE", `${e.data.length} > ${limits.maxEntryBytes} bytes`, e.name);
    total += e.data.length;
    if (total > limits.maxTotalBytes) throw new PackageError("E_TOTAL_TOO_LARGE", `total > ${limits.maxTotalBytes} bytes`, e.name);
    const name = Buffer.from(e.name, "utf8");
    const data = Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    const crc = crc32(data) >>> 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(VERSION, 4);
    lh.writeUInt16LE(0, 6); // flags: none (names are ASCII by policy)
    lh.writeUInt16LE(0, 8); // stored
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    const local = Buffer.concat([lh, name, data]);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(MADE_BY, 4);
    ch.writeUInt16LE(VERSION, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); // extra length
    ch.writeUInt16LE(0, 32); // comment length
    ch.writeUInt16LE(0, 34); // disk
    ch.writeUInt16LE(0, 36); // internal attributes
    ch.writeUInt32LE(((MODE_FILE & 0xffff) << 16) >>> 0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, name]));
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const out = Buffer.concat([...locals, cd, eocd]);
  if (out.length > limits.maxArchiveBytes) throw new PackageError("E_ARCHIVE_TOO_LARGE", `${out.length} > ${limits.maxArchiveBytes} bytes`);
  return out;
}
