/**
 * How a command ends while browsers may still be closing (PADR-0050, decision 9).
 *
 * Nothing reaches the Player or MCP. When a command's own shutdown has finished, it reports the
 * ledger's later outcomes on stderr (a close abandoned or failed, a launch rejected, an end not
 * proven), in the CLI's language, and says when Node still waits for closes. Then it arms the **35 s
 * rule**: an unreferenced timer that fires 35 s after the last close request (at once when that time
 * has passed). If Node is still running then and the ledger still holds an entry it has not released,
 * the command calls `process.exit`, so that Playwright's exit handler ends the children it still
 * tracks. An unreferenced timer never keeps Node alive by itself, and the command never exits while a
 * host is open: every command calls this only after its shutdown.
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

const OWNER = { mirror: 'ledgerOwnerMirror', 'start-check': 'ledgerOwnerStartCheck', 'render-check': 'ledgerOwnerRenderCheck', 'report-card': 'ledgerOwnerReportCard' } as const;

/** Whether an entry says more than "closed in time, end proven": only those are reported. */
const notable = (record: LedgerRecord): boolean => record.launch === 'rejected' || record.callers.abandoned > 0 || record.callers.failed > 0
  || record.close === 'rejected' || (record.launch !== 'unused' && record.end !== 'proven');

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
}
const written = (stream: NodeJS.WriteStream, text: string): Promise<void> => new Promise(resolve => { stream.write(text, () => resolve()); });

/**
 * The end of a command's own shutdown: reports, flushes, and arms the 35 s rule. Returns the timer it
 * armed (unreferenced), or `undefined` when every entry is released.
 */
export async function finishCommand(settings: CommandEndSettings = {}): Promise<ReturnType<typeof setTimeout> | undefined> {
  const ledger = settings.ledger ?? processLedger;
  const write = settings.write ?? (text => written(process.stderr, text));
  await (settings.flush ?? (() => written(process.stdout, '')))();
  for (const line of ledgerLines(ledger)) await write(line);
  const pending = ledger.unreleased();
  if (pending === 0) return undefined;
  await write(cliText('browsersWaiting', { count: pending }));
  const last = ledger.lastCloseRequestAt ?? performance.now();
  const exit = settings.exit ?? ((code?: number) => process.exit(code));
  const timer = setTimeout(() => { if (ledger.unreleased() > 0) exit(typeof process.exitCode === 'number' ? process.exitCode : undefined); }, Math.max(0, last + EXIT_RULE_MS - performance.now()));
  timer.unref();
  return timer;
}

let deferred = false;
/** For a command whose session outlives `main` (`practonaut mcp`): `main`'s end does not finish it;
 * the returned function does, once its own shutdown has finished. */
export function deferCommandEnd(settings: CommandEndSettings = {}): () => Promise<unknown> {
  deferred = true;
  return () => finishCommand(settings);
}
/** After `main` returned: finishes every command that did not defer its end. */
export async function afterMain(settings: CommandEndSettings = {}): Promise<void> {
  if (!deferred) await finishCommand(settings);
}
/** Test seam: a fresh process state. */
export function resetCommandEnd(): void { deferred = false; }
