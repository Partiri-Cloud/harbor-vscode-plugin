import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeJobs } from '../src/jobs/normalize';

const FIXTURES_DIR = fileURLToPath(new URL('../../docs/fixtures/', import.meta.url));

function loadFixtureData<T>(name: string): T {
  const raw = JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, 'utf8'));
  return raw.data as T;
}

describe('normalizeJobs', () => {
  it('parses the live `service jobs` array shape', () => {
    const jobs = normalizeJobs([
      {
        created_at: '10/07/2026 15:08',
        deploy_ref: '—',
        job_type: 'deploy',
        status: 'succeeded',
      },
      {
        created_at: '16/06/2026 21:19',
        deploy_ref: 'abc123',
        job_type: 'deploy',
        status: 'failed',
      },
    ]);

    expect(jobs).toEqual([
      { type: 'deploy', status: 'succeeded', when: '10/07/2026 15:08', deployRef: undefined },
      { type: 'deploy', status: 'failed', when: '16/06/2026 21:19', deployRef: 'abc123' },
    ]);
  });

  it('accepts the `type` + ISO shape used inside the metrics payload', () => {
    const jobs = normalizeJobs([
      {
        created_at: '2026-07-10T15:08:17.492695+00:00',
        deploy_ref: null,
        type: 'deploy',
        status: 'succeeded',
      },
    ]);
    expect(jobs[0]?.type).toBe('deploy');
    expect(jobs[0]?.when).toBe('2026-07-10 15:08');
    expect(jobs[0]?.deployRef).toBeUndefined();
  });

  it('unwraps a { jobs: [...] } envelope', () => {
    expect(normalizeJobs({ jobs: [{ job_type: 'deploy', status: 'succeeded' }] })).toHaveLength(1);
  });

  it('drops entries that carry neither a type nor a status', () => {
    expect(normalizeJobs([{ created_at: 'x' }, { job_type: 'deploy', status: 'ok' }])).toHaveLength(
      1,
    );
  });

  it('returns an empty list for unrecognised payloads without throwing', () => {
    expect(normalizeJobs(undefined)).toEqual([]);
    expect(normalizeJobs(null)).toEqual([]);
    expect(normalizeJobs('nope')).toEqual([]);
    expect(normalizeJobs({ foo: 1 })).toEqual([]);
  });

  /**
   * The timestamp is sliced as written and deliberately NOT re-timed into the
   * local zone or UTC: a job created at 15:08 must not render as 13:08 with no
   * zone marker to explain it. Pinned because a second, UTC-converting copy of
   * this formatter once lived in src/metrics/normalize.ts and silently drifted.
   */
  it('does not apply the UTC offset when formatting a timestamp', () => {
    const jobs = normalizeJobs([
      { type: 'deploy', status: 'succeeded', created_at: '2026-07-10T15:08:17+02:00' },
    ]);
    expect(jobs[0]?.when).toBe('2026-07-10 15:08');
  });
});

describe('normalizeJobs — real fixture regression', () => {
  it('formats every job in docs/fixtures/service-metrics.json compactly', () => {
    const data = loadFixtureData<{ jobs: unknown[] }>('service-metrics.json');
    const jobs = normalizeJobs(data.jobs);

    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.when).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    }
  });

  it('parses docs/fixtures/jobs-list.json, the `service jobs` shape', () => {
    const jobs = normalizeJobs(loadFixtureData('jobs-list.json'));
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.type).not.toBe('');
      expect(job.status).not.toBe('');
    }
  });
});
