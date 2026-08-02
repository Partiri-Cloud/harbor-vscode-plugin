import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSelectedServiceTarget, ensureServiceTarget } from '../src/state/serviceTarget';
import { LinkedServicesIndex } from '../src/state/linkedServices';
import type { SelectedService } from '../src/state/selectedService';
import { __setConfig } from './mocks/vscode';

const FAKE_PARTIRI = fileURLToPath(new URL('../../tools/fake-partiri/partiri', import.meta.url));
const SUCCESS_FIXTURE = fileURLToPath(
  new URL('../../docs/fixtures/success-deploy.json', import.meta.url),
);

let globalStorageDir: string;
let logPath: string;

beforeEach(async () => {
  globalStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'partiri-service-target-test-'));
  logPath = path.join(globalStorageDir, 'log.jsonl');
  process.env.FAKE_PARTIRI_LOG = logPath;
  // service pull has no dedicated fake-partiri route; force any envelope so
  // the pull path under test succeeds regardless of routing.
  process.env.FAKE_PARTIRI_FIXTURE = SUCCESS_FIXTURE;
  __setConfig({});
});

afterEach(async () => {
  delete process.env.FAKE_PARTIRI_LOG;
  delete process.env.FAKE_PARTIRI_FIXTURE;
  await fs.rm(globalStorageDir, { recursive: true, force: true });
});

async function readLog(): Promise<{ argv: string[] }[]> {
  const raw = await fs.readFile(logPath, 'utf8').catch(() => '');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('ensureServiceTarget', () => {
  it('pulls when no scratch config exists yet', async () => {
    const target = await ensureServiceTarget(FAKE_PARTIRI, 'svc-1', undefined, globalStorageDir);
    expect(target.isLinked).toBe(false);
    const entries = await readLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.argv).toContain('pull');
  });

  it('skips the pull when the scratch config is fresh (< 5 minutes old)', async () => {
    const dir = path.join(globalStorageDir, 'svc-svc-2');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, '.partiri.jsonc'), '{}');

    const target = await ensureServiceTarget(FAKE_PARTIRI, 'svc-2', undefined, globalStorageDir);
    expect(target).toEqual({ cwd: dir, configPath: dir, isLinked: false });
    const entries = await readLog();
    expect(entries).toHaveLength(0);
  });

  it('pulls again when the scratch config is stale (>= 5 minutes old)', async () => {
    const dir = path.join(globalStorageDir, 'svc-svc-3');
    await fs.mkdir(dir, { recursive: true });
    const configPath = path.join(dir, '.partiri.jsonc');
    await fs.writeFile(configPath, '{}');
    const staleTime = new Date(Date.now() - 6 * 60 * 1000);
    await fs.utimes(configPath, staleTime, staleTime);

    await ensureServiceTarget(FAKE_PARTIRI, 'svc-3', undefined, globalStorageDir);
    const entries = await readLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.argv).toContain('pull');
  });
});

describe('ensureSelectedServiceTarget', () => {
  it('returns the local path directly for a localConfig selection, with no CLI invocation', async () => {
    const linked = new LinkedServicesIndex();
    const selection: SelectedService = {
      kind: 'localConfig',
      folder: '/workspace/api',
      configPath: '/workspace/api/.partiri.jsonc',
      name: 'api',
    };

    const target = await ensureSelectedServiceTarget(
      FAKE_PARTIRI,
      selection,
      linked,
      globalStorageDir,
    );

    expect(target).toEqual({
      cwd: '/workspace/api',
      configPath: '/workspace/api/.partiri.jsonc',
      isLinked: true,
    });
    const entries = await readLog();
    expect(entries).toHaveLength(0);
  });

  it('delegates a remote selection to ensureServiceTarget (pulls when no scratch config exists)', async () => {
    const linked = new LinkedServicesIndex();
    const selection: SelectedService = { kind: 'remote', serviceId: 'svc-4', name: 'api' };

    const target = await ensureSelectedServiceTarget(
      FAKE_PARTIRI,
      selection,
      linked,
      globalStorageDir,
    );

    expect(target.isLinked).toBe(false);
    const entries = await readLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.argv).toContain('pull');
  });
});
