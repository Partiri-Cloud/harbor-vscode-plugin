/**
 * Pure helper for building `terminal.sendText` commands from a resolved
 * `partiri` binary path. Kept free of any `vscode` import so it can run
 * under a plain unit test.
 */

/**
 * Quote a binary path for use in the integrated terminal on both POSIX and
 * Windows shells. Wraps the path in double quotes when it contains
 * whitespace (the default install location on Windows); on win32
 * (PowerShell, VS Code's default Windows shell), a quoted command must also
 * be prefixed with `&` — the call operator — or PowerShell treats the
 * quoted string as a plain string expression instead of invoking it.
 */
export function quoteBinaryPath(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!/\s/.test(binaryPath)) {
    return binaryPath;
  }
  const quoted = `"${binaryPath}"`;
  return platform === 'win32' ? `& ${quoted}` : quoted;
}
