import { isRecord, readString, stringAt } from '../util/records';
import type { ContextData, ContextPod, ContextRegion } from './contextTypes';

/**
 * Resolve a service id into the human-readable identity shown in the Details
 * section. Region and pod arrive from `llm context` as UUID references on the
 * service, so they are dereferenced against the owning workspace's own region
 * and pod lists. Pure and vscode-free so it unit-tests without a mock.
 */

export interface ServiceDetails {
  name: string;
  workspace: string | undefined;
  project: string | undefined;
  region: string | undefined;
  pod: string | undefined;
  deployType: string | undefined;
  runtime: string | undefined;
}

/**
 * The server-side record embedded in the `service metrics` payload. Only `id`
 * and `external_sd_url` are known to be returned today; the internal and
 * custom URL keys are probed defensively so they appear automatically if the
 * API starts sending them, and stay absent until then.
 */
export interface ServiceRecord {
  id: string | undefined;
  internalUrl: string | undefined;
  externalUrl: string | undefined;
  customUrl: string | undefined;
}

export function extractServiceRecord(metricsData: unknown): ServiceRecord {
  const service = isRecord(metricsData) && isRecord(metricsData.service) ? metricsData.service : {};
  return {
    id: stringAt(service, ['id']),
    internalUrl: stringAt(service, ['internal_sd_url', 'internal_url', 'internal_host']),
    externalUrl: stringAt(service, ['external_sd_url', 'external_url']),
    customUrl: stringAt(service, ['custom_url', 'custom_domain', 'custom_sd_url']),
  };
}

// Region and pod fields are nullable in live data, so join only the parts that
// are actually present.

function formatRegion(region: ContextRegion): string | undefined {
  const label = readString(region.label) ?? readString(region.name);
  if (!label) {
    return undefined;
  }
  const country = readString(region.country_code);
  return country ? `${label} (${country})` : label;
}

/** Name only — the CPU/RAM figures belong in Monitoring, not in the identity panel. */
function formatPod(pod: ContextPod): string | undefined {
  return readString(pod.label) ?? readString(pod.name);
}

export function findServiceDetails(
  context: ContextData | null | undefined,
  serviceId: string | undefined,
): ServiceDetails | undefined {
  if (!context || !serviceId) {
    return undefined;
  }
  for (const workspace of context.workspaces) {
    const service = workspace.services.find((candidate) => candidate.id === serviceId);
    if (!service) {
      continue;
    }
    const region = workspace.regions.find((candidate) => candidate.id === service.fk_region);
    const pod = workspace.pods.find((candidate) => candidate.id === service.fk_pod);
    const project = workspace.projects.find((candidate) => candidate.id === service.fk_project);
    return {
      name: service.name,
      workspace: workspace.name,
      project: project?.name,
      region: region ? formatRegion(region) : undefined,
      pod: pod ? formatPod(pod) : undefined,
      deployType: service.deploy_type,
      runtime: service.runtime,
    };
  }
  return undefined;
}
