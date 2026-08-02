import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigSelectionPolicy,
  SELECTED_CONFIG_KEY,
  shouldFollowEditor,
  type SelectionMemento,
} from '../src/activation/selectionPolicy';
import type { LinkedServicesIndex, WorkspaceConfigFile } from '../src/state/linkedServices';
import { SelectedServiceStore } from '../src/state/selectedService';

const API: WorkspaceConfigFile = {
  folder: '/w/api',
  configPath: '/w/api/.partiri.jsonc',
  id: 'svc-api',
};
const WEB: WorkspaceConfigFile = {
  folder: '/w/web',
  configPath: '/w/web/web.partiri.jsonc',
  id: 'svc-web',
};

function memento(initial: Record<string, unknown> = {}): SelectionMemento & {
  store: Record<string, unknown>;
} {
  const store = { ...initial };
  return {
    store,
    get: <T>(key: string) => store[key] as T | undefined,
    update: (key, value) => {
      store[key] = value;
      return Promise.resolve();
    },
  };
}

let selectedService: SelectedServiceStore;
let reveal: (configPath: string) => void;
let revealed: string[];

function policyOver(configs: WorkspaceConfigFile[], mem = memento()): ConfigSelectionPolicy {
  return new ConfigSelectionPolicy({
    selectedService,
    linkedServices: {
      allConfigs: () => configs,
      onDidChange: () => ({ dispose: () => {} }),
    } as unknown as LinkedServicesIndex,
    memento: mem,
    reveal,
  });
}

beforeEach(() => {
  selectedService = new SelectedServiceStore();
  revealed = [];
  reveal = (configPath) => revealed.push(configPath);
});

describe('shouldFollowEditor', () => {
  it('follows a config file', () => {
    expect(shouldFollowEditor('/w/api/.partiri.jsonc', undefined)).toBe(true);
    expect(shouldFollowEditor('/w/web/web.partiri.jsonc', undefined)).toBe(true);
  });

  /** Opening a source file must not empty the panels as you navigate. */
  it('ignores anything that is not a partiri config', () => {
    expect(shouldFollowEditor('/w/api/src/index.ts', undefined)).toBe(false);
    expect(shouldFollowEditor('/w/api/package.json', undefined)).toBe(false);
    expect(shouldFollowEditor(undefined, undefined)).toBe(false);
  });

  it('is a no-op when that config is already selected', () => {
    expect(
      shouldFollowEditor('/w/api/.partiri.jsonc', {
        kind: 'localConfig',
        folder: '/w/api',
        configPath: '/w/api/.partiri.jsonc',
        name: 'api',
      }),
    ).toBe(false);
  });

  it('switches away from a different config', () => {
    expect(
      shouldFollowEditor('/w/web/web.partiri.jsonc', {
        kind: 'localConfig',
        folder: '/w/api',
        configPath: '/w/api/.partiri.jsonc',
        name: 'api',
      }),
    ).toBe(true);
  });

  it('switches away from a remote selection', () => {
    expect(
      shouldFollowEditor('/w/api/.partiri.jsonc', {
        kind: 'remote',
        serviceId: 'svc-1',
        name: 'api',
      }),
    ).toBe(true);
  });
});

describe('restoreOrPreselect', () => {
  it('restores the config remembered for this workspace', () => {
    policyOver([API, WEB], memento({ [SELECTED_CONFIG_KEY]: WEB.configPath })).restoreOrPreselect();
    expect(selectedService.get()).toMatchObject({
      kind: 'localConfig',
      configPath: WEB.configPath,
      serviceId: 'svc-web',
    });
  });

  /** The remembered file may have been deleted or renamed since last session. */
  it('falls back to the first config when the remembered path is gone', () => {
    policyOver(
      [API, WEB],
      memento({ [SELECTED_CONFIG_KEY]: '/w/deleted.partiri.jsonc' }),
    ).restoreOrPreselect();
    expect(selectedService.get()).toMatchObject({ configPath: API.configPath });
  });

  it('preselects the first config when nothing was remembered', () => {
    policyOver([API, WEB]).restoreOrPreselect();
    expect(selectedService.get()).toMatchObject({ configPath: API.configPath });
  });

  it('does not override a selection the user already made', () => {
    selectedService.select({ kind: 'remote', serviceId: 'svc-chosen', name: 'chosen' });
    policyOver([API, WEB]).restoreOrPreselect();
    expect(selectedService.get()).toMatchObject({ serviceId: 'svc-chosen' });
  });

  it('selects nothing when the workspace has no configs', () => {
    policyOver([]).restoreOrPreselect();
    expect(selectedService.get()).toBeUndefined();
  });

  it('reveals the restored config in the tree', () => {
    policyOver([API]).restoreOrPreselect();
    expect(revealed).toEqual([API.configPath]);
  });
});

describe('handleActiveEditor', () => {
  it('selects the config that was opened', () => {
    policyOver([API, WEB]).handleActiveEditor(WEB.configPath);
    expect(selectedService.get()).toMatchObject({ configPath: WEB.configPath });
  });

  it('leaves the selection alone for a non-config file', () => {
    const policy = policyOver([API, WEB]);
    policy.handleActiveEditor(API.configPath);
    policy.handleActiveEditor('/w/api/src/index.ts');
    expect(selectedService.get()).toMatchObject({ configPath: API.configPath });
  });

  /** A config outside the index (not yet scanned) must not clear the selection. */
  it('ignores a config file the index does not know about', () => {
    const policy = policyOver([API]);
    policy.handleActiveEditor(API.configPath);
    policy.handleActiveEditor('/elsewhere/.partiri.jsonc');
    expect(selectedService.get()).toMatchObject({ configPath: API.configPath });
  });
});

describe('persistence', () => {
  it('remembers a local config selection', () => {
    const mem = memento();
    const policy = policyOver([API], mem);
    const subscriptions = policy.register();

    policy.selectConfig(API);

    expect(mem.store[SELECTED_CONFIG_KEY]).toBe(API.configPath);
    subscriptions.forEach((s) => s.dispose());
  });

  /** A remote selection has no stable on-disk identity to restore against. */
  it('does not remember a remote selection', () => {
    const mem = memento();
    const subscriptions = policyOver([API], mem).register();

    selectedService.select({ kind: 'remote', serviceId: 'svc-1', name: 'api' });

    expect(mem.store[SELECTED_CONFIG_KEY]).toBeUndefined();
    subscriptions.forEach((s) => s.dispose());
  });
});
