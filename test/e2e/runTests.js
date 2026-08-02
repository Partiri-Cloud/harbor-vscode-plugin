// Optional @vscode/test-electron smoke test (deliverable item 16). Downloads
// a real VS Code build and launches the Extension Development Host with
// this extension loaded. Skipped gracefully (non-zero exit with a clear
// message, not a crash) when the download/launch isn't possible in the
// current environment (no network, no display, sandboxed CI, etc).
const path = require('node:path');

async function main() {
  const { runTests } = require('@vscode/test-electron');

  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ['--disable-extensions', '--disable-gpu'],
  });
}

main().catch((error) => {
  console.error('[e2e] Skipping @vscode/test-electron smoke test:', error?.message ?? error);
  process.exit(1);
});
