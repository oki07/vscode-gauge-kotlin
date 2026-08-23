const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createFakeVscode(overrides = {}) {
  const commands = [];
  const contexts = [];
  const documents = [];
  const errors = [];
  const shownDocuments = [];
  const treeProviders = [];
  const watcherListeners = [];
  const watchers = [];
  class EventEmitter {
    constructor() {
      this.events = [];
      this.event = (listener) => {
        this.listener = listener;
        return { dispose() {} };
      };
    }

    fire(value) {
      this.events.push(value);
      if (this.listener) {
        this.listener(value);
      }
    }

    dispose() {}
  }

  const vscode = {
    CancellationTokenSource: class CancellationTokenSource {
      constructor() {
        this.token = { cancelled: false };
      }
    },
    EventEmitter,
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Range: class Range {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    TreeItemCollapsibleState: {
      Collapsed: 1,
    },
    Uri: {
      file(filename) {
        return { fsPath: filename };
      },
    },
    commands: {
      executeCommand(command, key, value) {
        contexts.push({ command, key, value });
        return Promise.resolve(undefined);
      },
      registerCommand(command, handler) {
        const disposable = { dispose() {} };
        commands.push({ command, handler, disposable });
        return disposable;
      },
    },
    window: {
      registerTreeDataProvider(viewId, provider) {
        const disposable = { dispose() {} };
        treeProviders.push({ viewId, provider, disposable });
        return disposable;
      },
      showErrorMessage(message, ...rest) {
        const items = rest.filter((entry) => (
          typeof entry === "string" || (entry && typeof entry.title === "string")
        ));
        errors.push({ message, actions: items });
        return Promise.resolve(undefined);
      },
      showInformationMessage(message) {
        errors.push({ message });
        return Promise.resolve(undefined);
      },
      showTextDocument(document, options) {
        shownDocuments.push({ document, options });
        return Promise.resolve({ document, options });
      },
    },
    workspace: {
      createFileSystemWatcher(pattern, ignoreCreate, ignoreChange, ignoreDelete) {
        const watcher = {
          pattern,
          ignoreCreate,
          ignoreChange,
          ignoreDelete,
          onDidCreate(listener) {
            watcherListeners.push({ event: "create", listener });
            return { dispose() {} };
          },
          onDidDelete(listener) {
            watcherListeners.push({ event: "delete", listener });
            return { dispose() {} };
          },
          dispose() {},
        };
        watchers.push(watcher);
        return watcher;
      },
      getConfiguration(section) {
        assert.equal(section, "gauge.specExplorer");
        return {
          get(key) {
            assert.equal(key, "enabled");
            return overrides.enabled ?? true;
          },
        };
      },
      onDidCloseTextDocument(listener) {
        watcherListeners.push({ event: "close", listener });
        return { dispose() {} };
      },
      onDidSaveTextDocument(listener) {
        watcherListeners.push({ event: "save", listener });
        return { dispose() {} };
      },
      openTextDocument(filename) {
        documents.push(filename);
        return Promise.resolve({ fileName: filename });
      },
    },
  };

  return {
    commands,
    contexts,
    documents,
    errors,
    shownDocuments,
    treeProviders,
    vscode,
    watcherListeners,
    watchers,
  };
}

function createFakeWorkspace(client, overrides = {}) {
  const clientsMap = overrides.clientsMap || new Map([
    [
      "/workspace/gauge",
      {
        client,
        project: {
          root() {
            return "/workspace/gauge";
          },
        },
      },
    ],
  ]);
  const projectChangeListeners = [];
  return {
    changes: [],
    projectChangeListeners,
    getClientsMap() {
      return {
        get(filename) {
          return clientsMap.get(filename) || clientsMap.get("/workspace/gauge");
        },
      };
    },
    getDefaultFolder() {
      if (overrides.getDefaultFolder) {
        return overrides.getDefaultFolder();
      }
      return "/workspace/gauge";
    },
    onDidChangeProjects(listener) {
      projectChangeListeners.push(listener);
      return { dispose() {} };
    },
    showProjectOptions(onChange) {
      this.changes.push("showProjectOptions");
      return onChange("/workspace/gauge");
    },
  };
}

function createFakeClient() {
  const requests = [];
  return {
    requests,
    started: 0,
    sendRequest(method, params, token) {
      requests.push({ method, params, token });
      if (method === "gauge/specs") {
        return Promise.resolve([
          {
            heading: "Checkout",
            executionIdentifier: "/workspace/gauge/specs/checkout.spec",
          },
        ]);
      }
      if (method === "gauge/scenarios") {
        return Promise.resolve([
          {
            heading: "Successful checkout",
            executionIdentifier: "/workspace/gauge/specs/checkout.spec:12",
            lineNo: 12,
          },
        ]);
      }
      return Promise.resolve([]);
    },
    start() {
      this.started += 1;
      return Promise.resolve(undefined);
    },
  };
}

test("SpecNodeProvider populates specifications and scenarios from Gauge LSP", async () => {
  const { Scenario, SpecNodeProvider } = require("../src/explorer/specExplorer");
  const client = createFakeClient();
  const { contexts, treeProviders, vscode } = createFakeVscode();
  const workspace = createFakeWorkspace(client);
  const timers = [];

  const provider = new SpecNodeProvider(workspace, {
    pathModule: path.posix,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return { unref() {} };
    },
    vscode,
  });
  await provider.ready();

  assert.equal(client.started, 1);
  assert.deepEqual(treeProviders.map((entry) => entry.viewId), ["gauge:specExplorer"]);
  assert.deepEqual(contexts, [
    { command: "setContext", key: "gauge:activated", value: false },
  ]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 1000);

  await timers[0].callback();

  assert.deepEqual(contexts, [
    { command: "setContext", key: "gauge:activated", value: false },
    { command: "setContext", key: "gauge:activated", value: true },
  ]);

  const specs = await provider.getChildren();
  assert.equal(specs.length, 1);
  assert.equal(specs[0].label, "Checkout");
  assert.equal(specs[0].file, "/workspace/gauge/specs/checkout.spec");
  assert.equal(specs[0].contextValue, "specification");
  assert.equal(specs[0].collapsibleState, 1);
  assert.equal(specs[0].command.command, "gauge.open");
  assert.equal(specs[0].command.arguments[0], specs[0]);

  const scenarios = await provider.getChildren(specs[0]);
  assert.equal(scenarios.length, 1);
  assert.ok(scenarios[0] instanceof Scenario);
  assert.equal(scenarios[0].label, "Successful checkout");
  assert.equal(scenarios[0].file, "/workspace/gauge/specs/checkout.spec");
  assert.equal(scenarios[0].lineNo, 12);
  assert.equal(scenarios[0].executionIdentifier, "/workspace/gauge/specs/checkout.spec:12");
  assert.equal(scenarios[0].contextValue, "scenario");
  assert.deepEqual(client.requests.map((request) => request.method), [
    "gauge/specs",
    "gauge/scenarios",
  ]);
});

test("SpecNodeProvider registers explorer commands without Test UI flags", async () => {
  const { Spec, SpecNodeProvider } = require("../src/explorer/specExplorer");
  const client = createFakeClient();
  const executionCalls = [];
  const { commands, documents, shownDocuments, vscode } = createFakeVscode();
  const workspace = createFakeWorkspace(client);
  const provider = new SpecNodeProvider(workspace, {
    executionController: {
      handleCommand(...args) {
        executionCalls.push(args);
        return Promise.resolve("handled");
      },
    },
    pathModule: path.posix,
    vscode,
  });
  await provider.ready();

  const byName = new Map(commands.map((entry) => [entry.command, entry.handler]));
  assert.deepEqual([...byName.keys()].sort(), [
    "gauge.open",
    "gauge.specexplorer.debugNode",
    "gauge.specexplorer.runAllActiveProjectSpecs",
    "gauge.specexplorer.runNode",
    "gauge.specexplorer.switchProject",
  ]);

  const spec = new Spec("Checkout", "/workspace/gauge/specs/checkout.spec", vscode);
  await byName.get("gauge.specexplorer.runAllActiveProjectSpecs")();
  await byName.get("gauge.specexplorer.runNode")(spec);
  await byName.get("gauge.specexplorer.debugNode")(spec);
  await byName.get("gauge.specexplorer.switchProject")();
  await byName.get("gauge.open")(spec);

  assert.deepEqual(executionCalls, [
    ["gauge.specexplorer.runAllActiveProjectSpecs", { projectRoot: "/workspace/gauge" }],
    ["gauge.specexplorer.runNode", spec],
    ["gauge.specexplorer.debugNode", spec],
  ]);
  assert.deepEqual(workspace.changes, ["showProjectOptions"]);
  assert.deepEqual(documents, ["/workspace/gauge/specs/checkout.spec"]);
  assert.equal(shownDocuments[0].options.selection.start.line, 0);
});

test("SpecNodeProvider refreshes when active project spec files change", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const client = createFakeClient();
  const activeEntry = {
    client,
    project: {
      root() {
        return "/workspace/gauge";
      },
    },
  };
  const otherEntry = {
    client: createFakeClient(),
    project: {
      root() {
        return "/workspace/other";
      },
    },
  };
  const { vscode, watcherListeners } = createFakeVscode();
  const workspace = createFakeWorkspace(client, {
    clientsMap: {
      get(filename) {
        if (filename === "/workspace/gauge" || filename.startsWith("/workspace/gauge/")) {
          return activeEntry;
        }
        if (filename === "/workspace/other" || filename.startsWith("/workspace/other/")) {
          return otherEntry;
        }
        return undefined;
      },
    },
  });
  const provider = new SpecNodeProvider(workspace, {
    pathModule: path.posix,
    vscode,
  });
  const refreshes = [];
  provider.onDidChangeTreeData((value) => {
    refreshes.push(value);
  });
  await provider.ready();
  refreshes.length = 0;

  const byEvent = new Map(watcherListeners.map((entry) => [entry.event, entry.listener]));
  byEvent.get("save")({ uri: { fsPath: "/workspace/gauge/specs/saved.spec" } });
  byEvent.get("close")({ uri: { fsPath: "/workspace/gauge/specs/closed.md" } });
  byEvent.get("create")({ fsPath: "/workspace/gauge/specs/created.spec" });
  byEvent.get("delete")({ fsPath: "/workspace/gauge/specs/deleted.md" });
  byEvent.get("create")({ fsPath: "/workspace/gauge/specs/ignored.txt" });
  byEvent.get("delete")({ fsPath: "/workspace/other/specs/other.spec" });

  assert.deepEqual(watcherListeners.map((entry) => entry.event), [
    "save",
    "close",
    "create",
    "delete",
  ]);
  assert.deepEqual(refreshes, [undefined, undefined, undefined, undefined]);
});

test("SpecNodeProvider changes client when workspace projects change", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const firstClient = createFakeClient();
  const secondClient = createFakeClient();
  let defaultFolder = "/workspace/one";
  const clientsMap = new Map([
    [
      "/workspace/one",
      {
        client: firstClient,
        project: {
          root() {
            return "/workspace/one";
          },
        },
      },
    ],
    [
      "/workspace/two",
      {
        client: secondClient,
        project: {
          root() {
            return "/workspace/two";
          },
        },
      },
    ],
  ]);
  const { vscode } = createFakeVscode();
  const workspace = createFakeWorkspace(firstClient, {
    clientsMap,
    getDefaultFolder() {
      return defaultFolder;
    },
  });

  const provider = new SpecNodeProvider(workspace, {
    pathModule: path.posix,
    vscode,
  });
  await provider.ready();

  assert.equal(firstClient.started, 1);
  assert.equal(workspace.projectChangeListeners.length, 1);

  defaultFolder = "/workspace/two";
  await workspace.projectChangeListeners[0](defaultFolder);

  assert.equal(secondClient.started, 1);
  const specs = await provider.getChildren();
  assert.equal(specs.length, 1);
  assert.deepEqual(secondClient.requests.map((request) => request.method), ["gauge/specs"]);
});

test("SpecNodeProvider disables the activated context when spec explorer is disabled", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const client = createFakeClient();
  const {
    commands,
    contexts,
    treeProviders,
    vscode,
    watcherListeners,
  } = createFakeVscode({ enabled: false });
  const workspace = createFakeWorkspace(client);

  const provider = new SpecNodeProvider(workspace, {
    pathModule: path.posix,
    vscode,
  });
  await provider.ready();

  assert.deepEqual(contexts, [
    { command: "setContext", key: "gauge:activated", value: false },
  ]);
  assert.deepEqual(treeProviders, []);
  assert.deepEqual(commands, []);
  assert.deepEqual(watcherListeners, []);
  assert.equal(client.started, 0);
});

test("SpecNodeProvider watcher listens for spec creation and deletion events", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const client = createFakeClient();
  const { vscode, watchers } = createFakeVscode();
  const workspace = createFakeWorkspace(client);

  const provider = new SpecNodeProvider(workspace, {
    pathModule: path.posix,
    setTimeout() {
      return { unref() {} };
    },
    vscode,
  });
  await provider.ready();

  assert.equal(watchers.length, 1);
  assert.equal(watchers[0].ignoreCreate, false);
  assert.equal(watchers[0].ignoreChange, true);
  assert.equal(watchers[0].ignoreDelete, false);
});

test("SpecNodeProvider reports why the test explorer could not be created", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const client = createFakeClient();
  client.start = () => Promise.reject(new Error("gauge daemon exited 1"));
  const { errors, vscode } = createFakeVscode();
  const workspace = createFakeWorkspace(client);

  const provider = new SpecNodeProvider(workspace, {
    pathModule: path.posix,
    setTimeout(callback, delay) {
      return { unref() {} };
    },
    vscode,
  });
  await provider.ready();

  assert.deepEqual(errors, [
    {
      message: "Failed to create test explorer. gauge daemon exited 1",
      actions: [],
    },
  ]);
});

test("SpecNodeProvider disposal ignores pending client activation", async () => {
  const { Spec, SpecNodeProvider } = require("../src/explorer/specExplorer");
  const startEntered = deferred();
  const startResponse = deferred();
  const client = createFakeClient();
  let startCalls = 0;
  client.start = () => {
    startCalls += 1;
    startEntered.resolve();
    return startResponse.promise;
  };
  const executionCalls = [];
  const timers = [];
  const {
    contexts,
    documents,
    vscode,
  } = createFakeVscode();
  const workspace = createFakeWorkspace(client);
  const provider = new SpecNodeProvider(workspace, {
    executionController: {
      handleCommand(...args) {
        executionCalls.push(args);
        return Promise.resolve(undefined);
      },
    },
    pathModule: path.posix,
    setTimeout(callback, delay) {
      const handle = { callback, delay, unref() {} };
      timers.push(handle);
      return handle;
    },
    vscode,
  });
  const refreshes = [];
  provider.onDidChangeTreeData((value) => refreshes.push(value));
  const disposalCalls = provider.disposables.map(() => 0);
  for (const [index, disposable] of provider.disposables.entries()) {
    const originalDispose = disposable.dispose.bind(disposable);
    disposable.dispose = () => {
      disposalCalls[index] += 1;
      originalDispose();
    };
  }
  let emitterDisposals = 0;
  const originalEmitterDispose = provider.onDidChangeTreeDataEmitter.dispose.bind(
    provider.onDidChangeTreeDataEmitter,
  );
  provider.onDidChangeTreeDataEmitter.dispose = () => {
    emitterDisposals += 1;
    originalEmitterDispose();
  };

  await startEntered.promise;
  provider.dispose();
  provider.dispose();
  const retainedProjectChange = workspace.projectChangeListeners[0]("/workspace/gauge");
  startResponse.resolve(undefined);
  await Promise.all([provider.ready(), Promise.resolve(retainedProjectChange)]);

  provider.refresh();
  const node = new Spec("Checkout", "/workspace/gauge/specs/checkout.spec", vscode);
  const children = await provider.getChildren();
  await Promise.resolve(provider.runAllActiveProjectSpecs());
  await Promise.resolve(provider.runNode(node, false));
  await Promise.resolve(provider.openNode(node));

  assert.deepEqual({
    activeFolder: provider.activeFolder,
    children,
    contextTrueCalls: contexts.filter((entry) => entry.value === true).length,
    disposalCalls,
    documents,
    emitterDisposals,
    executionCalls,
    languageClient: provider.languageClient,
    refreshes,
    requests: client.requests.map((request) => request.method),
    startCalls,
    timers: timers.length,
  }, {
    activeFolder: undefined,
    children: [],
    contextTrueCalls: 0,
    disposalCalls: disposalCalls.map(() => 1),
    documents: [],
    emitterDisposals: 1,
    executionCalls: [],
    languageClient: undefined,
    refreshes: [],
    requests: [],
    startCalls: 1,
    timers: 0,
  });
});

test("SpecNodeProvider disposal suppresses pending activation failures", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const startResponse = deferred();
  const client = createFakeClient();
  client.start = () => startResponse.promise;
  const timers = [];
  const { errors, vscode } = createFakeVscode();
  const provider = new SpecNodeProvider(createFakeWorkspace(client), {
    pathModule: path.posix,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return { unref() {} };
    },
    vscode,
  });

  provider.dispose();
  startResponse.reject(new Error("gauge daemon exited after disposal"));

  await assert.doesNotReject(() => provider.ready());
  assert.deepEqual({
    activeFolder: provider.activeFolder,
    errors,
    languageClient: provider.languageClient,
    timers: timers.length,
  }, {
    activeFolder: undefined,
    errors: [],
    languageClient: undefined,
    timers: 0,
  });
});

test("SpecNodeProvider disposal neutralizes a pending activation error message", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const outcomes = [];

  for (const settlement of ["resolve", "reject"]) {
    const errorShown = deferred();
    const messageResponse = deferred();
    const client = createFakeClient();
    client.start = () => Promise.reject(new Error(`live start ${settlement}`));
    const { errors, vscode } = createFakeVscode();
    vscode.window.showErrorMessage = (message) => {
      errors.push({ actions: [], message });
      errorShown.resolve();
      return messageResponse.promise;
    };
    const provider = new SpecNodeProvider(createFakeWorkspace(client), {
      pathModule: path.posix,
      vscode,
    });

    await errorShown.promise;
    const ready = provider.ready();
    provider.dispose();
    if (settlement === "resolve") {
      messageResponse.resolve("Dismissed");
    } else {
      messageResponse.reject(new Error("error UI closed during disposal"));
    }
    outcomes.push({
      activeFolder: provider.activeFolder,
      errors,
      outcome: (await Promise.allSettled([ready]))[0],
    });
  }

  assert.deepEqual(outcomes, [
    {
      activeFolder: undefined,
      errors: [
        {
          actions: [],
          message: "Failed to create test explorer. live start resolve",
        },
      ],
      outcome: { status: "fulfilled", value: undefined },
    },
    {
      activeFolder: undefined,
      errors: [
        {
          actions: [],
          message: "Failed to create test explorer. live start reject",
        },
      ],
      outcome: { status: "fulfilled", value: undefined },
    },
  ]);
});

test("SpecNodeProvider disposal neutralizes tree requests and timers", async () => {
  const { Spec, SpecNodeProvider } = require("../src/explorer/specExplorer");
  const specsEntered = deferred();
  const specsResponse = deferred();
  const scenariosEntered = deferred();
  const scenariosResponse = deferred();
  const requests = [];
  const client = createFakeClient();
  client.sendRequest = (method, params, token) => {
    requests.push({ method, params, token });
    if (method === "gauge/specs") {
      specsEntered.resolve();
      return specsResponse.promise;
    }
    scenariosEntered.resolve();
    return scenariosResponse.promise;
  };
  const sources = [];
  const timers = [];
  const { contexts, errors, vscode } = createFakeVscode();
  vscode.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
      this.cancelCalls = 0;
      this.disposeCalls = 0;
      this.token = { isCancellationRequested: false };
      sources.push(this);
    }

    cancel() {
      this.cancelCalls += 1;
      this.token.isCancellationRequested = true;
    }

    dispose() {
      this.disposeCalls += 1;
    }
  };
  const provider = new SpecNodeProvider(createFakeWorkspace(client), {
    clearTimeout(handle) {
      handle.clearCalls += 1;
    },
    pathModule: path.posix,
    setTimeout(callback, delay) {
      const handle = {
        callback,
        clearCalls: 0,
        delay,
        unref() {},
      };
      timers.push(handle);
      return handle;
    },
    vscode,
  });
  await provider.ready();
  assert.equal(timers.length, 1);

  const spec = new Spec("Checkout", "/workspace/gauge/specs/checkout.spec", vscode);
  const pendingSpecs = provider.getChildren();
  const pendingScenarios = provider.getChildren(spec);
  await Promise.all([specsEntered.promise, scenariosEntered.promise]);
  provider.dispose();
  provider.dispose();

  specsResponse.resolve([
    {
      heading: "Late checkout",
      executionIdentifier: "/workspace/gauge/specs/late.spec",
    },
  ]);
  scenariosResponse.reject(new Error("late scenario failure"));
  const pendingOutcomes = await Promise.allSettled([pendingSpecs, pendingScenarios]);
  const laterOutcomes = await Promise.allSettled([
    provider.getChildren(),
    provider.getChildren(spec),
    provider.getSpecifications(),
    provider.getScenarios(spec),
  ]);
  await Promise.resolve(timers[0].callback());

  assert.deepEqual({
    contextTrueCalls: contexts.filter((entry) => entry.value === true).length,
    errors,
    laterOutcomes,
    pendingOutcomes,
    requests: requests.map((request) => request.method),
    sourceCalls: sources.map((source) => ({
      cancel: source.cancelCalls,
      dispose: source.disposeCalls,
    })),
    timerClearCalls: timers[0].clearCalls,
  }, {
    contextTrueCalls: 0,
    errors: [],
    laterOutcomes: [
      { status: "fulfilled", value: [] },
      { status: "fulfilled", value: [] },
      { status: "fulfilled", value: [] },
      { status: "fulfilled", value: [] },
    ],
    pendingOutcomes: [
      { status: "fulfilled", value: [] },
      { status: "fulfilled", value: [] },
    ],
    requests: ["gauge/specs", "gauge/scenarios"],
    sourceCalls: [
      { cancel: 1, dispose: 1 },
      { cancel: 1, dispose: 1 },
    ],
    timerClearCalls: 1,
  });
});

test("SpecNodeProvider disposal neutralizes complementary tree settlements", async () => {
  const { Spec, SpecNodeProvider } = require("../src/explorer/specExplorer");
  const specsEntered = deferred();
  const specsResponse = deferred();
  const scenariosEntered = deferred();
  const scenariosResponse = deferred();
  const requests = [];
  const sources = [];
  const client = createFakeClient();
  client.sendRequest = (method, params, token) => {
    requests.push({ method, params, token });
    if (method === "gauge/specs") {
      specsEntered.resolve();
      return specsResponse.promise;
    }
    scenariosEntered.resolve();
    return scenariosResponse.promise;
  };
  const { vscode } = createFakeVscode();
  vscode.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
      this.cancelCalls = 0;
      this.disposeCalls = 0;
      this.token = { isCancellationRequested: false };
      sources.push(this);
    }

    cancel() {
      this.cancelCalls += 1;
      this.token.isCancellationRequested = true;
    }

    dispose() {
      this.disposeCalls += 1;
    }
  };
  const provider = new SpecNodeProvider(createFakeWorkspace(client), {
    clearTimeout() {},
    pathModule: path.posix,
    setTimeout() {
      return { unref() {} };
    },
    vscode,
  });
  await provider.ready();

  const spec = new Spec("Checkout", "/workspace/gauge/specs/checkout.spec", vscode);
  const pendingSpecs = provider.getChildren();
  const pendingScenarios = provider.getChildren(spec);
  await Promise.all([specsEntered.promise, scenariosEntered.promise]);
  provider.dispose();
  specsResponse.reject(new Error("late specification failure"));
  scenariosResponse.resolve([
    {
      heading: "Late scenario",
      executionIdentifier: "/workspace/gauge/specs/checkout.spec:12",
      lineNo: 12,
    },
  ]);

  assert.deepEqual({
    outcomes: await Promise.allSettled([pendingSpecs, pendingScenarios]),
    requests: requests.map((request) => request.method),
    sourceCalls: sources.map((source) => ({
      cancel: source.cancelCalls,
      dispose: source.disposeCalls,
    })),
  }, {
    outcomes: [
      { status: "fulfilled", value: [] },
      { status: "fulfilled", value: [] },
    ],
    requests: ["gauge/specs", "gauge/scenarios"],
    sourceCalls: [
      { cancel: 1, dispose: 1 },
      { cancel: 1, dispose: 1 },
    ],
  });
});

test("SpecNodeProvider releases query sources after live settlements", async () => {
  const { Spec, SpecNodeProvider } = require("../src/explorer/specExplorer");
  const sources = [];
  const client = createFakeClient();
  client.sendRequest = (method) => Promise.reject(new Error(`live ${method} failure`));
  const { vscode } = createFakeVscode();
  vscode.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
      this.cancelCalls = 0;
      this.disposeCalls = 0;
      this.token = { isCancellationRequested: false };
      sources.push(this);
    }

    cancel() {
      this.cancelCalls += 1;
      this.token.isCancellationRequested = true;
    }

    dispose() {
      this.disposeCalls += 1;
    }
  };
  const provider = new SpecNodeProvider(createFakeWorkspace(client), {
    clearTimeout() {},
    pathModule: path.posix,
    setTimeout() {
      return { unref() {} };
    },
    vscode,
  });
  await provider.ready();
  const spec = new Spec("Checkout", "/workspace/gauge/specs/checkout.spec", vscode);

  const outcomes = await Promise.allSettled([
    provider.getSpecifications(),
    provider.getScenarios(spec),
  ]);
  client.sendRequest = (method) => Promise.resolve(method === "gauge/specs"
    ? [
      {
        heading: "Checkout",
        executionIdentifier: "/workspace/gauge/specs/checkout.spec",
      },
    ]
    : [
      {
        heading: "Successful checkout",
        executionIdentifier: "/workspace/gauge/specs/checkout.spec:12",
        lineNo: 12,
      },
    ]);
  const successful = await Promise.all([
    provider.getSpecifications(),
    provider.getScenarios(spec),
  ]);
  provider.dispose();

  assert.deepEqual({
    outcomes: outcomes.map((outcome) => ({
      message: outcome.reason && outcome.reason.message,
      status: outcome.status,
    })),
    sourceCalls: sources.map((source) => ({
      cancel: source.cancelCalls,
      dispose: source.disposeCalls,
    })),
    successful: successful.map((nodes) => nodes.map((node) => node.label)),
  }, {
    outcomes: [
      { message: "live gauge/specs failure", status: "rejected" },
      { message: "live gauge/scenarios failure", status: "rejected" },
    ],
    sourceCalls: [
      { cancel: 0, dispose: 1 },
      { cancel: 0, dispose: 1 },
      { cancel: 0, dispose: 1 },
      { cancel: 0, dispose: 1 },
    ],
    successful: [["Checkout"], ["Successful checkout"]],
  });
});

test("SpecNodeProvider disposal during activation refresh does not queue context work", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const startResponse = deferred();
  const client = createFakeClient();
  client.start = () => startResponse.promise;
  const timers = [];
  const { contexts, vscode } = createFakeVscode();
  const provider = new SpecNodeProvider(createFakeWorkspace(client), {
    pathModule: path.posix,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return { unref() {} };
    },
    vscode,
  });
  let refreshes = 0;
  provider.onDidChangeTreeData(() => {
    refreshes += 1;
    provider.dispose();
  });

  startResponse.resolve(undefined);
  await provider.ready();

  assert.deepEqual({
    activeFolder: provider.activeFolder,
    contextTrueCalls: contexts.filter((entry) => entry.value === true).length,
    disposed: provider.disposed,
    languageClient: provider.languageClient,
    refreshes,
    timers: timers.length,
  }, {
    activeFolder: undefined,
    contextTrueCalls: 0,
    disposed: true,
    languageClient: undefined,
    refreshes: 1,
    timers: 0,
  });
});
