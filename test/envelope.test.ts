import { describe, expect, it } from 'vitest';
import { EnvelopeParseError, isCliErrorEnvelope, parseEnvelope } from '../src/cli/envelope';
import { expectData, expectSuccess } from './testUtils';

describe('parseEnvelope', () => {
  it('parses a success envelope with data', () => {
    const envelope = parseEnvelope<{ id: string }>(
      JSON.stringify({
        schema_version: '1',
        ok: true,
        message: 'Deploy job created.',
        data: { id: 'svc-1' },
      }),
    );
    expect(expectData(envelope).id).toBe('svc-1');
    expect(isCliErrorEnvelope(envelope)).toBe(false);
  });

  it('parses a read-only success envelope without ok/message', () => {
    const envelope = parseEnvelope<{ id: string }[]>(
      JSON.stringify({ schema_version: '1', data: [{ id: 'svc-1' }] }),
    );
    expect(expectData(envelope)).toHaveLength(1);
  });

  it('parses an error envelope', () => {
    const envelope = parseEnvelope(
      JSON.stringify({
        schema_version: '1',
        ok: false,
        error: { code: '401', message: 'Unauthorized', hint: 'Sign in again.' },
      }),
    );
    expect(isCliErrorEnvelope(envelope)).toBe(true);
    if (isCliErrorEnvelope(envelope)) {
      expect(envelope.error.code).toBe('401');
    }
  });

  it('rejects a document with a different schema_version', () => {
    expect(() => parseEnvelope(JSON.stringify({ schema_version: '2', data: {} }))).toThrow(
      EnvelopeParseError,
    );
  });

  it('rejects invalid JSON', () => {
    expect(() => parseEnvelope('not json')).toThrow(EnvelopeParseError);
  });

  it('rejects an error envelope missing a valid error payload', () => {
    expect(() =>
      parseEnvelope(JSON.stringify({ schema_version: '1', ok: false, error: { code: '401' } })),
    ).toThrow(EnvelopeParseError);
  });

  it('accepts a mutation acknowledgement that carries no data', () => {
    // `service pull` really answers like this — requiring `data` here rejected
    // every mutation the CLI performs.
    const envelope = parseEnvelope(
      JSON.stringify({ schema_version: '1', ok: true, message: '/tmp/api.partiri.jsonc saved.' }),
    );
    expect(expectSuccess(envelope).message).toBe('/tmp/api.partiri.jsonc saved.');
    expect(expectSuccess(envelope).data).toBeUndefined();
  });

  it('accepts a bare ok:true with no message', () => {
    expect(() => parseEnvelope(JSON.stringify({ schema_version: '1', ok: true }))).not.toThrow();
  });

  it('rejects a success document that is neither data nor an acknowledgement', () => {
    expect(() => parseEnvelope(JSON.stringify({ schema_version: '1' }))).toThrow(
      EnvelopeParseError,
    );
  });
});
