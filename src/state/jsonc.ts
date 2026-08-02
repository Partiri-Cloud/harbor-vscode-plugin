/**
 * Minimal JSONC -> JSON normalizer: strips `//` and `/* *\/` comments and
 * trailing commas, respecting string literals so comment-like sequences
 * inside strings are left untouched. Good enough to read the `id` field out
 * of a `.partiri.jsonc` for linked-service detection; not a full parser.
 */
function stripJsonComments(source: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let stringQuote = '';

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (inString) {
      result += char;
      if (char === '\\') {
        result += next ?? '';
        i += 2;
        continue;
      }
      if (char === stringQuote) {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      result += char;
      i += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        i += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        i += 1;
      }
      i += 2;
      continue;
    }

    result += char;
    i += 1;
  }

  return result.replace(/,(\s*[}\]])/g, '$1');
}

export function parseJsonc(source: string): unknown {
  return JSON.parse(stripJsonComments(source));
}
