import * as vscode from 'vscode';

/**
 * The one service the Actions, Monitoring, and Logs sections follow. A
 * `localConfig` may be id-less (a fresh wizard-written config, before its
 * first deploy) — Deploy still works against it, but actions that need a
 * real id (Pause/Unpause) are gated on `selectedServiceId`.
 */
export type SelectedService =
  | { kind: 'remote'; serviceId: string; name: string }
  | { kind: 'localConfig'; folder: string; configPath: string; serviceId?: string; name: string };

export function selectedServiceId(s: SelectedService | undefined): string | undefined {
  return s?.serviceId;
}

/**
 * Stable identity for a selection, used by the panels to tell "same service,
 * background refresh" from "user picked something else" — the former must not
 * flash a spinner over content already on screen.
 *
 * Keyed on configPath rather than serviceId for local configs: two files can
 * carry the same id, and they are different selections.
 */
export function selectionKey(selection: SelectedService): string {
  return selection.kind === 'remote'
    ? `remote:${selection.serviceId}`
    : `local:${selection.configPath}`;
}

/**
 * Follows the EventEmitter convention of ContextStore (contextStore.ts:17-18)
 * and LinkedServicesIndex (linkedServices.ts) exactly: private emitter,
 * public readonly onDidChange, dispose() disposes the emitter.
 */
export class SelectedServiceStore {
  private current: SelectedService | undefined;
  private readonly emitter = new vscode.EventEmitter<SelectedService | undefined>();
  readonly onDidChange = this.emitter.event;

  get(): SelectedService | undefined {
    return this.current;
  }

  select(next: SelectedService | undefined): void {
    this.current = next;
    this.emitter.fire(this.current);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
