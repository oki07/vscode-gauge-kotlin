const assert = require("node:assert/strict");
const test = require("node:test");

const PROVIDER_COMMANDS = new Set([
  "gauge.config.saveRecommended",
  "gauge.showReferences.atCursor",
]);

function createFakeVscode(overrides = {}) {
  const registeredCommands = [];
  const contexts = [];
  const languageConfigurations = [];
  const fakeVscode = {
    commands: {
      executeCommand(command, key, value) {
        contexts.push({ command, key, value });
        return undefined;
      },
      registerCommand(command, handler) {
        registeredCommands.push({ command, handler });
        return { dispose() {} };
      },
    },
    languages: {
      setLanguageConfiguration(language, configuration) {
        languageConfigurations.push({ language, configuration });
        return { dispose() {} };
      },
    },
    window: {
      activeTextEditor: overrides.activeTextEditor,
      showInformationMessage() {
        return undefined;
      },
    },
    workspace: {
      workspaceFolders: overrides.workspaceFolders,
    },
  };
  return {
    contexts,
    fakeVscode,
    languageConfigurations,
    registeredCommands,
  };
}

test("activation registers core contributed Gauge commands", () => {
  const manifest = require("../package.json");
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode();

  extension.activate(context, fakeVscode);

  assert.deepEqual(
    registeredCommands.map((entry) => entry.command),
    manifest.contributes.commands
      .map((entry) => entry.command)
      .filter((command) => !PROVIDER_COMMANDS.has(command)),
  );
  assert.equal(
    context.subscriptions.length,
    manifest.contributes.commands.length - PROVIDER_COMMANDS.size,
  );
  assert.equal(registeredCommands.every((entry) => typeof entry.handler === "function"), true);
});

test("create specification command delegates to the specification creator", () => {
  const extension = require("../src/extension");

  let receivedOptions;
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode();

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
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode();

  extension.activate(context, fakeVscode, {
    createExecutionController(options) {
      assert.equal(options.vscode, fakeVscode);
      return {
        handleCommand(command, ...args) {
          handledCommands.push({ command, args });
          return "executed";
        },
      };
    },
  });

  const command = registeredCommands.find(
    (entry) => entry.command === "gauge.specexplorer.debugNode",
  );
  const node = {
    file: "/workspace/specs/example.spec",
    executionIdentifier: "/workspace/specs/example.spec:9",
  };

  assert.ok(command);
  assert.equal(command.handler(node), "executed");
  assert.deepEqual(handledCommands, [
    {
      command: "gauge.specexplorer.debugNode",
      args: [node],
    },
  ]);
});

test("activation starts Gauge workspace services for Gauge projects", () => {
  const extension = require("../src/extension");

  const created = {};
  const checkedProjects = [];
  const versions = [];
  const context = { subscriptions: [] };
  const { contexts, fakeVscode, languageConfigurations, registeredCommands } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    isGaugeVersionGreaterOrEqual(version) {
      versions.push(version);
      return true;
    },
  };

  class FakeGaugeClients extends Map {
    constructor() {
      super();
      created.clientsMap = this;
    }
  }

  class FakeGaugeWorkspace {
    constructor(options) {
      this.options = options;
      created.workspace = this;
    }

    dispose() {}
  }

  class FakeReferenceProvider {
    constructor(clients, options) {
      this.clients = clients;
      this.options = options;
      created.referenceProvider = this;
    }

    dispose() {}
  }

  class FakeConfigProvider {
    constructor(receivedContext, options) {
      this.context = receivedContext;
      this.options = options;
      created.configProvider = this;
    }

    dispose() {}
  }

  class FakeGaugeState {
    constructor(receivedContext) {
      this.context = receivedContext;
      created.state = this;
    }
  }

  extension.activate(context, fakeVscode, {
    createCli(options) {
      created.cliOptions = options;
      return cli;
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    GaugeClients: FakeGaugeClients,
    GaugeState: FakeGaugeState,
    GaugeWorkspace: FakeGaugeWorkspace,
    ConfigProvider: FakeConfigProvider,
    ReferenceProvider: FakeReferenceProvider,
    projectFactory: {
      isGaugeProject(folder) {
        checkedProjects.push(folder);
        return true;
      },
    },
  });

  assert.deepEqual(checkedProjects, ["/workspace/gauge"]);
  assert.equal(created.cliOptions.vscode, fakeVscode);
  assert.deepEqual(versions, ["0.9.6"]);
  assert.equal(created.workspace.options.cli, cli);
  assert.equal(created.workspace.options.clientsMap, created.clientsMap);
  assert.equal(created.workspace.options.state, created.state);
  assert.equal(created.state.context, context);
  assert.equal(created.workspace.options.vscode, fakeVscode);
  assert.equal(created.referenceProvider.clients, created.clientsMap);
  assert.equal(created.referenceProvider.options.vscode, fakeVscode);
  assert.equal(created.configProvider.context, context);
  assert.equal(created.configProvider.options.vscode, fakeVscode);
  assert.equal(context.subscriptions.includes(created.workspace), true);
  assert.equal(context.subscriptions.includes(created.referenceProvider), true);
  assert.equal(context.subscriptions.includes(created.configProvider), true);
  assert.deepEqual(contexts, [
    { command: "setContext", key: "gauge:activated", value: true },
  ]);
  assert.deepEqual(
    languageConfigurations.map((entry) => entry.language),
    ["gauge"],
  );
  assert.equal(registeredCommands.some((entry) => entry.command === "gauge.showReferences.atCursor"), false);
});
