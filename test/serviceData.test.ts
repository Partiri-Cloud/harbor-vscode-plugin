import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { CliInvocationError } from '../src/cli/errors';
import { fetchServiceData, type ServiceDataContext } from '../src/data/serviceData';
import { ContextStore } from '../src/state/contextStore';
import { LinkedServicesIndex } from '../src/state/linkedServices';
import { Uri, __setConfig, __setFileContents, __setFindFilesResult } from './mocks/vscode';

const FAKE_PARTIRI = fileURLToPath(new URL('../../tools/fake-partiri/partiri', import.meta.url));
const ERROR_401_FIXTURE = fileURLToPath(
  new URL('../../docs/fixtures/error-401.json', import.meta.url),
);

const SERVICE_ID = 'svc-data-test';

let workDir: string;
let ctx: ServiceDataContext;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'partiri-service-data-test-'));
  __setConfig({});

  const configPath = path.join(workDir, '.partiri.jsonc');
  __setFindFilesResult([Uri.file(configPath)]);
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
  delete process.env.FAKE_PARTIRI_FIXTURE;
  __setFindFilesResult([]);
  __setFileContents({});
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('fetchServiceData', () => {
  it('resolves envelope.data on a success envelope', async () => {
    const data = await fetchServiceData(ctx, { cwd: workDir, configPath: workDir }, [
      'service',
      'jobs',
    ]);
    expect(data).toEqual([
      {
        job_type: 'deploy',
        deploy_ref: 'a1b2c3d',
        status: 'succeeded',
        created_at: '23/07/2026 10:30',
      },
      {
        job_type: 'deploy',
        deploy_ref: '—',
        status: 'failed',
        created_at: '22/07/2026 09:15',
      },
    ]);
  });

  it('rejects with CliInvocationError carrying the error payload on an error envelope', async () => {
    process.env.FAKE_PARTIRI_FIXTURE = ERROR_401_FIXTURE;
    await expect(
      fetchServiceData(ctx, { cwd: workDir, configPath: workDir }, ['service', 'jobs']),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(CliInvocationError);
      expect((error as CliInvocationError).payload.code).toBe('401');
      return true;
    });
  });

  it('throws when the CLI binary is not configured', async () => {
    const noBinaryCtx: ServiceDataContext = { ...ctx, getBinaryPath: () => null };
    await expect(
      fetchServiceData(noBinaryCtx, { cwd: workDir, configPath: workDir }, ['service', 'jobs']),
    ).rejects.toThrow(/partiri CLI not found/);
  });
});
