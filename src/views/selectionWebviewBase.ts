import * as vscode from 'vscode';
import type { ServiceDataContext } from '../data/serviceData';
import {
  selectionKey,
  type SelectedService,
  type SelectedServiceStore,
} from '../state/selectedService';
import { buildLoadingHtml, buildMessageHtml } from '../webview/htmlShell';

/**
 * Shown while activation is still resolving the CLI path. Distinct from
 * "unavailable": there is nothing wrong, there is just nothing to run yet.
 */
export const WAITING_FOR_CLI = 'Waiting for the Partiri CLI…';

/**
 * Shared lifecycle for the webview panels that follow the selected service.
 *
 * Every one of them has to: ignore refreshes before the view exists, reset to
 * an empty document when nothing is selected, say so when the binary has not
 * resolved yet, and show a spinner for a *new* selection but not for a
 * background poll tick over content already on screen. Subclasses supply only
 * the fetch-and-render step.
 *
 * Scripts are disabled and the HTML carries a `default-src 'none'` CSP, so
 * these panels cannot execute code or reach the network — which is also what
 * mechanically guarantees the no-telemetry rule (docs/cli-contract.md §10).
 */
export abstract class SelectionWebviewView implements vscode.WebviewViewProvider {
  protected view: vscode.WebviewView | undefined;
  /** Key of the selection whose fetch has already settled (rendered or failed). */
  private settledFor: string | undefined;
  protected readonly subscriptions: vscode.Disposable[] = [];

  protected constructor(
    protected readonly selectedService: SelectedServiceStore,
    protected readonly ctx: ServiceDataContext,
  ) {}

  /** Webview options for this panel — Details needs `enableCommandUris`, the others don't. */
  protected abstract readonly webviewOptions: vscode.WebviewOptions;
  /** Shown with a spinner while the first fetch for a selection is in flight. */
  protected abstract readonly loadingLabel: string;
  /** Document rendered when nothing is selected. */
  protected abstract emptyHtml(): string;
  /** Fetch and render for a selection. MUST NOT throw — failures render as an empty state. */
  protected abstract renderSelection(selection: SelectedService, binaryPath: string): Promise<void>;

  /** Extra listeners to register alongside the shared ones. */
  protected additionalSubscriptions(_view: vscode.WebviewView): vscode.Disposable[] {
    return [];
  }
  protected onSelectionChanged(): void {
    void this.refresh();
  }
  protected onVisibilityChanged(visible: boolean): void {
    if (visible) {
      void this.refresh();
    }
  }
  protected onResolved(): void {}
  protected onDisposed(): void {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = this.webviewOptions;

    this.subscriptions.push(
      this.selectedService.onDidChange(() => this.onSelectionChanged()),
      webviewView.onDidChangeVisibility(() => this.onVisibilityChanged(webviewView.visible)),
      ...this.additionalSubscriptions(webviewView),
    );
    webviewView.onDidDispose(() => {
      this.onDisposed();
      this.view = undefined;
    });

    void this.refresh();
    this.onResolved();
  }

  /**
   * Manual refresh from the section's title bar. Clears the settled marker so
   * the spinner shows again — a click with no visible response reads as broken.
   */
  async reload(): Promise<void> {
    this.settledFor = undefined;
    await this.refresh();
  }

  /** Re-fetch and re-render. Never throws — failures render as an empty state. */
  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const selection = this.selectedService.get();
    if (!selection) {
      this.settledFor = undefined;
      this.setHtml(this.emptyHtml());
      return;
    }

    const binaryPath = this.ctx.getBinaryPath();
    if (!binaryPath) {
      // Leave `settledFor` unset, so the refresh fired once resolution
      // finishes still shows the spinner rather than jumping to content.
      this.setHtml(buildMessageHtml(WAITING_FOR_CLI));
      return;
    }

    // Spinner only when this selection has nothing rendered yet: a background
    // poll tick must not flash "loading" over content the user is reading.
    const key = selectionKey(selection);
    if (this.settledFor !== key) {
      this.setHtml(buildLoadingHtml(this.loadingLabel));
    }

    await this.renderSelection(selection, binaryPath);

    // Settled even when the fetch failed, so a repeatedly failing poll shows
    // the unavailable state rather than flickering back to the spinner.
    this.settledFor = key;
  }

  /** No-op once the view has been disposed, so late async renders can't throw. */
  protected setHtml(html: string): void {
    if (this.view) {
      this.view.webview.html = html;
    }
  }

  dispose(): void {
    this.onDisposed();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }
}
