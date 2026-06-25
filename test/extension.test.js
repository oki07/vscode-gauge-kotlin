const assert = require("node:assert/strict");
const test = require("node:test");

test("activation registers every contributed Gauge command", () => {
  const manifest = require("../package.json");
  const extension = require("../src/extension");

  const registeredCommands = [];
  const context = { subscriptions: [] };
  const fakeVscode = {
    commands: {
      executeCommand() {
        return undefined;
      },
      registerCommand(command, handler) {
        registeredCommands.push({ command, handler });
        return { dispose() {} };
      },
    },
    window: {
      showInformationMessage() {
        return undefined;
      },
    },
  };

  extension.activate(context, fakeVscode);

  assert.deepEqual(
    registeredCommands.map((entry) => entry.command),
    manifest.contributes.commands.map((entry) => entry.command),
  );
  assert.equal(context.subscriptions.length, manifest.contributes.commands.length);
  assert.equal(registeredCommands.every((entry) => typeof entry.handler === "function"), true);
});
