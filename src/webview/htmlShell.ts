import { escapeHtml } from './htmlEscape';

/**
 * Shared HTML document shell for webview panels (Monitoring, Logs). Pure,
 * no vscode import. Centralizes the CSP tag and base styling so it's
 * written exactly once — every embedded value still goes through
 * escapeHtml at each call site, this module only owns the skeleton.
 */

// No `script-src` directive under `default-src 'none'` makes script
// execution structurally impossible — the mechanical guarantee behind the
// no-telemetry rule in docs/cli-contract.md §10. Never add a <script> tag
// or a script-src value to either webview.
export const CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline';";

const BASE_STYLE = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    font-family: var(--vscode-font-family);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    font-size: 13px;
  }
  .empty-state {
    color: var(--vscode-descriptionForeground);
    padding: 16px 0;
  }
  .loading-state {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--vscode-descriptionForeground);
    padding: 16px 0;
  }
  /* CSS-only: these panels run with enableScripts: false, so an animated
     border is the only way to show motion. */
  .spinner {
    width: 12px;
    height: 12px;
    flex: none;
    border: 1.5px solid var(--vscode-panel-border);
    border-top-color: var(--vscode-progressBar-background);
    border-radius: 50%;
    animation: partiri-spin 0.8s linear infinite;
  }
  @keyframes partiri-spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: none; }
  }
`;

/**
 * Wrap `bodyHtml` in a full document with the CSP meta tag and shared base
 * styles. `extraStyle` lets a caller append builder-specific rules (gauge
 * bars, monospace log lines) without duplicating the shell itself.
 *
 * Deliberately renders no service-name heading: the panel already sits under
 * its own titled section in the sidebar, so a heading inside it just repeats
 * what the section header says and costs vertical space.
 */
export function documentShell(bodyHtml: string, extraStyle: string = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<style>${BASE_STYLE}${extraStyle}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/** A dimmed placeholder message for the no-selection/unavailable/empty states. */
export function renderEmptyState(message: string): string {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

/** Full document showing a single dimmed message and nothing else. */
export function buildMessageHtml(message: string): string {
  return documentShell(renderEmptyState(message));
}

/** Full loading document: spinner + message, shown while the first fetch runs. */
export function buildLoadingHtml(message: string): string {
  return documentShell(
    `<div class="loading-state"><span class="spinner"></span><span>${escapeHtml(message)}</span></div>`,
  );
}

/**
 * Clamp a percent-ish number into the legal 0-100 range for a CSS width.
 * Never fabricates a value: pass 0 (indeterminate) when there is nothing to
 * show, regardless of what an out-of-range upstream value tried to render.
 */
export function clampPercent(percent: number | undefined): number {
  return percent === undefined ? 0 : Math.max(0, Math.min(100, percent));
}
