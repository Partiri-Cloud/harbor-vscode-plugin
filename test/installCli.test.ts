import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { installGuidance } from '../src/cli/discovery';
import {
  CARGO_INSTALL_COMMAND,
  INSTALL_IN_TERMINAL_LABEL,
  NPM_INSTALL_COMMAND,
  USE_NPM_INSTEAD_LABEL,
  offerInstall,
  pollUntil,
  type InstalledCli,
} from '../src/commands/installCli';
import { __resetTerminals, __terminals } from './mocks/vscode';

type ShowWarningMessage = typeof vscode.window.showWarningMessage;
type ShowInformationMessage = typeof vscode.window.showInformationMessage;

const originalShowWarningMessage = vscode.window.showWarningMessage;
const originalShowInformationMessage = vscode.window.showInformationMessage;

function mockWarningMessage(response: string | undefined) {
  const spy = vi.fn(async (..._args: unknown[]) => response);
  (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = spy;
  return spy;
}

function mockInformationMessage() {
  const spy = vi.fn(async (..._args: unknown[]) => undefined);
  (vscode.window as unknown as { showInformationMessage: unknown }).showInformationMessage = spy;
  return spy;
}

const NEVER_INSTALLED: () => Promise<InstalledCli | null> = async () => null;

describe('offerInstall', () => {
  beforeEach(() => {
    __resetTerminals();
  });

  afterEach(() => {
    vscode.window.showWarningMessage = originalShowWarningMessage as ShowWarningMessage;
    vscode.window.showInformationMessage = originalShowInformationMessage as ShowInformationMessage;
    vi.useRealTimers();
  });

  it('offers both install buttons on non-win32', async () => {
    const spy = mockWarningMessage(undefined);
    await offerInstall(installGuidance('linux'), async () => {}, NEVER_INSTALLED);
    const [, ...items] = spy.mock.calls[0] as [string, ...string[]];
    expect(items).toEqual([INSTALL_IN_TERMINAL_LABEL, USE_NPM_INSTEAD_LABEL]);
  });

  it('hides the npm button on win32, since the npm package has no Windows builds', async () => {
    const spy = mockWarningMessage(undefined);
    await offerInstall(installGuidance('win32'), async () => {}, NEVER_INSTALLED);
    const [, ...items] = spy.mock.calls[0] as [string, ...string[]];
    expect(items).toEqual([INSTALL_IN_TERMINAL_LABEL]);
  });

  it('does nothing when the notification is dismissed', async () => {
    mockWarningMessage(undefined);
    const onInstalled = vi.fn(async () => {});
    await offerInstall(installGuidance('linux'), onInstalled, NEVER_INSTALLED);
    expect(__terminals()).toHaveLength(0);
    expect(onInstalled).not.toHaveBeenCalled();
  });

  it('sends the cargo install command in a "Partiri" terminal when "Install in terminal" is chosen', async () => {
    vi.useFakeTimers();
    mockWarningMessage(INSTALL_IN_TERMINAL_LABEL);

    const promise = offerInstall(installGuidance('linux'), async () => {}, NEVER_INSTALLED);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await promise;

    const terminals = __terminals();
    expect(terminals).toHaveLength(1);
    expect(terminals[0]?.name).toBe('Partiri');
    expect(terminals[0]?.shown).toBe(true);
    expect(terminals[0]?.sentTexts).toEqual([CARGO_INSTALL_COMMAND]);
  });

  it('sends the npm install command when "Use npm instead" is chosen', async () => {
    vi.useFakeTimers();
    mockWarningMessage(USE_NPM_INSTEAD_LABEL);

    const promise = offerInstall(installGuidance('linux'), async () => {}, NEVER_INSTALLED);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await promise;

    const terminals = __terminals();
    expect(terminals).toHaveLength(1);
    expect(terminals[0]?.sentTexts).toEqual([NPM_INSTALL_COMMAND]);
  });

  it('reuses an existing "Partiri" terminal instead of creating a second one', async () => {
    vi.useFakeTimers();
    vscode.window.createTerminal('Partiri');
    mockWarningMessage(INSTALL_IN_TERMINAL_LABEL);

    const promise = offerInstall(installGuidance('linux'), async () => {}, NEVER_INSTALLED);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await promise;

    expect(__terminals()).toHaveLength(1);
  });

  it('shows an info message and calls onInstalled once a valid binary is found', async () => {
    vi.useFakeTimers();
    mockWarningMessage(INSTALL_IN_TERMINAL_LABEL);
    const infoSpy = mockInformationMessage();
    const onInstalled = vi.fn(async () => {});
    const probe = vi
      .fn<() => Promise<InstalledCli | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ binaryPath: '/usr/local/bin/partiri', version: '0.3.1' });

    const promise = offerInstall(installGuidance('linux'), onInstalled, probe);
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    expect(onInstalled).toHaveBeenCalledOnce();
    expect(infoSpy).toHaveBeenCalledWith('Partiri CLI 0.3.1 installed.');
  });

  it('stays quiet (no onInstalled call, no info message) once the poll budget expires', async () => {
    vi.useFakeTimers();
    mockWarningMessage(INSTALL_IN_TERMINAL_LABEL);
    const infoSpy = mockInformationMessage();
    const onInstalled = vi.fn(async () => {});

    const promise = offerInstall(installGuidance('linux'), onInstalled, NEVER_INSTALLED);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await promise;

    expect(onInstalled).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe('pollUntil', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the probe result as soon as the probe succeeds', async () => {
    vi.useFakeTimers();
    const probe = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('found');

    const promise = pollUntil(probe, { intervalMs: 5_000, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;

    expect(result).toBe('found');
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it('gives up and resolves null once the timeout budget is exhausted', async () => {
    vi.useFakeTimers();
    const probe = vi.fn<() => Promise<string | null>>().mockResolvedValue(null);

    const promise = pollUntil(probe, { intervalMs: 5_000, timeoutMs: 15_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await promise;

    expect(result).toBeNull();
    expect(probe).toHaveBeenCalledTimes(3);
  });
});
