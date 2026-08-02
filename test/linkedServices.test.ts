import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPartiriConfigFilename, LinkedServicesIndex } from '../src/state/linkedServices';
import * as vscodeMock from './mocks/vscode';
import {
  Uri,
  __setFileContents,
  __setFindFilesResult,
  __setFindFilesResultFor,
} from './mocks/vscode';

beforeEach(() => {
  __setFindFilesResult([]);
  __setFileContents({});
});

describe('LinkedServicesIndex', () => {
  it('picks the first occurrence (by sorted fsPath) when two configs share an id', async () => {
    const first = Uri.file('/workspace/a/.partiri.jsonc');
    const second = Uri.file('/workspace/b/.partiri.jsonc');
    // Deliberately unsorted findFiles order — refresh() must sort before
    // resolving duplicates, so the result is deterministic either way.
    __setFindFilesResult([second, first]);
    __setFileContents({
      '/workspace/a/.partiri.jsonc': '{ "id": "svc-1" }',
      '/workspace/b/.partiri.jsonc': '{ "id": "svc-1" }',
    });

    const index = new LinkedServicesIndex();
    await index.refresh();

    expect(index.get('svc-1')?.folder).toBe('/workspace/a');
  });

  it('keeps the earliest fsPath winner regardless of findFiles ordering', async () => {
    const first = Uri.file('/workspace/a/.partiri.jsonc');
    const second = Uri.file('/workspace/b/.partiri.jsonc');
    __setFindFilesResult([first, second]);
    __setFileContents({
      '/workspace/a/.partiri.jsonc': '{ "id": "svc-1" }',
      '/workspace/b/.partiri.jsonc': '{ "id": "svc-1" }',
    });

    const index = new LinkedServicesIndex();
    await index.refresh();

    expect(index.get('svc-1')?.folder).toBe('/workspace/a');
  });

  it('queries both globs and merges/de-duplicates the results by fsPath', async () => {
    const dotFile = Uri.file('/workspace/a/.partiri.jsonc');
    const namedFile = Uri.file('/workspace/b/web.partiri.jsonc');
    // dotFile is (correctly) returned by both patterns — a real overlap case
    // for the leading-dot glob — while namedFile only matches the named glob.
    __setFindFilesResultFor('**/.partiri.jsonc', [dotFile]);
    __setFindFilesResultFor('**/*.partiri.jsonc', [namedFile, dotFile]);
    __setFileContents({
      '/workspace/a/.partiri.jsonc': '{ "id": "svc-a" }',
      '/workspace/b/web.partiri.jsonc': '{ "id": "svc-b" }',
    });

    const index = new LinkedServicesIndex();
    await index.refresh();

    expect(index.get('svc-a')?.folder).toBe('/workspace/a');
    expect(index.get('svc-b')?.folder).toBe('/workspace/b');
    expect(index.allConfigs()).toHaveLength(2);
  });

  it('excludes an id-less config from get()/all() but surfaces it via allConfigs()', async () => {
    const file = Uri.file('/workspace/fresh/.partiri.jsonc');
    __setFindFilesResult([file]);
    __setFileContents({
      '/workspace/fresh/.partiri.jsonc': '{}',
    });

    const index = new LinkedServicesIndex();
    await index.refresh();

    expect(index.all()).toHaveLength(0);
    expect(index.allConfigs()).toEqual([
      { id: undefined, folder: '/workspace/fresh', configPath: '/workspace/fresh/.partiri.jsonc' },
    ]);
  });

  it('allConfigs() is sorted deterministically by configPath', async () => {
    const first = Uri.file('/workspace/a/.partiri.jsonc');
    const second = Uri.file('/workspace/b/.partiri.jsonc');
    __setFindFilesResult([second, first]);
    __setFileContents({
      '/workspace/a/.partiri.jsonc': '{}',
      '/workspace/b/.partiri.jsonc': '{}',
    });

    const index = new LinkedServicesIndex();
    await index.refresh();

    expect(index.allConfigs().map((c) => c.configPath)).toEqual([
      '/workspace/a/.partiri.jsonc',
      '/workspace/b/.partiri.jsonc',
    ]);
  });
});

describe('isPartiriConfigFilename', () => {
  it('accepts .partiri.jsonc', () => {
    expect(isPartiriConfigFilename('.partiri.jsonc')).toBe(true);
  });

  it('accepts name.partiri.jsonc', () => {
    expect(isPartiriConfigFilename('web.partiri.jsonc')).toBe(true);
  });

  it('rejects partiri.jsonc (missing the .partiri segment)', () => {
    expect(isPartiriConfigFilename('partiri.jsonc')).toBe(false);
  });

  it('rejects foo.json', () => {
    expect(isPartiriConfigFilename('foo.json')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isPartiriConfigFilename('')).toBe(false);
  });
});

describe('discovery of files that findFiles hides', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'partiri-scan-'));
    await fs.mkdir(path.join(root, 'examples', 'node', 'hello'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(path.join(root, '.partiri.jsonc'), '{"id":"root-id"}');
    // Three levels down, the depth findFiles would reach but .gitignore hides.
    await fs.writeFile(
      path.join(root, 'examples', 'node', 'hello', '.partiri.jsonc'),
      '{"id":"nested-id"}',
    );
    await fs.writeFile(path.join(root, 'examples', 'node', 'hello', 'web.partiri.jsonc'), '{}');
    await fs.writeFile(path.join(root, 'node_modules', 'pkg', '.partiri.jsonc'), '{"id":"skip"}');
    vscodeMock.workspace.workspaceFolders = [
      { uri: Uri.file(root), name: 'root', index: 0 },
    ] as never;
    // The mocked workspace.fs.readFile serves from this map, not from disk.
    __setFileContents({
      [path.join(root, '.partiri.jsonc')]: '{"id":"root-id"}',
      [path.join(root, 'examples', 'node', 'hello', '.partiri.jsonc')]: '{"id":"nested-id"}',
      [path.join(root, 'examples', 'node', 'hello', 'web.partiri.jsonc')]: '{}',
      [path.join(root, 'node_modules', 'pkg', '.partiri.jsonc')]: '{"id":"skip"}',
    });
  });

  afterEach(async () => {
    vscodeMock.workspace.workspaceFolders = undefined;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('finds nested configs even when findFiles returns nothing', async () => {
    __setFindFilesResult([]);
    const index = new LinkedServicesIndex();
    await index.refresh();

    const paths = index.allConfigs().map((c) => c.configPath);
    expect(paths).toContain(path.join(root, '.partiri.jsonc'));
    expect(paths).toContain(path.join(root, 'examples', 'node', 'hello', '.partiri.jsonc'));
    expect(paths).toContain(path.join(root, 'examples', 'node', 'hello', 'web.partiri.jsonc'));
  });

  it('never descends into node_modules', async () => {
    __setFindFilesResult([]);
    const index = new LinkedServicesIndex();
    await index.refresh();
    expect(index.allConfigs().every((c) => !c.configPath.includes('node_modules'))).toBe(true);
  });
});
