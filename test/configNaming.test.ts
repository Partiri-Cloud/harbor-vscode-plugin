import { describe, expect, it } from 'vitest';
import { slugifyServiceName, uniqueConfigFileName } from '../src/state/configNaming';

describe('slugifyServiceName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyServiceName('BugSink')).toBe('bugsink');
    expect(slugifyServiceName('Message In A Bottle')).toBe('message-in-a-bottle');
    expect(slugifyServiceName('api_v2')).toBe('api-v2');
  });

  it('trims leading and trailing separators', () => {
    expect(slugifyServiceName('  --Api--  ')).toBe('api');
  });

  it('returns undefined when nothing usable remains', () => {
    expect(slugifyServiceName(undefined)).toBeUndefined();
    expect(slugifyServiceName('')).toBeUndefined();
    expect(slugifyServiceName('***')).toBeUndefined();
  });
});

describe('uniqueConfigFileName', () => {
  it('names the file after the service', () => {
    expect(uniqueConfigFileName('BugSink', new Set())).toBe('bugsink.partiri.jsonc');
  });

  it('steps a counter when the name is taken', () => {
    expect(uniqueConfigFileName('api', new Set(['api.partiri.jsonc']))).toBe('api-2.partiri.jsonc');
    expect(uniqueConfigFileName('api', new Set(['api.partiri.jsonc', 'api-2.partiri.jsonc']))).toBe(
      'api-3.partiri.jsonc',
    );
  });

  it('ignores unrelated files in the folder', () => {
    expect(uniqueConfigFileName('api', new Set(['README.md', 'web.partiri.jsonc']))).toBe(
      'api.partiri.jsonc',
    );
  });

  it('falls back to the bare config name when the service name yields no slug', () => {
    expect(uniqueConfigFileName(undefined, new Set())).toBe('.partiri.jsonc');
    expect(uniqueConfigFileName('***', new Set())).toBe('.partiri.jsonc');
  });

  it('does not collide with an existing bare config when it has no slug', () => {
    expect(uniqueConfigFileName(undefined, new Set(['.partiri.jsonc']))).toBe(
      'service.partiri.jsonc',
    );
  });
});
