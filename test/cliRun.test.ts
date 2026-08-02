import { describe, expect, it } from 'vitest';
import { CliNotFoundError } from '../src/cli/errors';
import { requireBinaryPath } from '../src/cli/run';

describe('requireBinaryPath', () => {
  it('returns the path when one is configured', () => {
    expect(requireBinaryPath({ getBinaryPath: () => '/usr/local/bin/partiri' })).toBe(
      '/usr/local/bin/partiri',
    );
  });

  /**
   * The message is asserted by test/serviceActions.test.ts and shown verbatim
   * to the user, so it is part of the contract rather than an internal detail.
   */
  it('throws CliNotFoundError with the actionable message when there is none', () => {
    expect(() => requireBinaryPath({ getBinaryPath: () => null })).toThrow(CliNotFoundError);
    expect(() => requireBinaryPath({ getBinaryPath: () => null })).toThrow(
      /partiri CLI not found\. Set partiri\.binaryPath or install it\./,
    );
  });

  /**
   * CliNotFoundError specifically — handleCliError renders it as a plain
   * notification, where a bare Error would be prefixed with "Partiri:".
   */
  it('throws an error the shared handler recognises', () => {
    try {
      requireBinaryPath({ getBinaryPath: () => null });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CliNotFoundError);
      expect((error as Error).name).toBe('CliNotFoundError');
    }
  });
});
