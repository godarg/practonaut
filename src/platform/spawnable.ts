import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
// Windows: `spawn` without a shell starts only executables. npm installs CLIs such as `claude` and
// `npx` as `.cmd` shims, which must go through cmd.exe. The line for cmd.exe is built here with the
// quoting cross-spawn uses (MIT, github.com/moxystudio/node-cross-spawn, lib/util/escape.js): each
// argument is quoted for the C runtime, then every cmd metacharacter is caret-escaped twice, because
// cmd.exe parses the line once and the shim's `%*` expands it a second time.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
function cmdArgument(value: string): string {
  let quoted = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  quoted = `"${quoted}"`;
  return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

/** Finds a bare command on PATH with PATHEXT, the way cmd.exe would; undefined when not found. */
export function windowsResolve(command: string, env: NodeJS.ProcessEnv, exists: (path: string) => boolean): string | undefined {
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const candidates = (base: string): string[] => win32.extname(base) ? [base] : extensions.map(extension => base + extension.toLowerCase());
  if (/[\\/]/.test(command)) return candidates(command).find(exists);
  for (const directory of (env.Path ?? env.PATH ?? '').split(';').filter(Boolean)) {
    const found = candidates(win32.join(directory, command)).find(exists);
    if (found) return found;
  }
  return undefined;
}

/** The process to start for an argv: unchanged on POSIX and for Windows executables; a `.cmd` or
 * `.bat` goes through `cmd.exe /d /s /c "<quoted line>"` with verbatim arguments. */
export function spawnable(argv: readonly string[], platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): { command: string; args: string[]; windowsVerbatimArguments?: true } {
  const [command, ...args] = argv as [string, ...string[]];
  if (platform !== 'win32') return { command, args };
  const resolved = windowsResolve(command, env, exists);
  if (!resolved || !/\.(?:cmd|bat)$/i.test(resolved)) return { command: resolved ?? command, args };
  const line = [resolved.replace(CMD_META, '^$1'), ...args.map(cmdArgument)].join(' ');
  return { command: env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}
