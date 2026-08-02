import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { showJobs, showLogs, showMetrics } from '../src/commands/serviceActions';
import type { ServiceActionContext } from '../src/commands/serviceActions';
import { ContextStore } from '../src/state/contextStore';
import { LinkedServicesIndex } from '../src/state/linkedServices';
import { Uri, __setConfig, __setFileContents, __setFindFilesResult } from './mocks/vscode';

const FAKE_PARTIRI = fileURLToPath(new URL('../../tools/fake-partiri/partiri', import.meta.url));

const SERVICE_ID = 'svc-argv-test';

let workDir: string;
let configPath: string;
let logPath: string;
let ctx: ServiceActionContext;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'partiri-service-actions-test-'));
  configPath = path.join(workDir, '.partiri.jsonc');
  logPath = path.join(workDir, 'log.jsonl');
  process.env.FAKE_PARTIRI_LOG = logPath;
  __setConfig({});

  // Build a real LinkedServicesIndex, the same way test/linkedServices.test.ts
  // does, so `showLogs`/`showMetrics`/`showJobs` resolve straight to a linked
  // target with no extra `service pull` invocation to filter out of the log.
  const configUri = Uri.file(configPath);
  __setFindFilesResult([configUri]);
  __setFileContents({ [configPath]: JSON.stringify({ id: SERVICE_ID }) });
  const linkedServices = new LinkedServicesIndex();
  await linkedServices.refresh();

  ctx = {
    getBinaryPath: () => FAKE_PARTIRI,
    globalStorageDir: workDir,
    linkedServices,
    contextStore: new ContextStore(
      () => FAKE_PARTIRI,
      () => ({ cwd: workDir, configPath: workDir }),
    ),
    outputChannel: vscode.window.createOutputChannel('partiri-test'),
  };
});

afterEach(async () => {
  delete process.env.FAKE_PARTIRI_LOG;
  delete process.env.FAKE_PARTIRI_FIXTURE;
  __setFindFilesResult([]);
  __setFileContents({});
  await fs.rm(workDir, { recursive: true, force: true });
});

async function readLog(): Promise<{ argv: string[] }[]> {
  const raw = await fs.readFile(logPath, 'utf8').catch(() => '');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Regression coverage for the live bug: `service logs`, `service metrics`,
// and `service jobs` all reject `--service <id>` on the real CLI — they
// operate on whatever `--config` resolves to. `watchLogsTick` builds the
// identical `['service', 'logs']` array via the same `fetchServiceOutput`
// helper as `showLogs`, so it is verified by code inspection rather than a
// dedicated (fake-timer-driven) test — see the implementation report.
describe('service logs/metrics/jobs no longer pass --service', () => {
  it('showLogs invokes `service logs` with no --service token', async () => {
    await showLogs(ctx, SERVICE_ID);
    const entries = await readLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.argv).toEqual([
      '-j',
      '--no-input',
      'service',
      'logs',
      '--config',
      configPath,
    ]);
    expect(entries[0]?.argv).not.toContain('--service');
    expect(entries[0]?.argv).not.toContain(SERVICE_ID);
  });

  it('showMetrics invokes `service metrics` with no --service token', async () => {
    await showMetrics(ctx, SERVICE_ID);
    const entries = await readLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.argv).toEqual([
      '-j',
      '--no-input',
      'service',
      'metrics',
      '--config',
      configPath,
    ]);
    expect(entries[0]?.argv).not.toContain('--service');
    expect(entries[0]?.argv).not.toContain(SERVICE_ID);
  });

  it('showJobs invokes `service jobs` with no --service token', async () => {
    await showJobs(ctx, SERVICE_ID);
    const entries = await readLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.argv).toEqual([
      '-j',
      '--no-input',
      'service',
      'jobs',
      '--config',
      configPath,
    ]);
    expect(entries[0]?.argv).not.toContain('--service');
    expect(entries[0]?.argv).not.toContain(SERVICE_ID);
  });
});
