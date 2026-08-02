# Security Policy

## Supported versions

Only the latest release line (`0.1.x`) receives security fixes. Older tags are
not actively maintained. Please upgrade to the latest release from the Visual
Studio Marketplace and confirm the issue still reproduces before reporting.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, email **support@partiri.cloud** with:

- a description of the vulnerability and its impact,
- steps to reproduce it (or a proof of concept),
- the extension version, VS Code version, operating system, and `partiri` CLI
  version (`partiri --version`).

You will receive an acknowledgement within a few business days. We will work
with you to understand and resolve the issue, and will credit you in the release
notes unless you prefer to remain anonymous. We practice coordinated disclosure —
please allow us reasonable time to ship a fix before publishing details publicly.

## Scope

This policy covers the VS Code extension in this repository.

The extension is a thin shell over the `partiri` CLI: it does not talk to
`api.partiri.cloud` directly, and it does not implement the config schema or its
validation rules. Vulnerabilities in the CLI itself belong to
[harbor-cli](https://github.com/Partiri-Cloud/harbor-cli); vulnerabilities in the
hosted platform or API may be reported to the same address as above.

When investigating, please avoid:

- accessing or modifying data that is not yours,
- degrading the availability of the service for others,
- disclosing the issue publicly before it has been resolved.

## Security model

The following are deliberate design properties, documented so reviewers know
what is intended behaviour rather than an oversight.

- **Webviews cannot execute code.** The Details, Monitoring, and Logs panels are
  rendered as static HTML with `enableScripts: false` and a
  `default-src 'none'; style-src 'unsafe-inline'` CSP. They cannot run scripts
  or reach the network, which is also what mechanically guarantees the
  no-telemetry property below. All interpolated values pass through an HTML
  escaper.

- **`command:` links are allowlisted.** The Details panel is the only webview
  with `enableCommandUris` enabled, and it is set to an explicit three-command
  allowlist (`partiri.deploy`, `partiri.pause`, `partiri.unpause`) rather than
  `true`. A panel cannot invoke arbitrary VS Code commands.

- **Secrets are never passed as argv.** API keys and workspace secrets are piped
  to the CLI over stdin (`--key-stdin`, `--secret-stdin`), so they do not appear
  in the process table or in shell history. Environment-variable values are
  never sent as command-line arguments.

- **`auth login` is never spawned as a subprocess.** It runs in the integrated
  terminal so the browser flow stays under the user's control; the extension
  then polls `llm whoami` until the key is configured.

- **Temporary env files are private.** `Edit Env` writes to the extension's
  global storage directory with mode `0600`, outside the workspace, and the file
  is removed after a successful apply.

- **Destructive operations require a native dialog.** `-y` is appended only
  after the user confirms in a modal VS Code dialog, never pre-emptively. The
  CLI always runs with `--no-input`, so it can never block on a hidden prompt.

- **Suggested commands are never auto-executed.** When the CLI returns
  `suggested_commands` in an error envelope, they are offered as a "Run in
  terminal" button that types the command into a terminal for the user to
  review. Nothing is executed on the user's behalf.

- **No telemetry.** The extension collects no usage data, analytics, or crash
  reports, and opens no network connections of its own. Every outbound call is
  made by the `partiri` CLI.

- **Bundled dependencies.** The published extension bundles eight third-party
  packages, all MIT- or ISC-licensed; see
  [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
