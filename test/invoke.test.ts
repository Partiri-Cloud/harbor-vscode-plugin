import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { invokeCli } from '../src/cli/invoke';
import { CancelledError, CliInvocationError, CliTimeoutError } from '../src/cli/errors';
import { __setConfig } from './mocks/vscode';
import { expectData } from './testUtils';

const FAKE_PARTIRI = fileURLToPath(new URL('../../tools/fake-partiri/partiri', import.meta.url));

let workDir: string;
let logPath: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'partiri-invoke-test-'));
  logPath = path.join(workDir, 'log.jsonl');
  process.env.FAKE_PARTIRI_LOG = logPath;
  __setConfig({});
});

afterEach(async () => {
  delete process.env.FAKE_PARTIRI_LOG;
  delete process.env.FAKE_PARTIRI_EXIT;
  delete process.env.FAKE_PARTIRI_FIXTURE;
  await fs.rm(workDir, { recursive: true, force: true });
});

async function readLog(): Promise<{ argv: string[]; cwd: string; ts: string }[]> {
  const raw = await fs.readFile(logPath, 'utf8');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function writeExecutableScript(name: string, contents: string): Promise<string> {
  const scriptPath = path.join(workDir, name);
  await fs.writeFile(scriptPath, contents, { mode: 0o755 });
  return scriptPath;
}

describe('invokeCli', () => {
  it('always passes -j --no-input before the subcommand and --config after it', async () => {
    await invokeCli(FAKE_PARTIRI, {
      cwd: workDir,
      configPath: '/abs/path/to/config',
      args: ['service', 'list'],
      mutating: false,
    });
    const [entry] = await readLog();
    expect(entry?.argv).toEqual([
      '-j',
      '--no-input',
      'service',
      'list',
      '--config',
      '/abs/path/to/config',
    ]);
    expect(entry?.cwd).toBe(workDir);
  });

  it('places -y only when the caller included it after confirmation, alongside the subcommand', async () => {
    await invokeCli(FAKE_PARTIRI, {
      cwd: workDir,
      configPath: '/abs/path/to/config',
      args: ['service', 'deploy', '-y'],
      mutating: true,
    });
    const [entry] = await readLog();
    expect(entry?.argv).toContain('-y');
    expect(entry?.argv.indexOf('-y')).toBeGreaterThan(entry!.argv.indexOf('deploy'));
  });

  it('omits -y when the caller does not pass it', async () => {
    await invokeCli(FAKE_PARTIRI, {
      cwd: workDir,
      configPath: '/abs/path/to/config',
      args: ['service', 'list'],
      mutating: false,
    });
    const [entry] = await readLog();
    expect(entry?.argv).not.toContain('-y');
  });

  it('resolves a success envelope for exit code 0', async () => {
    const envelope = await invokeCli<{ id: string }[]>(FAKE_PARTIRI, {
      cwd: workDir,
      configPath: workDir,
      args: ['service', 'list'],
      mutating: false,
    });
    expect(expectData(envelope)).toEqual([
      { id: 'svc-1', name: 'api', runtime: 'node', deploy_type: 'webservice' },
    ]);
  });

  it('rejects with CliInvocationError carrying the error payload for exit code 1', async () => {
    await expect(
      invokeCli(FAKE_PARTIRI, {
        cwd: workDir,
        configPath: workDir,
        args: ['error-401'],
        mutating: false,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(CliInvocationError);
      expect((error as CliInvocationError).payload.code).toBe('401');
      expect((error as CliInvocationError).payload.hint).toContain('partiri auth login');
      return true;
    });
  });

  it('rejects silently with CancelledError for exit code 2, regardless of stdout body', async () => {
    process.env.FAKE_PARTIRI_EXIT = '2';
    await expect(
      invokeCli(FAKE_PARTIRI, {
        cwd: workDir,
        configPath: workDir,
        args: ['service', 'deploy'],
        mutating: true,
      }),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it('rejects with CliTimeoutError and kills the process when it exceeds the timeout', async () => {
    const slow = await writeExecutableScript('slow-partiri', '#!/bin/sh\nsleep 5\n');
    await expect(
      invokeCli(slow, {
        cwd: workDir,
        configPath: workDir,
        args: ['service', 'list'],
        mutating: false,
        timeoutSeconds: 0.2,
      }),
    ).rejects.toBeInstanceOf(CliTimeoutError);
  }, 10000);

  it('rejects with a buffer-limit error, not a timeout, when output exceeds maxBuffer', async () => {
    const bigOutput = await writeExecutableScript(
      'big-output',
      "#!/bin/sh\nhead -c 11000000 /dev/zero | tr '\\0' 'a'\n",
    );
    await expect(
      invokeCli(bigOutput, {
        cwd: workDir,
        configPath: workDir,
        args: ['service', 'list'],
        mutating: false,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).not.toBeInstanceOf(CliTimeoutError);
      expect((error as Error).message).toMatch(/buffer limit/i);
      return true;
    });
  });

  it('sets NO_COLOR=1 and forwards partiri.apiUrl as PARTIRI_API_URL, without inventing one', async () => {
    const echoEnv = await writeExecutableScript(
      'echo-env',
      '#!/bin/sh\nprintf \'{"schema_version":"1","data":{"noColor":"%s","apiUrl":"%s"}}\' "${NO_COLOR:-}" "${PARTIRI_API_URL:-}"\n',
    );

    __setConfig({ 'partiri.apiUrl': 'https://api.example.test' });
    const withUrl = expectData(
      await invokeCli<{ noColor: string; apiUrl: string }>(echoEnv, {
        cwd: workDir,
        configPath: workDir,
        args: [],
        mutating: false,
      }),
    );
    expect(withUrl.noColor).toBe('1');
    expect(withUrl.apiUrl).toBe('https://api.example.test');

    __setConfig({});
    const withoutUrl = expectData(
      await invokeCli<{ noColor: string; apiUrl: string }>(echoEnv, {
        cwd: workDir,
        configPath: workDir,
        args: [],
        mutating: false,
      }),
    );
    expect(withoutUrl.apiUrl).toBe('');
  });

  it('pipes stdin through for *-stdin flag invocations, never as an argv value', async () => {
    const echoStdin = await writeExecutableScript(
      'echo-stdin',
      '#!/bin/sh\nINPUT="$(cat)"\nprintf \'{"schema_version":"1","data":{"received":"%s"}}\' "$INPUT"\n',
    );
    const received = expectData(
      await invokeCli<{ received: string }>(echoStdin, {
        cwd: workDir,
        configPath: workDir,
        args: ['auth', 'set-apikey', '--key-stdin'],
        mutating: true,
        stdin: 'super-secret-key',
      }),
    );
    expect(received.received).toBe('super-secret-key');
  });

  it('serializes mutating calls against the same config path (mutation queue)', async () => {
    const slow = await writeExecutableScript(
      'slow-then-real',
      `#!/bin/sh\nsleep 0.2\nexec "${FAKE_PARTIRI}" "$@"\n`,
    );
    const testStart = Date.now();
    const order: string[] = [];
    const first = invokeCli(slow, {
      cwd: workDir,
      configPath: workDir,
      args: ['service', 'list'],
      mutating: true,
    }).then(() => order.push('first'));
    const second = invokeCli(FAKE_PARTIRI, {
      cwd: workDir,
      configPath: workDir,
      args: ['service', 'list'],
      mutating: true,
    }).then(() => order.push('second'));

    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);

    // The second (fast) call must not spawn until the first (slow, 200ms)
    // call has fully settled — proving the queue serializes rather than
    // merely resolving in call order by coincidence.
    const entries = await readLog();
    expect(entries).toHaveLength(2);
    const secondTs = new Date(entries[1]!.ts).getTime();
    expect(secondTs - testStart).toBeGreaterThanOrEqual(180);
  });

  it('runs read-only calls in parallel with the mutation queue, not serialized behind it', async () => {
    const slow = await writeExecutableScript(
      'slow-mutation',
      `#!/bin/sh\nsleep 0.3\nexec "${FAKE_PARTIRI}" "$@"\n`,
    );
    const start = Date.now();
    const mutating = invokeCli(slow, {
      cwd: workDir,
      configPath: workDir,
      args: ['service', 'deploy'],
      mutating: true,
    });
    const readOnly = invokeCli(FAKE_PARTIRI, {
      cwd: workDir,
      configPath: workDir,
      args: ['service', 'list'],
      mutating: false,
    });
    await readOnly;
    const readOnlyElapsed = Date.now() - start;
    expect(readOnlyElapsed).toBeLessThan(250);
    await mutating;
  });

  it('serializes mutating calls against the same config regardless of file-vs-directory configPath', async () => {
    const slow = await writeExecutableScript(
      'slow-file-vs-dir',
      `#!/bin/sh\nsleep 0.2\nexec "${FAKE_PARTIRI}" "$@"\n`,
    );
    const testStart = Date.now();
    const order: string[] = [];
    const first = invokeCli(slow, {
      cwd: workDir,
      configPath: path.join(workDir, '.partiri.jsonc'),
      args: ['service', 'list'],
      mutating: true,
    }).then(() => order.push('first'));
    const second = invokeCli(FAKE_PARTIRI, {
      cwd: workDir,
      configPath: workDir,
      args: ['service', 'list'],
      mutating: true,
    }).then(() => order.push('second'));

    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);

    // The second (fast) call must not spawn until the first (slow, 200ms)
    // call has fully settled — proving a file-path configPath and its
    // containing directory share the same queue key.
    const entries = await readLog();
    expect(entries).toHaveLength(2);
    const secondTs = new Date(entries[1]!.ts).getTime();
    expect(secondTs - testStart).toBeGreaterThanOrEqual(180);

    // The --config argument the CLI actually receives must remain exactly
    // what each caller passed, unaffected by the queue-key normalization.
    expect(entries[0]?.argv).toContain(path.join(workDir, '.partiri.jsonc'));
    expect(entries[1]?.argv).toContain(workDir);
  });

  it('does not serialize mutating calls against different config paths', async () => {
    const slow = await writeExecutableScript(
      'slow-other-config',
      `#!/bin/sh\nsleep 0.3\nexec "${FAKE_PARTIRI}" "$@"\n`,
    );
    const start = Date.now();
    const a = invokeCli(slow, {
      cwd: workDir,
      configPath: path.join(workDir, 'svc-a'),
      args: ['service', 'deploy'],
      mutating: true,
    });
    const b = invokeCli(FAKE_PARTIRI, {
      cwd: workDir,
      configPath: path.join(workDir, 'svc-b'),
      args: ['service', 'list'],
      mutating: true,
    });
    await b;
    expect(Date.now() - start).toBeLessThan(250);
    await a;
  });
});
