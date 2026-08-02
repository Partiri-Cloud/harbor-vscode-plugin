import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { requireBinaryPath, runCli } from '../cli/run';
import { confirmDestructive } from '../cli/confirm';
import { handleCliError } from '../cli/errors';
import { ensureServiceTarget } from '../state/serviceTarget';
import type { ServiceDataContext } from '../data/serviceData';

const WARNING_HEADER = [
  '# Partiri: temporary env file.',
  '# Edit and save, then run "Partiri: Apply Env" to push these values.',
  '# This file lives outside your workspace and is not synced anywhere.',
  '',
].join('\n');

function toDotenv(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  if (data && typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('\n');
  }
  return '';
}

async function resolveServiceTargetOrThrow(ctx: ServiceDataContext, serviceId: string) {
  const binaryPath = requireBinaryPath(ctx);
  const target = await ensureServiceTarget(
    binaryPath,
    serviceId,
    ctx.linkedServices.get(serviceId),
    ctx.globalStorageDir,
  );
  return { binaryPath, target };
}

function envFilePath(globalStorageDir: string, serviceId: string): string {
  return path.join(globalStorageDir, `env-${serviceId}.env`);
}

/** partiri.editEnv — `service env` -> write to a private temp file (0600) and open it. */
export async function editEnv(ctx: ServiceDataContext, serviceId: string): Promise<void> {
  try {
    const { binaryPath, target } = await resolveServiceTargetOrThrow(ctx, serviceId);
    const envelope = await runCli(binaryPath, {
      cwd: target.cwd,
      configPath: target.configPath,
      args: ['service', 'env'],
      mutating: false,
    });

    const filePath = envFilePath(ctx.globalStorageDir, serviceId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, WARNING_HEADER + toDotenv(envelope.data), { mode: 0o600 });
    await fs.chmod(filePath, 0o600);

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc);
  } catch (error) {
    await handleCliError(error);
  }
}

/** partiri.applyEnv — confirm (REPLACES ALL env vars), `service env --path <file> -y`, then delete the temp file. */
export async function applyEnv(ctx: ServiceDataContext, serviceId: string): Promise<void> {
  const filePath = envFilePath(ctx.globalStorageDir, serviceId);
  try {
    const exists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      void vscode.window.showErrorMessage(
        'Partiri: no edited env file found. Run "Edit Env" first.',
      );
      return;
    }

    const openDoc = vscode.workspace.textDocuments.find(
      (document) => document.uri.fsPath === filePath,
    );
    if (openDoc?.isDirty) {
      await openDoc.save();
    }

    if (!(await confirmDestructive('envReplace'))) {
      return;
    }

    const { binaryPath, target } = await resolveServiceTargetOrThrow(ctx, serviceId);
    const envelope = await runCli(binaryPath, {
      cwd: target.cwd,
      configPath: target.configPath,
      args: ['service', 'env', '--path', filePath, '-y'],
      mutating: true,
    });
    void vscode.window.showInformationMessage(envelope.message ?? 'Partiri: env applied.');
    void ctx.contextStore.refresh().catch((refreshError) => {
      ctx.outputChannel.appendLine(
        `[applyEnv] context refresh failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
      );
    });
    await fs.rm(filePath, { force: true });
  } catch (error) {
    await handleCliError(error);
  }
}

/** partiri.saveEnv — `service env --save` (persists the currently-open env file into .partiri.jsonc/local state per the CLI). */
export async function saveEnv(ctx: ServiceDataContext, serviceId: string): Promise<void> {
  try {
    const { binaryPath, target } = await resolveServiceTargetOrThrow(ctx, serviceId);
    const envelope = await runCli(binaryPath, {
      cwd: target.cwd,
      configPath: target.configPath,
      args: ['service', 'env', '--save'],
      mutating: true,
    });
    void vscode.window.showInformationMessage(envelope.message ?? 'Partiri: env saved.');
  } catch (error) {
    await handleCliError(error);
  }
}
