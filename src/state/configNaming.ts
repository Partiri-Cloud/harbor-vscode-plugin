/**
 * Naming for configs the extension creates. Pure and vscode-free so it
 * unit-tests without a mock, following the src/commands/wizardLogic.ts
 * precedent.
 *
 * A pulled config is named after its service rather than the bare
 * `.partiri.jsonc`, because the tree labels a bare config with its containing
 * folder — pulling into a workspace root called `cloud` would show a service
 * named "cloud".
 */

const CONFIG_SUFFIX = '.partiri.jsonc';
const MAX_SUFFIX_ATTEMPTS = 500;

export function slugifyServiceName(name: string | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : undefined;
}

function nextFree(base: string, taken: ReadonlySet<string>): string {
  const first = `${base}${CONFIG_SUFFIX}`;
  if (!taken.has(first)) {
    return first;
  }
  for (let counter = 2; counter <= MAX_SUFFIX_ATTEMPTS; counter += 1) {
    const candidate = `${base}-${counter}${CONFIG_SUFFIX}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${MAX_SUFFIX_ATTEMPTS + 1}${CONFIG_SUFFIX}`;
}

/**
 * Filename to write a pulled service to, given the filenames already in the
 * target folder. Falls back to the conventional bare `.partiri.jsonc` only
 * when the service name yields no usable slug.
 */
export function uniqueConfigFileName(
  serviceName: string | undefined,
  taken: ReadonlySet<string>,
): string {
  const slug = slugifyServiceName(serviceName);
  if (slug === undefined) {
    return taken.has(CONFIG_SUFFIX) ? nextFree('service', taken) : CONFIG_SUFFIX;
  }
  return nextFree(slug, taken);
}
