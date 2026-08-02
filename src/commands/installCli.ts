import * as vscode from 'vscode';
import { checkVersion, findBinary, type InstallGuidance } from '../cli/discovery';

const INSTALL_TERMINAL_NAME = 'Partiri';

const POLL_INTERVAL_MS = 5_000;
const POLL_BUDGET_MS = 5 * 60_000;

export const INSTALL_IN_TERMINAL_LABEL = 'Install in terminal';
export const USE_NPM_INSTEAD_LABEL = 'Use npm instead';

export const CARGO_INSTALL_COMMAND = 'cargo install partiri-cli';
export const NPM_INSTALL_COMMAND = 'npm i -g @partiri/cli';

export interface PollUntilOptions {
  intervalMs: number;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `probe` on an interval until it resolves to a non-null value, or give
 * up once `timeoutMs` has elapsed. `probe` and `sleep` are both injected so
 * this stays unit-testable with fake timers, independent of vscode/CLI I/O.
 */
export async function pollUntil<T>(
  probe: () => Promise<T | null>,
  options: PollUntilOptions,
): Promise<T | null> {
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    await sleep(options.intervalMs);
    const result = await probe();
    if (result !== null) {
      return result;
    }
  }
  return null;
}

function getOrCreateInstallTerminal(): vscode.Terminal {
  const existing = vscode.window.terminals.find(
    (terminal) => terminal.name === INSTALL_TERMINAL_NAME,
  );
  return existing ?? vscode.window.createTerminal(INSTALL_TERMINAL_NAME);
}

export interface InstalledCli {
  binaryPath: string;
  version: string;
}

/** Re-runs discovery + the version handshake (docs/cli-contract.md §1-2). */
async function probeInstalledCli(): Promise<InstalledCli | null> {
  const setting = vscode.workspace.getConfiguration('partiri').get<string>('binaryPath');
  const discovery = await findBinary(setting);
  if (!discovery.binaryPath) {
    return null;
  }
  const version = await checkVersion(discovery.binaryPath);
  if (!version.meetsMinimum || !version.version) {
    return null;
  }
  return { binaryPath: discovery.binaryPath, version: version.version };
}

async function watchForInstall(
  onInstalled: () => Promise<void>,
  probe: () => Promise<InstalledCli | null>,
): Promise<void> {
  const installed = await pollUntil(probe, {
    intervalMs: POLL_INTERVAL_MS,
    timeoutMs: POLL_BUDGET_MS,
  });
  if (!installed) {
    // Budget expired: no error spam, just quietly stop polling.
    return;
  }
  void vscode.window.showInformationMessage(`Partiri CLI ${installed.version} installed.`);
  await onInstalled();
}

/**
 * One-click install affordance for a missing/outdated `partiri` CLI: a
 * warning notification offering to run the install command in a shared
 * "Partiri" terminal, then poll for a valid binary and re-run activation
 * gating (`onInstalled`) once one appears.
 *
 * `probe` defaults to the real discovery + version handshake; tests inject a
 * fake so this stays unit-testable without touching PATH or spawning a real
 * CLI (same DI pattern as `findBinary`'s `DiscoveryDeps`).
 */
export async function offerInstall(
  guidance: InstallGuidance,
  onInstalled: () => Promise<void>,
  probe: () => Promise<InstalledCli | null> = probeInstalledCli,
): Promise<void> {
  const npmAvailable = guidance.messages.includes(NPM_INSTALL_COMMAND);
  const items = npmAvailable
    ? [INSTALL_IN_TERMINAL_LABEL, USE_NPM_INSTEAD_LABEL]
    : [INSTALL_IN_TERMINAL_LABEL];

  const choice = await vscode.window.showWarningMessage(
    `Partiri CLI not found or needs updating. Install it: ${guidance.messages.join(' or ')}`,
    ...items,
  );

  if (choice !== INSTALL_IN_TERMINAL_LABEL && choice !== USE_NPM_INSTEAD_LABEL) {
    return;
  }

  const command = choice === USE_NPM_INSTEAD_LABEL ? NPM_INSTALL_COMMAND : CARGO_INSTALL_COMMAND;
  const terminal = getOrCreateInstallTerminal();
  terminal.show();
  terminal.sendText(command, true);

  await watchForInstall(onInstalled, probe);
}
