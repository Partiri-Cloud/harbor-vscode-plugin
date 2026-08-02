import { execFile } from 'node:child_process';
import { promises as fs, constants as fsConstants } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MIN_CLI_VERSION = '0.3.0';

export type DiscoverySource = 'setting' | 'path' | 'cargo' | 'npm';

export interface DiscoveryResult {
  binaryPath: string | null;
  source: DiscoverySource | null;
  /** The setting was non-empty but did not resolve to an executable file. */
  settingInvalid: boolean;
}

export interface InstallGuidance {
  messages: string[];
}

/**
 * Dependencies injected so discovery is unit-testable without touching the
 * real filesystem, PATH, or spawning npm. Production callers use
 * defaultDiscoveryDeps(); tests supply fakes.
 */
export interface DiscoveryDeps {
  platform: NodeJS.Platform;
  pathEnv: string;
  homeDir: string;
  isExecutableFile: (candidate: string) => Promise<boolean>;
  npmGlobalPrefix: () => Promise<string | null>;
}

function defaultDiscoveryDeps(): DiscoveryDeps {
  return {
    platform: process.platform,
    pathEnv: process.env.PATH ?? '',
    homeDir: process.env.HOME ?? process.env.USERPROFILE ?? '',
    isExecutableFile,
    npmGlobalPrefix,
  };
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === 'win32') {
      return true;
    }
    await fs.access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function npmGlobalPrefix(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('npm', ['prefix', '-g']);
    const prefix = stdout.trim();
    return prefix.length > 0 ? prefix : null;
  } catch {
    return null;
  }
}

function exeName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'partiri.exe' : 'partiri';
}

// Path handling must follow deps.platform, not the host OS running this
// code, so discovery order is deterministic and testable on any host.
function pathModuleFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

async function findOnPath(deps: DiscoveryDeps, name: string): Promise<string | null> {
  const p = pathModuleFor(deps.platform);
  const dirs = deps.pathEnv.split(p.delimiter).filter((entry) => entry.length > 0);
  for (const dir of dirs) {
    const candidate = p.join(dir, name);
    if (await deps.isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function findNpmGlobalBin(deps: DiscoveryDeps, name: string): Promise<string | null> {
  const prefix = await deps.npmGlobalPrefix();
  if (!prefix) {
    return null;
  }
  const p = pathModuleFor(deps.platform);
  const binDir = deps.platform === 'win32' ? prefix : p.join(prefix, 'bin');
  const candidate = p.join(binDir, name);
  return (await deps.isExecutableFile(candidate)) ? candidate : null;
}

/**
 * Resolve the partiri binary in the order mandated by
 * docs/cli-contract.md §1: editor setting -> PATH -> ~/.cargo/bin -> npm
 * global bin. An explicit setting always wins, even when it doesn't
 * currently resolve.
 */
export async function findBinary(
  settingPath: string | undefined,
  deps: DiscoveryDeps = defaultDiscoveryDeps(),
): Promise<DiscoveryResult> {
  const name = exeName(deps.platform);

  const trimmedSetting = settingPath?.trim();
  if (trimmedSetting) {
    const resolved = await deps.isExecutableFile(trimmedSetting);
    return resolved
      ? { binaryPath: trimmedSetting, source: 'setting', settingInvalid: false }
      : { binaryPath: null, source: null, settingInvalid: true };
  }

  const onPath = await findOnPath(deps, name);
  if (onPath) {
    return { binaryPath: onPath, source: 'path', settingInvalid: false };
  }

  const cargoPath = pathModuleFor(deps.platform).join(deps.homeDir, '.cargo', 'bin', name);
  if (deps.homeDir && (await deps.isExecutableFile(cargoPath))) {
    return { binaryPath: cargoPath, source: 'cargo', settingInvalid: false };
  }

  const npmBin = await findNpmGlobalBin(deps, name);
  if (npmBin) {
    return { binaryPath: npmBin, source: 'npm', settingInvalid: false };
  }

  return { binaryPath: null, source: null, settingInvalid: false };
}

/** The npm package has no Windows builds; show cargo-only guidance there. */
export function installGuidance(platform: NodeJS.Platform = process.platform): InstallGuidance {
  return platform === 'win32'
    ? { messages: ['cargo install partiri-cli'] }
    : { messages: ['cargo install partiri-cli', 'npm i -g @partiri/cli'] };
}

export interface VersionCheckResult {
  version: string | null;
  meetsMinimum: boolean;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Once, at activation: `partiri --version`, parsed as `partiri X.Y.Z` (docs/cli-contract.md §2). */
export async function checkVersion(
  binaryPath: string,
  minVersion: string = MIN_CLI_VERSION,
): Promise<VersionCheckResult> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ['--version']);
    const match = /^partiri (\d+\.\d+\.\d+)/.exec(stdout.trim());
    if (!match) {
      return { version: null, meetsMinimum: false };
    }
    const version = match[1] as string;
    return { version, meetsMinimum: compareVersions(version, minVersion) >= 0 };
  } catch {
    return { version: null, meetsMinimum: false };
  }
}
