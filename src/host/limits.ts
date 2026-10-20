/** Security budgets from threat-model §4; callers cannot relax them through environment flags. */
export const HOST_LIMITS = Object.freeze({
  bodyBytes: 64 * 1024, headerBytes: 16 * 1024, headersTimeoutMs: 10_000,
  requestTimeoutMs: 30_000, bootstrapTtlMs: 300_000, bootstrapIssued: 1000,
  ratePerSecond: 50, rateBurst: 200, replyBytes: 4 * 1024 * 1024,
  sseClients: 8, sseQueuedBytes: 4 * 1024 * 1024, heartbeatMs: 15_000,
  networkProbeMs: 3_000,
  // Browsers running and closing at once in this process (PADR-0050): five mirrors (an author host and
  // four practice hosts), two overlapping recovery replacements and the start check's browser.
  browsers: 8,
});
/** Each principal class has one host-wide bucket; claiming another surface adds no budget. */
export class RequestBudget {
  private tokens: number = HOST_LIMITS.rateBurst;
  private last: number;
  private readonly now: () => number;
  constructor(now: () => number = performance.now.bind(performance)) { this.now = now; this.last = now(); }
  take(): boolean {
    const time = this.now();
    this.tokens = Math.min(HOST_LIMITS.rateBurst, this.tokens + Math.max(0, time - this.last) * HOST_LIMITS.ratePerSecond / 1000);
    this.last = Math.max(this.last, time);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
