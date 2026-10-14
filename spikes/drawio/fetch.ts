// Downloads the pinned official draw.io release asset into a new, empty directory under .local/,
// records its size and SHA-256 in pin.json, and unpacks it into a second new, empty directory after
// checking every entry name. Nothing here runs code from the download.
//   node spikes/drawio/fetch.ts            download, verify against pin.json if it has a hash, unpack
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import yauzl from 'yauzl';
import { DOWNLOAD_DIR, PIN_FILE, WEBAPP_DIR, type Pin } from './paths.ts';

const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as Pin;
const url = `https://github.com/jgraph/drawio/releases/download/${pin.tag}/${pin.asset}`;
const target = join(DOWNLOAD_DIR, pin.asset);

function newEmptyDir(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`refusing to reuse a non-empty directory: ${dir.split(sep).slice(-3).join('/')}`);
  mkdirSync(dir, { recursive: true });
}

async function download(): Promise<void> {
  if (existsSync(target)) { process.stdout.write('fetch: asset already downloaded, verifying\n'); return; }
  newEmptyDir(DOWNLOAD_DIR);
  const started = performance.now();
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(target, { flags: 'wx' }));
  process.stdout.write(`fetch: downloaded in ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
}

function digest(): { size: number; sha256: string } {
  const bytes = readFileSync(target);
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Entry names are untrusted: relative, forward slashes, no '..', no drive letters, no links. */
function safeName(name: string): boolean {
  if (!name || name.length > 512 || name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every(part => part !== '..' && part !== '.' && !/[\u0000-\u001f]/.test(part));
}

async function unpack(): Promise<{ files: number; bytes: number }> {
  newEmptyDir(WEBAPP_DIR);
  const zip = await new Promise<yauzl.ZipFile>((ok, fail) => yauzl.open(target, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, file) => error ? fail(error) : ok(file)));
  let files = 0, bytes = 0;
  await new Promise<void>((ok, fail) => {
    zip.on('error', fail);
    zip.on('end', () => ok());
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName;
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (!safeName(name) || mode === 0o120000) { fail(new Error(`unsafe entry rejected: ${JSON.stringify(name.slice(0, 80))}`)); return; }
      const out = resolve(WEBAPP_DIR, name);
      if (!out.startsWith(resolve(WEBAPP_DIR) + sep)) { fail(new Error('entry escapes the unpack root')); return; }
      if (name.endsWith('/')) { mkdirSync(out, { recursive: true }); zip.readEntry(); return; }
      mkdirSync(dirname(out), { recursive: true });
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) { fail(error ?? new Error('no stream')); return; }
        pipeline(stream, createWriteStream(out, { flags: 'wx' })).then(() => { files++; bytes += entry.uncompressedSize; zip.readEntry(); }, fail);
      });
    });
    zip.readEntry();
  });
  return { files, bytes };
}

await download();
const { size, sha256 } = digest();
if (pin.sha256 && pin.sha256 !== sha256) throw new Error(`SHA-256 mismatch: pin ${pin.sha256}, downloaded ${sha256}`);
if (!pin.sha256) {
  writeFileSync(PIN_FILE, JSON.stringify({ ...pin, size, sha256, recorded: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
  process.stdout.write('fetch: recorded size and SHA-256 in pin.json\n');
}
process.stdout.write(`fetch: ${pin.tag}/${pin.asset} ${size} bytes sha256 ${sha256}\n`);
if (existsSync(join(WEBAPP_DIR, 'index.html'))) process.stdout.write('fetch: already unpacked\n');
else {
  const { files, bytes } = await unpack();
  process.stdout.write(`fetch: unpacked ${files} files, ${bytes} bytes\n`);
}
