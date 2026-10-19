// The tests' own read of the process table (PADR-0050: the product reads none). Full-width output in a
// clean environment, so no inherited COLUMNS cuts a command line; only matching rows are kept, and no
// other process's command line is printed or stored. POSIX through `ps`, Windows through CIM.
import { execFileSync } from 'node:child_process';

export interface ProcessRow { pid: number; ppid: number; pgid: number | null; sid: string | null; started: string; command: string }

const CLEAN = (): NodeJS.ProcessEnv => ({ PATH: process.env.PATH ?? process.env.Path ?? '', LC_ALL: 'C', TZ: 'UTC', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {}) });

function posixTable(): ProcessRow[] {
  // `sess` is the session on macOS (BSD ps), `sid` on Linux (procps).
  const session = process.platform === 'linux' ? 'sid' : 'sess';
  const output = execFileSync('ps', ['-axww', '-o', `pid=,ppid=,pgid=,${session}=,lstart=,command=`], { encoding: 'utf8', env: CLEAN(), maxBuffer: 64 * 1024 * 1024 });
  return output.split('\n').filter(Boolean).map(line => {
    // pid ppid pgid sid, then lstart's five fields (Mon Oct 19 07:30:00 2026), then the command.
    const fields = line.trim().split(/\s+/);
    return { pid: Number(fields[0]), ppid: Number(fields[1]), pgid: Number(fields[2]), sid: fields[3] ?? null, started: fields.slice(4, 9).join(' '), command: fields.slice(9).join(' ') };
  });
}
function windowsTable(marker: string): ProcessRow[] {
  // The marker goes through the environment, never on the command line, so the query cannot match itself.
  const script = '$m=$env:PN_MARKER; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($m) } | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CreationDate.ToUniversalTime().ToString(\'o\'))`t$($_.CommandLine)" }';
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', env: { ...CLEAN(), PN_MARKER: marker }, maxBuffer: 64 * 1024 * 1024 });
  return output.split(/\r?\n/).filter(Boolean).map(line => { const [pid, ppid, started, ...command] = line.split('\t'); return { pid: Number(pid), ppid: Number(ppid), pgid: null, sid: null, started: started ?? '', command: command.join('\t') }; });
}

/** Processes whose command line contains `marker` (a path only the test's own processes use). */
export function processesWith(marker: string): ProcessRow[] {
  if (process.platform === 'win32') return windowsTable(marker);
  return posixTable().filter(row => row.command.includes(marker) && row.pid !== process.pid);
}
/** The whole tree below `root` (POSIX), each with its start time, so a reused process id is told apart. */
export function descendantsOf(root: number): ProcessRow[] {
  const rows = posixTable(), tree: ProcessRow[] = [];
  const walk = (parent: number): void => { for (const row of rows.filter(candidate => candidate.ppid === parent)) { tree.push(row); walk(row.pid); } };
  walk(root);
  return tree;
}
/** Which of `recorded` still run: the same process id with the same start time. */
export function survivors(recorded: readonly ProcessRow[]): ProcessRow[] {
  const now = posixTable();
  return recorded.filter(row => now.some(current => current.pid === row.pid && current.started === row.started));
}
