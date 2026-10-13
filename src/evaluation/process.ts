import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireSameUser } from './client.ts';
import { RuntimeError } from '../cli/runtime.ts';
import type { AgentIdentity, AssignmentReply, BundleProbe, CheckerRequest, VerdictReply } from './contracts.ts';

export const CLIENT_WALL_MS = 300_000;
export const CLIENT_OUTPUT_BYTES = 20 * 1024 * 1024;
/** Resolve the actual child principal, rather than passing the host's login name across users. */
export async function agentEnvironment(identity: AgentIdentity): Promise<NodeJS.ProcessEnv> {
  requireSameUser(identity);
  // The child itself reports its login name; no platform-specific `id` binary is assumed.
  const result = await boundedProcess(process.execPath, ['-e', 'process.stdout.write(require("node:os").userInfo().username)'], { uid: identity.uid, gid: identity.gid, env: { PATH: process.env.PATH, HOME: identity.home }, wallMs: 5_000, bytes: 1024 });
  const username = result.stdout.trim();
  if (result.exitCode !== 0 || !/^[A-Za-z0-9_.-]{1,64}$/.test(username)) throw new RuntimeError('evaluation_identity_invalid', 'Cannot resolve the actual agent login principal');
  return { PATH: process.env.PATH, HOME: identity.home, USER: username, LOGNAME: username, SHELL: process.env.SHELL ?? '/bin/sh', LANG: process.env.LANG ?? 'en_US.UTF-8' };
}
export interface ProcessResult { stdout: string; stderr: string; exitCode: number; pid: number; elapsedMs: number }
export async function boundedProcess(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; uid?: number; gid?: number; input?: string; wallMs?: number; bytes?: number } = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const started = performance.now(), child = spawn(command, args, { detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], ...(options.cwd ? { cwd: options.cwd } : {}), ...(options.env ? { env: options.env } : {}), ...(options.uid === undefined ? {} : { uid: options.uid }), ...(options.gid === undefined ? {} : { gid: options.gid }) });
    const stdout: Buffer[] = [], stderr: Buffer[] = []; let size = 0, settled = false, failure:RuntimeError|undefined;
    const terminate = (): void => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL'); } };
    const fail = (code: string): void => { if (settled || failure) return; failure = new RuntimeError(code, 'Evaluation process failed its bounded process contract'); clearTimeout(timer); terminate(); };
    const timer = setTimeout(() => fail('evaluation_timeout'), options.wallMs ?? CLIENT_WALL_MS);
    child.on('error', () => fail('evaluation_process_failed'));
    const collect = (output: Buffer[], chunk: Buffer): void => { if(failure)return; size += chunk.length; if (size > (options.bytes ?? CLIENT_OUTPUT_BYTES)) fail('evaluation_output_limit'); else output.push(chunk); };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk)); child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.stdin.on('error', () => { /* A rejected process may close stdin before consuming its bounded request. */ });
    child.stdin.end(options.input ?? '');
    // A client may pass inherited pipe descriptors to a detached descendant.
    // Once the actual child exits after a failure, do not wait on those pipes.
    child.on('exit',()=>{if(failure){child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();}});
    child.on('close', code => { if (settled) return; settled = true; clearTimeout(timer); terminate(); if(failure){reject(failure);return;} resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: code ?? 3, pid: child.pid ?? -1, elapsedMs: Math.round(performance.now() - started) }); });
  });
}
export async function checkerRequest(request: CheckerRequest): Promise<AssignmentReply | VerdictReply> {
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  const worker = fileURLToPath(new URL(`checker-worker.${extension}`, import.meta.url));
  const result = await boundedProcess(process.execPath, ['--max-old-space-size=256', worker], { input: JSON.stringify(request), wallMs: 10_000, bytes: 4 * 1024 * 1024 });
  if (result.exitCode !== 0) throw new RuntimeError('evaluation_checker_invalid', 'Evaluation bundle, task or submission failed validation');
  let parsed: unknown; try { parsed = JSON.parse(result.stdout); } catch { throw new RuntimeError('evaluation_checker_invalid', 'Invalid separate-checker response'); }
  const reply = parsed as AssignmentReply | VerdictReply;
  if (!reply || reply.ok !== true || !/^[a-f0-9]{64}$/.test(reply.bundleSha256) || !/^[a-f0-9]{64}$/.test(reply.worldSha256) || reply.checkerPid === process.pid) throw new RuntimeError('evaluation_checker_invalid', 'Invalid separate-checker binding');
  return reply;
}
/** Actual open, under the exact uid/gid used for the subsequent real client; never outputs bundle bytes. */
export async function probeBundleReadability(path: string, identity: AgentIdentity): Promise<BundleProbe> {
  requireSameUser(identity);
  const program = `const fs=require('node:fs');try{const fd=fs.openSync(process.argv[1],fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const s=fs.fstatSync(fd);if(!s.isFile())throw Error('file');const b=Buffer.alloc(1);fs.readSync(fd,b,0,1,0);fs.closeSync(fd);process.stdout.write(JSON.stringify({uid:process.getuid(),gid:process.getgid(),readable:true,reason:'opened'}));}catch(e){if(e.code==='EACCES'||e.code==='EPERM')process.stdout.write(JSON.stringify({uid:process.getuid(),gid:process.getgid(),readable:false,reason:'permission-denied'}));else process.exitCode=2;}`;
  const result = await boundedProcess(process.execPath, ['-e', program, path], { uid: identity.uid, gid: identity.gid, env: { PATH: process.env.PATH, HOME: identity.home }, wallMs: 5_000, bytes: 1024 });
  if (result.exitCode !== 0) throw new RuntimeError('evaluation_probe_failed', 'Agent-user bundle read probe failed');
  const probe = JSON.parse(result.stdout) as BundleProbe;
  if (probe.uid !== identity.uid || probe.gid !== identity.gid || typeof probe.readable !== 'boolean' || !['opened', 'permission-denied'].includes(probe.reason)) throw new RuntimeError('evaluation_probe_failed', 'Agent-user read probe identity mismatch');
  return probe;
}
export function classifySeal(_probe: BundleProbe, identity: AgentIdentity, unsealed: boolean): 'unsealed' {
  requireSameUser(identity);
  if (!unsealed) throw new RuntimeError('evaluation_unsealed', 'Agent can access the checker trust boundary; use --unsealed for a non-evidence run');
  return 'unsealed';
}
