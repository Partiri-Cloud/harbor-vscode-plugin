/**
 * Pure normalisation of the `service logs` CLI payload into a UI-ready view
 * model. Kept free of any `vscode` import so it can run under a plain unit
 * test, following the src/commands/wizardLogic.ts / src/lsp/features.ts
 * precedent. `service logs` help text says it shows "the last 35 log lines
 * from the past hour"; the exact payload shape has never been captured
 * (see src/metrics/normalize.ts's header for why), so every tolerated shape
 * is best-effort and a genuinely unrecognized payload is the only case that
 * sets `unavailable`. This module never escapes HTML — that is the
 * renderer's job (src/logs/logsHtml.ts), tested separately.
 */

import { firstString, isRecord, unwrapArray } from '../util/records';

export interface LogLine {
  raw: string;
  timestamp?: string;
  stream?: 'stdout' | 'stderr';
}

export interface LogsViewModel {
  lines: LogLine[];
  unavailable: boolean;
}

/**
 * A bare string becomes a line as-is; an object needs a usable text field
 * under one of the tolerated names. Anything else (number, null, array) is
 * dropped — a malformed item degrades only itself, not the whole payload,
 * matching the per-field degradation philosophy in metrics/normalize.ts.
 */
function extractLogItem(item: unknown): LogLine | undefined {
  if (typeof item === 'string') {
    return { raw: item };
  }
  if (!isRecord(item)) {
    return undefined;
  }
  const raw = firstString(item.message, item.line, item.text, item.log);
  if (raw === undefined) {
    return undefined;
  }
  const timestamp = typeof item.timestamp === 'string' ? item.timestamp : undefined;
  const stream = item.stream === 'stdout' || item.stream === 'stderr' ? item.stream : undefined;
  return { raw, timestamp, stream };
}

function extractLines(items: unknown[]): LogLine[] {
  const lines: LogLine[] = [];
  for (const item of items) {
    const line = extractLogItem(item);
    if (line !== undefined) {
      lines.push(line);
    }
  }
  return lines;
}

/** Split a newline-delimited string into lines, dropping a single trailing empty line. */
function splitDelimitedString(value: string): string[] {
  const parts = value.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

export function normalizeLogs(data: unknown): LogsViewModel {
  const items = unwrapArray(data, 'lines', 'logs');
  if (items !== undefined) {
    return { lines: extractLines(items), unavailable: false };
  }

  // A record that carried neither wrapper key is a shape we don't recognise —
  // distinct from a string payload, which is still readable below.
  if (isRecord(data)) {
    return { lines: [], unavailable: true };
  }

  if (typeof data === 'string') {
    const lines = splitDelimitedString(data).map((raw) => ({ raw }));
    return { lines, unavailable: false };
  }

  return { lines: [], unavailable: true };
}
