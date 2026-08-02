/**
 * Every `partiri.*` command registration.
 *
 * Handlers are thin on purpose: each resolves a target (service id, workspace
 * id, or config path) and delegates to a module in this folder. The three
 * `with*` helpers below hold the only real logic — the rules for turning a
 * right-clicked tree node, or the current selection, into an id.
 */

import * as vscode from 'vscode';
import { installGuidance } from '../cli/discovery';
import type { ContextStore } from '../state/contextStore';
import { type LinkedServicesIndex, resolveTarget } from '../state/linkedServices';
import { selectedServiceId, type SelectedServiceStore } from '../state/selectedService';
import type { PartiriStatusBar } from '../status/statusBar';
import type { LocalConfigNode, LocalConfigsTreeProvider } from '../views/localConfigsTree';
import type { RecentJobsTreeProvider } from '../views/recentJobsTree';
import type { ResourceNode, ResourcesTreeProvider } from '../views/resourcesTree';
import { doctor, login, setApiKey } from './auth';
import { applyEnv, editEnv, saveEnv } from './envEditor';
import { initInTerminal, runInitWizard } from './initWizard';
import { offerInstall } from './installCli';
import { pullServiceInteractive } from './pullServicePicker';
import {
  createProject,
  createRegistrySecret,
  createRepositorySecret,
  type ResourceActionContext,
} from './resourceActions';
import {
  deployLocalConfig,
  deployService,
  killService,
  linkService,
  pauseService,
  pullConfigFile,
  pullService,
  pushService,
  showJobs,
  showLogs,
  showMetrics,
  stopWatchingLogs,
  tokenForService,
  unpauseService,
  validateService,
  validateServiceRemote,
  watchLogs,
  type ServiceActionContext,
} from './serviceActions';
import { showStatusBarMenu } from '../status/statusBar';

/** A panel that can be refreshed in place or fully reloaded from its title bar. */
interface RefreshablePanel {
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
}

export interface RegisterCommandsDeps {
  outputChannel: vscode.OutputChannel;
  contextStore: ContextStore;
  linkedServices: LinkedServicesIndex;
  selectedService: SelectedServiceStore;
  resourcesTree: ResourcesTreeProvider;
  localConfigsTree: LocalConfigsTreeProvider;
  recentJobsTree: RecentJobsTreeProvider;
  detailsView: RefreshablePanel;
  monitoringView: RefreshablePanel;
  logsView: RefreshablePanel;
  statusBar: PartiriStatusBar;
  serviceActionCtx: ServiceActionContext;
  resourceActionCtx: ResourceActionContext;
  getBinaryPath: () => string | null;
  resolveBinaryAndActivate: () => Promise<void>;
}

function serviceIdFrom(node: ResourceNode | undefined): string | undefined {
  return node?.kind === 'service' ? node.service.id : undefined;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  deps: RegisterCommandsDeps,
): void {
  /**
   * The interactive binary guard, for command entry points: notify and offer to
   * install rather than throwing. Deliberately NOT `requireBinaryPath` from
   * cli/run.ts, which throws for the layers underneath these handlers.
   */
  const requireBinaryInteractive = (): string | undefined => {
    const binaryPath = deps.getBinaryPath();
    if (!binaryPath) {
      void vscode.window.showErrorMessage('Partiri: CLI not found or version too old.');
      void offerInstall(installGuidance(process.platform), deps.resolveBinaryAndActivate);
      return undefined;
    }
    return binaryPath;
  };

  // A tree node wins (the user right-clicked a specific service), then the
  // active selection driving the Actions/Monitoring/Logs sections, then the
  // workspace's own linked config as a last resort.
  const withServiceId = async (
    node: ResourceNode | undefined,
    run: (serviceId: string) => Promise<void>,
  ): Promise<void> => {
    const fromNode = serviceIdFrom(node);
    if (fromNode) {
      await run(fromNode);
      return;
    }
    const fromSelection = selectedServiceId(deps.selectedService.get());
    if (fromSelection) {
      await run(fromSelection);
      return;
    }
    const target = await resolveTarget(deps.linkedServices);
    if (!target) {
      void vscode.window.showWarningMessage('Partiri: no linked service found for this command.');
      return;
    }
    await run(target.id);
  };

  /** Workspace-scoped counterpart: these actions only make sense on a workspace row. */
  const withWorkspaceId = (
    node: ResourceNode | undefined,
    run: (workspaceId: string) => void,
  ): void => {
    const workspaceId = node?.kind === 'workspace' ? node.workspace.id : undefined;
    if (!workspaceId) {
      void vscode.window.showWarningMessage('Partiri: select a workspace first.');
      return;
    }
    run(workspaceId);
  };

  const cmd = (id: string, handler: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  const withBinary = (run: (binaryPath: string) => void) => (): void => {
    const binaryPath = requireBinaryInteractive();
    if (binaryPath) {
      run(binaryPath);
    }
  };

  cmd('partiri.refresh', () => {
    deps.contextStore.invalidate();
    void deps.contextStore.refresh().catch((error) => {
      deps.outputChannel.appendLine(
        `[partiri.refresh] context refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    deps.resourcesTree.refresh();
    deps.localConfigsTree.refresh();
    deps.recentJobsTree.refresh();
    void deps.detailsView.refresh();
    void deps.monitoringView.refresh();
    void deps.logsView.refresh();
  });

  // Pull one specific config file, rather than resolving by service id — two
  // files can carry the same id, and the user clicked a particular one.
  cmd('partiri.pullConfig', (node?: LocalConfigNode) => {
    if (node?.kind !== 'config') {
      return;
    }
    const { folder, configPath, id } = node.config;
    if (!id) {
      void vscode.window.showWarningMessage(
        'Partiri: this config has no service yet — deploy it first, then it can be pulled.',
      );
      return;
    }
    void pullConfigFile(deps.serviceActionCtx, folder, configPath, id);
  });

  // Per-section refreshes: scoped so refreshing logs doesn't drag a full
  // `llm context` re-fetch along with it.
  cmd('partiri.refreshLocalConfigs', () => {
    void deps.linkedServices.refresh();
  });
  cmd('partiri.refreshDetails', () => {
    void deps.detailsView.reload();
  });
  cmd('partiri.refreshMonitoring', () => {
    void deps.monitoringView.reload();
  });
  cmd('partiri.refreshJobs', () => {
    deps.recentJobsTree.refresh();
  });
  cmd('partiri.refreshLogs', () => {
    void deps.logsView.reload();
  });

  cmd(
    'partiri.initWizard',
    withBinary((binaryPath) => {
      void runInitWizard({ binaryPath, contextStore: deps.contextStore });
    }),
  );
  cmd('partiri.initInTerminal', withBinary(initInTerminal));
  cmd('partiri.pullService', () => {
    if (!requireBinaryInteractive()) {
      return;
    }
    void pullServiceInteractive(deps.serviceActionCtx, deps.contextStore, () =>
      deps.localConfigsTree.refresh(),
    );
  });

  const onSignedIn = (): void => {
    void deps.statusBar.refresh();
    void deps.contextStore.refresh();
  };
  cmd(
    'partiri.login',
    withBinary((binaryPath) => void login(binaryPath, onSignedIn)),
  );
  cmd(
    'partiri.setApiKey',
    withBinary((binaryPath) => void setApiKey(binaryPath, onSignedIn)),
  );
  cmd(
    'partiri.doctor',
    withBinary((binaryPath) => void doctor(binaryPath, deps.outputChannel)),
  );
  cmd('partiri.statusBarMenu', () => {
    void showStatusBarMenu({
      login: async () => {
        await vscode.commands.executeCommand('partiri.login');
      },
      setApiKey: async () => {
        await vscode.commands.executeCommand('partiri.setApiKey');
      },
      doctor: async () => {
        await vscode.commands.executeCommand('partiri.doctor');
      },
    });
  });

  cmd('partiri.deploy', async (node?: ResourceNode) => {
    // A local config written by the wizard has no service id until its first
    // deploy, so it can't go through the id-keyed path.
    const selection = deps.selectedService.get();
    if (!serviceIdFrom(node) && selection?.kind === 'localConfig' && !selection.serviceId) {
      await deployLocalConfig(deps.serviceActionCtx, selection.folder, selection.configPath);
      return;
    }
    await withServiceId(node, (serviceId) => deployService(deps.serviceActionCtx, serviceId));
  });

  /** The plain service-scoped commands: same shape, differing only in the action. */
  const serviceCommands: [string, (serviceId: string) => Promise<void>][] = [
    ['partiri.push', (id) => pushService(deps.serviceActionCtx, id)],
    ['partiri.pull', (id) => pullService(deps.serviceActionCtx, id)],
    ['partiri.pause', (id) => pauseService(deps.serviceActionCtx, id)],
    ['partiri.unpause', (id) => unpauseService(deps.serviceActionCtx, id)],
    ['partiri.kill', (id) => killService(deps.serviceActionCtx, id)],
    ['partiri.logs', (id) => showLogs(deps.serviceActionCtx, id)],
    ['partiri.watchLogs', async (id) => watchLogs(deps.serviceActionCtx, id)],
    ['partiri.stopWatchLogs', async (id) => stopWatchingLogs(id)],
    ['partiri.metrics', (id) => showMetrics(deps.serviceActionCtx, id)],
    ['partiri.jobs', (id) => showJobs(deps.serviceActionCtx, id)],
    ['partiri.validate', (id) => validateService(deps.serviceActionCtx, id)],
    ['partiri.validateRemote', (id) => validateServiceRemote(deps.serviceActionCtx, id)],
    ['partiri.link', (id) => linkService(deps.serviceActionCtx, id)],
    ['partiri.token', (id) => tokenForService(deps.serviceActionCtx, id)],
    ['partiri.editEnv', (id) => editEnv(deps.serviceActionCtx, id)],
    ['partiri.applyEnv', (id) => applyEnv(deps.serviceActionCtx, id)],
    ['partiri.saveEnv', (id) => saveEnv(deps.serviceActionCtx, id)],
  ];
  for (const [id, run] of serviceCommands) {
    cmd(id, (node?: ResourceNode) => withServiceId(node, run));
  }

  const workspaceCommands: [string, (workspaceId: string) => void][] = [
    ['partiri.createProject', (id) => void createProject(deps.resourceActionCtx, id)],
    ['partiri.createRegistrySecret', (id) => void createRegistrySecret(deps.resourceActionCtx, id)],
    [
      'partiri.createRepositorySecret',
      (id) => void createRepositorySecret(deps.resourceActionCtx, id),
    ],
  ];
  for (const [id, run] of workspaceCommands) {
    cmd(id, (node?: ResourceNode) => withWorkspaceId(node, run));
  }
}
