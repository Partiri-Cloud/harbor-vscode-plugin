import * as vscode from 'vscode';
import type { ContextStore } from '../state/contextStore';
import type { ContextProject, ContextService, ContextWorkspace } from '../state/contextTypes';
import type { LinkedServicesIndex } from '../state/linkedServices';

interface WorkspaceNode {
  kind: 'workspace';
  workspace: ContextWorkspace;
}

interface ProjectNode {
  kind: 'project';
  workspace: ContextWorkspace;
  project: ContextProject;
}

interface ServiceNode {
  kind: 'service';
  workspace: ContextWorkspace;
  project: ContextProject;
  service: ContextService;
}

export type ResourceNode = WorkspaceNode | ProjectNode | ServiceNode;

/** Workspaces -> Projects -> Services, per the "New Service" wizard's own picker data. */
export class ResourcesTreeProvider implements vscode.TreeDataProvider<ResourceNode> {
  private readonly emitter = new vscode.EventEmitter<ResourceNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[];
  private messageSink: ((message: string | undefined) => void) | undefined;

  /** The TreeView owning this provider is created after it, so it wires the sink in. */
  setMessageSink(sink: (message: string | undefined) => void): void {
    this.messageSink = sink;
  }

  constructor(
    private readonly contextStore: ContextStore,
    private readonly linkedServices: LinkedServicesIndex,
  ) {
    this.subscriptions = [
      contextStore.onDidChange(() => this.emitter.fire(undefined)),
      linkedServices.onDidChange(() => this.emitter.fire(undefined)),
    ];
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  async getChildren(element?: ResourceNode): Promise<ResourceNode[]> {
    if (!element) {
      // Two indicators, because a tree can render neither itself: withProgress
      // on the view id drives the spinner in the section header, and the
      // TreeView's own `message` carries the text.
      this.messageSink?.('Loading workspaces…');
      const data = await vscode.window.withProgress(
        { location: { viewId: 'partiriResources' } },
        () => this.contextStore.get().catch(() => null),
      );
      const workspaces = data?.workspaces ?? [];
      this.messageSink?.(
        data === null
          ? 'Could not load resources — run "Partiri: Doctor" to diagnose.'
          : workspaces.length === 0
            ? 'No workspaces found.'
            : undefined,
      );
      return workspaces.map((workspace) => ({
        kind: 'workspace' as const,
        workspace,
      }));
    }
    if (element.kind === 'workspace') {
      return element.workspace.projects.map((project) => ({
        kind: 'project' as const,
        workspace: element.workspace,
        project,
      }));
    }
    if (element.kind === 'project') {
      return element.workspace.services
        .filter((service) => service.fk_project === element.project.id)
        .map((service) => ({
          kind: 'service' as const,
          workspace: element.workspace,
          project: element.project,
          service,
        }));
    }
    return [];
  }

  getTreeItem(element: ResourceNode): vscode.TreeItem {
    if (element.kind === 'workspace') {
      return this.workspaceItem(element.workspace);
    }
    if (element.kind === 'project') {
      return this.projectItem(element.project);
    }
    return this.serviceItem(element.service);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.emitter.dispose();
  }

  private workspaceItem(workspace: ContextWorkspace): vscode.TreeItem {
    const item = new vscode.TreeItem(workspace.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `workspace:${workspace.id}`;
    item.contextValue = 'workspace';
    item.iconPath = new vscode.ThemeIcon('organization');
    return item;
  }

  private projectItem(project: ContextProject): vscode.TreeItem {
    const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `project:${project.id}`;
    item.contextValue = 'project';
    item.description = project.environment;
    item.iconPath = new vscode.ThemeIcon('folder');
    return item;
  }

  private serviceItem(service: ContextService): vscode.TreeItem {
    const linked = this.linkedServices.get(service.id);
    const item = new vscode.TreeItem(service.name, vscode.TreeItemCollapsibleState.None);
    item.id = `service:${service.id}`;
    item.contextValue = linked ? 'service-linked' : 'service';
    item.description = service.deploy_type;
    item.tooltip = `${service.runtime} · ${service.deploy_type}${linked ? ' · linked' : ''}`;
    item.iconPath = new vscode.ThemeIcon(linked ? 'link' : 'circle-large-outline');
    return item;
  }
}
