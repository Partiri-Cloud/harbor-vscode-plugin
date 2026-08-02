import * as vscode from 'vscode';
import type { ContextStore } from '../state/contextStore';
import { pullServiceIntoFolder, type ServiceActionContext } from './serviceActions';

/**
 * partiri.pullService — pick a remote service, pick a folder, pull it in.
 *
 * Distinct from `partiri.pull`, which refreshes a service already linked into
 * the workspace; this is the entry point for one that isn't there yet, so it
 * has to ask which service and where.
 */
export async function pullServiceInteractive(
  ctx: ServiceActionContext,
  contextStore: ContextStore,
  onPulled: () => void,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showErrorMessage('Partiri: open a folder to pull a service into.');
    return;
  }

  const data = await contextStore.get().catch(() => null);
  const services = (data?.workspaces ?? []).flatMap((workspace) =>
    workspace.services.map((service) => ({
      label: service.name,
      description: service.deploy_type,
      detail: workspace.name,
      serviceId: service.id,
    })),
  );
  if (services.length === 0) {
    void vscode.window.showWarningMessage(
      'Partiri: no services found. Sign in first, or create one with "New Service".',
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(services, {
    placeHolder: 'Select a service to pull into this workspace',
    ignoreFocusOut: true,
  });
  if (!picked) {
    return;
  }
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
  if (!folder) {
    return;
  }

  const pulled = await pullServiceIntoFolder(
    ctx,
    picked.serviceId,
    folder.uri.fsPath,
    picked.label,
  );
  if (pulled) {
    void vscode.window.showInformationMessage(`Partiri: pulled ${picked.label}.`);
    onPulled();
  }
}
