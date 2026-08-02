import * as vscode from 'vscode';
import { BinaryResolver, RELEVANT_SETTINGS } from './activation/binaryLifecycle';
import { ConfigSelectionPolicy } from './activation/selectionPolicy';
import { registerCommands } from './commands/register';
import type { ResourceActionContext } from './commands/resourceActions';
import { disposeAllWatches, type ServiceActionContext } from './commands/serviceActions';
import { buildLogsHtml } from './logs/logsHtml';
import { normalizeLogs } from './logs/normalize';
import { PartiriLspClient } from './lsp/client';
import { buildMetricsHtml } from './metrics/metricsHtml';
import { normalizeMetrics } from './metrics/normalize';
import { ContextStore } from './state/contextStore';
import { defaultInvocationTarget } from './state/defaultTarget';
import { LinkedServicesIndex } from './state/linkedServices';
import { SelectedServiceStore } from './state/selectedService';
import { PartiriStatusBar } from './status/statusBar';
import { DetailsViewProvider } from './views/detailsView';
import { configLabel, LocalConfigsTreeProvider } from './views/localConfigsTree';
import { RecentJobsTreeProvider } from './views/recentJobsTree';
import { ResourcesTreeProvider } from './views/resourcesTree';
import { ServiceWebviewViewProvider } from './views/serviceWebviewView';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('Partiri');
  context.subscriptions.push(outputChannel);

  const linkedServices = new LinkedServicesIndex();
  context.subscriptions.push(linkedServices);
  // Start the scan but do NOT await it: activation must reach the view
  // registrations below promptly, or VS Code renders "There is no data provider
  // registered" for a view it has been told about but not yet given a provider.
  // The tree awaits this same promise and shows its own "Searching…" state.
  const initialScan = linkedServices.refresh();

  const selectedService = new SelectedServiceStore();
  context.subscriptions.push(selectedService);

  const lspClient = new PartiriLspClient();
  context.subscriptions.push({ dispose: () => void lspClient.dispose() });

  // Declared before the resolver so its callbacks can close over the views,
  // and before the stores so they can read the resolved path lazily.
  let onBinaryResolved: (binaryPath: string | null) => void = () => {};
  const resolver = new BinaryResolver({
    lsp: lspClient,
    outputChannel,
    onResolved: (binaryPath) => onBinaryResolved(binaryPath),
  });

  const contextStore = new ContextStore(resolver.getBinaryPath, defaultInvocationTarget);
  context.subscriptions.push(contextStore);

  const serviceActionCtx: ServiceActionContext = {
    getBinaryPath: resolver.getBinaryPath,
    globalStorageDir: context.globalStorageUri.fsPath,
    linkedServices,
    contextStore,
    outputChannel,
  };
  const resourceActionCtx: ResourceActionContext = {
    getBinaryPath: resolver.getBinaryPath,
    contextStore,
    refreshLsp: () => lspClient.refreshContext(),
  };

  const resourcesTree = new ResourcesTreeProvider(contextStore, linkedServices);
  const localConfigsTree = new LocalConfigsTreeProvider(linkedServices);

  // createTreeView (not registerTreeDataProvider) so selection drives the
  // Details, Monitoring, Recent Jobs, and Logs sections below, and so the
  // `message` used for the loading/empty/error text is available.
  const localConfigsView = vscode.window.createTreeView('partiriLocalConfigs', {
    treeDataProvider: localConfigsTree,
  });
  const resourcesView = vscode.window.createTreeView('partiriResources', {
    treeDataProvider: resourcesTree,
  });
  context.subscriptions.push(
    resourcesTree,
    localConfigsTree,
    localConfigsView,
    resourcesView,
    localConfigsView.onDidChangeSelection((event) => {
      const node = event.selection[0];
      // Folder rows are grouping only — selecting one changes nothing.
      if (node?.kind === 'config') {
        selectedService.select({
          kind: 'localConfig',
          folder: node.config.folder,
          configPath: node.config.configPath,
          serviceId: node.config.id,
          name: configLabel(node.config.configPath),
        });
      }
    }),
    resourcesView.onDidChangeSelection((event) => {
      const node = event.selection[0];
      if (node?.kind === 'service') {
        selectedService.select({
          kind: 'remote',
          serviceId: node.service.id,
          name: node.service.name,
        });
      }
    }),
  );
  // Resources is declared `visibility: collapsed` in package.json and left
  // alone at runtime. Do NOT try to expand it programmatically when the
  // workspace has no local config: the only mechanism for that is
  // `<viewId>.focus`, which reveals a section by collapsing its siblings, so it
  // shuts every other panel.

  const monitoringView = new ServiceWebviewViewProvider(selectedService, serviceActionCtx, {
    args: ['service', 'metrics'],
    normalize: normalizeMetrics,
    build: buildMetricsHtml,
    loadingLabel: 'Loading metrics…',
  });
  const logsView = new ServiceWebviewViewProvider(selectedService, serviceActionCtx, {
    args: ['service', 'logs'],
    normalize: normalizeLogs,
    build: buildLogsHtml,
    loadingLabel: 'Loading logs…',
  });
  const recentJobsTree = new RecentJobsTreeProvider(selectedService, serviceActionCtx);
  const detailsView = new DetailsViewProvider(contextStore, selectedService, serviceActionCtx);
  context.subscriptions.push(
    monitoringView,
    logsView,
    recentJobsTree,
    detailsView,
    vscode.window.registerWebviewViewProvider('partiriMonitoring', monitoringView),
    vscode.window.registerWebviewViewProvider('partiriLogs', logsView),
    vscode.window.registerWebviewViewProvider('partiriDetails', detailsView),
  );

  const recentJobsView = vscode.window.createTreeView('partiriRecentJobs', {
    treeDataProvider: recentJobsTree,
  });
  context.subscriptions.push(recentJobsView);
  recentJobsTree.setMessageSink((message) => {
    recentJobsView.message = message;
  });
  resourcesTree.setMessageSink((message) => {
    resourcesView.message = message;
  });
  localConfigsTree.setMessageSink((message) => {
    localConfigsView.message = message;
  });

  const selectionPolicy = new ConfigSelectionPolicy({
    selectedService,
    linkedServices,
    memento: context.workspaceState,
    reveal: (configPath) => {
      // Best-effort highlight in the tree; the selection store is what actually
      // drives the other sections, so a failure here is not fatal.
      const node = localConfigsTree.findConfigNode(configPath);
      if (node) {
        void Promise.resolve(localConfigsView.reveal(node, { select: true, focus: false })).catch(
          () => undefined,
        );
      }
    },
  });
  context.subscriptions.push(...selectionPolicy.register());
  selectionPolicy.restoreOrPreselect();

  // Only now is it safe to let the "no configs found" welcome appear: before
  // the scan completes it would claim nothing was found before anything was
  // looked for.
  void initialScan.finally(() => {
    void vscode.commands.executeCommand('setContext', 'partiri.configsScanned', true);
  });

  const statusBar = new PartiriStatusBar(resolver.getBinaryPath);
  context.subscriptions.push(statusBar);

  // The service-scoped panels may have rendered before the binary resolved, so
  // tell them to try again now that there is something to run. Without this
  // they would sit on their placeholder until the next 30s poll tick.
  onBinaryResolved = (binaryPath) => {
    void statusBar.refresh();
    if (!binaryPath) {
      return;
    }
    void contextStore.refresh().catch((error) => {
      outputChannel.appendLine(
        `[activate] context refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    void monitoringView.refresh();
    void logsView.refresh();
    recentJobsTree.refresh();
    void detailsView.refresh();
  };

  const refreshLinked = (): void => void linkedServices.refresh();
  // Two watchers for the same reason the index runs two globs: `*` is not
  // guaranteed to match the leading-dot `.partiri.jsonc` basename.
  for (const glob of ['**/.partiri.jsonc', '**/*.partiri.jsonc']) {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    context.subscriptions.push(
      watcher,
      watcher.onDidCreate(refreshLinked),
      watcher.onDidChange(refreshLinked),
      watcher.onDidDelete(refreshLinked),
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (RELEVANT_SETTINGS.some((setting) => event.affectsConfiguration(setting))) {
        void resolver.resolve();
      }
    }),
  );

  registerCommands(context, {
    outputChannel,
    contextStore,
    linkedServices,
    selectedService,
    resourcesTree,
    localConfigsTree,
    recentJobsTree,
    detailsView,
    monitoringView,
    logsView,
    statusBar,
    serviceActionCtx,
    resourceActionCtx,
    getBinaryPath: resolver.getBinaryPath,
    resolveBinaryAndActivate: () => resolver.resolve(),
  });

  // Commands and views are already registered above, so a failure resolving
  // the binary must not reject activate() and disable the whole extension.
  try {
    await resolver.resolve();
  } catch (error) {
    outputChannel.appendLine(
      `[activate] binary resolution failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function deactivate(): Promise<void> {
  disposeAllWatches();
}
