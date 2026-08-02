import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { BinaryResolver, RELEVANT_SETTINGS } from '../src/activation/binaryLifecycle';
import { CliVersionTooOldError } from '../src/cli/errors';

const BINARY = '/usr/local/bin/partiri';

let lsp: {
  start: ReturnType<typeof vi.fn<(binaryPath: string) => Promise<void>>>;
  stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
};
let onResolved: ReturnType<typeof vi.fn<(binaryPath: string | null) => void>>;
let offerInstall: ReturnType<typeof vi.fn<() => Promise<void>>>;
let showError: ReturnType<typeof vi.fn<(message: string) => void>>;
let handleError: ReturnType<typeof vi.fn<(error: unknown) => Promise<void>>>;

beforeEach(() => {
  lsp = {
    start: vi.fn<(binaryPath: string) => Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  onResolved = vi.fn<(binaryPath: string | null) => void>();
  offerInstall = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  showError = vi.fn<(message: string) => void>();
  handleError = vi.fn<(error: unknown) => Promise<void>>().mockResolvedValue(undefined);
});

interface Overrides {
  binaryPath?: string;
  settingInvalid?: boolean;
  setting?: string;
  lspEnabled?: boolean;
  version?: string;
  meetsMinimum?: boolean;
}

function resolverFor(o: Overrides = {}): BinaryResolver {
  return new BinaryResolver({
    lsp,
    outputChannel: vscode.window.createOutputChannel('test'),
    onResolved,
    offerInstall: offerInstall as never,
    showError,
    handleError,
    readSettings: () => ({ binaryPath: o.setting, lspEnabled: o.lspEnabled ?? true }),
    findBinary: (async () => ({
      binaryPath: o.binaryPath ?? null,
      settingInvalid: o.settingInvalid ?? false,
      source: 'path',
    })) as never,
    checkVersion: (async () => ({
      version: o.version ?? '0.3.0',
      meetsMinimum: o.meetsMinimum ?? true,
    })) as never,
  });
}

describe('BinaryResolver — no usable CLI', () => {
  it('reports the bad setting and does NOT offer to install', async () => {
    const resolver = resolverFor({ setting: '/bad/path', settingInvalid: true });
    await resolver.resolve();

    expect(resolver.current).toBeNull();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('/bad/path'));
    expect(offerInstall).not.toHaveBeenCalled();
    expect(lsp.stop).toHaveBeenCalled();
    expect(lsp.start).not.toHaveBeenCalled();
  });

  it('offers to install when nothing was found and no path was configured', async () => {
    const resolver = resolverFor({});
    await resolver.resolve();

    expect(resolver.current).toBeNull();
    expect(offerInstall).toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(lsp.stop).toHaveBeenCalled();
  });

  it('rejects a CLI older than the minimum version', async () => {
    const resolver = resolverFor({ binaryPath: BINARY, version: '0.2.0', meetsMinimum: false });
    await resolver.resolve();

    expect(resolver.current).toBeNull();
    expect(handleError).toHaveBeenCalledWith(expect.any(CliVersionTooOldError));
    expect(lsp.stop).toHaveBeenCalled();
    expect(lsp.start).not.toHaveBeenCalled();
  });

  it('signals null so the caller can skip the panel fan-out', async () => {
    await resolverFor({}).resolve();
    expect(onResolved).toHaveBeenCalledWith(null);
  });
});

describe('BinaryResolver — usable CLI', () => {
  it('exposes the resolved path and starts the language server', async () => {
    const resolver = resolverFor({ binaryPath: BINARY });
    await resolver.resolve();

    expect(resolver.current).toBe(BINARY);
    expect(onResolved).toHaveBeenCalledWith(BINARY);
    expect(lsp.start).toHaveBeenCalledWith(BINARY);
  });

  /** The panels must be told before the LSP is touched — starting it is slow. */
  it('notifies the caller before starting the language server', async () => {
    const order: string[] = [];
    onResolved.mockImplementation(() => order.push('resolved'));
    lsp.start.mockImplementation(() => {
      order.push('lsp.start');
      return Promise.resolve();
    });

    await resolverFor({ binaryPath: BINARY }).resolve();

    expect(order).toEqual(['resolved', 'lsp.start']);
  });

  it('stops the language server when partiri.lsp.enabled is false', async () => {
    const resolver = resolverFor({ binaryPath: BINARY, lspEnabled: false });
    await resolver.resolve();

    expect(resolver.current).toBe(BINARY);
    expect(lsp.start).not.toHaveBeenCalled();
    expect(lsp.stop).toHaveBeenCalled();
  });

  /**
   * The load-bearing invariant: tree views, commands, and the status bar all
   * work without a language server, so an LSP failure must not reject
   * resolve() and take activation down with it.
   */
  it('survives a language server that fails to start', async () => {
    lsp.start.mockRejectedValue(new Error('spawn ENOENT'));
    const resolver = resolverFor({ binaryPath: BINARY });

    await expect(resolver.resolve()).resolves.toBeUndefined();
    expect(resolver.current).toBe(BINARY);
  });
});

describe('BinaryResolver — getBinaryPath', () => {
  /**
   * Context objects are built once at activation, before the binary resolves.
   * A captured value would be `null` forever; a bound getter tracks it.
   */
  it('is a stable reference that tracks the current value', async () => {
    const resolver = resolverFor({ binaryPath: BINARY });
    const captured = resolver.getBinaryPath;

    expect(captured()).toBeNull();
    await resolver.resolve();
    expect(captured()).toBe(BINARY);
  });

  it('goes back to null when a later resolve finds nothing', async () => {
    const resolver = resolverFor({ binaryPath: BINARY });
    await resolver.resolve();
    expect(resolver.getBinaryPath()).toBe(BINARY);

    const gone = resolverFor({});
    await gone.resolve();
    expect(gone.getBinaryPath()).toBeNull();
  });
});

describe('RELEVANT_SETTINGS', () => {
  it('covers every setting that changes which binary or server we run', () => {
    expect(RELEVANT_SETTINGS).toEqual([
      'partiri.binaryPath',
      'partiri.lsp.enabled',
      'partiri.remoteValidation',
    ]);
  });
});
