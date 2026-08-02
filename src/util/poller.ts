/**
 * Shared polling cadence for the views and the log watch.
 *
 * Only the interval handle is shared. Failure counting deliberately stays at
 * each call site, because the two counters count different things: the log
 * watch counts poll ticks, while a panel counts every refresh — selection
 * change, visibility change, manual reload, and tick alike — through one
 * catch. Folding that into this class would mean exposing
 * record-success/record-failure/reset and calling them from outside, which is
 * more coupling than the duplicated `if (handle) return` it would remove.
 */

export const WATCH_INTERVAL_MS = 30_000;
export const MAX_CONSECUTIVE_WATCH_FAILURES = 3;

/** Idempotent `setInterval` wrapper. Owns the handle and nothing else. */
export class Poller {
  private handle: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly tick: () => void | Promise<void>,
    private readonly intervalMs: number = WATCH_INTERVAL_MS,
  ) {}

  /** No-op when already running, so repeated visibility events don't stack timers. */
  start(): void {
    if (this.handle) {
      return;
    }
    this.handle = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = undefined;
    }
  }

  dispose(): void {
    this.stop();
  }
}
