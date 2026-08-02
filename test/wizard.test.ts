import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CREATE_NEW_PROJECT_ID,
  advanceWizard,
  detectRuntime,
  findDeployTypeEnum,
  initialWizardState,
  isWizardComplete,
  podPickItems,
  projectPickItems,
  regionPickItems,
  substituteTemplate,
  validateServiceName,
  WIZARD_STEP_ORDER,
} from '../src/commands/wizardLogic';
import type { ContextData } from '../src/state/contextTypes';

const FIXTURES_DIR = fileURLToPath(new URL('../../docs/fixtures/', import.meta.url));

function loadFixtureData<T>(name: string): T {
  const raw = JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, 'utf8'));
  return raw.data as T;
}

const context = loadFixtureData<ContextData>('llm-context.json');
const workspace = context.workspaces[0]!;

describe('detectRuntime', () => {
  it.each([
    [['deno.jsonc'], 'deno'],
    [['package.json'], 'node'],
    [['Cargo.toml'], 'rust'],
    [['pyproject.toml'], 'python'],
    [['requirements.txt'], 'python'],
    [['go.mod'], 'go'],
    [['Gemfile'], 'ruby'],
    [['mix.exs'], 'elixir'],
    [['composer.json'], 'php'],
    [['pom.xml'], 'jvm'],
    [['build.gradle.kts'], 'jvm'],
    [['App.csproj'], 'dotnet'],
    [['CMakeLists.txt'], 'cpp'],
    [['Makefile'], 'cpp'],
    [['index.html'], 'static'],
  ] as const)('detects %s -> %s', (files, expected) => {
    expect(detectRuntime([...files])).toBe(expected);
  });

  it('prefers a stronger runtime marker over an incidental index.html', () => {
    expect(detectRuntime(['index.html', 'package.json'])).toBe('node');
  });

  it('returns undefined when nothing matches', () => {
    expect(detectRuntime(['README.md'])).toBeUndefined();
  });
});

describe('validateServiceName', () => {
  it('accepts a valid short lowercase name', () => {
    expect(validateServiceName('api')).toBeUndefined();
  });

  it('rejects an empty name', () => {
    expect(validateServiceName('')).toMatch(/required/);
  });

  it('rejects a name over 16 characters', () => {
    expect(validateServiceName('a'.repeat(17))).toMatch(/16/);
  });

  it('accepts exactly 16 characters', () => {
    expect(validateServiceName('a'.repeat(16))).toBeUndefined();
  });

  it('rejects uppercase and invalid characters', () => {
    expect(validateServiceName('My_Service')).toBeDefined();
  });
});

describe('project/region/pod pick items (fed by the contextStore fixture)', () => {
  it('appends a "create new project" sentinel', () => {
    const items = projectPickItems(workspace);
    expect(items.map((i) => i.id)).toEqual(['proj-1', CREATE_NEW_PROJECT_ID]);
  });

  it('surfaces region label + country code', () => {
    expect(regionPickItems(workspace)).toEqual([
      { id: 'region-1', label: 'Amsterdam', description: 'NL' },
    ]);
  });

  it('surfaces pod cpu/ram/price for the label', () => {
    expect(podPickItems(workspace)).toEqual([
      { id: 'pod-1', label: 'Small', description: '1 vCPU · 2GB · €4.50/month' },
    ]);
  });
});

describe('wizard state machine', () => {
  it('starts at the workspace step with no answers', () => {
    const state = initialWizardState();
    expect(state.step).toBe('workspace');
    expect(state.answers).toEqual({});
  });

  it('walks the full step order to done, accumulating answers', () => {
    let state = initialWizardState();
    state = advanceWizard(state, { workspaceId: workspace.id });
    expect(state.step).toBe('project');

    state = advanceWizard(state, { projectId: workspace.projects[0]!.id });
    expect(state.step).toBe('serviceName');

    state = advanceWizard(state, { serviceName: 'api' });
    expect(state.step).toBe('deployType');

    state = advanceWizard(state, { deployType: 'webservice', runtime: 'node' });
    expect(state.step).toBe('source');

    state = advanceWizard(state, {
      source: {
        kind: 'repo',
        repositoryUrl: 'https://github.com/acme/api.git',
        repositoryBranch: 'main',
      },
    });
    expect(state.step).toBe('region');

    state = advanceWizard(state, { regionId: workspace.regions[0]!.id });
    expect(state.step).toBe('pod');

    state = advanceWizard(state, { podId: workspace.pods[0]!.id });
    expect(state.step).toBe('done');

    expect(isWizardComplete(state)).toBe(true);
    expect(state.answers).toEqual({
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      serviceName: 'api',
      deployType: 'webservice',
      runtime: 'node',
      source: {
        kind: 'repo',
        repositoryUrl: 'https://github.com/acme/api.git',
        repositoryBranch: 'main',
      },
      regionId: 'region-1',
      podId: 'pod-1',
    });
  });

  it('is not complete before every step has answered', () => {
    const state = advanceWizard(initialWizardState(), { workspaceId: workspace.id });
    expect(isWizardComplete(state)).toBe(false);
  });

  it('never leaves a gap in the declared step order', () => {
    expect(WIZARD_STEP_ORDER[0]).toBe('workspace');
    expect(WIZARD_STEP_ORDER.at(-1)).toBe('done');
  });
});

describe('substituteTemplate', () => {
  const template = loadFixtureData<{ template: string }>('llm-template.json').template;

  it('fills workspace/project/region/pod UUIDs, name, repo, and branch', () => {
    const filled = substituteTemplate(template, {
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      serviceName: 'api',
      regionId: 'region-1',
      podId: 'pod-1',
      repositoryUrl: 'https://github.com/acme/api.git',
      repositoryBranch: 'develop',
    });

    expect(filled).toContain('"fk_workspace": "ws-1"');
    expect(filled).toContain('"fk_project": "proj-1"');
    expect(filled).toContain('"name": "api"');
    expect(filled).toContain('"fk_region": "region-1"');
    expect(filled).toContain('"fk_pod": "pod-1"');
    expect(filled).toContain('"repository_url": "https://github.com/acme/api.git"');
    expect(filled).toContain('"repository_branch": "develop"');
    expect(filled).not.toContain('<workspace UUID');
    expect(filled).not.toContain('<project UUID');
    expect(filled).not.toContain('<region UUID>');
    expect(filled).not.toContain('<pod UUID>');

    // The result must remain valid JSON once JSONC comments are absent from
    // this particular fixture template.
    expect(() => JSON.parse(filled)).not.toThrow();
  });

  it('leaves the default repo placeholder untouched when no repositoryUrl is given (registry source)', () => {
    const filled = substituteTemplate(template, {
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      serviceName: 'api',
      regionId: 'region-1',
      podId: 'pod-1',
    });
    expect(filled).toContain('your-org/your-repo.git');
  });
});

describe('findDeployTypeEnum', () => {
  it("returns deploy_type's enum even when another enum-bearing property precedes it", () => {
    const schema = {
      properties: {
        other_field: { type: 'string', enum: ['x', 'y'] },
        deploy_type: { type: 'string', enum: ['webservice', 'static'] },
      },
    };
    expect(findDeployTypeEnum(schema)).toEqual(['webservice', 'static']);
  });

  it('finds deploy_type nested under properties', () => {
    const schema = {
      type: 'object',
      properties: {
        service: {
          type: 'object',
          properties: {
            deploy_type: { type: 'string', enum: ['webservice', 'worker', 'static'] },
          },
        },
      },
    };
    expect(findDeployTypeEnum(schema)).toEqual(['webservice', 'worker', 'static']);
  });

  it('finds an enum nested in anyOf under deploy_type', () => {
    const schema = {
      properties: {
        deploy_type: {
          anyOf: [{ type: 'null' }, { type: 'string', enum: ['webservice', 'private-service'] }],
        },
      },
    };
    expect(findDeployTypeEnum(schema)).toEqual(['webservice', 'private-service']);
  });

  it('returns undefined when there is no deploy_type property', () => {
    const schema = { properties: { name: { type: 'string' } } };
    expect(findDeployTypeEnum(schema)).toBeUndefined();
  });
});
