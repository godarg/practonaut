import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { RuntimeError } from '../cli/runtime.ts';
import type { AgentIdentity } from './contracts.ts';

export interface ClientBinding { path: string; sha256: string; size: number; kind: 'fixture-client' | 'unassessed-local-client'; identityAssessment: 'fixture/non-genuine' | 'UNASSESSED'; requestedPath: string }
export function requireSameUser(identity: AgentIdentity): void {
  const uid = process.getuid?.(), gid = process.getgid?.();
  if (uid === undefined || gid === undefined || uid === 0 || identity.uid !== uid || identity.gid !== gid) throw new RuntimeError('evaluation_identity_unsupported', 'Root and cross-user evaluation are unsupported; only the current non-root uid/gid may run unsealed');
}
async function validateAncestors(path: string): Promise<void> {
  const root = parse(path).root; let cursor = root;
  for (const part of dirname(path).slice(root.length).split('/').filter(Boolean)) { cursor = join(cursor, part); const stat = await lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== 0 && stat.uid !== process.getuid?.()) || (stat.mode & 0o022) !== 0) throw new RuntimeError('evaluation_client_unsafe', 'Client ancestor must be root/coordinator-owned, non-symlink and not group/world writable');
  }
}
async function fingerprint(path: string): Promise<{ sha256: string; size: number }> {
  await validateAncestors(path); const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.uid !== 0 && before.uid !== process.getuid?.()) || (before.mode & 0o022) !== 0 || (before.mode & 0o111) === 0) throw new RuntimeError('evaluation_client_unsafe', 'Client must be an executable regular file owned by root/coordinator without group/world write access');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat(); if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size || stat.mode !== before.mode || stat.uid !== before.uid) throw new RuntimeError('evaluation_client_changed', 'Client changed during validation');
    const hash = createHash('sha256'); for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await file.stat(); if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new RuntimeError('evaluation_client_changed', 'Client changed while fingerprinting');
    return { sha256: hash.digest('hex'), size: stat.size };
  } finally { await file.close(); }
}
export async function bindClient(requestedPath: string | undefined = undefined, fixture = false): Promise<ClientBinding> {
  if (!requestedPath || !isAbsolute(requestedPath)) throw new RuntimeError('usage', '--client requires an explicit absolute executable path');
  const requested = resolve(requestedPath), path = requested;
  return { path, ...await fingerprint(path), kind: fixture ? 'fixture-client' : 'unassessed-local-client', identityAssessment: fixture ? 'fixture/non-genuine' : 'UNASSESSED', requestedPath: requested };
}
export async function assertClientUnchanged(binding: ClientBinding): Promise<void> {
  const actual = await fingerprint(binding.path); if (actual.sha256 !== binding.sha256 || actual.size !== binding.size) throw new RuntimeError('evaluation_client_changed', 'Pinned client executable changed');
}
