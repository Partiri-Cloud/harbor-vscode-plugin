import * as vscode from 'vscode';
import {
  fetchServiceData,
  resolveSelectionTarget,
  type ServiceDataContext,
} from '../data/serviceData';
import { normalizeJobs, type ServiceJob } from '../jobs/normalize';
import type { SelectedServiceStore } from '../state/selectedService';

export interface JobNode {
  kind: 'job';
  job: ServiceJob;
}

const FAILED_STATUSES = new Set(['failed', 'error', 'errored', 'cancelled', 'canceled']);
const RUNNING_STATUSES = new Set(['running', 'pending', 'queued', 'in_progress']);

function iconFor(status: string): vscode.ThemeIcon {
  const normalized = status.toLowerCase();
  if (FAILED_STATUSES.has(normalized)) {
    return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
  }
  if (RUNNING_STATUSES.has(normalized)) {
    return new vscode.ThemeIcon('sync');
  }
  return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
}

/** Deploy history for the selected service, via `service jobs`. */
export class RecentJobsTreeProvider implements vscode.TreeDataProvider<JobNode> {
  private readonly emitter = new vscode.EventEmitter<JobNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[];
  private messageSink: ((message: string | undefined) => void) | undefined;

  /** The TreeView owning this provider is created after it, so it wires the sink in. */
  setMessageSink(sink: (message: string | undefined) => void): void {
    this.messageSink = sink;
  }

  constructor(
    private readonly selectedService: SelectedServiceStore,
    private readonly ctx: ServiceDataContext,
  ) {
    this.subscriptions = [selectedService.onDidChange(() => this.refresh())];
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  async getChildren(element?: JobNode): Promise<JobNode[]> {
    if (element) {
      return [];
    }
    const selection = this.selectedService.get();
    const binaryPath = this.ctx.getBinaryPath();
    if (!selection || !binaryPath) {
      return [];
    }
    this.messageSink?.('Loading jobs…');
    try {
      const nodes = await vscode.window.withProgress(
        { location: { viewId: 'partiriRecentJobs' } },
        async () => {
          const target = await resolveSelectionTarget(this.ctx, binaryPath, selection);
          const data = await fetchServiceData(this.ctx, target, ['service', 'jobs']);
          return normalizeJobs(data).map((job) => ({ kind: 'job' as const, job }));
        },
      );
      this.messageSink?.(nodes.length === 0 ? 'No jobs for this service.' : undefined);
      return nodes;
    } catch {
      // A message rather than a notification: this view refreshes on every
      // selection change and should not pop dialogs while the user browses.
      this.messageSink?.('Could not load jobs for this service.');
      return [];
    }
  }

  getTreeItem(element: JobNode): vscode.TreeItem {
    const { job } = element;
    const item = new vscode.TreeItem(
      `${job.type} · ${job.status}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = job.when;
    item.tooltip = job.deployRef
      ? `${job.type} ${job.status}\n${job.when}\nref ${job.deployRef}`
      : `${job.type} ${job.status}\n${job.when}`;
    item.iconPath = iconFor(job.status);
    return item;
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.emitter.dispose();
  }
}
