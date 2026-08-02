/**
 * Read-only service data access.
 *
 * Sits below the command layer, not inside it: the Details, Monitoring, Logs,
 * and Recent Jobs views all need service payloads without wanting anything
 * from `src/commands/`. Keeping this here is what stops `views/` from
 * importing a command module to get at its data helpers.
 */

import * as vscode from 'vscode';
import { requireBinaryPath, runCli } from '../cli/run';
import type { ContextStore } from '../state/contextStore';
import type { LinkedServicesIndex } from '../state/linkedServices';
import type { SelectedService } from '../state/selectedService';
import {
  ensureSelectedServiceTarget,
  ensureServiceTarget,
  type InvocationTarget,
} from '../state/serviceTarget';

/**
 * Everything a service-scoped operation needs to reach the CLI. `getBinaryPath`
 * is a getter rather than a value because activation resolves the binary
 * asynchronously — a context object built at activation time would capture
 * `null` forever.
 */
export interface ServiceDataContext {
  getBinaryPath: () => string | null;
  globalStorageDir: string;
  linkedServices: LinkedServicesIndex;
  contextStore: ContextStore;
  outputChannel: vscode.OutputChannel;
}

/**
 * Run a read-only service subcommand and return its parsed payload. Takes an
 * already-resolved target rather than a service id, so callers that already
 * resolved one (the polling panels) don't pay for it twice.
 */
export async function fetchServiceData(
  ctx: ServiceDataContext,
  target: { cwd: string; configPath: string },
  args: string[],
): Promise<unknown> {
  const binaryPath = requireBinaryPath(ctx);
  const envelope = await runCli(binaryPath, {
    cwd: target.cwd,
    configPath: target.configPath,
    args,
    mutating: false,
  });
  return envelope.data;
}

/** Resolve a service id to somewhere the CLI can run, materializing a scratch config if needed. */
export function resolveServiceTarget(
  ctx: ServiceDataContext,
  binaryPath: string,
  serviceId: string,
): Promise<InvocationTarget> {
  return ensureServiceTarget(
    binaryPath,
    serviceId,
    ctx.linkedServices.get(serviceId),
    ctx.globalStorageDir,
  );
}

/** The same, for a selection — which may be a local config that needs no CLI call at all. */
export function resolveSelectionTarget(
  ctx: ServiceDataContext,
  binaryPath: string,
  selection: SelectedService,
): Promise<InvocationTarget> {
  return ensureSelectedServiceTarget(
    binaryPath,
    selection,
    ctx.linkedServices,
    ctx.globalStorageDir,
  );
}
