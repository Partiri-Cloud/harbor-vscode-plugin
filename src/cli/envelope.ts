/**
 * Types and parsing for the CLI's JSON envelope (docs/cli-contract.md §4).
 * Every document carries schema_version "1"; anything else is rejected
 * rather than interpreted, since a different schema_version means this
 * shell's assumptions about the shape no longer hold.
 */

import { isRecord } from '../util/records';

export interface CliErrorPayload {
  code: string;
  message: string;
  hint?: string;
  likely_causes?: string[];
  suggested_commands?: string[];
}

export interface CliSuccessEnvelope<T = unknown> {
  schema_version: '1';
  ok?: true;
  message?: string;
  /**
   * Absent on mutation acknowledgements: `service pull` answers with
   * `{schema_version, ok, message}` and no payload at all. Read commands carry
   * it. Callers that genuinely need a payload should use requireData().
   */
  data?: T;
}

export interface CliErrorEnvelope {
  schema_version: '1';
  ok: false;
  error: CliErrorPayload;
}

export type CliEnvelope<T = unknown> = CliSuccessEnvelope<T> | CliErrorEnvelope;

export function isCliErrorEnvelope<T>(envelope: CliEnvelope<T>): envelope is CliErrorEnvelope {
  return envelope.ok === false;
}

function isValidErrorPayload(value: unknown): value is CliErrorPayload {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

/**
 * Parse raw CLI stdout/stderr text into a CliEnvelope, or throw an
 * EnvelopeParseError. Only validates the envelope shell (schema_version,
 * ok/error/data presence) — callers are responsible for the shape of `data`.
 */
export function parseEnvelope<T = unknown>(raw: string): CliEnvelope<T> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new EnvelopeParseError('CLI output was not valid JSON.', raw);
  }

  if (!isRecord(value)) {
    throw new EnvelopeParseError('CLI output was not a JSON object.', raw);
  }
  if (value.schema_version !== '1') {
    throw new EnvelopeParseError(
      `Unsupported schema_version '${String(value.schema_version)}' in CLI output.`,
      raw,
    );
  }

  if (value.ok === false) {
    if (!isValidErrorPayload(value.error)) {
      throw new EnvelopeParseError('CLI error envelope was missing a valid error payload.', raw);
    }
    return value as unknown as CliErrorEnvelope;
  }

  // A success document must carry either a payload or an acknowledgement;
  // requiring `data` unconditionally rejects every mutation response.
  if (!('data' in value) && value.ok !== true && typeof value.message !== 'string') {
    throw new EnvelopeParseError('CLI success envelope had neither data nor an ack.', raw);
  }
  return value as unknown as CliSuccessEnvelope<T>;
}

/**
 * Payload of a success envelope, for callers that cannot proceed without one.
 * Fails loudly with the raw document rather than surfacing `undefined` deep in
 * a caller as a confusing property access.
 */
export function requireData<T>(envelope: CliEnvelope<T>, what: string): T {
  if (envelope.ok === false || envelope.data === undefined) {
    throw new EnvelopeParseError(`CLI returned no ${what}.`, JSON.stringify(envelope));
  }
  return envelope.data;
}

export class EnvelopeParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
    this.name = 'EnvelopeParseError';
  }
}
