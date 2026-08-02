/**
 * Pure normalisation of the `service jobs` CLI payload. Kept free of any
 * `vscode` import so it unit-tests without a mock, following the
 * src/commands/wizardLogic.ts precedent.
 *
 * The live payload is a bare array of
 * `{ job_type, status, created_at, deploy_ref }`, with `created_at` already
 * formatted by the CLI (`10/07/2026 15:08`) and `deploy_ref` sometimes the
 * literal em dash the CLI uses for "none". Note this differs from the jobs
 * embedded in `service metrics`, which use `type` and an ISO timestamp — both
 * are accepted here.
 */

import { isRecord, readString, unwrapArray } from '../util/records';
import { formatDayTime } from '../util/time';

export interface ServiceJob {
  type: string;
  status: string;
  when: string;
  deployRef: string | undefined;
}

/** The CLI renders "no deploy ref" as an em dash; treat that as absent. */
function readDeployRef(value: unknown): string | undefined {
  const text = readString(value);
  return text === undefined || text === '—' || text === '-' ? undefined : text;
}

function toJob(entry: unknown): ServiceJob | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }
  const type = readString(entry.job_type) ?? readString(entry.type);
  const status = readString(entry.status);
  if (type === undefined && status === undefined) {
    return undefined;
  }
  return {
    type: type ?? 'job',
    status: status ?? 'unknown',
    when: formatDayTime(entry.created_at),
    deployRef: readDeployRef(entry.deploy_ref),
  };
}

/**
 * Accepts the bare array the CLI returns, plus `{ jobs: [...] }` wrappers.
 * Never throws — an unrecognised payload yields an empty list.
 */
export function normalizeJobs(data: unknown): ServiceJob[] {
  const raw = unwrapArray(data, 'jobs');
  if (raw === undefined) {
    return [];
  }
  return raw.map(toJob).filter((job): job is ServiceJob => job !== undefined);
}
