/** Private output helpers for local evidence tools (transfer runs, agent-run tooling). The former
 * unsealed `eval` runner was replaced by `practonaut bench`; these path checks remain. */
import { EXCLUSIVE_CREATE, isPrivateDirectory, isPrivateFile } from '../platform/private-fs.ts';
import { lstat, mkdir, open, readlink } from 'node:fs/promises';
import { resolve, dirname, join, parse, basename } from 'node:path';
import { RuntimeError } from '../cli/runtime.ts';

/** Only root-owned macOS /tmp and /var aliases are admitted. All user-created
 * symlinks remain forbidden, including below those canonical private roots. */
async function canonicalRootAlias(path:string):Promise<string>{
  const absolute=resolve(path);
  if(process.platform!=="darwin")return absolute;
  for(const alias of ["/tmp","/var"]){
    if(absolute!==alias&&!absolute.startsWith(alias+"/"))continue;
    const info=await lstat(alias);
    if(!info.isSymbolicLink()||info.uid!==0||await readlink(alias)!=="private"+alias)throw new RuntimeError('evaluation_path_unsafe','Evaluation path contains an unsafe ancestor');
    return "/private"+absolute;
  }
  return absolute;
}
export async function noSymlinkAncestors(path: string): Promise<string> {
  const absolute = await canonicalRootAlias(path), root = parse(absolute).root; let cursor = root;
  for (const part of absolute.slice(root.length).split('/').filter(Boolean)) { cursor = join(cursor, part); const stat = await lstat(cursor); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new RuntimeError('evaluation_path_unsafe', 'Evaluation path contains an unsafe ancestor'); }
  return absolute;
}
export async function createPrivateOutput(path: string): Promise<string> {
  const requested = resolve(path), output=join(await noSymlinkAncestors(dirname(requested)),basename(requested));
  try { await mkdir(output, { mode: 0o700 }); } catch { throw new RuntimeError('evaluation_output_unsafe', 'Evaluation output must be a new private directory'); }
  const stat = await lstat(output); if (!isPrivateDirectory(stat)) throw new RuntimeError('evaluation_output_unsafe', 'Evaluation output ownership or permissions are unsafe');
  return output;
}
export async function exclusiveOutput(path: string, contents: string): Promise<void> {
  const file = await open(path, EXCLUSIVE_CREATE, 0o600);
  try { const stat = await file.stat(); if (!isPrivateFile(stat)) throw new RuntimeError('evaluation_output_unsafe', 'Unsafe output file'); await file.writeFile(contents); await file.sync(); } finally { await file.close(); }
}
export const redactCredential = (text: string, ...credentials: string[]): string => credentials.reduce((value, credential) => credential ? value.replaceAll(credential, '[session-credential-redacted]') : value, text);
