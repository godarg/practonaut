import { constants } from 'node:fs';
import { EXCLUSIVE_CREATE, READ_NOFOLLOW, PrivateFsError, ensurePrivateDirectory, isPrivateFile } from '../platform/private-fs.ts';
import { dataPaths } from '../platform/paths.ts';
import { lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { resolve, basename, parse, join } from 'node:path';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { RECORDING_LIMITS, validateRecording } from '../adapters/excalidraw/recorder.ts';
import type { Recording, RecordingManifest, RecordingStore } from '../adapters/excalidraw/recorder-types.ts';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const fail = (message: string): never => { throw new Error('recording_store: ' + message); };
function recordingId(id: string): string { if (!ID.test(id)) fail('invalid recording ID'); return id; }

/** This store never follows links; unknown entries fail closed rather than disappear from review. */
export function createRecordingStore(root = dataPaths().recordings): RecordingStore {
  const directory = resolve(root);
  let sequence: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => { const task = sequence.then(run, run); sequence = task.then(() => undefined, () => undefined); return task; };
  async function checkAncestors(): Promise<void> {
    try { await ensurePrivateDirectory(directory); }
    catch (error) { if (error instanceof PrivateFsError) fail('recording directory must be owned by caller with mode 0700 and have no symlink ancestors'); throw error; }
  }
  async function privateFile(file: string, enforceByteLimit = true): Promise<FileHandle> {
    const handle = await open(file, READ_NOFOLLOW);
    try {
      const st = await handle.stat();
      if (!isPrivateFile(st, undefined, enforceByteLimit) || (enforceByteLimit && st.size > RECORDING_LIMITS.maxBytes + 256)) fail('unsafe recording file or byte limit exceeded');
      const pathStat = await lstat(file);
      if (pathStat.isSymbolicLink() || pathStat.ino !== st.ino || pathStat.dev !== st.dev) fail('recording file changed while opening');
      return handle;
    } catch (error) { await handle.close(); throw error; }
  }
  async function writeLock<T>(run: () => Promise<T>): Promise<T> {
    await checkAncestors();
    const lock = join(directory, '.store.lock');
    // Across CLI/host instances, only one writer may measure and modify a store.
    // A stale lock fails closed; it is never stolen using an inferred PID/lifetime.
    const handle = await open(lock, EXCLUSIVE_CREATE, 0o600);
    try { return await run(); } finally { await handle.close(); await unlink(lock); }
  }
  async function entries(strict = true): Promise<{ names: string[]; bytes: number }> {
    await checkAncestors();
    const allNames = (await readdir(directory)).sort();
    if (allNames.includes('.store.lock')) { const lock = await privateFile(join(directory, '.store.lock')); await lock.close(); }
    const names = allNames.filter(name => name !== '.store.lock' && name !== '.DS_Store');
    if (names.length > RECORDING_LIMITS.maxFiles) fail('recording count limit exceeded');
    let bytes = 0;
    for (const name of names) {
      if (strict) {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/.test(name)) fail('unknown store entry');
        const h = await privateFile(join(directory, name)); try { bytes += (await h.stat()).size; } finally { await h.close(); }
      } else {
        // Count every neighbour and its lstat bytes without reading/following it.
        const info=await lstat(join(directory,name));bytes+=info.size;
      }
    }
    if (bytes > RECORDING_LIMITS.maxStoreBytes) fail('total store byte limit exceeded');
    return { names, bytes };
  }
  async function readInternal(id: string): Promise<Recording> {
    recordingId(id); await checkAncestors();
    const handle = await privateFile(join(directory, id + '.json'));
    try {
      const content = await handle.readFile({ encoding: 'utf8' });
      if (Buffer.byteLength(content) > RECORDING_LIMITS.maxBytes + 256) fail('recording byte limit exceeded');
      const envelope: unknown = JSON.parse(content);
      if (!envelope || typeof envelope !== 'object' || Object.keys(envelope).sort().join(',') !== 'recording,sha256') fail('invalid integrity envelope');
      const typed = envelope as { recording: unknown; sha256: unknown };
      const recording = validateRecording(typed.recording);
      if (recording.manifest.id !== id || typed.sha256 !== sha256Hex(canonicalJson(recording))) fail('recording identity or digest mismatch');
      return recording;
    } finally { await handle.close(); }
  }
  return {
    save(recording) { return serial(() => writeLock(async () => {
      const validated = validateRecording(recording), id = recordingId(validated.manifest.id);
      const inventory = await entries(false);
      if (inventory.names.length >= RECORDING_LIMITS.maxFiles) fail('recording count limit exceeded');
      const body = canonicalJson({ recording: validated, sha256: sha256Hex(canonicalJson(validated)) });
      if (Buffer.byteLength(body) + inventory.bytes > RECORDING_LIMITS.maxStoreBytes) fail('total store byte limit exceeded');
      await checkAncestors();
      const file = join(directory, id + '.json');
      const handle = await open(file, EXCLUSIVE_CREATE, 0o600);
      try {
        const st = await handle.stat(); if (!isPrivateFile(st)) fail('unsafe new recording');
        await handle.writeFile(body, 'utf8'); await handle.sync();
      } catch (error) { await handle.close(); await unlink(file); throw error; }
      await handle.close(); return id;
    })); },
    scan() { return serial(async()=>{
      await checkAncestors();const names=(await readdir(directory)).sort();
      if(names.length>RECORDING_LIMITS.maxFiles+2)fail('recording count limit exceeded');
      const recordings:RecordingManifest[]=[],unavailable:Array<{id:string;code:'recording_store_invalid'|'recording_store_metadata'}>=[];let scannedBytes=0;
      for(const name of names){
        if(name==='.store.lock'){const lock=await privateFile(join(directory,name));await lock.close();continue;}
        if(name==='.DS_Store'){unavailable.push({id:name,code:'recording_store_metadata'});continue;}
        const valid=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/.test(name);
        const id=valid?basename(name,'.json'):'invalid-entry-'+sha256Hex(name).slice(0,16);
        try {if(!valid)fail('unknown store entry');const info=await lstat(join(directory,name));if(scannedBytes+info.size>RECORDING_LIMITS.maxStoreBytes)fail('scan byte limit exceeded');scannedBytes+=info.size;recordings.push((await readInternal(id)).manifest);}
        catch {unavailable.push({id,code:'recording_store_invalid'});}
      }
      return {recordings,unavailable};
    });},
    list() { return serial(async () => {
      const inventory = await entries(), manifests: RecordingManifest[] = [];
      for (const name of inventory.names) manifests.push((await readInternal(basename(name, '.json'))).manifest);
      return manifests;
    }); },
    read(id) { return serial(async () => { recordingId(id); return readInternal(id); }); },
    delete(id) { return serial(() => writeLock(async () => {
      recordingId(id); await checkAncestors();
      const file = join(directory, id + '.json');
      // No parsing here: corrupted recordings must still have a real deletion path.
      const handle = await privateFile(file, false); const expected = await handle.stat(); await handle.close();
      await checkAncestors(); const actual = await lstat(file);
      if (actual.ino !== expected.ino || actual.dev !== expected.dev || actual.isSymbolicLink()) fail('recording changed before delete');
      await unlink(file); return { id, removed: [id + '.json'] };
    })); },
  };
}
