import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { registerCommands, type RegisterCommandsDeps } from '../src/commands/register';
import type { ResourceNode } from '../src/views/resourcesTree';
import { SelectedServiceStore } from '../src/state/selectedService';
import { __registeredCommands, __resetCommands } from './mocks/vscode';

const PACKAGE_JSON = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as {
  contributes: { commands: { command: string }[]; menus: Record<string, { command?: string }[]> };
};

let subscriptions: { dispose: () => void }[];
let selectedService: SelectedServiceStore;
let warnings: string[];

function panel() {
  return {
    refresh: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
  };
}

function register(overrides: Partial<RegisterCommandsDeps> = {}): void {
  const deps = {
    outputChannel: vscode.window.createOutputChannel('test'),
    contextStore: { invalidate: vi.fn(), refresh: vi.fn().mockResolvedValue(null) },
    linkedServices: { refresh: vi.fn(), all: () => [], allConfigs: () => [], get: () => undefined },
    selectedService,
    resourcesTree: { refresh: vi.fn() },
    localConfigsTree: { refresh: vi.fn() },
    recentJobsTree: { refresh: vi.fn() },
    detailsView: panel(),
    monitoringView: panel(),
    logsView: panel(),
    statusBar: { refresh: vi.fn() },
    serviceActionCtx: {},
    resourceActionCtx: {},
    getBinaryPath: () => '/usr/bin/partiri',
    resolveBinaryAndActivate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RegisterCommandsDeps;

  registerCommands({ subscriptions } as unknown as vscode.ExtensionContext, deps);
}

beforeEach(() => {
  __resetCommands();
  subscriptions = [];
  selectedService = new SelectedServiceStore();
  warnings = [];
  vi.spyOn(vscode.window, 'showWarningMessage').mockImplementation((message: unknown) => {
    warnings.push(String(message));
    return Promise.resolve(undefined);
  });
});

describe('command registration', () => {
  /**
   * A command declared in package.json but never registered shows up in the
   * palette and throws "command not found" when picked.
   */
  it('registers every command declared in package.json', () => {
    register();
    const registered = new Set(__registeredCommands().keys());
    const declared = PACKAGE_JSON.contributes.commands.map((c) => c.command);

    expect(declared.filter((id) => !registered.has(id))).toEqual([]);
  });

  it('registers every command referenced by a menu contribution', () => {
    register();
    const registered = new Set(__registeredCommands().keys());
    const menuCommands = Object.values(PACKAGE_JSON.contributes.menus)
      .flat()
      .map((entry) => entry.command)
      .filter((id): id is string => Boolean(id));

    expect([...new Set(menuCommands)].filter((id) => !registered.has(id))).toEqual([]);
  });

  it('pushes a disposable for every registration', () => {
    register();
    expect(subscriptions.length).toBe(__registeredCommands().size);
  });
});

describe('withWorkspaceId', () => {
  const run = async (id: string, node?: ResourceNode): Promise<void> => {
    await __registeredCommands().get(id)?.(node);
  };

  it('warns instead of acting when the node is not a workspace', async () => {
    register();
    await run('partiri.createProject', { kind: 'service' } as ResourceNode);
    expect(warnings).toEqual(['Partiri: select a workspace first.']);
  });

  it('warns when invoked with no node at all (e.g. from the palette)', async () => {
    register();
    await run('partiri.createProject', undefined);
    expect(warnings).toEqual(['Partiri: select a workspace first.']);
  });

  it('applies to all three workspace-scoped commands', async () => {
    register();
    for (const id of [
      'partiri.createProject',
      'partiri.createRegistrySecret',
      'partiri.createRepositorySecret',
    ]) {
      warnings = [];
      await run(id, undefined);
      expect(warnings, `${id} should guard on the workspace node`).toEqual([
        'Partiri: select a workspace first.',
      ]);
    }
  });
});

describe('withServiceId', () => {
  it('warns when there is no node, no selection, and no linked config', async () => {
    register();
    await __registeredCommands().get('partiri.pause')?.(undefined);
    expect(warnings).toEqual(['Partiri: no linked service found for this command.']);
  });

  /** A selection is the fallback when the user runs a command from the palette. */
  it('falls back to the current selection when no node was clicked', async () => {
    selectedService.select({ kind: 'remote', serviceId: 'svc-selected', name: 'api' });
    register();
    await __registeredCommands().get('partiri.pause')?.(undefined);
    expect(warnings).toEqual([]);
  });
});

describe('the interactive binary guard', () => {
  it('reports a missing CLI and offers to install rather than throwing', async () => {
    const errors: string[] = [];
    vi.spyOn(vscode.window, 'showErrorMessage').mockImplementation((message: unknown) => {
      errors.push(String(message));
      return Promise.resolve(undefined);
    });
    register({ getBinaryPath: () => null });

    await __registeredCommands().get('partiri.initWizard')?.();

    expect(errors).toEqual(['Partiri: CLI not found or version too old.']);
  });
});
