# Contributing to the Partiri Cloud VS Code extension

Thanks for your interest in improving the extension. This guide covers how to
build, test, and submit changes.

## Licensing

This extension is proprietary — the source is public for transparency, but no
license to it is granted. See [LICENSE](LICENSE). Contributions are accepted on
the understanding that copyright in them is assigned to Partiri Cloud. If that
doesn't work for you, please open an issue to discuss before writing code.

## Prerequisites

- **Node.js 18 or newer** (the bundle targets `node18`).
- **VS Code 1.85 or newer.**
- The **`partiri` CLI**, version 0.3.0 or newer, on your `PATH` or configured via
  the `partiri.binaryPath` setting. The extension does nothing without it.

```bash
npm install
```

## Building

```bash
npm run build   # esbuild → dist/extension.js
npm run watch   # the same, rebuilding on change
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with the
extension loaded. Run **Developer: Reload Window** in that host to pick up a
rebuild.

## Testing

```bash
npm test          # vitest — the unit suite
npm run test:e2e  # downloads a VS Code build and drives a real extension host
```

`npm run test:e2e` is kept out of `npm test` because it downloads VS Code on
first run. It builds automatically beforehand.

Most tests are plain unit tests over hand-built envelopes plus the `vscode`
module fake in `test/mocks/`. Pure logic is deliberately kept free of any
`vscode` import — see `src/util/`, `src/commands/wizardLogic.ts`, and the
`normalize.ts` modules — so it unit-tests without a mock. Mirror that split for
new code: put the decision in a pure module and keep the VS Code plumbing thin.

Please add or update tests for any behaviour you change.

> **Known issue.** A few tests read fixtures from `../../docs/fixtures/` and
> spawn `../../tools/fake-partiri/`, which resolved into the
> [harbor-code-plugin](https://github.com/Partiri-Cloud/harbor-code-plugin)
> monorepo before this extension moved to its own repository. Until that is
> resolved, those tests need a sibling checkout of the monorepo.

## Formatting and linting

All three are expected to pass before a pull request is merged:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier --check
```

Style is enforced mechanically — single quotes, trailing commas, and the rest
live in `.prettierrc.json` and `eslint.config.mjs`. Don't hand-format.

## Commit messages

- Short, imperative descriptions ("Add worker deploy type", not "Added…").
- No conventional-commits prefix (`feat:`, `fix:`, …).
- One logical change per commit where practical.

## Pull requests

1. Fork the repository and create a feature branch.
2. Make your change with accompanying tests.
3. Ensure `npm test`, `npm run typecheck`, `npm run lint`, and
   `npm run format` all pass.
4. Add a `## [Unreleased]` entry to [CHANGELOG.md](CHANGELOG.md) for anything
   user-visible.
5. Open a PR describing **what** changed and **why**.

## Project layout

| Path               | Purpose                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `src/extension.ts` | `activate`/`deactivate` — wiring only, no policy                    |
| `src/activation/`  | Binary lifecycle and the selected-service policy                    |
| `src/cli/`         | Binary discovery, invocation, JSON envelope, typed errors, confirms |
| `src/data/`        | Read-only service data access, below the command layer              |
| `src/commands/`    | One module per command group, plus command registration             |
| `src/views/`       | Tree and webview providers                                          |
| `src/state/`       | Config index, selection, `llm context` cache, JSONC parsing         |
| `src/lsp/`         | Language client for `partiri lsp`                                   |
| `src/util/`        | Pure helpers — payload readers, timestamps, polling                 |
| `src/webview/`     | Shared HTML shell, CSP, escaping                                    |
| `test/mocks/`      | The `vscode` module fake used by the unit suite                     |

Two conventions worth knowing before you move code around:

- **`views/` must not import from `commands/`.** Panels get their data from
  `src/data/serviceData.ts`. A command module doubling as a data layer is the
  inversion that split was created to fix.
- **`src/util/` is for helpers with two or more real consumers**, not a junk
  drawer for anything that looks generic.

## Adding a command

1. Implement it in the relevant `src/commands/` module.
2. Register it in `src/commands/register.ts`.
3. Declare it in `contributes.commands` in `package.json`, with a menu entry in
   `contributes.menus` if it should appear on a tree row or in a title bar.

`test/registerCommands.test.ts` asserts that every command declared in
`package.json` is actually registered, so a missed step fails the suite rather
than throwing "command not found" at a user.

## Reporting security issues

Please do **not** open public issues for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for the disclosure process.
