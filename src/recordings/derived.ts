import { lstat, readdir, open, unlink } from 'node:fs/promises';
import { EXCLUSIVE_CREATE, READ_NOFOLLOW, isPrivateFile } from '../platform/private-fs.ts';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createTokenFile } from '../host/token-file.ts';

/** Delete locally derived packages whose saved author project references this recording. */
export async function deleteDerivedRecordings(directory: string, id: string): Promise<{removed:string[];unavailable:Array<{id:string;code:"derived_recording_invalid"}>}> {
  if (!/^r-[A-Za-z0-9_-]{1,62}$/.test(id)) throw new Error('recording_invalid: invalid recording id');
  const probe = await createTokenFile(directory, 'directory-validation'); await probe.remove();
  const lockPath = join(directory, '.compile.lock');
  const lock = await open(lockPath, EXCLUSIVE_CREATE, 0o600);
  const owned = await lock.stat();
  try {
  const names = await readdir(directory);
  if (names.length > 512) throw new Error('recording_limit: too many derived files');
  const removed: string[] = [],unavailable:Array<{id:string;code:"derived_recording_invalid"}>=[];
  for (const name of names.filter(n => /^[a-z0-9-]+\.author\.json$/.test(n))) {
    const path = join(directory, name);
    let project: { recordingIds?: unknown };
    try {
    const handle = await open(path, READ_NOFOLLOW);
    try {
      const st = await handle.stat();
      if (!isPrivateFile(st) || st.size > 3 * 1024 * 1024) throw new Error('recording_unsafe: derived project is unsafe');
      const parsed:unknown=JSON.parse(await handle.readFile('utf8'));
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!('recordingIds' in parsed)||!Array.isArray(parsed.recordingIds)||!parsed.recordingIds.every(value=>typeof value==='string'&&/^r-[A-Za-z0-9_-]{1,62}$/.test(value)))throw new Error('recording_invalid: derived project shape is invalid');
      project = parsed as typeof project;
    } finally { await handle.close(); }
    } catch {unavailable.push({id:name.slice(0,-'.author.json'.length),code:'derived_recording_invalid'});continue;}
    if (!Array.isArray(project.recordingIds) || !project.recordingIds.includes(id)) continue;
    const prefix = name.slice(0, -'.author.json'.length);
    const pending: Array<{ target: string; name: string; ino: number; dev: number }> = [];
    for (const suffix of ['.pnworld', '.pncheck', '.author.json']) {
      const target = join(directory, prefix + suffix);
      const st = await lstat(target).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
      if (!st) continue;
      if (st.isSymbolicLink() || !isPrivateFile(st)) throw new Error('recording_unsafe: derived output is unsafe');
      pending.push({ target, name: prefix + suffix, ino: st.ino, dev: st.dev });
    }
    for (const item of pending) {
      const st = await lstat(item.target);
      if (st.isSymbolicLink() || st.ino !== item.ino || st.dev !== item.dev || st.nlink !== 1) throw new Error('recording_unsafe: derived output changed before deletion');
      await unlink(item.target); removed.push(item.name);
    }
  }
  return {removed,unavailable};
  } finally {
    await lock.close(); const actual = await lstat(lockPath);
    if (actual.ino !== owned.ino || actual.dev !== owned.dev) throw new Error('recording_unsafe: derivative lock changed');
    await unlink(lockPath);
  }
}
