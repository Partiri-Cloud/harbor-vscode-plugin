/**
 * Pure normalisation of the `service metrics` CLI payload into a UI-ready
 * view model. Kept free of any `vscode` import so it can run under a plain
 * unit test — the webview provider that calls this (out of this module's
 * scope) is the thin orchestrator built on top, following the
 * src/commands/wizardLogic.ts / src/lsp/features.ts precedent.
 *
 * The real payload was captured from a live `service metrics` response: each
 * gauge is a time series of `[unixTimestampSeconds, value]` pairs under
 * `data.metrics.<key>`. That series path is tried first. The original
 * scalar/nested-percent heuristics below it are kept as a fallback for any
 * payload that doesn't match the series shape — this module must never
 * throw and must degrade gracefully: every gauge is extracted
 * independently, and a bad or missing field degrades only that gauge, never
 * the whole model.
 */

import { isRecord } from '../util/records';

export interface GaugeValue {
  percent: number | undefined;
  label: string;
  /** Raw series values, oldest→newest, when the payload carried a time series. */
  series?: number[];
}

export interface MetricsViewModel {
  cpu: GaugeValue;
  memory: GaugeValue;
  networkIn: GaugeValue;
  networkOut: GaugeValue;
  unavailable: boolean;
}

function getPath(root: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function firstDefinedValue(root: Record<string, unknown>, paths: string[][]): unknown {
  for (const path of paths) {
    const value = getPath(root, path);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/** Only a finite, non-negative number is usable; NaN/Infinity/negative degrade the field. */
function readFiniteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * A raw scalar of <= 1 is treated as a 0..1 fraction and scaled to a
 * percent; anything above 1 is treated as an already-percent value. The
 * ambiguous edge at exactly 1 (1% vs 100%) is resolved in favor of the
 * fraction reading — a deliberate, documented tradeoff, not an ad hoc guess.
 */
function scalarToPercent(raw: number): number {
  return raw <= 1 ? raw * 100 : raw;
}

function unavailableGauge(): GaugeValue {
  return { percent: undefined, label: 'unavailable' };
}

function percentGauge(percent: number): GaugeValue {
  return { percent, label: `${Math.round(percent)}%` };
}

function percentFromScalar(value: unknown, clampToHundred: boolean): GaugeValue {
  const raw = readFiniteNonNegative(value);
  if (raw === undefined) {
    return unavailableGauge();
  }
  const percent = scalarToPercent(raw);
  return percentGauge(clampToHundred ? Math.min(percent, 100) : percent);
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

function formatBytes(bytes: number): string {
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const unit = BYTE_UNITS[unitIndex] ?? 'B';
  const formatted =
    unitIndex === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted} ${unit}`;
}

function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

interface ParsedSeries {
  series: number[];
  /** Last valid entry — the current reading. Guaranteed present alongside `series`. */
  latest: number;
}

/**
 * Read a `[[timestamp, value], ...]` time series for the first matching key,
 * checked under both `data.metrics.<key>` and `data.<key>` (defensive).
 * Malformed entries (wrong shape, non-finite numbers) are dropped rather
 * than failing the whole series; a key with zero usable entries falls
 * through to the next alias.
 */
function readSeries(root: Record<string, unknown>, keys: string[]): ParsedSeries | undefined {
  for (const key of keys) {
    const nested = getPath(root, ['metrics', key]);
    const direct = getPath(root, [key]);
    const raw = Array.isArray(nested) ? nested : Array.isArray(direct) ? direct : undefined;
    if (raw === undefined) {
      continue;
    }
    const values: number[] = [];
    for (const entry of raw) {
      if (
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'number' &&
        Number.isFinite(entry[0]) &&
        typeof entry[1] === 'number' &&
        Number.isFinite(entry[1])
      ) {
        values.push(entry[1]);
      }
    }
    const latest = values.at(-1);
    if (latest !== undefined) {
      return { series: values, latest };
    }
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * CPU is the one gauge where a value over 100% is expected and legitimate
 * (multi-core containers report per-container CPU relative to a single
 * core), so it's clamped rather than treated as malformed. Memory and
 * network percentages are ratio-derived and left unclamped here; the
 * webview builder clamps defensively at render time regardless.
 *
 * The captured live payload carries no CPU limit/allocation total, only a
 * fraction already relative to the service's allocation — so the series
 * reading below is a plain fraction-of-allocation percent, not a
 * used/total ratio.
 */
function extractCpuGauge(root: Record<string, unknown>): GaugeValue {
  const parsed = readSeries(root, ['cpu']);
  if (parsed !== undefined) {
    const percent = clamp(parsed.latest * 100, 0, 100);
    const label = `${percent < 10 ? percent.toFixed(2) : percent.toFixed(1)}%`;
    return { percent, label, series: parsed.series };
  }

  const flatValue = firstDefinedValue(root, [['cpu_percent'], ['cpu_pct'], ['cpu_usage_percent']]);
  if (flatValue !== undefined) {
    return percentFromScalar(flatValue, true);
  }

  const nestedValue = firstDefinedValue(root, [
    ['cpu', 'percent'],
    ['metrics', 'cpu', 'percent'],
  ]);
  if (nestedValue !== undefined) {
    return percentFromScalar(nestedValue, true);
  }

  const usedTotalPairs: [string[], string[]][] = [
    [
      ['cpu', 'used'],
      ['cpu', 'total'],
    ],
    [
      ['cpu', 'current'],
      ['cpu', 'limit'],
    ],
  ];
  for (const [usedPath, totalPath] of usedTotalPairs) {
    const usedValue = getPath(root, usedPath);
    const totalValue = getPath(root, totalPath);
    if (usedValue === undefined && totalValue === undefined) {
      continue;
    }
    const used = readFiniteNonNegative(usedValue);
    const total = readFiniteNonNegative(totalValue);
    if (used === undefined || total === undefined || total <= 0) {
      return unavailableGauge();
    }
    return percentGauge(Math.min((used / total) * 100, 100));
  }

  const bareValue = firstDefinedValue(root, [['cpu'], ['metrics', 'cpu']]);
  if (bareValue !== undefined) {
    return percentFromScalar(bareValue, true);
  }

  return unavailableGauge();
}

/** The captured payload carries no memory limit, so a series reading has no honest denominator for a percent. */
function extractMemoryGauge(root: Record<string, unknown>): GaugeValue {
  const parsed = readSeries(root, ['memory']);
  if (parsed !== undefined) {
    return { percent: undefined, label: formatBytes(parsed.latest), series: parsed.series };
  }

  const flatValue = firstDefinedValue(root, [['memory_percent'], ['mem_percent'], ['memory_pct']]);
  if (flatValue !== undefined) {
    return percentFromScalar(flatValue, false);
  }

  const nestedValue = firstDefinedValue(root, [
    ['memory', 'percent'],
    ['metrics', 'memory', 'percent'],
  ]);
  if (nestedValue !== undefined) {
    return percentFromScalar(nestedValue, false);
  }

  const usedTotalPairs: [string[], string[]][] = [
    [
      ['memory', 'used'],
      ['memory', 'total'],
    ],
    [
      ['memory', 'used_bytes'],
      ['memory', 'total_bytes'],
    ],
    [
      ['memory', 'current'],
      ['memory', 'limit'],
    ],
  ];
  for (const [usedPath, totalPath] of usedTotalPairs) {
    const usedValue = getPath(root, usedPath);
    const totalValue = getPath(root, totalPath);
    if (usedValue === undefined && totalValue === undefined) {
      continue;
    }
    const used = readFiniteNonNegative(usedValue);
    const total = readFiniteNonNegative(totalValue);
    if (used === undefined || total === undefined || total <= 0) {
      return unavailableGauge();
    }
    return { percent: (used / total) * 100, label: `${formatBytes(used)} / ${formatBytes(total)}` };
  }

  const bareValue = firstDefinedValue(root, [['memory'], ['metrics', 'memory']]);
  if (bareValue !== undefined) {
    return percentFromScalar(bareValue, false);
  }

  return unavailableGauge();
}

/**
 * Network is the one gauge where "never fabricate a scale" is load-bearing:
 * a percent is only produced when both a rate/current value AND a
 * limit/capacity value are found. A rate with no limit renders a formatted
 * rate label instead; a bare cumulative counter renders a formatted total.
 * `rx`/`tx` are tried as an alternate naming convention for `in`/`out`.
 */
function extractNetworkGauge(root: Record<string, unknown>, direction: 'in' | 'out'): GaugeValue {
  const primary = direction;
  const alt = direction === 'in' ? 'rx' : 'tx';

  const seriesKeys =
    direction === 'in' ? ['network_download', 'network_in'] : ['network_upload', 'network_out'];
  const parsed = readSeries(root, seriesKeys);
  if (parsed !== undefined) {
    return { percent: undefined, label: formatRate(parsed.latest), series: parsed.series };
  }

  const explicitPercent = getPath(root, ['network', primary, 'percent']);
  if (explicitPercent !== undefined) {
    return percentFromScalar(explicitPercent, false);
  }

  const rate = readFiniteNonNegative(
    firstDefinedValue(root, [
      ['network', `${primary}_bytes_per_sec`],
      ['network', `${alt}_bytes_per_sec`],
      ['network', primary, 'current'],
    ]),
  );
  const limit = readFiniteNonNegative(
    firstDefinedValue(root, [
      ['network', `${primary}_limit_bytes`],
      ['network', `${alt}_limit_bytes`],
      ['network', primary, 'limit'],
    ]),
  );

  if (rate !== undefined && limit !== undefined && limit > 0) {
    return percentGauge((rate / limit) * 100);
  }
  if (rate !== undefined) {
    return { percent: undefined, label: formatRate(rate) };
  }

  const cumulative = readFiniteNonNegative(
    firstDefinedValue(root, [
      ['network', `${primary}_bytes`],
      ['network', `${alt}_bytes`],
      ['network', primary, 'total'],
    ]),
  );
  if (cumulative !== undefined) {
    return { percent: undefined, label: `${formatBytes(cumulative)} total` };
  }

  return unavailableGauge();
}

/**
 * The `service metrics` payload also carries a recent-jobs list, but it is not
 * rendered here — the Recent Jobs tree owns that surface and parses the richer
 * `service jobs` payload via src/jobs/normalize.ts.
 */
export function normalizeMetrics(data: unknown): MetricsViewModel {
  if (!isRecord(data)) {
    return {
      cpu: unavailableGauge(),
      memory: unavailableGauge(),
      networkIn: unavailableGauge(),
      networkOut: unavailableGauge(),
      unavailable: true,
    };
  }

  const cpu = extractCpuGauge(data);
  const memory = extractMemoryGauge(data);
  const networkIn = extractNetworkGauge(data, 'in');
  const networkOut = extractNetworkGauge(data, 'out');

  const allUnavailable = [cpu, memory, networkIn, networkOut].every(
    (gauge) => gauge.percent === undefined && gauge.label === 'unavailable',
  );

  return { cpu, memory, networkIn, networkOut, unavailable: allUnavailable };
}
