import * as vscode from 'vscode';
import { runCli } from '../cli/run';
import { requireData } from '../cli/envelope';
import type { ContextData } from './contextTypes';

const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Caches `partiri -j llm context` for 5 minutes, matching the CLI's own
 * server-side cache window (docs/cli-contract.md §9) — pickers and tree
 * views should not re-fetch on every keystroke or render.
 */
export class ContextStore {
  private cache: ContextData | null = null;
  private lastFetchedAt = 0;
  private inFlight: Promise<ContextData | null> | null = null;
  private readonly emitter = new vscode.EventEmitter<ContextData | null>();
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly getBinaryPath: () => string | null,
    private readonly getInvocationTarget: () => { cwd: string; configPath: string },
  ) {}

  get(): Promise<ContextData | null> {
    const isFresh = this.cache !== null && Date.now() - this.lastFetchedAt < CACHE_TTL_MS;
    if (isFresh) {
      return Promise.resolve(this.cache);
    }
    return this.refresh();
  }

  refresh(): Promise<ContextData | null> {
    if (!this.inFlight) {
      this.inFlight = this.fetch().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async fetch(): Promise<ContextData | null> {
    const binaryPath = this.getBinaryPath();
    if (!binaryPath) {
      return null;
    }
    const { cwd, configPath } = this.getInvocationTarget();
    const envelope = await runCli<ContextData>(binaryPath, {
      cwd,
      configPath,
      args: ['llm', 'context'],
      mutating: false,
    });
    this.cache = requireData(envelope, 'workspace context');
    this.lastFetchedAt = Date.now();
    this.emitter.fire(this.cache);
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
    this.lastFetchedAt = 0;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
