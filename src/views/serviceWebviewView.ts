import * as vscode from 'vscode';
import {
  fetchServiceData,
  resolveSelectionTarget,
  type ServiceDataContext,
} from '../data/serviceData';
import type { SelectedService, SelectedServiceStore } from '../state/selectedService';
import { MAX_CONSECUTIVE_WATCH_FAILURES, Poller } from '../util/poller';
import { SelectionWebviewView } from './selectionWebviewBase';

export interface ServiceWebviewConfig<TModel> {
  /** Read-only CLI subcommand, e.g. ['service', 'metrics']. */
  args: string[];
  normalize: (data: unknown) => TModel;
  build: (model: TModel | undefined, serviceName: string | undefined) => string;
  /** Shown with a spinner while the first fetch for a selection is in flight. */
  loadingLabel: string;
}

/**
 * The Monitoring and Logs panels: a selection-following webview that polls a
 * read-only subcommand and re-renders the whole document.
 *
 * Polling mirrors the log-watch policy in serviceActions.ts: every 30s, giving
 * up after 3 consecutive failures rather than retrying forever, and pausing
 * entirely while the view is hidden. The failure count covers every refresh,
 * not just timer ticks, so a panel that cannot load also stops polling.
 */
export class ServiceWebviewViewProvider<TModel> extends SelectionWebviewView {
  private readonly poller = new Poller(() => this.refresh());
  private failures = 0;

  constructor(
    selectedService: SelectedServiceStore,
    ctx: ServiceDataContext,
    private readonly config: ServiceWebviewConfig<TModel>,
  ) {
    super(selectedService, ctx);
  }

  protected readonly webviewOptions: vscode.WebviewOptions = { enableScripts: false };

  protected get loadingLabel(): string {
    return this.config.loadingLabel;
  }

  protected emptyHtml(): string {
    return this.config.build(undefined, undefined);
  }

  protected override onSelectionChanged(): void {
    this.failures = 0;
    void this.refresh();
  }

  protected override onVisibilityChanged(visible: boolean): void {
    if (visible) {
      void this.refresh();
      this.poller.start();
    } else {
      this.poller.stop();
    }
  }

  protected override onResolved(): void {
    this.poller.start();
  }

  protected override onDisposed(): void {
    this.poller.stop();
  }

  override async reload(): Promise<void> {
    this.failures = 0;
    await super.reload();
  }

  protected async renderSelection(selection: SelectedService, binaryPath: string): Promise<void> {
    try {
      const target = await resolveSelectionTarget(this.ctx, binaryPath, selection);
      const data = await fetchServiceData(this.ctx, target, this.config.args);
      this.failures = 0;
      this.setHtml(this.config.build(this.config.normalize(data), selection.name));
    } catch {
      // Rendered as an empty state rather than a notification: a panel that is
      // polling should not pop a dialog on every tick.
      this.failures += 1;
      if (this.failures >= MAX_CONSECUTIVE_WATCH_FAILURES) {
        this.poller.stop();
      }
      this.setHtml(this.config.build(undefined, selection.name));
    }
  }
}
