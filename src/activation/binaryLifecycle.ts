/**
 * Resolving the `partiri` binary, and everything that has to happen when the
 * answer changes.
 *
 * Owns the resolved path outright. It used to be a mutable module-level global
 * in extension.ts that activate() wrote and the command registrations read,
 * which made the "is there a CLI yet" question answerable only at runtime and
 * only from that one file.
 */

import * as vscode from 'vscode';
import { checkVersion, findBinary, installGuidance, MIN_CLI_VERSION } from '../cli/discovery';
import { CliVersionTooOldError, handleCliError } from '../cli/errors';
import { offerInstall } from '../commands/installCli';

/** Settings that change the answer, and therefore force a re-resolve. */
export const RELEVANT_SETTINGS = [
  'partiri.binaryPath',
  'partiri.lsp.enabled',
  'partiri.remoteValidation',
];

export interface BinaryResolverDeps {
  lsp: { start(binaryPath: string): Promise<void>; stop(): Promise<void> };
  outputChannel: vscode.OutputChannel;
  /**
   * Fired after the resolved path is updated and before the LSP is started or
   * stopped. `null` means there is no usable CLI — the caller decides what to
   * fan out in each case, because the two differ.
   */
  onResolved: (binaryPath: string | null) => void;

  // Injected for tests; default to the real implementations.
  findBinary?: typeof findBinary;
  checkVersion?: typeof checkVersion;
  readSettings?: () => { binaryPath: string | undefined; lspEnabled: boolean };
  offerInstall?: typeof offerInstall;
  showError?: (message: string) => void;
  handleError?: (error: unknown) => Promise<void>;
}

function defaultReadSettings(): { binaryPath: string | undefined; lspEnabled: boolean } {
  const config = vscode.workspace.getConfiguration('partiri');
  return {
    binaryPath: config.get<string>('binaryPath'),
    lspEnabled: config.get<boolean>('lsp.enabled', true),
  };
}

export class BinaryResolver {
  private binaryPath: string | null = null;

  constructor(private readonly deps: BinaryResolverDeps) {}

  get current(): string | null {
    return this.binaryPath;
  }

  /**
   * Bound getter for the context objects, which are built once at activation
   * and must keep seeing the *current* value rather than capturing `null`.
   */
  readonly getBinaryPath = (): string | null => this.binaryPath;

  async resolve(): Promise<void> {
    const findIt = this.deps.findBinary ?? findBinary;
    const checkIt = this.deps.checkVersion ?? checkVersion;
    const readSettings = this.deps.readSettings ?? defaultReadSettings;
    const install = this.deps.offerInstall ?? offerInstall;
    const showError =
      this.deps.showError ?? ((message: string) => void vscode.window.showErrorMessage(message));
    const handleError = this.deps.handleError ?? handleCliError;

    const { binaryPath: setting, lspEnabled } = readSettings();
    const discovery = await findIt(setting);

    if (!discovery.binaryPath) {
      await this.clear();
      if (discovery.settingInvalid) {
        showError(
          `Partiri: configured binaryPath "${setting}" was not found. Update partiri.binaryPath.`,
        );
      } else {
        void install(installGuidance(process.platform), () => this.resolve());
      }
      return;
    }

    const version = await checkIt(discovery.binaryPath);
    if (!version.meetsMinimum) {
      await this.clear();
      await handleError(new CliVersionTooOldError(version.version ?? 'unknown', MIN_CLI_VERSION));
      return;
    }

    this.binaryPath = discovery.binaryPath;
    this.deps.onResolved(this.binaryPath);

    if (lspEnabled) {
      // A language-server failure must never take down the rest of the
      // extension: tree views, commands, and the status bar all work without
      // it, and an exception here would otherwise reject activate().
      try {
        await this.deps.lsp.start(this.binaryPath);
      } catch (error) {
        this.deps.outputChannel.appendLine(
          `[lsp] failed to start: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      await this.deps.lsp.stop();
    }
  }

  /** No usable CLI: drop the path, stop the language server, tell the caller. */
  private async clear(): Promise<void> {
    this.binaryPath = null;
    await this.deps.lsp.stop();
    this.deps.onResolved(null);
  }
}
