/**
 * Escape a string for safe interpolation into HTML text/attribute content.
 * Pure, no imports — shared by every webview HTML builder so untrusted CLI
 * output (log lines, labels, service names) can never break out of the
 * markup it's placed in.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
