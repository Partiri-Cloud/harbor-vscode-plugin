import { describe, expect, it } from 'vitest';
import { buildConfigTree, configLabel } from '../src/views/localConfigsTree';
import type { ConfigFolderNode, LocalConfigNode } from '../src/views/localConfigsTree';
import type { WorkspaceConfigFile } from '../src/state/linkedServices';

const ROOT = '/ws';

function cfg(relative: string, id?: string): WorkspaceConfigFile {
  const configPath = `${ROOT}/${relative}`;
  return { id, folder: configPath.slice(0, configPath.lastIndexOf('/')), configPath };
}

function labelsOf(nodes: LocalConfigNode[]): string[] {
  return nodes.map((node) =>
    node.kind === 'folder' ? `${node.label}/ (${node.count})` : configLabel(node.config.configPath),
  );
}

describe('configLabel', () => {
  it('uses the folder name for a bare .partiri.jsonc and the prefix otherwise', () => {
    expect(configLabel('/ws/api/.partiri.jsonc')).toBe('api');
    expect(configLabel('/ws/svc/web.partiri.jsonc')).toBe('web');
  });
});

describe('buildConfigTree', () => {
  it('stays flat at or below the grouping threshold', () => {
    const nodes = buildConfigTree(
      [cfg('a/.partiri.jsonc'), cfg('b/.partiri.jsonc'), cfg('c/.partiri.jsonc')],
      [ROOT],
    );
    expect(nodes.every((node) => node.kind === 'config')).toBe(true);
    expect(labelsOf(nodes)).toEqual(['a', 'b', 'c']);
  });

  it('groups into collapsible folders once it would sprawl', () => {
    const nodes = buildConfigTree(
      [
        cfg('api/.partiri.jsonc'),
        cfg('examples/node/one/.partiri.jsonc'),
        cfg('examples/node/two/.partiri.jsonc'),
        cfg('examples/rust/three/.partiri.jsonc'),
      ],
      [ROOT],
    );
    // `examples` groups; the root-level config stays a leaf.
    expect(labelsOf(nodes)).toEqual(['examples/ (3)', 'api']);
    const examples = nodes.find((n): n is ConfigFolderNode => n.kind === 'folder');
    expect(labelsOf(examples!.children)).toEqual(['node/ (2)', 'three']);
  });

  it('collapses a folder holding a single config into that config', () => {
    const nodes = buildConfigTree(
      [
        cfg('deep/nested/only/.partiri.jsonc'),
        cfg('a/.partiri.jsonc'),
        cfg('b/.partiri.jsonc'),
        cfg('c/.partiri.jsonc'),
      ],
      [ROOT],
    );
    // One row for the deep single config, not one row per path segment.
    expect(labelsOf(nodes)).toContain('only');
    expect(labelsOf(nodes).some((label) => label.startsWith('deep'))).toBe(false);
  });

  it('keeps sibling configs in one folder together', () => {
    const nodes = buildConfigTree(
      [
        cfg('svc/api.partiri.jsonc'),
        cfg('svc/worker.partiri.jsonc'),
        cfg('svc/web.partiri.jsonc'),
        cfg('other/.partiri.jsonc'),
      ],
      [ROOT],
    );
    const svc = nodes.find((n): n is ConfigFolderNode => n.kind === 'folder' && n.label === 'svc');
    expect(svc?.count).toBe(3);
    expect(labelsOf(svc!.children)).toEqual(['api', 'web', 'worker']);
  });

  it('sets parent pointers so the tree can reveal a nested node', () => {
    const nodes = buildConfigTree(
      [
        cfg('svc/api.partiri.jsonc'),
        cfg('svc/worker.partiri.jsonc'),
        cfg('a/.partiri.jsonc'),
        cfg('b/.partiri.jsonc'),
      ],
      [ROOT],
    );
    const svc = nodes.find((n): n is ConfigFolderNode => n.kind === 'folder')!;
    expect(svc.parent).toBeUndefined();
    expect(svc.children.every((child) => child.parent === svc)).toBe(true);
  });
});
