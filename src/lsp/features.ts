/**
 * Language-client feature predicates. Kept free of any `vscode` and
 * `vscode-languageclient` import so it can run under a plain unit test —
 * src/lsp/client.ts is the thin client wiring built on top of this module.
 */

const EXECUTE_COMMAND_METHOD = 'workspace/executeCommand';

/**
 * True for the stock ExecuteCommandFeature, identified by its registration
 * method rather than by class identity so it survives library internals
 * changing shape.
 */
export function isExecuteCommandFeature(feature: unknown): boolean {
  const registrationType = (feature as { registrationType?: { method?: unknown } } | null)
    ?.registrationType;
  return registrationType?.method === EXECUTE_COMMAND_METHOD;
}
