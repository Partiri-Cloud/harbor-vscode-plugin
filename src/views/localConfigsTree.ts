import * as path from 'node:path';
import * as vscode from 'vscode';
import type { LinkedServicesIndex, WorkspaceConfigFile } from '../state/linkedServices';

export interface ConfigFileNode {
  kind: 'config';
  config: WorkspaceConfigFile;
  parent: ConfigFolderNode | undefined;
}

export interface ConfigFolderNode {
  kind: 'folder';
  /** Possibly several path segments, when a chain of folders was compacted. */
  label: string;
  directory: string;
  children: LocalConfigNode[];
  count: number;
  parent: ConfigFolderNode | undefined;
}

export type LocalConfigNode = ConfigFileNode | ConfigFolderNode;

/** Below this many configs a flat list is easier to scan than a folder tree. */
const GROUPING_THRESHOLD = 3;

/**
 * Derive a short label from the config's filename: `web.partiri.jsonc` -> "web",
 * and the bare `.partiri.jsonc` -> its containing folder's name. Avoids parsing
 * the config just to title a tree row.
 */
export function configLabel(configPath: string): string {
  const base = path.basename(configPath);
  if (base === '.partiri.jsonc') {
    return path.basename(path.dirname(configPath));
  }
  return base.slice(0, -'.partiri.jsonc'.length);
}

interface TrieNode {
  folders: Map<string, TrieNode>;
  configs: WorkspaceConfigFile[];
}

function emptyTrie(): TrieNode {
  return { folders: new Map(), configs: [] };
}

function insert(trie: TrieNode, segments: string[], config: WorkspaceConfigFile): void {
  let current = trie;
  for (const segment of segments) {
    let next = current.folders.get(segment);
    if (!next) {
      next = emptyTrie();
      current.folders.set(segment, next);
    }
    current = next;
  }
  current.configs.push(config);
}

/**
 * Convert a trie level into tree nodes, applying two compactions so a deeply
 * nested config doesn't cost one row per path segment:
 *  - a folder holding exactly one subfolder and no configs merges into it
 *    (`examples/node` rather than `examples` > `node`);
 *  - a folder holding exactly one config and no subfolders collapses to that
 *    config, since the row would otherwise just repeat the folder name.
 */
function toNodes(
  trie: TrieNode,
  directory: string,
  parent: ConfigFolderNode | undefined,
): LocalConfigNode[] {
  const nodes: LocalConfigNode[] = [];

  for (const [segment, child] of [...trie.folders.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    let label = segment;
    let node = child;
    let nodeDirectory = path.join(directory, segment);
    while (node.configs.length === 0 && node.folders.size === 1) {
      const [onlySegment, onlyChild] = [...node.folders.entries()][0] as [string, TrieNode];
      label = `${label}/${onlySegment}`;
      nodeDirectory = path.join(nodeDirectory, onlySegment);
      node = onlyChild;
    }

    if (node.folders.size === 0 && node.configs.length === 1) {
      nodes.push({ kind: 'config', config: node.configs[0] as WorkspaceConfigFile, parent });
      continue;
    }

    const folder: ConfigFolderNode = {
      kind: 'folder',
      label,
      directory: nodeDirectory,
      children: [],
      count: 0,
      parent,
    };
    folder.children = toNodes(node, nodeDirectory, folder);
    folder.count = countConfigs(folder.children);
    nodes.push(folder);
  }

  for (const config of [...trie.configs].sort((a, b) => a.configPath.localeCompare(b.configPath))) {
    nodes.push({ kind: 'config', config, parent });
  }

  // Folders first, then configs, each alphabetically — the collapse rules above
  // can turn a folder into a config, so ordering has to be settled at the end.
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'folder' ? -1 : 1;
    }
    return nodeLabel(a).localeCompare(nodeLabel(b));
  });
}

function nodeLabel(node: LocalConfigNode): string {
  return node.kind === 'folder' ? node.label : configLabel(node.config.configPath);
}

function countConfigs(nodes: LocalConfigNode[]): number {
  return nodes.reduce(
    (total, node) => total + (node.kind === 'config' ? 1 : countConfigs(node.children)),
    0,
  );
}

/** Build the visible tree: flat while small, folder-grouped once it would sprawl. */
export function buildConfigTree(
  configs: WorkspaceConfigFile[],
  workspaceRoots: string[],
): LocalConfigNode[] {
  if (configs.length <= GROUPING_THRESHOLD) {
    return [...configs]
      .sort((a, b) => a.configPath.localeCompare(b.configPath))
      .map((config) => ({ kind: 'config' as const, config, parent: undefined }));
  }

  const trie = emptyTrie();
  for (const config of configs) {
    const root = workspaceRoots.find((candidate) =>
      config.configPath.startsWith(candidate + path.sep),
    );
    const relative = root ? path.relative(root, path.dirname(config.configPath)) : '';
    const segments = relative && relative !== '.' ? relative.split(path.sep) : [];
    insert(trie, segments, config);
  }
  return toNodes(trie, workspaceRoots[0] ?? '', undefined);
}

/**
 * Every `.partiri.jsonc` / `name.partiri.jsonc` in the open workspace. Selecting
 * a row makes that service active for the sections below — the selection itself
 * is wired via TreeView.onDidChangeSelection in extension.ts.
 */
export class LocalConfigsTreeProvider implements vscode.TreeDataProvider<LocalConfigNode> {
  private readonly emitter = new vscode.EventEmitter<LocalConfigNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[];
  private roots: LocalConfigNode[] = [];
  private messageSink: ((message: string | undefined) => void) | undefined;

  /** The TreeView owning this provider is created after it, so it wires the sink in. */
  setMessageSink(sink: (message: string | undefined) => void): void {
    this.messageSink = sink;
  }

  constructor(private readonly linkedServices: LinkedServicesIndex) {
    this.subscriptions = [
      linkedServices.onDidChange(() => {
        this.roots = [];
        this.emitter.fire(undefined);
      }),
    ];
  }

  refresh(): void {
    this.roots = [];
    this.emitter.fire(undefined);
  }

  getParent(element: LocalConfigNode): LocalConfigNode | undefined {
    return element.parent;
  }

  /** Locate a built node by config path, so callers can reveal it. */
  findConfigNode(configPath: string): ConfigFileNode | undefined {
    const search = (nodes: LocalConfigNode[]): ConfigFileNode | undefined => {
      for (const node of nodes) {
        if (node.kind === 'config') {
          if (node.config.configPath === configPath) {
            return node;
          }
        } else {
          const hit = search(node.children);
          if (hit) {
            return hit;
          }
        }
      }
      return undefined;
    };
    return search(this.ensureRoots());
  }

  async getChildren(element?: LocalConfigNode): Promise<LocalConfigNode[]> {
    if (element) {
      return element.kind === 'folder' ? element.children : [];
    }
    // Scanning the workspace takes real time on a large tree, so say so rather
    // than rendering an empty list that reads as "nothing found".
    this.messageSink?.('Searching for service configs…');
    await vscode.window.withProgress({ location: { viewId: 'partiriLocalConfigs' } }, () =>
      this.linkedServices.whenReady(),
    );
    const roots = this.ensureRoots();
    this.messageSink?.(undefined);
    return roots;
  }

  private ensureRoots(): LocalConfigNode[] {
    if (this.roots.length === 0) {
      const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map(
        (folder) => folder.uri.fsPath,
      );
      this.roots = buildConfigTree(this.linkedServices.allConfigs(), workspaceRoots);
    }
    return this.roots;
  }

  getTreeItem(element: LocalConfigNode): vscode.TreeItem {
    if (element.kind === 'folder') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `configFolder:${element.directory}`;
      item.contextValue = 'configFolder';
      item.description = `${element.count}`;
      item.tooltip = `${element.directory}\n${element.count} service config(s)`;
      item.iconPath = vscode.ThemeIcon.Folder;
      return item;
    }

    const { config } = element;
    const item = new vscode.TreeItem(
      configLabel(config.configPath),
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = `localConfig:${config.configPath}`;
    item.resourceUri = vscode.Uri.file(config.configPath);
    item.contextValue = config.id ? 'localConfig' : 'localConfig-uncreated';
    const relative = vscode.workspace.asRelativePath(config.configPath);
    item.description = config.id ? relative : `${relative} · not created`;
    item.tooltip = config.id
      ? `${config.configPath}\nservice ${config.id}`
      : `${config.configPath}\nNot created on Partiri yet — deploy to create it.`;
    item.iconPath = new vscode.ThemeIcon(config.id ? 'link' : 'circle-large-outline');
    // Clicking both selects (via the view's selection event) and opens the file.
    item.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [vscode.Uri.file(config.configPath)],
    };
    return item;
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.emitter.dispose();
  }
}
