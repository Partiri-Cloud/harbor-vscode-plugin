import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CONSECUTIVE_WATCH_FAILURES, Poller, WATCH_INTERVAL_MS } from '../src/util/poller';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Poller', () => {
  it('does not tick before the interval elapses', () => {
    const tick = vi.fn();
    new Poller(tick).start();
    vi.advanceTimersByTime(WATCH_INTERVAL_MS - 1);
    expect(tick).not.toHaveBeenCalled();
  });

  it('ticks once per interval', () => {
    const tick = vi.fn();
    new Poller(tick).start();
    vi.advanceTimersByTime(WATCH_INTERVAL_MS * 3);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  /**
   * A panel calls start() on every visibility change. Without this guard each
   * one would leak another interval and the poll rate would climb.
   */
  it('is idempotent — start() twice runs one timer', () => {
    const tick = vi.fn();
    const poller = new Poller(tick);
    poller.start();
    poller.start();
    vi.advanceTimersByTime(WATCH_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('stops ticking after stop()', () => {
    const tick = vi.fn();
    const poller = new Poller(tick);
    poller.start();
    vi.advanceTimersByTime(WATCH_INTERVAL_MS);
    poller.stop();
    vi.advanceTimersByTime(WATCH_INTERVAL_MS * 5);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('can be restarted after stopping', () => {
    const tick = vi.fn();
    const poller = new Poller(tick);
    poller.start();
    poller.stop();
    poller.start();
    vi.advanceTimersByTime(WATCH_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('stop() on a never-started poller is harmless', () => {
    expect(() => new Poller(vi.fn()).stop()).not.toThrow();
  });

  it('dispose() stops the timer', () => {
    const tick = vi.fn();
    const poller = new Poller(tick);
    poller.start();
    poller.dispose();
    vi.advanceTimersByTime(WATCH_INTERVAL_MS * 5);
    expect(tick).not.toHaveBeenCalled();
  });

  it('honours a custom interval', () => {
    const tick = vi.fn();
    new Poller(tick, 1_000).start();
    vi.advanceTimersByTime(5_000);
    expect(tick).toHaveBeenCalledTimes(5);
  });

  // A rejected tick must not stop the poll loop — the failure policy that
  // decides when to give up lives at the call site, not in here.
  it('keeps ticking when the callback rejects', async () => {
    const tick = vi.fn().mockRejectedValue(new Error('boom'));
    new Poller(tick).start();
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS * 2);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});

describe('watch policy constants', () => {
  it('are shared so the panels and the log watch cannot drift', () => {
    expect(WATCH_INTERVAL_MS).toBe(30_000);
    expect(MAX_CONSECUTIVE_WATCH_FAILURES).toBe(3);
  });
});
