import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../src/webview/htmlEscape';
import { buildMetricsHtml } from '../src/metrics/metricsHtml';
import type { MetricsViewModel } from '../src/metrics/normalize';
import { buildLogsHtml } from '../src/logs/logsHtml';
import { buildLoadingHtml } from '../src/webview/htmlShell';
import type { LogsViewModel } from '../src/logs/normalize';

const CSP_TAG =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">';

const unavailableGauge = { percent: undefined, label: 'unavailable' };

function metricsModel(overrides: Partial<MetricsViewModel> = {}): MetricsViewModel {
  return {
    cpu: unavailableGauge,
    memory: unavailableGauge,
    networkIn: unavailableGauge,
    networkOut: unavailableGauge,
    unavailable: false,
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes &, <, >, ", and \'', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('server listening on :8080')).toBe('server listening on :8080');
  });
});

describe('buildMetricsHtml', () => {
  it('includes the CSP meta tag verbatim and no script tag', () => {
    const html = buildMetricsHtml(undefined, undefined);
    expect(html).toContain(CSP_TAG);
    expect(html).not.toContain('<script');
  });

  it('shows a "select a service" state with no serviceName', () => {
    const html = buildMetricsHtml(undefined, undefined);
    expect(html).toContain('Select a service');
  });

  it('shows an "unavailable" state when the model is unavailable', () => {
    const html = buildMetricsHtml(metricsModel({ unavailable: true }), 'api');
    expect(html).toContain('Metrics unavailable');
  });

  it('never renders "<script" for a malicious service name', () => {
    // The panel no longer prints the service name at all (the sidebar section
    // header already says it), so a hostile name reaches the document in
    // neither raw nor escaped form.
    const html = buildMetricsHtml(metricsModel(), '<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('clamps the gauge fill width to 0-100 in the emitted style attribute', () => {
    const over = buildMetricsHtml(metricsModel({ cpu: { percent: 150, label: 'x' } }), 'api');
    expect(over).toContain('width:100%');
    expect(over).not.toContain('width:150%');

    const under = buildMetricsHtml(metricsModel({ cpu: { percent: -20, label: 'x' } }), 'api');
    expect(under).not.toContain('width:-20%');
  });

  it('emits a <polyline> sparkline for a gauge with a 2+ point series', () => {
    const html = buildMetricsHtml(
      metricsModel({ cpu: { percent: 42, label: '42%', series: [10, 20, 15] } }),
      'api',
    );
    expect(html).toContain('<svg');
    expect(html).toContain('<polyline');
  });

  it('never renders a <script> tag, even with sparkline series present', () => {
    const html = buildMetricsHtml(
      metricsModel({
        cpu: { percent: 42, label: '42%', series: [1, 2, 3] },
        memory: { percent: undefined, label: '1 MB', series: [1, 2, 3] },
      }),
      'api',
    );
    expect(html).not.toContain('<script');
  });

  it('never emits NaN into the markup for a valid series', () => {
    const html = buildMetricsHtml(
      metricsModel({ cpu: { percent: 42, label: '42%', series: [1, 2, 3, 4, 5] } }),
      'api',
    );
    expect(html).not.toContain('NaN');
  });

  it('does not crash and does not emit NaN for a flat series (all values equal)', () => {
    const html = buildMetricsHtml(
      metricsModel({ memory: { percent: undefined, label: '10 MB', series: [500, 500, 500] } }),
      'api',
    );
    expect(html).toContain('<polyline');
    expect(html).not.toContain('NaN');
  });

  it('does not emit a sparkline for a single-point series', () => {
    const html = buildMetricsHtml(
      metricsModel({ networkIn: { percent: undefined, label: '1 B/s', series: [1] } }),
      'api',
    );
    const gaugeSection = html.slice(html.indexOf('Network In'));
    expect(gaugeSection).not.toContain('<polyline');
  });

  it('does not emit a sparkline when the gauge has no series', () => {
    const html = buildMetricsHtml(metricsModel({ cpu: { percent: 42, label: '42%' } }), 'api');
    expect(html).not.toContain('<polyline');
  });
});

describe('buildLogsHtml', () => {
  const availableModel: LogsViewModel = { lines: [], unavailable: false };

  it('includes the CSP meta tag verbatim and no script tag', () => {
    const html = buildLogsHtml(undefined, undefined);
    expect(html).toContain(CSP_TAG);
    expect(html).not.toContain('<script');
  });

  it('shows a "select a service" state with no serviceName', () => {
    const html = buildLogsHtml(undefined, undefined);
    expect(html).toContain('Select a service');
  });

  it('shows an "unavailable" state when the model is unavailable', () => {
    const html = buildLogsHtml({ lines: [], unavailable: true }, 'api');
    expect(html).toContain('Logs unavailable');
  });

  it('shows an empty state when there are no lines', () => {
    const html = buildLogsHtml(availableModel, 'api');
    expect(html).toContain('No log lines in the last hour');
  });

  it('never renders "<script" for a malicious log line, and escapes it instead', () => {
    const html = buildLogsHtml(
      { lines: [{ raw: '<script>alert(1)</script>' }], unavailable: false },
      'api',
    );
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('tints stderr lines with a distinct marker', () => {
    const html = buildLogsHtml(
      { lines: [{ raw: 'boom', stream: 'stderr' }], unavailable: false },
      'api',
    );
    expect(html).toContain('log-line--stderr');
  });
});

describe('buildLoadingHtml', () => {
  it('shows the message with a spinner and the CSP tag, and no script', () => {
    const html = buildLoadingHtml('Loading metrics…');
    expect(html).toContain(CSP_TAG);
    expect(html).not.toContain('<script');
    expect(html).toContain('Loading metrics');
    expect(html).toContain('class="spinner"');
    expect(html).toContain('@keyframes partiri-spin');
  });

  it('escapes the message', () => {
    const html = buildLoadingHtml('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('monitoring layout', () => {
  it('renders one combined network chart with two differently coloured lines', () => {
    const html = buildMetricsHtml(
      metricsModel({
        networkIn: { percent: undefined, label: '46 B/s', series: [1, 5, 3] },
        networkOut: { percent: undefined, label: '24 B/s', series: [2, 2, 8] },
      }),
      'api',
    );
    const svgCount = (html.match(/<svg/g) ?? []).length;
    expect(svgCount).toBe(1);
    expect((html.match(/<polyline/g) ?? []).length).toBe(2);
    expect(html).toContain('var(--vscode-charts-purple)');
    expect(html).toContain('var(--vscode-charts-orange)');
    expect(html).not.toContain('Network In');
    expect(html).not.toContain('Network Out');
    expect(html).not.toContain('NaN');
  });

  // The metrics panel renders no recent-jobs list — the Recent Jobs tree owns
  // that surface. Now enforced structurally: MetricsViewModel has no `jobs`.

  it('does not repeat the service name inside the panel', () => {
    const html = buildMetricsHtml(metricsModel(), 'my-service');
    expect(html).not.toContain('my-service');
  });
});
