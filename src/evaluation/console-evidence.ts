/** Console evidence bounds per native attempt: messages kept, characters kept per message. */
export const NATIVE_TRANSFER_CONSOLE_LIMIT = 200, NATIVE_TRANSFER_CONSOLE_TEXT = 2_000;
export interface ConsoleEvidence { messages: Array<{ type: string; text: string; ms: number }>; dropped: number }
/**
 * A bounded record of a page's console messages and uncaught errors for attempt evidence. Messages past
 * the limit are counted, not kept; each text is cut to its limit. `now` is injectable for tests.
 */
export function consoleRecorder(now: () => number = () => performance.now(), limit = NATIVE_TRANSFER_CONSOLE_LIMIT, textLimit = NATIVE_TRANSFER_CONSOLE_TEXT) {
  const start = now(), evidence: ConsoleEvidence = { messages: [], dropped: 0 };
  const record = (type: string, text: string): void => {
    if (evidence.messages.length >= limit) { evidence.dropped++; return; }
    evidence.messages.push({ type, text: text.slice(0, textLimit), ms: Math.round(now() - start) });
  };
  return {
    message: (message: { type(): string; text(): string }): void => record(message.type(), message.text()),
    pageError: (error: Error): void => record('pageerror', `${error.name}: ${error.message}`),
    evidence: (): ConsoleEvidence => evidence,
  };
}
