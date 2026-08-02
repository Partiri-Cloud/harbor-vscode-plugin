import { describe, expect, it } from 'vitest';
import { quoteBinaryPath } from '../src/commands/terminalCommand';

describe('quoteBinaryPath', () => {
  it('leaves a plain posix path untouched', () => {
    expect(quoteBinaryPath('/usr/local/bin/partiri', 'linux')).toBe('/usr/local/bin/partiri');
  });

  it('quotes a posix path containing a space', () => {
    expect(quoteBinaryPath('/Users/jo jo/bin/partiri', 'darwin')).toBe(
      '"/Users/jo jo/bin/partiri"',
    );
  });

  it('quotes and prefixes a win32 path containing a space with the PowerShell call operator', () => {
    expect(quoteBinaryPath('C:\\Program Files\\partiri\\partiri.exe', 'win32')).toBe(
      '& "C:\\Program Files\\partiri\\partiri.exe"',
    );
  });

  it('leaves a plain win32 path untouched', () => {
    expect(quoteBinaryPath('C:\\bin\\partiri.exe', 'win32')).toBe('C:\\bin\\partiri.exe');
  });
});
