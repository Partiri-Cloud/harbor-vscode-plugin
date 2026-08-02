import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { confirmDestructive } from '../src/cli/confirm';

type ShowWarningMessage = typeof vscode.window.showWarningMessage;

const originalShowWarningMessage = vscode.window.showWarningMessage;

/**
 * vi.spyOn on an overloaded vscode API infers only the last overload's
 * signature, which breaks `mockResolvedValue` for the string-items overload
 * confirm.ts actually calls. Assigning our own vi.fn() directly sidesteps
 * that overload-inference mismatch entirely.
 */
function mockWarningMessage(response: string | undefined) {
  const spy = vi.fn(async (..._args: unknown[]) => response);
  (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = spy;
  return spy;
}

describe('confirmDestructive', () => {
  afterEach(() => {
    vscode.window.showWarningMessage = originalShowWarningMessage as ShowWarningMessage;
  });

  it('resolves true without a dialog for unpause (no confirm)', async () => {
    const spy = mockWarningMessage(undefined);
    const confirmed = await confirmDestructive('unpause');
    expect(confirmed).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['deploy', 'Restarts the service, consumes balance.'],
    ['pause', undefined],
    ['push', undefined],
    ['storageDetach', undefined],
    ['storageDelete', undefined],
  ] as const)('shows a modal confirm dialog for %s', async (op, expectedDetail) => {
    const spy = mockWarningMessage('Confirm');
    const confirmed = await confirmDestructive(op);
    expect(confirmed).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    const [, options] = spy.mock.calls[0] as [string, { modal: boolean; detail: string }];
    expect(options.modal).toBe(true);
    if (expectedDetail) {
      expect(options.detail).toBe(expectedDetail);
    }
  });

  it('returns false when the user dismisses the confirm dialog', async () => {
    mockWarningMessage(undefined);
    expect(await confirmDestructive('deploy')).toBe(false);
  });

  it('uses a danger-level confirmation for kill and marks it irreversible', async () => {
    const spy = mockWarningMessage('Yes, do it');
    const confirmed = await confirmDestructive('kill');
    expect(confirmed).toBe(true);
    const [, options] = spy.mock.calls[0] as [string, { detail: string }];
    expect(options.detail).toContain('irreversible');
  });

  it('does not confirm on the danger label alone if the user picked the plain confirm label', async () => {
    mockWarningMessage('Confirm');
    expect(await confirmDestructive('kill')).toBe(false);
  });

  it('adds the stronger disk-loss warning for push only when diskChanged is true', async () => {
    const spy = mockWarningMessage('Confirm');
    await confirmDestructive('push', { diskChanged: true });
    const [, options] = spy.mock.calls[0] as [string, { detail: string }];
    expect(options.detail).toContain('not applied by push');

    spy.mockClear();
    await confirmDestructive('push', { diskChanged: false });
    const [, options2] = spy.mock.calls[0] as [string, { detail: string }];
    expect(options2.detail).not.toContain('not applied by push');
  });

  it('requires REPLACES ALL env vars wording for env replace', async () => {
    const spy = mockWarningMessage('Confirm');
    await confirmDestructive('envReplace');
    const [, options] = spy.mock.calls[0] as [string, { detail: string }];
    expect(options.detail).toContain('REPLACES ALL env vars');
  });
});
