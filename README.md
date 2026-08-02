# Partiri Cloud for VS Code

Deploy and manage services on [Partiri Cloud](https://partiri.cloud) without
leaving VS Code. This extension is a thin shell over the `partiri` CLI: it
translates tree views, webview panels, commands, and a wizard into `partiri`
invocations, and speaks LSP to `partiri lsp` for `.partiri.jsonc`
diagnostics, completion, and hover. It does not talk to `api.partiri.cloud`
directly and does not duplicate the CLI's config schema or validation rules
— see [`../docs/cli-contract.md`](../docs/cli-contract.md) and
[`../docs/lsp.md`](../docs/lsp.md) for the normative behavior this extension
implements.

## Features

The "Partiri" activity bar container organizes everything around picking one
service and acting on it: select a service in Local Configs or Resources and
Details, Monitoring, Recent Jobs, and Logs below follow that selection. Every
section has its own refresh button in its title bar, scoped to that section
alone — refreshing Logs, for example, does not drag along a full `llm
context` re-fetch.

- **Local Configs** (tree) — every `.partiri.jsonc` and `name.partiri.jsonc`
  file found in the workspace, including configs that have no service id yet
  (a wizard-written config has none until its first deploy — shown as "not
  created"). Discovery combines `vscode.workspace.findFiles` with a bounded
  direct filesystem scan (depth 4, skipping `node_modules` and similar),
  because `findFiles` honors `.gitignore` and ignoring `.partiri.jsonc` is
  common enough that relying on it alone would miss real configs. Past 3
  configs, rows group into collapsible folders, with a chain of single-child
  folders compacted into one row rather than one row per path segment. Rows
  that have already claimed a service id get an inline "Pull This Config"
  button that refreshes that exact file (warning first if it has unsaved
  editor changes). Title-bar buttons: New Service, Pull Existing Service. A
  welcome view with both buttons is shown when the workspace has no config
  yet. The selected service is remembered per workspace and restored on
  reload; opening a different `*.partiri.jsonc` switches to it, opening any
  other file leaves the selection alone, and the config file does not need
  to stay open for the panels below to keep working.
- **Details** (webview) — identity and actions for the selected
  service: name, deploy type/runtime subtitle, action buttons, then a fact
  grid (Region, Pod, Project, Workspace, ID, and Internal/External/Custom
  URLs) where every row renders only when populated — Pod shows the pod name
  only, since CPU/RAM belong in Monitoring, not here. Deploy is always
  offered; Pause and Unpause appear only once the selected service has an
  id. Buttons are plain `command:` links under an `enableCommandUris`
  allowlist of exactly those three commands — the panel runs with
  `enableScripts: false`, so no JavaScript is involved. Each button carries
  an icon and a tooltip stating its consequence, and a note reminds you that
  every action still asks for confirmation first.
- **Monitoring** (webview) — a gauge for the latest sample plus an
  inline-SVG sparkline of the full history, for CPU, memory, and network,
  sourced from `service metrics`'s time series
  (`data.metrics.{cpu,memory,network_download,network_upload}`, each a list
  of `[unixTimestamp, value]` pairs 30 seconds apart, covering roughly the
  last hour). CPU is the only metric with a percentage bar, since it's the
  only one reported as a fraction of its allocation; memory and network carry
  no limit in the payload, so there is no denominator to draw a bar against,
  and they show their latest value and trend line instead. Network download
  and upload share a single chart
  with two differently colored lines on a shared scale, so they can be read
  against each other. Refreshes on selection change and every 30s while
  visible, giving up after 3 consecutive failures.
- **Recent Jobs** (tree) — deploy history for the selected service via
  `service jobs`, each row showing its type and status with a status icon.
- **Logs** (webview) — the last 35 log lines from the past hour for the
  selected service, monospace, with stderr lines tinted.
- **Resources** (tree, collapsed by default) — Workspaces → Projects →
  Services, populated from `partiri llm context`. Selecting a service makes
  it active the same way a Local Configs row does. Declared `visibility:
collapsed` in `package.json`, so it stays tucked away until you expand it.
- **Commands** — deploy, push, pull, pause/unpause, kill, logs (one-shot and
  watch), metrics, jobs, validate (local and `--remote`), env edit/apply/save,
  link, token, project/secret creation, and the per-row "Pull This Config".
  Volume management (`storage detach`, `storage delete`) has no UI in this
  extension — run those through the CLI directly in a terminal.
- **"New Service" wizard** — workspace → project (or create one) → service
  name → deploy type → source → region → pod, auto-detecting the runtime from
  workspace files and prefilling the repo URL from `git remote`. Writes a
  `.partiri.jsonc` from `partiri llm template` and validates it.
- **"Pull Existing Service"** — picks a service from `partiri llm context`
  and writes its config into a workspace folder you choose, naming the file
  after the service (e.g. `bugsink.partiri.jsonc`), stepping to `-2`, `-3`
  on a filename collision.
- **LSP integration** — diagnostics, completion (including live UUIDs), and
  hover for `.partiri.jsonc`, provided entirely by `partiri lsp`.
- **Auth** — sign in via the integrated terminal (`partiri auth login`) with
  status polling, or a masked API key prompt as a headless fallback.
- **Destructive-op confirmations** — native modal dialogs before deploy,
  kill, pause, push, and env replace, matching the confirmation matrix in
  `docs/cli-contract.md` exactly.
- **Loading states** — Details, Monitoring, and Logs show a CSS-only spinner
  while their first fetch is in flight (these panels run with scripts
  disabled, so an animated border is the only way to show motion); the tree
  sections show a loading message alongside the native view spinner.
- The Details, Monitoring, and Logs webviews all run with scripts disabled
  under a `default-src 'none'` Content-Security-Policy, so none of them can
  execute code or make network requests.

The extension has its own icon (`assets/icon.png`), and the activity-bar
icon is the Partiri mark (`assets/activitybar.svg`).

This extension is proprietary (`"license": "UNLICENSED"` in
[`package.json`](./package.json)), unlike the rest of this public repository
— the [Zed shell](../zed/README.md) is Apache-2.0. That split is deliberate,
not an oversight.

## Requirements

- The [`partiri` CLI](https://github.com/partiri-cloud/harbor-cli), version
  **0.3.0 or newer** (the first release with `partiri lsp`). Install with
  `cargo install partiri-cli` or `npm i -g @partiri/cli` (no Windows builds
  for the npm package — use cargo on Windows).
- The extension looks for the binary in this order: the `partiri.binaryPath`
  setting, `PATH`, `~/.cargo/bin`, then the npm global bin directory. If none
  resolve, a non-blocking notification with install guidance is shown; the
  editor is never blocked.
- If the resolved CLI is older than 0.3.0, both the LSP integration and all
  action commands are disabled until you update.

## Settings

| Setting                    | Type                | Default    | Description                                                                                                                                                                                   |
| -------------------------- | ------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `partiri.binaryPath`       | `string`            | `""`       | Absolute path to the `partiri` binary. Overrides PATH / `~/.cargo/bin` / npm global bin discovery. An explicit, non-resolving path is surfaced as an error rather than silently falling back. |
| `partiri.apiUrl`           | `string`            | `""`       | Overrides the Partiri API URL, passed through as `PARTIRI_API_URL`. Leave empty to use the CLI's own default.                                                                                 |
| `partiri.timeoutSeconds`   | `number`            | `60`       | Subprocess timeout for `partiri` CLI invocations.                                                                                                                                             |
| `partiri.remoteValidation` | `"off" \| "onSave"` | `"onSave"` | Controls the `partiri-remote` LSP diagnostic source (UUID existence/pairing, source reachability, balance warnings), throttled to once per 5 seconds.                                         |
| `partiri.lsp.enabled`      | `boolean`           | `true`     | Enable the `partiri lsp` language server for `.partiri.jsonc`.                                                                                                                                |

## No telemetry

This extension collects and transmits no telemetry, usage analytics, or
crash reports, ever — see `docs/cli-contract.md` §10.

## Development

```sh
npm install
npm run build       # esbuild -> dist/extension.js
npm run watch       # the same, rebuilding on change
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier --check
npm test            # vitest
npm run test:e2e    # downloads VS Code and drives a real extension host
```

Most tests are plain unit tests over hand-built envelopes plus the `vscode`
module fake in `test/mocks/`. The few that need a real subprocess spawn
`../tools/fake-partiri`, a fixture-replaying stand-in for the real CLI. Either
way the suite needs no network access and no API key.

`npm run test:e2e` is the exception: it downloads a VS Code build on first run,
so it is kept out of `npm test` and run on demand.
