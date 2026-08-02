import { isCliErrorEnvelope, type CliEnvelope, type CliSuccessEnvelope } from '../src/cli/envelope';

/** Narrows a CliEnvelope to its success variant in tests, failing loudly if it was an error. */
export function expectSuccess<T>(envelope: CliEnvelope<T>): CliSuccessEnvelope<T> {
  if (isCliErrorEnvelope(envelope)) {
    throw new Error(`expected a success envelope, got error: ${envelope.error.message}`);
  }
  return envelope;
}

/**
 * Success variant plus its payload. `data` is optional on the type because
 * mutation acknowledgements carry none, so tests that assert on a payload say
 * so explicitly instead of scattering non-null assertions.
 */
export function expectData<T>(envelope: CliEnvelope<T>): T {
  const success = expectSuccess(envelope);
  if (success.data === undefined) {
    throw new Error('expected a success envelope carrying data, got an acknowledgement');
  }
  return success.data;
}
