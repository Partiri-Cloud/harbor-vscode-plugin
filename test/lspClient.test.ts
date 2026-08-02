import { describe, expect, it } from 'vitest';
import { isExecuteCommandFeature } from '../src/lsp/features';

describe('isExecuteCommandFeature', () => {
  it('matches the feature that registers server commands as VS Code commands', () => {
    expect(
      isExecuteCommandFeature({ registrationType: { method: 'workspace/executeCommand' } }),
    ).toBe(true);
  });

  it('leaves every other dynamic feature registered', () => {
    expect(
      isExecuteCommandFeature({ registrationType: { method: 'textDocument/completion' } }),
    ).toBe(false);
    expect(isExecuteCommandFeature({ registrationType: { method: 'textDocument/hover' } })).toBe(
      false,
    );
  });

  it('tolerates static features with no registrationType', () => {
    expect(isExecuteCommandFeature({})).toBe(false);
    expect(isExecuteCommandFeature(undefined)).toBe(false);
    expect(isExecuteCommandFeature(null)).toBe(false);
  });
});
