import * as vscode from 'vscode';
import { requireBinaryPath, runCli } from '../cli/run';
import { handleCliError } from '../cli/errors';
import { defaultInvocationTarget } from '../state/defaultTarget';
import type { ContextStore } from '../state/contextStore';

export interface ResourceActionContext {
  getBinaryPath: () => string | null;
  contextStore: ContextStore;
  /** Invalidate the LSP server's cached `llm context` data (docs/lsp.md). */
  refreshLsp: () => Promise<void>;
}

/**
 * Both actions here create a workspace-scoped resource that `llm context`
 * reports, so both must invalidate the local cache and the LSP server's copy.
 * Best-effort: the resource already exists, so a stale view is a refresh
 * problem, not a failure worth surfacing.
 */
async function refreshAfterMutation(ctx: ResourceActionContext): Promise<void> {
  await ctx.contextStore.refresh().catch(() => {});
  void ctx.refreshLsp().catch(() => {});
}

/** partiri.createProject — workspace-scoped, no confirm (docs/cli-contract.md §6, "projects *"). */
export async function createProject(
  ctx: ResourceActionContext,
  workspaceId: string,
): Promise<void> {
  try {
    const binaryPath = requireBinaryPath(ctx);
    const name = await vscode.window.showInputBox({
      prompt: 'New project name',
      ignoreFocusOut: true,
    });
    if (!name) {
      return;
    }
    const { cwd, configPath } = defaultInvocationTarget();
    const envelope = await runCli(binaryPath, {
      cwd,
      configPath,
      args: ['projects', 'create', '--workspace', workspaceId, '--name', name],
      mutating: true,
    });
    void vscode.window.showInformationMessage(envelope.message ?? 'Partiri: project created.');
    await refreshAfterMutation(ctx);
  } catch (error) {
    await handleCliError(error);
  }
}

async function createSecret(
  ctx: ResourceActionContext,
  workspaceId: string,
  kind: 'registry' | 'repository',
): Promise<void> {
  try {
    const binaryPath = requireBinaryPath(ctx);
    const name = await vscode.window.showInputBox({
      prompt: `${kind === 'registry' ? 'Registry' : 'Repository'} secret name`,
      ignoreFocusOut: true,
    });
    if (!name) {
      return;
    }
    const value = await vscode.window.showInputBox({
      prompt: 'Secret value',
      password: true,
      ignoreFocusOut: true,
    });
    if (!value) {
      return;
    }
    const { cwd, configPath } = defaultInvocationTarget();
    const envelope = await runCli(binaryPath, {
      cwd,
      configPath,
      args: [
        'secrets',
        `create-${kind}`,
        '--workspace',
        workspaceId,
        '--name',
        name,
        '--secret-stdin',
      ],
      mutating: true,
      stdin: value,
    });
    void vscode.window.showInformationMessage(
      envelope.message ?? `Partiri: ${kind} secret created.`,
    );
    await refreshAfterMutation(ctx);
  } catch (error) {
    await handleCliError(error);
  }
}

export async function createRegistrySecret(
  ctx: ResourceActionContext,
  workspaceId: string,
): Promise<void> {
  await createSecret(ctx, workspaceId, 'registry');
}

export async function createRepositorySecret(
  ctx: ResourceActionContext,
  workspaceId: string,
): Promise<void> {
  await createSecret(ctx, workspaceId, 'repository');
}
