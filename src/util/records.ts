/**
 * Tolerant readers for CLI payloads whose exact shape is not guaranteed.
 *
 * Every normalizer in this extension parses JSON it did not define and must
 * degrade per-field rather than throw, so they all grew the same handful of
 * guards independently. These are those guards, deduplicated.
 *
 * Deliberately free of any `vscode` import so it unit-tests without a mock,
 * following the src/commands/wizardLogic.ts / src/lsp/features.ts precedent.
 */

/**
 * A plain object — arrays are excluded, because every caller uses this to
 * decide "is this a keyed record I can index into" and an array answers no.
 *
 * Note `state/linkedServices.ts` deliberately does NOT use this: it accepts
 * array-rooted config files, and tightening it there would drop them from the
 * Local Configs tree.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * First value that is a string, in argument order. Accepts `''` — used where
 * an empty string is a legitimate payload value (a blank log line).
 */
export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

/**
 * A string with actual content. Distinct from `firstString`: this rejects `''`
 * and whitespace, for fields where blank means absent rather than empty.
 */
export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * First key whose value is a non-blank string. The keyed counterpart of
 * `readString`, for probing several tolerated spellings of one field.
 */
export function stringAt(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const found = readString(source[key]);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * The CLI returns list payloads either bare or wrapped under a key that varies
 * by subcommand. Returns the array under whichever of `keys` matches first, or
 * `undefined` when the payload is neither — which callers treat as
 * "unrecognised", distinct from an empty list.
 */
export function unwrapArray(data: unknown, ...keys: string[]): unknown[] | undefined {
  if (Array.isArray(data)) {
    return data;
  }
  if (!isRecord(data)) {
    return undefined;
  }
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return undefined;
}
