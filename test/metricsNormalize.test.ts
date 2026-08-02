import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeMetrics } from '../src/metrics/normalize';

const FIXTURES_DIR = fileURLToPath(new URL('../../docs/fixtures/', import.meta.url));

function loadFixtureData<T>(name: string): T {
  const raw = JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, 'utf8'));
  return raw.data as T;
}

describe('normalizeMetrics', () => {
  it('scales a bare 0-1 CPU fraction to a percent', () => {
    const model = normalizeMetrics({ cpu: 0.42 });
    expect(model.cpu.percent).toBe(42);
    expect(model.cpu.label).toBe('42%');
    expect(model.unavailable).toBe(false);
  });

  it('reads a flat named percent field as already-percent', () => {
    const model = normalizeMetrics({ cpu_percent: 55 });
    expect(model.cpu.percent).toBe(55);
    expect(model.cpu.label).toBe('55%');
  });

  it('reads a nested field wrapped under metrics.cpu.percent', () => {
    const model = normalizeMetrics({ metrics: { cpu: { percent: 0.3 } } });
    expect(model.cpu.percent).toBe(30);
  });

  it('computes a percent and a formatted byte label from a used/total pair', () => {
    const model = normalizeMetrics({
      memory: { used: 318 * 1024 * 1024, total: 512 * 1024 * 1024 },
    });
    expect(model.memory.percent).toBeCloseTo(62.109375, 5);
    expect(model.memory.label).toBe('318 MB / 512 MB');
  });

  it('clamps CPU above 100% instead of treating it as unavailable', () => {
    const model = normalizeMetrics({ cpu_percent: 250 });
    expect(model.cpu.percent).toBe(100);
    expect(model.cpu.label).toBe('100%');
    expect(model.unavailable).toBe(false);
  });

  it('emits an undefined percent and a formatted rate label for a counter with no limit', () => {
    const model = normalizeMetrics({ network: { in_bytes_per_sec: 12000 } });
    expect(model.networkIn.percent).toBeUndefined();
    expect(model.networkIn.label).toMatch(/KB\/s$/);
  });

  it('emits an undefined percent and a formatted total label for a bare cumulative counter', () => {
    const model = normalizeMetrics({ network: { in_bytes: 1258291 } });
    expect(model.networkIn.percent).toBeUndefined();
    expect(model.networkIn.label).toMatch(/MB total$/);
  });

  it('degrades only the affected gauge for NaN, Infinity, and negative values', () => {
    const nan = normalizeMetrics({ cpu: NaN, memory: { used: 1, total: 2 } });
    expect(nan.cpu.percent).toBeUndefined();
    expect(nan.cpu.label).toBe('unavailable');
    expect(nan.memory.percent).toBe(50);
    expect(nan.unavailable).toBe(false);

    const infinite = normalizeMetrics({ cpu: Infinity, memory: { used: 1, total: 2 } });
    expect(infinite.cpu.percent).toBeUndefined();
    expect(infinite.cpu.label).toBe('unavailable');
    expect(infinite.unavailable).toBe(false);

    const negative = normalizeMetrics({ cpu: -5, memory: { used: 1, total: 2 } });
    expect(negative.cpu.percent).toBeUndefined();
    expect(negative.cpu.label).toBe('unavailable');
    expect(negative.unavailable).toBe(false);
  });

  it('marks the whole model unavailable when the payload matches no known shape', () => {
    const model = normalizeMetrics({ foo: 'bar' });
    expect(model.unavailable).toBe(true);
    expect(model.cpu).toEqual({ percent: undefined, label: 'unavailable' });
    expect(model.memory).toEqual({ percent: undefined, label: 'unavailable' });
    expect(model.networkIn).toEqual({ percent: undefined, label: 'unavailable' });
    expect(model.networkOut).toEqual({ percent: undefined, label: 'unavailable' });
  });

  it.each([['a string'], [42], [null], [['array']]])(
    'never throws on non-object input %j and marks it unavailable',
    (input) => {
      expect(() => normalizeMetrics(input)).not.toThrow();
      expect(normalizeMetrics(input).unavailable).toBe(true);
    },
  );

  it('ignores the recent-jobs list the payload carries — the Recent Jobs tree owns it', () => {
    const model = normalizeMetrics({
      cpu_percent: 10,
      jobs: [{ job_type: 'deploy', status: 'succeeded', created_at: '23/07/2026 10:30' }],
    });
    expect(model).not.toHaveProperty('jobs');
    expect(model.unavailable).toBe(false);
  });
});

describe('normalizeMetrics — real time-series payload shape', () => {
  it('parses a cpu series under data.metrics.cpu, taking the last entry as current and scaling/clamping to a percent', () => {
    const model = normalizeMetrics({
      metrics: {
        cpu: [
          [1785582113, 0.00193295832726468],
          [1785582143, 0.001917301705959649],
        ],
      },
    });
    expect(model.cpu.percent).toBeCloseTo(0.1917301705959649, 10);
    expect(model.cpu.label).toBe('0.19%');
    expect(model.cpu.series).toEqual([0.00193295832726468, 0.001917301705959649]);
    expect(model.unavailable).toBe(false);
  });

  it('clamps a cpu series fraction above 1 (100%+) to 100', () => {
    const model = normalizeMetrics({ metrics: { cpu: [[1, 1.5]] } });
    expect(model.cpu.percent).toBe(100);
    expect(model.cpu.label).toBe('100.0%');
  });

  it('labels a memory series in formatted bytes with an undefined percent (no limit in the payload)', () => {
    const model = normalizeMetrics({
      metrics: {
        memory: [
          [1785582113, 394424320],
          [1785582143, 394424320],
        ],
      },
    });
    expect(model.memory.percent).toBeUndefined();
    expect(model.memory.label).toBe('376 MB');
    expect(model.memory.series).toEqual([394424320, 394424320]);
  });

  it('labels network_download / network_upload series as formatted rates with an undefined percent', () => {
    const model = normalizeMetrics({
      metrics: {
        network_download: [
          [1785582113, 114.64958693028868],
          [1785582143, 114.2],
        ],
        network_upload: [
          [1785582113, 58.20477118722732],
          [1785582143, 58.1],
        ],
      },
    });
    expect(model.networkIn.percent).toBeUndefined();
    expect(model.networkIn.label).toBe('114 B/s');
    expect(model.networkOut.percent).toBeUndefined();
    expect(model.networkOut.label).toBe('58 B/s');
    expect(model.networkIn.series).toEqual([114.64958693028868, 114.2]);
    expect(model.networkOut.series).toEqual([58.20477118722732, 58.1]);
  });

  it('accepts network_in / network_out as alternate series keys', () => {
    const model = normalizeMetrics({
      metrics: {
        network_in: [
          [1, 10],
          [2, 20],
        ],
        network_out: [
          [1, 5],
          [2, 15],
        ],
      },
    });
    expect(model.networkIn.series).toEqual([10, 20]);
    expect(model.networkOut.series).toEqual([5, 15]);
  });

  it('also finds a series directly at data.<key> (defensive)', () => {
    const model = normalizeMetrics({
      cpu: [
        [1, 0.5],
        [2, 0.6],
      ],
    });
    expect(model.cpu.series).toEqual([0.5, 0.6]);
    expect(model.cpu.percent).toBe(60);
  });

  it('ignores malformed entries inside an otherwise-valid series, keeping the last valid entry as current', () => {
    const model = normalizeMetrics({
      metrics: {
        cpu: [
          [1785582113, 0.001],
          'not-a-pair',
          [1785582143, 'nan-ish'],
          [NaN, 0.002],
          [1785582173, 0.003],
        ],
      },
    });
    expect(model.cpu.series).toEqual([0.001, 0.003]);
    expect(model.cpu.percent).toBeCloseTo(0.3, 10);
    expect(model.cpu.label).toBe('0.30%');
  });
});

describe('normalizeMetrics — real fixture regression', () => {
  it('normalizes docs/fixtures/service-metrics.json (the real captured shape) to unavailable:false with all four gauges populated', () => {
    const data = loadFixtureData('service-metrics.json');
    const model = normalizeMetrics(data);

    expect(model.unavailable).toBe(false);

    expect(model.cpu.percent).toBeDefined();
    expect(model.cpu.label).not.toBe('unavailable');
    expect(model.cpu.series?.length).toBeGreaterThan(1);

    expect(model.memory.label).not.toBe('unavailable');
    expect(model.memory.series?.length).toBeGreaterThan(1);

    expect(model.networkIn.label).not.toBe('unavailable');
    expect(model.networkIn.series?.length).toBeGreaterThan(1);

    expect(model.networkOut.label).not.toBe('unavailable');
    expect(model.networkOut.series?.length).toBeGreaterThan(1);
  });
});
