import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseJsonc } from './jsonc';

/** Deep enough for the common `examples/<lang>/<project>/.partiri.jsonc` layout. */
const MAX_SCAN_DEPTH = 4;

/** Directories never worth descending into, and expensive when they are large. */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'target',
  'dist',
  'build',
  'out',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
  '.next',
  '.nuxt',
  '.gradle',
  'coverage',
  'obj',
]);

async function scanDirectory(directory: string, depth: number, found: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    // Unreadable directory (permissions, races) — skip it, never fail the scan.
    return;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_SCAN_DEPTH && !SKIP_DIRECTORIES.has(entry.name)) {
        await scanDirectory(full, depth + 1, found);
      }
    } else if (entry.isFile() && isPartiriConfigFilename(entry.name)) {
      found.push(full);
    }
  }
}

/**
 * Walk each workspace folder directly, bounded by depth and a skip list. This
 * exists because `findFiles` applies the user's search excludes and .gitignore,
 * which routinely hide `.partiri.jsonc`.
 */
async function scanWorkspaceFolders(): Promise<string[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const found: string[] = [];
  await Promise.all(folders.map((folder) => scanDirectory(folder.uri.fsPath, 0, found)));
  return found;
}

export interface LinkedService {
  /** The service UUID from the .partiri.jsonc `id` field. Absent (null) until first created. */
  id: string;
  /** Folder containing the .partiri.jsonc — used as both cwd and --config. */
  folder: string;
  configPath: string;
}

/**
 * Superset of LinkedService: every discovered config file, whether or not it
 * has claimed a service id yet (a fresh wizard-written config has none until
 * its first deploy). LinkedService.id stays a required string so existing
 * id-keyed callers (resolveTarget, command handlers) are unaffected.
 */
export interface WorkspaceConfigFile {
  id?: string;
  folder: string;
  configPath: string;
}

/**
 * Deliberately NOT `isRecord` from src/util/records.ts: this one admits arrays.
 * A `.partiri.jsonc` whose root is an array is still a config file we index (it
 * shows in the tree as having no service id yet); tightening this would make
 * such files silently vanish from Local Configs.
 */
function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * True for `.partiri.jsonc` and any `name.partiri.jsonc` sibling form
 * (docs/lsp.md — matching both forms is a deliberate decision, not just the
 * dotfile).
 */
export function isPartiriConfigFilename(name: string): boolean {
  return name.length > 0 && name.endsWith('.partiri.jsonc');
}

/**
 * Scans the workspace for .partiri.jsonc files at any depth (docs/lsp.md
 * document selector) and maps service id -> local folder, so tree/command
 * handlers can tell a "linked" service (has a local config) from one only
 * known via `llm context` (docs/cli-contract.md §8).
 */
export class LinkedServicesIndex {
  private byServiceId = new Map<string, LinkedService>();
  private configs: WorkspaceConfigFile[] = [];
  private pending: Promise<void> | undefined;
  private hasScanned = false;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  get(serviceId: string): LinkedService | undefined {
    return this.byServiceId.get(serviceId);
  }

  all(): LinkedService[] {
    return [...this.byServiceId.values()];
  }

  /** Every discovered config file, id or not — feeds the Local Configs tree. */
  allConfigs(): WorkspaceConfigFile[] {
    return [...this.configs].sort((a, b) => a.configPath.localeCompare(b.configPath));
  }

  /** Resolves when any in-flight scan finishes; immediate when idle. */
  whenReady(): Promise<void> {
    return this.pending ?? Promise.resolve();
  }

  /** False until the first scan has completed — distinguishes "empty" from "not looked yet". */
  get scanned(): boolean {
    return this.hasScanned;
  }

  async refresh(): Promise<void> {
    this.pending = this.runRefresh();
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
      this.hasScanned = true;
    }
  }

  private async runRefresh(): Promise<void> {
    // Two calls rather than one combined glob: VS Code's glob engine does
    // not reliably match a leading-dot basename with `*`, so relying on a
    // single `**/*.partiri.jsonc` pattern to also catch `.partiri.jsonc` is
    // unsafe (docs/lsp.md).
    const [dotFiles, namedFiles] = await Promise.all([
      vscode.workspace.findFiles('**/.partiri.jsonc', '**/node_modules/**'),
      vscode.workspace.findFiles('**/*.partiri.jsonc', '**/node_modules/**'),
    ]);

    const paths = new Set<string>();
    for (const file of [...dotFiles, ...namedFiles]) {
      paths.add(file.fsPath);
    }
    // findFiles honours .gitignore, and ignoring `.partiri.jsonc` is common —
    // so a config the user can plainly see on disk would otherwise never
    // appear. The direct scan below has no such filter.
    for (const found of await scanWorkspaceFolders()) {
      paths.add(found);
    }

    // Discovery order is not guaranteed; sort so duplicate ids resolve the
    // same way on every refresh instead of racing on it.
    const sorted = [...paths].sort((a, b) => a.localeCompare(b)).map((p) => vscode.Uri.file(p));

    const configs: WorkspaceConfigFile[] = [];
    const next = new Map<string, LinkedService>();
    for (const file of sorted) {
      const entry = await tryReadConfigFile(file);
      if (!entry) {
        continue;
      }
      configs.push(entry);
      // First occurrence wins: skip subsequent files that declare an id
      // already claimed by an earlier (sorted) file.
      if (entry.id && !next.has(entry.id)) {
        next.set(entry.id, { id: entry.id, folder: entry.folder, configPath: entry.configPath });
      }
    }
    this.configs = configs;
    this.byServiceId = next;
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

async function tryReadConfigFile(file: vscode.Uri): Promise<WorkspaceConfigFile | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(file);
    const parsed = parseJsonc(Buffer.from(bytes).toString('utf8'));
    if (!isNonNullObject(parsed)) {
      return undefined;
    }
    const id = typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : undefined;
    return { id, folder: path.dirname(file.fsPath), configPath: file.fsPath };
  } catch {
    return undefined;
  }
}

/**
 * Resolve the target .partiri.jsonc for a command invoked without a tree
 * item (e.g. command palette): active editor -> the single linked service
 * -> a QuickPick among linked services (docs deliverable item 7).
 */
export async function resolveTarget(
  index: LinkedServicesIndex,
): Promise<LinkedService | undefined> {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri && isPartiriConfigFilename(path.basename(activeUri.fsPath))) {
    const match = index.all().find((entry) => entry.configPath === activeUri.fsPath);
    if (match) {
      return match;
    }
  }

  const services = index.all();
  if (services.length === 1) {
    return services[0];
  }
  if (services.length === 0) {
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    services.map((entry) => ({
      label: entry.id,
      description: entry.folder,
      entry,
    })),
    { placeHolder: 'Select a Partiri service' },
  );
  return picked?.entry;
}
