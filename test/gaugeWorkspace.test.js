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
        showErrorMessage(message, reason) {
          errors.push({ message, reason });
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
      "gauge.codeLenses": { reference: false },
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
      return Buffer.from("");
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
        gauge_custom_classpath: "",
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
  await Promise.resolve();

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

  await assert.rejects(
    () => middleware.provideDefinition({}, {}, {}, () => Promise.reject(new Error("definition failed"))),
    /definition failed/,
  );
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
      return Buffer.from("");
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
      reason: undefined,
    },
  ]);
});

test("GaugeWorkspace reports language server runtime failures", async () => {
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
      return Buffer.from("");
    },
    LanguageClient: FakeLanguageClient,
    ErrorAction: { Continue: "continue" },
    CloseAction: { DoNotRestart: "do-not-restart" },
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge/specs/example.spec");
  const handler = entry.client.clientOptions.errorHandler;
  assert.equal(typeof handler.error, "function");
  assert.equal(typeof handler.closed, "function");

  assert.deepEqual(handler.error(new Error("connection reset")), { action: "continue" });
  assert.deepEqual(handler.closed(), { action: "do-not-restart" });
  assert.deepEqual(errors.map((entry) => entry.message), [
    "Gauge language server for /workspace/gauge failed. connection reset",
    "Gauge language server for /workspace/gauge stopped unexpectedly.",
  ]);
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
      message: "Unable to select project.",
      reason: quickPickError,
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

  await workspaceFolderListeners[0]({
    added: [],
    removed: [{ uri: { fsPath: "/workspace/one" } }],
  });

  assert.equal(clients.get("/workspace/one"), undefined);
  assert.equal(firstClient.stopped, true);
  assert.equal(clients.get("/workspace/two").client.stopped, false);
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
