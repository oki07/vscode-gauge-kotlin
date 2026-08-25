const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function installTrackingCancellationSources(vscode, events = []) {
  const sources = [];
  vscode.CancellationTokenSource = class TrackingCancellationTokenSource {
    constructor() {
      this.cancelCalls = 0;
      this.disposeCalls = 0;
      const source = this;
      this.token = {
        get isCancellationRequested() {
          return source.cancelCalls > 0;
        },
        source,
      };
      sources.push(this);
    }

    cancel() {
      this.cancelCalls += 1;
      events.push("cancel");
    }

    dispose() {
      this.disposeCalls += 1;
      events.push("dispose");
    }
  };
  return sources;
}

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
    this.renameFeatureCleared = false;
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
    if (method === "textDocument/codeLens") {
      return {
        clear: () => {
          this.codeLensFeatureCleared = true;
        },
      };
    }
    if (method === "textDocument/rename") {
      return {
        clear: () => {
          this.renameFeatureCleared = true;
        },
      };
    }
    return undefined;
  }

  sendRequest(method) {
    assert.equal(method, "gauge/getRunnerLanguage");
    return Promise.resolve("kotlin");
  }
}

function createEmptyKotlinWorkspace(LanguageClient = FakeLanguageClient) {
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
  const fakeVscode = createFakeVscode({ workspaceFolders: [] });
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), {
      version: "1.2.3",
      plugins: [{ name: "kotlin", version: "0.9.0" }],
    }, new Command("mvn"), new Command("gradle")),
    clientsMap: clients,
    execSync() {
      return Buffer.from("/workspace/gauge/build/classes\n");
    },
    fileSystem,
    LanguageClient,
    pathModule: path.posix,
    vscode: fakeVscode.vscode,
  });
  return { clients, workspace, ...fakeVscode };
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

test("GaugeWorkspace clears locally-owned LSP features after startup", async () => {
  const startEntered = deferred();
  const startResponse = deferred();
  const restartEntered = [deferred(), deferred()];
  const restartResponse = [deferred(), deferred()];
  const restartSettled = [deferred(), deferred()];
  const restartFeatureError = new Error("rename feature cleanup failed");
  const featureRequests = [];
  const clearedFeatures = [];
  const events = [];
  class PendingFeatureLanguageClient extends FakeLanguageClient {
    constructor(...args) {
      super(...args);
      this.featureAvailable = false;
      this.startCalls = 0;
      this.stateListenerDisposals = 0;
      this.stateListeners = new Set();
    }

    start() {
      const startCall = this.startCalls;
      this.startCalls += 1;
      if (startCall === 0) {
        events.push("start:entered");
        startEntered.resolve();
        return startResponse.promise.then(() => {
          this.featureAvailable = true;
          this.started = true;
          events.push("start:settled");
        });
      }
      const restartIndex = startCall - 1;
      events.push(`restart:${restartIndex}:entered`);
      restartEntered[restartIndex].resolve();
      return restartResponse[restartIndex].promise.then(() => {
        this.featureAvailable = true;
        events.push(`restart:${restartIndex}:settled`);
        restartSettled[restartIndex].resolve();
      });
    }

    getFeature(method) {
      featureRequests.push(method);
      if (!this.featureAvailable) {
        return undefined;
      }
      if (method !== "textDocument/codeLens" && method !== "textDocument/rename") {
        return undefined;
      }
      return {
        clear: () => {
          clearedFeatures.push(method);
          events.push(`clear:${method}`);
          if (method === "textDocument/rename" && this.startCalls === 2) {
            throw restartFeatureError;
          }
        },
      };
    }

    onDidChangeState(listener) {
      this.stateListeners.add(listener);
      let disposed = false;
      return {
        dispose: () => {
          if (disposed) {
            return;
          }
          disposed = true;
          this.stateListenerDisposals += 1;
          this.stateListeners.delete(listener);
        },
      };
    }

    emitState(newState) {
      if (newState === 2) {
        this.featureAvailable = false;
      }
      for (const listener of [...this.stateListeners]) {
        listener({ newState });
      }
    }
  }
  const { clients, workspace } = createEmptyKotlinWorkspace(PendingFeatureLanguageClient);
  await workspace.ready();
  const start = workspace.startServerFor("/workspace/gauge");
  let disposed = false;
  try {
    await startEntered.promise;
    const client = clients.get("/workspace/gauge").client;
    assert.deepEqual(featureRequests, []);
    assert.deepEqual(clearedFeatures, []);

    startResponse.resolve();
    await start;

    assert.deepEqual([...featureRequests].sort(), [
      "textDocument/codeLens",
      "textDocument/rename",
    ]);
    assert.deepEqual([...clearedFeatures].sort(), [
      "textDocument/codeLens",
      "textDocument/rename",
    ]);
    assert.ok(events.indexOf("clear:textDocument/codeLens") > events.indexOf("start:settled"));
    assert.ok(events.indexOf("clear:textDocument/rename") > events.indexOf("start:settled"));
    assert.equal(client.started, true);
    assert.equal(client.stopped, false);
    assert.equal(typeof client.sendRequest, "function");

    client.emitState(1);
    client.emitState(3);

    assert.equal(clearedFeatures.filter(
      (method) => method === "textDocument/codeLens",
    ).length, 1);
    assert.equal(clearedFeatures.filter(
      (method) => method === "textDocument/rename",
    ).length, 1);

    client.emitState(2);

    assert.equal(client.startCalls, 2);
    assert.equal(clearedFeatures.filter(
      (method) => method === "textDocument/codeLens",
    ).length, 1);
    assert.equal(clearedFeatures.filter(
      (method) => method === "textDocument/rename",
    ).length, 1);

    restartResponse[0].resolve();
    await restartSettled[0].promise;
    await Promise.resolve();

    assert.equal(clearedFeatures.filter(
      (method) => method === "textDocument/codeLens",
    ).length, 2);
    assert.equal(clearedFeatures.filter(
      (method) => method === "textDocument/rename",
    ).length, 2);
    assert.equal(client.stateListeners.size, 1);

    client.emitState(2);
    assert.equal(client.startCalls, 3);
    assert.equal(clearedFeatures.filter(
      (method) => method === "textDocument/rename",
    ).length, 2);

    await workspace.dispose();
    disposed = true;
    assert.equal(client.stateListenerDisposals, 1);
    assert.equal(client.stateListeners.size, 0);
    assert.equal(client.stopped, true);

    restartResponse[1].resolve();
    await restartSettled[1].promise;
    await Promise.resolve();
    assert.equal(clearedFeatures.filter(
      (method) => method === "textDocument/rename",
    ).length, 2);
  } finally {
    startResponse.resolve();
    for (const response of restartResponse) {
      response.resolve();
    }
    await Promise.allSettled([start]);
    if (!disposed) {
      await workspace.dispose();
    }
  }
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

test("GaugeWorkspace disposal is single-flight while client shutdown is pending", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const stopGate = deferred();
  const stopError = new Error("Unable to stop Gauge client.");
  const disposalCounts = [0, 0, 0];
  let outputDisposals = 0;
  let stopCalls = 0;
  const { vscode } = createFakeVscode({ workspaceFolders: [] });
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [] }),
    clientsMap: clients,
    LanguageClient: FakeLanguageClient,
    vscode,
  });
  await workspace.ready();
  clients.set("/workspace/gauge", {
    client: {
      stop() {
        stopCalls += 1;
        return stopGate.promise;
      },
    },
    project: {
      hasFile() {
        return true;
      },
      root() {
        return "/workspace/gauge";
      },
    },
  });
  workspace.disposables = disposalCounts.map((_, index) => ({
    dispose() {
      disposalCounts[index] += 1;
    },
  }));
  workspace.outputChannel = {
    dispose() {
      outputDisposals += 1;
    },
  };

  const first = workspace.dispose();
  const second = workspace.dispose();

  assert.equal(first, second);
  assert.deepEqual(disposalCounts, [1, 1, 1]);
  assert.equal(outputDisposals, 1);
  assert.equal(stopCalls, 1);
  let settled = false;
  first.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  assert.equal(settled, false);

  stopGate.reject(stopError);
  const results = await Promise.allSettled([first, second]);

  assert.deepEqual(results, [
    { status: "rejected", reason: stopError },
    { status: "rejected", reason: stopError },
  ]);
  assert.deepEqual(disposalCounts, [1, 1, 1]);
  assert.equal(outputDisposals, 1);
  assert.equal(stopCalls, 1);
});

test("GaugeWorkspace abandons an in-flight language server start after disposal", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const constructedClients = [];
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode({ workspaceFolders: [] });

  class TrackedLanguageClient extends FakeLanguageClient {
    constructor(...args) {
      super(...args);
      constructedClients.push(this);
    }
  }

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), {
      version: "1.2.3",
      plugins: [{ name: "kotlin", version: "0.9.0" }],
    }, new Command("mvn"), new Command("gradle")),
    clientsMap: clients,
    fileSystem,
    LanguageClient: TrackedLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  let markServerOptionsEntered;
  const serverOptionsEntered = new Promise((resolve) => {
    markServerOptionsEntered = resolve;
  });
  let releaseServerOptions;
  const serverOptionsGate = new Promise((resolve) => {
    releaseServerOptions = resolve;
  });
  workspace.serverOptionsFor = async () => {
    markServerOptionsEntered();
    await serverOptionsGate;
    return { command: "gauge", args: [], options: { env: {} } };
  };

  const start = workspace.startServerFor("/workspace/gauge");
  await serverOptionsEntered;
  const disposal = workspace.dispose();
  releaseServerOptions();
  const [startedClient] = await Promise.all([start, disposal]);

  assert.equal(startedClient, undefined);
  assert.equal(clients.size, 0);
  assert.equal(workspace.getClientLanguageMap().size, 0);
  assert.equal(constructedClients.length, 0);
});

test("GaugeWorkspace abandons a registered language server start after disposal", async () => {
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

  let markInstallEntered;
  const installEntered = new Promise((resolve) => {
    markInstallEntered = resolve;
  });
  let releaseInstall;
  const installGate = new Promise((resolve) => {
    releaseInstall = resolve;
  });
  workspace.installRunnerFor = async () => {
    markInstallEntered();
    await installGate;
  };

  const start = workspace.startServerFor("/workspace/gauge");
  await installEntered;
  const entry = clients.get("/workspace/gauge");
  assert.equal(entry.client.started, false);

  const disposal = workspace.dispose();
  releaseInstall();
  const [startedClient] = await Promise.all([start, disposal]);

  assert.equal(startedClient, undefined);
  assert.equal(entry.client.started, false);
  assert.equal(entry.client.stopped, true);
  assert.equal(clients.size, 0);
  assert.equal(workspace.getClientLanguageMap().size, 0);
});

test("GaugeWorkspace stops a client-start boundary once during disposal", async () => {
  let markStartEntered;
  const startEntered = new Promise((resolve) => {
    markStartEntered = resolve;
  });
  let releaseStart;
  const startGate = new Promise((resolve) => {
    releaseStart = resolve;
  });
  let stopCalls = 0;

  class PendingStartLanguageClient extends FakeLanguageClient {
    start() {
      this.started = true;
      markStartEntered();
      return startGate;
    }

    stop() {
      stopCalls += 1;
      return super.stop();
    }
  }

  const { clients, workspace } = createEmptyKotlinWorkspace(PendingStartLanguageClient);
  await workspace.ready();

  const start = workspace.startServerFor("/workspace/gauge");
  await startEntered;
  const client = clients.get("/workspace/gauge").client;
  await workspace.dispose();
  releaseStart();

  assert.equal(await start, undefined);
  assert.equal(stopCalls, 1);
  assert.equal(client.stopped, true);
  assert.equal(clients.size, 0);
  assert.equal(workspace.getClientLanguageMap().size, 0);
});

test("GaugeWorkspace does not block client startup on a pending runner language lookup", async () => {
  const languageRequestEntered = deferred();
  const languageRequestGate = deferred();
  const events = [];
  let requestToken;
  let stopCalls = 0;

  class PendingLanguageClient extends FakeLanguageClient {
    sendRequest(method, token) {
      assert.equal(method, "gauge/getRunnerLanguage");
      requestToken = token;
      languageRequestEntered.resolve();
      return languageRequestGate.promise;
    }

    stop() {
      stopCalls += 1;
      events.push("stop");
      return super.stop();
    }
  }

  const { clients, vscode, workspace } = createEmptyKotlinWorkspace(PendingLanguageClient);
  const requestSources = installTrackingCancellationSources(vscode, events);
  await workspace.ready();

  const start = workspace.startServerFor("/workspace/gauge");
  let startResult;
  let startSettled = false;
  start.then((result) => {
    startResult = result;
    startSettled = true;
  });
  await languageRequestEntered.promise;
  await new Promise((resolve) => setImmediate(resolve));
  const client = clients.get("/workspace/gauge").client;
  const liveSnapshot = {
    clientCount: clients.size,
    languageCount: workspace.getClientLanguageMap().size,
    pendingStartCount: workspace.pendingServerStarts.size,
    startResult,
    startSettled,
  };

  await workspace.dispose();
  const sourceAfterDisposal = requestSources[0];
  const disposedSnapshot = {
    cancelCalls: sourceAfterDisposal.cancelCalls,
    clientCount: clients.size,
    clientStopped: client.stopped,
    disposeCalls: sourceAfterDisposal.disposeCalls,
    events: [...events],
    languageCount: workspace.getClientLanguageMap().size,
    requestSourceCount: requestSources.length,
    requestTokenMatches: requestToken === sourceAfterDisposal.token,
    stopCalls,
  };
  languageRequestGate.resolve("kotlin");
  await start;
  await Promise.resolve();

  assert.equal(liveSnapshot.startSettled, true);
  assert.equal(liveSnapshot.pendingStartCount, 0);
  assert.equal(liveSnapshot.startResult === client, true);
  assert.equal(liveSnapshot.clientCount, 1);
  assert.equal(liveSnapshot.languageCount, 0);
  assert.deepEqual(disposedSnapshot, {
    cancelCalls: 1,
    clientCount: 0,
    clientStopped: true,
    disposeCalls: 1,
    events: ["cancel", "dispose", "stop"],
    languageCount: 0,
    requestSourceCount: 1,
    requestTokenMatches: true,
    stopCalls: 1,
  });
  assert.equal(clients.size, 0);
  assert.equal(workspace.getClientLanguageMap().size, 0);
});

test("GaugeWorkspace releases runner language request sources after live settlement", async () => {
  for (const outcome of ["success", "failure"]) {
    const languageRequestEntered = deferred();
    const languageRequestGate = deferred();
    const languageError = new Error(`runner language ${outcome}`);
    let requestToken;

    class SettlingLanguageClient extends FakeLanguageClient {
      sendRequest(method, token) {
        assert.equal(method, "gauge/getRunnerLanguage");
        requestToken = token;
        languageRequestEntered.resolve();
        return languageRequestGate.promise;
      }
    }

    const created = createEmptyKotlinWorkspace(SettlingLanguageClient);
    const requestSources = installTrackingCancellationSources(created.vscode);
    await created.workspace.ready();

    const client = await created.workspace.startServerFor("/workspace/gauge");
    await languageRequestEntered.promise;
    const source = requestSources[0];
    if (outcome === "success") {
      languageRequestGate.resolve("kotlin");
    } else {
      languageRequestGate.reject(languageError);
    }
    await new Promise((resolve) => setImmediate(resolve));
    const liveSnapshot = {
      activeRequests: created.workspace.runnerLanguageRequests.size,
      cancelCalls: source.cancelCalls,
      clientLanguage: created.workspace.getClientLanguageMap().get("/workspace/gauge"),
      disposeCalls: source.disposeCalls,
      requestTokenMatches: requestToken === source.token,
    };

    await created.workspace.dispose();

    assert.equal(client.started, true, outcome);
    assert.deepEqual(liveSnapshot, {
      activeRequests: 0,
      cancelCalls: 0,
      clientLanguage: outcome === "success" ? "kotlin" : undefined,
      disposeCalls: 1,
      requestTokenMatches: true,
    }, outcome);
    assert.deepEqual({
      cancelCalls: source.cancelCalls,
      disposeCalls: source.disposeCalls,
      errors: created.errors,
    }, {
      cancelCalls: 0,
      disposeCalls: 1,
      errors: [],
    }, outcome);
  }
});

test("GaugeWorkspace removes a client without waiting for runner language lookup", async () => {
  const languageRequestEntered = deferred();
  const languageRequestGate = deferred();
  const languageError = new Error("runner language lookup failed after removal");
  const events = [];
  let requestToken;
  let stopCalls = 0;

  class PendingLanguageClient extends FakeLanguageClient {
    sendRequest(method, token) {
      assert.equal(method, "gauge/getRunnerLanguage");
      requestToken = token;
      languageRequestEntered.resolve();
      return languageRequestGate.promise;
    }

    stop() {
      stopCalls += 1;
      events.push("stop");
      return super.stop();
    }
  }

  const { clients, errors, vscode, workspace } = createEmptyKotlinWorkspace(PendingLanguageClient);
  const requestSources = installTrackingCancellationSources(vscode, events);
  await workspace.ready();

  const start = workspace.startServerFor("/workspace/gauge");
  let startSettled = false;
  start.then(() => {
    startSettled = true;
  });
  await languageRequestEntered.promise;
  await new Promise((resolve) => setImmediate(resolve));
  const client = clients.get("/workspace/gauge").client;
  const source = requestSources[0];
  const removal = workspace.stopServerFor("/workspace/gauge");
  let removalSettled = false;
  removal.then(() => {
    removalSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const removalSnapshot = {
    activeRequests: workspace.runnerLanguageRequests.size,
    cancelCalls: source.cancelCalls,
    clientCount: clients.size,
    clientStopped: client.stopped,
    disposeCalls: source.disposeCalls,
    events: [...events],
    languageCount: workspace.getClientLanguageMap().size,
    removalSettled,
    requestTokenMatches: requestToken === source.token,
    startSettled,
    stopCalls,
  };

  languageRequestGate.reject(languageError);
  await Promise.all([start, removal]);
  await new Promise((resolve) => setImmediate(resolve));
  await workspace.dispose();

  assert.deepEqual(removalSnapshot, {
    activeRequests: 0,
    cancelCalls: 1,
    clientCount: 0,
    clientStopped: true,
    disposeCalls: 1,
    events: ["cancel", "dispose", "stop"],
    languageCount: 0,
    removalSettled: true,
    requestTokenMatches: true,
    startSettled: true,
    stopCalls: 1,
  });
  assert.equal(errors.length, 0);
  assert.equal(clients.size, 0);
  assert.equal(workspace.getClientLanguageMap().size, 0);
  assert.deepEqual({ cancelCalls: source.cancelCalls, disposeCalls: source.disposeCalls }, {
    cancelCalls: 1,
    disposeCalls: 1,
  });
  assert.equal(stopCalls, 1);
});

test("GaugeWorkspace leaves live runner language requests alone during undefined client cleanup", async () => {
  const languageRequestEntered = deferred();
  const languageRequestGate = deferred();

  class PendingLanguageClient extends FakeLanguageClient {
    sendRequest(method) {
      assert.equal(method, "gauge/getRunnerLanguage");
      languageRequestEntered.resolve();
      return languageRequestGate.promise;
    }
  }

  const created = createEmptyKotlinWorkspace(PendingLanguageClient);
  const requestSources = installTrackingCancellationSources(created.vscode);
  await created.workspace.ready();

  const client = await created.workspace.startServerFor("/workspace/gauge");
  await languageRequestEntered.promise;
  const source = requestSources[0];
  await created.workspace.cleanupLanguageClient("/workspace/missing");
  const cleanupSnapshot = {
    activeRequests: created.workspace.runnerLanguageRequests.size,
    cancelCalls: source.cancelCalls,
    clientStopped: client.stopped,
    disposeCalls: source.disposeCalls,
  };

  languageRequestGate.resolve("kotlin");
  await new Promise((resolve) => setImmediate(resolve));
  const liveSnapshot = {
    activeRequests: created.workspace.runnerLanguageRequests.size,
    cancelCalls: source.cancelCalls,
    disposeCalls: source.disposeCalls,
    language: created.workspace.getClientLanguageMap().get("/workspace/gauge"),
  };
  await created.workspace.dispose();

  assert.deepEqual(cleanupSnapshot, {
    activeRequests: 1,
    cancelCalls: 0,
    clientStopped: false,
    disposeCalls: 0,
  });
  assert.deepEqual(liveSnapshot, {
    activeRequests: 0,
    cancelCalls: 0,
    disposeCalls: 1,
    language: "kotlin",
  });
});

test("GaugeWorkspace keeps same-root runner language request ownership client-local", async () => {
  const firstRequestEntered = deferred();
  const firstRequestGate = deferred();
  const secondRequestEntered = deferred();
  const secondRequestGate = deferred();

  class FirstLanguageClient extends FakeLanguageClient {
    sendRequest(method) {
      assert.equal(method, "gauge/getRunnerLanguage");
      firstRequestEntered.resolve();
      return firstRequestGate.promise;
    }
  }

  const created = createEmptyKotlinWorkspace(FirstLanguageClient);
  const requestSources = installTrackingCancellationSources(created.vscode);
  await created.workspace.ready();

  const firstClient = await created.workspace.startServerFor("/workspace/gauge");
  await firstRequestEntered.promise;
  const firstEntry = Map.prototype.get.call(created.clients, "/workspace/gauge");
  let secondStopCalls = 0;
  const secondClient = {
    sendRequest(method) {
      assert.equal(method, "gauge/getRunnerLanguage");
      secondRequestEntered.resolve();
      return secondRequestGate.promise;
    },
    stop() {
      secondStopCalls += 1;
      return Promise.resolve();
    },
  };
  created.clients.set("/workspace/gauge", {
    client: secondClient,
    project: firstEntry.project,
  });
  const secondRequest = created.workspace.setLanguageId(
    secondClient,
    "/workspace/gauge",
    created.workspace.serverStartGeneration("/workspace/gauge"),
  );
  await secondRequestEntered.promise;

  await created.workspace.stopLanguageClient(firstClient, true);
  firstRequestGate.reject(new Error("old client runner language failed late"));
  await new Promise((resolve) => setImmediate(resolve));
  const firstSettlement = {
    activeRequests: created.workspace.runnerLanguageRequests.size,
    firstCancelCalls: requestSources[0].cancelCalls,
    firstDisposeCalls: requestSources[0].disposeCalls,
    language: created.workspace.getClientLanguageMap().get("/workspace/gauge"),
    secondCancelCalls: requestSources[1].cancelCalls,
    secondDisposeCalls: requestSources[1].disposeCalls,
  };

  secondRequestGate.resolve("kotlin");
  await secondRequest;
  const secondSettlement = {
    activeRequests: created.workspace.runnerLanguageRequests.size,
    firstCancelCalls: requestSources[0].cancelCalls,
    firstDisposeCalls: requestSources[0].disposeCalls,
    language: created.workspace.getClientLanguageMap().get("/workspace/gauge"),
    secondCancelCalls: requestSources[1].cancelCalls,
    secondDisposeCalls: requestSources[1].disposeCalls,
  };
  await created.workspace.dispose();

  assert.deepEqual(firstSettlement, {
    activeRequests: 1,
    firstCancelCalls: 1,
    firstDisposeCalls: 1,
    language: undefined,
    secondCancelCalls: 0,
    secondDisposeCalls: 0,
  });
  assert.deepEqual(secondSettlement, {
    activeRequests: 0,
    firstCancelCalls: 1,
    firstDisposeCalls: 1,
    language: "kotlin",
    secondCancelCalls: 0,
    secondDisposeCalls: 1,
  });
  assert.equal(secondStopCalls, 1);
});

test("GaugeWorkspace closes runner language sources during synchronous terminal reentrancy", async () => {
  for (const boundary of ["source construction", "token access"]) {
    const created = createEmptyKotlinWorkspace();
    await created.workspace.ready();
    const client = await created.workspace.startServerFor("/workspace/gauge");
    await new Promise((resolve) => setImmediate(resolve));
    created.workspace.getClientLanguageMap().clear();
    let removalPromise;
    let requestCalls = 0;
    const sources = [];
    client.sendRequest = () => {
      requestCalls += 1;
      return Promise.resolve("java");
    };
    created.vscode.CancellationTokenSource = class ReentrantCancellationTokenSource {
      constructor() {
        this.cancelCalls = 0;
        this.disposeCalls = 0;
        const token = { source: this };
        if (boundary === "source construction") {
          created.workspace.dispose();
          this.token = token;
        } else {
          Object.defineProperty(this, "token", {
            get() {
              removalPromise = created.workspace.stopServerFor("/workspace/gauge");
              return token;
            },
          });
        }
        sources.push(this);
      }

      cancel() {
        this.cancelCalls += 1;
      }

      dispose() {
        this.disposeCalls += 1;
      }
    };

    const request = created.workspace.setLanguageId(
      client,
      "/workspace/gauge",
      created.workspace.serverStartGeneration("/workspace/gauge"),
    );
    await request;
    if (removalPromise) {
      await removalPromise;
    }
    await created.workspace.dispose();

    assert.deepEqual({
      activeRequests: created.workspace.runnerLanguageRequests.size,
      cancelCalls: sources[0].cancelCalls,
      disposeCalls: sources[0].disposeCalls,
      languageCount: created.workspace.getClientLanguageMap().size,
      requestCalls,
    }, {
      activeRequests: 0,
      cancelCalls: 1,
      disposeCalls: 1,
      languageCount: 0,
      requestCalls: 0,
    }, boundary);
  }
});

test("GaugeWorkspace continues client cleanup when runner language source cleanup throws", async () => {
  const created = createEmptyKotlinWorkspace();
  await created.workspace.ready();
  const client = await created.workspace.startServerFor("/workspace/gauge");
  await new Promise((resolve) => setImmediate(resolve));
  const languageRequestEntered = deferred();
  const languageRequestGate = deferred();
  const lateRequestError = new Error("late runner language failure");
  const stopError = new Error("language client stop failed");
  let cancelCalls = 0;
  let disposeCalls = 0;
  let stopCalls = 0;
  created.vscode.CancellationTokenSource = class ThrowingCancellationTokenSource {
    constructor() {
      this.token = { source: this };
    }

    cancel() {
      cancelCalls += 1;
      throw new Error("runner language cancel failed");
    }

    dispose() {
      disposeCalls += 1;
      throw new Error("runner language dispose failed");
    }
  };
  client.sendRequest = () => {
    languageRequestEntered.resolve();
    return languageRequestGate.promise;
  };
  client.stop = () => {
    stopCalls += 1;
    return Promise.reject(stopError);
  };
  const request = created.workspace.setLanguageId(
    client,
    "/workspace/gauge",
    created.workspace.serverStartGeneration("/workspace/gauge"),
  );
  await languageRequestEntered.promise;

  await assert.rejects(
    created.workspace.stopServerFor("/workspace/gauge"),
    (error) => error === stopError,
  );
  await request;
  languageRequestGate.reject(lateRequestError);
  await new Promise((resolve) => setImmediate(resolve));
  await created.workspace.dispose();

  assert.deepEqual({
    activeRequests: created.workspace.runnerLanguageRequests.size,
    cancelCalls,
    clientCount: created.clients.size,
    disposeCalls,
    errors: created.errors,
    languageCount: created.workspace.getClientLanguageMap().size,
    stopCalls,
  }, {
    activeRequests: 0,
    cancelCalls: 1,
    clientCount: 0,
    disposeCalls: 1,
    errors: [],
    languageCount: 0,
    stopCalls: 1,
  });
});

test("GaugeWorkspace retries a failed stop after pending client startup settles", async () => {
  let markStartEntered;
  const startEntered = new Promise((resolve) => {
    markStartEntered = resolve;
  });
  let releaseStart;
  const startGate = new Promise((resolve) => {
    releaseStart = resolve;
  });
  let stopCalls = 0;

  class StopRetryLanguageClient extends FakeLanguageClient {
    start() {
      this.started = true;
      markStartEntered();
      return startGate;
    }

    stop() {
      stopCalls += 1;
      if (stopCalls === 1) {
        return Promise.reject(new Error("still starting"));
      }
      return super.stop();
    }
  }

  const { clients, errors, workspace } = createEmptyKotlinWorkspace(StopRetryLanguageClient);
  await workspace.ready();

  const start = workspace.startServerFor("/workspace/gauge");
  await startEntered;
  const client = clients.get("/workspace/gauge").client;
  await workspace.dispose();
  releaseStart();

  assert.equal(await start, undefined);
  assert.equal(stopCalls, 2);
  assert.equal(client.stopped, true);
  assert.equal(clients.size, 0);
  assert.deepEqual(errors, []);
});

test("GaugeWorkspace cancels an in-flight language server start when its folder is removed", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const constructedClients = [];
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { vscode } = createFakeVscode({ workspaceFolders: [] });

  class TrackedLanguageClient extends FakeLanguageClient {
    constructor(...args) {
      super(...args);
      constructedClients.push(this);
    }
  }

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), {
      version: "1.2.3",
      plugins: [{ name: "kotlin", version: "0.9.0" }],
    }, new Command("mvn"), new Command("gradle")),
    clientsMap: clients,
    fileSystem,
    LanguageClient: TrackedLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  let markServerOptionsEntered;
  const serverOptionsEntered = new Promise((resolve) => {
    markServerOptionsEntered = resolve;
  });
  let releaseServerOptions;
  const serverOptionsGate = new Promise((resolve) => {
    releaseServerOptions = resolve;
  });
  workspace.serverOptionsFor = async () => {
    markServerOptionsEntered();
    await serverOptionsGate;
    return { command: "gauge", args: [], options: { env: {} } };
  };

  const removedStart = workspace.startServerFor("/workspace/gauge");
  await serverOptionsEntered;
  await workspace.stopServersForWorkspaceFolder("/workspace");
  const restartedStart = workspace.startServerFor("/workspace/gauge");
  releaseServerOptions();

  assert.equal(await removedStart, undefined);
  const restartedClient = await restartedStart;
  assert.ok(restartedClient);
  assert.equal(restartedClient.started, true);
  assert.deepEqual(constructedClients, [restartedClient]);
  assert.equal(clients.get("/workspace/gauge").client, restartedClient);
  assert.equal(workspace.getClientLanguageMap().get("/workspace/gauge"), "kotlin");
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
  workspace.disposed = false;
  workspace.workspaceFolderDiscoveryGenerations = new Map();
  workspace.workspaceFolderProjectRoots = new Map();
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

test("clientMiddleware suppresses LSP completions owned by the composite local provider", async () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const position = { line: 2, character: 5 };
  const context = { triggerCharacter: " ", triggerKind: 2 };
  const token = { marker: "completion-token" };
  let remoteCalls = 0;
  const middleware = clientMiddleware({
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
  });

  for (const document of [
    { languageId: "gauge", uri: { fsPath: "/workspace/gauge/specs/example" } },
    { languageId: "gauge-concept", uri: { fsPath: "/workspace/gauge/concepts/example" } },
    { languageId: "plaintext", uri: { fsPath: "/workspace/gauge/specs/example.spec" } },
    { languageId: "plaintext", uri: { fsPath: "/workspace/gauge/concepts/example.cpt" } },
    { languageId: "markdown", uri: { fsPath: "/workspace/gauge/specs/example.md" } },
  ]) {
    const result = middleware.provideCompletionItem(
      document,
      position,
      context,
      token,
      () => {
        remoteCalls += 1;
        return Promise.resolve([{ label: "Remote completion" }]);
      },
    );

    assert.deepEqual(result, []);
  }
  assert.equal(remoteCalls, 0);
});

test("clientMiddleware forwards LSP completions outside local Gauge ownership", async () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const position = { line: 2, character: 5 };
  const context = { triggerCharacter: ".", triggerKind: 2 };
  const token = { marker: "completion-token" };
  const remote = {
    isIncomplete: true,
    items: [{ label: "Runner completion" }],
  };
  const forwarded = [];
  const middleware = clientMiddleware({
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
  });

  for (const document of [
    { languageId: "kotlin", uri: { fsPath: "/workspace/gauge/src/Steps.kt" } },
    { languageId: "java", uri: { fsPath: "/workspace/gauge/src/Steps.java" } },
  ]) {
    const result = await middleware.provideCompletionItem(
      document,
      position,
      context,
      token,
      (...args) => {
        forwarded.push(args);
        return remote;
      },
    );

    assert.equal(result, remote);
  }

  assert.deepEqual(forwarded, [
    [{ languageId: "kotlin", uri: { fsPath: "/workspace/gauge/src/Steps.kt" } }, position, context, token],
    [{ languageId: "java", uri: { fsPath: "/workspace/gauge/src/Steps.java" } }, position, context, token],
  ]);
});

test("clientMiddleware separates local and runner step code action ownership", async () => {
  const { clientMiddleware } = require("../src/gaugeWorkspace");
  const forwarded = [];
  const document = { uri: { fsPath: "/workspace/gauge/specs/e2e.spec" } };
  const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 8 } };
  const token = { marker: "request-token" };
  const only = { value: "quickfix" };
  const localUndefined = {
    message: "Undefined Step",
    code: "gauge.undefinedStep",
    source: "gauge",
  };
  const localValidate = {
    message: "[ValidationError] Step implementation not found",
    code: "gauge.validate",
    source: "gauge",
  };
  const runnerDiagnostic = {
    message: "Step implementation not found",
    code: "expected generated stub",
    source: "gauge",
  };
  const middleware = clientMiddleware({
    stepDefinitionProvider: {
      provideDefinition() {
        return Promise.resolve([]);
      },
    },
  });
  const next = (actualDocument, actualRange, context, actualToken) => {
    forwarded.push({ actualDocument, actualRange, context, actualToken });
    return Promise.resolve(["remote-action"]);
  };

  const mixedResult = await middleware.provideCodeActions(
    document,
    range,
    {
      diagnostics: [localUndefined, runnerDiagnostic, localValidate],
      only,
      triggerKind: 2,
    },
    token,
    next,
  );
  const localResult = await middleware.provideCodeActions(
    document,
    range,
    { diagnostics: [localUndefined, localValidate], only },
    token,
    next,
  );

  assert.deepEqual(mixedResult, ["remote-action"]);
  assert.deepEqual(localResult, []);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].actualDocument, document);
  assert.equal(forwarded[0].actualRange, range);
  assert.equal(forwarded[0].actualToken, token);
  assert.deepEqual(forwarded[0].context, {
    diagnostics: [runnerDiagnostic],
    only,
    triggerKind: 2,
  });
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
  const gaugeCommand = new Command("gauge");
  gaugeCommand.spawn = (args) => {
    events.push(`install:${args[1]}`);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.emit("exit", 0);
      child.emit("close", 0);
    });
    return child;
  };
  gaugeCommand.spawnSync = (args) => {
    assert.deepEqual(args, ["--version", "--machine-readable"]);
    events.push("refresh:manifest");
    return {
      status: 0,
      stdout: Buffer.from(JSON.stringify({
        version: "1.2.3",
        plugins: [{ name: "java", version: "1.0.0" }],
      })),
    };
  };
  const cli = new CLI(gaugeCommand, {
    version: "1.2.3",
    plugins: [],
  });

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
    "refresh:manifest",
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

test("GaugeWorkspace does not resurrect clients when a workspace folder is removed during discovery", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const retainedWorkspaceFolder = { uri: { fsPath: "/workspace/retained" } };
  const removedWorkspaceFolder = { uri: { fsPath: "/workspace/removed" } };
  const addedWorkspaceFolder = { uri: { fsPath: "/workspace/added" } };
  const workspaceFolders = [retainedWorkspaceFolder, removedWorkspaceFolder];
  const { vscode, workspaceFolderListeners } = createFakeVscode({ workspaceFolders });
  const clients = new GaugeClients();
  let discoveryEnteredResolve;
  const discoveryEntered = new Promise((resolve) => {
    discoveryEnteredResolve = resolve;
  });
  let discoveryResponseResolve;
  const discoveryResponse = new Promise((resolve) => {
    discoveryResponseResolve = resolve;
  });
  let addedDiscoveryEnteredResolve;
  const addedDiscoveryEntered = new Promise((resolve) => {
    addedDiscoveryEnteredResolve = resolve;
  });
  let addedDiscoveryResponseResolve;
  const addedDiscoveryResponse = new Promise((resolve) => {
    addedDiscoveryResponseResolve = resolve;
  });
  let constructedClients = 0;
  let startedClients = 0;

  class CountingLanguageClient extends FakeLanguageClient {
    constructor(...args) {
      super(...args);
      constructedClients += 1;
    }

    start() {
      startedClients += 1;
      return super.start();
    }
  }

  const projectRoot = "/workspace/removed/gauge";
  const project = {
    envs() {
      return {};
    },
    hasFile(filename) {
      return filename === projectRoot || filename.startsWith(`${projectRoot}/`);
    },
    isProjectLanguage() {
      return false;
    },
    language() {
      return "kotlin";
    },
    root() {
      return projectRoot;
    },
  };
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), {
      version: "1.2.3",
      plugins: [{ name: "kotlin", version: "0.9.0" }],
    }),
    clientsMap: clients,
    LanguageClient: CountingLanguageClient,
    pathModule: path.posix,
    projectFactory: {
      findGaugeProjectRootsAsync(root) {
        if (root === retainedWorkspaceFolder.uri.fsPath) {
          return [];
        }
        if (root === addedWorkspaceFolder.uri.fsPath) {
          addedDiscoveryEnteredResolve();
          return addedDiscoveryResponse;
        }
        assert.equal(root, removedWorkspaceFolder.uri.fsPath);
        discoveryEnteredResolve();
        return discoveryResponse;
      },
      get(root) {
        assert.equal(root, projectRoot);
        return project;
      },
      isGaugeProject(root) {
        return root === projectRoot;
      },
    },
    vscode,
  });

  await discoveryEntered;
  workspaceFolders.splice(1, 1, addedWorkspaceFolder);
  const folderChange = workspaceFolderListeners[0]({
    added: [addedWorkspaceFolder],
    removed: [removedWorkspaceFolder],
  });
  await addedDiscoveryEntered;
  assert.deepEqual({ constructedClients, startedClients }, {
    constructedClients: 0,
    startedClients: 0,
  });

  discoveryResponseResolve([projectRoot]);
  await workspace.ready();
  let assertionError;
  try {
    assert.deepEqual({
      clientLanguages: workspace.getClientLanguageMap().size,
      clients: clients.size,
      constructedClients,
      pendingStarts: workspace.pendingServerStarts.size,
      startedClients,
    }, {
      clientLanguages: 0,
      clients: 0,
      constructedClients: 0,
      pendingStarts: 0,
      startedClients: 0,
    });
  } catch (error) {
    assertionError = error;
  } finally {
    addedDiscoveryResponseResolve([]);
    await folderChange;
    await workspace.dispose();
  }
  if (assertionError) {
    throw assertionError;
  }
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

test("GaugeWorkspace preserves clients owned by a retained nested workspace folder", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const outerFolder = { uri: { fsPath: "/workspace" } };
  const nestedFolder = { uri: { fsPath: "/workspace/shared" } };
  const workspaceFolders = [outerFolder, nestedFolder];
  const clients = new Map();
  const stopCalls = [];
  const sharedRoot = "/workspace/shared/gauge";
  const removedRoot = "/workspace/removed/gauge";
  const sharedPendingRoot = "/workspace/shared/pending";
  const pendingStart = Promise.resolve(undefined);
  const { contexts, vscode, workspaceFolderListeners } = createFakeVscode({ workspaceFolders });
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    projectFactory: {
      findGaugeProjectRootsAsync() {
        return [];
      },
      isGaugeProject() {
        return false;
      },
    },
    vscode,
  });
  await workspace.ready();
  contexts.length = 0;

  for (const root of [sharedRoot, removedRoot]) {
    clients.set(root, {
      client: {
        stop() {
          stopCalls.push(root);
          return Promise.resolve(undefined);
        },
      },
      project: { root: () => root },
    });
    workspace.clientLanguageMap.set(root, "kotlin");
    workspace.projectEnvironmentCache.set(root, { root });
  }
  workspace.pendingServerStarts.set(sharedPendingRoot, pendingStart);
  workspace.serverStartGenerations.set(sharedPendingRoot, 4);
  workspace.workspaceFolderProjectRoots.set(outerFolder.uri.fsPath, new Set([
    sharedRoot,
    removedRoot,
    sharedPendingRoot,
  ]));
  workspace.workspaceFolderProjectRoots.set(nestedFolder.uri.fsPath, new Set([
    sharedRoot,
    sharedPendingRoot,
  ]));
  const notifications = [];
  workspace.onDidChangeProjects((projectRoot) => {
    notifications.push(projectRoot);
  });

  workspaceFolders.splice(0, workspaceFolders.length, nestedFolder);
  await workspaceFolderListeners[0]({
    added: [],
    removed: [outerFolder],
  });
  const afterOuterRemoval = {
    clients: [...clients.keys()],
    contexts: [...contexts],
    environments: [...workspace.projectEnvironmentCache.keys()],
    languages: [...workspace.clientLanguageMap.keys()],
    notifications: [...notifications],
    pendingGeneration: workspace.serverStartGeneration(sharedPendingRoot),
    pendingStart: workspace.pendingServerStarts.get(sharedPendingRoot),
    stopCalls: [...stopCalls],
  };

  workspaceFolders.splice(0, workspaceFolders.length);
  await workspaceFolderListeners[0]({
    added: [],
    removed: [nestedFolder],
  });
  const afterNestedRemoval = {
    clients: clients.size,
    environments: workspace.projectEnvironmentCache.size,
    languages: workspace.clientLanguageMap.size,
    notifications: [...notifications],
    pendingGeneration: workspace.serverStartGeneration(sharedPendingRoot),
    pendingStarts: workspace.pendingServerStarts.size,
    stopCalls: [...stopCalls],
  };
  await workspace.dispose();

  assert.deepEqual(afterOuterRemoval, {
    clients: [sharedRoot],
    contexts: [
      { command: "setContext", key: "gauge:multipleProjects?", value: false },
    ],
    environments: [sharedRoot],
    languages: [sharedRoot],
    notifications: [sharedRoot],
    pendingGeneration: 4,
    pendingStart,
    stopCalls: [removedRoot],
  });
  assert.deepEqual(afterNestedRemoval, {
    clients: 0,
    environments: 0,
    languages: 0,
    notifications: [sharedRoot, undefined],
    pendingGeneration: 5,
    pendingStarts: 0,
    stopCalls: [removedRoot, sharedRoot],
  });
});

test("GaugeWorkspace removes ownerless clients started while added folders are discovered", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const removedFolder = { uri: { fsPath: "/workspace/removed" } };
  const addedFolder = { uri: { fsPath: "/workspace/added" } };
  const lateProjectRoot = "/workspace/removed/late";
  const addedDiscoveryEntered = deferred();
  const addedDiscoveryResponse = deferred();
  const pendingStart = Promise.resolve(undefined);
  const { vscode } = createFakeVscode({ workspaceFolders: [] });
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: new Map(),
    fileSystem: createFakeFileSystem({}),
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();
  workspace.startServersForWorkspaceFolder = async (workspaceRoot) => {
    assert.equal(workspaceRoot, addedFolder.uri.fsPath);
    addedDiscoveryEntered.resolve();
    return addedDiscoveryResponse.promise;
  };

  const change = workspace.onWorkspaceFoldersChanged({
    added: [addedFolder],
    removed: [removedFolder],
  });
  await addedDiscoveryEntered.promise;
  workspace.pendingServerStarts.set(lateProjectRoot, pendingStart);
  workspace.serverStartGenerations.set(lateProjectRoot, 7);
  addedDiscoveryResponse.resolve();
  await change;
  const observed = {
    generation: workspace.serverStartGeneration(lateProjectRoot),
    pendingStart: workspace.pendingServerStarts.get(lateProjectRoot),
    pendingStarts: workspace.pendingServerStarts.size,
  };
  await workspace.dispose();

  assert.deepEqual(observed, {
    generation: 8,
    pendingStart: undefined,
    pendingStarts: 0,
  });
});

test("GaugeWorkspace transfers project ownership within one folder change", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const removedFolder = { uri: { fsPath: "/workspace" } };
  const addedFolder = { uri: { fsPath: "/workspace/shared" } };
  const projectRoot = "/workspace/shared/gauge";
  const clients = new Map();
  let stopCalls = 0;
  const client = {
    stop() {
      stopCalls += 1;
      return Promise.resolve(undefined);
    },
  };
  const workspaceFolders = [removedFolder];
  const { vscode } = createFakeVscode({ workspaceFolders });
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    projectFactory: {
      findGaugeProjectRootsAsync(workspaceRoot) {
        return workspaceRoot === addedFolder.uri.fsPath ? [projectRoot] : [];
      },
      isGaugeProject() {
        return false;
      },
    },
    vscode,
  });
  await workspace.ready();
  clients.set(projectRoot, {
    client,
    project: { root: () => projectRoot },
  });
  workspace.clientLanguageMap.set(projectRoot, "kotlin");
  workspace.projectEnvironmentCache.set(projectRoot, { root: projectRoot });
  workspace.workspaceFolderProjectRoots.set(removedFolder.uri.fsPath, new Set([projectRoot]));
  workspace.startServerFor = async (root) => {
    assert.equal(root, projectRoot);
    return client;
  };

  assert.deepEqual(
    [...workspace.workspaceFolderProjectRoots.entries()].map(([root, projects]) => (
      [root, [...projects]]
    )),
    [[removedFolder.uri.fsPath, [projectRoot]]],
  );
  workspaceFolders.splice(0, workspaceFolders.length, addedFolder);
  await workspace.onWorkspaceFoldersChanged({
    added: [addedFolder],
    removed: [removedFolder],
  });
  const observed = {
    client: clients.get(projectRoot).client,
    environments: [...workspace.projectEnvironmentCache.keys()],
    languages: [...workspace.clientLanguageMap.keys()],
    owners: [...workspace.workspaceFolderProjectRoots.entries()].map(([root, projects]) => (
      [root, [...projects]]
    )),
    stopCalls,
  };
  await workspace.dispose();

  assert.deepEqual(observed, {
    client,
    environments: [projectRoot],
    languages: [projectRoot],
    owners: [[addedFolder.uri.fsPath, [projectRoot]]],
    stopCalls: 0,
  });
});

test("GaugeWorkspace removes projects only after their last discovering workspace folder", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const outerFolder = { uri: { fsPath: "/workspace" } };
  const sharedFolder = { uri: { fsPath: "/workspace/service" } };
  const excludedFolder = { uri: { fsPath: "/workspace/build" } };
  const workspaceFolders = [outerFolder, sharedFolder, excludedFolder];
  const sharedRoot = "/workspace/service";
  const excludedRoot = "/workspace/build/gauge";
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    [`${sharedRoot}/manifest.json`]: JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    [`${sharedRoot}/build.gradle.kts`]: "",
    [`${excludedRoot}/manifest.json`]: JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    [`${excludedRoot}/build.gradle.kts`]: "",
  });
  const { contexts, vscode, workspaceFolderListeners } = createFakeVscode({ workspaceFolders });
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
  contexts.length = 0;
  const sharedClient = clients.get(sharedRoot).client;
  const excludedClient = clients.get(excludedRoot).client;
  const notifications = [];
  workspace.onDidChangeProjects((projectRoot) => {
    notifications.push(projectRoot);
  });

  workspaceFolders.splice(0, workspaceFolders.length, outerFolder, sharedFolder);
  await workspaceFolderListeners[0]({ added: [], removed: [excludedFolder] });
  const afterExclusiveOwnerRemoval = {
    clients: [...clients.keys()],
    excludedStopped: excludedClient.stopped,
    notifications: [...notifications],
    sharedStopped: sharedClient.stopped,
  };

  workspaceFolders.splice(0, workspaceFolders.length, sharedFolder);
  await workspaceFolderListeners[0]({ added: [], removed: [outerFolder] });
  const afterSharedOwnerRemoval = {
    clients: [...clients.keys()],
    notifications: [...notifications],
    sharedStopped: sharedClient.stopped,
  };

  workspaceFolders.splice(0, workspaceFolders.length);
  await workspaceFolderListeners[0]({ added: [], removed: [sharedFolder] });
  const afterLastOwnerRemoval = {
    clients: clients.size,
    notifications: [...notifications],
    sharedStopped: sharedClient.stopped,
  };
  await workspace.dispose();

  assert.deepEqual(afterExclusiveOwnerRemoval, {
    clients: [sharedRoot],
    excludedStopped: true,
    notifications: [sharedRoot],
    sharedStopped: false,
  });
  assert.deepEqual(afterSharedOwnerRemoval, {
    clients: [sharedRoot],
    notifications: [sharedRoot],
    sharedStopped: false,
  });
  assert.deepEqual(afterLastOwnerRemoval, {
    clients: 0,
    notifications: [sharedRoot, undefined],
    sharedStopped: true,
  });
  assert.deepEqual(contexts, [
    { command: "setContext", key: "gauge:multipleProjects?", value: false },
    { command: "setContext", key: "gauge:multipleProjects?", value: false },
    { command: "setContext", key: "gauge:multipleProjects?", value: false },
  ]);
});

test("GaugeWorkspace keeps one pending client until its last discovering folder is removed", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const outerFolder = { uri: { fsPath: "/workspace" } };
  const nestedFolder = { uri: { fsPath: "/workspace/gauge" } };
  const workspaceFolders = [outerFolder, nestedFolder];
  const projectRoot = nestedFolder.uri.fsPath;
  const clients = new GaugeClients();
  const startEntered = deferred();
  const startResponse = deferred();
  const discoveryRoots = [];
  let constructedClients = 0;
  let startCalls = 0;
  let stopCalls = 0;
  class PendingLanguageClient extends FakeLanguageClient {
    constructor(...args) {
      super(...args);
      constructedClients += 1;
    }

    start() {
      this.started = true;
      startCalls += 1;
      startEntered.resolve();
      return startResponse.promise;
    }

    stop() {
      stopCalls += 1;
      return super.stop();
    }
  }
  const project = {
    envs() {
      return {};
    },
    hasFile(filename) {
      return filename === projectRoot || filename.startsWith(`${projectRoot}/`);
    },
    isProjectLanguage() {
      return false;
    },
    language() {
      return "kotlin";
    },
    root() {
      return projectRoot;
    },
  };
  const { vscode, workspaceFolderListeners } = createFakeVscode({ workspaceFolders });
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), {
      version: "1.2.3",
      plugins: [{ name: "kotlin", version: "0.9.0" }],
    }),
    clientsMap: clients,
    LanguageClient: PendingLanguageClient,
    pathModule: path.posix,
    projectFactory: {
      findGaugeProjectRootsAsync(workspaceRoot) {
        discoveryRoots.push(workspaceRoot);
        return [projectRoot];
      },
      get(root) {
        assert.equal(root, projectRoot);
        return project;
      },
      isGaugeProject(root) {
        return root === projectRoot;
      },
    },
    vscode,
  });
  const notifications = [];
  workspace.onDidChangeProjects((root) => {
    notifications.push(root);
  });

  await startEntered.promise;
  workspaceFolders.splice(0, workspaceFolders.length, nestedFolder);
  await workspaceFolderListeners[0]({ added: [], removed: [outerFolder] });
  const afterOuterRemoval = {
    clients: clients.size,
    constructedClients,
    discoveryRoots: [...discoveryRoots].sort(),
    generation: workspace.serverStartGeneration(projectRoot),
    notifications: [...notifications],
    pendingStarts: workspace.pendingServerStarts.size,
    startCalls,
    stopCalls,
  };

  startResponse.resolve();
  await workspace.ready();
  const client = clients.get(projectRoot).client;
  const afterStartSettles = {
    clients: clients.size,
    environments: [...workspace.projectEnvironmentCache.keys()],
    languages: [...workspace.clientLanguageMap.keys()],
    pendingStarts: workspace.pendingServerStarts.size,
    stopped: client.stopped,
  };

  workspaceFolders.splice(0, workspaceFolders.length);
  await workspaceFolderListeners[0]({ added: [], removed: [nestedFolder] });
  const afterLastOwnerRemoval = {
    clients: clients.size,
    environments: workspace.projectEnvironmentCache.size,
    generation: workspace.serverStartGeneration(projectRoot),
    languages: workspace.clientLanguageMap.size,
    notifications: [...notifications],
    pendingStarts: workspace.pendingServerStarts.size,
    stopCalls,
    stopped: client.stopped,
  };
  await workspace.dispose();

  assert.deepEqual(afterOuterRemoval, {
    clients: 1,
    constructedClients: 1,
    discoveryRoots: [outerFolder.uri.fsPath, nestedFolder.uri.fsPath],
    generation: 0,
    notifications: [],
    pendingStarts: 1,
    startCalls: 1,
    stopCalls: 0,
  });
  assert.deepEqual(afterStartSettles, {
    clients: 1,
    environments: [projectRoot],
    languages: [projectRoot],
    pendingStarts: 0,
    stopped: false,
  });
  assert.deepEqual(afterLastOwnerRemoval, {
    clients: 0,
    environments: 0,
    generation: 1,
    languages: 0,
    notifications: [undefined],
    pendingStarts: 0,
    stopCalls: 1,
    stopped: true,
  });
});

test("GaugeWorkspace removes every nested client when one folder-removal stop fails", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new Map();
  const firstStopEntered = deferred();
  const firstStopResponse = deferred();
  const stopError = new Error("first client stop failed");
  const stopCalls = [];
  const roots = [
    "/workspace/gauge/one",
    "/workspace/gauge/two",
    "/workspace/other/three",
  ];
  const { contexts, vscode, workspaceFolderListeners } = createFakeVscode({
    workspaceFolders: [],
  });
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem: createFakeFileSystem({}),
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();
  contexts.length = 0;

  clients.set(roots[0], {
    client: {
      stop() {
        stopCalls.push(roots[0]);
        firstStopEntered.resolve();
        return firstStopResponse.promise;
      },
    },
    project: { root: () => roots[0] },
  });
  clients.set(roots[1], {
    client: {
      stop() {
        stopCalls.push(roots[1]);
        return Promise.resolve(undefined);
      },
    },
    project: { root: () => roots[1] },
  });
  clients.set(roots[2], {
    client: {
      stop() {
        stopCalls.push(roots[2]);
        return Promise.resolve(undefined);
      },
    },
    project: { root: () => roots[2] },
  });
  for (const root of roots) {
    workspace.clientLanguageMap.set(root, "kotlin");
    workspace.projectEnvironmentCache.set(root, { root });
  }
  const notifications = [];
  workspace.onDidChangeProjects((projectRoot) => {
    notifications.push(projectRoot);
  });

  const folderChange = workspaceFolderListeners[0]({
    added: [],
    removed: [
      { uri: { fsPath: "/workspace/gauge" } },
      { uri: { fsPath: "/workspace/other" } },
    ],
  });
  let folderChangeSettled = false;
  folderChange.then(
    () => { folderChangeSettled = true; },
    () => { folderChangeSettled = true; },
  );
  await firstStopEntered.promise;
  await Promise.resolve();
  const beforeStopSettles = {
    clients: clients.size,
    contexts: [...contexts],
    environments: workspace.projectEnvironmentCache.size,
    languages: workspace.clientLanguageMap.size,
    notifications: [...notifications],
    settled: folderChangeSettled,
    stopCalls: [...stopCalls],
  };
  firstStopResponse.reject(stopError);
  const [outcome] = await Promise.allSettled([folderChange]);

  assert.deepEqual(beforeStopSettles, {
    clients: 0,
    contexts: [
      { command: "setContext", key: "gauge:multipleProjects?", value: false },
    ],
    environments: 0,
    languages: 0,
    notifications: [undefined],
    settled: false,
    stopCalls: roots,
  });
  assert.equal(outcome.status, "fulfilled");
  assert.deepEqual(stopCalls, roots);
  assert.equal(clients.size, 0);
  assert.equal(workspace.clientLanguageMap.size, 0);
  assert.equal(workspace.projectEnvironmentCache.size, 0);
  assert.deepEqual(contexts, [
    { command: "setContext", key: "gauge:multipleProjects?", value: false },
  ]);
  assert.deepEqual(notifications, [undefined]);
  await workspace.dispose();
});

test("GaugeWorkspace reports a nested stop failure after draining folder cleanup", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new Map();
  const stopError = new Error("nested client stop failed");
  const stopCalls = [];
  const roots = [
    "/workspace/gauge/one",
    "/workspace/gauge/two",
  ];
  const { vscode } = createFakeVscode({ workspaceFolders: [] });
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem: createFakeFileSystem({}),
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  for (const [index, root] of roots.entries()) {
    clients.set(root, {
      client: {
        stop() {
          stopCalls.push(root);
          if (index === 0) {
            throw stopError;
          }
          return Promise.resolve(undefined);
        },
      },
      project: { root: () => root },
    });
    workspace.clientLanguageMap.set(root, "kotlin");
  }
  workspace.workspaceFolderProjectRoots.set("/workspace/owner-one", new Set(roots));
  workspace.workspaceFolderProjectRoots.set("/workspace/owner-two", new Set(roots));

  await assert.rejects(
    workspace.stopServersForWorkspaceFolder("/workspace/gauge"),
    (error) => error === stopError,
  );
  assert.deepEqual(stopCalls, roots);
  assert.equal(clients.size, 0);
  assert.equal(workspace.clientLanguageMap.size, 0);
  await workspace.dispose();
});

test("GaugeWorkspace observes removal stops before publishing workspace state", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const contextEntered = deferred();
  const contextResponse = deferred();
  const stopResponse = deferred();
  const contextError = new Error("context publication failed");
  const stopError = new Error("client stop failed");
  let stopObservers = 0;
  const { vscode } = createFakeVscode({ workspaceFolders: [] });
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: new Map(),
    fileSystem: createFakeFileSystem({}),
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();
  workspace.stopProjectRoots = () => ({
    then(resolve, reject) {
      stopObservers += 1;
      stopResponse.promise.then(resolve, reject);
    },
  });
  workspace.setMultiProjectContext = () => {
    contextEntered.resolve();
    return contextResponse.promise;
  };

  const change = workspace.onWorkspaceFoldersChanged({
    added: [],
    removed: [{ uri: { fsPath: "/workspace/gauge" } }],
  });
  const outcomePromise = Promise.allSettled([change]);
  await contextEntered.promise;
  await Promise.resolve();
  const observersBeforePublicationSettles = stopObservers;
  stopResponse.reject(stopError);
  contextResponse.reject(contextError);
  const [outcome] = await outcomePromise;

  assert.equal(observersBeforePublicationSettles, 1);
  assert.equal(stopObservers, 1);
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.reason, contextError);
  await workspace.dispose();
});

test("GaugeWorkspace drains project listeners before reporting a listener failure", async () => {
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  for (const failureMode of ["synchronous", "asynchronous"]) {
    const listenerError = new Error(`${failureMode} project listener failed`);
    const releaseHealthyListener = deferred();
    const calls = [];
    const workspace = Object.create(GaugeWorkspace.prototype);
    workspace.clientsMap = new Map([["/workspace/remaining", {}]]);
    workspace.projectChangeListeners = new Set();
    workspace.onDidChangeProjects((projectRoot) => {
      calls.push(["failing", projectRoot]);
      if (failureMode === "synchronous") {
        throw listenerError;
      }
      return Promise.reject(listenerError);
    });
    workspace.onDidChangeProjects(async (projectRoot) => {
      calls.push(["healthy", projectRoot]);
      await releaseHealthyListener.promise;
      calls.push(["healthy-complete", projectRoot]);
    });

    let outcome;
    const notification = workspace.notifyProjectsChanged();
    notification.then(
      (value) => {
        outcome = { status: "fulfilled", value };
      },
      (reason) => {
        outcome = { reason, status: "rejected" };
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    const beforeHealthyListenerCompletes = {
      calls: [...calls],
      outcome,
    };
    releaseHealthyListener.resolve();
    const [settlement] = await Promise.allSettled([notification]);

    assert.deepEqual(beforeHealthyListenerCompletes, {
      calls: [
        ["failing", "/workspace/remaining"],
        ["healthy", "/workspace/remaining"],
      ],
      outcome: undefined,
    });
    assert.deepEqual(calls, [
      ["failing", "/workspace/remaining"],
      ["healthy", "/workspace/remaining"],
      ["healthy-complete", "/workspace/remaining"],
    ]);
    assert.equal(settlement.status, "rejected");
    assert.equal(settlement.reason, listenerError);
  }
});

test("GaugeWorkspace isolates project listener failures from folder events", async () => {
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const listenerError = new Error("project listener failed during folder event");
  const stopError = new Error("removed project stop failed");
  const stopResponse = deferred();
  const calls = [];
  let eventOutcome;
  let projectRootsKeyCalls = 0;
  const workspace = Object.create(GaugeWorkspace.prototype);
  workspace.clientsMap = new Map([["/workspace/remaining", {}]]);
  workspace.pathModule = path.posix;
  workspace.pendingServerStarts = new Map();
  workspace.projectChangeListeners = new Set();
  workspace.workspaceFolderProjectRoots = new Map();
  workspace.projectRootsKey = () => {
    projectRootsKeyCalls += 1;
    return projectRootsKeyCalls === 1 ? "before" : "after";
  };
  workspace.setMultiProjectContext = async () => {
    calls.push("context");
  };
  workspace.stopProjectRoots = () => {
    calls.push("stops");
    return stopResponse.promise;
  };
  workspace.onDidChangeProjects(() => {
    calls.push("failing");
    throw listenerError;
  });
  workspace.onDidChangeProjects(() => {
    calls.push("healthy");
  });

  const eventResult = workspace.onWorkspaceFoldersChanged({ added: [], removed: [] });
  eventResult.then(
    (value) => {
      eventOutcome = { status: "fulfilled", value };
    },
    (reason) => {
      eventOutcome = { reason, status: "rejected" };
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  const beforeStopSettles = {
    calls: [...calls],
    eventOutcome,
  };
  stopResponse.reject(stopError);
  const result = await eventResult;

  assert.equal(result, undefined);
  assert.deepEqual(beforeStopSettles, {
    calls: ["stops", "context", "failing", "healthy"],
    eventOutcome: undefined,
  });
  assert.deepEqual(calls, ["stops", "context", "failing", "healthy"]);
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
