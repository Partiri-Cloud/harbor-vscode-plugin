/**
 * Which service the Details/Monitoring/Logs/Recent Jobs sections follow, and
 * how that survives a reload.
 *
 * Split out of activate() because it is policy, not wiring: the rules about
 * what preselects, what persists, and which editor changes steal the selection
 * are worth reading — and testing — on their own.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  isPartiriConfigFilename,
  type LinkedServicesIndex,
  type WorkspaceConfigFile,
} from '../state/linkedServices';
import type { SelectedService, SelectedServiceStore } from '../state/selectedService';
import { configLabel } from '../views/localConfigsTree';

/** Workspace-scoped memory of the last selected config. */
export const SELECTED_CONFIG_KEY = 'partiri.selectedConfigPath';

/** The slice of `ExtensionContext.workspaceState` this needs — a plain object in tests. */
export interface SelectionMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface SelectionPolicyDeps {
  selectedService: SelectedServiceStore;
  linkedServices: LinkedServicesIndex;
  memento: SelectionMemento;
  /** Best-effort tree highlight. Injected so this module never touches TreeView. */
  reveal: (configPath: string) => void;
}

/**
 * Whether an editor change should steal the selection. Opening another config
 * switches to it; opening anything else leaves the current selection alone, so
 * the panels do not empty out as you navigate around the codebase.
 */
export function shouldFollowEditor(
  fsPath: string | undefined,
  current: SelectedService | undefined,
): boolean {
  if (!fsPath || !isPartiriConfigFilename(path.basename(fsPath))) {
    return false;
  }
  return !(current?.kind === 'localConfig' && current.configPath === fsPath);
}

export class ConfigSelectionPolicy {
  constructor(private readonly deps: SelectionPolicyDeps) {}

  selectConfig(config: WorkspaceConfigFile): void {
    this.deps.selectedService.select({
      kind: 'localConfig',
      folder: config.folder,
      configPath: config.configPath,
      serviceId: config.id,
      name: configLabel(config.configPath),
    });
    this.deps.reveal(config.configPath);
  }

  /**
   * The selection is remembered per workspace so it survives a reload — the
   * user should not have to re-pick a service, or keep its config open in an
   * editor, just to see its data. Falls back to the first known config when the
   * remembered one is gone.
   */
  restoreOrPreselect(): void {
    if (this.deps.selectedService.get()) {
      return;
    }
    const configs = this.deps.linkedServices.allConfigs();
    if (configs.length === 0) {
      return;
    }
    const savedPath = this.deps.memento.get<string>(SELECTED_CONFIG_KEY);
    const saved = savedPath ? configs.find((c) => c.configPath === savedPath) : undefined;
    const target = saved ?? configs[0];
    if (target) {
      this.selectConfig(target);
    }
  }

  handleActiveEditor(fsPath: string | undefined): void {
    if (!shouldFollowEditor(fsPath, this.deps.selectedService.get())) {
      return;
    }
    const config = this.deps.linkedServices.allConfigs().find((c) => c.configPath === fsPath);
    if (config) {
      this.selectConfig(config);
    }
  }

  /** Wire the policy to its event sources. Caller owns disposing the result. */
  register(): vscode.Disposable[] {
    return [
      this.deps.linkedServices.onDidChange(() => this.restoreOrPreselect()),
      this.deps.selectedService.onDidChange((selection) => {
        // Only local configs are remembered: a remote selection has no stable
        // on-disk identity to restore against on the next window.
        if (selection?.kind === 'localConfig') {
          void this.deps.memento.update(SELECTED_CONFIG_KEY, selection.configPath);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.handleActiveEditor(editor?.document.uri.fsPath);
      }),
    ];
  }
}
