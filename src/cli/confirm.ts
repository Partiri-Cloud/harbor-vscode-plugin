import * as vscode from 'vscode';

/**
 * Destructive-op confirmation matrix (docs/cli-contract.md §6). Confirmation
 * always happens via a native IDE dialog *before* the subprocess is spawned;
 * only after confirmation does the caller append -y.
 */
export type DestructiveOperation =
  | 'deploy'
  | 'kill'
  | 'pause'
  | 'unpause'
  | 'push'
  | 'envReplace'
  | 'storageDetach'
  | 'storageDelete';

type ConfirmLevel = 'none' | 'confirm' | 'danger';

interface MatrixEntry {
  level: ConfirmLevel;
  title: string;
  detail: string;
}

const MATRIX: Record<DestructiveOperation, MatrixEntry> = {
  deploy: {
    level: 'confirm',
    title: 'Deploy this service?',
    detail: 'Restarts the service, consumes balance.',
  },
  kill: {
    level: 'danger',
    title: 'Kill this service?',
    detail: 'This is irreversible.',
  },
  pause: {
    level: 'confirm',
    title: 'Pause this service?',
    detail: 'The service will stop serving traffic until unpaused.',
  },
  unpause: {
    level: 'none',
    title: 'Unpause this service?',
    detail: '',
  },
  push: {
    level: 'confirm',
    title: 'Push config to this service?',
    detail: 'This updates the live service configuration.',
  },
  envReplace: {
    level: 'confirm',
    title: 'Replace environment variables?',
    detail: 'REPLACES ALL env vars.',
  },
  storageDetach: {
    level: 'confirm',
    title: 'Detach this volume?',
    detail: 'The volume will be detached from its service.',
  },
  storageDelete: {
    level: 'confirm',
    title: 'Delete this volume?',
    detail: 'This permanently deletes the volume. The volume must already be detached.',
  },
};

export interface ConfirmDestructiveOptions {
  /** Only meaningful for 'push': an extra, stronger warning when the disk block changed. */
  diskChanged?: boolean;
}

const CONFIRM_LABEL = 'Confirm';
const DANGER_LABEL = 'Yes, do it';

/**
 * Show the native confirmation dialog required for a destructive operation.
 * Resolves true only when the user explicitly confirmed; false for "no
 * confirmation needed" ops resolves true immediately without a dialog.
 */
export async function confirmDestructive(
  operation: DestructiveOperation,
  options: ConfirmDestructiveOptions = {},
): Promise<boolean> {
  const entry = MATRIX[operation];
  if (entry.level === 'none') {
    return true;
  }

  let detail = entry.detail;
  if (operation === 'push' && options.diskChanged) {
    detail = `${detail} Disk changes are not applied by push — run 'partiri storage create' (new volume) or 'partiri storage update' (grow/remount) afterward.`;
  }

  const confirmLabel = entry.level === 'danger' ? DANGER_LABEL : CONFIRM_LABEL;
  const choice = await vscode.window.showWarningMessage(
    entry.title,
    { modal: true, detail },
    confirmLabel,
  );
  return choice === confirmLabel;
}
