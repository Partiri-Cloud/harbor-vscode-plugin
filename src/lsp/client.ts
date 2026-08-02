import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node';
import { isExecuteCommandFeature } from './features';

type ClientFeature = Parameters<LanguageClient['registerFeature']>[0];

/**
 * `partiri lsp` advertises its executeCommand ids (partiri.deploy,
 * partiri.pull, partiri.validateRemote, partiri.refreshContext) and the stock
 * ExecuteCommandFeature registers every one of them as a VS Code command.
 * Three of those ids are already contributed natively by this extension, so
 * that registration throws "command already exists" and aborts activation.
 * VS Code drives those actions through native commands and tree views by
 * design (docs/lsp.md), so the feature is dropped: `workspace/executeCommand`
 * requests still work, they just aren't mirrored into the command registry.
 */
class PartiriLanguageClient extends LanguageClient {
  override registerFeature(feature: ClientFeature): void {
    if (isExecuteCommandFeature(feature)) {
      return;
    }
    super.registerFeature(feature);
  }
}

/**
 * Spawns `<binary> lsp` over stdio (docs/lsp.md). One client per editor
 * window, restarted (not just re-configured) whenever the binary path,
 * partiri.lsp.enabled, or partiri.remoteValidation setting changes, or the
 * binary is later found to be too old.
 */
export class PartiriLspClient {
  private client: LanguageClient | undefined;

  async start(binaryPath: string): Promise<void> {
    await this.stop();

    const remoteValidation = vscode.workspace
      .getConfiguration('partiri')
      .get<string>('remoteValidation', 'onSave');

    // No `transport` here on purpose: TransportKind.stdio makes the language
    // client append a `--stdio` argument, which `partiri lsp` rejects — it
    // always speaks stdio and takes no transport flag. Omitting the field
    // still communicates over the child's stdin/stdout.
    const serverOptions: ServerOptions = {
      command: binaryPath,
      args: ['lsp'],
    };

    const clientOptions: LanguageClientOptions = {
      // Both forms: the server does no filename filtering of its own, so this
      // selector is the only gate. Never widen it to plain `.json` — every
      // JSON file in the workspace would then get partiri diagnostics.
      documentSelector: [{ pattern: '**/.partiri.jsonc' }, { pattern: '**/*.partiri.jsonc' }],
      initializationOptions: {
        enableCodeActions: false,
        remoteValidation,
      },
    };

    this.client = new PartiriLanguageClient(
      'partiri',
      'Partiri Language Server',
      serverOptions,
      clientOptions,
    );
    await this.client.start();
  }

  async stop(): Promise<void> {
    if (!this.client) {
      return;
    }
    const client = this.client;
    this.client = undefined;
    await client.stop();
  }

  async restart(binaryPath: string): Promise<void> {
    await this.start(binaryPath);
  }

  async refreshContext(): Promise<void> {
    await this.client?.sendRequest('workspace/executeCommand', {
      command: 'partiri.refreshContext',
    });
  }

  async validateRemote(): Promise<void> {
    await this.client?.sendRequest('workspace/executeCommand', {
      command: 'partiri.validateRemote',
    });
  }

  dispose(): void {
    void this.stop();
  }
}
