import { describe, expect, it } from 'vitest';
import { normalizeLogs } from '../src/logs/normalize';

describe('normalizeLogs', () => {
  it('tolerates a bare string[] with no timestamp or stream', () => {
    const model = normalizeLogs(['hello', 'world']);
    expect(model.unavailable).toBe(false);
    expect(model.lines).toEqual([{ raw: 'hello' }, { raw: 'world' }]);
  });

  it('tolerates { lines: string[] }', () => {
    const model = normalizeLogs({ lines: ['hello', 'world'] });
    expect(model.unavailable).toBe(false);
    expect(model.lines).toEqual([{ raw: 'hello' }, { raw: 'world' }]);
  });

  it.each(['message', 'line', 'text', 'log'] as const)(
    'tolerates { lines: [{ %s, timestamp, stream }] }',
    (key) => {
      const model = normalizeLogs({
        lines: [{ [key]: 'server listening on :8080', timestamp: '12:04:11', stream: 'stdout' }],
      });
      expect(model.unavailable).toBe(false);
      expect(model.lines).toEqual([
        { raw: 'server listening on :8080', timestamp: '12:04:11', stream: 'stdout' },
      ]);
    },
  );

  it('tolerates { logs: [...] } with the same shapes as lines', () => {
    const bareStrings = normalizeLogs({ logs: ['hello'] });
    expect(bareStrings.lines).toEqual([{ raw: 'hello' }]);

    const objects = normalizeLogs({ logs: [{ message: 'hello', stream: 'stderr' }] });
    expect(objects.lines).toEqual([{ raw: 'hello', stream: 'stderr' }]);
  });

  it('splits a newline-delimited string and drops a trailing empty line', () => {
    const withTrailingNewline = normalizeLogs('a\nb\n');
    expect(withTrailingNewline.unavailable).toBe(false);
    expect(withTrailingNewline.lines).toEqual([{ raw: 'a' }, { raw: 'b' }]);

    const withoutTrailingNewline = normalizeLogs('a\nb');
    expect(withoutTrailingNewline.lines).toEqual([{ raw: 'a' }, { raw: 'b' }]);
  });

  it.each([[[]], [{ lines: [] }], [{ logs: [] }], ['']])(
    'treats an empty but recognized payload %j as available with no lines',
    (input) => {
      const model = normalizeLogs(input);
      expect(model.unavailable).toBe(false);
      expect(model.lines).toEqual([]);
    },
  );

  it.each([[{ foo: 'bar' }], [42], [null], [true]])(
    'marks an unrecognized payload %j as unavailable',
    (input) => {
      const model = normalizeLogs(input);
      expect(model.unavailable).toBe(true);
      expect(model.lines).toEqual([]);
    },
  );
});
