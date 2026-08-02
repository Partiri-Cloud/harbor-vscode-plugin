import { describe, expect, it } from 'vitest';
import { formatClockTime, formatDayTime } from '../src/util/time';

describe('formatDayTime', () => {
  it('reduces an ISO-8601 timestamp to date + minutes', () => {
    expect(formatDayTime('2026-07-10T15:08:17.492695+00:00')).toBe('2026-07-10 15:08');
    expect(formatDayTime('2026-07-10 15:08:17')).toBe('2026-07-10 15:08');
  });

  /**
   * The regression this whole module exists to prevent. A second copy of this
   * formatter used `new Date(...)` and rendered the UTC instant, so a job
   * created at 15:08 local showed as 13:08 with no zone marker. Slice, never
   * re-time.
   */
  it('does not shift the clock by the UTC offset', () => {
    expect(formatDayTime('2026-07-10T15:08:17+02:00')).toBe('2026-07-10 15:08');
    expect(formatDayTime('2026-07-10T15:08:17-05:00')).toBe('2026-07-10 15:08');
  });

  it('passes through anything it does not recognise', () => {
    expect(formatDayTime('23/07/2026 10:30')).toBe('23/07/2026 10:30');
    expect(formatDayTime('not a timestamp')).toBe('not a timestamp');
  });

  it('yields an empty string for absent or non-string values', () => {
    expect(formatDayTime(undefined)).toBe('');
    expect(formatDayTime(null)).toBe('');
    expect(formatDayTime(42)).toBe('');
    expect(formatDayTime('')).toBe('');
  });
});

describe('formatClockTime', () => {
  it('reduces an ISO-8601 timestamp to wall-clock time', () => {
    expect(formatClockTime('2026-08-01T11:57:58.489Z')).toBe('11:57:58');
    expect(formatClockTime('2026-08-01 11:57:58')).toBe('11:57:58');
  });

  it('does not shift the clock by the UTC offset', () => {
    expect(formatClockTime('2026-08-01T11:57:58+02:00')).toBe('11:57:58');
  });

  it('passes through anything it does not recognise', () => {
    expect(formatClockTime('12:04:11')).toBe('12:04:11');
    expect(formatClockTime('not a timestamp')).toBe('not a timestamp');
    expect(formatClockTime('')).toBe('');
  });

  // Seconds are required: without them there is no wall-clock time to show,
  // so the original string is preserved rather than half-rendered.
  it('passes through an ISO timestamp that carries no seconds', () => {
    expect(formatClockTime('2026-08-01T11:57')).toBe('2026-08-01T11:57');
  });
});
