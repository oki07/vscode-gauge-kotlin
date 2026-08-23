const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function createFakeFileSystem(entries) {
  const files = new Map(Object.entries(entries));
  const directories = new Set();
  const directoryEntries = new Map();
  function addDirectory(dirname) {
    if (!dirname || directories.has(dirname)) {
      return;
    }
    directories.add(dirname);
    const parent = path.posix.dirname(dirname);
    if (parent && parent !== dirname) {
      addDirectory(parent);
      if (!directoryEntries.has(parent)) {
        directoryEntries.set(parent, new Set());
      }
      directoryEntries.get(parent).add(path.posix.basename(dirname));
    }
  }
  for (const filename of files.keys()) {
    const dirname = path.posix.dirname(filename);
    addDirectory(dirname);
    if (!directoryEntries.has(dirname)) {
      directoryEntries.set(dirname, new Set());
    }
    directoryEntries.get(dirname).add(path.posix.basename(filename));
  }
  return {
    existsSync(filename) {
      return files.has(filename) || directories.has(filename);
    },
    readFileSync(filename) {
      if (!files.has(filename)) {
        throw new Error(`Missing ${filename}`);
      }
      return Buffer.from(files.get(filename));
    },
    readdirSync(dirname) {
      if (!directories.has(dirname)) {
        throw new Error(`Missing directory ${dirname}`);
      }
      return [...(directoryEntries.get(dirname) || [])].sort();
    },
    statSync(filename) {
      if (directories.has(filename)) {
        return { isDirectory: () => true };
      }
      if (files.has(filename)) {
        return { isDirectory: () => false };
      }
      throw new Error(`Missing ${filename}`);
    },
  };
}

function createFakeVscode(overrides = {}) {
  const activeEditorListeners = [];
  const configurationChangeListeners = [];
  const contexts = [];
  const errors = [];
  const infos = [];
  const outputChannels = [];
  const quickPicks = [];
  const warnings = [];
  const workspaceFolderListeners = [];
  const configurations = overrides.configurations || {};
  const workspaceFolders = overrides.workspaceFolders || [
    { uri: { fsPath: "/workspace/gauge" } },
  ];
  return {
    contexts,
    quickPicks,
    vscode: {
      Uri: {
        file(filename) {
          return { fsPath: filename };
        },
      },
      CancellationTokenSource: class CancellationTokenSource {
        constructor() {
          this.token = { cancelled: false };
        }
      },
      commands: {
        executeCommand(command, key, value) {
          contexts.push({ command, key, value });
          return Promise.resolve(undefined);
        },
      },
      window: {
        activeTextEditor: overrides.activeTextEditor,
        createOutputChannel() {
          const channel = { appendLine() {}, clear() {}, name: "gauge", show() {} };
          outputChannels.push(channel);
          return channel;
        },
        onDidChangeActiveTextEditor(listener) {
          activeEditorListeners.push(listener);
          return { dispose() {} };
        },
        showQuickPick(items, options) {
          quickPicks.push({ items, options });
          if (overrides.quickPickError) {
            return Promise.reject(overrides.quickPickError);
          }
          return Promise.resolve(overrides.quickPickSelection || items[0]);
        },
        showWarningMessage(message, ...actions) {
          warnings.push({ message, actions });
          return Promise.resolve(overrides.warningSelection || actions[0]);
        },
        // showErrorMessage(message, options?, ...items) - anything that is
        // neither a string nor a MessageItem is read as options, so an Error
        // contributes nothing the user can see.
        showErrorMessage(message, ...rest) {
          const items = rest.filter((entry) => (
            typeof entry === "string" || (entry && typeof entry.title === "string")
          ));
          const options = rest.find((entry) => (
            entry && typeof entry === "object" && typeof entry.title !== "string"
          ));
          errors.push({ message, actions: items, detail: options && options.detail });
          return Promise.resolve(undefined);
        },
        showInformationMessage(message, ...actions) {
          infos.push({ message, actions });
          return Promise.resolve(undefined);
        },
      },
      workspace: {
        textDocuments: overrides.textDocuments || [],
        workspaceFolders,
        getWorkspaceFolder(uri) {
          return workspaceFolders.find((folder) => folder.uri.fsPath === uri.fsPath);
        },
        getConfiguration(section) {
          const values = { ...(configurations[section] || {}) };
          return {
            get(key) {
              return values[key];
            },
            has(key) {
              return Object.prototype.hasOwnProperty.call(values, key);
            },
          };
        },
        onDidChangeWorkspaceFolders(listener) {
          workspaceFolderListeners.push(listener);
          return { dispose() {} };
        },
        onDidChangeConfiguration(listener) {
          configurationChangeListeners.push(listener);
          return { dispose() {} };
        },
      },
    },
    activeEditorListeners,
    configurationChangeListeners,
    configurations,
    outputChannels,
    errors,
    infos,
    warnings,
    workspaceFolderListeners,
  };
}

function createDocument(text, languageId, fsPath) {
  const lines = text.split(/\r?\n/);
  return {
    languageId,
    lineCount: lines.length,
    uri: { fsPath },
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] || "" };
    },
  };
}

class FakeLanguageClient {
  constructor(id, name, serverOptions, clientOptions) {
    this.id = id;
    this.name = name;
    this.serverOptions = serverOptions;
    this.clientOptions = clientOptions;
    this.started = false;
    this.stopped = false;
    this.features = [];
    this.codeLensFeatureCleared = false;
    this.notificationHandlers = new Map();
  }

  start() {
    this.started = true;
    return Promise.resolve();
  }

  onNotification(type, handler) {
    const method = typeof type === "string" ? type : type.method;
    this.notificationHandlers.set(method, handler);
    return { dispose() {} };
  }

  stop() {
    this.stopped = true;
    return Promise.resolve();
  }

  registerFeatures(features) {
    this.features.push(...features);
  }

  getFeature(method) {
    if (method !== "textDocument/codeLens") {
      return undefined;
    }
    return {
      clear: () => {
        this.codeLensFeatureCleared = true;
      },
    };
  }

  sendRequest(method) {
    assert.equal(method, "gauge/getRunnerLanguage");
    return Promise.resolve("kotlin");
  }
}

test("GaugeWorkspace starts Gauge LSP clients for workspace projects", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { contexts, vscode } = createFakeVscode({
    configurations: {
      "gauge.launch": { enableDebugLogs: true },
      "gauge.codeLenses": { reference: true },
    },
  });
  const cli = new CLI(new Command("gauge"), {
    version: "1.2.3",
    plugins: [{ name: "kotlin", version: "0.9.0" }],
  }, new Command("mvn"), new Command("gradle"));

  const workspace = new GaugeWorkspace({
    cli,
    clientsMap: clients,
    fileSystem,
    env: { PATH: "/bin" },
    execSync() {
      return Buffer.from("/workspace/gauge/build/classes\n");
    },
    LanguageClient: FakeLanguageClient,
    RevealOutputChannelOn: { Never: 4 },
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge/specs/example.spec");
  assert.equal(entry.project.language(), "kotlin");
  assert.equal(entry.client.started, true);
  assert.deepEqual(entry.client.serverOptions, {
    command: "gauge",
    args: ["daemon", "--lsp", "--dir", "/workspace/gauge", "-l", "debug"],
    options: {
      env: {
        GAUGE_IGNORE_RUNNER_BUILD_FAILURES: "true",
        PATH: "/bin",
        gauge_custom_classpath: "/workspace/gauge/build/classes",
        gauge_lsp_reference_codelens: "false",
      },
    },
  });
  assert.deepEqual(entry.client.clientOptions.documentSelector, [
    { scheme: "file", language: "gauge", pattern: "/workspace/gauge/**/*" },
    { scheme: "file", language: "gauge-concept", pattern: "/workspace/gauge/**/*" },
    { scheme: "file", pattern: "/workspace/gauge/**/*.spec" },
    { scheme: "file", pattern: "/workspace/gauge/**/*.cpt" },
    { scheme: "file", language: "markdown", pattern: "/workspace/gauge/**/*.md" },
    { scheme: "file", language: "kotlin", pattern: "/workspace/gauge/**/*" },
    { scheme: "file", pattern: "/workspace/gauge/**/*.kt" },
    { scheme: "file", language: "java", pattern: "/workspace/gauge/**/*" },
    { scheme: "file", pattern: "/workspace/gauge/**/*.java" },
  ]);
  assert.equal(entry.client.clientOptions.revealOutputChannelOn, 4);
  assert.equal(entry.client.clientOptions.workspaceFolder.uri.fsPath, "/workspace/gauge");
  assert.equal(entry.client.features.length, 1);
  assert.equal(entry.client.features[0].messages.method, "workspace/saveFiles");
  assert.equal(workspace.getClientLanguageMap().get("/workspace/gauge"), "kotlin");
  assert.deepEqual(contexts, [
    { command: "setContext", key: "gauge:multipleProjects?", value: false },
  ]);
});

test("GaugeWorkspace removes the LSP CodeLens feature after startup", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
  });
  const { vscode } = createFakeVscode();
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });

  await workspace.ready();

  assert.equal(clients.get("/workspace/gauge").client.codeLensFeatureCleared, true);
});

test("GaugeWorkspace disposes active clients when the workspace is disposed", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
  });
  const { vscode } = createFakeVscode();
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), {
      version: "1.2.3",
      plugins: [{ name: "kotlin", version: "0.9.0" }],
    }),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();
  const entry = clients.get("/workspace/gauge/specs/example.spec");

  await workspace.dispose();

  assert.equal(entry.client.stopped, true);
  assert.equal(clients.get("/workspace/gauge/specs/example.spec"), undefined);
  assert.deepEqual([...workspace.getClientLanguageMap().keys()], []);
});

test("GaugeWorkspace exposes the project client before runner installation completes", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode({
    workspaceFolders: [],
  });
  const cli = new CLI(new Command("gauge"), {
    version: "1.2.3",
    plugins: [],
  }, new Command("mvn"), new Command("gradle"));
  const workspace = new GaugeWorkspace({
    cli,
    clientsMap: clients,
    fileSystem,
    env: { PATH: "/bin" },
    execSync() {
      return Buffer.from("");
    },
    LanguageClient: FakeLanguageClient,
    RevealOutputChannelOn: { Never: 4 },
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  let releaseInstall;
  workspace.installRunnerFor = () => new Promise((resolve) => {
    releaseInstall = resolve;
  });

  const start = workspace.startServerFor("/workspace/gauge");
  for (let attempt = 0; attempt < 10 && !releaseInstall; attempt += 1) {
    await Promise.resolve();
  }

  const entry = clients.get("/workspace/gauge/specs/example.spec");
  assert.ok(entry);
  assert.equal(entry.project.root(), "/workspace/gauge");
  assert.equal(entry.client.started, false);

  releaseInstall();
  const client = await start;
  assert.equal(client.started, true);
});

test("GaugeWorkspace starts LSP clients for nested Gauge projects under a workspace folder", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/service-a/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/service-a/build.gradle.kts": "",
  });
  const { contexts, vscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), {
      version: "1.2.3",
      plugins: [{ name: "kotlin", version: "0.9.0" }],
    }, new Command("mvn"), new Command("gradle")),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/service-a/specs/example.spec");
  assert.equal(entry.project.root(), "/workspace/service-a");
  assert.equal(entry.client.started, true);
  assert.deepEqual(entry.client.serverOptions.args, [
    "daemon",
    "--lsp",
    "--dir",
    "/workspace/service-a",
  ]);
  assert.deepEqual(contexts, [
    { command: "setContext", key: "gauge:multipleProjects?", value: false },
  ]);
});

test("GaugeWorkspace starts LSP clients for nested Gauge projects under Gauge roots", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
    "/workspace/gauge/modules/admin/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/modules/admin/build.gradle.kts": "",
  });
  const { contexts, vscode } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/gauge" } }],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), {
      version: "1.2.3",
      plugins: [{ name: "kotlin", version: "0.9.0" }],
    }, new Command("mvn"), new Command("gradle")),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  assert.equal(clients.has("/workspace/gauge"), true);
  assert.equal(clients.has("/workspace/gauge/modules/admin"), true);
  assert.equal(
    clients.get("/workspace/gauge/modules/admin/specs/example.spec").project.root(),
    "/workspace/gauge/modules/admin",
  );
  assert.deepEqual(contexts, [
    { command: "setContext", key: "gauge:multipleProjects?", value: true },
  ]);
});

test("GaugeWorkspace suppresses external implementation definition errors from Gauge LSP", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const conceptDocument = createDocument([
    "# Shared login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/concepts/shared.cpt");
  const externalKotlinDocument = createDocument([
    "package external.steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class ExternalLoginSteps {",
    "  @Step(\"Log in as <user>\")",
    "  fun login(user: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/shared-steps/src/test/kotlin/ExternalLoginSteps.kt");
  const { vscode } = createFakeVscode({
    textDocuments: [conceptDocument, externalKotlinDocument],
  });
  const cli = new CLI(new Command("gauge"), {
    version: "1.2.3",
    plugins: [{ name: "kotlin", version: "0.9.0" }],
  }, new Command("mvn"), new Command("gradle"));

  const workspace = new GaugeWorkspace({
    cli,
    clientsMap: clients,
    fileSystem,
    execSync() {
      return Buffer.from("");
    },
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge/specs/concepts/shared.cpt");
  const middleware = entry.client.clientOptions.middleware;
  assert.equal(typeof middleware.provideDefinition, "function");

  const externalError = new Error(
    "implementation source not found: Step implementation referred from an external project or library",
  );
  const suppressed = await middleware.provideDefinition({}, {}, {}, () => Promise.reject(externalError));
  assert.deepEqual(suppressed, []);

  const nestedExternalError = {
    code: -32603,
    data: {
      error: "implementation source not found: Step implementation referred from an external project or library",
    },
  };
  const suppressedNested = await middleware.provideDefinition(
    {},
    {},
    {},
    () => Promise.reject(nestedExternalError),
  );
  assert.deepEqual(suppressedNested, []);

  const localDefinitions = await middleware.provideDefinition(
    conceptDocument,
    { line: 1, character: 5 },
    {},
    () => Promise.reject(externalError),
  );
  assert.equal(localDefinitions.length, 1);
  assert.equal(localDefinitions[0].uri, externalKotlinDocument.uri);
  assert.deepEqual(
    { ...localDefinitions[0].range.start },
    { line: 6, character: 2 },
  );

  const specDocument = createDocument([
    "# Login",
    "## Successful login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  let specRemoteCalls = 0;
  const specKotlinDefinitions = await middleware.provideDefinition(
    specDocument,
    { line: 2, character: 5 },
    {},
    () => {
      specRemoteCalls += 1;
      return Promise.resolve([]);
    },
  );
  assert.equal(specKotlinDefinitions.length, 1);
  assert.equal(specKotlinDefinitions[0].uri, externalKotlinDocument.uri);
  assert.equal(specRemoteCalls, 0);

  const emptyResultFallback = await middleware.provideDefinition(
    conceptDocument,
    { line: 1, character: 5 },
    {},
    () => Promise.resolve([]),
  );
  assert.equal(emptyResultFallback.length, 1);
  assert.equal(emptyResultFallback[0].uri, externalKotlinDocument.uri);

  let remoteCalls = 0;
  const preferredLocalDefinitions = await middleware.provideDefinition(
    conceptDocument,
    { line: 1, character: 5 },
    {},
    () => {
      remoteCalls += 1;
      return Promise.resolve([{ uri: { fsPath: "/workspace/gauge/specs/concepts/remote.cpt" } }]);
    },
  );
  assert.equal(preferredLocalDefinitions.length, 1);
  assert.equal(preferredLocalDefinitions[0].uri, externalKotlinDocument.uri);
  assert.equal(remoteCalls, 0);

  const remoteOnlyDocument = createDocument([
    "# Remote only",
    "* A step unavailable locally",
  ].join("\n"), "gauge", "/workspace/gauge/specs/remote.spec");
  const remoteDefinitions = [{ uri: { fsPath: "/workspace/external/RemoteSteps.kt" } }];
  assert.equal(
    await middleware.provideDefinition(
      remoteOnlyDocument,
      { line: 1, character: 5 },
      {},
      () => Promise.resolve(remoteDefinitions),
    ),
    remoteDefinitions,
  );

  await assert.rejects(
    () => middleware.provideDefinition({}, {}, {}, () => Promise.reject(new Error("definition failed"))),
    /definition failed/,
  );
});

test("GaugeWorkspace starts clients concurrently within an explicit bound", async () => {
  const {
    DEFAULT_CLIENT_START_CONCURRENCY,
    GaugeWorkspace,
  } = require("../src/gaugeWorkspace");
  const roots = Array.from(
    { length: DEFAULT_CLIENT_START_CONCURRENCY + 2 },
    (_value, index) => `/workspace/project-${index}`,
  );
  let activeStarts = 0;
  let maximumStarts = 0;
  let releaseStarts;
  const startGate = new Promise((resolve) => {
    releaseStarts = resolve;
  });
  const workspace = Object.create(GaugeWorkspace.prototype);
  workspace.clientStartConcurrency = DEFAULT_CLIENT_START_CONCURRENCY;
  workspace.discoverGaugeProjectRoots = () => roots;
  workspace.startServerFor = async () => {
    activeStarts += 1;
    maximumStarts = Math.max(maximumStarts, activeStarts);
    await startGate;
    activeStarts -= 1;
  };

  const started = workspace.startServersForWorkspaceFolder("/workspace");
  await Promise.resolve();
  await Promise.resolve();
  const observedBeforeRelease = maximumStarts;
  releaseStarts();
  await started;

  assert.equal(observedBeforeRelease, DEFAULT_CLIENT_START_CONCURRENCY);
  assert.equal(maximumStarts, DEFAULT_CLIENT_START_CONCURRENCY);
});

test("GaugeWorkspace shares an in-flight same-root language server start", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode({ workspaceFolders: [] });
  let constructedClients = 0;
  let clientStartCalls = 0;

  class CountingLanguageClient extends FakeLanguageClient {
    constructor(...args) {
      super(...args);
      constructedClients += 1;
    }

    start() {
      clientStartCalls += 1;
      return super.start();
    }
  }

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), {
      version: "1.2.3",
      plugins: [{ name: "kotlin", version: "0.9.0" }],
    }, new Command("mvn"), new Command("gradle")),
    clientsMap: clients,
    fileSystem,
    LanguageClient: CountingLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  let releaseServerOptions;
  const serverOptionsGate = new Promise((resolve) => {
    releaseServerOptions = resolve;
  });
  let serverOptionsCalls = 0;
  workspace.serverOptionsFor = async () => {
    serverOptionsCalls += 1;
    await serverOptionsGate;
    return { command: "gauge", args: [], options: { env: {} } };
  };

  const firstStart = workspace.startServerFor("/workspace/gauge");
  const secondStart = workspace.startServerFor("/workspace/gauge");
  await Promise.resolve();
  releaseServerOptions();
  const [firstClient, secondClient] = await Promise.all([firstStart, secondStart]);

  assert.equal(serverOptionsCalls, 1);
  assert.equal(constructedClients, 1);
  assert.equal(clientStartCalls, 1);
  assert.equal(firstClient, secondClient);
  assert.equal(clients.get("/workspace/gauge").client, firstClient);
});

test("GaugeWorkspace suppresses the external implementation source popup from Gauge LSP", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode, errors, warnings, infos } = createFakeVscode({});
  const cli = new CLI(new Command("gauge"), {
    version: "1.2.3",
    plugins: [{ name: "kotlin", version: "0.9.0" }],
  }, new Command("mvn"), new Command("gradle"));

  const workspace = new GaugeWorkspace({
    cli,
    clientsMap: clients,
    fileSystem,
    execSync() {
      return Buffer.from("/workspace/gauge/build/classes\n");
    },
    LanguageClient: FakeLanguageClient,
    ShowMessageNotification: { type: { method: "window/showMessage" } },
    MessageType: { Error: 1, Warning: 2, Info: 3 },
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge/specs/example.spec");
  const handler = entry.client.notificationHandlers.get("window/showMessage");
  assert.equal(typeof handler, "function");

  handler({
    type: 1,
    message: "implementation source not found: Step implementation referred from an external project or library",
  });
  assert.deepEqual(errors, []);

  handler({ type: 1, message: "Gauge runner crashed" });
  assert.deepEqual(errors.map((entry) => entry.message), ["Gauge runner crashed"]);

  handler({ type: 2, message: "deprecated plugin" });
  assert.deepEqual(warnings.map((entry) => entry.message), ["deprecated plugin"]);

  handler({ type: 3, message: "runner ready" });
  assert.deepEqual(infos.map((entry) => entry.message), ["runner ready"]);
});

test("GaugeWorkspace drops the misleading Java extension hint before the LSP handshake", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode({});
  const cli = new CLI(new Command("gauge"), {
    version: "1.2.3",
    plugins: [{ name: "kotlin", version: "0.9.0" }],
  }, new Command("mvn"), new Command("gradle"));

  const workspace = new GaugeWorkspace({
    cli,
    clientsMap: clients,
    fileSystem,
    execSync() {
      return Buffer.from("/workspace/gauge/build/classes\n");
    },
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge/specs/example.spec");
  const strategy = entry.client.clientOptions.connectionOptions.messageStrategy;
  assert.equal(typeof strategy.handleMessage, "function");

  const dispatched = [];
  const troubleshooting = "[Troubleshooting](https://docs.gauge.org/troubleshooting.html"
    + "?language=javascript&ide=vscode#gauge-could-not-initialize-for-more-information-see-problems)";
  strategy.handleMessage({
    jsonrpc: "2.0",
    method: "window/showMessage",
    params: {
      type: 1,
      message: "Gauge could not initialize."
        + " Install 'vscjava.vscode-java-pack' extension for code insights."
        + " For more information see[Problems](command:workbench.actions.view.problems), check logs."
        + troubleshooting,
    },
  }, (message) => dispatched.push(message));

  assert.deepEqual(dispatched.map((message) => message.params.message), [
    "Gauge could not initialize."
      + " For more information see[Problems](command:workbench.actions.view.problems), check logs."
      + troubleshooting,
  ]);

  dispatched.length = 0;
  const untouched = { jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: "u" } };
  strategy.handleMessage(untouched, (message) => dispatched.push(message));
  assert.deepEqual(dispatched, [untouched]);
});

test("clientMiddleware suppresses LSP definitions owned by the stable local provider", async () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const localDefinitions = [{ uri: { fsPath: "/workspace/gauge/Steps.kt" } }];
  let remoteCalls = 0;
  const middleware = clientMiddleware({
    localDefinitionOwnedExternally: true,
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve(localDefinitions);
      },
    },
  });

  const result = await middleware.provideDefinition({}, {}, {}, () => {
    remoteCalls += 1;
    return Promise.resolve([{ uri: { fsPath: "/workspace/gauge/Remote.kt" } }]);
  });

  assert.deepEqual(result, []);
  assert.equal(remoteCalls, 0);
});

test("clientMiddleware suppresses LSP code lenses owned by the local provider", async () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  let remoteCalls = 0;
  const middleware = clientMiddleware({
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
  });

  const result = await middleware.provideCodeLenses({}, {}, () => {
    remoteCalls += 1;
    return Promise.resolve([{ command: { title: "Run Spec" } }]);
  });

  assert.deepEqual(result, []);
  assert.equal(remoteCalls, 0);
});

function missingImplementationDiagnostic(line) {
  return {
    message: "Step implementation not found",
    range: { start: { line, character: 0 }, end: { line, character: 20 } },
  };
}

test("clientMiddleware drops runner missing-step diagnostics for locally implemented steps", () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const specDocument = createDocument("# Spec", "gauge", "/workspace/gauge/specs/e2e.spec");
  const workspaceDocuments = [specDocument];
  const implementedCalls = [];
  const middleware = clientMiddleware({
    documentStore: {
      documents() {
        return workspaceDocuments;
      },
    },
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
    stepDiagnosticsProvider: {
      stepImplementedAt(document, line, documents) {
        implementedCalls.push({ document, line, documents });
        return line === 4;
      },
    },
  });
  const published = [];

  middleware.handleDiagnostics(
    { fsPath: "/workspace/gauge/specs/e2e.spec" },
    [
      missingImplementationDiagnostic(4),
      missingImplementationDiagnostic(7),
      {
        message: "Multiple data table present",
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
      },
    ],
    (uri, diagnostics) => published.push({ uri, diagnostics }),
  );

  assert.equal(published.length, 1);
  assert.deepEqual(
    published[0].diagnostics.map((diagnostic) => diagnostic.range.start.line),
    [7, 1],
  );
  assert.deepEqual(
    implementedCalls.map((call) => ({ document: call.document, line: call.line, documents: call.documents })),
    [
      { document: specDocument, line: 4, documents: workspaceDocuments },
      { document: specDocument, line: 7, documents: workspaceDocuments },
    ],
  );
});

test("clientMiddleware keeps runner missing-step diagnostics when local state is unknown", () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const specDocument = createDocument("# Spec", "gauge", "/workspace/gauge/specs/e2e.spec");
  const middleware = clientMiddleware({
    documentStore: {
      documents() {
        return [specDocument];
      },
    },
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
    stepDiagnosticsProvider: {
      stepImplementedAt() {
        return undefined;
      },
    },
  });
  const published = [];

  middleware.handleDiagnostics(
    { fsPath: "/workspace/gauge/specs/e2e.spec" },
    [missingImplementationDiagnostic(4)],
    (uri, diagnostics) => published.push({ uri, diagnostics }),
  );

  assert.equal(published[0].diagnostics.length, 1);
});

test("clientMiddleware forwards diagnostics untouched without an arbitration provider", () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const middleware = clientMiddleware({
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
  });
  const published = [];
  const diagnostics = [missingImplementationDiagnostic(2)];

  middleware.handleDiagnostics(
    { fsPath: "/workspace/gauge/specs/e2e.spec" },
    diagnostics,
    (uri, forwarded) => published.push({ uri, forwarded }),
  );

  assert.equal(published.length, 1);
  assert.equal(published[0].forwarded, diagnostics);
});

test("clientMiddleware keeps runner missing-step diagnostics for untracked documents", () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const middleware = clientMiddleware({
    documentStore: {
      documents() {
        return [];
      },
    },
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
    stepDiagnosticsProvider: {
      stepImplementedAt() {
        return true;
      },
    },
  });
  const published = [];

  middleware.handleDiagnostics(
    { fsPath: "/workspace/gauge/specs/e2e.spec" },
    [missingImplementationDiagnostic(4)],
    (uri, diagnostics) => published.push({ uri, diagnostics }),
  );

  assert.equal(published[0].diagnostics.length, 1);
});

test("GaugeWorkspace shares one output channel across workspace project clients", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/one/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/two/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
  });
  const { outputChannels, vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/one" } },
      { uri: { fsPath: "/workspace/two" } },
    ],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const firstChannel = clients.get("/workspace/one").client.clientOptions.outputChannel;
  const secondChannel = clients.get("/workspace/two").client.clientOptions.outputChannel;
  assert.equal(firstChannel, secondChannel);
  assert.deepEqual(outputChannels.map((channel) => channel.name), ["gauge"]);
});

test("GaugeWorkspace keeps clients started when runner language lookup fails", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode();

  class RejectingLanguageClient extends FakeLanguageClient {
    sendRequest(method) {
      assert.equal(method, "gauge/getRunnerLanguage");
      return Promise.reject(new Error("language unavailable"));
    }
  }

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem,
    LanguageClient: RejectingLanguageClient,
    pathModule: path.posix,
    vscode,
  });

  await assert.doesNotReject(() => workspace.ready());

  const entry = clients.get("/workspace/gauge/specs/example.spec");
  assert.equal(entry.client.started, true);
  assert.equal(workspace.getClientLanguageMap().has("/workspace/gauge"), false);
});

test("GaugeWorkspace removes clients and reports language server startup failures", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "js", Plugins: [{ name: "js" }] }),
  });
  const { errors, vscode } = createFakeVscode();

  class RejectingStartLanguageClient extends FakeLanguageClient {
    start() {
      this.started = true;
      return Promise.reject(new Error("daemon failed"));
    }
  }

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "js", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem,
    LanguageClient: RejectingStartLanguageClient,
    pathModule: path.posix,
    vscode,
  });

  await assert.doesNotReject(() => workspace.ready());

  assert.equal(clients.get("/workspace/gauge"), undefined);
  assert.deepEqual(errors, [
    {
      message: "Unable to start Gauge language server for /workspace/gauge. daemon failed",
      actions: [],
      detail: undefined,
    },
  ]);
});

test("GaugeWorkspace preserves a replacement client when an older same-root start fails", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode({ workspaceFolders: [] });
  let rejectStart;
  let failedClient;
  let markStartEntered;
  const startEntered = new Promise((resolve) => {
    markStartEntered = resolve;
  });

  class DelayedFailureLanguageClient extends FakeLanguageClient {
    constructor(...args) {
      super(...args);
      failedClient = this;
    }

    start() {
      this.started = true;
      return new Promise((_resolve, reject) => {
        rejectStart = reject;
        markStartEntered();
      });
    }
  }

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), {
      version: "1.2.3",
      plugins: [{ name: "kotlin", version: "0.9.0" }],
    }, new Command("mvn"), new Command("gradle")),
    clientsMap: clients,
    fileSystem,
    LanguageClient: DelayedFailureLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const start = workspace.startServerFor("/workspace/gauge");
  await startEntered;
  assert.equal(typeof rejectStart, "function");

  const failedEntry = clients.get("/workspace/gauge");
  const replacementClient = new FakeLanguageClient("replacement", "Gauge", {}, {});
  await replacementClient.start();
  const replacementEntry = {
    project: failedEntry.project,
    client: replacementClient,
  };
  clients.set("/workspace/gauge", replacementEntry);
  workspace.getClientLanguageMap().set("/workspace/gauge", "replacement");
  workspace.projectEnvironmentCache.set("/workspace/gauge", { replacement: true });

  rejectStart(new Error("older start failed"));
  assert.equal(await start, undefined);

  assert.equal(Map.prototype.get.call(clients, "/workspace/gauge"), replacementEntry);
  assert.equal(workspace.getClientLanguageMap().get("/workspace/gauge"), "replacement");
  assert.deepEqual(workspace.projectEnvironmentCache.get("/workspace/gauge"), { replacement: true });
  assert.equal(failedClient.stopped, true);
});

test("GaugeWorkspace leaves language server recovery to the default error handler", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { errors, vscode } = createFakeVscode();

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem,
    execSync() {
      return Buffer.from("/workspace/gauge/build/classes\n");
    },
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge/specs/example.spec");
  assert.equal(entry.client.clientOptions.errorHandler, undefined);
  assert.deepEqual(errors, []);
});

test("GaugeWorkspace generates Java config for mixed-case Java plugins", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const generatedConfigs = [];
  const env = { PATH: "/bin" };
  const gaugeConfig = { id: "gaugeConfig" };
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "java",
      Plugins: [{ name: "java" }],
    }),
  });
  const { vscode } = createFakeVscode();
  const cli = new CLI(new Command("gauge"), {
    version: "1.2.3",
    plugins: [{ name: "JAVA", version: "1.0.0" }],
  });

  class FakeJavaProjectConfig {
    constructor(projectRoot, pluginVersion, receivedGaugeConfig) {
      this.projectRoot = projectRoot;
      this.pluginVersion = pluginVersion;
      this.gaugeConfig = receivedGaugeConfig;
    }

    generate() {
      generatedConfigs.push({
        gaugeConfig: this.gaugeConfig,
        pluginVersion: this.pluginVersion,
        projectRoot: this.projectRoot,
      });
    }
  }

  const workspace = new GaugeWorkspace({
    cli,
    clientsMap: clients,
    env,
    fileSystem,
    JavaProjectConfig: FakeJavaProjectConfig,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    platform() {
      return "darwin";
    },
    gaugeConfigFactory(platformName) {
      assert.equal(platformName, "darwin");
      return gaugeConfig;
    },
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge");
  assert.deepEqual(generatedConfigs, [
    {
      gaugeConfig,
      pluginVersion: "1.0.0",
      projectRoot: "/workspace/gauge",
    },
  ]);
  assert.deepEqual(entry.client.clientOptions.documentSelector, [
    { scheme: "file", language: "gauge", pattern: "/workspace/gauge/**/*" },
    { scheme: "file", language: "gauge-concept", pattern: "/workspace/gauge/**/*" },
    { scheme: "file", pattern: "/workspace/gauge/**/*.spec" },
    { scheme: "file", pattern: "/workspace/gauge/**/*.cpt" },
    { scheme: "file", language: "markdown", pattern: "/workspace/gauge/**/*.md" },
    { scheme: "file", language: "java", pattern: "/workspace/gauge/**/*" },
    { scheme: "file", pattern: "/workspace/gauge/**/*.java" },
  ]);
  assert.equal(env.SHOULD_BUILD_PROJECT, "false");
  assert.equal(entry.client.serverOptions.options.env.SHOULD_BUILD_PROJECT, "false");
});

test("GaugeWorkspace generates Java config after installing a missing Java runner", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const events = [];
  const env = { PATH: "/bin" };
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "java",
      Plugins: [{ name: "java" }],
    }),
  });
  const { errors, vscode } = createFakeVscode();
  vscode.window.showErrorMessage = (message, options, ...actions) => {
    errors.push({ actions, message, options });
    return Promise.resolve("Yes");
  };
  const cli = new CLI(new Command("gauge"), {
    version: "1.2.3",
    plugins: [],
  });
  cli.installGaugeRunner = (language) => {
    events.push(`install:${language}`);
    cli.gaugePlugins = [{ name: "java", version: "1.0.0" }];
    return Promise.resolve(undefined);
  };

  class FakeJavaProjectConfig {
    constructor(projectRoot, pluginVersion) {
      this.projectRoot = projectRoot;
      this.pluginVersion = pluginVersion;
    }

    generate() {
      events.push(`generate:${this.projectRoot}:${this.pluginVersion}`);
    }
  }

  const workspace = new GaugeWorkspace({
    cli,
    clientsMap: clients,
    env,
    fileSystem,
    JavaProjectConfig: FakeJavaProjectConfig,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge");
  assert.deepEqual(events, [
    "install:java",
    "generate:/workspace/gauge:1.0.0",
  ]);
  assert.equal(env.SHOULD_BUILD_PROJECT, "false");
  assert.equal(entry.client.serverOptions.options.env.SHOULD_BUILD_PROJECT, "false");
});

test("GaugeWorkspace lets users choose among known projects", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/one/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/two/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
  });
  const { quickPicks, vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/one" } },
      { uri: { fsPath: "/workspace/two" } },
    ],
    quickPickSelection: { label: "two", description: "/workspace/two" },
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const selected = await workspace.showProjectOptions((projectRoot) => projectRoot);

  assert.equal(selected, "/workspace/two");
  assert.deepEqual(quickPicks, [
    {
      items: [
        { label: "one", description: "/workspace/one" },
        { label: "two", description: "/workspace/two" },
      ],
      options: { canPickMany: false, placeHolder: "Choose a project" },
    },
  ]);
});

test("GaugeWorkspace reports project selection failures", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/one/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
  });
  const quickPickError = new Error("picker failed");
  const { errors, vscode } = createFakeVscode({
    quickPickError,
    workspaceFolders: [{ uri: { fsPath: "/workspace/one" } }],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  await assert.doesNotReject(() => workspace.showProjectOptions(() => "unused"));
  assert.deepEqual(errors, [
    {
      message: "Unable to select project. picker failed",
      actions: [],
      detail: undefined,
    },
  ]);
});

test("GaugeWorkspace starts and stops clients as workspace folders change", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/one/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/two/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
  });
  const { contexts, vscode, workspaceFolderListeners } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/one" } }],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  assert.equal(workspaceFolderListeners.length, 1);
  const firstClient = clients.get("/workspace/one").client;

  await workspaceFolderListeners[0]({
    added: [{ uri: { fsPath: "/workspace/two" } }],
    removed: [],
  });

  assert.equal(clients.get("/workspace/two").client.started, true);
  assert.deepEqual([...workspace.getClientLanguageMap().keys()].sort(), [
    "/workspace/one",
    "/workspace/two",
  ]);

  await workspaceFolderListeners[0]({
    added: [],
    removed: [{ uri: { fsPath: "/workspace/one" } }],
  });

  assert.equal(clients.get("/workspace/one"), undefined);
  assert.equal(firstClient.stopped, true);
  assert.equal(clients.get("/workspace/two").client.stopped, false);
  assert.deepEqual([...workspace.getClientLanguageMap().keys()], ["/workspace/two"]);
  assert.deepEqual(contexts, [
    { command: "setContext", key: "gauge:multipleProjects?", value: false },
    { command: "setContext", key: "gauge:multipleProjects?", value: true },
    { command: "setContext", key: "gauge:multipleProjects?", value: false },
  ]);
});

test("GaugeWorkspace notifies project listeners after workspace folder removal", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/one/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/two/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
  });
  const { vscode, workspaceFolderListeners } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/one" } },
      { uri: { fsPath: "/workspace/two" } },
    ],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  assert.equal(typeof workspace.onDidChangeProjects, "function");
  const notifications = [];
  workspace.onDidChangeProjects((projectRoot) => {
    notifications.push(projectRoot);
  });

  await workspaceFolderListeners[0]({
    added: [],
    removed: [{ uri: { fsPath: "/workspace/one" } }],
  });

  assert.deepEqual(notifications, ["/workspace/two"]);
});

test("GaugeWorkspace notifies project listeners after workspace folder addition", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/one/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/two/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
  });
  const { vscode, workspaceFolderListeners } = createFakeVscode({
    workspaceFolders: [{ uri: { fsPath: "/workspace/one" } }],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const notifications = [];
  workspace.onDidChangeProjects((projectRoot) => {
    notifications.push(projectRoot);
  });

  await workspaceFolderListeners[0]({
    added: [{ uri: { fsPath: "/workspace/two" } }],
    removed: [],
  });

  assert.deepEqual(notifications, ["/workspace/one"]);
});

test("GaugeWorkspace starts a client for the active Gauge document", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "gauge",
        uri: { fsPath: "/workspace/gauge/specs/login.spec" },
      },
    },
    workspaceFolders: [],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(
      new Command("gauge"),
      { plugins: [{ name: "kotlin", version: "0.9.0" }] },
      new Command("mvn"),
      new Command("gradle"),
    ),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  assert.equal(clients.get("/workspace/gauge/specs/login.spec").client.started, true);
});

test("GaugeWorkspace starts a client for the active spec file by extension", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "plaintext",
        uri: { fsPath: "/workspace/gauge/specs/login.spec" },
      },
    },
    workspaceFolders: [],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(
      new Command("gauge"),
      { plugins: [{ name: "kotlin", version: "0.9.0" }] },
      new Command("mvn"),
      new Command("gradle"),
    ),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  assert.equal(clients.get("/workspace/gauge/specs/login.spec").client.started, true);
});

test("GaugeWorkspace starts a client for the active concept file by extension", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "plaintext",
        uri: { fsPath: "/workspace/gauge/specs/concepts/shared.cpt" },
      },
    },
    workspaceFolders: [],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(
      new Command("gauge"),
      { plugins: [{ name: "kotlin", version: "0.9.0" }] },
      new Command("mvn"),
      new Command("gradle"),
    ),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  assert.equal(clients.get("/workspace/gauge/specs/concepts/shared.cpt").client.started, true);
});

test("GaugeWorkspace starts a client for the active Markdown Gauge specification", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "markdown",
        uri: { fsPath: "/workspace/gauge/specs/login.md" },
      },
    },
    workspaceFolders: [],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(
      new Command("gauge"),
      { plugins: [{ name: "kotlin", version: "0.9.0" }] },
      new Command("mvn"),
      new Command("gradle"),
    ),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge/specs/login.md");
  assert.equal(entry.client.started, true);
  assert.deepEqual(entry.client.clientOptions.documentSelector, [
    { scheme: "file", language: "gauge", pattern: "/workspace/gauge/**/*" },
    { scheme: "file", language: "gauge-concept", pattern: "/workspace/gauge/**/*" },
    { scheme: "file", pattern: "/workspace/gauge/**/*.spec" },
    { scheme: "file", pattern: "/workspace/gauge/**/*.cpt" },
    { scheme: "file", language: "markdown", pattern: "/workspace/gauge/**/*.md" },
    { scheme: "file", language: "kotlin", pattern: "/workspace/gauge/**/*" },
    { scheme: "file", pattern: "/workspace/gauge/**/*.kt" },
    { scheme: "file", language: "java", pattern: "/workspace/gauge/**/*" },
    { scheme: "file", pattern: "/workspace/gauge/**/*.java" },
  ]);
});

test("GaugeWorkspace starts a client for the active Kotlin implementation document", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        languageId: "kotlin",
        uri: { fsPath: "/workspace/gauge/src/test/kotlin/Steps.kt" },
      },
    },
    workspaceFolders: [],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(
      new Command("gauge"),
      { plugins: [{ name: "kotlin", version: "0.9.0" }] },
      new Command("mvn"),
      new Command("gradle"),
    ),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  assert.equal(clients.get("/workspace/gauge/src/test/kotlin/Steps.kt").client.started, true);
});

test("GaugeWorkspace starts a client when the active editor changes to Gauge", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { activeEditorListeners, vscode } = createFakeVscode({
    workspaceFolders: [],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(
      new Command("gauge"),
      { plugins: [{ name: "kotlin", version: "0.9.0" }] },
      new Command("mvn"),
      new Command("gradle"),
    ),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  assert.equal(activeEditorListeners.length, 1);
  assert.equal(clients.get("/workspace/gauge/specs/login.spec"), undefined);

  await activeEditorListeners[0]({
    document: {
      languageId: "gauge",
      uri: { fsPath: "/workspace/gauge/specs/login.spec" },
    },
  });

  assert.equal(clients.get("/workspace/gauge/specs/login.spec").client.started, true);
});

test("GaugeWorkspace starts a client when the active editor changes to a spec file by extension", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { activeEditorListeners, vscode } = createFakeVscode({
    workspaceFolders: [],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(
      new Command("gauge"),
      { plugins: [{ name: "kotlin", version: "0.9.0" }] },
      new Command("mvn"),
      new Command("gradle"),
    ),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  assert.equal(activeEditorListeners.length, 1);
  assert.equal(clients.get("/workspace/gauge/specs/login.spec"), undefined);

  await activeEditorListeners[0]({
    document: {
      languageId: "plaintext",
      uri: { fsPath: "/workspace/gauge/specs/login.spec" },
    },
  });

  assert.equal(clients.get("/workspace/gauge/specs/login.spec").client.started, true);
});

test("GaugeWorkspace starts a client when the active editor changes to a concept file by extension", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { activeEditorListeners, vscode } = createFakeVscode({
    workspaceFolders: [],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(
      new Command("gauge"),
      { plugins: [{ name: "kotlin", version: "0.9.0" }] },
      new Command("mvn"),
      new Command("gradle"),
    ),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  assert.equal(activeEditorListeners.length, 1);
  assert.equal(clients.get("/workspace/gauge/specs/concepts/shared.cpt"), undefined);

  await activeEditorListeners[0]({
    document: {
      languageId: "plaintext",
      uri: { fsPath: "/workspace/gauge/specs/concepts/shared.cpt" },
    },
  });

  assert.equal(clients.get("/workspace/gauge/specs/concepts/shared.cpt").client.started, true);
});

test("GaugeWorkspace starts a client when the active editor changes to Kotlin", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { activeEditorListeners, vscode } = createFakeVscode({
    workspaceFolders: [],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(
      new Command("gauge"),
      { plugins: [{ name: "kotlin", version: "0.9.0" }] },
      new Command("mvn"),
      new Command("gradle"),
    ),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  assert.equal(activeEditorListeners.length, 1);
  assert.equal(clients.get("/workspace/gauge/src/test/kotlin/Steps.kt"), undefined);

  await activeEditorListeners[0]({
    document: {
      languageId: "kotlin",
      uri: { fsPath: "/workspace/gauge/src/test/kotlin/Steps.kt" },
    },
  });

  assert.equal(clients.get("/workspace/gauge/src/test/kotlin/Steps.kt").client.started, true);
});

test("GaugeWorkspace asks users to restart when Gauge launch debug logs change", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const {
    configurationChangeListeners,
    configurations,
    contexts,
    vscode,
    warnings,
  } = createFakeVscode({
    configurations: {
      "gauge.launch": { enableDebugLogs: false },
    },
    workspaceFolders: [],
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [] }),
    clientsMap: new Map(),
    LanguageClient: FakeLanguageClient,
    vscode,
  });
  await workspace.ready();

  assert.equal(configurationChangeListeners.length, 1);

  configurations["gauge.launch"] = { enableDebugLogs: true };
  await configurationChangeListeners[0]({});

  assert.deepEqual(warnings, [
    {
      message: "Gauge Language Server configuration changed, please restart VS Code.",
      actions: ["Restart Now"],
    },
  ]);
  assert.deepEqual(contexts.at(-1), {
    command: "workbench.action.reloadWindow",
    key: undefined,
    value: undefined,
  });
});

test("GaugeWorkspace stores the last html report path in state", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const state = {};
  const { vscode } = createFakeVscode({ workspaceFolders: [] });
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [] }),
    clientsMap: new Map(),
    LanguageClient: FakeLanguageClient,
    state: {
      setReportPath(reportPath) {
        state.report = reportPath;
      },
      getReportPath() {
        return state.report;
      },
    },
    vscode,
  });
  await workspace.ready();

  workspace.setReportPath(" /workspace/reports/html-report/index.html ");

  assert.equal(workspace.getReportPath(), "/workspace/reports/html-report/index.html");
});

test("GaugeWorkspace computes the LSP project classpath once per server start", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode();
  const execCalls = [];
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), {
      version: "1.2.3",
      plugins: [{ name: "kotlin", version: "0.9.0" }],
    }, new Command("mvn"), new Command("gradle")),
    clientsMap: clients,
    fileSystem,
    env: { PATH: "/bin" },
    execSync(command, options) {
      execCalls.push({ command, options });
      return Buffer.from("/workspace/gauge/build/classes");
    },
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge/specs/example.spec");
  const callsAfterStartup = execCalls.length;
  workspace.serverOptionsFor(entry.project);
  workspace.serverOptionsFor(entry.project);

  assert.equal(callsAfterStartup, 1);
  assert.equal(execCalls.length, callsAfterStartup);
});

test("GaugeWorkspace ignores configuration changes outside the gauge section", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
  });
  const { vscode } = createFakeVscode();
  const configurationListeners = [];
  let configurationReads = 0;
  vscode.workspace.onDidChangeConfiguration = (listener) => {
    configurationListeners.push(listener);
    return { dispose() {} };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = (section) => {
    configurationReads += 1;
    return originalGetConfiguration.call(vscode.workspace, section);
  };
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: new GaugeClients(),
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const readsAfterStartup = configurationReads;
  assert.equal(configurationListeners.length > 0, true);
  configurationListeners[0]({
    affectsConfiguration(section) {
      return section === "editor";
    },
  });

  assert.equal(configurationReads, readsAfterStartup);
});

test("GaugeWorkspace arbitrates runner step diagnostics through the local step index", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const specDocument = createDocument("# Spec", "gauge", "/workspace/gauge/specs/e2e.spec");
  const { vscode } = createFakeVscode({});
  const cli = new CLI(new Command("gauge"), {
    version: "1.2.3",
    plugins: [{ name: "kotlin", version: "0.9.0" }],
  }, new Command("mvn"), new Command("gradle"));

  const workspace = new GaugeWorkspace({
    cli,
    clientsMap: clients,
    documentStore: {
      documents() {
        return [specDocument];
      },
    },
    execSync() {
      return Buffer.from("");
    },
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    stepDiagnosticsProvider: {
      stepImplementedAt(document, line) {
        return line === 4;
      },
    },
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge/specs/e2e.spec");
  const middleware = entry.client.clientOptions.middleware;
  assert.equal(typeof middleware.handleDiagnostics, "function");
  const published = [];
  middleware.handleDiagnostics(
    { fsPath: "/workspace/gauge/specs/e2e.spec" },
    [missingImplementationDiagnostic(4), missingImplementationDiagnostic(7)],
    (uri, diagnostics) => published.push(diagnostics),
  );

  assert.deepEqual(published[0].map((diagnostic) => diagnostic.range.start.line), [7]);
});

test("clientMiddleware arbitration composes with the real store and step index", async () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = {
    "/ws/specs/e2e.spec": [
      "# Spec",
      "",
      "## Scenario",
      "",
      "* implemented step",
      "* missing step",
    ].join("\n"),
    "/ws/src/test/kotlin/Steps.kt": [
      "import com.thoughtworks.gauge.Step",
      "",
      "class Steps {",
      "  @Step(\"implemented step\")",
      "  fun implemented() {}",
      "}",
    ].join("\n"),
  };
  const store = new WorkspaceDocumentStore({
    fileSystem: {
      promises: {
        async readFile(file) {
          if (!Object.prototype.hasOwnProperty.call(files, file)) {
            throw new Error(`Missing ${file}`);
          }
          return files[file];
        },
      },
    },
    vscode: {
      Uri: {
        file(filename) {
          return { fsPath: filename, scheme: "file" };
        },
      },
      workspace: {
        textDocuments: [],
        async findFiles() {
          return Object.keys(files).map((filename) => ({ fsPath: filename }));
        },
      },
    },
  });
  await store.start();
  const provider = new GaugeStepDiagnosticsProvider({ documentStore: store, vscode: {} });
  const middleware = clientMiddleware({
    documentStore: store,
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
    stepDiagnosticsProvider: provider,
  });
  const published = [];

  middleware.handleDiagnostics(
    { fsPath: "/ws/specs/e2e.spec", scheme: "file" },
    [missingImplementationDiagnostic(4), missingImplementationDiagnostic(5)],
    (uri, diagnostics) => published.push(diagnostics),
  );

  assert.deepEqual(
    published[0].map((diagnostic) => diagnostic.range.start.line),
    [5],
  );
});

test("clientMiddleware drops LSP diagnostics the local provider already published", () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const specDocument = createDocument("# Spec", "gauge", "/workspace/gauge/specs/e2e.spec");
  const workspaceDocuments = [specDocument];
  const middleware = clientMiddleware({
    documentStore: {
      documents() {
        return workspaceDocuments;
      },
    },
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
    stepDiagnosticsProvider: {
      stepImplementedAt() {
        return undefined;
      },
      publishedDiagnosticLines(document, message) {
        return message === "Table header cannot have repeated column values"
          ? new Set([6])
          : new Set();
      },
    },
  });
  const published = [];

  middleware.handleDiagnostics(
    { fsPath: "/workspace/gauge/specs/e2e.spec" },
    [
      {
        message: "Table header cannot have repeated column values",
        range: { start: { line: 6, character: 0 }, end: { line: 6, character: 12 } },
      },
      {
        message: "Table header cannot have repeated column values",
        range: { start: { line: 9, character: 0 }, end: { line: 9, character: 12 } },
      },
      {
        message: "Multiple data table present, ignoring table",
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
      },
    ],
    (uri, diagnostics) => published.push({ uri, diagnostics }),
  );

  assert.equal(published.length, 1);
  assert.deepEqual(
    published[0].diagnostics.map((diagnostic) => diagnostic.range.start.line),
    [9, 1],
  );
});

test("clientMiddleware keeps LSP diagnostics the local provider does not own", () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const specDocument = createDocument("# Spec", "gauge", "/workspace/gauge/specs/e2e.spec");
  const workspaceDocuments = [specDocument];
  const middleware = clientMiddleware({
    documentStore: {
      documents() {
        return workspaceDocuments;
      },
    },
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
    stepDiagnosticsProvider: {
      stepImplementedAt() {
        return undefined;
      },
      publishedDiagnosticLines() {
        return undefined;
      },
    },
  });
  const published = [];

  middleware.handleDiagnostics(
    { fsPath: "/workspace/gauge/specs/e2e.spec" },
    [
      {
        message: "Table header cannot have repeated column values",
        range: { start: { line: 6, character: 0 }, end: { line: 6, character: 12 } },
      },
    ],
    (uri, diagnostics) => published.push({ uri, diagnostics }),
  );

  assert.deepEqual(
    published[0].diagnostics.map((diagnostic) => diagnostic.range.start.line),
    [6],
  );
});

test("clientMiddleware drops the runner missing-step row the local provider already flagged", () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const specDocument = createDocument("# Spec", "gauge", "/workspace/gauge/specs/e2e.spec");
  const workspaceDocuments = [specDocument];
  const middleware = clientMiddleware({
    documentStore: {
      documents() {
        return workspaceDocuments;
      },
    },
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
    stepDiagnosticsProvider: {
      stepImplementedAt() {
        return false;
      },
      publishedDiagnosticLines(document, message) {
        return message === "Undefined Step" ? new Set([4]) : new Set();
      },
    },
  });
  const published = [];

  middleware.handleDiagnostics(
    { fsPath: "/workspace/gauge/specs/e2e.spec" },
    [missingImplementationDiagnostic(4), missingImplementationDiagnostic(7)],
    (uri, diagnostics) => published.push({ uri, diagnostics }),
  );

  assert.deepEqual(
    published[0].diagnostics.map((diagnostic) => diagnostic.range.start.line),
    [7],
  );
});

test("clientMiddleware arbitrates diagnostics published under an unnormalised path", () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const specDocument = createDocument("# Spec", "gauge", "/workspace/gauge/specs/e2e.spec");
  const workspaceDocuments = [specDocument];
  const middleware = clientMiddleware({
    documentStore: {
      documents() {
        return workspaceDocuments;
      },
    },
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
    stepDiagnosticsProvider: {
      stepImplementedAt() {
        return true;
      },
      publishedDiagnosticLines() {
        return new Set();
      },
    },
  });

  for (const published of [
    "/workspace/gauge/specs/e2e.spec",
    "/workspace/gauge/./specs/e2e.spec",
    "/workspace/gauge//specs/e2e.spec",
    "/workspace/gauge/tmp/../specs/e2e.spec",
    "\\workspace\\gauge\\specs\\e2e.spec",
  ]) {
    const forwarded = [];
    middleware.handleDiagnostics(
      { fsPath: published },
      [missingImplementationDiagnostic(4)],
      (uri, diagnostics) => forwarded.push(...diagnostics),
    );
    assert.deepEqual(forwarded, [], `not arbitrated for ${published}`);
  }
});

test("clientMiddleware leaves diagnostics for an unrelated file untouched", () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const specDocument = createDocument("# Spec", "gauge", "/workspace/gauge/specs/e2e.spec");
  const middleware = clientMiddleware({
    documentStore: {
      documents() {
        return [specDocument];
      },
    },
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
    stepDiagnosticsProvider: {
      stepImplementedAt() {
        return true;
      },
      publishedDiagnosticLines() {
        return new Set();
      },
    },
  });

  const forwarded = [];
  middleware.handleDiagnostics(
    { fsPath: "/workspace/gauge/specs/other.spec" },
    [missingImplementationDiagnostic(4)],
    (uri, diagnostics) => forwarded.push(...diagnostics),
  );
  assert.equal(forwarded.length, 1);
});
