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

test("create specification command delegates to the specification creator", () => {
  const extension = require("../src/extension");

  let receivedOptions;
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

  extension.activate(context, fakeVscode, {
    createSpecification(options) {
      receivedOptions = options;
      return "created";
    },
  });

  const command = registeredCommands.find(
    (entry) => entry.command === "gauge.create.specification",
  );

  assert.ok(command);
  assert.equal(command.handler(), "created");
  assert.equal(receivedOptions.vscode, fakeVscode);
});

test("execution commands delegate to the Gauge execution controller", () => {
  const extension = require("../src/extension");

  const handledCommands = [];
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

  extension.activate(context, fakeVscode, {
    createExecutionController(options) {
      assert.equal(options.vscode, fakeVscode);
      return {
        handleCommand(command) {
          handledCommands.push(command);
          return "executed";
        },
      };
    },
  });

  const command = registeredCommands.find(
    (entry) => entry.command === "gauge.execute.failed",
  );

  assert.ok(command);
  assert.equal(command.handler(), "executed");
  assert.deepEqual(handledCommands, ["gauge.execute.failed"]);
});
