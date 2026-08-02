import type { ContextWorkspace } from '../state/contextTypes';

/**
 * Pure logic for the "New Service" wizard: runtime auto-detection, service
 * name validation, project picker items, wizard step transitions, and
 * template placeholder substitution. Kept free of any `vscode` import so it
 * can run under a plain unit test — src/commands/initWizard.ts is the thin
 * vscode-QuickPick orchestrator built on top of this module.
 */

export type Runtime =
  | 'deno'
  | 'node'
  | 'rust'
  | 'python'
  | 'go'
  | 'ruby'
  | 'elixir'
  | 'php'
  | 'jvm'
  | 'dotnet'
  | 'cpp'
  | 'static';

interface RuntimeDetector {
  pattern: RegExp;
  runtime: Runtime;
}

// Order matters: more specific build-tooling markers are checked before the
// index.html-only static fallback.
const RUNTIME_DETECTORS: RuntimeDetector[] = [
  { pattern: /^deno\.jsonc?$/, runtime: 'deno' },
  { pattern: /^package\.json$/, runtime: 'node' },
  { pattern: /^Cargo\.toml$/, runtime: 'rust' },
  { pattern: /^(pyproject\.toml|requirements\.txt)$/, runtime: 'python' },
  { pattern: /^go\.mod$/, runtime: 'go' },
  { pattern: /^Gemfile$/, runtime: 'ruby' },
  { pattern: /^mix\.exs$/, runtime: 'elixir' },
  { pattern: /^composer\.json$/, runtime: 'php' },
  { pattern: /^(pom\.xml|build\.gradle(\.kts)?)$/, runtime: 'jvm' },
  { pattern: /\.csproj$/, runtime: 'dotnet' },
  { pattern: /^(CMakeLists\.txt|Makefile)$/, runtime: 'cpp' },
];

/** Detect a runtime from a flat list of file/basename entries in the workspace root. */
export function detectRuntime(files: string[]): Runtime | undefined {
  for (const detector of RUNTIME_DETECTORS) {
    if (files.some((file) => detector.pattern.test(file))) {
      return detector.runtime;
    }
  }
  return files.includes('index.html') ? 'static' : undefined;
}

const SERVICE_NAME_MAX_LENGTH = 16;
const SERVICE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Live-validated per step: returns an error message, or undefined when valid. */
export function validateServiceName(name: string): string | undefined {
  if (name.length === 0) {
    return 'Service name is required.';
  }
  if (name.length > SERVICE_NAME_MAX_LENGTH) {
    return `Service name must be ≤${SERVICE_NAME_MAX_LENGTH} characters.`;
  }
  if (!SERVICE_NAME_PATTERN.test(name)) {
    return 'Service name must start with a letter or digit and contain only lowercase letters, digits, and hyphens.';
  }
  return undefined;
}

export const CREATE_NEW_PROJECT_ID = '__create_new_project__';

export interface PickItem {
  id: string;
  label: string;
  description?: string;
}

export function projectPickItems(workspace: ContextWorkspace): PickItem[] {
  return [
    ...workspace.projects.map((project) => ({
      id: project.id,
      label: project.name,
      description: project.environment,
    })),
    { id: CREATE_NEW_PROJECT_ID, label: 'Create new project…' },
  ];
}

export function regionPickItems(workspace: ContextWorkspace): PickItem[] {
  return workspace.regions.map((region) => ({
    id: region.id,
    label: region.label,
    description: region.country_code,
  }));
}

export function podPickItems(workspace: ContextWorkspace): PickItem[] {
  return workspace.pods.map((pod) => ({
    id: pod.id,
    label: pod.label,
    description: `${pod.cpu} vCPU · ${pod.ram} · €${pod.price_eur_month.toFixed(2)}/month`,
  }));
}

// --- Wizard step state machine -------------------------------------------

export type WizardStepId =
  'workspace' | 'project' | 'serviceName' | 'deployType' | 'source' | 'region' | 'pod' | 'done';

export const WIZARD_STEP_ORDER: readonly WizardStepId[] = [
  'workspace',
  'project',
  'serviceName',
  'deployType',
  'source',
  'region',
  'pod',
  'done',
];

export type SourceAnswer =
  | { kind: 'repo'; repositoryUrl: string; repositoryBranch: string }
  | { kind: 'registry'; registryUrl: string };

export interface WizardAnswers {
  workspaceId?: string;
  projectId?: string;
  serviceName?: string;
  deployType?: string;
  runtime?: Runtime;
  source?: SourceAnswer;
  regionId?: string;
  podId?: string;
}

export interface WizardState {
  step: WizardStepId;
  answers: WizardAnswers;
}

export function initialWizardState(): WizardState {
  return { step: 'workspace', answers: {} };
}

/** Apply an answer for the current step and move to the next one. */
export function advanceWizard(state: WizardState, patch: Partial<WizardAnswers>): WizardState {
  const answers = { ...state.answers, ...patch };
  const currentIndex = WIZARD_STEP_ORDER.indexOf(state.step);
  const nextStep = WIZARD_STEP_ORDER[currentIndex + 1] ?? 'done';
  return { step: nextStep, answers };
}

export function isWizardComplete(state: WizardState): state is WizardState & {
  answers: Required<
    Pick<
      WizardAnswers,
      | 'workspaceId'
      | 'projectId'
      | 'serviceName'
      | 'deployType'
      | 'runtime'
      | 'source'
      | 'regionId'
      | 'podId'
    >
  >;
} {
  const a = state.answers;
  return (
    state.step === 'done' &&
    !!a.workspaceId &&
    !!a.projectId &&
    !!a.serviceName &&
    !!a.deployType &&
    !!a.runtime &&
    !!a.source &&
    !!a.regionId &&
    !!a.podId
  );
}

// --- Template placeholder substitution ------------------------------------

const WORKSPACE_PLACEHOLDER = "<workspace UUID — run 'partiri -j llm context' to discover>";
const PROJECT_PLACEHOLDER = '<project UUID — same source>';
const REGION_PLACEHOLDER = '<region UUID>';
const POD_PLACEHOLDER = '<pod UUID>';
const DEFAULT_SERVICE_NAME = 'my-service';
const DEFAULT_REPOSITORY_URL = 'https://github.com/your-org/your-repo.git';
const DEFAULT_REPOSITORY_BRANCH = 'main';

export interface TemplateSubstitutions {
  workspaceId: string;
  projectId: string;
  serviceName: string;
  regionId: string;
  podId: string;
  repositoryUrl?: string;
  repositoryBranch?: string;
}

/**
 * Substitute the UUID/name/repo/branch placeholders `llm template` fills its
 * commented example with, into the wizard's actual answers. Operates on the
 * raw template string (preserving its comments) rather than re-serializing
 * parsed JSON, per docs/cli-contract.md §9 — the CLI is the schema's source
 * of truth, this shell only fills in values.
 */
export function substituteTemplate(template: string, values: TemplateSubstitutions): string {
  let result = template
    .split(WORKSPACE_PLACEHOLDER)
    .join(values.workspaceId)
    .split(PROJECT_PLACEHOLDER)
    .join(values.projectId)
    .split(REGION_PLACEHOLDER)
    .join(values.regionId)
    .split(POD_PLACEHOLDER)
    .join(values.podId)
    .split(`"${DEFAULT_SERVICE_NAME}"`)
    .join(`"${values.serviceName}"`);

  if (values.repositoryUrl) {
    result = result.split(`"${DEFAULT_REPOSITORY_URL}"`).join(`"${values.repositoryUrl}"`);
  }
  if (values.repositoryBranch) {
    result = result.split(`"${DEFAULT_REPOSITORY_BRANCH}"`).join(`"${values.repositoryBranch}"`);
  }
  return result;
}

// --- `llm schema` deploy_type enum lookup ---------------------------------

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Extract `enum` values from a deploy_type schema node: a direct `enum`, or one nested under an anyOf/oneOf branch. */
function extractEnumFromDeployTypeNode(node: unknown, depth = 0): string[] | undefined {
  if (depth > 6 || typeof node !== 'object' || node === null) {
    return undefined;
  }
  const record = node as Record<string, unknown>;
  if (isStringArray(record.enum)) {
    return record.enum;
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = record[key];
    if (!Array.isArray(branches)) {
      continue;
    }
    for (const branch of branches) {
      const found = extractEnumFromDeployTypeNode(branch, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

/**
 * Search a `llm schema` JSON document for the `deploy_type` property's enum
 * values, wherever it's nested (e.g. under `properties.service.properties`).
 * Only enums found under a `deploy_type` key are considered — an unrelated
 * enum-bearing property that happens to appear earlier in the document must
 * never win (this previously picked up the first `enum` array anywhere).
 */
export function findDeployTypeEnum(value: unknown, depth = 0): string[] | undefined {
  if (depth > 8 || typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if ('deploy_type' in record) {
    const found = extractEnumFromDeployTypeNode(record.deploy_type);
    if (found) {
      return found;
    }
  }
  for (const child of Object.values(record)) {
    const nested = findDeployTypeEnum(child, depth + 1);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}
