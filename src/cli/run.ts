/**
 * The two guards every CLI call site repeats: "do we have a binary" and
 * "did the envelope come back an error". Both throw, so callers can wrap a
 * whole command body in one try/catch that ends in `handleCliError`.
 */

import { type CliSuccessEnvelope } from './envelope';
import { CliInvocationError, CliNotFoundError } from './errors';
import { invokeCli, type InvokeOptions } from './invoke';

/**
 * Resolve the CLI path or throw. Takes a structural `{ getBinaryPath }` so the
 * several context types in this extension can all pass themselves.
 *
 * Distinct from the interactive guard in src/commands/register.ts, which shows
 * a notification and offers to install rather than throwing — that one belongs
 * to a command entry point, this one to the layers beneath it.
 */
export function requireBinaryPath(source: { getBinaryPath: () => string | null }): string {
  const binaryPath = source.getBinaryPath();
  if (!binaryPath) {
    throw new CliNotFoundError('partiri CLI not found. Set partiri.binaryPath or install it.');
  }
  return binaryPath;
}

/**
 * Invoke the CLI and narrow to the success envelope, throwing
 * `CliInvocationError` on an error envelope.
 *
 * Not every call site wants this: a few deliberately inspect `ok === false` and
 * recover (the wizard falls back to built-in options, `detectDiskChanged`
 * returns false). Those keep calling `invokeCli` directly.
 */
export async function runCli<T = unknown>(
  binaryPath: string,
  options: InvokeOptions,
): Promise<CliSuccessEnvelope<T>> {
  const envelope = await invokeCli<T>(binaryPath, options);
  if (envelope.ok === false) {
    throw new CliInvocationError(envelope.error);
  }
  return envelope;
}
