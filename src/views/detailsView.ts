import * as vscode from 'vscode';
import {
  fetchServiceData,
  resolveSelectionTarget,
  type ServiceDataContext,
} from '../data/serviceData';
import { buildDetailsHtml } from '../details/detailsHtml';
import type { ContextStore } from '../state/contextStore';
import { extractServiceRecord, findServiceDetails } from '../state/serviceDetails';
import {
  selectedServiceId,
  type SelectedService,
  type SelectedServiceStore,
} from '../state/selectedService';
import { SelectionWebviewView } from './selectionWebviewBase';

/** Only these three can be invoked from the panel's `command:` links. */
const ALLOWED_COMMANDS = ['partiri.deploy', 'partiri.pause', 'partiri.unpause'];

/**
 * Identity of the selected service plus the actions available on it. A webview
 * rather than a tree so the actions can be real buttons, using `command:` links
 * under an allowlist — no scripts are enabled.
 */
export class DetailsViewProvider extends SelectionWebviewView {
  constructor(
    private readonly contextStore: ContextStore,
    selectedService: SelectedServiceStore,
    ctx: ServiceDataContext,
  ) {
    super(selectedService, ctx);
  }

  protected readonly webviewOptions: vscode.WebviewOptions = {
    enableScripts: false,
    enableCommandUris: ALLOWED_COMMANDS,
  };

  protected readonly loadingLabel = 'Loading details…';

  /** Its own empty document rather than a bare message — the panel keeps its chrome. */
  protected emptyHtml(): string {
    return buildDetailsHtml(undefined, undefined, undefined, false);
  }

  /** Details is the one panel that also re-renders when `llm context` changes. */
  protected override additionalSubscriptions(): vscode.Disposable[] {
    return [this.contextStore.onDidChange(() => void this.refresh())];
  }

  /**
   * Manual refresh from the section's title bar: drop the cached `llm context`
   * as well, so an explicit click really does re-read everything rather than
   * replaying the 5-minute cache.
   */
  override async reload(): Promise<void> {
    this.contextStore.invalidate();
    await super.reload();
  }

  /** Never throws: any failure falls back to whatever could still be resolved. */
  protected async renderSelection(selection: SelectedService, binaryPath: string): Promise<void> {
    const serviceId = selectedServiceId(selection);
    const context = await this.contextStore.get().catch(() => null);
    const details = findServiceDetails(context, serviceId);

    // The richest server-side record (id, external URL, deploy tag) only comes
    // back inside the metrics payload — there is no `service show` command.
    let record;
    try {
      const target = await resolveSelectionTarget(this.ctx, binaryPath, selection);
      record = extractServiceRecord(
        await fetchServiceData(this.ctx, target, ['service', 'metrics']),
      );
    } catch {
      record = undefined;
    }

    this.setHtml(buildDetailsHtml(selection.name, details, record, serviceId !== undefined));
  }
}
