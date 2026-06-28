const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const PROVIDER_COMMANDS = new Set([
  "gauge.createProject",
  "gauge.config.saveRecommended",
  "gauge.extract.concept",
  "gauge.showReferences.atCursor",
  "gauge.specexplorer.debugNode",
  "gauge.specexplorer.runAllActiveProjectSpecs",
  "gauge.specexplorer.runNode",
  "gauge.specexplorer.switchProject",
]);
const INTERNAL_EXECUTION_COMMANDS = [
  "gauge.execute",
  "gauge.debug",
  "gauge.execute.inParallel",
];

function createFakeVscode(overrides = {}) {
  const registeredCommands = [];
  const contexts = [];
  const debugProviders = [];
  const editorUpdates = [];
  const codeActionProviders = [];
  const codeLensProviders = [];
  const completionProviders = [];
  const definitionProviders = [];
  const diagnosticCollections = [];
  const formattingProviders = [];
  const foldingRangeProviders = [];
  const languageConfigurations = [];
  const configurationListeners = [];
  const referenceProviders = [];
  const renameProviders = [];
  const semanticTokenProviders = [];
  const semanticTokenColors = {
    argument: "#ae81ff",
    stepMarker: "#ffffff",
    step: "#a6e22e",
    table: "#ae81ff",
    tableHeader: "#ae81ff",
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
  const textDocumentListeners = [];
  const fakeVscode = {
    ConfigurationTarget: {
      Global: "global",
      Workspace: "workspace",
    },
    commands: {
      executeCommand(command, key, value) {
        if (typeof overrides.onExecuteCommand === "function") {
          overrides.onExecuteCommand(command, key, value);
        }
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
      registerCodeActionsProvider(selector, provider) {
        const disposable = { dispose() {} };
        codeActionProviders.push({
          selector,
          provider,
          disposable,
        });
        return disposable;
      },
      registerCodeLensProvider(selector, provider) {
        const disposable = { dispose() {} };
        codeLensProviders.push({
          selector,
          provider,
          disposable,
        });
        return disposable;
      },
      registerCompletionItemProvider(selector, provider, ...triggerCharacters) {
        const disposable = { dispose() {} };
        completionProviders.push({
          selector,
          provider,
          triggerCharacters,
          disposable,
        });
        return disposable;
      },
      registerDefinitionProvider(selector, provider) {
        const disposable = { dispose() {} };
        definitionProviders.push({
          selector,
          provider,
          disposable,
        });
        return disposable;
      },
      registerFoldingRangeProvider(selector, provider) {
        const disposable = { dispose() {} };
        foldingRangeProviders.push({
          selector,
          provider,
          disposable,
        });
        return disposable;
      },
      registerDocumentFormattingEditProvider(selector, provider) {
        const disposable = { dispose() {} };
        formattingProviders.push({
          selector,
          provider,
          disposable,
        });
        return disposable;
      },
      registerReferenceProvider(selector, provider) {
        const disposable = { dispose() {} };
        referenceProviders.push({
          selector,
          provider,
          disposable,
        });
        return disposable;
      },
      registerRenameProvider(selector, provider) {
        const disposable = { dispose() {} };
        renameProviders.push({
          selector,
          provider,
          disposable,
        });
        return disposable;
      },
      createDiagnosticCollection(name) {
        const disposable = { dispose() {} };
        diagnosticCollections.push({ name, disposable });
        return disposable;
      },
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
      showErrorMessage() {
        return undefined;
      },
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
      onDidChangeTextDocument(listener) {
        const disposable = { dispose() {} };
        textDocumentListeners.push({ listener, disposable });
        return disposable;
      },
      workspaceFolders: overrides.workspaceFolders,
    },
  };
  return {
    configurationListeners,
    contexts,
    codeActionProviders,
    codeLensProviders,
    completionProviders,
    definitionProviders,
    diagnosticCollections,
    debugProviders,
    editorUpdates,
    fakeVscode,
    formattingProviders,
    foldingRangeProviders,
    languageConfigurations,
    referenceProviders,
    registeredCommands,
    renameProviders,
    semanticTokenProviders,
    textDocumentListeners,
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
      ...INTERNAL_EXECUTION_COMMANDS,
      ...manifest.contributes.commands
        .map((entry) => entry.command)
        .filter((command) => !PROVIDER_COMMANDS.has(command)),
    ],
  );
  assert.equal(
    context.subscriptions.length,
    manifest.contributes.commands.length - PROVIDER_COMMANDS.size + 1
      + INTERNAL_EXECUTION_COMMANDS.length,
  );
  assert.equal(registeredCommands.every((entry) => typeof entry.handler === "function"), true);
});

test("activation registers Gauge reference providers", () => {
  const extension = require("../src/extension");
  const context = { subscriptions: [] };
  const {
    fakeVscode,
    referenceProviders,
  } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "gauge",
        uri: { fsPath: "/workspace/specs/example.spec" },
      },
    },
    workspaceFolders: [
      { uri: { fsPath: "/workspace" } },
    ],
  });

  extension.activate(context, fakeVscode, {
    createCli() {
      return {
        isGaugeInstalled() {
          return true;
        },
        isGaugeVersionGreaterOrEqual() {
          return true;
        },
      };
    },
    semanticTokensLegend: {},
    showWelcomeNotification() {},
    GaugeWorkspace: class GaugeWorkspace {
      constructor() {}
      dispose() {}
    },
    ConfigProvider: class ConfigProvider {
      constructor() {}
      dispose() {}
    },
    SpecNodeProvider: class SpecNodeProvider {
      constructor() {}
      dispose() {}
    },
    projectFactory: {
      isGaugeProject() {
        return true;
      },
      getGaugeRootFromFilePath() {
        return "/workspace";
      },
    },
  });

  assert.deepEqual(referenceProviders.map((entry) => entry.selector), [
    [
      { language: "gauge" },
      { language: "kotlin" },
      { scheme: "file", pattern: "**/*.kt" },
    ],
  ]);
});

test("activation defers CLI creation when Gauge services are not needed", () => {
  const extension = require("../src/extension");

  let createCliCalls = 0;
  let projectInitializerOptions;
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode();

  class FakeProjectInitializer {
    constructor(options) {
      projectInitializerOptions = options;
    }

    dispose() {}
  }

  extension.activate(context, fakeVscode, {
    createCli() {
      createCliCalls += 1;
      return {
        isGaugeInstalled() {
          return true;
        },
        isGaugeVersionGreaterOrEqual() {
          return true;
        },
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    ProjectInitializer: FakeProjectInitializer,
  });

  assert.equal(createCliCalls, 0);
  assert.equal(typeof projectInitializerOptions.createCli, "function");

  projectInitializerOptions.createCli({ vscode: fakeVscode });
  assert.equal(createCliCalls, 1);
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

test("create concept command delegates to the concept creator", () => {
  const extension = require("../src/extension");

  let receivedOptions;
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode();

  extension.activate(context, fakeVscode, {
    createConcept(options) {
      receivedOptions = options;
      return "created";
    },
  });

  const command = registeredCommands.find(
    (entry) => entry.command === "gauge.create.concept",
  );

  assert.ok(command);
  assert.equal(command.handler(), "created");
  assert.equal(receivedOptions.vscode, fakeVscode);
});

test("preview command delegates to the Gauge preview creator", () => {
  const extension = require("../src/extension");

  let receivedOptions;
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode();
  const projectFactory = {};

  extension.activate(context, fakeVscode, {
    env: { PATH: "/bin" },
    fileSystem: { id: "fs" },
    pathModule: { id: "path" },
    projectFactory,
    createPreview(options) {
      receivedOptions = options;
      return "previewed";
    },
  });

  const command = registeredCommands.find(
    (entry) => entry.command === "gauge.preview",
  );

  assert.ok(command);
  assert.equal(command.handler(), "previewed");
  assert.equal(receivedOptions.vscode, fakeVscode);
  assert.equal(receivedOptions.fileSystem.id, "fs");
  assert.equal(receivedOptions.pathModule.id, "path");
  assert.equal(receivedOptions.projectFactory, projectFactory);
});

test("format command saves and runs gauge format for the active Gauge file", async () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const calls = [];
  const spawned = [];
  const { fakeVscode, registeredCommands } = createFakeVscode({
    onExecuteCommand(command) {
      calls.push(command);
    },
  });

  extension.activate(context, fakeVscode, {
    createCli() {
      return {
        gaugeCommand() {
          return {
            spawn(args, options) {
              spawned.push({ args, options });
              const child = new EventEmitter();
              child.stdout = new EventEmitter();
              child.stderr = new EventEmitter();
              process.nextTick(() => child.emit("exit", 0));
              return child;
            },
          };
        },
      };
    },
    projectFactory: {
      getGaugeRootFromFilePath(filePath) {
        assert.equal(filePath, "/workspace/gauge/specs/example.spec");
        return "/workspace/gauge";
      },
    },
  });

  const command = registeredCommands.find(
    (entry) => entry.command === "gauge.format",
  );

  assert.ok(command);
  fakeVscode.window.activeTextEditor = {
    document: {
      languageId: "gauge",
      uri: { fsPath: "/workspace/gauge/specs/example.spec" },
      save() {
        calls.push("document.save");
        return Promise.resolve(true);
      },
    },
  };
  await command.handler();
  assert.deepEqual(calls, ["document.save"]);
  assert.deepEqual(spawned, [
    {
      args: ["format", "/workspace/gauge/specs/example.spec"],
      options: { cwd: "/workspace/gauge" },
    },
  ]);
});

test("create specification command provides Gauge LSP spec directories", async () => {
  const extension = require("../src/extension");

  const clientRequests = [];
  const clientsMap = new Map([
    [
      "/workspace/gauge",
      {
        client: {
          sendRequest(request, token) {
            clientRequests.push({ request, token });
            return Promise.resolve(["specs", "features"]);
          },
        },
      },
    ],
  ]);
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });
  const token = { id: "token" };
  fakeVscode.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
      this.token = token;
    }
  };

  extension.activate(context, fakeVscode, {
    clientsMap,
    createCli() {
      return {
        isGaugeInstalled() {
          return true;
        },
        isGaugeVersionGreaterOrEqual() {
          return true;
        },
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    createSpecification(options) {
      return options.specDirsProvider("/workspace/gauge");
    },
    showWelcomeNotification() {},
    GaugeSemanticTokensProvider: class FakeSemanticTokensProvider {},
    semanticTokensLegend: { id: "legend" },
    GaugeWorkspace: class FakeGaugeWorkspace {
      dispose() {}
    },
    ConfigProvider: class FakeConfigProvider {
      dispose() {}
    },
    GenerateStubCommandProvider: class FakeGenerateStubCommandProvider {
      dispose() {}
    },
    SpecNodeProvider: class FakeSpecNodeProvider {
      dispose() {}
    },
    ProjectInitializer: class FakeProjectInitializer {
      dispose() {}
    },
    ReferenceProvider: class FakeReferenceProvider {
      dispose() {}
    },
    projectFactory: {
      isGaugeProject() {
        return true;
      },
    },
  });

  const command = registeredCommands.find(
    (entry) => entry.command === "gauge.create.specification",
  );

  assert.ok(command);
  assert.deepEqual(await command.handler(), ["specs", "features"]);
  assert.deepEqual(clientRequests, [
    { request: "gauge/specDirs", token },
  ]);
});

test("file creation commands use Gauge client project roots", async () => {
  const extension = require("../src/extension");

  const clientsMap = new Map([
    [
      "/workspace/gauge",
      {
        client: {
          sendRequest() {
            return Promise.resolve(["specs"]);
          },
        },
      },
    ],
  ]);
  const receivedOptions = {};
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/plain" } },
      { uri: { fsPath: "/workspace/gauge" } },
    ],
  });

  extension.activate(context, fakeVscode, {
    clientsMap,
    createCli() {
      return {
        isGaugeInstalled() {
          return true;
        },
        isGaugeVersionGreaterOrEqual() {
          return true;
        },
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    createSpecification(options) {
      receivedOptions.specification = options;
      return "specification";
    },
    createConcept(options) {
      receivedOptions.concept = options;
      return "concept";
    },
    showWelcomeNotification() {},
    GaugeSemanticTokensProvider: class FakeSemanticTokensProvider {},
    semanticTokensLegend: { id: "legend" },
    GaugeWorkspace: class FakeGaugeWorkspace {
      dispose() {}
    },
    ConfigProvider: class FakeConfigProvider {
      dispose() {}
    },
    GenerateStubCommandProvider: class FakeGenerateStubCommandProvider {
      dispose() {}
    },
    SpecNodeProvider: class FakeSpecNodeProvider {
      dispose() {}
    },
    ProjectInitializer: class FakeProjectInitializer {
      dispose() {}
    },
    ReferenceProvider: class FakeReferenceProvider {
      dispose() {}
    },
    ExtractConceptCommandProvider: class FakeExtractConceptCommandProvider {
      dispose() {}
    },
    projectFactory: {
      isGaugeProject() {
        return true;
      },
    },
  });

  const createSpecificationCommand = registeredCommands.find(
    (entry) => entry.command === "gauge.create.specification",
  );
  const createConceptCommand = registeredCommands.find(
    (entry) => entry.command === "gauge.create.concept",
  );

  assert.ok(createSpecificationCommand);
  assert.ok(createConceptCommand);
  assert.equal(createSpecificationCommand.handler(), "specification");
  assert.equal(createConceptCommand.handler(), "concept");
  assert.deepEqual(receivedOptions.specification.projects, ["/workspace/gauge"]);
  assert.deepEqual(receivedOptions.concept.projects, ["/workspace/gauge"]);
});

test("execution commands delegate to the Gauge execution controller", () => {
  const extension = require("../src/extension");

  const handledCommands = [];
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode();
  const projectFactory = {};

  extension.activate(context, fakeVscode, {
    createExecutionController(options) {
      assert.equal(options.vscode, fakeVscode);
      assert.equal(options.projectFactory, projectFactory);
      return {
        handleCommand(command, ...args) {
          handledCommands.push({ command, args });
          return "executed";
        },
      };
    },
    projectFactory,
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

test("activation wires Gauge Test UI execution events into the execution controller", () => {
  const extension = require("../src/extension");

  const created = {};
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode();
  const sink = () => {};

  class FakeGaugeTestController {
    constructor(options) {
      this.options = options;
      this.disposable = { dispose() {} };
      created.testController = this;
    }

    createExecutionEventSink() {
      return sink;
    }

    register() {
      return this.disposable;
    }

    setExecutionController(executionController) {
      this.executionController = executionController;
    }
  }

  const executionController = { handleCommand() {} };
  extension.activate(context, fakeVscode, {
    createExecutionController(options) {
      created.executionOptions = options;
      return executionController;
    },
    GaugeTestController: FakeGaugeTestController,
  });

  assert.equal(created.testController.options.vscode, fakeVscode);
  assert.equal(created.executionOptions.executionEventSink, sink);
  assert.equal(created.testController.executionController, executionController);
  assert.equal(context.subscriptions.includes(created.testController.disposable), true);
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
    codeActionProviders,
    configurationListeners,
    debugProviders,
    editorUpdates,
    fakeVscode,
    foldingRangeProviders,
    languageConfigurations,
    renameProviders,
    registeredCommands,
    semanticTokenProviders,
    textDocumentListeners,
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

  class FakeExtractConceptCommandProvider {
    constructor(clients, options) {
      this.clients = clients;
      this.options = options;
      created.extractConceptProvider = this;
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

  class FakeFoldingRangeProvider {
    constructor(options) {
      this.options = options;
      created.foldingRangeProvider = this;
    }
  }

  class FakeRenameProvider {
    constructor(options) {
      this.options = options;
      created.renameProvider = this;
    }
  }

  class FakeArgumentCodeActionProvider {
    constructor(options) {
      this.options = options;
      created.argumentCodeActionProvider = this;
    }
  }

  class FakeStepDiagnosticsProvider {
    constructor(options) {
      this.options = options;
      this.disposable = { dispose() {} };
      created.stepDiagnosticsProvider = this;
    }

    register() {
      return this.disposable;
    }
  }

  class FakeValidateDiagnosticsProvider {
    constructor(options) {
      this.options = options;
      this.disposable = { dispose() {} };
      created.validateDiagnosticsProvider = this;
    }

    register() {
      return this.disposable;
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
    createExecutionController(options) {
      created.executionOptions = options;
      return executionController;
    },
    GaugeClients: FakeGaugeClients,
    GaugeState: FakeGaugeState,
    GaugeWorkspace: FakeGaugeWorkspace,
    ConfigProvider: FakeConfigProvider,
    ExtractConceptCommandProvider: FakeExtractConceptCommandProvider,
    GenerateStubCommandProvider: FakeGenerateStubCommandProvider,
    SpecNodeProvider: FakeSpecNodeProvider,
    GaugeSemanticTokensProvider: FakeSemanticTokensProvider,
    GaugeFoldingRangeProvider: FakeFoldingRangeProvider,
    GaugeRenameProvider: FakeRenameProvider,
    GaugeArgumentCodeActionProvider: FakeArgumentCodeActionProvider,
    GaugeStepDiagnosticsProvider: FakeStepDiagnosticsProvider,
    GaugeValidateDiagnosticsProvider: FakeValidateDiagnosticsProvider,
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
  assert.equal(created.executionOptions.state, created.state);
  assert.equal(typeof created.executionOptions.scenariosProvider, "function");
  assert.equal(typeof created.executionOptions.executionStatusProvider, "function");
  assert.equal(created.workspace.options.cli, cli);
  assert.equal(created.workspace.options.clientsMap, created.clientsMap);
  assert.equal(created.workspace.options.state, created.state);
  assert.equal(created.state.context, context);
  assert.equal(created.workspace.options.vscode, fakeVscode);
  assert.equal(created.referenceProvider.clients, created.clientsMap);
  assert.equal(created.referenceProvider.options.vscode, fakeVscode);
  assert.equal(created.referenceProvider.options.projectFactory, created.workspace.options.projectFactory);
  assert.equal(created.configProvider.context, context);
  assert.equal(created.configProvider.options.vscode, fakeVscode);
  assert.equal(created.extractConceptProvider.clients, created.clientsMap);
  assert.equal(created.extractConceptProvider.options.vscode, fakeVscode);
  assert.equal(created.generateStubProvider.clients, created.clientsMap);
  assert.equal(created.generateStubProvider.options.vscode, fakeVscode);
  assert.equal(created.specNodeProvider.workspace, created.workspace);
  assert.equal(created.specNodeProvider.options.vscode, fakeVscode);
  assert.equal(created.specNodeProvider.options.executionController, executionController);
  assert.equal(created.projectInitializer.options.vscode, fakeVscode);
  assert.equal(context.subscriptions.includes(created.workspace), true);
  assert.equal(context.subscriptions.includes(created.referenceProvider), true);
  assert.equal(context.subscriptions.includes(created.configProvider), true);
  assert.equal(context.subscriptions.includes(created.extractConceptProvider), true);
  assert.equal(context.subscriptions.includes(created.generateStubProvider), true);
  assert.equal(context.subscriptions.includes(created.specNodeProvider), true);
  assert.equal(context.subscriptions.includes(created.projectInitializer), true);
  assert.equal(context.subscriptions.includes(codeActionProviders[0].disposable), true);
  assert.equal(context.subscriptions.includes(debugProviders[0].disposable), true);
  assert.equal(context.subscriptions.includes(foldingRangeProviders[0].disposable), true);
  assert.equal(context.subscriptions.includes(renameProviders[0].disposable), true);
  assert.equal(context.subscriptions.includes(created.stepDiagnosticsProvider.disposable), true);
  assert.equal(context.subscriptions.includes(created.validateDiagnosticsProvider.disposable), true);
  assert.equal(context.subscriptions.includes(semanticTokenProviders[0].disposable), true);
  assert.equal(context.subscriptions.includes(textDocumentListeners[0].disposable), true);
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
  assert.equal(typeof textDocumentListeners[0].listener, "function");
  assert.equal(created.semanticTokensProvider.options.vscode, fakeVscode);
  assert.deepEqual(foldingRangeProviders, [
    {
      selector: { language: "gauge" },
      provider: created.foldingRangeProvider,
      disposable: foldingRangeProviders[0].disposable,
    },
  ]);
  assert.equal(created.foldingRangeProvider.options.vscode, fakeVscode);
  assert.deepEqual(renameProviders, [
    {
      selector: [
        { language: "gauge" },
        { language: "kotlin" },
        { scheme: "file", pattern: "**/*.kt" },
      ],
      provider: created.renameProvider,
      disposable: renameProviders[0].disposable,
    },
  ]);
  assert.equal(created.renameProvider.options.vscode, fakeVscode);
  assert.equal(created.renameProvider.options.projectFactory, created.workspace.options.projectFactory);
  assert.deepEqual(codeActionProviders, [
    {
      selector: { language: "gauge" },
      provider: created.argumentCodeActionProvider,
      disposable: codeActionProviders[0].disposable,
    },
  ]);
  assert.equal(created.argumentCodeActionProvider.options.vscode, fakeVscode);
  assert.equal(created.stepDiagnosticsProvider.options.vscode, fakeVscode);
  assert.equal(created.stepDiagnosticsProvider.options.projectFactory, created.workspace.options.projectFactory);
  assert.equal(created.validateDiagnosticsProvider.options.vscode, fakeVscode);
  assert.equal(created.validateDiagnosticsProvider.options.cli, cli);
  assert.equal(created.validateDiagnosticsProvider.options.projectFactory, created.workspace.options.projectFactory);
  assert.equal(context.subscriptions.includes(configurationListeners[0].disposable), true);
  assert.deepEqual(editorUpdates[0], {
    key: "semanticTokenColorCustomizations",
    value: {
      rules: {
        argument: { foreground: "#ae81ff" },
        stepMarker: { foreground: "#ffffff" },
        step: { foreground: "#a6e22e" },
        table: { foreground: "#ae81ff" },
        tableHeader: { foreground: "#ae81ff" },
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
  assert.equal(registeredCommands.some((entry) => entry.command === "gauge.selectArgumentRange"), true);
});

test("activation registers dynamic argument completions for Gauge documents", () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const { completionProviders, fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });

  class FakeDynamicArgumentCompletionProvider {
    constructor(options) {
      this.options = options;
    }
  }

  extension.activate(context, fakeVscode, {
    createCli() {
      return {
        isGaugeInstalled() {
          return true;
        },
        isGaugeVersionGreaterOrEqual() {
          return true;
        },
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    GaugeWorkspace: class FakeGaugeWorkspace {
      dispose() {}
    },
    ConfigProvider: class FakeConfigProvider {
      dispose() {}
    },
    DynamicArgumentCompletionProvider: FakeDynamicArgumentCompletionProvider,
    ExtractConceptCommandProvider: class FakeExtractConceptCommandProvider {
      dispose() {}
    },
    GenerateStubCommandProvider: class FakeGenerateStubCommandProvider {
      dispose() {}
    },
    SpecNodeProvider: class FakeSpecNodeProvider {
      dispose() {}
    },
    ProjectInitializer: class FakeProjectInitializer {
      dispose() {}
    },
    ReferenceProvider: class FakeReferenceProvider {
      dispose() {}
    },
    GaugeSemanticTokensProvider: class FakeSemanticTokensProvider {},
    GaugeStepDiagnosticsProvider: class FakeStepDiagnosticsProvider {
      register() {
        return { dispose() {} };
      }
    },
    semanticTokensLegend: { id: "legend" },
    projectFactory: {
      isGaugeProject() {
        return true;
      },
    },
    showWelcomeNotification() {},
  });

  assert.equal(completionProviders.length, 1);
  assert.deepEqual(completionProviders[0].selector, { language: "gauge" });
  assert.deepEqual(completionProviders[0].triggerCharacters, ["<", "\""]);
  assert.equal(completionProviders[0].provider.options.vscode, fakeVscode);
  assert.equal(typeof completionProviders[0].provider.options.projectFactory.isGaugeProject, "function");
  assert.equal(context.subscriptions.includes(completionProviders[0].disposable), true);
});

test("activation registers Gauge run code lenses for Gauge documents", () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const { codeLensProviders, fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });

  class FakeCodeLensProvider {
    constructor(options) {
      this.options = options;
    }
  }

  extension.activate(context, fakeVscode, {
    createCli() {
      return {
        isGaugeInstalled() {
          return true;
        },
        isGaugeVersionGreaterOrEqual() {
          return true;
        },
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    GaugeWorkspace: class FakeGaugeWorkspace {
      dispose() {}
    },
    ConfigProvider: class FakeConfigProvider {
      dispose() {}
    },
    DynamicArgumentCompletionProvider: class FakeDynamicArgumentCompletionProvider {},
    ExtractConceptCommandProvider: class FakeExtractConceptCommandProvider {
      dispose() {}
    },
    GenerateStubCommandProvider: class FakeGenerateStubCommandProvider {
      dispose() {}
    },
    SpecNodeProvider: class FakeSpecNodeProvider {
      dispose() {}
    },
    ProjectInitializer: class FakeProjectInitializer {
      dispose() {}
    },
    ReferenceProvider: class FakeReferenceProvider {
      dispose() {}
    },
    GaugeSemanticTokensProvider: class FakeSemanticTokensProvider {},
    GaugeCodeLensProvider: FakeCodeLensProvider,
    GaugeStepDiagnosticsProvider: class FakeStepDiagnosticsProvider {
      register() {
        return { dispose() {} };
      }
    },
    semanticTokensLegend: { id: "legend" },
    projectFactory: {
      isGaugeProject() {
        return true;
      },
    },
    showWelcomeNotification() {},
  });

  assert.equal(codeLensProviders.length, 1);
  assert.deepEqual(codeLensProviders[0].selector, { language: "gauge" });
  assert.equal(codeLensProviders[0].provider.options.vscode, fakeVscode);
  assert.equal(context.subscriptions.includes(codeLensProviders[0].disposable), true);
});

test("activation registers Gauge document formatting for Gauge documents", () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const { fakeVscode, formattingProviders } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });

  const cli = {
    isGaugeInstalled() {
      return true;
    },
    isGaugeVersionGreaterOrEqual() {
      return true;
    },
  };

  class FakeFormatProvider {
    constructor(options) {
      this.options = options;
    }
  }

  extension.activate(context, fakeVscode, {
    createCli() {
      return cli;
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    GaugeWorkspace: class FakeGaugeWorkspace {
      dispose() {}
    },
    ConfigProvider: class FakeConfigProvider {
      dispose() {}
    },
    DynamicArgumentCompletionProvider: class FakeDynamicArgumentCompletionProvider {},
    ExtractConceptCommandProvider: class FakeExtractConceptCommandProvider {
      dispose() {}
    },
    GenerateStubCommandProvider: class FakeGenerateStubCommandProvider {
      dispose() {}
    },
    SpecNodeProvider: class FakeSpecNodeProvider {
      dispose() {}
    },
    ProjectInitializer: class FakeProjectInitializer {
      dispose() {}
    },
    ReferenceProvider: class FakeReferenceProvider {
      dispose() {}
    },
    GaugeFormatProvider: FakeFormatProvider,
    GaugeSemanticTokensProvider: class FakeSemanticTokensProvider {},
    GaugeStepDiagnosticsProvider: class FakeStepDiagnosticsProvider {
      register() {
        return { dispose() {} };
      }
    },
    semanticTokensLegend: { id: "legend" },
    projectFactory: {
      isGaugeProject() {
        return true;
      },
    },
    showWelcomeNotification() {},
  });

  assert.equal(formattingProviders.length, 1);
  assert.deepEqual(formattingProviders[0].selector, { language: "gauge" });
  assert.equal(formattingProviders[0].provider.options.vscode, fakeVscode);
  assert.equal(formattingProviders[0].provider.options.cli, cli);
  assert.equal(typeof formattingProviders[0].provider.options.projectFactory.isGaugeProject, "function");
  assert.equal(context.subscriptions.includes(formattingProviders[0].disposable), true);
});

test("activation registers Kotlin step definitions for Gauge documents", () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const projectFactory = {
    isGaugeProject() {
      return true;
    },
  };
  const { definitionProviders, fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });

  class FakeStepDefinitionProvider {
    constructor(options) {
      this.options = options;
    }
  }

  extension.activate(context, fakeVscode, {
    createCli() {
      return {
        isGaugeInstalled() {
          return true;
        },
        isGaugeVersionGreaterOrEqual() {
          return true;
        },
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    GaugeWorkspace: class FakeGaugeWorkspace {
      dispose() {}
    },
    ConfigProvider: class FakeConfigProvider {
      dispose() {}
    },
    DynamicArgumentCompletionProvider: class FakeDynamicArgumentCompletionProvider {},
    ExtractConceptCommandProvider: class FakeExtractConceptCommandProvider {
      dispose() {}
    },
    GenerateStubCommandProvider: class FakeGenerateStubCommandProvider {
      dispose() {}
    },
    SpecNodeProvider: class FakeSpecNodeProvider {
      dispose() {}
    },
    ProjectInitializer: class FakeProjectInitializer {
      dispose() {}
    },
    ReferenceProvider: class FakeReferenceProvider {
      dispose() {}
    },
    GaugeSemanticTokensProvider: class FakeSemanticTokensProvider {},
    GaugeStepDefinitionProvider: FakeStepDefinitionProvider,
    GaugeStepDiagnosticsProvider: class FakeStepDiagnosticsProvider {
      register() {
        return { dispose() {} };
      }
    },
    semanticTokensLegend: { id: "legend" },
    projectFactory,
    showWelcomeNotification() {},
  });

  assert.equal(definitionProviders.length, 1);
  assert.deepEqual(definitionProviders[0].selector, { language: "gauge" });
  assert.equal(definitionProviders[0].provider.options.vscode, fakeVscode);
  assert.equal(definitionProviders[0].provider.options.projectFactory, projectFactory);
  assert.equal(context.subscriptions.includes(definitionProviders[0].disposable), true);
});

test("activation starts Gauge workspace services for an active Kotlin implementation document", () => {
  const extension = require("../src/extension");

  const created = {};
  const checkedFiles = [];
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "kotlin",
        uri: { fsPath: "/workspace/gauge/src/test/kotlin/Steps.kt" },
      },
    },
    workspaceFolders: [],
  });
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    isGaugeVersionGreaterOrEqual() {
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

  class FakeProvider {
    constructor(...args) {
      this.args = args;
    }

    dispose() {}
  }

  class FakeProjectInitializer {
    constructor(options) {
      this.options = options;
    }

    dispose() {}
  }

  class FakeStepDiagnosticsProvider {
    register() {
      return { dispose() {} };
    }
  }

  extension.activate(context, fakeVscode, {
    createCli() {
      return cli;
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    GaugeClients: FakeGaugeClients,
    GaugeWorkspace: FakeGaugeWorkspace,
    ConfigProvider: FakeProvider,
    ExtractConceptCommandProvider: FakeProvider,
    GenerateStubCommandProvider: FakeProvider,
    SpecNodeProvider: FakeProvider,
    ProjectInitializer: FakeProjectInitializer,
    ReferenceProvider: FakeProvider,
    GaugeSemanticTokensProvider: FakeProvider,
    GaugeFoldingRangeProvider: FakeProvider,
    GaugeArgumentCodeActionProvider: FakeProvider,
    GaugeStepDiagnosticsProvider: FakeStepDiagnosticsProvider,
    semanticTokensLegend: { id: "legend" },
    projectFactory: {
      isGaugeProject() {
        return false;
      },
      getGaugeRootFromFilePath(filename) {
        checkedFiles.push(filename);
        return "/workspace/gauge";
      },
    },
    showWelcomeNotification() {},
  });

  assert.deepEqual(checkedFiles, ["/workspace/gauge/src/test/kotlin/Steps.kt"]);
  assert.equal(created.workspace.options.clientsMap, created.clientsMap);
  assert.equal(created.workspace.options.vscode, fakeVscode);
  assert.equal(context.subscriptions.includes(created.workspace), true);
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
