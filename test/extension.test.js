const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const extensionSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "extension.js"),
  "utf8",
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

const PROVIDER_COMMANDS = new Set([
  "gauge.createProject",
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
const INTERNAL_PROVIDER_COMMANDS = [
  "gauge.executeIn.terminal",
  "gauge.selectArgumentRange",
];

function createFakeVscode(overrides = {}) {
  const registeredCommands = [];
  const contexts = [];
  const debugProviders = [];
  const editorUpdates = [];
  const appliedEdits = [];
  const codeActionProviders = [];
  const codeLensProviders = [];
  const completionProviders = [];
  const definitionProviders = [];
  const diagnosticCollections = [];
  const documentSymbolProviders = [];
  const formattingProviders = [];
  const foldingRangeProviders = [];
  const languageConfigurations = [];
  const configurationListeners = [];
  const referenceProviders = [];
  const renameProviders = [];
  const semanticTokenProviders = [];
  const workspaceSymbolProviders = [];
  const semanticTokenColors = {
    argument: "#ae81ff",
    dynamicArgument: "#ae81ff",
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
  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }

  class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }

  class WorkspaceEdit {
    constructor() {
      this.replacements = [];
    }

    replace(uri, range, newText) {
      this.replacements.push({ uri, range, newText });
    }
  }

  const fakeVscode = {
    ConfigurationTarget: {
      Global: "global",
      Workspace: "workspace",
    },
    Position,
    Range,
    WorkspaceEdit,
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
      registerDocumentSymbolProvider(selector, provider) {
        const disposable = { dispose() {} };
        documentSymbolProviders.push({
          selector,
          provider,
          disposable,
        });
        return disposable;
      },
      registerWorkspaceSymbolProvider(provider) {
        const disposable = { dispose() {} };
        workspaceSymbolProviders.push({
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
      showErrorMessage(message, ...actions) {
        if (typeof overrides.onErrorMessage === "function") {
          return overrides.onErrorMessage(message, ...actions);
        }
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
            get(key) {
              return key === "semanticTokenColorCustomizations"
                ? overrides.semanticTokenColorCustomizations
                : undefined;
            },
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
        const disposable = {
          disposeCalls: 0,
          dispose() {
            this.disposeCalls += 1;
          },
        };
        textDocumentListeners.push({ listener, disposable });
        return disposable;
      },
      applyEdit(edit) {
        appliedEdits.push(edit);
        return Promise.resolve(true);
      },
      workspaceFolders: overrides.workspaceFolders,
    },
  };
  return {
    appliedEdits,
    configurationListeners,
    contexts,
    codeActionProviders,
    codeLensProviders,
    completionProviders,
    definitionProviders,
    diagnosticCollections,
    documentSymbolProviders,
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
    workspaceSymbolProviders,
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
      ...INTERNAL_PROVIDER_COMMANDS,
      ...INTERNAL_EXECUTION_COMMANDS,
      ...manifest.contributes.commands
        .map((entry) => entry.command)
        .filter((command) => !PROVIDER_COMMANDS.has(command)),
    ],
  );
  // The +6 covers the non-command subscriptions activation owns, including the
  // project factory it creates: that factory holds a manifest FileSystemWatcher
  // which deactivate() must be able to release.
  assert.equal(
    context.subscriptions.length,
    manifest.contributes.commands.length - PROVIDER_COMMANDS.size + 6
      + INTERNAL_EXECUTION_COMMANDS.length
      + INTERNAL_PROVIDER_COMMANDS.length,
  );
  assert.equal(registeredCommands.every((entry) => typeof entry.handler === "function"), true);
});

// Every contributed command has a real owner: the execution controller, a
// provider, or a case in the dispatcher. The dispatcher used to end with a
// "not implemented yet" default and a gauge.stopExecution case that the
// execution branch above it already claimed, so both were unreachable text
// promising a user something that was in fact wired up.
test("activation leaves no command without a handler", () => {
  const manifest = require("../package.json");
  const extension = require("../src/extension");
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode();

  extension.activate(context, fakeVscode);

  const handled = new Set(registeredCommands.map((entry) => entry.command));
  for (const { command } of manifest.contributes.commands) {
    // PROVIDER_COMMANDS are registered by their provider once Gauge services
    // start, which is why every menu entry and keybinding for them is gated on
    // gauge:activated.
    assert.equal(
      handled.has(command) || PROVIDER_COMMANDS.has(command),
      true,
      `${command} has no handler`,
    );
  }
  assert.equal(extensionSource.includes("is not implemented yet"), false);
  assert.equal(extensionSource.includes("No Gauge execution is currently running."), false);
});

test("activation registers the Gauge terminal command provider", () => {
  const extension = require("../src/extension");
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode();

  extension.activate(context, fakeVscode);

  const terminalCommand = registeredCommands.find(
    (entry) => entry.command === "gauge.executeIn.terminal",
  );

  assert.ok(terminalCommand);
  assert.equal(typeof terminalCommand.handler, "function");
});

test("activation preserves Gauge editor language configuration", () => {
  const extension = require("../src/extension");
  const context = { subscriptions: [] };
  const { fakeVscode, languageConfigurations } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace" } },
    ],
  });

  class DisposableOnly {
    dispose() {}
  }

  class RegisteringDisposable extends DisposableOnly {
    register() {
      return { dispose() {} };
    }
  }

  class FakeGaugeWorkspace extends DisposableOnly {
    onDidChangeProjects() {
      return { dispose() {} };
    }
  }

  class FakeGaugeTestController extends DisposableOnly {
    register() {
      return { dispose() {} };
    }

    registerProjectChangeListener() {
      return { dispose() {} };
    }

    setExecutionController() {}
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
    showWelcomeNotification() {},
    projectFactory: {
      isGaugeProject() {
        return true;
      },
      getGaugeRootFromFilePath() {
        return "/workspace";
      },
    },
    GaugeClients: Map,
    GaugeState: DisposableOnly,
    GaugeWorkspace: FakeGaugeWorkspace,
    GaugeTestController: FakeGaugeTestController,
    GaugeStepDiagnosticsProvider: RegisteringDisposable,
    GaugeValidateDiagnosticsProvider: RegisteringDisposable,
    ProjectInitializer: DisposableOnly,
    TerminalProvider: DisposableOnly,
    ReferenceProvider: DisposableOnly,
    ExtractConceptCommandProvider: DisposableOnly,
    GenerateStubCommandProvider: DisposableOnly,
    SpecNodeProvider: DisposableOnly,
    semanticTokensLegend: {},
  });

  assert.deepEqual(languageConfigurations.map((entry) => entry.language), [
    "gauge",
    "gauge-concept",
  ]);
  for (const entry of languageConfigurations) {
    assert.deepEqual(entry.configuration.comments, {
      lineComment: "//",
    });
    assert.deepEqual(entry.configuration.brackets, [
      ["<", ">"],
      ["\"", "\""],
    ]);
    assert.deepEqual(entry.configuration.autoClosingPairs, [
      { open: "<", close: ">" },
      { open: "\"", close: "\"" },
    ]);
    assert.deepEqual(entry.configuration.surroundingPairs, [
      ["<", ">"],
      ["\"", "\""],
    ]);
    assert.equal(entry.configuration.wordPattern.source, "^(?:[*])([^*].*)$");
    assert.equal(entry.configuration.wordPattern.flags, "g");
  }
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
      { language: "gauge-concept" },
      { scheme: "file", pattern: "**/*.spec" },
      { scheme: "file", pattern: "**/*.cpt" },
      { language: "markdown", scheme: "file", pattern: "**/*.md" },
      { language: "kotlin" },
      { scheme: "file", pattern: "**/*.kt" },
      { language: "java" },
      { scheme: "file", pattern: "**/*.java" },
    ],
  ]);
});

test("activation defers CLI and debug provider creation when Gauge services are not needed", () => {
  const extension = require("../src/extension");

  let createCliCalls = 0;
  let projectInitializerOptions;
  const context = { subscriptions: [] };
  const { debugProviders, fakeVscode } = createFakeVscode();

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
  assert.deepEqual(debugProviders, []);

  projectInitializerOptions.createCli({ vscode: fakeVscode });
  assert.equal(createCliCalls, 1);
});

test("activation writes no workspace settings and recommends none", () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });
  const configurationUpdates = [];
  const informationMessages = [];
  const originalGetConfiguration = fakeVscode.workspace.getConfiguration;
  fakeVscode.workspace.getConfiguration = (section) => {
    const configuration = originalGetConfiguration(section);
    return {
      get(key) {
        return typeof configuration.get === "function" ? configuration.get(key) : undefined;
      },
      inspect() {
        return {};
      },
      update(key, value, target) {
        configurationUpdates.push({ key, target, value });
        return Promise.resolve(undefined);
      },
    };
  };
  fakeVscode.window.showInformationMessage = (message) => {
    informationMessages.push(message);
    return undefined;
  };

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
    GaugeValidateDiagnosticsProvider: class FakeValidateDiagnosticsProvider {
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

  // Only the Global semantic token colors may be written. Nothing may land in
  // the workspace target, which is what creates a project .vscode/settings.json.
  assert.deepEqual(
    configurationUpdates.filter((entry) => entry.target !== "global"),
    [],
  );
  assert.deepEqual(informationMessages, []);
});

test("activation ignores Markdown Gauge language documents outside Gauge projects", () => {
  const extension = require("../src/extension");

  let createCliCalls = 0;
  let createdWorkspace = false;
  const context = { subscriptions: [] };
  const { debugProviders, fakeVscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "gauge",
        uri: { fsPath: "/notes/readme.md" },
        fileName: "/notes/readme.md",
      },
    },
  });

  extension.activate(context, fakeVscode, {
    createCli() {
      createCliCalls += 1;
      throw new Error("createCli should not be called");
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    GaugeWorkspace: class FakeGaugeWorkspace {
      constructor() {
        createdWorkspace = true;
      }
    },
    projectFactory: {
      getGaugeRootFromFilePath(filePath) {
        assert.equal(filePath, "/notes/readme.md");
        throw new Error("not a Gauge project");
      },
      isGaugeProject() {
        return false;
      },
      findGaugeProjectRoots() {
        return [];
      },
    },
    showWelcomeNotification() {},
  });

  assert.equal(createCliCalls, 0);
  assert.equal(createdWorkspace, false);
  assert.deepEqual(debugProviders, []);
});

test("activation ignores Markdown documents when the resolved root is not a Gauge project", () => {
  const extension = require("../src/extension");

  let createCliCalls = 0;
  let createdWorkspace = false;
  const context = { subscriptions: [] };
  const { debugProviders, fakeVscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "markdown",
        uri: { fsPath: "/notes/readme.md" },
        fileName: "/notes/readme.md",
      },
    },
  });

  extension.activate(context, fakeVscode, {
    createCli() {
      createCliCalls += 1;
      throw new Error("createCli should not be called");
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    GaugeWorkspace: class FakeGaugeWorkspace {
      constructor() {
        createdWorkspace = true;
      }
    },
    projectFactory: {
      getGaugeRootFromFilePath(filePath) {
        assert.equal(filePath, "/notes/readme.md");
        return "/notes";
      },
      isGaugeProject(root) {
        assert.equal(root, "/notes");
        return false;
      },
      findGaugeProjectRoots() {
        return [];
      },
    },
    showWelcomeNotification() {},
  });

  assert.equal(createCliCalls, 0);
  assert.equal(createdWorkspace, false);
  assert.deepEqual(debugProviders, []);
});

test("activation ignores Gauge files by extension outside Gauge projects", () => {
  const extension = require("../src/extension");
  const documents = [
    {
      languageId: "plaintext",
      uri: { fsPath: "/notes/specs/draft.spec" },
      fileName: "/notes/specs/draft.spec",
    },
    {
      languageId: "plaintext",
      uri: { fsPath: "/notes/specs/concepts/shared.cpt" },
      fileName: "/notes/specs/concepts/shared.cpt",
    },
  ];

  for (const document of documents) {
    let createCliCalls = 0;
    let createdWorkspace = false;
    const checkedFiles = [];
    const context = { subscriptions: [] };
    const { debugProviders, fakeVscode } = createFakeVscode({
      activeTextEditor: { document },
    });

    extension.activate(context, fakeVscode, {
      createCli() {
        createCliCalls += 1;
        throw new Error("createCli should not be called");
      },
      createExecutionController() {
        return { handleCommand() {} };
      },
      GaugeWorkspace: class FakeGaugeWorkspace {
        constructor() {
          createdWorkspace = true;
        }
      },
      projectFactory: {
        getGaugeRootFromFilePath(filePath) {
          checkedFiles.push(filePath);
          return "/notes";
        },
        isGaugeProject(root) {
          assert.equal(root, "/notes");
          return false;
        },
        findGaugeProjectRoots() {
          return [];
        },
      },
      showWelcomeNotification() {},
    });

    assert.equal(createCliCalls, 0);
    assert.equal(createdWorkspace, false);
    assert.deepEqual(checkedFiles, [document.uri.fsPath]);
    assert.deepEqual(debugProviders, []);
  }
});

test("activation ignores Gauge files by extension when project root is unresolved", () => {
  const extension = require("../src/extension");

  let createCliCalls = 0;
  let createdWorkspace = false;
  const context = { subscriptions: [] };
  const { debugProviders, fakeVscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "plaintext",
        uri: { fsPath: "/notes/specs/draft.spec" },
        fileName: "/notes/specs/draft.spec",
      },
    },
  });

  extension.activate(context, fakeVscode, {
    createCli() {
      createCliCalls += 1;
      throw new Error("createCli should not be called");
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    GaugeWorkspace: class FakeGaugeWorkspace {
      constructor() {
        createdWorkspace = true;
      }
    },
    projectFactory: {
      getGaugeRootFromFilePath(filePath) {
        assert.equal(filePath, "/notes/specs/draft.spec");
        return undefined;
      },
      findGaugeProjectRoots() {
        return [];
      },
    },
    showWelcomeNotification() {},
  });

  assert.equal(createCliCalls, 0);
  assert.equal(createdWorkspace, false);
  assert.deepEqual(debugProviders, []);
});

test("activation uses asynchronous nested project discovery", async () => {
  const extension = require("../src/extension");
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  });
  let asyncDiscoveries = 0;
  let cliCreations = 0;

  const activation = extension.activate(context, fakeVscode, {
    createCli() {
      cliCreations += 1;
      return {
        isGaugeInstalled() {
          return false;
        },
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    projectFactory: {
      async findGaugeProjectRootsAsync(root) {
        asyncDiscoveries += 1;
        assert.equal(root, "/workspace");
        return ["/workspace/gauge"];
      },
      findGaugeProjectRoots() {
        throw new Error("synchronous nested discovery must not run during activation");
      },
      isGaugeProject() {
        return false;
      },
    },
    showInstallGaugeNotification() {},
    showWelcomeNotification() {},
  });

  assert.equal(cliCreations, 0);
  await activation;
  assert.equal(asyncDiscoveries, 1);
  assert.equal(cliCreations, 1);
});

test("activation continues live project discovery after one workspace folder fails", async () => {
  const extension = require("../src/extension");
  await extension.deactivate();
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/first" } },
      { uri: { fsPath: "/workspace/second" } },
    ],
  });
  const discoveries = [];
  let cliCreations = 0;

  const activation = extension.activate(context, fakeVscode, {
    createCli() {
      cliCreations += 1;
      return {
        isGaugeInstalled() {
          return false;
        },
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    projectFactory: {
      async findGaugeProjectRootsAsync(root) {
        discoveries.push(root);
        if (root === "/workspace/first") {
          throw new Error("Project discovery failed.");
        }
        return [`${root}/gauge`];
      },
      isGaugeProject() {
        return false;
      },
    },
    showInstallGaugeNotification() {},
    showWelcomeNotification() {},
  });

  await activation;
  await extension.deactivate();
  for (const subscription of context.subscriptions) {
    if (subscription && typeof subscription.dispose === "function") {
      subscription.dispose();
    }
  }

  assert.deepEqual(discoveries, ["/workspace/first", "/workspace/second"]);
  assert.equal(cliCreations, 1);
});

test("activation does not resume Gauge services after deactivation during project discovery", async () => {
  const extension = require("../src/extension");
  await extension.deactivate();
  const discoveryEntered = deferred();
  const discoveryGate = deferred();
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  });
  let cliCreations = 0;
  let installPrompts = 0;

  const activation = extension.activate(context, fakeVscode, {
    createCli() {
      cliCreations += 1;
      return {
        isGaugeInstalled() {
          return false;
        },
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    projectFactory: {
      findGaugeProjectRootsAsync(root) {
        assert.equal(root, "/workspace");
        discoveryEntered.resolve();
        return discoveryGate.promise;
      },
      isGaugeProject() {
        return false;
      },
    },
    showInstallGaugeNotification() {
      installPrompts += 1;
    },
    showWelcomeNotification() {},
  });
  let activationOutcome = { status: "pending" };
  Promise.resolve(activation).then(
    (value) => {
      activationOutcome = { status: "fulfilled", value };
    },
    (error) => {
      activationOutcome = { status: "rejected", error };
    },
  );

  await discoveryEntered.promise;
  const subscriptionsBeforeDeactivation = context.subscriptions.length;
  const deactivation = extension.deactivate();
  const repeatedDeactivation = extension.deactivate();
  await deactivation;
  await new Promise((resolve) => setImmediate(resolve));
  const outcomeBeforeDiscovery = activationOutcome;
  discoveryGate.resolve(["/workspace/gauge"]);
  await Promise.resolve(activation);
  await new Promise((resolve) => setImmediate(resolve));
  const finalState = {
    cliCreations,
    installPrompts,
    subscriptions: context.subscriptions.length,
  };
  for (const subscription of context.subscriptions) {
    if (subscription && typeof subscription.dispose === "function") {
      subscription.dispose();
    }
  }

  assert.equal(repeatedDeactivation, deactivation);
  assert.deepEqual(outcomeBeforeDiscovery, { status: "fulfilled", value: undefined });
  assert.deepEqual(finalState, {
    cliCreations: 0,
    installPrompts: 0,
    subscriptions: subscriptionsBeforeDeactivation,
  });
});

test("activation observes rejected project discovery after deactivation", async () => {
  const extension = require("../src/extension");
  await extension.deactivate();
  const discoveryEntered = deferred();
  const discoveryGate = deferred();
  const discoveryError = new Error("Project discovery failed.");
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  });
  let cliCreations = 0;

  const activation = extension.activate(context, fakeVscode, {
    createCli() {
      cliCreations += 1;
      return undefined;
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    projectFactory: {
      findGaugeProjectRootsAsync() {
        discoveryEntered.resolve();
        return discoveryGate.promise;
      },
      isGaugeProject() {
        return false;
      },
    },
    showWelcomeNotification() {},
  });
  let activationOutcome = { status: "pending" };
  Promise.resolve(activation).then(
    (value) => {
      activationOutcome = { status: "fulfilled", value };
    },
    (error) => {
      activationOutcome = { status: "rejected", error };
    },
  );

  await discoveryEntered.promise;
  await extension.deactivate();
  await new Promise((resolve) => setImmediate(resolve));
  const outcomeBeforeDiscovery = activationOutcome;
  discoveryGate.reject(discoveryError);
  assert.equal(await Promise.resolve(activation), undefined);
  await new Promise((resolve) => setImmediate(resolve));
  for (const subscription of context.subscriptions) {
    if (subscription && typeof subscription.dispose === "function") {
      subscription.dispose();
    }
  }

  assert.deepEqual(outcomeBeforeDiscovery, { status: "fulfilled", value: undefined });
  assert.equal(cliCreations, 0);
});

test("activation stops checking later workspace folders after deactivation", async () => {
  const extension = require("../src/extension");

  for (const settlement of ["resolve", "reject"]) {
    await extension.deactivate();
    const discoveryEntered = deferred();
    const discoveryGate = deferred();
    const context = { subscriptions: [] };
    const { fakeVscode } = createFakeVscode({
      workspaceFolders: [
        { uri: { fsPath: "/workspace/first" } },
        { uri: { fsPath: "/workspace/second" } },
      ],
    });
    const discoveries = [];
    let cliCreations = 0;

    const activation = extension.activate(context, fakeVscode, {
      createCli() {
        cliCreations += 1;
        return undefined;
      },
      createExecutionController() {
        return { handleCommand() {} };
      },
      projectFactory: {
        findGaugeProjectRootsAsync(root) {
          discoveries.push(root);
          if (root === "/workspace/first") {
            discoveryEntered.resolve();
            return discoveryGate.promise;
          }
          return Promise.resolve([`${root}/gauge`]);
        },
        isGaugeProject() {
          return false;
        },
      },
      showWelcomeNotification() {},
    });

    await discoveryEntered.promise;
    const deactivation = extension.deactivate();
    assert.equal(await Promise.resolve(activation), undefined);
    if (settlement === "resolve") {
      discoveryGate.resolve([]);
    } else {
      discoveryGate.reject(new Error("Project discovery failed."));
    }
    await new Promise((resolve) => setImmediate(resolve));
    await deactivation;
    for (const subscription of context.subscriptions) {
      if (subscription && typeof subscription.dispose === "function") {
        subscription.dispose();
      }
    }

    assert.deepEqual(discoveries, ["/workspace/first"]);
    assert.equal(cliCreations, 0);
  }
});

test("new activation supersedes pending asynchronous Gauge service discovery", async () => {
  const extension = require("../src/extension");
  await extension.deactivate();
  const firstDiscoveryEntered = deferred();
  const firstDiscoveryGate = deferred();
  const firstContext = { subscriptions: [] };
  const secondContext = { subscriptions: [] };
  const { fakeVscode: firstVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  });
  const { fakeVscode: secondVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/second" } }],
  });
  let firstCliCreations = 0;
  let secondWorkspaceDisposeCalls = 0;

  class DisposableOnly {
    dispose() {}
  }

  class RegisteringDisposable extends DisposableOnly {
    register() {
      return { dispose() {} };
    }
  }

  class SecondGaugeWorkspace {
    dispose() {
      secondWorkspaceDisposeCalls += 1;
    }
  }

  class SecondGaugeTestController extends DisposableOnly {
    register() {
      return { dispose() {} };
    }

    setExecutionController() {}
  }

  const firstActivation = extension.activate(firstContext, firstVscode, {
    createCli() {
      firstCliCreations += 1;
      return {
        isGaugeInstalled() {
          return false;
        },
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    projectFactory: {
      findGaugeProjectRootsAsync() {
        firstDiscoveryEntered.resolve();
        return firstDiscoveryGate.promise;
      },
      isGaugeProject() {
        return false;
      },
    },
    showInstallGaugeNotification() {},
    showWelcomeNotification() {},
  });
  let firstOutcome = { status: "pending" };
  Promise.resolve(firstActivation).then((value) => {
    firstOutcome = { status: "fulfilled", value };
  });
  await firstDiscoveryEntered.promise;

  extension.activate(secondContext, secondVscode, {
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
    GaugeClients: Map,
    GaugeState: DisposableOnly,
    GaugeWorkspace: SecondGaugeWorkspace,
    GaugeTestController: SecondGaugeTestController,
    GaugeStepDiagnosticsProvider: RegisteringDisposable,
    GaugeValidateDiagnosticsProvider: RegisteringDisposable,
    ProjectInitializer: DisposableOnly,
    TerminalProvider: DisposableOnly,
    ReferenceProvider: DisposableOnly,
    ExtractConceptCommandProvider: DisposableOnly,
    GenerateStubCommandProvider: DisposableOnly,
    SpecNodeProvider: DisposableOnly,
    semanticTokensLegend: {},
    projectFactory: {
      isGaugeProject() {
        return true;
      },
    },
    showWelcomeNotification() {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  const outcomeBeforeFirstDiscovery = firstOutcome;
  firstDiscoveryGate.resolve(["/workspace/gauge"]);
  await Promise.resolve(firstActivation);
  await new Promise((resolve) => setImmediate(resolve));
  const finalCliCreations = firstCliCreations;
  assert.equal(secondContext.subscriptions.some(
    (subscription) => subscription instanceof SecondGaugeWorkspace,
  ), true);
  await extension.deactivate();
  const committedWorkspaceDisposals = secondWorkspaceDisposeCalls;
  for (const subscription of [...firstContext.subscriptions, ...secondContext.subscriptions]) {
    if (subscription && typeof subscription.dispose === "function") {
      subscription.dispose();
    }
  }

  assert.deepEqual(outcomeBeforeFirstDiscovery, { status: "fulfilled", value: undefined });
  assert.equal(finalCliCreations, 0);
  assert.equal(committedWorkspaceDisposals, 1);
});

test("activation remains stopped when project discovery deactivates synchronously", async () => {
  const extension = require("../src/extension");
  await extension.deactivate();
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  });
  let cliCreations = 0;
  let installPrompts = 0;

  const activation = extension.activate(context, fakeVscode, {
    createCli() {
      cliCreations += 1;
      return {
        isGaugeInstalled() {
          return false;
        },
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    projectFactory: {
      findGaugeProjectRootsAsync() {
        extension.deactivate();
        return Promise.resolve(["/workspace/gauge"]);
      },
      isGaugeProject() {
        return false;
      },
    },
    showInstallGaugeNotification() {
      installPrompts += 1;
    },
    showWelcomeNotification() {},
  });

  assert.equal(await Promise.resolve(activation), undefined);
  for (const subscription of context.subscriptions) {
    if (subscription && typeof subscription.dispose === "function") {
      subscription.dispose();
    }
  }
  assert.equal(cliCreations, 0);
  assert.equal(installPrompts, 0);
});

test("activation remains stopped when synchronous project eligibility deactivates", async () => {
  const extension = require("../src/extension");
  await extension.deactivate();
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  });
  let cliCreations = 0;

  const activation = extension.activate(context, fakeVscode, {
    createCli() {
      cliCreations += 1;
      return undefined;
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    projectFactory: {
      isGaugeProject() {
        extension.deactivate();
        return true;
      },
    },
    showWelcomeNotification() {},
  });

  assert.equal(await Promise.resolve(activation), undefined);
  for (const subscription of context.subscriptions) {
    if (subscription && typeof subscription.dispose === "function") {
      subscription.dispose();
    }
  }
  assert.equal(cliCreations, 0);
});

test("activation does not discover tests after pending workspace readiness is deactivated", async () => {
  const extension = require("../src/extension");
  await extension.deactivate();
  const readyGate = deferred();
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  });
  let discoveries = 0;
  let workspaceDisposeCalls = 0;

  class DisposableOnly {
    dispose() {}
  }

  class RegisteringDisposable extends DisposableOnly {
    register() {
      return { dispose() {} };
    }
  }

  class FakeGaugeWorkspace {
    ready() {
      return readyGate.promise;
    }

    dispose() {
      workspaceDisposeCalls += 1;
    }
  }

  class FakeGaugeTestController extends DisposableOnly {
    discoverWorkspaceTests() {
      discoveries += 1;
      return Promise.resolve([]);
    }

    register() {
      return { dispose() {} };
    }

    setExecutionController() {}
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
    GaugeClients: Map,
    GaugeState: DisposableOnly,
    GaugeWorkspace: FakeGaugeWorkspace,
    GaugeTestController: FakeGaugeTestController,
    GaugeStepDiagnosticsProvider: RegisteringDisposable,
    GaugeValidateDiagnosticsProvider: RegisteringDisposable,
    ProjectInitializer: DisposableOnly,
    TerminalProvider: DisposableOnly,
    ReferenceProvider: DisposableOnly,
    ExtractConceptCommandProvider: DisposableOnly,
    GenerateStubCommandProvider: DisposableOnly,
    SpecNodeProvider: DisposableOnly,
    semanticTokensLegend: {},
    projectFactory: {
      isGaugeProject() {
        return true;
      },
    },
    showWelcomeNotification() {},
  });

  await extension.deactivate();
  readyGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  for (const subscription of context.subscriptions) {
    if (subscription && typeof subscription.dispose === "function") {
      subscription.dispose();
    }
  }

  assert.equal(workspaceDisposeCalls > 0, true);
  assert.equal(discoveries, 0);
});

test("activation does not connect a workspace handed off after deactivation", async () => {
  const extension = require("../src/extension");
  await extension.deactivate();
  const discoveryGate = deferred();
  const workspaceConstructed = deferred();
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  });
  let projectListenerRegistrations = 0;
  let readyCalls = 0;
  let discoveries = 0;
  let workspaceDisposeCalls = 0;

  class DisposableOnly {
    dispose() {}
  }

  class RegisteringDisposable extends DisposableOnly {
    register() {
      return { dispose() {} };
    }
  }

  class FakeGaugeWorkspace {
    constructor() {
      workspaceConstructed.resolve();
    }

    dispose() {
      workspaceDisposeCalls += 1;
    }

    ready() {
      readyCalls += 1;
      return Promise.resolve();
    }
  }

  class FakeGaugeTestController extends DisposableOnly {
    discoverWorkspaceTests() {
      discoveries += 1;
      return Promise.resolve([]);
    }

    register() {
      return { dispose() {} };
    }

    registerProjectChangeListener() {
      projectListenerRegistrations += 1;
      return { dispose() {} };
    }

    setExecutionController() {}
  }

  const activation = extension.activate(context, fakeVscode, {
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
    GaugeClients: Map,
    GaugeState: DisposableOnly,
    GaugeWorkspace: FakeGaugeWorkspace,
    GaugeTestController: FakeGaugeTestController,
    GaugeStepDiagnosticsProvider: RegisteringDisposable,
    GaugeValidateDiagnosticsProvider: RegisteringDisposable,
    ProjectInitializer: DisposableOnly,
    TerminalProvider: DisposableOnly,
    ReferenceProvider: DisposableOnly,
    ExtractConceptCommandProvider: DisposableOnly,
    GenerateStubCommandProvider: DisposableOnly,
    SpecNodeProvider: DisposableOnly,
    semanticTokensLegend: {},
    projectFactory: {
      findGaugeProjectRootsAsync() {
        return discoveryGate.promise;
      },
      isGaugeProject() {
        return false;
      },
    },
    showWelcomeNotification() {},
  });

  discoveryGate.resolve(["/workspace/gauge"]);
  await workspaceConstructed.promise;
  await extension.deactivate();
  assert.equal(await Promise.resolve(activation), undefined);
  await new Promise((resolve) => setImmediate(resolve));
  for (const subscription of context.subscriptions) {
    if (subscription && typeof subscription.dispose === "function") {
      subscription.dispose();
    }
  }

  assert.equal(workspaceDisposeCalls > 0, true);
  assert.equal(projectListenerRegistrations, 0);
  assert.equal(readyCalls, 0);
  assert.equal(discoveries, 0);
});

test("activation disposes unpublished services after synchronous deactivation", async () => {
  const extension = require("../src/extension");
  await extension.deactivate();
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  });
  const constructions = [];
  const finalProviders = [];
  let workspace;
  let workspaceDisposeCalls = 0;
  let finalProviderDisposeCalls = 0;
  let lateProviderConstructions = 0;

  class DisposableOnly {
    dispose() {}
  }

  class RegisteringDisposable extends DisposableOnly {
    register() {
      return { dispose() {} };
    }
  }

  class FakeGaugeWorkspace {
    constructor() {
      constructions.push("workspace");
      workspace = this;
    }

    dispose() {
      workspaceDisposeCalls += 1;
    }
  }

  class CountedReferenceProvider {
    constructor() {
      constructions.push("reference");
      finalProviders.push(this);
    }

    dispose() {
      finalProviderDisposeCalls += 1;
    }
  }

  class LateProvider extends DisposableOnly {
    constructor() {
      super();
      constructions.push("late");
      finalProviders.push(this);
      lateProviderConstructions += 1;
      if (lateProviderConstructions === 3) {
        extension.deactivate();
      }
    }

    dispose() {
      finalProviderDisposeCalls += 1;
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
    GaugeClients: Map,
    GaugeState: DisposableOnly,
    GaugeWorkspace: FakeGaugeWorkspace,
    GaugeTestController: RegisteringDisposable,
    GaugeStepDiagnosticsProvider: RegisteringDisposable,
    GaugeValidateDiagnosticsProvider: RegisteringDisposable,
    ProjectInitializer: DisposableOnly,
    TerminalProvider: DisposableOnly,
    ReferenceProvider: CountedReferenceProvider,
    ExtractConceptCommandProvider: LateProvider,
    GenerateStubCommandProvider: LateProvider,
    SpecNodeProvider: LateProvider,
    semanticTokensLegend: {},
    projectFactory: {
      isGaugeProject() {
        return true;
      },
    },
    showWelcomeNotification() {},
  });
  const subscriptionsAfterActivation = context.subscriptions.length;
  await extension.deactivate();
  for (const subscription of context.subscriptions) {
    if (subscription && typeof subscription.dispose === "function") {
      subscription.dispose();
    }
  }

  assert.deepEqual(constructions, [
    "workspace",
    "reference",
    "late",
    "late",
    "late",
  ]);
  assert.equal(workspaceDisposeCalls, 1);
  assert.equal(finalProviderDisposeCalls, 4);
  assert.equal(context.subscriptions.includes(workspace), false);
  assert.equal(finalProviders.every(
    (provider) => !context.subscriptions.includes(provider),
  ), true);
  assert.equal(context.subscriptions.length, subscriptionsAfterActivation);
});

test("create specification command delegates to the specification creator", async () => {
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
  assert.equal(await command.handler(), "created");
  assert.equal(receivedOptions.vscode, fakeVscode);
});

test("create concept command delegates to the concept creator", async () => {
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
  assert.equal(await command.handler(), "created");
  assert.equal(receivedOptions.vscode, fakeVscode);
});

test("activation owns SpecificationProvider for file creation commands", () => {
  const extension = require("../src/extension");

  const clientsMap = new Map([
    ["/workspace/gauge", { client: { id: "client" } }],
  ]);
  const created = {};
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode();

  class FakeSpecificationProvider {
    constructor(getClientsMap, options) {
      this.getClientsMap = getClientsMap;
      this.options = options;
      created.provider = this;
    }

    dispose() {}
  }

  extension.activate(context, fakeVscode, {
    clientsMap,
    SpecificationProvider: FakeSpecificationProvider,
  });

  assert.equal(context.subscriptions.includes(created.provider), true);
  assert.equal(created.provider.getClientsMap(), clientsMap);
  assert.equal(created.provider.options.vscode, fakeVscode);
  assert.deepEqual(created.provider.options.getProjects(), ["/workspace/gauge"]);
  assert.equal(
    registeredCommands.some((entry) => entry.command === "gauge.create.specification"),
    false,
  );
  assert.equal(
    registeredCommands.some((entry) => entry.command === "gauge.create.concept"),
    false,
  );
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

test("activation owns one Gauge preview controller", async () => {
  const extension = require("../src/extension");

  const created = [];
  class FakePreviewController {
    constructor(options) {
      this.options = options;
      this.disposeCalls = 0;
      this.previewCalls = 0;
      created.push(this);
    }

    dispose() {
      this.disposeCalls += 1;
    }

    preview() {
      this.previewCalls += 1;
      return Promise.resolve("previewed");
    }
  }

  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode();
  const projectEnvironmentService = { id: "environment-service" };

  extension.activate(context, fakeVscode, {
    GaugePreviewController: FakePreviewController,
    projectEnvironmentService,
  });

  const command = registeredCommands.find((entry) => entry.command === "gauge.preview");
  assert.ok(command);
  assert.equal(await command.handler(), "previewed");
  assert.equal(created.length, 1);
  assert.equal(created[0].previewCalls, 1);
  assert.equal(created[0].options.projectEnvironmentService, projectEnvironmentService);
  assert.equal(
    context.subscriptions.filter((entry) => entry === created[0]).length,
    1,
  );
});

test("format command saves and runs gauge format for the active Gauge file", async () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const calls = [];
  const formattedText = "# Checkout\n* Login\n";
  const spawned = [];
  const { appliedEdits, fakeVscode, registeredCommands } = createFakeVscode({
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
              process.nextTick(() => {
                child.emit("exit", 0);
                child.emit("close", 0);
              });
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
    fileSystem: {
      readFileSync(filePath) {
        assert.equal(filePath, "/workspace/gauge/specs/example.spec");
        return Buffer.from(formattedText);
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
      lineCount: 2,
      uri: { fsPath: "/workspace/gauge/specs/example.spec" },
      getText() {
        return "# Checkout\n*  Login\n";
      },
      lineAt(line) {
        return { text: ["# Checkout", "*  Login"][line] };
      },
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
  assert.equal(appliedEdits.length, 1);
  assert.equal(appliedEdits[0].replacements.length, 1);
  assert.deepEqual(appliedEdits[0].replacements[0].uri, {
    fsPath: "/workspace/gauge/specs/example.spec",
  });
  assert.deepEqual({ ...appliedEdits[0].replacements[0].range.start }, {
    line: 0,
    character: 0,
  });
  assert.deepEqual({ ...appliedEdits[0].replacements[0].range.end }, {
    line: 1,
    character: 8,
  });
  assert.equal(appliedEdits[0].replacements[0].newText, formattedText);
});

test("format command saves and runs gauge format for active spec files by extension", async () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const calls = [];
  const formattedText = "# Checkout\n* Login\n";
  const spawned = [];
  const { appliedEdits, fakeVscode, registeredCommands } = createFakeVscode();

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
              process.nextTick(() => {
                child.emit("exit", 0);
                child.emit("close", 0);
              });
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
    fileSystem: {
      readFileSync(filePath) {
        assert.equal(filePath, "/workspace/gauge/specs/example.spec");
        return Buffer.from(formattedText);
      },
    },
  });

  const command = registeredCommands.find(
    (entry) => entry.command === "gauge.format",
  );

  assert.ok(command);
  fakeVscode.window.activeTextEditor = {
    document: {
      languageId: "plaintext",
      lineCount: 2,
      uri: { fsPath: "/workspace/gauge/specs/example.spec" },
      getText() {
        return "# Checkout\n*  Login\n";
      },
      lineAt(line) {
        return { text: ["# Checkout", "*  Login"][line] };
      },
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
  assert.equal(appliedEdits.length, 1);
  assert.equal(appliedEdits[0].replacements[0].newText, formattedText);
});

test("format command saves and runs gauge format for active Markdown Gauge specs", async () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const calls = [];
  const formattedText = "# Checkout\n* Login\n";
  const spawned = [];
  const { appliedEdits, fakeVscode, registeredCommands } = createFakeVscode();

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
              process.nextTick(() => {
                child.emit("exit", 0);
                child.emit("close", 0);
              });
              return child;
            },
          };
        },
      };
    },
    projectFactory: {
      getGaugeRootFromFilePath(filePath) {
        assert.equal(filePath, "/workspace/gauge/specs/example.md");
        return "/workspace/gauge";
      },
    },
    fileSystem: {
      readFileSync(filePath) {
        assert.equal(filePath, "/workspace/gauge/specs/example.md");
        return Buffer.from(formattedText);
      },
    },
  });

  const command = registeredCommands.find(
    (entry) => entry.command === "gauge.format",
  );

  assert.ok(command);
  fakeVscode.window.activeTextEditor = {
    document: {
      languageId: "markdown",
      lineCount: 2,
      uri: { fsPath: "/workspace/gauge/specs/example.md" },
      getText() {
        return "# Checkout\n*  Login\n";
      },
      lineAt(line) {
        return { text: ["# Checkout", "*  Login"][line] };
      },
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
      args: ["format", "/workspace/gauge/specs/example.md"],
      options: { cwd: "/workspace/gauge" },
    },
  ]);
  assert.equal(appliedEdits.length, 1);
  assert.equal(appliedEdits[0].replacements[0].newText, formattedText);
});

test("format command removes deprecated Gauge lines from failures", async () => {
  const extension = require("../src/extension");

  const errors = [];
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode({
    onErrorMessage(message) {
      errors.push(message);
      return undefined;
    },
  });

  extension.activate(context, fakeVscode, {
    createCli() {
      return {
        gaugeCommand() {
          return {
            spawn() {
              const child = new EventEmitter();
              child.stdout = new EventEmitter();
              child.stderr = new EventEmitter();
              process.nextTick(() => {
                child.stderr.emit("data", "[DEPRECATED] old behavior\nformat failed\n");
                child.emit("exit", 1);
                child.emit("close", 1);
              });
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
      lineCount: 1,
      uri: { fsPath: "/workspace/gauge/specs/example.spec" },
      getText() {
        return "# Checkout\n";
      },
      lineAt(line) {
        assert.equal(line, 0);
        return { text: "# Checkout" };
      },
      save() {
        return Promise.resolve(true);
      },
    },
  };

  await command.handler();

  assert.deepEqual(errors, ["Error on formatting spec. format failed"]);
});

test("toggle line comment command delegates to the Gauge comment command", async () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const calls = [];
  const { fakeVscode, registeredCommands } = createFakeVscode();
  const projectFactory = {
    getGaugeRootFromFilePath() {
      return "/workspace";
    },
  };

  extension.activate(context, fakeVscode, {
    projectFactory,
    toggleLineComment(vscode, options) {
      calls.push({ options, vscode });
      return Promise.resolve(true);
    },
  });

  const command = registeredCommands.find(
    (entry) => entry.command === "gauge.toggle.lineComment",
  );
  assert.ok(command);

  assert.equal(await command.handler(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].vscode, fakeVscode);
  assert.equal(calls[0].options.projectFactory, projectFactory);
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
  assert.equal(await createSpecificationCommand.handler(), "specification");
  assert.equal(await createConceptCommand.handler(), "concept");
  assert.deepEqual(receivedOptions.specification.projects, ["/workspace/gauge"]);
  assert.deepEqual(receivedOptions.concept.projects, ["/workspace/gauge"]);
});

test("file creation commands use Explorer folder URI as the target directory", async () => {
  const extension = require("../src/extension");

  const receivedOptions = {};
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/gauge" } },
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

  const folderUri = { fsPath: "/workspace/gauge/specs/features" };
  const createSpecificationCommand = registeredCommands.find(
    (entry) => entry.command === "gauge.create.specification",
  );
  const createConceptCommand = registeredCommands.find(
    (entry) => entry.command === "gauge.create.concept",
  );

  assert.ok(createSpecificationCommand);
  assert.ok(createConceptCommand);
  assert.equal(await createSpecificationCommand.handler(folderUri), "specification");
  assert.equal(await createConceptCommand.handler(folderUri), "concept");
  assert.equal(receivedOptions.specification.specDir, "/workspace/gauge/specs/features");
  assert.equal(receivedOptions.concept.specDir, "/workspace/gauge/specs/features");
});

test("execution commands delegate without Test UI machine-readable flags", () => {
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

test("CodeLens execution commands delegate to the Gauge TestController", () => {
  const extension = require("../src/extension");
  const testCalls = [];
  const executionCalls = [];
  const context = { subscriptions: [] };
  const { fakeVscode, registeredCommands } = createFakeVscode();

  class FakeGaugeTestController {
    createExecutionEventSink() {
      return () => {};
    }

    setExecutionController() {}

    register() {
      return { dispose() {} };
    }

    runCodeLensTarget(command, target) {
      testCalls.push([command, target]);
      return "test-run";
    }
  }

  extension.activate(context, fakeVscode, {
    GaugeTestController: FakeGaugeTestController,
    createExecutionController() {
      return {
        handleCommand(command, ...args) {
          executionCalls.push([command, ...args]);
          return "direct-run";
        },
      };
    },
  });

  const command = registeredCommands.find((entry) => entry.command === "gauge.execute");
  const result = command.handler("/workspace/specs/example.spec:3");

  assert.equal(result, "test-run");
  assert.deepEqual(testCalls, [["gauge.execute", "/workspace/specs/example.spec:3"]]);
  assert.deepEqual(executionCalls, []);
});

test("activation wires Gauge Test UI execution events into the execution controller", () => {
  const extension = require("../src/extension");

  const created = {};
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode();
  const sink = () => {};
  const clientsMap = new Map();
  const projectFactory = {};
  const scenariosProvider = () => Promise.resolve([]);
  const executionStatusProvider = () => Promise.resolve(undefined);

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

  const executionController = { dispose() {}, handleCommand() {} };
  extension.activate(context, fakeVscode, {
    clientsMap,
    createExecutionController(options) {
      created.executionOptions = options;
      return executionController;
    },
    executionStatusProvider,
    GaugeTestController: FakeGaugeTestController,
    projectFactory,
    scenariosProvider,
  });

  assert.equal(created.testController.options.vscode, fakeVscode);
  assert.equal(created.testController.options.clientsMap, clientsMap);
  assert.equal(created.testController.options.projectFactory, projectFactory);
  assert.equal(created.executionOptions.executionEventSink, sink);
  assert.equal(created.executionOptions.executionStatusProvider, executionStatusProvider);
  assert.equal(created.executionOptions.ownsExecutionStatusProvider, false);
  assert.equal(created.executionOptions.ownsScenariosProvider, false);
  assert.equal(created.executionOptions.projectFactory, projectFactory);
  assert.equal(created.executionOptions.scenariosProvider, scenariosProvider);
  assert.equal(created.testController.executionController, executionController);
  assert.equal(context.subscriptions.includes(created.testController.disposable), true);
  assert.equal(context.subscriptions.includes(executionController), true);
});

test("activation starts Gauge workspace services for Gauge projects", async () => {
  const extension = require("../src/extension");

  const created = {};
  const workspaceDisposalGate = deferred();
  const checkedProjects = [];
  const versions = [];
  const welcomeCalls = [];
  const executionController = { handleCommand() {} };
  const context = { subscriptions: [] };
  const {
    contexts,
    codeActionProviders,
    codeLensProviders,
    completionProviders,
    configurationListeners,
    debugProviders,
    definitionProviders,
    editorUpdates,
    fakeVscode,
    foldingRangeProviders,
    languageConfigurations,
    renameProviders,
    registeredCommands,
    semanticTokenProviders,
    textDocumentListeners,
  } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
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
      this.disposeCalls = 0;
      this.disposalPromise = undefined;
      created.workspace = this;
    }

    onDidChangeProjects(listener) {
      this.projectListener = listener;
      this.projectListenerDisposable = { dispose() {} };
      return this.projectListenerDisposable;
    }

    ready() {
      return Promise.resolve();
    }

    dispose() {
      if (!this.disposalPromise) {
        this.disposeCalls += 1;
        this.reentrantDeactivation = extension.deactivate();
        this.disposalPromise = workspaceDisposalGate.promise;
      }
      return this.disposalPromise;
    }
  }

  class FakeGaugeTestController {
    constructor(options) {
      this.options = options;
      this.disposable = { dispose() {} };
      this.discoveries = 0;
      this.refreshes = 0;
      created.testController = this;
    }

    refreshWorkspaceTests() {
      this.refreshes += 1;
      return Promise.resolve([]);
    }

    discoverWorkspaceTests() {
      this.discoveries += 1;
      return Promise.resolve([]);
    }

    register() {
      return this.disposable;
    }

    registerProjectChangeListener(projectChanges) {
      this.projectChanges = projectChanges;
      return projectChanges.onDidChangeProjects(() => this.refreshWorkspaceTests());
    }

    setExecutionController(executionController) {
      this.executionController = executionController;
    }
  }

  class FakeReferenceProvider {
    constructor(clients, options) {
      this.clients = clients;
      this.options = options;
      created.referenceProvider = this;
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

  class FakeStepCodeActionProvider {
    constructor(options) {
      this.options = options;
      created.stepCodeActionProvider = this;
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

  class FakeUnusedReferenceDiagnosticsProvider {
    constructor(options) {
      this.options = options;
      this.disposable = { dispose() {} };
      created.unusedReferenceDiagnosticsProvider = this;
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

  class FakeDependencyStepIndex {
    constructor(options) {
      this.options = options;
      this.disposable = { dispose() {} };
      created.dependencyStepIndex = this;
    }

    register() {
      return this.disposable;
    }
  }

  class FakeProjectEnvironmentService {
    constructor(options) {
      this.options = options;
      this.disposeCalls = 0;
      created.projectEnvironmentService = this;
    }

    dispose() {
      this.disposeCalls += 1;
    }
  }

  class FakeWorkspaceStepIndex {
    constructor(options) {
      this.options = options;
      this.diagnosticsProvider = options.diagnosticsProvider;
      this.disposeCalls = 0;
      this.startCalls = 0;
      created.workspaceStepIndex = this;
    }

    dispose() {
      this.disposeCalls += 1;
    }

    start() {
      this.startCalls += 1;
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
    DependencyStepIndex: FakeDependencyStepIndex,
    ProjectEnvironmentService: FakeProjectEnvironmentService,
    WorkspaceStepIndex: FakeWorkspaceStepIndex,
    GaugeState: FakeGaugeState,
    GaugeWorkspace: FakeGaugeWorkspace,
    GaugeTestController: FakeGaugeTestController,
    ExtractConceptCommandProvider: FakeExtractConceptCommandProvider,
    GenerateStubCommandProvider: FakeGenerateStubCommandProvider,
    SpecNodeProvider: FakeSpecNodeProvider,
    GaugeSemanticTokensProvider: FakeSemanticTokensProvider,
    GaugeFoldingRangeProvider: FakeFoldingRangeProvider,
    GaugeRenameProvider: FakeRenameProvider,
    GaugeArgumentCodeActionProvider: FakeArgumentCodeActionProvider,
    GaugeStepCodeActionProvider: FakeStepCodeActionProvider,
    GaugeStepDiagnosticsProvider: FakeStepDiagnosticsProvider,
    GaugeUnusedReferenceDiagnosticsProvider: FakeUnusedReferenceDiagnosticsProvider,
    GaugeValidateDiagnosticsProvider: FakeValidateDiagnosticsProvider,
    ProjectInitializer: FakeProjectInitializer,
    ReferenceProvider: FakeReferenceProvider,
    semanticTokensLegend: { id: "legend" },
    showWelcomeNotification(receivedContext, receivedVscode) {
      welcomeCalls.push({ context: receivedContext, vscode: receivedVscode });
    },
    projectFactory: {
      isGaugeProject(folder) {
        checkedProjects.push(["is", folder]);
        return false;
      },
      findGaugeProjectRoots(folder) {
        checkedProjects.push(["find", folder]);
        return ["/workspace/gauge"];
      },
    },
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(checkedProjects, [
    ["is", "/workspace"],
    ["find", "/workspace"],
  ]);
  assert.equal(created.cliOptions.vscode, fakeVscode);
  assert.deepEqual(versions, ["0.9.6"]);
  assert.deepEqual(welcomeCalls, [{ context, vscode: fakeVscode }]);
  assert.equal(created.executionOptions.state, created.state);
  assert.equal(typeof created.executionOptions.scenariosProvider, "function");
  assert.equal(typeof created.executionOptions.executionStatusProvider, "function");
  assert.equal(created.executionOptions.ownsScenariosProvider, true);
  assert.equal(created.executionOptions.ownsExecutionStatusProvider, true);
  assert.equal(created.workspace.options.cli, cli);
  assert.equal(created.workspace.options.clientsMap, created.clientsMap);
  assert.equal(created.workspace.options.state, created.state);
  assert.equal(created.state.context, context);
  assert.equal(created.workspace.options.vscode, fakeVscode);
  assert.equal(created.dependencyStepIndex.options.cli, cli);
  assert.equal(
    created.dependencyStepIndex.options.projectEnvironmentService,
    created.projectEnvironmentService,
  );
  assert.equal(created.executionOptions.projectEnvironmentService, created.projectEnvironmentService);
  assert.equal(created.workspace.options.projectEnvironmentService, created.projectEnvironmentService);
  assert.equal(created.validateDiagnosticsProvider, undefined);
  assert.equal(context.subscriptions.includes(created.projectEnvironmentService), true);
  assert.equal(
    created.dependencyStepIndex.options.projectFactory,
    created.workspace.options.projectFactory,
  );
  assert.equal(
    created.workspace.options.dependencyStepIndex,
    created.dependencyStepIndex,
  );
  assert.equal(
    created.stepDiagnosticsProvider.options.dependencyStepIndex,
    created.dependencyStepIndex,
  );
  assert.equal(context.subscriptions.includes(created.dependencyStepIndex.disposable), true);
  assert.equal(created.argumentCodeActionProvider.options.projectFactory, created.workspace.options.projectFactory);
  assert.equal(created.referenceProvider.clients, created.clientsMap);
  assert.equal(created.referenceProvider.options.vscode, fakeVscode);
  assert.equal(created.referenceProvider.options.projectFactory, created.workspace.options.projectFactory);
  assert.equal(
    created.referenceProvider.options.dependencyStepIndex,
    created.dependencyStepIndex,
  );
  assert.equal(created.workspaceStepIndex.startCalls, 1);
  assert.equal(created.workspaceStepIndex.diagnosticsProvider, created.stepDiagnosticsProvider);
  assert.equal(
    created.unusedReferenceDiagnosticsProvider.options.documentStore,
    created.workspaceStepIndex.options.documentStore,
  );
  assert.equal(
    created.unusedReferenceDiagnosticsProvider.options.workspaceStepIndex,
    created.workspaceStepIndex,
  );
  assert.equal(created.unusedReferenceDiagnosticsProvider.options.vscode, fakeVscode);
  assert.equal(completionProviders[0].provider.diagnosticsProvider, created.stepDiagnosticsProvider);
  assert.equal(codeLensProviders[0].provider.diagnosticsProvider, created.stepDiagnosticsProvider);
  assert.equal(definitionProviders[0].provider.diagnosticsProvider, created.stepDiagnosticsProvider);
  assert.equal(completionProviders[0].provider.workspaceStepIndex, created.workspaceStepIndex);
  assert.equal(codeLensProviders[0].provider.workspaceStepIndex, created.workspaceStepIndex);
  assert.equal(definitionProviders[0].provider.workspaceStepIndex, created.workspaceStepIndex);
  assert.equal(created.referenceProvider.options.workspaceStepIndex, created.workspaceStepIndex);
  assert.equal(context.subscriptions.includes(created.workspaceStepIndex), true);
  assert.equal(created.extractConceptProvider.clients, created.clientsMap);
  assert.equal(created.extractConceptProvider.options.vscode, fakeVscode);
  assert.equal(created.generateStubProvider.clients, created.clientsMap);
  assert.equal(created.generateStubProvider.options.vscode, fakeVscode);
  assert.equal(created.specNodeProvider.workspace, created.workspace);
  assert.equal(created.specNodeProvider.options.vscode, fakeVscode);
  assert.equal(created.specNodeProvider.options.executionController, executionController);
  assert.equal(created.projectInitializer.options.vscode, fakeVscode);
  assert.equal(created.testController.options.vscode, fakeVscode);
  assert.equal(created.testController.options.clientsMap, created.clientsMap);
  assert.equal(created.testController.executionController, executionController);
  assert.equal(created.testController.discoveries, 1);
  assert.equal(typeof created.workspace.projectListener, "function");
  assert.equal(context.subscriptions.includes(created.workspace.projectListenerDisposable), true);
  created.workspace.projectListener();
  assert.equal(created.testController.refreshes, 1);
  assert.equal(context.subscriptions.includes(created.workspace), true);
  assert.equal(context.subscriptions.includes(created.referenceProvider), true);
  assert.equal(context.subscriptions.includes(created.extractConceptProvider), true);
  assert.equal(context.subscriptions.includes(created.generateStubProvider), true);
  assert.equal(context.subscriptions.includes(created.specNodeProvider), true);
  assert.equal(context.subscriptions.includes(created.projectInitializer), true);
  assert.equal(context.subscriptions.includes(codeActionProviders[0].disposable), true);
  assert.equal(context.subscriptions.includes(codeActionProviders[1].disposable), true);
  assert.equal(context.subscriptions.includes(debugProviders[0].disposable), true);
  assert.equal(context.subscriptions.includes(foldingRangeProviders[0].disposable), true);
  assert.equal(context.subscriptions.includes(renameProviders[0].disposable), true);
  assert.equal(context.subscriptions.includes(created.stepDiagnosticsProvider.disposable), true);
  assert.equal(
    context.subscriptions.includes(created.unusedReferenceDiagnosticsProvider.disposable),
    true,
  );
  assert.equal(context.subscriptions.includes(semanticTokenProviders[0].disposable), true);
  const deactivation = extension.deactivate();
  const repeatedDeactivation = extension.deactivate();
  let deactivationSettled = false;
  deactivation.then(() => {
    deactivationSettled = true;
  });
  await Promise.resolve();
  const workspaceDisposalsAtDeactivation = created.workspace.disposeCalls;
  const deactivationWasPending = !deactivationSettled;
  for (const subscription of context.subscriptions) {
    if (subscription && typeof subscription.dispose === "function") {
      subscription.dispose();
    }
  }
  workspaceDisposalGate.resolve();
  await Promise.all([deactivation, repeatedDeactivation]);
  assert.equal(workspaceDisposalsAtDeactivation, 1);
  assert.equal(deactivationWasPending, true);
  assert.equal(created.workspace.disposeCalls, 1);
  assert.equal(created.workspace.reentrantDeactivation, deactivation);
  assert.equal(repeatedDeactivation, deactivation);
  assert.equal(created.workspaceStepIndex.disposeCalls, 1);
  assert.equal(created.projectEnvironmentService.disposeCalls, 1);
  assert.equal(
    textDocumentListeners.every((entry) => entry.disposable.disposeCalls > 0),
    true,
    "every text document listener must be disposed through the subscriptions",
  );
  assert.equal(debugProviders[0].type, "gauge");
  assert.throws(
    () => debugProviders[0].provider.resolveDebugConfiguration(),
    /Starting with the Gauge debug configuration is not supported/,
  );
  assert.deepEqual(contexts, []);
  assert.deepEqual(
    languageConfigurations.map((entry) => entry.language),
    ["gauge", "gauge-concept"],
  );
  assert.deepEqual(semanticTokenProviders, [
    {
      selector: [
        { language: "gauge" },
        { language: "gauge-concept" },
        { scheme: "file", pattern: "**/*.spec" },
        { language: "markdown", scheme: "file", pattern: "**/*.md" },
        { scheme: "file", pattern: "**/*.cpt" },
      ],
      provider: created.semanticTokensProvider,
      legend: { id: "legend" },
      disposable: semanticTokenProviders[0].disposable,
    },
  ]);
  assert.equal(typeof textDocumentListeners[0].listener, "function");
  assert.equal(created.semanticTokensProvider.options.vscode, fakeVscode);
  assert.deepEqual(foldingRangeProviders, [
    {
      selector: [
        { language: "gauge" },
        { language: "gauge-concept" },
        { scheme: "file", pattern: "**/*.spec" },
        { language: "markdown", scheme: "file", pattern: "**/*.md" },
        { scheme: "file", pattern: "**/*.cpt" },
      ],
      provider: created.foldingRangeProvider,
      disposable: foldingRangeProviders[0].disposable,
    },
  ]);
  assert.equal(created.foldingRangeProvider.options.vscode, fakeVscode);
  assert.equal(created.foldingRangeProvider.options.projectFactory, created.workspace.options.projectFactory);
  assert.deepEqual(renameProviders, [
    {
      selector: [
        { language: "gauge" },
        { language: "gauge-concept" },
        { scheme: "file", pattern: "**/*.spec" },
        { scheme: "file", pattern: "**/*.cpt" },
        { language: "markdown", scheme: "file", pattern: "**/*.md" },
        { language: "kotlin" },
        { scheme: "file", pattern: "**/*.kt" },
        { language: "java" },
        { scheme: "file", pattern: "**/*.java" },
      ],
      provider: created.renameProvider,
      disposable: renameProviders[0].disposable,
    },
  ]);
  assert.equal(created.renameProvider.options.vscode, fakeVscode);
  assert.equal(created.renameProvider.options.clientsMap, created.clientsMap);
  assert.equal(created.renameProvider.options.cli, cli);
  assert.equal(created.renameProvider.options.projectFactory, created.workspace.options.projectFactory);
  assert.deepEqual(codeActionProviders, [
    {
      selector: [
        { language: "gauge" },
        { language: "gauge-concept" },
        { scheme: "file", pattern: "**/*.spec" },
        { language: "markdown", scheme: "file", pattern: "**/*.md" },
        { scheme: "file", pattern: "**/*.cpt" },
      ],
      provider: created.argumentCodeActionProvider,
      disposable: codeActionProviders[0].disposable,
    },
    {
      selector: [
        { language: "gauge" },
        { language: "gauge-concept" },
        { scheme: "file", pattern: "**/*.spec" },
        { language: "markdown", scheme: "file", pattern: "**/*.md" },
        { scheme: "file", pattern: "**/*.cpt" },
      ],
      provider: created.stepCodeActionProvider,
      disposable: codeActionProviders[1].disposable,
    },
  ]);
  assert.equal(created.argumentCodeActionProvider.options.vscode, fakeVscode);
  assert.equal(created.stepCodeActionProvider.options.vscode, fakeVscode);
  assert.equal(created.stepDiagnosticsProvider.options.vscode, fakeVscode);
  assert.equal(created.stepDiagnosticsProvider.options.projectFactory, created.workspace.options.projectFactory);
  assert.equal(context.subscriptions.includes(configurationListeners[0].disposable), true);
  assert.deepEqual(editorUpdates[0], {
    key: "semanticTokenColorCustomizations",
    value: {
      rules: {
        argument: { foreground: "#ae81ff" },
        dynamicArgument: { foreground: "#ae81ff" },
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
        // The teardown separator is a comment line to Gauge
        // (references/gauge-vscode/src/semanticTokensProvider.ts colours it
        // through gaugeComment), so it follows the same setting rather than
        // rendering unthemed.
        teardownIdentifier: { foreground: "#cccccc" },
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

  // Two: the dynamic argument provider, and the Gauge snippet provider that
  // replaces the global `markdown` snippets contribution.
  assert.equal(completionProviders.length, 2);
  assert.deepEqual(completionProviders[0].selector, [
    { language: "gauge" },
    { language: "gauge-concept" },
    { scheme: "file", pattern: "**/*.spec" },
    { language: "markdown", scheme: "file", pattern: "**/*.md" },
    { scheme: "file", pattern: "**/*.cpt" },
  ]);
  assert.deepEqual(completionProviders[1].selector, [
    { language: "gauge" },
    { language: "gauge-concept" },
    { scheme: "file", pattern: "**/*.spec" },
    { scheme: "file", pattern: "**/*.cpt" },
    { language: "markdown", scheme: "file", pattern: "**/*.md" },
  ]);
  assert.deepEqual(completionProviders[0].triggerCharacters, ["*", " ", "<", "\"", ":", ","]);
  assert.equal(completionProviders[0].provider.options.vscode, fakeVscode);
  assert.equal(typeof completionProviders[0].provider.options.clientsMap.get, "function");
  assert.equal(typeof completionProviders[0].provider.options.projectFactory.isGaugeProject, "function");
  assert.equal(context.subscriptions.includes(completionProviders[0].disposable), true);
});

test("activation owns one lifecycle-aware dynamic completion provider", () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const { completionProviders, fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });
  let completionProvider;

  class FakeDynamicArgumentCompletionProvider {
    constructor() {
      this.disposeCalls = 0;
      this.registerCalls = 0;
      completionProvider = this;
    }

    dispose() {
      this.disposeCalls += 1;
    }

    register() {
      this.registerCalls += 1;
      return this;
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

  assert.ok(completionProvider);
  assert.equal(completionProvider.registerCalls, 1);
  assert.equal(context.subscriptions.includes(completionProvider), true);
  // Only the Gauge snippet provider registers directly; the dynamic argument
  // provider owns its own registration through register().
  assert.equal(completionProviders.length, 1);
  completionProvider.dispose();
  assert.equal(completionProvider.disposeCalls, 1);
});

test("activation owns one lifecycle-aware local CodeLens provider", () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const { codeLensProviders, fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });
  let codeLensProvider;

  class FakeCodeLensProvider {
    constructor(options) {
      this.options = options;
      this.disposeCalls = 0;
      this.registerCalls = 0;
      codeLensProvider = this;
    }

    dispose() {
      this.disposeCalls += 1;
    }

    register() {
      this.registerCalls += 1;
      return this;
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

  assert.equal(codeLensProviders.length, 0);
  assert.equal(codeLensProvider.registerCalls, 1);
  assert.equal(codeLensProvider.options.vscode, fakeVscode);
  assert.equal(typeof codeLensProvider.options.projectFactory.isGaugeProject, "function");
  assert.equal(context.subscriptions.includes(codeLensProvider), true);
  codeLensProvider.dispose();
  assert.equal(codeLensProvider.disposeCalls, 1);
});

test("activation leaves Gauge document formatting to the Gauge language client", () => {
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

  let constructedFormatProviders = 0;
  let gaugeWorkspaces = 0;

  extension.activate(context, fakeVscode, {
    createCli() {
      return cli;
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    GaugeWorkspace: class FakeGaugeWorkspace {
      constructor() {
        gaugeWorkspaces += 1;
      }

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
    GaugeFormatProvider: class FakeFormatProvider {
      constructor() {
        constructedFormatProviders += 1;
      }
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

  assert.equal(formattingProviders.length, 0);
  assert.equal(constructedFormatProviders, 0);
  assert.equal(gaugeWorkspaces, 1);
});

test("activation leaves document symbols to Gauge LSP and registers concept workspace symbols", () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const { documentSymbolProviders, fakeVscode, workspaceSymbolProviders } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });

  class FakeDocumentSymbolProvider {
    constructor(options) {
      this.options = options;
    }

    dispose() {}
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
    GaugeDocumentSymbolProvider: FakeDocumentSymbolProvider,
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

  assert.equal(documentSymbolProviders.length, 0);
  assert.equal(workspaceSymbolProviders.length, 1);
  assert.equal(workspaceSymbolProviders[0].provider.options.vscode, fakeVscode);
  assert.equal(typeof workspaceSymbolProviders[0].provider.options.projectFactory.isGaugeProject, "function");
  assert.equal(context.subscriptions.includes(workspaceSymbolProviders[0].disposable), true);
  assert.equal(context.subscriptions.includes(workspaceSymbolProviders[0].provider), true);
});

test("activation keeps local Gauge definitions independent from the language client", () => {
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
  assert.deepEqual(definitionProviders[0].selector, [
    { language: "gauge" },
    { language: "gauge-concept" },
    { scheme: "file", pattern: "**/*.spec" },
    { scheme: "file", pattern: "**/*.cpt" },
    { language: "markdown", scheme: "file", pattern: "**/*.md" },
  ]);
  assert.equal(definitionProviders[0].provider.options.projectFactory, projectFactory);
  assert.ok(definitionProviders[0].provider.options.dependencyStepIndex);
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

test("activation ignores active Kotlin implementation documents when project root is unresolved", () => {
  const extension = require("../src/extension");

  let createCliCalls = 0;
  let createdWorkspace = false;
  const context = { subscriptions: [] };
  const { debugProviders, fakeVscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "kotlin",
        uri: { fsPath: "/workspace/notes/src/test/kotlin/Steps.kt" },
      },
    },
    workspaceFolders: [],
  });

  extension.activate(context, fakeVscode, {
    createCli() {
      createCliCalls += 1;
      throw new Error("createCli should not be called");
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    GaugeWorkspace: class FakeGaugeWorkspace {
      constructor() {
        createdWorkspace = true;
      }
    },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/src/test/kotlin/Steps.kt");
        return undefined;
      },
      isGaugeProject() {
        throw new Error("isGaugeProject should not be called");
      },
    },
    showWelcomeNotification() {},
  });

  assert.equal(createCliCalls, 0);
  assert.equal(createdWorkspace, false);
  assert.deepEqual(debugProviders, []);
});

test("activation starts Gauge workspace services for an active Java implementation document", () => {
  const extension = require("../src/extension");

  const created = {};
  const checkedFiles = [];
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "java",
        uri: { fsPath: "/workspace/gauge/src/test/java/Steps.java" },
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

  assert.deepEqual(checkedFiles, ["/workspace/gauge/src/test/java/Steps.java"]);
  assert.equal(created.workspace.options.clientsMap, created.clientsMap);
  assert.equal(created.workspace.options.vscode, fakeVscode);
  assert.equal(context.subscriptions.includes(created.workspace), true);
});

test("activation starts Gauge workspace services for an active concept file by extension", () => {
  const extension = require("../src/extension");

  const created = {};
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "plaintext",
        uri: { fsPath: "/workspace/gauge/specs/concepts/shared.cpt" },
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
      getGaugeRootFromFilePath(filePath) {
        assert.equal(filePath, "/workspace/gauge/specs/concepts/shared.cpt");
        return "/workspace/gauge";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/gauge");
        return true;
      },
    },
    showWelcomeNotification() {},
  });

  assert.equal(created.workspace.options.clientsMap, created.clientsMap);
  assert.equal(created.workspace.options.vscode, fakeVscode);
  assert.equal(context.subscriptions.includes(created.workspace), true);
});

test("activation starts Gauge workspace services for an active gauge-concept document", () => {
  const extension = require("../src/extension");

  const created = {};
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "gauge-concept",
        uri: { fsPath: "/workspace/gauge/specs/concepts/shared" },
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
      getGaugeRootFromFilePath() {
        throw new Error("explicit Gauge concept documents should not require project lookup");
      },
      isGaugeProject() {
        return false;
      },
    },
    showWelcomeNotification() {},
  });

  assert.equal(created.workspace.options.clientsMap, created.clientsMap);
  assert.equal(created.workspace.options.vscode, fakeVscode);
  assert.equal(context.subscriptions.includes(created.workspace), true);
});

test("activation shows install guidance when Gauge is unavailable", () => {
  const extension = require("../src/extension");

  const created = {};
  const installCalls = [];
  const context = { subscriptions: [] };
  const {
    codeActionProviders,
    fakeVscode,
    registeredCommands,
  } = createFakeVscode({
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

  class FakeArgumentCodeActionProvider {
    constructor(options) {
      this.options = options;
      created.argumentCodeActionProvider = this;
    }
  }

  class FakeStepCodeActionProvider {
    constructor(options) {
      this.options = options;
      created.stepCodeActionProvider = this;
    }
  }

  const projectFactory = {
    isGaugeProject() {
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
    GaugeArgumentCodeActionProvider: FakeArgumentCodeActionProvider,
    GaugeStepCodeActionProvider: FakeStepCodeActionProvider,
    projectFactory,
    showInstallGaugeNotification(vscode) {
      installCalls.push(vscode);
    },
  });

  assert.deepEqual(installCalls, [fakeVscode]);
  assert.deepEqual(codeActionProviders, [
    {
      selector: [
        { language: "gauge" },
        { language: "gauge-concept" },
        { scheme: "file", pattern: "**/*.spec" },
        { language: "markdown", scheme: "file", pattern: "**/*.md" },
        { scheme: "file", pattern: "**/*.cpt" },
      ],
      provider: created.argumentCodeActionProvider,
      disposable: codeActionProviders[0].disposable,
    },
    {
      selector: [
        { language: "gauge" },
        { language: "gauge-concept" },
        { scheme: "file", pattern: "**/*.spec" },
        { language: "markdown", scheme: "file", pattern: "**/*.md" },
        { scheme: "file", pattern: "**/*.cpt" },
      ],
      provider: created.stepCodeActionProvider,
      disposable: codeActionProviders[1].disposable,
    },
  ]);
  assert.equal(created.argumentCodeActionProvider.options.vscode, fakeVscode);
  assert.equal(created.argumentCodeActionProvider.options.projectFactory, projectFactory);
  assert.equal(created.stepCodeActionProvider.options.vscode, fakeVscode);
  assert.ok(registeredCommands.some((entry) => entry.command === "gauge.selectArgumentRange"));
  assert.equal(context.subscriptions.includes(codeActionProviders[0].disposable), true);
  assert.equal(context.subscriptions.includes(codeActionProviders[1].disposable), true);
});

// A Gauge manifest always names the runner language: it is what Gauge resolves a
// runner with (references/gauge/manifest/manifest.go Manifest.Language), and a
// project without one cannot run at all. The activation event is
// workspaceContains:manifest.json, so a Chrome extension, a PWA or any other
// project with an unrelated manifest.json at its root started the whole Gauge
// service stack, including the "gauge daemon --lsp" launch and the Gauge Specs
// view. src/project/manifest.js already carried hasGaugeLanguage for this and
// nothing called it.
test("activation does not start Gauge services for an unrelated manifest.json", () => {
  const extension = require("../src/extension");

  let workspaceCreated = false;
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/web-app" } }],
  });
  const fileSystem = {
    existsSync(filename) {
      return filename === "/workspace/web-app/manifest.json";
    },
    readFileSync() {
      return JSON.stringify({ manifest_version: 3, name: "Web App" });
    },
  };
  class FakeGaugeWorkspace {
    constructor() {
      workspaceCreated = true;
    }

    dispose() {}
  }

  extension.activate(context, fakeVscode, {
    createCli() {
      return {
        isGaugeInstalled: () => true,
        isGaugeVersionGreaterOrEqual: () => true,
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    fileSystem,
    GaugeWorkspace: FakeGaugeWorkspace,
    showWelcomeNotification() {},
  });

  assert.equal(workspaceCreated, false);
});

// package.json activates on onLanguage:kotlin and onLanguage:java, so the
// extension is already running in any Kotlin project. The gate then declines and
// was never re-evaluated, so "gauge init" in that same folder brought up nothing
// at all - no diagnostics, no CodeLens, no Test Explorer - until the user
// reloaded the window, with no hint that a reload was what was missing.
test("activation starts Gauge services when a manifest appears later", async () => {
  const extension = require("../src/extension");

  let workspaceCreated = 0;
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/app" } }],
  });
  const createListeners = [];
  fakeVscode.workspace.createFileSystemWatcher = () => ({
    dispose() {},
    onDidCreate(listener) {
      createListeners.push(listener);
      return { dispose() {} };
    },
    onDidChange: () => ({ dispose() {} }),
    onDidDelete: () => ({ dispose() {} }),
  });
  let hasManifest = false;
  const fileSystem = {
    existsSync: (filename) => hasManifest && filename === "/workspace/app/manifest.json",
    readFileSync: () => JSON.stringify({ Language: "java", Plugins: [] }),
  };

  extension.activate(context, fakeVscode, {
    createCli() {
      return {
        isGaugeInstalled: () => true,
        isGaugeVersionGreaterOrEqual: () => true,
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    fileSystem,
    GaugeWorkspace: class GaugeWorkspace {
      constructor() {
        workspaceCreated += 1;
      }

      dispose() {}
    },
    pathModule: path.posix,
    semanticTokensLegend: { id: "legend" },
    showWelcomeNotification() {},
    SpecNodeProvider: class SpecNodeProvider {
      dispose() {}
    },
  });

  // The gate's nested-project probe is asynchronous, so the retry watcher is
  // registered a tick later.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(workspaceCreated, 0);
  assert.ok(createListeners.length > 0);

  hasManifest = true;
  for (const listener of createListeners) {
    listener({ fsPath: "/workspace/app/manifest.json" });
  }

  assert.equal(workspaceCreated, 1);
});

// The nested discovery path has the same exposure: a monorepo whose only
// manifest.json belongs to a web app must not start the Gauge service stack.
test("activation does not start Gauge services for a nested unrelated manifest.json", async () => {
  const extension = require("../src/extension");

  let workspaceCreated = false;
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  });
  const fileSystem = {
    existsSync(filename) {
      return filename === "/workspace/web-app/manifest.json";
    },
    readFileSync() {
      return JSON.stringify({ manifest_version: 3, name: "Web App" });
    },
  };
  class FakeGaugeWorkspace {
    constructor() {
      workspaceCreated = true;
    }

    dispose() {}
  }

  extension.activate(context, fakeVscode, {
    createCli() {
      return {
        isGaugeInstalled: () => true,
        isGaugeVersionGreaterOrEqual: () => true,
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    fileSystem,
    GaugeWorkspace: FakeGaugeWorkspace,
    projectFactory: {
      findGaugeProjectRoots: () => ["/workspace/web-app"],
      hasGaugeRunnerLanguage: () => false,
      isGaugeProject: (root) => root === "/workspace/web-app",
      isGaugeRunnableProject: () => false,
    },
    showWelcomeNotification() {},
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(workspaceCreated, false);
});

// The execution status guard only works if the provider can see the file system,
// so prove the wiring: without it the guard defaults to permissive and the
// daemon-killing request goes out anyway.
test("activation gives the execution status provider a file system to check", () => {
  const extension = require("../src/extension");

  const checked = [];
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });
  const fileSystem = {
    existsSync(filename) {
      checked.push(filename);
      return filename === "/workspace/gauge/manifest.json";
    },
    readFileSync() {
      return JSON.stringify({ Language: "java", Plugins: [] });
    },
  };
  let capturedController;

  extension.activate(context, fakeVscode, {
    createCli() {
      return {
        isGaugeInstalled: () => true,
        isGaugeVersionGreaterOrEqual: () => true,
      };
    },
    createExecutionController(controllerOptions) {
      capturedController = controllerOptions;
      return { handleCommand() {} };
    },
    fileSystem,
    GaugeWorkspace: class GaugeWorkspace {
      dispose() {}
    },
    pathModule: path.posix,
    semanticTokensLegend: { id: "legend" },
    showWelcomeNotification() {},
    SpecNodeProvider: class SpecNodeProvider {
      dispose() {}
    },
  });

  assert.equal(typeof capturedController.executionStatusProvider, "function");
  checked.length = 0;
  capturedController.executionStatusProvider("/workspace/gauge");

  assert.deepEqual(checked, ["/workspace/gauge/.gauge/executionStatus.json"]);
});

// The factory it creates owns a manifest FileSystemWatcher. Without pushing it
// into context.subscriptions, deactivate() left one watcher and three listeners
// behind per activation cycle.
test("activation disposes the project factory it created", () => {
  const extension = require("../src/extension");

  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });
  const created = [];
  const disposals = [];
  fakeVscode.workspace.createFileSystemWatcher = (glob) => {
    created.push(glob);
    return {
      dispose() {
        disposals.push(glob);
      },
      onDidCreate: () => ({ dispose() {} }),
      onDidChange: () => ({ dispose() {} }),
      onDidDelete: () => ({ dispose() {} }),
    };
  };
  const fileSystem = {
    existsSync: (filename) => filename === "/workspace/gauge/manifest.json",
    readFileSync: () => JSON.stringify({ Language: "java", Plugins: [] }),
  };

  extension.activate(context, fakeVscode, {
    createCli() {
      return {
        isGaugeInstalled: () => true,
        isGaugeVersionGreaterOrEqual: () => true,
      };
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    fileSystem,
    GaugeWorkspace: class GaugeWorkspace {
      dispose() {}
    },
    pathModule: path.posix,
    semanticTokensLegend: { id: "legend" },
    showWelcomeNotification() {},
    SpecNodeProvider: class SpecNodeProvider {
      dispose() {}
    },
  });

  for (const subscription of context.subscriptions) {
    if (subscription && typeof subscription.dispose === "function") {
      subscription.dispose();
    }
  }

  assert.equal(created.includes("**/manifest.json"), true);
  assert.equal(disposals.includes("**/manifest.json"), true);
});

test("activation propagates the default project factory to Gauge providers", () => {
  const extension = require("../src/extension");

  const created = {};
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });
  const fileSystem = {
    existsSync(filename) {
      return filename === "/workspace/gauge/manifest.json";
    },
    readFileSync(filename) {
      assert.equal(filename, "/workspace/gauge/manifest.json");
      return JSON.stringify({ Language: "kotlin", Plugins: [] });
    },
  };
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    isGaugeVersionGreaterOrEqual() {
      return true;
    },
  };
  class FakeGaugeClients extends Map {}
  class FakeGaugeWorkspace {
    constructor(options) {
      this.options = options;
      created.workspace = this;
    }

    dispose() {}
  }
  class FakeGaugeTestController {
    constructor(options) {
      this.options = options;
      this.disposable = { dispose() {} };
      created.testController = this;
    }

    register() {
      return this.disposable;
    }

    setExecutionController(executionController) {
      this.executionController = executionController;
    }
  }
  class FakeProvider {
    constructor(options) {
      this.options = options;
    }

    dispose() {}
  }
  class FakeArgumentCodeActionProvider extends FakeProvider {
    constructor(options) {
      super(options);
      created.argumentCodeActionProvider = this;
    }
  }
  class FakeStepCodeActionProvider extends FakeProvider {
    constructor(options) {
      super(options);
      created.stepCodeActionProvider = this;
    }
  }
  class FakeFoldingRangeProvider extends FakeProvider {
    constructor(options) {
      super(options);
      created.foldingRangeProvider = this;
    }
  }
  class FakeSemanticTokensProvider extends FakeProvider {
    constructor(options) {
      super(options);
      created.semanticTokensProvider = this;
    }
  }

  extension.activate(context, fakeVscode, {
    createCli() {
      return cli;
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    DynamicArgumentCompletionProvider: FakeProvider,
    ExtractConceptCommandProvider: FakeProvider,
    fileSystem,
    GaugeArgumentCodeActionProvider: FakeArgumentCodeActionProvider,
    GaugeClients: FakeGaugeClients,
    GaugeCodeLensProvider: FakeProvider,
    GaugeDocumentSymbolProvider: FakeProvider,
    GaugeFoldingRangeProvider: FakeFoldingRangeProvider,
    GaugeFormatProvider: FakeProvider,
    GaugeRenameProvider: FakeProvider,
    GaugeSemanticTokensProvider: FakeSemanticTokensProvider,
    GaugeState: FakeProvider,
    GaugeStepCodeActionProvider: FakeStepCodeActionProvider,
    GaugeStepDefinitionProvider: FakeProvider,
    GaugeStepDiagnosticsProvider: FakeProvider,
    GaugeTestController: FakeGaugeTestController,
    GaugeValidateDiagnosticsProvider: FakeProvider,
    GaugeWorkspace: FakeGaugeWorkspace,
    GenerateStubCommandProvider: FakeProvider,
    ProjectInitializer: FakeProvider,
    ReferenceProvider: FakeProvider,
    semanticTokensLegend: { id: "legend" },
    showWelcomeNotification() {},
    SpecNodeProvider: FakeProvider,
  });

  const defaultProjectFactory = created.workspace.options.projectFactory;
  assert.equal(typeof defaultProjectFactory.isGaugeProject, "function");
  assert.equal(created.testController.options.projectFactory, defaultProjectFactory);
  assert.equal(created.argumentCodeActionProvider.options.projectFactory, defaultProjectFactory);
  assert.equal(created.stepCodeActionProvider.options.projectFactory, defaultProjectFactory);
  assert.equal(created.foldingRangeProvider.options.projectFactory, defaultProjectFactory);
  assert.equal(created.semanticTokensProvider.options.projectFactory, defaultProjectFactory);
});

test("activation shows unsupported Gauge version guidance when Gauge is too old", () => {
  const extension = require("../src/extension");

  const installCalls = [];
  const unsupportedVersionCalls = [];
  let workspaceCreated = false;
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    isGaugeVersionGreaterOrEqual(version) {
      assert.equal(version, "0.9.6");
      return false;
    },
  };

  extension.activate(context, fakeVscode, {
    createCli() {
      return cli;
    },
    createExecutionController() {
      return { handleCommand() {} };
    },
    GaugeWorkspace: class FakeGaugeWorkspace {
      constructor() {
        workspaceCreated = true;
      }
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
    showUnsupportedGaugeVersionNotification(vscode, minimumVersion) {
      unsupportedVersionCalls.push({ vscode, minimumVersion });
    },
  });

  assert.deepEqual(installCalls, []);
  assert.deepEqual(unsupportedVersionCalls, [
    { vscode: fakeVscode, minimumVersion: "0.9.6" },
  ]);
  assert.equal(workspaceCreated, false);
});

test("activation does not wait for Gauge CLI gate notifications", async () => {
  const extension = require("../src/extension");
  const snapshots = [];

  for (const { gate, settlement } of [
    { gate: "missing", settlement: "resolve" },
    { gate: "unsupported", settlement: "reject" },
    { gate: "missing", settlement: "throw" },
    { gate: "unsupported", settlement: "throw" },
  ]) {
    const notification = deferred();
    const notificationError = new Error(`${gate} ${settlement} notification failed`);
    const calls = [];
    let workspaceCreated = false;
    const context = { subscriptions: [] };
    const { fakeVscode } = createFakeVscode({
      workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
    });
    const cli = {
      isGaugeInstalled() {
        return gate !== "missing";
      },
      isGaugeVersionGreaterOrEqual(version) {
        assert.equal(version, "0.9.6");
        return gate !== "unsupported";
      },
    };

    let activation;
    try {
      activation = extension.activate(context, fakeVscode, {
        createCli() {
          return cli;
        },
        createExecutionController() {
          return { handleCommand() {} };
        },
        GaugeWorkspace: class FakeGaugeWorkspace {
          constructor() {
            workspaceCreated = true;
          }
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
          assert.equal(vscode, fakeVscode);
          calls.push({ type: "missing" });
          if (settlement === "throw") {
            throw notificationError;
          }
          return notification.promise;
        },
        showUnsupportedGaugeVersionNotification(vscode, minimumVersion) {
          assert.equal(vscode, fakeVscode);
          calls.push({ minimumVersion, type: "unsupported" });
          if (settlement === "throw") {
            throw notificationError;
          }
          return notification.promise;
        },
      });
    } catch (error) {
      activation = Promise.reject(error);
    }
    let activationSettled = false;
    const activationOutcome = Promise.resolve(activation).then(
      () => {
        activationSettled = true;
        return "fulfilled";
      },
      () => {
        activationSettled = true;
        return "rejected";
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    const snapshot = {
      activationSettled,
      calls: [...calls],
      gate,
      settlement,
      workspaceCreated,
    };

    if (settlement === "reject") {
      notification.reject(notificationError);
    } else {
      notification.resolve(undefined);
    }
    snapshot.activationOutcome = await activationOutcome;
    snapshots.push(snapshot);
    await extension.deactivate();
  }

  assert.deepEqual(snapshots, [
    {
      activationOutcome: "fulfilled",
      activationSettled: true,
      calls: [{ type: "missing" }],
      gate: "missing",
      settlement: "resolve",
      workspaceCreated: false,
    },
    {
      activationOutcome: "fulfilled",
      activationSettled: true,
      calls: [{
        minimumVersion: "0.9.6",
        type: "unsupported",
      }],
      gate: "unsupported",
      settlement: "reject",
      workspaceCreated: false,
    },
    {
      activationOutcome: "fulfilled",
      activationSettled: true,
      calls: [{ type: "missing" }],
      gate: "missing",
      settlement: "throw",
      workspaceCreated: false,
    },
    {
      activationOutcome: "fulfilled",
      activationSettled: true,
      calls: [{
        minimumVersion: "0.9.6",
        type: "unsupported",
      }],
      gate: "unsupported",
      settlement: "throw",
      workspaceCreated: false,
    },
  ]);
});

test("activation owns and observes the welcome notification operation", async () => {
  const extension = require("../src/extension");
  const snapshots = [];

  for (const settlement of ["throw", "reject", "stop-and-throw"]) {
    await extension.deactivate();
    const notificationError = new Error(`${settlement} welcome notification failed`);
    const context = { subscriptions: [] };
    const { fakeVscode } = createFakeVscode({
      workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
    });
    let notificationObservations = 0;
    let workspaceCreations = 0;
    let workspaceDisposals = 0;
    const cli = {
      isGaugeInstalled() {
        return true;
      },
      isGaugeVersionGreaterOrEqual() {
        return true;
      },
    };

    let helperCall;
    let stoppedSignalOutcome = "missing";
    const activationOutcome = await Promise.resolve().then(() => extension.activate(
      context,
      fakeVscode,
      {
        createCli() {
          return cli;
        },
        GaugeWorkspace: class FakeGaugeWorkspace {
          constructor() {
            this.disposed = false;
            workspaceCreations += 1;
          }

          dispose() {
            if (this.disposed) {
              return;
            }
            this.disposed = true;
            workspaceDisposals += 1;
          }
        },
        ProjectInitializer: class FakeProjectInitializer {
          dispose() {}
        },
        projectFactory: {
          getGaugeRootFromFilePath() {
            return "/workspace/gauge";
          },
          isGaugeProject() {
            return true;
          },
        },
        semanticTokensLegend: {},
        showWelcomeNotification(receivedContext, receivedVscode, ownership) {
          if (ownership && ownership.stoppedSignal) {
            stoppedSignalOutcome = "pending";
            Promise.resolve(ownership.stoppedSignal).then(
              () => {
                stoppedSignalOutcome = "fulfilled";
              },
              () => {
                stoppedSignalOutcome = "rejected";
              },
            );
          }
          helperCall = {
            context: receivedContext,
            currentAtCall: ownership && ownership.isCurrent(),
            ownership,
            vscode: receivedVscode,
          };
          if (settlement === "stop-and-throw") {
            extension.deactivate();
          }
          if (settlement !== "reject") {
            throw notificationError;
          }
          return {
            then(_resolve, reject) {
              notificationObservations += 1;
              reject(notificationError);
            },
          };
        },
        SpecNodeProvider: class FakeSpecNodeProvider {
          dispose() {}
        },
      },
    )).then(
      () => "fulfilled",
      () => "rejected",
    );
    await new Promise((resolve) => setImmediate(resolve));

    snapshots.push({
      activationOutcome,
      currentAtCall: helperCall && helperCall.currentAtCall,
      currentAtSnapshot: helperCall && helperCall.ownership.isCurrent(),
      notificationObservations,
      settlement,
      stoppedSignalOutcome,
      workspaceCreations,
    });
    await extension.deactivate();
    for (const subscription of context.subscriptions) {
      if (subscription && typeof subscription.dispose === "function") {
        try {
          subscription.dispose();
        } catch (_error) {
          // Test cleanup continues across unrelated provider disposals.
        }
      }
    }
    assert.equal(workspaceDisposals, workspaceCreations);
  }

  assert.deepEqual(snapshots, [
    {
      activationOutcome: "fulfilled",
      currentAtCall: true,
      currentAtSnapshot: true,
      notificationObservations: 0,
      settlement: "throw",
      stoppedSignalOutcome: "pending",
      workspaceCreations: 1,
    },
    {
      activationOutcome: "fulfilled",
      currentAtCall: true,
      currentAtSnapshot: true,
      notificationObservations: 1,
      settlement: "reject",
      stoppedSignalOutcome: "pending",
      workspaceCreations: 1,
    },
    {
      activationOutcome: "fulfilled",
      currentAtCall: true,
      currentAtSnapshot: false,
      notificationObservations: 0,
      settlement: "stop-and-throw",
      stoppedSignalOutcome: "fulfilled",
      workspaceCreations: 0,
    },
  ]);
});

test("activation shares a single CLI probe across services and execution", () => {
  const extension = require("../src/extension");

  let probes = 0;
  const cli = {
    isGaugeInstalled() {
      return false;
    },
    isGaugeVersionGreaterOrEqual() {
      return true;
    },
  };
  let executionOptions;
  const context = { subscriptions: [] };
  const { fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });

  extension.activate(context, fakeVscode, {
    createCli() {
      probes += 1;
      return cli;
    },
    createExecutionController(options) {
      executionOptions = options;
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
    showInstallGaugeNotification() {},
  });

  assert.equal(probes, 1);
  const executorCli = executionOptions.createCli({ vscode: fakeVscode });
  assert.equal(executorCli, cli);
  assert.equal(probes, 1);
});

test("activation does not save Gauge documents when Enter is typed", () => {
  const extension = require("../src/extension");
  const context = { subscriptions: [] };
  const { fakeVscode, textDocumentListeners } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "gauge",
        uri: { fsPath: "/workspace/specs/example.spec" },
      },
    },
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
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
    GaugeWorkspace: class FakeGaugeWorkspace {
      dispose() {}
    },
    SpecNodeProvider: class FakeSpecNodeProvider {
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

  let saves = 0;
  const document = {
    languageId: "gauge",
    uri: { fsPath: "/workspace/specs/example.spec" },
    getText() {
      return "# Example\n";
    },
    save() {
      saves += 1;
      return Promise.resolve(true);
    },
  };
  for (const listener of textDocumentListeners) {
    if (typeof listener.listener === "function") {
      listener.listener({ contentChanges: [{ text: "\n" }], document });
    }
  }

  assert.equal(saves, 0);
});

test("activation skips the global semantic color write when rules are unchanged", () => {
  const extension = require("../src/extension");
  const context = { subscriptions: [] };
  const { editorUpdates, fakeVscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  });

  const desiredRules = {};
  for (const key of [
    "argument", "stepMarker", "step", "dynamicArgument", "table", "tableHeader",
    "tableHeaderSeparator", "tableBorder", "tableKeyword", "tableFileValue",
    "tagKeyword", "tagValue", "specification", "scenario", "disabledStep",
  ]) {
    desiredRules[key] = { foreground: undefined };
  }
  desiredRules.gaugeComment = { foreground: undefined };
  desiredRules.teardownIdentifier = { foreground: undefined };
  fakeVscode.workspace.getConfiguration = (section) => {
    if (section === "editor") {
      return {
        get(key) {
          if (key === "semanticTokenColorCustomizations") {
            return { rules: desiredRules };
          }
          return undefined;
        },
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
  };

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
    GaugeWorkspace: class FakeGaugeWorkspace {
      dispose() {}
    },
    SpecNodeProvider: class FakeSpecNodeProvider {
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

  assert.deepEqual(editorUpdates, []);
});

// The write replaced the whole editor.semanticTokenColorCustomizations object at
// global scope, so any rule the user had for another language, and any sibling
// key such as "enabled" or a "[theme]" section, was silently discarded on every
// activation.
test("activation preserves unrelated semantic token color customizations", () => {
  const extension = require("../src/extension");
  const context = { subscriptions: [] };
  const existing = {
    enabled: true,
    "[Monokai]": { rules: { "variable.readonly": "#ff0000" } },
    rules: {
      "class.declaration": { foreground: "#123456" },
      step: { foreground: "#000000" },
    },
  };
  const { editorUpdates, fakeVscode } = createFakeVscode({
    semanticTokenColorCustomizations: existing,
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
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
    GaugeWorkspace: class FakeGaugeWorkspace {
      dispose() {}
    },
    SpecNodeProvider: class FakeSpecNodeProvider {
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

  assert.equal(editorUpdates.length, 1);
  const written = editorUpdates[0].value;
  assert.equal(written.enabled, true);
  assert.deepEqual(written["[Monokai]"], { rules: { "variable.readonly": "#ff0000" } });
  assert.deepEqual(written.rules["class.declaration"], { foreground: "#123456" });
  assert.equal(written.rules.step.foreground, "#a6e22e");
});
