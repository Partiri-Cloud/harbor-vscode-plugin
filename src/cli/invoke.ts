import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { EnvelopeParseError, parseEnvelope, type CliEnvelope } from './envelope';
import { CancelledError, CliInvocationError, CliTimeoutError } from './errors';

export interface InvokeOptions {
  /** Folder containing the target .partiri.jsonc (docs/cli-contract.md §3). */
  cwd: string;
  /** Absolute path passed as --config, explicitly, even though cwd would also resolve it. */
  configPath: string;
  /** Subcommand + flags, WITHOUT -j/--no-input/--config — invokeCli adds those. */
  args: string[];
  /**
   * Whether this invocation mutates state and must go through the
   * per-config-file queue. Required (not defaulted) so every call site makes
   * this call deliberately — see docs/cli-contract.md §5.
   */
  mutating: boolean;
  /** Piped to the child's stdin, for the --*-stdin flag family (never pass secrets as argv). */
  stdin?: string;
  /** Overrides partiri.timeoutSeconds for this call. */
  timeoutSeconds?: number;
}

// One queue per --config folder: never run two mutating commands against the
// same .partiri.jsonc concurrently (docs/cli-contract.md §5).
const mutationQueues = new Map<string, Promise<void>>();

export async function invokeCli<T = unknown>(
  binaryPath: string,
  options: InvokeOptions,
): Promise<CliEnvelope<T>> {
  const task = () => runOnce<T>(binaryPath, options);
  return options.mutating ? enqueue(queueKey(options.configPath), task) : task();
}

/**
 * Call sites pass either the .partiri.jsonc FILE path or its containing
 * DIRECTORY as configPath. Canonicalize both to the same queue key so a
 * mutating command against one form can never run concurrently with one
 * against the other (docs/cli-contract.md §5). Does not affect the
 * --config argument actually passed to the CLI.
 */
function queueKey(configPath: string): string {
  const base =
    path.basename(configPath) === '.partiri.jsonc' ? path.dirname(configPath) : configPath;
  return path.resolve(base);
}

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  const result = previous.then(task);
  // Store a settled-only view so a rejection never poisons the queue for the
  // next invocation against this config file.
  mutationQueues.set(
    key,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

function runOnce<T>(binaryPath: string, options: InvokeOptions): Promise<CliEnvelope<T>> {
  const config = vscode.workspace.getConfiguration('partiri');
  const timeoutSeconds = options.timeoutSeconds ?? config.get<number>('timeoutSeconds', 60);
  const apiUrl = config.get<string>('apiUrl', '').trim();

  const args = ['-j', '--no-input', ...options.args, '--config', options.configPath];
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  if (apiUrl) {
    env.PARTIRI_API_URL = apiUrl;
  }

  return new Promise<CliEnvelope<T>>((resolve, reject) => {
    const child = execFile(
      binaryPath,
      args,
      { cwd: options.cwd, env, timeout: timeoutSeconds * 1000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        settle<T>({ error, stdout, stderr, timeoutSeconds }, resolve, reject);
      },
    );

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    } else {
      child.stdin?.end();
    }
  });
}

interface ExecResult {
  error: (Error & { code?: number | string | null; killed?: boolean }) | null;
  stdout: string;
  stderr: string;
  timeoutSeconds: number;
}

function settle<T>(
  { error, stdout, stderr, timeoutSeconds }: ExecResult,
  resolve: (value: CliEnvelope<T>) => void,
  reject: (reason: unknown) => void,
): void {
  // execFile can set `killed` both on timeout and when maxBuffer is exceeded
  // (the exact shape varies by Node version) — only the former is actually a
  // timeout, so check the maxBuffer signal first regardless of `killed`.
  if (error?.message.toLowerCase().includes('maxbuffer')) {
    reject(new Error('partiri CLI output exceeded the buffer limit.'));
    return;
  }
  if (error?.killed) {
    reject(new CliTimeoutError(timeoutSeconds));
    return;
  }

  const exitCode = typeof error?.code === 'number' ? error.code : error ? 1 : 0;

  if (exitCode === 2) {
    reject(new CancelledError());
    return;
  }

  try {
    if (exitCode === 0) {
      resolve(parseEnvelope<T>(stdout));
      return;
    }
    const envelope = parseEnvelope<T>(stderr);
    if (envelope.ok !== false) {
      reject(new EnvelopeParseError('Expected an error envelope on stderr.', stderr));
      return;
    }
    reject(new CliInvocationError(envelope.error));
  } catch (parseError) {
    reject(parseError);
  }
}
