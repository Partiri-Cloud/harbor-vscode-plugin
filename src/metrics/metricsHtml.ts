import { escapeHtml } from '../webview/htmlEscape';
import { clampPercent, documentShell, renderEmptyState } from '../webview/htmlShell';
import type { GaugeValue, MetricsViewModel } from './normalize';

/**
 * Pure HTML string builder for the Monitoring webview. No `vscode` import,
 * no `<script>` tag, no `script-src` CSP directive — see
 * src/webview/htmlShell.ts for why that's a mechanical guarantee, not a
 * convention. Every dynamic value (service name, gauge labels, job fields)
 * goes through escapeHtml.
 */

const EXTRA_STYLE = `
  .gauge { margin-bottom: 16px; }
  .gauge-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 8px;
  }
  .gauge-name {
    text-transform: uppercase;
    font-variant: small-caps;
    letter-spacing: 0.05em;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  .gauge-value {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .gauge-track {
    height: 6px;
    border-radius: 3px;
    border: 1px solid var(--vscode-panel-border);
    overflow: hidden;
  }
  .gauge-fill {
    height: 100%;
  }
  .legend {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 10px;
    font-variant-numeric: tabular-nums;
  }
  .legend-swatch {
    display: inline-block;
    width: 8px;
    height: 2px;
  }
  .sparkline {
    display: block;
    width: 100%;
    height: 28px;
    margin-top: 4px;
  }
`;

const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 28;
const NETWORK_IN_COLOR = 'var(--vscode-charts-purple)';
const NETWORK_OUT_COLOR = 'var(--vscode-charts-orange)';

/**
 * Inline `<svg><polyline>` sparkline for a gauge's history. No `<script>`, no
 * external refs — CSP is `default-src 'none'` and webviews run with
 * `enableScripts: false`, so an inline vector element is the only way to show
 * history.
 */
function renderSparkline(series: number[] | undefined, strokeColorVar: string): string {
  if (series === undefined) {
    return '';
  }
  // Scaled to this series' own extremes — unlike the network chart, which
  // shares one scale across both of its lines.
  const line = polylineFor(series, Math.min(...series), Math.max(...series), strokeColorVar);
  return line ? wrapSparklineSvg(line) : '';
}

function wrapSparklineSvg(lines: string): string {
  return `<svg class="sparkline" viewBox="0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}" preserveAspectRatio="none">${lines}</svg>`;
}

/**
 * The bar is rendered ONLY when a real percentage exists. Memory and network
 * arrive without any limit in the payload, so there is no denominator — an
 * empty track would read as "0% used", which is a claim we cannot make. Those
 * metrics show their value and trend line instead.
 */
function renderGauge(name: string, gauge: GaugeValue, fillColorVar: string): string {
  const track =
    typeof gauge.percent === 'number'
      ? `<div class="gauge-track"><div class="gauge-fill" style="width:${clampPercent(gauge.percent)}%;background:${fillColorVar};"></div></div>`
      : '';
  return `
    <div class="gauge">
      <div class="gauge-row">
        <span class="gauge-name">${escapeHtml(name)}</span>
        <span class="gauge-value">${escapeHtml(gauge.label)}</span>
      </div>
      ${track}
      ${renderSparkline(gauge.series, fillColorVar)}
    </div>`;
}

/**
 * Both network directions share one chart so they can be read against each
 * other. That only means anything if they share a scale, so the min/max is
 * computed across BOTH series rather than per-line — otherwise a quiet
 * upload would be drawn as tall as a busy download.
 */
function renderNetworkChart(model: MetricsViewModel): string {
  const inSeries = model.networkIn.series ?? [];
  const outSeries = model.networkOut.series ?? [];
  const combined = [...inSeries, ...outSeries];
  if (combined.length === 0) {
    return '';
  }

  const min = Math.min(...combined);
  const max = Math.max(...combined);
  const lines = [
    polylineFor(inSeries, min, max, NETWORK_IN_COLOR),
    polylineFor(outSeries, min, max, NETWORK_OUT_COLOR),
  ].join('');
  if (!lines) {
    return '';
  }
  return wrapSparklineSvg(lines);
}

/**
 * One `<polyline>` normalised to the given min→max. A flat series
 * (min === max) renders as a flat midline instead of dividing by zero, and
 * every coordinate is checked finite before being written into the markup —
 * a `NaN` in a `points` attribute silently blanks the whole chart.
 */
function polylineFor(series: number[], min: number, max: number, color: string): string {
  if (series.length < 2) {
    return '';
  }
  const range = max - min;
  const points: string[] = [];
  for (const [index, value] of series.entries()) {
    const x = (index / (series.length - 1)) * SPARKLINE_WIDTH;
    const y =
      range > 0
        ? SPARKLINE_HEIGHT - ((value - min) / range) * SPARKLINE_HEIGHT
        : SPARKLINE_HEIGHT / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return '';
    }
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `<polyline points="${escapeHtml(points.join(' '))}" stroke="${escapeHtml(color)}" fill="none" vector-effect="non-scaling-stroke" />`;
}

function legend(color: string, text: string): string {
  return `<span class="legend"><span class="legend-swatch" style="background:${escapeHtml(color)};"></span>${escapeHtml(text)}</span>`;
}

function renderNetwork(model: MetricsViewModel): string {
  return `
    <div class="gauge">
      <div class="gauge-row">
        <span class="gauge-name">Network</span>
        <span class="gauge-value">${legend(NETWORK_IN_COLOR, `↓ ${model.networkIn.label}`)}${legend(NETWORK_OUT_COLOR, `↑ ${model.networkOut.label}`)}</span>
      </div>
      ${renderNetworkChart(model)}
    </div>`;
}

function renderMetricsBody(model: MetricsViewModel): string {
  return `
    ${renderGauge('CPU', model.cpu, 'var(--vscode-charts-blue)')}
    ${renderGauge('Memory', model.memory, 'var(--vscode-charts-green)')}
    ${renderNetwork(model)}`;
}

export function buildMetricsHtml(
  model: MetricsViewModel | undefined,
  serviceName: string | undefined,
): string {
  const body = !serviceName
    ? renderEmptyState('Select a service to view its metrics.')
    : !model || model.unavailable
      ? renderEmptyState('Metrics unavailable.')
      : renderMetricsBody(model);

  return documentShell(body, EXTRA_STYLE);
}
