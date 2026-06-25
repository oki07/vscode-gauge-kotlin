const assert = require("node:assert/strict");
const test = require("node:test");

const PROVIDER_COMMANDS = new Set([
  "gauge.createProject",
  "gauge.config.saveRecommended",
  "gauge.showReferences.atCursor",
  "gauge.specexplorer.debugNode",
  "gauge.specexplorer.runAllActiveProjectSpecs",
  "gauge.specexplorer.runNode",
  "gauge.specexplorer.switchProject",
]);

function createFakeVscode(overrides = {}) {
  const registeredCommands = [];
  const contexts = [];
  const debugProviders = [];
  const editorUpdates = [];
  const languageConfigurations = [];
  const configurationListeners = [];
  const semanticTokenProviders = [];
  const semanticTokenColors = {
    argument: "#ae81ff",
    stepMarker: "#ffffff",
    step: "#a6e22e",
    table: "#ae81ff",
    tableHeaderSeparator: "#8349f0",
    tableBorder: "#8349f0",
    tableKeyword: "#ffffff",
    tableFileValue: "#dddddd",
    tagKeyword: "#ff4689",
    tagValue: "#fc88b2",
    specification: "#66d9ef",
    scenario: "#66d9ef",
    comment: "#cccccc",
    disabledStep: "#228549",
    ...overrides.semanticTokenColors,
  };
  const fakeVscode = {
    ConfigurationTarget: {
      Global: "global",
      Workspace: "workspace",
    },
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
    debug: {
      registerDebugConfigurationProvider(type, provider) {
        const disposable = { dispose() {} };
        debugProviders.push({ type, provider, disposable });
        return disposable;
      },
    },
    languages: {
      registerDocumentSemanticTokensProvider(selector, provider, legend) {
        const disposable = { dispose() {} };
        semanticTokenProviders.push({
          selector,
          provider,
          legend,
          disposable,
        });
        return disposable;
      },
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
      getConfiguration(section) {
        if (section === "gauge.semanticTokenColors") {
          return {
            get(key) {
              return semanticTokenColors[key];
            },
          };
        }
        if (section === "editor") {
          return {
            update(key, value, target) {
              editorUpdates.push({ key, value, target });
              return Promise.resolve(undefined);
            },
          };
        }
        return {
          get() {
            return undefined;
          },
          update() {
            return Promise.resolve(undefined);
          },
        };
      },
      onDidChangeConfiguration(listener) {
        const disposable = { dispose() {} };
        configurationListeners.push({ listener, disposable });
        return disposable;
      },
      workspaceFolders: overrides.workspaceFolders,
    },
  };
  return {
    configurationListeners,
    contexts,
    debugProviders,
    editorUpdates,
    fakeVscode,
    languageConfigurations,
    registeredCommands,
    semanticTokenProviders,
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
    [
      "gauge.createProject",
      ...manifest.contributes.commands
        .map((entry) => entry.command)
        .filter((command) => !PROVIDER_COMMANDS.has(command)),
    ],
  );
  assert.equal(
    context.subscriptions.length,
    manifest.contributes.commands.length - PROVIDER_COMMANDS.size + 1,
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
    (entry) => entry.command === "gauge.execute.specification",
  );
  const node = {
    file: "/workspace/specs/example.spec",
    executionIdentifier: "/workspace/specs/example.spec:9",
  };

  assert.ok(command);
  assert.equal(command.handler(node), "executed");
  assert.deepEqual(handledCommands, [
    {
      command: "gauge.execute.specification",
      args: [node],
    },
  ]);
});

test("activation starts Gauge workspace services for Gauge projects", () => {
  const extension = require("../src/extension");

  const created = {};
  const checkedProjects = [];
  const versions = [];
  const welcomeCalls = [];
  const executionController = { handleCommand() {} };
  const context = { subscriptions: [] };
  const {
    contexts,
    configurationListeners,
    debugProviders,
    editorUpdates,
    fakeVscode,
    languageConfigurations,
    registeredCommands,
    semanticTokenProviders,
  } = createFakeVscode({
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

  class FakeGenerateStubCommandProvider {
    constructor(clients, options) {
      this.clients = clients;
      this.options = options;
      created.generateStubProvider = this;
    }

    dispose() {}
  }

  class FakeSpecNodeProvider {
    constructor(workspace, options) {
      this.workspace = workspace;
      this.options = options;
      created.specNodeProvider = this;
    }

    dispose() {}
  }

  class FakeProjectInitializer {
    constructor(options) {
      this.options = options;
      created.projectInitializer = this;
    }

    dispose() {}
  }

  class FakeSemanticTokensProvider {
    constructor(options) {
      this.options = options;
      created.semanticTokensProvider = this;
    }
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
      return executionController;
    },
    GaugeClients: FakeGaugeClients,
    GaugeState: FakeGaugeState,
    GaugeWorkspace: FakeGaugeWorkspace,
    ConfigProvider: FakeConfigProvider,
    GenerateStubCommandProvider: FakeGenerateStubCommandProvider,
    SpecNodeProvider: FakeSpecNodeProvider,
    GaugeSemanticTokensProvider: FakeSemanticTokensProvider,
    ProjectInitializer: FakeProjectInitializer,
    ReferenceProvider: FakeReferenceProvider,
    semanticTokensLegend: { id: "legend" },
    showWelcomeNotification(receivedContext, receivedVscode) {
      welcomeCalls.push({ context: receivedContext, vscode: receivedVscode });
    },
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
  assert.deepEqual(welcomeCalls, [{ context, vscode: fakeVscode }]);
  assert.equal(created.workspace.options.cli, cli);
  assert.equal(created.workspace.options.clientsMap, created.clientsMap);
  assert.equal(created.workspace.options.state, created.state);
  assert.equal(created.state.context, context);
  assert.equal(created.workspace.options.vscode, fakeVscode);
  assert.equal(created.referenceProvider.clients, created.clientsMap);
  assert.equal(created.referenceProvider.options.vscode, fakeVscode);
  assert.equal(created.configProvider.context, context);
  assert.equal(created.configProvider.options.vscode, fakeVscode);
  assert.equal(created.generateStubProvider.clients, created.clientsMap);
  assert.equal(created.generateStubProvider.options.vscode, fakeVscode);
  assert.equal(created.specNodeProvider.workspace, created.workspace);
  assert.equal(created.specNodeProvider.options.vscode, fakeVscode);
  assert.equal(created.specNodeProvider.options.executionController, executionController);
  assert.equal(created.projectInitializer.options.vscode, fakeVscode);
  assert.equal(context.subscriptions.includes(created.workspace), true);
  assert.equal(context.subscriptions.includes(created.referenceProvider), true);
  assert.equal(context.subscriptions.includes(created.configProvider), true);
  assert.equal(context.subscriptions.includes(created.generateStubProvider), true);
  assert.equal(context.subscriptions.includes(created.specNodeProvider), true);
  assert.equal(context.subscriptions.includes(created.projectInitializer), true);
  assert.equal(context.subscriptions.includes(debugProviders[0].disposable), true);
  assert.equal(context.subscriptions.includes(semanticTokenProviders[0].disposable), true);
  assert.equal(debugProviders[0].type, "gauge");
  assert.throws(
    () => debugProviders[0].provider.resolveDebugConfiguration(),
    /Starting with the Gauge debug configuration is not supported/,
  );
  assert.deepEqual(contexts, [
    { command: "setContext", key: "gauge:activated", value: true },
  ]);
  assert.deepEqual(
    languageConfigurations.map((entry) => entry.language),
    ["gauge"],
  );
  assert.deepEqual(semanticTokenProviders, [
    {
      selector: { language: "gauge" },
      provider: created.semanticTokensProvider,
      legend: { id: "legend" },
      disposable: semanticTokenProviders[0].disposable,
    },
  ]);
  assert.equal(created.semanticTokensProvider.options.vscode, fakeVscode);
  assert.equal(context.subscriptions.includes(configurationListeners[0].disposable), true);
  assert.deepEqual(editorUpdates[0], {
    key: "semanticTokenColorCustomizations",
    value: {
      rules: {
        argument: { foreground: "#ae81ff" },
        stepMarker: { foreground: "#ffffff" },
        step: { foreground: "#a6e22e" },
        table: { foreground: "#ae81ff" },
        tableHeaderSeparator: { foreground: "#8349f0" },
        tableBorder: { foreground: "#8349f0" },
        tableKeyword: { foreground: "#ffffff" },
        tableFileValue: { foreground: "#dddddd" },
        tagKeyword: { foreground: "#ff4689" },
        tagValue: { foreground: "#fc88b2" },
        specification: { foreground: "#66d9ef" },
        scenario: { foreground: "#66d9ef" },
        gaugeComment: { foreground: "#cccccc" },
        disabledStep: { foreground: "#228549" },
      },
    },
    target: "global",
  });
  configurationListeners[0].listener({
    affectsConfiguration(section) {
      return section === "gauge.semanticTokenColors";
    },
  });
  assert.equal(editorUpdates.length, 2);
  assert.equal(registeredCommands.some((entry) => entry.command === "gauge.showReferences.atCursor"), false);
  assert.equal(registeredCommands.some((entry) => entry.command === "gauge.specexplorer.runNode"), false);
  assert.equal(registeredCommands.some((entry) => entry.command === "gauge.specexplorer.debugNode"), false);
});

test("activation shows install guidance when Gauge is unavailable", () => {
  const extension = require("../src/extension");

  const installCalls = [];
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });
  const cli = {
    isGaugeInstalled() {
      return false;
    },
    isGaugeVersionGreaterOrEqual() {
      return true;
    },
  };

  extension.activate(context, fakeVscode, {
    createCli() {
      return cli;
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    ProjectInitializer: class FakeProjectInitializer {
      dispose() {}
    },
    projectFactory: {
      isGaugeProject() {
        return true;
      },
    },
    showInstallGaugeNotification(vscode) {
      installCalls.push(vscode);
    },
  });

  assert.deepEqual(installCalls, [fakeVscode]);
});
