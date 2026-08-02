import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { invokeCli } from '../cli/invoke';
import { runCli } from '../cli/run';
import { CliInvocationError, handleCliError } from '../cli/errors';
import { requireData } from '../cli/envelope';
import type { ContextStore } from '../state/contextStore';
import type { ContextWorkspace } from '../state/contextTypes';
import {
  advanceWizard,
  CREATE_NEW_PROJECT_ID,
  detectRuntime,
  findDeployTypeEnum,
  initialWizardState,
  isWizardComplete,
  podPickItems,
  projectPickItems,
  regionPickItems,
  substituteTemplate,
  validateServiceName,
  type WizardAnswers,
} from './wizardLogic';
import { quoteBinaryPath } from './terminalCommand';

const execFileAsync = promisify(execFile);

const DEPLOY_TYPE_OPTIONS = ['webservice', 'static', 'private-service', 'worker'];

export interface InitWizardDeps {
  binaryPath: string;
  contextStore: ContextStore;
}

async function pickWorkspace(
  workspaces: ContextWorkspace[],
): Promise<ContextWorkspace | undefined> {
  if (workspaces.length === 1) {
    return workspaces[0];
  }
  const picked = await vscode.window.showQuickPick(
    workspaces.map((ws) => ({ label: ws.name, description: ws.email, workspace: ws })),
    { placeHolder: 'Select a workspace', ignoreFocusOut: true },
  );
  return picked?.workspace;
}

async function pickProjectId(
  deps: InitWizardDeps,
  workspace: ContextWorkspace,
  cwd: string,
): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(
    projectPickItems(workspace).map((item) => ({
      label: item.label,
      description: item.description,
      id: item.id,
    })),
    { placeHolder: 'Select a project', ignoreFocusOut: true },
  );
  if (!picked) {
    return undefined;
  }
  if (picked.id !== CREATE_NEW_PROJECT_ID) {
    return picked.id;
  }

  const name = await vscode.window.showInputBox({
    prompt: 'New project name',
    ignoreFocusOut: true,
  });
  if (!name) {
    return undefined;
  }
  const envelope = await runCli<{ id: string }>(deps.binaryPath, {
    cwd,
    configPath: cwd,
    args: ['projects', 'create', '--workspace', workspace.id, '--name', name],
    mutating: true,
  });
  await deps.contextStore.refresh();
  return requireData(envelope, 'created project').id;
}

async function pickServiceName(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: 'Service name (max 16 characters)',
    ignoreFocusOut: true,
    validateInput: validateServiceName,
  });
}

async function detectWorkspaceRuntime(folder: string): Promise<string | undefined> {
  try {
    const entries = await fs.readdir(folder);
    return detectRuntime(entries);
  } catch {
    return undefined;
  }
}

async function detectGitRemoteUrl(folder: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: folder });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function pickSource(
  gitRemoteUrl: string | undefined,
): Promise<WizardAnswers['source'] | undefined> {
  const kind = await vscode.window.showQuickPick(
    [
      { label: 'Git repository', id: 'repo' as const },
      { label: 'Container registry image', id: 'registry' as const },
    ],
    { placeHolder: 'Deploy source', ignoreFocusOut: true },
  );
  if (!kind) {
    return undefined;
  }

  if (kind.id === 'repo') {
    const repositoryUrl = await vscode.window.showInputBox({
      prompt: 'Repository URL',
      value: gitRemoteUrl,
      ignoreFocusOut: true,
    });
    if (!repositoryUrl) {
      return undefined;
    }
    const repositoryBranch =
      (await vscode.window.showInputBox({
        prompt: 'Branch',
        value: 'main',
        ignoreFocusOut: true,
      })) ?? 'main';
    return { kind: 'repo', repositoryUrl, repositoryBranch };
  }

  const registryUrl = await vscode.window.showInputBox({
    prompt: 'Registry image (e.g. ghcr.io/org/image:tag)',
    ignoreFocusOut: true,
  });
  return registryUrl ? { kind: 'registry', registryUrl } : undefined;
}

async function fetchDeployTypeOptions(binaryPath: string, cwd: string): Promise<string[]> {
  try {
    // Deliberately invokeCli, not runCli: an unavailable schema falls back to
    // the built-in options rather than failing the wizard.
    const envelope = await invokeCli<unknown>(binaryPath, {
      cwd,
      configPath: cwd,
      args: ['llm', 'schema'],
      mutating: false,
    });
    if (envelope.ok === false) {
      return DEPLOY_TYPE_OPTIONS;
    }
    const found = findDeployTypeEnum(envelope.data);
    return found && found.length > 0 ? found : DEPLOY_TYPE_OPTIONS;
  } catch {
    return DEPLOY_TYPE_OPTIONS;
  }
}

/**
 * Multi-step "New Service" wizard: workspace -> project -> service name ->
 * deploy type -> source -> region -> pod, then `llm template`, placeholder
 * substitution, and writing .partiri.jsonc. See src/commands/wizardLogic.ts
 * for the pure step transitions this orchestrates.
 */
export async function runInitWizard(deps: InitWizardDeps): Promise<void> {
  try {
    const targetFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!targetFolder) {
      void vscode.window.showErrorMessage('Partiri: open a folder before creating a new service.');
      return;
    }

    const context = await deps.contextStore.get();
    if (!context || context.workspaces.length === 0) {
      void vscode.window.showWarningMessage('Partiri: no workspaces found. Run "Login" first.');
      return;
    }

    const workspace = await pickWorkspace(context.workspaces);
    if (!workspace) {
      return;
    }

    let state = advanceWizard(initialWizardState(), { workspaceId: workspace.id });

    const projectId = await pickProjectId(deps, workspace, targetFolder);
    if (!projectId) {
      return;
    }
    state = advanceWizard(state, { projectId });

    const serviceName = await pickServiceName();
    if (!serviceName) {
      return;
    }
    state = advanceWizard(state, { serviceName });

    const deployType = await vscode.window.showQuickPick(
      await fetchDeployTypeOptions(deps.binaryPath, targetFolder),
      { placeHolder: 'Deploy type', ignoreFocusOut: true },
    );
    if (!deployType) {
      return;
    }
    const detectedRuntime = await detectWorkspaceRuntime(targetFolder);
    const runtime = detectedRuntime ?? 'node';
    state = advanceWizard(state, { deployType, runtime: runtime as WizardAnswers['runtime'] });

    const gitRemoteUrl = await detectGitRemoteUrl(targetFolder);
    const source = await pickSource(gitRemoteUrl);
    if (!source) {
      return;
    }
    state = advanceWizard(state, { source });

    const region = await vscode.window.showQuickPick(
      regionPickItems(workspace).map((item) => ({
        label: item.label,
        description: item.description,
        id: item.id,
      })),
      { placeHolder: 'Region', ignoreFocusOut: true },
    );
    if (!region) {
      return;
    }
    state = advanceWizard(state, { regionId: region.id });

    const pod = await vscode.window.showQuickPick(
      podPickItems(workspace).map((item) => ({
        label: item.label,
        description: item.description,
        id: item.id,
      })),
      { placeHolder: 'Pod size', ignoreFocusOut: true },
    );
    if (!pod) {
      return;
    }
    state = advanceWizard(state, { podId: pod.id });

    if (!isWizardComplete(state)) {
      return;
    }

    await writeServiceConfig(deps, state.answers, targetFolder);
  } catch (error) {
    await handleCliError(error);
  }
}

async function writeServiceConfig(
  deps: InitWizardDeps,
  answers: Required<WizardAnswers>,
  targetFolder: string,
): Promise<void> {
  const templateEnvelope = await runCli<{ template: string }>(deps.binaryPath, {
    cwd: targetFolder,
    configPath: targetFolder,
    args: [
      'llm',
      'template',
      '--deploy-type',
      answers.deployType,
      '--runtime',
      answers.runtime,
      '--source',
      answers.source.kind,
    ],
    mutating: false,
  });

  const filled = substituteTemplate(requireData(templateEnvelope, 'config template').template, {
    workspaceId: answers.workspaceId,
    projectId: answers.projectId,
    serviceName: answers.serviceName,
    regionId: answers.regionId,
    podId: answers.podId,
    repositoryUrl: answers.source.kind === 'repo' ? answers.source.repositoryUrl : undefined,
    repositoryBranch: answers.source.kind === 'repo' ? answers.source.repositoryBranch : undefined,
  });

  const configFile = path.join(targetFolder, '.partiri.jsonc');
  const alreadyExists = await fs
    .access(configFile)
    .then(() => true)
    .catch(() => false);
  if (alreadyExists) {
    void vscode.window.showErrorMessage(
      `Partiri: ${configFile} already exists. Refusing to overwrite it.`,
    );
    return;
  }

  await fs.writeFile(configFile, filled, 'utf8');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configFile));
  await vscode.window.showTextDocument(doc);

  // Deliberately invokeCli, not runCli: a validation failure is reported and
  // stops here, leaving the written .partiri.jsonc in place for the user to fix.
  const validateEnvelope = await invokeCli(deps.binaryPath, {
    cwd: targetFolder,
    configPath: targetFolder,
    args: ['validate'],
    mutating: false,
  });
  if (validateEnvelope.ok === false) {
    await handleCliError(new CliInvocationError(validateEnvelope.error));
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    '.partiri.jsonc created and validated. Create the service on Partiri now?',
    'Create service on Partiri now',
  );
  if (choice !== 'Create service on Partiri now') {
    return;
  }

  await runCli(deps.binaryPath, {
    cwd: targetFolder,
    configPath: targetFolder,
    args: ['service', 'create'],
    mutating: true,
  });
  await deps.contextStore.refresh();
  void vscode.window.showInformationMessage('Partiri: service created.');
}

/** partiri.initInTerminal — just runs `partiri init` in the integrated terminal. */
export function initInTerminal(binaryPath: string): void {
  const terminal = vscode.window.createTerminal('Partiri');
  terminal.show();
  terminal.sendText(`${quoteBinaryPath(binaryPath)} init`, true);
}
