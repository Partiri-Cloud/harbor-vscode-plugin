import { escapeHtml } from '../webview/htmlEscape';
import { documentShell, renderEmptyState } from '../webview/htmlShell';
import type { ServiceDetails, ServiceRecord } from '../state/serviceDetails';

/**
 * Pure HTML builder for the Details panel: what the selected service is, and
 * the actions you can take on it.
 *
 * Buttons are plain `command:` links, not scripted handlers — the webview runs
 * with `enableScripts: false` and an `enableCommandUris` allowlist of exactly
 * the three action commands, so no JavaScript is involved and nothing else can
 * be invoked from this document.
 */

const EXTRA_STYLE = `
  .title {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 2px;
    word-break: break-word;
  }
  .subtitle {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    margin-bottom: 14px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
  }
  .action {
    flex: 1 1 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 3px;
    font-size: 12px;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    border: 1px solid var(--vscode-contrastBorder, transparent);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .action:hover {
    background: var(--vscode-button-secondaryHoverBackground);
    filter: brightness(1.15);
  }
  .action:active { transform: translateY(1px); }
  .action svg { flex: none; }
  .action--primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .action--primary:hover { background: var(--vscode-button-hoverBackground); }
  /* Pause stops live traffic, so it reads as a caution, not a neutral option. */
  .action--caution {
    border-color: var(--vscode-editorWarning-foreground);
    color: var(--vscode-editorWarning-foreground);
  }
  .actions-hint {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    margin-bottom: 18px;
  }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px; }
  .fact-key {
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
  }
  .fact-value { word-break: break-all; }
  .fact-value a { color: var(--vscode-textLink-foreground); }
`;

// Inline SVG rather than codicons: the panel loads no external resources, so
// icons have to be part of the document itself.
function icon(paths: string): string {
  return `<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">${paths}</svg>`;
}

const ICON_DEPLOY = icon('<path d="M8 1 L13 7 H10.2 V14 H5.8 V7 H3 Z" />');
const ICON_PAUSE = icon(
  '<rect x="4" y="3" width="3" height="10" /><rect x="9" y="3" width="3" height="10" />',
);
const ICON_UNPAUSE = icon('<path d="M5 3 L13 8 L5 13 Z" />');
const ICON_SHIELD = icon(
  '<path d="M8 1.5 L13 3.5 V8 c0 3-2.2 5.3-5 6.5 -2.8-1.2-5-3.5-5-6.5 V3.5 Z" opacity="0.85" />',
);

interface ActionSpec {
  commandId: string;
  label: string;
  iconSvg: string;
  /** Surfaced as the button tooltip so the consequence is readable before clicking. */
  consequence: string;
  variant: 'primary' | 'caution' | 'neutral';
}

const DEPLOY: ActionSpec = {
  commandId: 'partiri.deploy',
  label: 'Deploy',
  iconSvg: ICON_DEPLOY,
  consequence: 'Restarts the service and consumes balance. You will be asked to confirm.',
  variant: 'primary',
};

const PAUSE: ActionSpec = {
  commandId: 'partiri.pause',
  label: 'Pause',
  iconSvg: ICON_PAUSE,
  consequence: 'Stops the service serving traffic until unpaused. You will be asked to confirm.',
  variant: 'caution',
};

const UNPAUSE: ActionSpec = {
  commandId: 'partiri.unpause',
  label: 'Unpause',
  iconSvg: ICON_UNPAUSE,
  consequence: 'Resumes serving traffic.',
  variant: 'neutral',
};

function action(spec: ActionSpec): string {
  const variantClass =
    spec.variant === 'primary'
      ? ' action--primary'
      : spec.variant === 'caution'
        ? ' action--caution'
        : '';
  return `<a class="action${variantClass}" role="button" href="command:${escapeHtml(spec.commandId)}" title="${escapeHtml(spec.consequence)}">${spec.iconSvg}<span>${escapeHtml(spec.label)}</span></a>`;
}

/** Pause/unpause act on a service that exists remotely, so they need an id. */
function renderActions(hasServiceId: boolean): string {
  const specs = hasServiceId ? [DEPLOY, PAUSE, UNPAUSE] : [DEPLOY];
  return `
    <div class="actions">${specs.map(action).join('')}</div>
    <div class="actions-hint">${ICON_SHIELD}<span>Each action asks you to confirm first.</span></div>`;
}

function fact(key: string, value: string | undefined, asLink = false): string {
  if (!value) {
    return '';
  }
  const safe = escapeHtml(value);
  const rendered = asLink && /^https?:\/\//i.test(value) ? `<a href="${safe}">${safe}</a>` : safe;
  return `<div class="fact-key">${escapeHtml(key)}</div><div class="fact-value">${rendered}</div>`;
}

export function buildDetailsHtml(
  serviceName: string | undefined,
  details: ServiceDetails | undefined,
  record: ServiceRecord | undefined,
  hasServiceId: boolean,
): string {
  if (!serviceName) {
    return documentShell(renderEmptyState('Select a service to see its details.'), EXTRA_STYLE);
  }

  const name = details?.name ?? serviceName;
  const subtitleParts = [details?.deployType, details?.runtime].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  const subtitle = subtitleParts.length
    ? `<div class="subtitle">${escapeHtml(subtitleParts.join(' · '))}</div>`
    : '';

  // Every row is conditional: absent fields are omitted rather than rendered
  // blank, so the panel only ever states things that are actually populated.
  const facts = [
    fact('Region', details?.region),
    fact('Pod', details?.pod),
    fact('Project', details?.project),
    fact('Workspace', details?.workspace),
    fact('ID', record?.id),
    fact('Internal', record?.internalUrl, true),
    fact('External', record?.externalUrl, true),
    fact('Custom', record?.customUrl, true),
  ].join('');

  const body = `
    <div class="title">${escapeHtml(name)}</div>
    ${subtitle}
    ${renderActions(hasServiceId)}
    ${facts ? `<div class="facts">${facts}</div>` : ''}
    ${!facts && !details ? renderEmptyState('Not created on Partiri yet.') : ''}`;

  return documentShell(body, EXTRA_STYLE);
}
