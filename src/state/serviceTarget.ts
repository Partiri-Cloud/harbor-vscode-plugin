import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { runCli } from '../cli/run';
import type { LinkedService, LinkedServicesIndex } from './linkedServices';
import type { SelectedService } from './selectedService';

const SCRATCH_CACHE_TTL_MS = 5 * 60 * 1000;

export interface InvocationTarget {
  cwd: string;
  configPath: string;
  isLinked: boolean;
}

/**
 * Non-linked services (shown via `llm context`, no local .partiri.jsonc):
 * materialize a scratch config in the editor's private storage before
 * running anything but deploy (docs/cli-contract.md §8).
 */
export async function scratchConfigDir(
  globalStorageDir: string,
  serviceId: string,
): Promise<string> {
  const dir = path.join(globalStorageDir, `svc-${serviceId}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Resolve where to run a command for a given service: its linked local
 * folder if one exists, otherwise a materialized scratch config
 * (`service pull --service <id> --config <scratchDir>`).
 *
 * The pull is skipped when the scratch config was already materialized
 * within the last 5 minutes (same freshness window as ContextStore) — this
 * call runs on every action against a non-linked service, including every
 * log-watch tick, and re-pulling each time would queue an unnecessary
 * mutating network call.
 */
export async function ensureServiceTarget(
  binaryPath: string,
  serviceId: string,
  linked: LinkedService | undefined,
  globalStorageDir: string,
): Promise<InvocationTarget> {
  if (linked) {
    return { cwd: linked.folder, configPath: linked.configPath, isLinked: true };
  }

  const dir = await scratchConfigDir(globalStorageDir, serviceId);
  if (await isScratchConfigFresh(dir)) {
    return { cwd: dir, configPath: dir, isLinked: false };
  }

  await runCli(binaryPath, {
    cwd: dir,
    configPath: dir,
    args: ['service', 'pull', '--service', serviceId],
    mutating: true,
  });
  return { cwd: dir, configPath: dir, isLinked: false };
}

/**
 * Resolve a SelectedService (state/selectedService.ts) to somewhere the CLI
 * can be invoked. A localConfig selection already knows its own folder and
 * config path, so it returns directly with no CLI call. A remote selection
 * delegates to ensureServiceTarget, which already handles scratch
 * materialization and its 5-minute freshness cache — not duplicated here.
 */
export async function ensureSelectedServiceTarget(
  binaryPath: string,
  selection: SelectedService,
  linked: LinkedServicesIndex,
  globalStorageDir: string,
): Promise<InvocationTarget> {
  if (selection.kind === 'localConfig') {
    return { cwd: selection.folder, configPath: selection.configPath, isLinked: true };
  }
  return ensureServiceTarget(
    binaryPath,
    selection.serviceId,
    linked.get(selection.serviceId),
    globalStorageDir,
  );
}

async function isScratchConfigFresh(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(dir, '.partiri.jsonc'));
    return Date.now() - stat.mtimeMs < SCRATCH_CACHE_TTL_MS;
  } catch {
    return false;
  }
}
