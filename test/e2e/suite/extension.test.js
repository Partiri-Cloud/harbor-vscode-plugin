const assert = require('node:assert');
const vscode = require('vscode');

suite('Partiri extension smoke test', () => {
  test('activates and registers its commands', async () => {
    const extension = vscode.extensions.getExtension('partiri-cloud.partiri');
    assert.ok(extension, 'extension should be discoverable by id');

    await extension.activate();
    assert.strictEqual(extension.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('partiri.deploy'), 'partiri.deploy should be registered');
    assert.ok(commands.includes('partiri.initWizard'), 'partiri.initWizard should be registered');
  });
});
