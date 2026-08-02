import { describe, expect, it } from 'vitest';
import { firstString, isRecord, readString, stringAt, unwrapArray } from '../src/util/records';

describe('isRecord', () => {
  it('accepts plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  // Callers use this to decide "can I index into this by key"; an array
  // answers no. src/state/linkedServices.ts deliberately keeps its own
  // array-admitting predicate for exactly this reason.
  it('rejects arrays, null, and primitives', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([{ a: 1 }])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord('str')).toBe(false);
    expect(isRecord(42)).toBe(false);
  });
});

describe('firstString vs readString', () => {
  // The distinction that justifies having both: a blank log line is real
  // content, a blank job status is a missing field.
  it('firstString accepts the empty string, readString does not', () => {
    expect(firstString('')).toBe('');
    expect(readString('')).toBeUndefined();
    expect(readString('   ')).toBeUndefined();
  });

  it('firstString returns the first string in argument order, skipping non-strings', () => {
    expect(firstString(undefined, null, 42, 'found', 'later')).toBe('found');
    expect(firstString(undefined, null, 42)).toBeUndefined();
  });

  it('readString passes through content, including surrounding whitespace', () => {
    expect(readString(' padded ')).toBe(' padded ');
    expect(readString(42)).toBeUndefined();
  });
});

describe('stringAt', () => {
  it('returns the first key holding a non-blank string', () => {
    expect(stringAt({ a: '', b: '  ', c: 'yes' }, ['a', 'b', 'c'])).toBe('yes');
  });

  it('respects key order, not object order', () => {
    expect(stringAt({ a: 'first', b: 'second' }, ['b', 'a'])).toBe('second');
  });

  it('returns undefined when no key matches', () => {
    expect(stringAt({ a: 1, b: null }, ['a', 'b', 'missing'])).toBeUndefined();
  });
});

describe('unwrapArray', () => {
  it('returns a bare array unchanged', () => {
    expect(unwrapArray([1, 2], 'jobs')).toEqual([1, 2]);
  });

  it('unwraps the first matching key', () => {
    expect(unwrapArray({ logs: ['b'], lines: ['a'] }, 'lines', 'logs')).toEqual(['a']);
    expect(unwrapArray({ logs: ['b'] }, 'lines', 'logs')).toEqual(['b']);
  });

  // Distinct from an empty array: callers render "unrecognised payload"
  // for undefined but "no items" for [].
  it('returns undefined for shapes it does not recognise', () => {
    expect(unwrapArray({ jobs: 'not-an-array' }, 'jobs')).toBeUndefined();
    expect(unwrapArray({ other: [] }, 'jobs')).toBeUndefined();
    expect(unwrapArray('string', 'jobs')).toBeUndefined();
    expect(unwrapArray(null, 'jobs')).toBeUndefined();
  });

  it('distinguishes an empty wrapped array from a missing one', () => {
    expect(unwrapArray({ jobs: [] }, 'jobs')).toEqual([]);
    expect(unwrapArray({}, 'jobs')).toBeUndefined();
  });
});
