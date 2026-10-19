/**
 * How a command ends while browsers may still be closing (PADR-0050, decision 9).
 *
 * Nothing reaches the Player or MCP. When a command's own shutdown has finished, it reports the
 * ledger's later outcomes on stderr (a close abandoned or failed, a launch rejected, an end not
 * proven), in the CLI's language, and says when Node still waits for a close or a launch that is
 * running. Then it arms the **35 s rule**: an unreferenced timer that fires 35 s after the latest
 * close request in the ledger — a request made after the rule was armed (a late browser going to its
 * one close) moves it — and at once when that time has passed. If Node is still running then and the
 * ledger still holds an entry it has not released, the command calls `process.exit`, so that
 * Playwright's exit handler ends the children it still tracks. While the rule is armed, Ctrl+C, SIGTERM
 * and SIGHUP exit the same way instead of killing Node past that handler. An unreferenced timer never
 * keeps Node alive by itself, and the command never exits while a host is open: every command calls
 * this only after its shutdown.
 *
 * Where each command's shutdown ends: `run`, `check`, `pack`, `validate`, `doctor`, `tasks …`,
 * `report …`, `compare`, `serve`, `play` and `bench` when `main` has returned (serve and play return
 * after the stop closed the host and removed its credential; bench after the report and every host
 * it started); `practonaut mcp`, whose `main` returns at once, only after `stop()` closed the host and
 * removed its token file (`deferCommandEnd`).
 */
import { processLedger, type BrowserLedger, type LedgerRecord } from '../adapters/browser/ledger.ts';
import { cliText } from './messages.ts';

/** Playwright's close bound (30 s) plus 5 s after the last close request. */
export const EXIT_RULE_MS = 35_000;
/** The exit codes of a command ended by a signal while the rule waits (128 + the signal's number). */
export const SIGNAL_EXIT = Object.freeze({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 });
type ExitSignal = keyof typeof SIGNAL_EXIT;

const OWNER = { mirror: 'ledgerOwnerMirror', 'start-check': 'ledgerOwnerStartCheck', 'render-check': 'ledgerOwnerRenderCheck', 'report-card': 'ledgerOwnerReportCard' } as const;

/** Whether an entry says more than "closed in time, end proven": only those are reported. */
const notable = (record: LedgerRecord): boolean => record.launch === 'rejected' || record.callers.abandoned > 0 || record.callers.failed > 0
  || record.close === 'rejected' || (record.launch !== 'unused' && record.end !== 'proven');
/** A browser Node still waits for: Playwright's close of it, or its launch, is still running. A
 * rejected launch or a browser that disconnected before its close has nothing of Playwright's left. */
const stillEnding = (record: LedgerRecord): boolean => record.slot === 'held' && (record.close === 'pending' || record.launch === 'pending');

function promiseText(record: LedgerRecord): string {
  if (record.launch === 'rejected') return cliText('ledgerLaunchRejected');
  if (record.launch === 'pending') return cliText('ledgerLaunchPending');
  if (record.close === 'rejected') return cliText('ledgerCloseFailed');
  if (record.callers.abandoned > 0) return cliText(record.close === 'fulfilled' ? 'ledgerCloseAbandonedDone' : 'ledgerCloseAbandonedRunning');
  if (record.close === 'pending') return cliText('ledgerCloseRunning');
  return cliText(record.close === 'none' ? 'ledgerNotClosed' : 'ledgerClosed');
}
function endText(record: LedgerRecord): string {
  switch (record.end) {
    case 'proven': return cliText('ledgerEndProven');
    case 'launch-rejected': return cliText('ledgerEndLaunchWait');
    case 'disconnected-before-close': return cliText('ledgerEndDisconnected');
    case 'close-failed': return cliText('ledgerEndCloseFailed');
    default: return cliText('ledgerEndPending');
  }
}
/** The ledger's later outcomes, one line each, in the CLI's language. */
export function ledgerLines(ledger: BrowserLedger = processLedger): string[] {
  return ledger.records().filter(notable).map(record => cliText('browserLedgerLine', { id: record.id, owner: cliText(OWNER[record.owner]), promise: promiseText(record), end: endText(record) }));
}

export interface CommandEndSettings {
  ledger?: BrowserLedger;
  /** Writes a line to stderr and resolves once it is flushed. */
  write?: (text: string) => Promise<void>;
  /** Flushes stdout (the command's own output). */
  flush?: () => Promise<void>;
  exit?: (code?: number) => void;
  /** The clock the rule reads (`performance.now()`, as the ledger records its requests). */
  now?: () => number;
  /** Registers a once-handler for a signal while the rule waits; returns how to remove it. */
  onSignal?: (signal: ExitSignal, handler: () => void) => () => void;
  /** False when the command's shutdown could not close what it owns (a host that did not close): it
   * still reports, but no rule is armed that could exit past that host (`practonaut mcp`). */
  armExit?: boolean;
}
/** The armed rule; `cancel` removes its timer and its signal handlers. */
export interface ExitRule { cancel(): void }
const written = (stream: NodeJS.WriteStream, text: string): Promise<void> => new Promise(resolve => { stream.write(text, () => resolve()); });
const processSignal = (signal: ExitSignal, handler: () => void): (() => void) => { process.once(signal, handler); return () => { process.off(signal, handler); }; };

/**
 * The end of a command's own shutdown: reports, flushes, and arms the 35 s rule. Returns the armed
 * rule, or `undefined` when every entry is released (or arming was not allowed).
 */
export async function finishCommand(settings: CommandEndSettings = {}): Promise<ExitRule | undefined> {
  const ledger = settings.ledger ?? processLedger, now = settings.now ?? (() => performance.now());
  const write = settings.write ?? (text => written(process.stderr, text));
  const exit = settings.exit ?? ((code?: number) => process.exit(code));
  const armedAt = now();
  /** The latest close request (a launch rejection included), whenever it was made. */
  const latest = (): number => ledger.lastCloseRequestAt ?? armedAt;
  let timer: ReturnType<typeof setTimeout> | undefined, done = false;
  const removers: Array<() => void> = [];
  const cancel = (): void => { done = true; clearTimeout(timer); for (const remove of removers.splice(0)) remove(); };
  const end = (code: number | undefined): void => { if (done) return; cancel(); exit(code); };
  const armed = settings.armExit !== false && ledger.unreleased() > 0;
  // Ctrl+C while Node waits must still reach Playwright's exit handler, which ends what it tracks: the
  // handlers are in place before any output of the command's end, which a signal may follow at once.
  if (armed) for (const signal of Object.keys(SIGNAL_EXIT) as ExitSignal[]) removers.push((settings.onSignal ?? processSignal)(signal, () => end(SIGNAL_EXIT[signal])));
  await (settings.flush ?? (() => written(process.stdout, '')))();
  for (const line of ledgerLines(ledger)) await write(line);
  const ending = ledger.records().filter(stillEnding).length;
  if (ending > 0) await write(cliText('browsersWaiting', { count: ending }));
  if (!armed || done) return undefined;
  if (ledger.unreleased() === 0) { cancel(); return undefined; }
  /** Fires `delay` after now; `basis` is the latest request the delay was counted from. */
  const arm = (basis: number, delay: number): void => {
    timer = setTimeout(() => {
      if (done || ledger.unreleased() === 0) { cancel(); return; }
      // A close requested after the rule was armed moves it: never before 35 s after the latest one.
      const moved = latest();
      if (moved > basis) { arm(moved, moved - basis); return; }
      end(typeof process.exitCode === 'number' ? process.exitCode : undefined);
    }, Math.max(0, delay));
    timer.unref();
  };
  const basis = latest();
  arm(basis, basis + EXIT_RULE_MS - now());
  return { cancel };
}

let deferred = false;
/** For a command whose session outlives `main` (`practonaut mcp`): `main`'s end does not finish it;
 * the returned function does, once its own shutdown has finished. */
export function deferCommandEnd(settings: CommandEndSettings = {}): (overrides?: CommandEndSettings) => Promise<ExitRule | undefined> {
  deferred = true;
  return overrides => finishCommand({ ...settings, ...overrides });
}
/** After `main` returned: finishes every command that did not defer its end. */
export async function afterMain(settings: CommandEndSettings = {}): Promise<void> {
  if (!deferred) await finishCommand(settings);
}
/** Test seam: a fresh process state. */
export function resetCommandEnd(): void { deferred = false; }
