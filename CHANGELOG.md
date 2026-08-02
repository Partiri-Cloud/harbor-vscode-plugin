# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-08-02

Initial release. A thin shell over the `partiri` CLI (0.3.0 or newer required):
the extension translates tree views, webview panels, commands, and a wizard into
`partiri` invocations, and speaks LSP to `partiri lsp` for `.partiri.jsonc`
diagnostics, completion, and hover. It does not talk to `api.partiri.cloud`
directly and does not duplicate the CLI's config schema or validation rules.

### Added

- **Partiri activity bar container** with six sections. Picking a service in
  Local Configs or Resources drives Details, Monitoring, Logs, and Recent Jobs
  below it. Each section has its own title-bar refresh, scoped to that section
  alone.

- **Local Configs** — every `.partiri.jsonc` and `name.partiri.jsonc` in the
  workspace, including wizard-written configs that have no service id yet.
  Discovery combines `workspace.findFiles` with a bounded filesystem scan, since
  `findFiles` honours `.gitignore` and ignoring `.partiri.jsonc` is common. Past
  three configs, rows group into collapsible folders. The selected service is
  remembered per workspace and restored on reload.

- **Details** — identity and actions for the selected service, rendered as a
  webview so actions can be real buttons via an allowlisted set of `command:`
  links.

- **Monitoring** — CPU, memory, and network gauges with inline SVG sparklines,
  polled every 30 seconds while visible.

- **Logs** — recent log lines, polled on the same cadence.

- **Recent Jobs** — deploy job history for the selected service.

- **Resources** — Workspaces → Projects → Services, from `llm context`.

- **New Service wizard** — workspace, project, name, deploy type, source, region,
  and pod, then `llm template` and a written `.partiri.jsonc`.

- **33 commands**, covering deploy, push, pull, pause, unpause, kill, logs, log
  watching, metrics, jobs, validate (local and remote), link, token, env
  editing, project creation, and registry/repository secret creation.

- **Language support** for `.partiri.jsonc` via `partiri lsp` — diagnostics,
  completion, and hover, with remote validation on save.

- **Five settings**: `partiri.binaryPath`, `partiri.apiUrl`,
  `partiri.timeoutSeconds`, `partiri.remoteValidation`, and
  `partiri.lsp.enabled`.

- **Guided CLI install** when no `partiri` binary is found, and a version gate
  that reports clearly when the installed CLI is older than 0.3.0.

### Security

- Webview panels run with `enableScripts: false` under a `default-src 'none'`
  CSP; the Details panel's `command:` links are restricted to an explicit
  three-command allowlist.
- API keys and workspace secrets are piped over stdin, never passed as
  command-line arguments.
- Destructive operations require a native confirmation dialog before `-y` is
  appended; the CLI always runs with `--no-input`.
- No telemetry, analytics, or crash reporting. See [SECURITY.md](SECURITY.md).
