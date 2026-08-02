import * as vscode from 'vscode';
import { invokeCli } from '../cli/invoke';
import { runCli } from '../cli/run';
import { handleCliError } from '../cli/errors';
import { requireData } from '../cli/envelope';
import { defaultInvocationTarget } from '../state/defaultTarget';
import { quoteBinaryPath } from './terminalCommand';

export interface WhoamiData {
  key_path: string;
  key_configured: boolean;
  api_url: string;
  user_email: string | null;
  workspace_count: number;
}

interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error' | string;
  message: string;
  fix: string | null;
}

const POLL_INTERVAL_MS = 3_000;
const POLL_BUDGET_MS = 2 * 60_000;

export async function whoami(binaryPath: string): Promise<WhoamiData | undefined> {
  const { cwd, configPath } = defaultInvocationTarget();
  // Deliberately invokeCli, not runCli: "not signed in" is an answer here, not
  // an error to surface — the status bar and the login poll both read it.
  const envelope = await invokeCli<WhoamiData>(binaryPath, {
    cwd,
    configPath,
    args: ['llm', 'whoami'],
    mutating: false,
  });
  return envelope.ok === false ? undefined : envelope.data;
}

/**
 * partiri.login — never spawn `auth login` as a subprocess
 * (docs/cli-contract.md §7): run it in the integrated terminal, then poll
 * `llm whoami` until key_configured or the 2-minute budget expires.
 */
export async function login(binaryPath: string, onSignedIn: () => void): Promise<void> {
  const terminal = vscode.window.createTerminal('Partiri');
  terminal.show();
  terminal.sendText(`${quoteBinaryPath(binaryPath)} auth login`, true);

  const deadline = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const data = await whoami(binaryPath);
      if (data?.key_configured) {
        onSignedIn();
        return;
      }
    } catch {
      // Keep polling — a transient failure shouldn't abort the whole budget.
    }
  }
  void vscode.window.showWarningMessage(
    'Partiri: timed out waiting for login. Run "Partiri: Login" again once signed in.',
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * partiri.setApiKey — headless fallback (docs/cli-contract.md §7): masked
 * input box, piped via --key-stdin, never as an argv value.
 */
export async function setApiKey(binaryPath: string, onSignedIn: () => void): Promise<void> {
  const key = await vscode.window.showInputBox({
    prompt: 'Partiri API key',
    password: true,
    ignoreFocusOut: true,
  });
  if (!key) {
    return;
  }
  try {
    const { cwd, configPath } = defaultInvocationTarget();
    await runCli(binaryPath, {
      cwd,
      configPath,
      args: ['auth', 'set-apikey', '--key-stdin'],
      mutating: true,
      stdin: key,
    });
    void vscode.window.showInformationMessage('Partiri: API key configured.');
    onSignedIn();
  } catch (error) {
    await handleCliError(error);
  }
}

/** partiri.doctor — `-j llm doctor`, rendered in an OutputChannel + summary notification. */
export async function doctor(
  binaryPath: string,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  try {
    const { cwd, configPath } = defaultInvocationTarget();
    const envelope = await runCli<{ checks: DoctorCheck[] }>(binaryPath, {
      cwd,
      configPath,
      args: ['llm', 'doctor'],
      mutating: false,
    });

    outputChannel.clear();
    outputChannel.appendLine('Partiri doctor');
    outputChannel.appendLine('==============');
    const checks = requireData(envelope, 'doctor checks').checks;
    for (const check of checks) {
      outputChannel.appendLine(`[${check.status.toUpperCase()}] ${check.name}: ${check.message}`);
      if (check.fix) {
        outputChannel.appendLine(`  fix: ${check.fix}`);
      }
    }
    outputChannel.show(true);

    const failing = checks.filter((check) => check.status !== 'ok');
    if (failing.length === 0) {
      void vscode.window.showInformationMessage('Partiri: all doctor checks passed.');
    } else {
      void vscode.window.showWarningMessage(
        `Partiri: ${failing.length} doctor check(s) need attention. See the "Partiri" output channel.`,
      );
    }
  } catch (error) {
    await handleCliError(error);
  }
}
