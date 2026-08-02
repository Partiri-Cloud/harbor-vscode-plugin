import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { invokeCli } from '../cli/invoke';
import { requireBinaryPath, runCli } from '../cli/run';
import { confirmDestructive } from '../cli/confirm';
import { handleCliError } from '../cli/errors';
import { parseJsonc } from '../state/jsonc';
import { scratchConfigDir, type InvocationTarget } from '../state/serviceTarget';
import { uniqueConfigFileName } from '../state/configNaming';
import { resolveServiceTarget, type ServiceDataContext } from '../data/serviceData';
import { MAX_CONSECUTIVE_WATCH_FAILURES, Poller } from '../util/poller';

/**
 * Commands need exactly what the data layer needs; kept as an alias so call
 * sites read in terms of the action they are performing.
 */
export type ServiceActionContext = ServiceDataContext;

/**
 * `service deploy` is the one non-linked action allowed to skip the
 * `service pull` materialization step (docs deliverable item 9): it deploys
 * by --service id directly, so a bare scratch directory is enough for cwd
 * and --config.
 */
async function resolveDeployTarget(
  ctx: ServiceActionContext,
  serviceId: string,
): Promise<{ target: InvocationTarget; args: string[] }> {
  const linked = ctx.linkedServices.get(serviceId);
  if (linked) {
    return {
      target: { cwd: linked.folder, configPath: linked.configPath, isLinked: true },
      args: ['service', 'deploy'],
    };
  }
  const dir = await scratchConfigDir(ctx.globalStorageDir, serviceId);
  return {
    target: { cwd: dir, configPath: dir, isLinked: false },
    args: ['service', 'deploy', '--service', serviceId],
  };
}

async function runDeploy(
  ctx: ServiceActionContext,
  binaryPath: string,
  target: { cwd: string; configPath: string },
  args: string[],
): Promise<void> {
  const envelope = await runCli(binaryPath, {
    cwd: target.cwd,
    configPath: target.configPath,
    args: [...args, '-y'],
    mutating: true,
  });
  void vscode.window.showInformationMessage(envelope.message ?? 'Partiri: deploy job created.');
  void ctx.contextStore.refresh().catch((refreshError) => {
    ctx.outputChannel.appendLine(
      `[deploy] context refresh failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
    );
  });
}

export async function deployService(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  try {
    const binaryPath = requireBinaryPath(ctx);
    if (!(await confirmDestructive('deploy'))) {
      return;
    }
    const { target, args } = await resolveDeployTarget(ctx, serviceId);
    await runDeploy(ctx, binaryPath, target, args);
  } catch (error) {
    await handleCliError(error);
  }
}

/**
 * Deploy a local config directly by path. A config written by the wizard has no
 * service id until its first deploy, so it can't be reached via the id-keyed
 * index — but `service deploy` only needs a resolvable --config.
 */
export async function deployLocalConfig(
  ctx: ServiceActionContext,
  folder: string,
  configPath: string,
): Promise<void> {
  try {
    const binaryPath = requireBinaryPath(ctx);
    if (!(await confirmDestructive('deploy'))) {
      return;
    }
    await runDeploy(ctx, binaryPath, { cwd: folder, configPath }, ['service', 'deploy']);
  } catch (error) {
    await handleCliError(error);
  }
}

interface RunOptions {
  args: string[];
  mutating: boolean;
  confirm?: 'push' | 'pause' | 'kill';
  diskChanged?: boolean;
  onSuccess?: (message: string | undefined, data: unknown) => void;
}

async function runServiceAction(
  ctx: ServiceActionContext,
  serviceId: string,
  options: RunOptions,
): Promise<void> {
  try {
    const binaryPath = requireBinaryPath(ctx);
    if (options.confirm) {
      const confirmed = await confirmDestructive(options.confirm, {
        diskChanged: options.diskChanged,
      });
      if (!confirmed) {
        return;
      }
    }
    const target = await resolveServiceTarget(ctx, binaryPath, serviceId);
    const args = options.confirm ? [...options.args, '-y'] : options.args;
    const envelope = await runCli(binaryPath, {
      cwd: target.cwd,
      configPath: target.configPath,
      args,
      mutating: options.mutating,
    });
    options.onSuccess?.(envelope.message, envelope.data);
    if (options.mutating) {
      void ctx.contextStore.refresh().catch((refreshError) => {
        ctx.outputChannel.appendLine(
          `[${options.args.join(' ')}] context refresh failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
        );
      });
    }
  } catch (error) {
    await handleCliError(error);
  }
}

/**
 * Best-effort: pull a fresh remote copy into a scratch dir and compare its
 * `service.disk` block against the local linked config, so `push`'s
 * confirmation can warn when disk changes won't be applied (docs/cli-contract.md
 * §6). Never blocks or fails the push — any error here falls back to false.
 */
async function detectDiskChanged(
  ctx: ServiceActionContext,
  binaryPath: string,
  serviceId: string,
): Promise<boolean> {
  const linked = ctx.linkedServices.get(serviceId);
  if (!linked) {
    return false;
  }
  try {
    const localSource = await fs.readFile(linked.configPath, 'utf8');
    const local = parseJsonc(localSource) as { service?: { disk?: unknown } };

    const scratchDir = await scratchConfigDir(ctx.globalStorageDir, `${serviceId}-pushdiff`);
    // Deliberately invokeCli, not runCli: a failed probe must degrade to "no
    // disk change detected" rather than abort the push the user asked for.
    const envelope = await invokeCli(binaryPath, {
      cwd: scratchDir,
      configPath: scratchDir,
      args: ['service', 'pull', '--service', serviceId],
      mutating: true,
    });
    if (envelope.ok === false) {
      return false;
    }
    const pulledSource = await fs.readFile(path.join(scratchDir, '.partiri.jsonc'), 'utf8');
    const pulled = parseJsonc(pulledSource) as { service?: { disk?: unknown } };

    return (
      JSON.stringify(local.service?.disk ?? null) !== JSON.stringify(pulled.service?.disk ?? null)
    );
  } catch {
    return false;
  }
}

export async function pushService(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  const binaryPath = ctx.getBinaryPath();
  const diskChanged = binaryPath ? await detectDiskChanged(ctx, binaryPath, serviceId) : false;
  await runServiceAction(ctx, serviceId, {
    args: ['service', 'push'],
    mutating: true,
    confirm: 'push',
    diskChanged,
    onSuccess: (message) =>
      void vscode.window.showInformationMessage(message ?? 'Partiri: pushed.'),
  });
}

export async function pullService(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  await runServiceAction(ctx, serviceId, {
    args: ['service', 'pull'],
    mutating: true,
    onSuccess: (message) =>
      void vscode.window.showInformationMessage(message ?? 'Partiri: pulled.'),
  });
}

export async function pauseService(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  await runServiceAction(ctx, serviceId, {
    args: ['service', 'pause'],
    mutating: true,
    confirm: 'pause',
    onSuccess: (message) =>
      void vscode.window.showInformationMessage(message ?? 'Partiri: paused.'),
  });
}

export async function unpauseService(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  await runServiceAction(ctx, serviceId, {
    args: ['service', 'unpause'],
    mutating: true,
    onSuccess: (message) =>
      void vscode.window.showInformationMessage(message ?? 'Partiri: unpaused.'),
  });
}

export async function killService(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  await runServiceAction(ctx, serviceId, {
    args: ['service', 'kill'],
    mutating: true,
    confirm: 'kill',
    onSuccess: (message) =>
      void vscode.window.showInformationMessage(message ?? 'Partiri: killed.'),
  });
}

export async function tokenForService(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  await runServiceAction(ctx, serviceId, {
    args: ['token'],
    mutating: false,
    onSuccess: (message, data) => {
      if (message) {
        ctx.outputChannel.appendLine(`[token] ${message}`);
      }
      ctx.outputChannel.appendLine(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
      ctx.outputChannel.show(true);
    },
  });
}

/**
 * Shared core of `partiri.link` and `partiri.pullService` (registered
 * elsewhere): guard against overwriting an existing `.partiri.jsonc` in
 * `targetDir`, run `service pull --service <id>`, and refresh the linked
 * services index. Returns false (never throws) when it refused or the
 * invocation failed — errors are already surfaced via `handleCliError`.
 */
/** Fall back to the cached `llm context` when the caller has no name to hand. */
async function serviceNameFor(
  ctx: ServiceActionContext,
  serviceId: string,
): Promise<string | undefined> {
  const data = await ctx.contextStore.get().catch(() => null);
  for (const workspace of data?.workspaces ?? []) {
    const match = workspace.services.find((service) => service.id === serviceId);
    if (match) {
      return match.name;
    }
  }
  return undefined;
}

export async function pullServiceIntoFolder(
  ctx: ServiceActionContext,
  serviceId: string,
  targetDir: string,
  serviceName?: string,
): Promise<boolean> {
  try {
    const binaryPath = requireBinaryPath(ctx);
    const name = serviceName ?? (await serviceNameFor(ctx, serviceId));
    const existing = await fs.readdir(targetDir).catch(() => [] as string[]);
    // Name the file after the service and step a counter on collision, rather
    // than refusing — several services legitimately live in one folder.
    const configFile = path.join(targetDir, uniqueConfigFileName(name, new Set(existing)));

    await runCli(binaryPath, {
      cwd: targetDir,
      configPath: configFile,
      args: ['service', 'pull', '--service', serviceId],
      mutating: true,
    });
    await ctx.linkedServices.refresh();
    return true;
  } catch (error) {
    await handleCliError(error);
    return false;
  }
}

/**
 * partiri.pullConfig — refresh ONE config file from its live service.
 *
 * Distinct from `pullService`, which resolves by service id and would therefore
 * write to whichever config claimed that id first; this targets the exact file
 * the user clicked. `service pull` overwrites the file in place (verified), so
 * unsaved editor changes are worth a warning — the contract's §6 matrix lists
 * `pull` as no-confirm, and this is an unsaved-work guard rather than a
 * destructive-op confirmation.
 */
export async function pullConfigFile(
  ctx: ServiceActionContext,
  folder: string,
  configPath: string,
  serviceId: string,
): Promise<void> {
  try {
    const binaryPath = requireBinaryPath(ctx);
    const open = vscode.workspace.textDocuments.find(
      (document) => document.uri.fsPath === configPath,
    );
    if (open?.isDirty) {
      const choice = await vscode.window.showWarningMessage(
        `Overwrite unsaved changes in ${path.basename(configPath)}?`,
        { modal: true, detail: 'Pulling replaces the file with the live service configuration.' },
        'Overwrite',
      );
      if (choice !== 'Overwrite') {
        return;
      }
    }

    const envelope = await runCli(binaryPath, {
      cwd: folder,
      configPath,
      args: ['service', 'pull', '--service', serviceId],
      mutating: true,
    });
    await ctx.linkedServices.refresh();
    void vscode.window.showInformationMessage(
      envelope.message ?? `Partiri: pulled ${path.basename(configPath)}.`,
    );
  } catch (error) {
    await handleCliError(error);
  }
}

/** partiri.link — materialize a real (non-scratch) local config for a service the user picked in the tree. */
export async function linkService(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  try {
    requireBinaryPath(ctx);
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      void vscode.window.showErrorMessage(
        'Partiri: open a workspace folder to link a service into.',
      );
      return;
    }
    const folder =
      folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
    if (!folder) {
      return;
    }
    const success = await pullServiceIntoFolder(ctx, serviceId, folder.uri.fsPath);
    if (success) {
      void vscode.window.showInformationMessage('Partiri: service linked into this workspace.');
    }
  } catch (error) {
    await handleCliError(error);
  }
}

export async function validateService(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  await runServiceAction(ctx, serviceId, {
    args: ['validate'],
    mutating: false,
    onSuccess: (message) => void vscode.window.showInformationMessage(message ?? 'Partiri: valid.'),
  });
}

export async function validateServiceRemote(
  ctx: ServiceActionContext,
  serviceId: string,
): Promise<void> {
  await runServiceAction(ctx, serviceId, {
    args: ['validate', '--remote'],
    mutating: false,
    onSuccess: (message) => void vscode.window.showInformationMessage(message ?? 'Partiri: valid.'),
  });
}

/**
 * Fetch a read-only service subcommand's output and append it to the output
 * channel. `reveal` controls whether the Output panel is (re-)shown — only
 * manual/first invocations should do that; repeated watch ticks must not
 * keep re-revealing a panel the user closed (docs deliverable item 7).
 */
async function fetchServiceOutput(
  ctx: ServiceActionContext,
  serviceId: string,
  args: string[],
  label: string,
  reveal: boolean,
): Promise<void> {
  const binaryPath = requireBinaryPath(ctx);
  const target = await resolveServiceTarget(ctx, binaryPath, serviceId);
  const envelope = await runCli(binaryPath, {
    cwd: target.cwd,
    configPath: target.configPath,
    args,
    mutating: false,
  });
  ctx.outputChannel.appendLine(`--- ${label} (${new Date().toLocaleTimeString()}) ---`);
  ctx.outputChannel.appendLine(JSON.stringify(envelope.data, null, 2));
  if (reveal) {
    ctx.outputChannel.show(true);
  }
}

async function readOnlyServiceOutput(
  ctx: ServiceActionContext,
  serviceId: string,
  args: string[],
  label: string,
): Promise<void> {
  try {
    await fetchServiceOutput(ctx, serviceId, args, label, true);
  } catch (error) {
    await handleCliError(error);
  }
}

export async function showLogs(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  await readOnlyServiceOutput(ctx, serviceId, ['service', 'logs'], 'logs');
}

export async function showMetrics(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  await readOnlyServiceOutput(ctx, serviceId, ['service', 'metrics'], 'metrics');
}

export async function showJobs(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  await readOnlyServiceOutput(ctx, serviceId, ['service', 'jobs'], 'jobs');
}

const activeWatches = new Map<string, Poller>();
const watchFailureCounts = new Map<string, number>();

/**
 * partiri.watchLogs — polls `service logs` every 30s until stopped or
 * disposed. Only the initial call reveals the Output panel; ticks append
 * silently. After 3 consecutive failed ticks, the watch stops itself and
 * shows a single warning instead of repeating error notifications forever.
 */
export function watchLogs(ctx: ServiceActionContext, serviceId: string): void {
  stopWatchingLogs(serviceId);
  watchFailureCounts.set(serviceId, 0);
  void showLogs(ctx, serviceId);
  const poller = new Poller(() => watchLogsTick(ctx, serviceId));
  poller.start();
  activeWatches.set(serviceId, poller);
}

async function watchLogsTick(ctx: ServiceActionContext, serviceId: string): Promise<void> {
  try {
    await fetchServiceOutput(ctx, serviceId, ['service', 'logs'], 'logs', false);
    watchFailureCounts.set(serviceId, 0);
  } catch {
    const failures = (watchFailureCounts.get(serviceId) ?? 0) + 1;
    watchFailureCounts.set(serviceId, failures);
    if (failures >= MAX_CONSECUTIVE_WATCH_FAILURES) {
      stopWatchingLogs(serviceId);
      void vscode.window.showWarningMessage(
        `Partiri: log watching stopped after ${MAX_CONSECUTIVE_WATCH_FAILURES} consecutive failures.`,
      );
    }
  }
}

export function stopWatchingLogs(serviceId: string): void {
  activeWatches.get(serviceId)?.stop();
  activeWatches.delete(serviceId);
  watchFailureCounts.delete(serviceId);
}

export function disposeAllWatches(): void {
  for (const poller of activeWatches.values()) {
    poller.stop();
  }
  activeWatches.clear();
  watchFailureCounts.clear();
}
