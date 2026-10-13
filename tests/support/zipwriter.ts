// Permissive hostile ZIP writer for tests and the demo. Independent of the code under test:
// it shares nothing with src/package (no imports), and it writes whatever it is told, including
// archives no correct writer would produce. Derived from the runtime-parity spike's writer.
import { crc32, deflateRawSync } from "node:zlib";

export interface ExtraField {
  id: number;
  data: Buffer;
}

export interface HostileEntry {
  name: string | Buffer;
  data: Buffer;
  method?: number; // 0 stored, 8 deflate, anything else is written as-is with stored bytes
  diskStart?: number; // central "disk number start" (offset 34), default 0
  rawCompressed?: Buffer; // written as the compressed bytes verbatim (method unchanged)
  level?: number; // deflate level (default 9); low levels keep large fixtures fast to build
  unixMode?: number; // written into the high 16 bits of the external attributes
  madeByOs?: number; // high byte of "version made by" (3 = Unix, 0 = DOS)
  externalAttrs?: number; // overrides unixMode
  flags?: number; // general purpose flags in both headers
  localFlags?: number; // local header only
  localName?: string | Buffer; // local header only
  versionNeeded?: number; // both headers (default 20)
  localVersion?: number; // local header only
  localMethod?: number; // local header only
  localCrc?: number; // local header only
  localExtra?: ExtraField[]; // local header only (replaces `extra` there)
  lieUncompressedSize?: number; // both headers
  localUncompressedSize?: number; // local header only
  crc?: number; // both headers
  extra?: ExtraField[]; // both headers
  entryComment?: string;
  dataDescriptor?: { crc: number; compressedSize: number; uncompressedSize: number };
}

export interface ArchiveOptions {
  prepend?: Buffer; // bytes before the first local header
  adjustOffsetsForPrepend?: boolean; // record offsets as if the prepended bytes belong to the archive
  trailing?: Buffer; // bytes after the end-of-central-directory record
  comment?: string; // archive comment
  zip64Locator?: boolean; // add a zip64 EOCD record and locator before the EOCD
  /** Bytes between the central-directory records and the EOCD; counted in the EOCD cd size or not. */
  cdJunk?: { bytes: Buffer; inCdSize: boolean };
  /** Entry count written into the EOCD (default: the real number of central records). */
  eocdEntryCount?: number;
  /**
   * Extra central-directory records for entries whose local header lies at `offset` (relative to
   * the first local header), e.g. inside another entry's stored data (overlapping-entry bomb).
   */
  extraCentral?: Array<{ name: string; data: Buffer; method: 0 | 8; offset: number }>;
}

function extraBytes(extra: ExtraField[] | undefined): Buffer {
  if (!extra || extra.length === 0) return Buffer.alloc(0);
  return Buffer.concat(
    extra.map((f) => {
      const h = Buffer.alloc(4);
      h.writeUInt16LE(f.id, 0);
      h.writeUInt16LE(f.data.length, 2);
      return Buffer.concat([h, f.data]);
    }),
  );
}

const asBuf = (n: string | Buffer): Buffer => (typeof n === "string" ? Buffer.from(n, "utf8") : n);

export function buildZip(entries: HostileEntry[], opts: ArchiveOptions = {}): Buffer {
  const pre = opts.prepend ?? Buffer.alloc(0);
  const base = opts.adjustOffsetsForPrepend ? pre.length : 0;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const name = asBuf(e.name);
    const lname = e.localName !== undefined ? asBuf(e.localName) : name;
    const comp = e.rawCompressed ?? (method === 8 ? deflateRawSync(e.data, { level: e.level ?? 9 }) : e.data);
    const crc = e.crc ?? crc32(e.data) >>> 0;
    const usize = e.lieUncompressedSize ?? e.data.length;
    const flags = e.flags ?? 0x0800;
    const extra = extraBytes(e.extra);
    const lextra = e.localExtra !== undefined ? extraBytes(e.localExtra) : extra;
    const version = e.versionNeeded ?? 20;
    const comment = Buffer.from(e.entryComment ?? "", "utf8");

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(e.localVersion ?? version, 4);
    lh.writeUInt16LE(e.localFlags ?? flags, 6);
    lh.writeUInt16LE(e.localMethod ?? method, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(e.dataDescriptor ? 0 : (e.localCrc ?? crc) >>> 0, 14);
    lh.writeUInt32LE(e.dataDescriptor ? 0 : comp.length, 18);
    lh.writeUInt32LE(e.dataDescriptor ? 0 : e.localUncompressedSize ?? usize, 22);
    lh.writeUInt16LE(lname.length, 26);
    lh.writeUInt16LE(lextra.length, 28);
    let dd = Buffer.alloc(0);
    if (e.dataDescriptor) {
      dd = Buffer.alloc(16);
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(e.dataDescriptor.crc >>> 0, 4);
      dd.writeUInt32LE(e.dataDescriptor.compressedSize, 8);
      dd.writeUInt32LE(e.dataDescriptor.uncompressedSize, 12);
    }
    const local = Buffer.concat([lh, lname, lextra, comp, dd]);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(((e.madeByOs ?? 3) << 8) | 20, 4);
    ch.writeUInt16LE(version, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(usize, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(extra.length, 30);
    ch.writeUInt16LE(comment.length, 32);
    ch.writeUInt16LE(e.diskStart ?? 0, 34);
    ch.writeUInt16LE(0, 36);
    const attrs = e.externalAttrs ?? ((((e.unixMode ?? 0o100644) & 0xffff) << 16) >>> 0);
    ch.writeUInt32LE(attrs >>> 0, 38);
    ch.writeUInt32LE(base + offset, 42);
    const central = Buffer.concat([ch, name, extra, comment]);
    centrals.push(central);
    locals.push(local);
    offset += local.length;
  }
  for (const x of opts.extraCentral ?? []) {
    const nm = Buffer.from(x.name, "utf8");
    const comp = x.method === 8 ? deflateRawSync(x.data, { level: 9 }) : x.data;
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE((3 << 8) | 20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(x.method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc32(x.data) >>> 0, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(x.data.length, 24);
    ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    ch.writeUInt32LE(base + x.offset, 42);
    centrals.push(Buffer.concat([ch, nm]));
  }
  const count = entries.length + (opts.extraCentral?.length ?? 0);
  const records = Buffer.concat(centrals);
  const junk = opts.cdJunk?.bytes ?? Buffer.alloc(0);
  const cd = Buffer.concat([records, junk]);
  const cdSizeField = opts.cdJunk && !opts.cdJunk.inCdSize ? records.length : cd.length;
  const cdOffset = base + offset;
  const parts: Buffer[] = [pre, ...locals, cd];
  if (opts.zip64Locator) {
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(0x06064b50, 0);
    rec.writeBigUInt64LE(44n, 4);
    rec.writeUInt16LE(45, 12);
    rec.writeUInt16LE(45, 14);
    rec.writeBigUInt64LE(BigInt(count), 24);
    rec.writeBigUInt64LE(BigInt(count), 32);
    rec.writeBigUInt64LE(BigInt(cd.length), 40);
    rec.writeBigUInt64LE(BigInt(cdOffset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(cdOffset + cd.length), 8);
    loc.writeUInt32LE(1, 16);
    parts.push(rec, loc);
  }
  const comment = Buffer.from(opts.comment ?? "", "utf8");
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opts.eocdEntryCount ?? count, 8);
  eocd.writeUInt16LE(opts.eocdEntryCount ?? count, 10);
  eocd.writeUInt32LE(cdSizeField, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  parts.push(eocd, comment, opts.trailing ?? Buffer.alloc(0));
  return Buffer.concat(parts);
}
