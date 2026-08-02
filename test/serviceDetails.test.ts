import { describe, expect, it } from 'vitest';
import { findServiceDetails } from '../src/state/serviceDetails';
import type { ContextData } from '../src/state/contextTypes';

const context: ContextData = {
  user: { email: 'dev@example.com' },
  workspaces: [
    {
      id: 'ws-1',
      name: 'Acme',
      email: 'dev@example.com',
      projects: [{ id: 'proj-1', name: 'production', environment: 'production' }],
      regions: [
        { id: 'region-1', name: 'ams', label: 'Amsterdam', country_code: 'NL' },
        { id: 'region-2', name: 'fra', label: 'Frankfurt', country_code: 'DE' },
      ],
      pods: [
        {
          id: 'pod-1',
          name: 'small',
          label: 'Small',
          cpu: '0.5',
          ram: '512MB',
          price_eur_month: 4.5,
        },
      ],
      volume_price_per_gb: 0.5,
      balance_eur: 12.34,
      registry_secrets: [],
      repository_secrets: [],
      services: [
        {
          id: 'svc-1',
          name: 'api',
          fk_project: 'proj-1',
          fk_region: 'region-2',
          fk_pod: 'pod-1',
          deploy_type: 'webservice',
          runtime: 'node',
        },
      ],
    },
  ],
};

describe('findServiceDetails', () => {
  it('dereferences region and pod UUIDs into readable labels', () => {
    const details = findServiceDetails(context, 'svc-1');
    expect(details).toEqual({
      name: 'api',
      workspace: 'Acme',
      project: 'production',
      region: 'Frankfurt (DE)',
      pod: 'Small',
      deployType: 'webservice',
      runtime: 'node',
    });
  });

  it('returns undefined for an unknown or absent service id', () => {
    expect(findServiceDetails(context, 'nope')).toBeUndefined();
    expect(findServiceDetails(context, undefined)).toBeUndefined();
    expect(findServiceDetails(null, 'svc-1')).toBeUndefined();
  });

  it('leaves a field undefined when its reference does not resolve', () => {
    const orphaned: ContextData = {
      ...context,
      workspaces: [
        {
          ...context.workspaces[0]!,
          regions: [],
          pods: [],
        },
      ],
    };
    const details = findServiceDetails(orphaned, 'svc-1');
    expect(details?.region).toBeUndefined();
    expect(details?.pod).toBeUndefined();
    expect(details?.name).toBe('api');
  });
});

describe('nullable fields in live context data', () => {
  it('omits the country code when the API returns null for it', () => {
    const nullable = {
      ...context,
      workspaces: [
        {
          ...context.workspaces[0]!,
          regions: [
            {
              id: 'region-2',
              name: 'Nürnberg',
              label: 'Nürnberg',
              country_code: null as unknown as string,
            },
          ],
        },
      ],
    };
    expect(findServiceDetails(nullable, 'svc-1')?.region).toBe('Nürnberg');
  });

  it('falls back to the pod name when it has no label', () => {
    const nullable = {
      ...context,
      workspaces: [
        {
          ...context.workspaces[0]!,
          pods: [
            {
              id: 'pod-1',
              name: 'small',
              label: null as unknown as string,
              cpu: '0.5',
              ram: '512Mi',
              price_eur_month: 4.5,
            },
          ],
        },
      ],
    };
    expect(findServiceDetails(nullable, 'svc-1')?.pod).toBe('small');
  });
});
