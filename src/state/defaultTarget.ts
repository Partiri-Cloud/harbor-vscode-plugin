import * as os from 'node:os';
import * as vscode from 'vscode';

/**
 * cwd/--config for CLI subcommands that are not scoped to a specific
 * .partiri.jsonc (`llm context`, `llm whoami`, `llm doctor`,
 * `auth set-apikey`, …): the first workspace folder if one is open,
 * otherwise the user's home directory. docs/cli-contract.md §3 requires
 * cwd + --config on every invocation without carving out an exception for
 * these workspace-scoped helper commands.
 */
export function defaultInvocationTarget(): { cwd: string; configPath: string } {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
  return { cwd: folder, configPath: folder };
}
