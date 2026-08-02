import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkVersion,
  findBinary,
  installGuidance,
  type DiscoveryDeps,
} from '../src/cli/discovery';

const FAKE_PARTIRI = fileURLToPath(new URL('../../tools/fake-partiri/partiri', import.meta.url));

function fakeDeps(overrides: Partial<DiscoveryDeps> & { files: Set<string> }): DiscoveryDeps {
  const { files, ...rest } = overrides;
  return {
    platform: 'linux',
    pathEnv: '',
    homeDir: '/home/dev',
    isExecutableFile: async (candidate: string) => files.has(candidate),
    npmGlobalPrefix: async () => null,
    ...rest,
  };
}

describe('findBinary', () => {
  it('prefers the explicit setting, even over a PATH match', async () => {
    const deps = fakeDeps({
      files: new Set(['/custom/partiri', '/usr/local/bin/partiri']),
      pathEnv: '/usr/local/bin',
    });
    const result = await findBinary('/custom/partiri', deps);
    expect(result).toEqual({
      binaryPath: '/custom/partiri',
      source: 'setting',
      settingInvalid: false,
    });
  });

  it('reports settingInvalid when the setting does not resolve, without falling back', async () => {
    const deps = fakeDeps({
      files: new Set(['/usr/local/bin/partiri']),
      pathEnv: '/usr/local/bin',
    });
    const result = await findBinary('/does/not/exist', deps);
    expect(result).toEqual({ binaryPath: null, source: null, settingInvalid: true });
  });

  it('falls back to PATH when no setting is configured', async () => {
    const deps = fakeDeps({
      files: new Set(['/usr/local/bin/partiri']),
      pathEnv: '/usr/local/bin:/usr/bin',
    });
    const result = await findBinary(undefined, deps);
    expect(result).toEqual({
      binaryPath: '/usr/local/bin/partiri',
      source: 'path',
      settingInvalid: false,
    });
  });

  it('falls back to ~/.cargo/bin when PATH has no match', async () => {
    const deps = fakeDeps({
      files: new Set(['/home/dev/.cargo/bin/partiri']),
      pathEnv: '/usr/bin',
      homeDir: '/home/dev',
    });
    const result = await findBinary(undefined, deps);
    expect(result).toEqual({
      binaryPath: '/home/dev/.cargo/bin/partiri',
      source: 'cargo',
      settingInvalid: false,
    });
  });

  it('falls back to the npm global bin last', async () => {
    const deps = fakeDeps({
      files: new Set(['/opt/npm-global/bin/partiri']),
      pathEnv: '/usr/bin',
      homeDir: '/home/dev',
      npmGlobalPrefix: async () => '/opt/npm-global',
    });
    const result = await findBinary(undefined, deps);
    expect(result).toEqual({
      binaryPath: '/opt/npm-global/bin/partiri',
      source: 'npm',
      settingInvalid: false,
    });
  });

  it('resolves to nothing when no source matches', async () => {
    const deps = fakeDeps({ files: new Set(), pathEnv: '/usr/bin' });
    const result = await findBinary(undefined, deps);
    expect(result).toEqual({ binaryPath: null, source: null, settingInvalid: false });
  });

  it('uses partiri.exe on win32 and skips the npm bin subdirectory', async () => {
    const deps = fakeDeps({
      files: new Set(['C:\\npm-global\\partiri.exe']),
      pathEnv: 'C:\\other',
      platform: 'win32',
      npmGlobalPrefix: async () => 'C:\\npm-global',
    });
    const result = await findBinary(undefined, deps);
    expect(result).toEqual({
      binaryPath: 'C:\\npm-global\\partiri.exe',
      source: 'npm',
      settingInvalid: false,
    });
  });
});

describe('installGuidance', () => {
  it('offers cargo and npm on non-Windows', () => {
    expect(installGuidance('linux').messages).toEqual([
      'cargo install partiri-cli',
      'npm i -g @partiri/cli',
    ]);
  });

  it('offers cargo only on Windows, since the npm package has no Windows builds', () => {
    expect(installGuidance('win32').messages).toEqual(['cargo install partiri-cli']);
  });
});

describe('checkVersion', () => {
  it('parses `partiri X.Y.Z` from the real fake-partiri fixture and meets 0.3.0', async () => {
    const result = await checkVersion(FAKE_PARTIRI);
    expect(result.version).toBe('0.3.0');
    expect(result.meetsMinimum).toBe(true);
  });

  it('rejects a CLI version older than the required minimum', async () => {
    const result = await checkVersion(FAKE_PARTIRI, '0.4.0');
    expect(result.meetsMinimum).toBe(false);
  });

  it('treats unparseable --version output as not meeting the minimum', async () => {
    // node --version prints "vX.Y.Z", not "partiri X.Y.Z".
    const result = await checkVersion('node');
    expect(result.meetsMinimum).toBe(false);
  });

  it('resolves to not-meeting-minimum when the binary does not exist', async () => {
    expect((await checkVersion('/nonexistent/partiri-binary-xyz')).meetsMinimum).toBe(false);
  });
});
