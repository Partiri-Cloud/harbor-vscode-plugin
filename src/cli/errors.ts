import * as vscode from 'vscode';
import type { CliErrorPayload } from './envelope';

/** Exit code 1: `error.message` + `error.hint` from a parsed error envelope. */
export class CliInvocationError extends Error {
  constructor(public readonly payload: CliErrorPayload) {
    super(payload.message);
    this.name = 'CliInvocationError';
  }
}

/** Exit code 2: user declined a native confirmation, or the CLI aborted an inquire prompt. Silent. */
export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

export class CliTimeoutError extends Error {
  constructor(public readonly timeoutSeconds: number) {
    super(`partiri CLI timed out after ${timeoutSeconds}s.`);
    this.name = 'CliTimeoutError';
  }
}

export class CliNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliNotFoundError';
  }
}

export class CliVersionTooOldError extends Error {
  constructor(
    public readonly installedVersion: string,
    public readonly minVersion: string,
  ) {
    super(`partiri CLI ${installedVersion} is older than the required ${minVersion}.`);
    this.name = 'CliVersionTooOldError';
  }
}

const RUN_IN_TERMINAL = 'Run in terminal';

/**
 * Render a CliInvocationError as a VS Code error notification: message +
 * hint, with each suggested_command offered as a "run in terminal" button
 * (never auto-executed — docs/cli-contract.md §4).
 */
async function showCliError(error: CliInvocationError): Promise<void> {
  const text = error.payload.hint
    ? `${error.payload.message} ${error.payload.hint}`
    : error.payload.message;

  const suggestions = error.payload.suggested_commands ?? [];
  const choice = await vscode.window.showErrorMessage(
    text,
    ...(suggestions.length > 0 ? [RUN_IN_TERMINAL] : []),
  );

  if (choice !== RUN_IN_TERMINAL || suggestions.length === 0) {
    return;
  }

  const picked =
    suggestions.length === 1
      ? suggestions[0]
      : await vscode.window.showQuickPick(suggestions, {
          placeHolder: 'Select a command to run in the terminal',
        });
  if (!picked) {
    return;
  }
  const terminal = vscode.window.createTerminal('Partiri');
  terminal.show();
  terminal.sendText(picked, false);
}

/**
 * Standard error handling for command handlers: silent on cancellation,
 * envelope-aware rendering for CLI errors, a plain notification otherwise.
 */
export async function handleCliError(error: unknown): Promise<void> {
  if (error instanceof CancelledError) {
    return;
  }
  if (error instanceof CliInvocationError) {
    await showCliError(error);
    return;
  }
  if (
    error instanceof CliTimeoutError ||
    error instanceof CliNotFoundError ||
    error instanceof CliVersionTooOldError
  ) {
    await vscode.window.showErrorMessage(error.message);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  await vscode.window.showErrorMessage(`Partiri: ${message}`);
}
