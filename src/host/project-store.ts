import { constants } from 'node:fs';
import { EXCLUSIVE_CREATE, READ_NOFOLLOW, PrivateFsError, ensurePrivateDirectory, isPrivateFile, ownedByCaller, syncDirectory } from '../platform/private-fs.ts';
import { lstat, mkdir, open, opendir, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { validateAuthorProject } from '../authoring/index.ts';
import type { AuthorProject } from '../authoring/types.ts';
import type { SavedAuthorProject } from '../authoring/recovery-types.ts';

const MAX_PROJECT_BYTES = 3 * 1024 * 1024, MAX_STORE_BYTES = 32 * 1024 * 1024, MAX_PROJECTS = 32;
export class ProjectStoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const fail = (code: string, message: string): never => { throw new ProjectStoreError(code, message); };
function id(value: string): string { if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) fail('project_id_invalid', 'Project identifier is invalid'); return value; }
function safe(st: Awaited<ReturnType<FileHandle['stat']>>): void {
  if (!isPrivateFile(st) || st.size > MAX_PROJECT_BYTES) fail('project_store_unsafe', 'Project file ownership, links, permissions or size are unsafe');
}
/** Files are private and bounded; a stale exclusive lock is never guessed away. */
export function createProjectStore(inputDirectory: string) {
  const directory = resolve(inputDirectory);
  const transient = /^\.pending-[a-f0-9]{32}$/;
  const claim = /^\.recovery-[a-f0-9]{32}\.claim$/;
  const committed = /^[a-z0-9][a-z0-9-]{0,63}\.json$/;
  async function check(): Promise<void> {
    try { await ensurePrivateDirectory(directory); }
    catch (error) { fail('project_store_unsafe', error instanceof PrivateFsError ? 'Project directory has a symlink ancestor or unsafe ownership or permissions' : 'Project directory is unsafe'); }
  }
  async function privateEntry(name: string, optional = false): Promise<{ bytes: Buffer; stat: Awaited<ReturnType<FileHandle['stat']>> } | undefined> {
    const path = join(directory, name);
    const handle = await open(path, READ_NOFOLLOW).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && optional) return undefined;
      if (error.code === 'ENOENT') return fail('project_missing', 'Saved project was not found');
      return fail('project_store_unsafe', 'Project file cannot be opened safely');
    });
    if (!handle) return undefined;
    try {
      const expected = await handle.stat();
      if (optional && name === '.projects.lock' && expected.isFile() && expected.nlink === 0) return undefined;
      safe(expected);
      const actual = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT' && optional) return undefined; throw error; });
      if (!actual) return undefined;
      if (actual.isSymbolicLink()) fail('project_store_unsafe', 'Project file changed during read');
      if (actual.dev !== expected.dev || actual.ino !== expected.ino) { if (optional && name === '.projects.lock') return undefined; fail('project_store_unsafe', 'Project file changed during read'); }
      const bytes = await handle.readFile();
      if (bytes.length > MAX_PROJECT_BYTES) fail('project_store_limit', 'Project exceeds file budget');
      return { bytes, stat: expected };
    } finally { await handle.close(); }
  }
  async function readFile(name: string): Promise<Buffer> { return (await privateEntry(name))!.bytes; }
  const writerBusy = (): never => fail('project_store_busy', 'Another writer or an interrupted save owns the project store. Committed projects remain readable; an unproven lock is never removed.');
  function lockRecord(bytes: Buffer): { pid: number; nonce: string } | undefined {
    if (bytes.length > 1024) return undefined;
    try {
      const raw: unknown = JSON.parse(bytes.toString('utf8'));
      if (!raw || typeof raw !== 'object' || Object.keys(raw).sort().join(',') !== 'nonce,pid,schema') return undefined;
      const value = raw as { schema: unknown; pid: unknown; nonce: unknown };
      if (value.schema !== 'practonaut.project-lock/1' || typeof value.pid !== 'number' || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(value.nonce)) return undefined;
      return { pid: value.pid, nonce: value.nonce };
    } catch { return undefined; }
  }
  function provenDead(pid: number): boolean {
    try { process.kill(pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  }
  async function removeOwned(path: string, owned: Awaited<ReturnType<FileHandle['stat']>>): Promise<void> {
    const current = await lstat(path);
    safe(current);
    if (current.ino !== owned.ino || current.dev !== owned.dev) fail('project_store_unsafe', 'Project lock or recovery claim changed');
    await unlink(path);
  }
  async function acquireLock(): Promise<{ lock: FileHandle; release(): Promise<void> }> {
    const path = join(directory, '.projects.lock');
    const exclusive = () => open(path, EXCLUSIVE_CREATE, 0o600);
    let lock: FileHandle | undefined;
    let ownedNewLock: Awaited<ReturnType<FileHandle['stat']>> | undefined;
    let recovery: { path: string; handle: FileHandle; stat: Awaited<ReturnType<FileHandle['stat']>> } | undefined;
    try {
      try { lock = await exclusive(); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const old = await privateEntry('.projects.lock', true);
        if (!old) return writerBusy(); // The next user retry can claim the now-free store.
        const record = lockRecord(old.bytes);
        if (!record || !provenDead(record.pid)) return writerBusy();
        const recoveryPath = join(directory, `.recovery-${record.nonce}.claim`);
        const handle = await open(recoveryPath, EXCLUSIVE_CREATE, 0o600).catch(() => fail('project_store_busy', 'Recovery of this interrupted save is already claimed or was interrupted. Committed projects remain readable; inspect the private store before writing.'));
        const stat = await handle.stat(); safe(stat); recovery = { path: recoveryPath, handle, stat };
        await handle.writeFile(canonicalJson({ schema: 'practonaut.project-recovery-claim/1', pid: process.pid, nonce: record.nonce })); await handle.sync();
        // A nonce-specific exclusive cleaner prevents two legitimate recoveries from
        // unlinking each other's new lock. Never infer death from wall-clock age.
        const actual = await privateEntry('.projects.lock', true);
        if (!actual || actual.stat.ino !== old.stat.ino || actual.stat.dev !== old.stat.dev || !actual.bytes.equals(old.bytes) || !provenDead(record.pid)) return writerBusy();
        await removeOwned(path, old.stat);
        lock = await exclusive().catch(() => writerBusy());
      }
      if (!lock) return writerBusy();
      const acquired = lock;
      const owned = await acquired.stat(); safe(owned); ownedNewLock = owned;
      await acquired.writeFile(canonicalJson({ schema: 'practonaut.project-lock/1', pid: process.pid, nonce: randomBytes(16).toString('hex') })); await acquired.sync();
      return { lock: acquired, async release() {
        try { try { await acquired.close(); } finally { await removeOwned(path, owned); } }
        finally { if (recovery) { try { await recovery.handle.close(); } finally { await removeOwned(recovery.path, recovery.stat); } } }
      } };
    } catch (error) {
      try { if (lock) { try { await lock.close(); } finally { if (ownedNewLock) await removeOwned(path, ownedNewLock); } } }
      finally { if (recovery) { try { await recovery.handle.close(); } finally { await removeOwned(recovery.path, recovery.stat); } } }
      throw error;
    }
  }
  function decode(bytes: Buffer): { project: AuthorProject; savedAt: string } {
    try {
      const value: unknown = JSON.parse(bytes.toString('utf8'));
      if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'project,savedAt,schema,sha256') fail('project_integrity', 'Saved project envelope is invalid');
      const envelope = value as { project: unknown; savedAt: unknown; schema: unknown; sha256: unknown };
      if (envelope.schema !== 'practonaut.saved-author/1' || typeof envelope.savedAt !== 'string' || !Number.isFinite(Date.parse(envelope.savedAt)) || envelope.sha256 !== sha256Hex(canonicalJson(envelope.project))) fail('project_integrity', 'Saved project digest or date is invalid');
      return { project: validateAuthorProject(envelope.project), savedAt: envelope.savedAt as string };
    } catch (error) { if (error instanceof ProjectStoreError) throw error; return fail('project_integrity', 'Saved project data is invalid'); }
  }
  async function entries(): Promise<string[]> {
    await check();
    const names: string[] = [];
    const dir = await opendir(directory);
    // Do not stat, open or follow unknown entries. Bound directory enumeration too.
    for await (const entry of dir) {
      if (names.length >= 4096) fail('project_store_limit', 'Project directory enumeration exceeds its entry budget');
      names.push(entry.name);
    }
    return names;
  }
  async function committedNames(all?: string[]): Promise<string[]> {
    const names = (all ?? await entries()).filter(name => committed.test(name));
    if (names.length > MAX_PROJECTS) fail('project_store_limit', 'Too many saved projects');
    return names.sort();
  }
  async function writeInventory(): Promise<{ names: string[]; bytes: number; temporaryCount: number }> {
    const all = await entries();
    const names = await committedNames(all);
    if (all.some(name => name !== '.projects.lock' && name !== '.DS_Store' && !committed.test(name) && !transient.test(name) && !claim.test(name))) fail('project_store_unsafe', 'Unexpected entry in project store prevents writing');
    const temporary = all.filter(name => transient.test(name) || claim.test(name));
    if (temporary.length > MAX_PROJECTS) fail('project_store_limit', 'Interrupted save or recovery file count exceeds the bounded store');
    let bytes = 0;
    for (const name of temporary) {
      const entry = await privateEntry(name, true);
      if (!entry) continue;
      if (claim.test(name) && entry.bytes.length > 1024) fail('project_store_limit', 'Recovery claim exceeds its byte budget');
      bytes += entry.bytes.length;
    }
    if (bytes > MAX_STORE_BYTES) fail('project_store_limit', 'Interrupted save files exceed the bounded store');
    for (const name of names) {
      bytes += (await readFile(name)).length;
    }
    if (bytes > MAX_STORE_BYTES) fail('project_store_limit', 'Saved and interrupted projects exceed the byte budget');
    return { names, bytes, temporaryCount: temporary.length };
  }
  async function metadata(): Promise<SavedAuthorProject[]> {
    const result: SavedAuthorProject[] = [];
    for (const name of await committedNames()) {
      const { project, savedAt } = decode(await readFile(name));
      if (name !== id(project.id) + '.json') fail('project_integrity', 'Saved project identity does not match filename');
      result.push({ id: project.id, schema: project.schema, savedAt, title: project.repair?.title ?? { en: project.id, de: project.id } });
    }
    return result.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  /** Only committed entry failures are isolated. Unsafe directories and enumeration budgets still fail closed.
   * No damaged entry is rewritten, removed or presented as a valid project. Explicit read remains strict. */
  async function catalog(): Promise<{ projects: SavedAuthorProject[]; unavailable: Array<{ id: string; code: string }>; ignoredEntries: Array<{ name: '.DS_Store'; code: 'os_metadata' }> }> {
    const projects: SavedAuthorProject[] = [], unavailable: Array<{ id: string; code: string }> = [];
    const all=await entries();
    for (const name of await committedNames(all)) {
      try {
        const { project, savedAt } = decode(await readFile(name));
        if (name !== id(project.id) + '.json') fail('project_integrity', 'Saved project identity does not match filename');
        projects.push({ id: project.id, schema: project.schema, savedAt, title: project.repair?.title ?? { en: project.id, de: project.id } });
      } catch (error) {
        if (!(error instanceof ProjectStoreError) || !['project_integrity', 'project_store_unsafe', 'project_missing', 'project_store_limit', 'project_id_invalid'].includes(error.code)) throw error;
        unavailable.push({ id: name.slice(0, -5), code: error.code === 'project_id_invalid' ? 'project_integrity' : error.code });
      }
    }
    return { projects: projects.sort((a, b) => b.savedAt.localeCompare(a.savedAt)), unavailable, ignoredEntries: all.includes('.DS_Store') ? [{name:'.DS_Store',code:'os_metadata'}] : [] };
  }
  async function referencingRecording(recordingId: string): Promise<{ projectIds:string[]; unavailableProjects:Array<{id:string;code:string}> }> {
      if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(recordingId))fail('recording_invalid','recording_invalid: invalid recording id');
      const available=await catalog(),projectIds:string[]=[],unavailableProjects=[...available.unavailable];
      for(const entry of available.projects){
        try{
          const {project}=decode(await readFile(entry.id+'.json'));
          if(project.id!==entry.id)fail('project_integrity','Saved project identity changed');
          if(project.recordingIds.includes(recordingId))projectIds.push(entry.id);
        }catch(error){
          if(!(error instanceof ProjectStoreError))throw error;
          unavailableProjects.push({id:entry.id,code:error.code});
        }
      }
      return{projectIds:projectIds.sort(),unavailableProjects:unavailableProjects.sort((a,b)=>a.id.localeCompare(b.id))};
    }
  async function deleteProject(projectId: string): Promise<void> {
      id(projectId); await check();
      {
        // Explicit deletion removes only the caller-owned canonical directory entry. It
        // never reads the payload or follows links: bad JSON, modes, size, and owned link
        // entries are recoverable, while a link's external target remains untouched.
        const path=join(directory,projectId+'.json');
        const owned=await lstat(path).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return fail('project_missing','Saved project was not found');return fail('project_store_unsafe','Project entry cannot be inspected safely');});
        if((!owned.isFile()&&!owned.isSymbolicLink())||!ownedByCaller(owned))fail('project_store_unsafe','Project deletion requires a caller-owned file or link entry');
        await check();const current=await lstat(path);
        if(current.dev!==owned.dev||current.ino!==owned.ino||current.uid!==owned.uid)fail('project_store_unsafe','Project entry changed before deletion');
        await unlink(path);
        await syncDirectory(directory);
      }
    }
  async function readProject(projectId: string): Promise<AuthorProject> {
      id(projectId); await check();
      const { project } = decode(await readFile(projectId + '.json'));
      if (project.id !== projectId) fail('project_integrity', 'Saved project identity changed');
      return project;
    }
  async function saveProject(project: AuthorProject): Promise<SavedAuthorProject> {
      const checked = validateAuthorProject(project); id(checked.id); await check();
      let temp: string | undefined, ownedTemp: Awaited<ReturnType<FileHandle['stat']>> | undefined;
      try {
        const current = await writeInventory(), name = checked.id + '.json', target = join(directory, name);
        const previous = current.names.includes(name) ? await lstat(target) : undefined;
        if (previous) safe(previous);
        const savedAt = new Date().toISOString();
        const bytes = Buffer.from(canonicalJson({ schema: 'practonaut.saved-author/1', project: checked, savedAt, sha256: sha256Hex(canonicalJson(checked)) }));
        // Reserve peak usage: both the old committed target and the new fsynced temp
        // exist until rename. A successful replacement may later reduce usage.
        if (current.temporaryCount >= MAX_PROJECTS || bytes.length > MAX_PROJECT_BYTES || current.bytes + bytes.length > MAX_STORE_BYTES || (!previous && current.names.length >= MAX_PROJECTS)) fail('project_store_limit', 'Saved project exceeds persistent budget');
        temp = join(directory, '.pending-' + randomBytes(16).toString('hex'));
        const handle = await open(temp, EXCLUSIVE_CREATE, 0o600);
        try { ownedTemp = await handle.stat(); safe(ownedTemp); await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await check();
        const actual = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
        if (actual) safe(actual);
        if (actual?.ino !== previous?.ino || actual?.dev !== previous?.dev) fail('project_store_unsafe', 'Project target changed before replacement');
        const tempStat = await lstat(temp);
        if (tempStat.ino !== ownedTemp.ino || tempStat.dev !== ownedTemp.dev) fail('project_store_unsafe', 'Temporary project changed before replacement');
        await rename(temp, target); temp = undefined;
        await syncDirectory(directory);
        return { id: checked.id, schema: checked.schema, savedAt, title: checked.repair?.title ?? { en: checked.id, de: checked.id } };
      } finally {
        if (temp && ownedTemp) await removeOwned(temp, ownedTemp);
      }
    }
  async function withLock<T>(operation:(transaction:{read:typeof readProject;save:typeof saveProject;delete:typeof deleteProject;referencingRecording:typeof referencingRecording})=>Promise<T>):Promise<T>{
    await check();const {release}=await acquireLock();let active=true;
    const pending=new Set<Promise<unknown>>();
    const held=<A extends unknown[],R>(run:(...args:A)=>Promise<R>)=>async(...args:A):Promise<R>=>{
      if(!active)fail('project_store_busy','The project transaction has ended');
      const result=run(...args);pending.add(result);
      void result.then(()=>pending.delete(result),()=>pending.delete(result));return result;
    };
    try{return await operation({read:held(readProject),save:held(saveProject),delete:held(deleteProject),referencingRecording:held(referencingRecording)});}
    finally{active=false;await Promise.allSettled(pending);await release();}
  }
  return {
    list:metadata,catalog,read:readProject,referencingRecording,withLock,
    save:(project:AuthorProject)=>withLock(transaction=>transaction.save(project)),
    delete:(projectId:string)=>withLock(transaction=>transaction.delete(projectId)),
    withRecordingReferences:<T>(recordingId:string,operation:(references:Awaited<ReturnType<typeof referencingRecording>>)=>Promise<T>):Promise<T>=>{
      if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(recordingId))fail('recording_invalid','recording_invalid: invalid recording id');
      return withLock(async transaction=>operation(await transaction.referencingRecording(recordingId)));
    },
  };
}
