import { formatClockTime } from '../util/time';
import { escapeHtml } from '../webview/htmlEscape';
import { documentShell, renderEmptyState } from '../webview/htmlShell';
import type { LogLine, LogsViewModel } from './normalize';

/**
 * Pure HTML string builder for the Logs webview. No `vscode` import, no
 * `<script>` tag, no `script-src` CSP directive — see
 * src/webview/htmlShell.ts for why that's a mechanical guarantee, not a
 * convention. Every dynamic value (service name, timestamp, log text) goes
 * through escapeHtml.
 */

const EXTRA_STYLE = `
  .log-lines {
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .log-line {
    padding: 1px 0;
  }
  .log-timestamp {
    color: var(--vscode-descriptionForeground);
    margin-right: 8px;
  }
  .log-line--stderr .log-text {
    color: var(--vscode-errorForeground);
  }
`;

function renderLogLine(line: LogLine): string {
  const streamClass = line.stream === 'stderr' ? ' log-line--stderr' : '';
  const timestamp =
    line.timestamp !== undefined
      ? `<span class="log-timestamp">${escapeHtml(formatClockTime(line.timestamp))}</span>`
      : '';
  return `<div class="log-line${streamClass}">${timestamp}<span class="log-text">${escapeHtml(line.raw)}</span></div>`;
}

export function buildLogsHtml(
  model: LogsViewModel | undefined,
  serviceName: string | undefined,
): string {
  const body = !serviceName
    ? renderEmptyState('Select a service to view its logs.')
    : !model || model.unavailable
      ? renderEmptyState('Logs unavailable.')
      : model.lines.length === 0
        ? renderEmptyState('No log lines in the last hour.')
        : `<div class="log-lines">${model.lines.map(renderLogLine).join('')}</div>`;

  return documentShell(body, EXTRA_STYLE);
}
