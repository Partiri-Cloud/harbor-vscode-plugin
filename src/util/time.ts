/**
 * Compact renderings of the timestamps the CLI returns.
 *
 * Both formatters SLICE the string as written and never re-time it. An earlier
 * copy of the day+time formatter converted to UTC via `new Date(...)`, so a job
 * created at 15:08+02:00 rendered as 13:08 with no zone marker to explain the
 * gap. Re-timing a timestamp whose zone you are not also displaying is a bug,
 * so both of these are deliberately pure string operations.
 *
 * Two formats exist on purpose: a jobs row needs the date, a log line in a
 * narrow sidebar does not. Anything that is not recognisably ISO-8601 passes
 * through untouched — the CLI already pre-formats some fields.
 */

/** `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` prefix, tolerating a space separator. */
const ISO_PREFIX = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?/;

/** `2026-07-10T15:08:17.492695+00:00` -> `2026-07-10 15:08`. */
export function formatDayTime(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }
  const match = ISO_PREFIX.exec(value);
  return match ? `${match[1] as string} ${match[2] as string}` : value;
}

/** `2026-08-01T11:57:58.489Z` -> `11:57:58`. Drops the date to fit a sidebar. */
export function formatClockTime(timestamp: string): string {
  const match = ISO_PREFIX.exec(timestamp);
  return match && match[3] ? `${match[2] as string}${match[3]}` : timestamp;
}
