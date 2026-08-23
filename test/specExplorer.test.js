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

test("SpecNodeProvider client generation lets the latest project switch win", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const cases = [
    {
      current: "resolve",
      expectedErrors: [],
      expectedFolder: "/workspace/two",
      expectedTimers: 1,
      stale: "resolve",
    },
    {
      current: "resolve",
      expectedErrors: [],
      expectedFolder: "/workspace/two",
      expectedTimers: 1,
      stale: "reject",
    },
    {
      current: "reject",
      expectedErrors: ["Failed to create test explorer. current start failed"],
      expectedFolder: undefined,
      expectedTimers: 0,
      stale: "resolve",
    },
  ];

  for (const entry of cases) {
    const slowStart = deferred();
    const firstClient = createFakeClient();
    const secondClient = createFakeClient();
    firstClient.start = () => slowStart.promise;
    secondClient.start = () => entry.current === "resolve"
      ? Promise.resolve(undefined)
      : Promise.reject(new Error("current start failed"));
    secondClient.sendRequest = (method, params, token) => {
      secondClient.requests.push({ method, params, token });
      return Promise.resolve([
        {
          heading: "Second project",
          executionIdentifier: "/workspace/two/specs/second.spec",
        },
      ]);
    };
    const clientsMap = new Map([
      ["/workspace/one", { client: firstClient }],
      ["/workspace/two", { client: secondClient }],
    ]);
    const timers = [];
    const { contexts, errors, vscode } = createFakeVscode();
    const workspace = createFakeWorkspace(firstClient, {
      clientsMap,
      getDefaultFolder() {
        return undefined;
      },
    });
    const provider = new SpecNodeProvider(workspace, {
      clearTimeout(handle) {
        handle.clearCalls += 1;
      },
      pathModule: path.posix,
      setTimeout(callback, delay) {
        const handle = { callback, clearCalls: 0, delay, unref() {} };
        timers.push(handle);
        return handle;
      },
      vscode,
    });
    await provider.ready();
    const refreshes = [];
    provider.onDidChangeTreeData((value) => refreshes.push(value));

    const staleActivation = provider.changeClient("/workspace/one");
    const currentActivation = provider.changeClient("/workspace/two");
    await currentActivation;
    const refreshCountAfterCurrent = refreshes.length;
    if (entry.stale === "resolve") {
      slowStart.resolve(undefined);
    } else {
      slowStart.reject(new Error("stale start failed"));
    }
    await staleActivation;
    for (const timer of timers) {
      await Promise.resolve(timer.callback());
    }
    const specifications = entry.expectedFolder
      ? await provider.getChildren()
      : [];

    assert.deepEqual({
      activeFolder: provider.activeFolder,
      contextTrueCalls: contexts.filter((context) => context.value === true).length,
      errors: errors.map((error) => error.message),
      firstRequests: firstClient.requests.map((request) => request.method),
      languageClient: provider.languageClient,
      refreshCount: refreshes.length,
      refreshCountAfterCurrent,
      secondRequests: secondClient.requests.map((request) => request.method),
      specifications: specifications.map((specification) => specification.label),
      timers: timers.length,
    }, {
      activeFolder: entry.expectedFolder,
      contextTrueCalls: entry.current === "resolve" ? 1 : 0,
      errors: entry.expectedErrors,
      firstRequests: [],
      languageClient: entry.current === "resolve" ? secondClient : undefined,
      refreshCount: refreshCountAfterCurrent,
      refreshCountAfterCurrent,
      secondRequests: entry.current === "resolve" ? ["gauge/specs"] : [],
      specifications: entry.current === "resolve" ? ["Second project"] : [],
      timers: entry.expectedTimers,
    });
    provider.dispose();
  }
});

test("SpecNodeProvider client generation clears the tree when projects disappear", async () => {
  const { Spec, SpecNodeProvider } = require("../src/explorer/specExplorer");
  const specsEntered = deferred();
  const specsResponse = deferred();
  const scenariosEntered = deferred();
  const scenariosResponse = deferred();
  const client = createFakeClient();
  client.sendRequest = (method, params, token) => {
    client.requests.push({ method, params, token });
    if (method === "gauge/specs") {
      specsEntered.resolve();
      return specsResponse.promise;
    }
    scenariosEntered.resolve();
    return scenariosResponse.promise;
  };
  const clientsMap = new Map([
    ["/workspace/gauge", { client }],
  ]);
  const sources = [];
  const timers = [];
  const { contexts, vscode } = createFakeVscode();
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
  const workspace = createFakeWorkspace(client, { clientsMap });
  const provider = new SpecNodeProvider(workspace, {
    clearTimeout(handle) {
      handle.clearCalls += 1;
    },
    pathModule: path.posix,
    setTimeout(callback, delay) {
      const handle = { callback, clearCalls: 0, delay, unref() {} };
      timers.push(handle);
      return handle;
    },
    vscode,
  });
  await provider.ready();
  const refreshes = [];
  provider.onDidChangeTreeData((value) => refreshes.push(value));
  const spec = new Spec("Checkout", "/workspace/gauge/specs/checkout.spec", vscode);
  const pendingSpecifications = provider.getSpecifications();
  const pendingScenarios = provider.getScenarios(spec);
  await Promise.all([specsEntered.promise, scenariosEntered.promise]);

  clientsMap.delete("/workspace/gauge");
  await workspace.projectChangeListeners[0](undefined);
  const stateAfterRemoval = {
    activeFolder: provider.activeFolder,
    languageClient: provider.languageClient,
    refreshes: [...refreshes],
    sourceCalls: sources.map((source) => ({
      cancel: source.cancelCalls,
      dispose: source.disposeCalls,
    })),
    timerClearCalls: timers[0].clearCalls,
  };
  specsResponse.resolve([
    {
      heading: "Removed specification",
      executionIdentifier: "/workspace/gauge/specs/removed.spec",
    },
  ]);
  scenariosResponse.reject(new Error("removed scenario failed"));
  const pendingOutcomes = await Promise.allSettled([
    pendingSpecifications,
    pendingScenarios,
  ]);
  await Promise.resolve(timers[0].callback());
  const later = await Promise.all([
    provider.getSpecifications(),
    provider.getScenarios(spec),
  ]);

  assert.deepEqual({
    contextTrueCalls: contexts.filter((context) => context.value === true).length,
    later,
    pendingOutcomes,
    requests: client.requests.map((request) => request.method),
    stateAfterRemoval,
  }, {
    contextTrueCalls: 0,
    later: [[], []],
    pendingOutcomes: [
      { status: "fulfilled", value: [] },
      { status: "fulfilled", value: [] },
    ],
    requests: ["gauge/specs", "gauge/scenarios"],
    stateAfterRemoval: {
      activeFolder: undefined,
      languageClient: undefined,
      refreshes: [undefined],
      sourceCalls: [
        { cancel: 1, dispose: 1 },
        { cancel: 1, dispose: 1 },
      ],
      timerClearCalls: 1,
    },
  });
});

test("SpecNodeProvider client generation cancels stale tree requests", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const specsEntered = deferred();
  const specsResponse = deferred();
  const scenariosEntered = deferred();
  const scenariosResponse = deferred();
  const firstClient = createFakeClient();
  let firstSpecsCalls = 0;
  firstClient.sendRequest = (method, params, token) => {
    firstClient.requests.push({ method, params, token });
    if (method === "gauge/specs") {
      firstSpecsCalls += 1;
      if (firstSpecsCalls === 1) {
        return Promise.resolve([
          {
            heading: "First project",
            executionIdentifier: "/workspace/one/specs/first.spec",
          },
        ]);
      }
      specsEntered.resolve();
      return specsResponse.promise;
    }
    scenariosEntered.resolve();
    return scenariosResponse.promise;
  };
  const secondClient = createFakeClient();
  secondClient.sendRequest = (method, params, token) => {
    secondClient.requests.push({ method, params, token });
    if (method === "gauge/specs") {
      return Promise.resolve([
        {
          heading: "Second project",
          executionIdentifier: "/workspace/two/specs/second.spec",
        },
      ]);
    }
    return Promise.resolve([
      {
        heading: "Wrong project scenario",
        executionIdentifier: "/workspace/one/specs/first.spec:9",
        lineNo: 9,
      },
    ]);
  };
  const clientsMap = new Map([
    ["/workspace/one", { client: firstClient }],
    ["/workspace/two", { client: secondClient }],
  ]);
  const sources = [];
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
  const provider = new SpecNodeProvider(createFakeWorkspace(firstClient, {
    clientsMap,
    getDefaultFolder() {
      return "/workspace/one";
    },
  }), {
    pathModule: path.posix,
    setTimeout() {
      return undefined;
    },
    vscode,
  });
  await provider.ready();
  const firstSpecifications = await provider.getChildren();
  const pendingSpecifications = provider.getChildren();
  const pendingScenarios = provider.getChildren(firstSpecifications[0]);
  await Promise.all([specsEntered.promise, scenariosEntered.promise]);

  await provider.changeClient("/workspace/two");
  const sourceCallsAfterSwitch = sources.slice(1).map((source) => ({
    cancel: source.cancelCalls,
    dispose: source.disposeCalls,
  }));
  specsResponse.resolve([
    {
      heading: "Stale specification",
      executionIdentifier: "/workspace/one/specs/stale.spec",
    },
  ]);
  scenariosResponse.resolve([
    {
      heading: "Stale scenario",
      executionIdentifier: "/workspace/one/specs/first.spec:8",
      lineNo: 8,
    },
  ]);
  const staleResults = await Promise.all([pendingSpecifications, pendingScenarios]);
  const currentSpecifications = await provider.getChildren();
  const oldNodeScenarios = await provider.getChildren(firstSpecifications[0]);

  assert.deepEqual({
    currentSpecifications: currentSpecifications.map((specification) => specification.label),
    firstRequests: firstClient.requests.map((request) => request.method),
    oldNodeScenarios,
    secondRequests: secondClient.requests.map((request) => request.method),
    sourceCalls: sources.map((source) => ({
      cancel: source.cancelCalls,
      dispose: source.disposeCalls,
    })),
    sourceCallsAfterSwitch,
    staleResults,
  }, {
    currentSpecifications: ["Second project"],
    firstRequests: ["gauge/specs", "gauge/specs", "gauge/scenarios"],
    oldNodeScenarios: [],
    secondRequests: ["gauge/specs"],
    sourceCalls: [
      { cancel: 0, dispose: 1 },
      { cancel: 1, dispose: 1 },
      { cancel: 1, dispose: 1 },
      { cancel: 0, dispose: 1 },
    ],
    sourceCallsAfterSwitch: [
      { cancel: 1, dispose: 1 },
      { cancel: 1, dispose: 1 },
    ],
    staleResults: [[], []],
  });
});

test("SpecNodeProvider client generation rejects replaced pending activations", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const startEntered = deferred();
  const startResponse = deferred();
  const oldClient = createFakeClient();
  oldClient.start = () => {
    startEntered.resolve();
    return startResponse.promise;
  };
  const replacementClient = createFakeClient();
  const clientsMap = new Map([
    ["/workspace/gauge", { client: oldClient }],
  ]);
  const timers = [];
  const { errors, vscode } = createFakeVscode();
  const provider = new SpecNodeProvider(createFakeWorkspace(oldClient, { clientsMap }), {
    pathModule: path.posix,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return { unref() {} };
    },
    vscode,
  });
  const refreshes = [];
  provider.onDidChangeTreeData((value) => refreshes.push(value));
  await startEntered.promise;
  const pendingChildren = await provider.getChildren();

  clientsMap.set("/workspace/gauge", { client: replacementClient });
  startResponse.resolve(undefined);
  await provider.ready();

  assert.deepEqual({
    activeFolder: provider.activeFolder,
    errors,
    languageClient: provider.languageClient,
    pendingChildren,
    refreshes,
    timers: timers.length,
  }, {
    activeFolder: "/workspace/gauge",
    errors: [],
    languageClient: undefined,
    pendingChildren: [],
    refreshes: [],
    timers: 0,
  });
});

test("SpecNodeProvider client generation preserves the active tree after switch failure", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const firstClient = createFakeClient();
  const secondClient = createFakeClient();
  secondClient.start = () => Promise.reject(new Error("replacement start failed"));
  const clientsMap = new Map([
    ["/workspace/one", { client: firstClient }],
    ["/workspace/two", { client: secondClient }],
  ]);
  const timers = [];
  const { errors, vscode } = createFakeVscode();
  const provider = new SpecNodeProvider(createFakeWorkspace(firstClient, {
    clientsMap,
    getDefaultFolder() {
      return "/workspace/one";
    },
  }), {
    pathModule: path.posix,
    setTimeout(callback, delay) {
      const handle = { callback, delay, unref() {} };
      timers.push(handle);
      return handle;
    },
    vscode,
  });
  await provider.ready();
  await Promise.resolve(timers[0].callback());

  await provider.changeClient("/workspace/two");
  const specifications = await provider.getChildren();

  assert.deepEqual({
    activeFolder: provider.activeFolder,
    errors: errors.map((error) => error.message),
    firstRequests: firstClient.requests.map((request) => request.method),
    languageClient: provider.languageClient,
    secondRequests: secondClient.requests.map((request) => request.method),
    specifications: specifications.map((specification) => specification.label),
  }, {
    activeFolder: "/workspace/one",
    errors: ["Failed to create test explorer. replacement start failed"],
    firstRequests: ["gauge/specs"],
    languageClient: firstClient,
    secondRequests: [],
    specifications: ["Checkout"],
  });
});

test("SpecNodeProvider client generation clears a removed active client before replacement", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const replacementStart = deferred();
  const firstClient = createFakeClient();
  const secondClient = createFakeClient();
  secondClient.start = () => replacementStart.promise;
  const clientsMap = new Map([
    ["/workspace/one", { client: firstClient }],
    ["/workspace/two", { client: secondClient }],
  ]);
  const timers = [];
  const { errors, vscode } = createFakeVscode();
  const provider = new SpecNodeProvider(createFakeWorkspace(firstClient, {
    clientsMap,
    getDefaultFolder() {
      return "/workspace/one";
    },
  }), {
    clearTimeout(handle) {
      handle.clearCalls += 1;
    },
    pathModule: path.posix,
    setTimeout(callback, delay) {
      const handle = { callback, clearCalls: 0, delay, unref() {} };
      timers.push(handle);
      return handle;
    },
    vscode,
  });
  await provider.ready();
  const refreshes = [];
  provider.onDidChangeTreeData((value) => refreshes.push(value));

  clientsMap.delete("/workspace/one");
  const activation = provider.changeClient("/workspace/two");
  const stateWhilePending = {
    activeFolder: provider.activeFolder,
    languageClient: provider.languageClient,
    refreshes: [...refreshes],
    timerClearCalls: timers[0].clearCalls,
  };
  replacementStart.reject(new Error("replacement for removed client failed"));
  await activation;

  assert.deepEqual({
    activeFolder: provider.activeFolder,
    errors: errors.map((error) => error.message),
    languageClient: provider.languageClient,
    stateWhilePending,
  }, {
    activeFolder: undefined,
    errors: ["Failed to create test explorer. replacement for removed client failed"],
    languageClient: undefined,
    stateWhilePending: {
      activeFolder: undefined,
      languageClient: undefined,
      refreshes: [undefined],
      timerClearCalls: 1,
    },
  });
});

test("SpecNodeProvider client generation survives a switch during refresh", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const firstClient = createFakeClient();
  const secondClient = createFakeClient();
  const clientsMap = new Map([
    ["/workspace/one", { client: firstClient }],
    ["/workspace/two", { client: secondClient }],
  ]);
  const timers = [];
  const { contexts, vscode } = createFakeVscode();
  const provider = new SpecNodeProvider(createFakeWorkspace(firstClient, {
    clientsMap,
    getDefaultFolder() {
      return undefined;
    },
  }), {
    pathModule: path.posix,
    setTimeout(callback, delay) {
      const handle = { callback, delay, unref() {} };
      timers.push(handle);
      return handle;
    },
    vscode,
  });
  await provider.ready();
  let nestedActivation;
  provider.onDidChangeTreeData(() => {
    if (provider.activeFolder === "/workspace/one" && !nestedActivation) {
      nestedActivation = provider.changeClient("/workspace/two");
    }
  });

  await provider.changeClient("/workspace/one");
  await nestedActivation;
  for (const timer of timers) {
    await Promise.resolve(timer.callback());
  }

  assert.deepEqual({
    activeFolder: provider.activeFolder,
    contextTrueCalls: contexts.filter((context) => context.value === true).length,
    languageClient: provider.languageClient,
    timers: timers.length,
  }, {
    activeFolder: "/workspace/two",
    contextTrueCalls: 1,
    languageClient: secondClient,
    timers: 1,
  });
});

test("SpecNodeProvider client generation handles timer cancellation reentrancy", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const initialClient = createFakeClient();
  const firstClient = createFakeClient();
  const secondClient = createFakeClient();
  const clientsMap = new Map([
    ["/workspace/initial", { client: initialClient }],
    ["/workspace/one", { client: firstClient }],
    ["/workspace/two", { client: secondClient }],
  ]);
  const timers = [];
  const { contexts, vscode } = createFakeVscode();
  let nestedActivation;
  let provider;
  let reentered = false;
  provider = new SpecNodeProvider(createFakeWorkspace(initialClient, {
    clientsMap,
    getDefaultFolder() {
      return "/workspace/initial";
    },
  }), {
    clearTimeout(handle) {
      handle.clearCalls += 1;
      if (!reentered) {
        reentered = true;
        nestedActivation = provider.changeClient("/workspace/two");
      }
    },
    pathModule: path.posix,
    setTimeout(callback, delay) {
      const handle = { callback, clearCalls: 0, delay, unref() {} };
      timers.push(handle);
      return handle;
    },
    vscode,
  });
  await provider.ready();

  const staleActivation = provider.changeClient("/workspace/one");
  await Promise.all([staleActivation, nestedActivation]);
  for (const timer of timers) {
    await Promise.resolve(timer.callback());
  }

  assert.deepEqual({
    activeFolder: provider.activeFolder,
    contextTrueCalls: contexts.filter((context) => context.value === true).length,
    firstStartCalls: firstClient.started,
    initialTimerClearCalls: timers[0].clearCalls,
    languageClient: provider.languageClient,
    secondStartCalls: secondClient.started,
    timers: timers.length,
  }, {
    activeFolder: "/workspace/two",
    contextTrueCalls: 1,
    firstStartCalls: 0,
    initialTimerClearCalls: 1,
    languageClient: secondClient,
    secondStartCalls: 1,
    timers: 2,
  });
});

test("SpecNodeProvider initial readiness activates a newly populated workspace client", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const workspaceReady = deferred();
  const client = createFakeClient();
  client.sendRequest = (method, params, token) => {
    client.requests.push({ method, params, token });
    return Promise.resolve([
      {
        heading: "Ready project",
        executionIdentifier: "/workspace/gauge/specs/ready.spec",
      },
    ]);
  };
  const clientsMap = new Map();
  let readyCalls = 0;
  const workspace = createFakeWorkspace(client, {
    clientsMap,
    getDefaultFolder() {
      return [...clientsMap.keys()].sort()[0];
    },
  });
  workspace.ready = () => {
    readyCalls += 1;
    return workspaceReady.promise;
  };
  const timers = [];
  const { contexts, errors, vscode } = createFakeVscode();
  const provider = new SpecNodeProvider(workspace, {
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
  let readySettled = false;
  const initialReady = provider.ready().then(() => {
    readySettled = true;
  });
  const pendingChildren = await provider.getChildren();
  await Promise.resolve();
  const stateWhilePending = {
    clientStarts: client.started,
    errors: [...errors],
    pendingChildren,
    readyCalls,
    readySettled,
  };

  clientsMap.set("/workspace/gauge", {
    client,
    project: {
      root() {
        return "/workspace/gauge";
      },
    },
  });
  workspaceReady.resolve(undefined);
  await initialReady;
  await provider.ready();
  const children = await provider.getChildren();
  if (timers[0]) {
    await Promise.resolve(timers[0].callback());
  }

  assert.deepEqual({
    activeFolder: provider.activeFolder,
    children: children.map((child) => child.label),
    contextTrueCalls: contexts.filter((context) => context.value === true).length,
    languageClient: provider.languageClient,
    readyCalls,
    refreshes,
    requests: client.requests.map((request) => request.method),
    startCalls: client.started,
    stateWhilePending,
    timers: timers.map((timer) => timer.delay),
  }, {
    activeFolder: "/workspace/gauge",
    children: ["Ready project"],
    contextTrueCalls: 1,
    languageClient: client,
    readyCalls: 1,
    refreshes: [undefined],
    requests: ["gauge/specs"],
    startCalls: 1,
    stateWhilePending: {
      clientStarts: 0,
      errors: [],
      pendingChildren: [],
      readyCalls: 1,
      readySettled: false,
    },
    timers: [1000],
  });
});

test("SpecNodeProvider initial readiness does not replace a newer project selection", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const workspaceReady = deferred();
  const initialClient = createFakeClient();
  const selectedClient = createFakeClient();
  const clientsMap = new Map();
  let readyCalls = 0;
  const workspace = createFakeWorkspace(initialClient, {
    clientsMap,
    getDefaultFolder() {
      return [...clientsMap.keys()].sort()[0];
    },
  });
  workspace.ready = () => {
    readyCalls += 1;
    return workspaceReady.promise;
  };
  const timers = [];
  const { errors, vscode } = createFakeVscode();
  const provider = new SpecNodeProvider(workspace, {
    pathModule: path.posix,
    setTimeout(callback, delay) {
      const handle = { callback, delay, unref() {} };
      timers.push(handle);
      return handle;
    },
    vscode,
  });
  const initialReady = provider.ready();

  clientsMap.set("/workspace/two", { client: selectedClient });
  await provider.changeClient("/workspace/two");
  clientsMap.set("/workspace/one", { client: initialClient });
  workspaceReady.resolve(undefined);
  await initialReady;

  assert.deepEqual({
    activeFolder: provider.activeFolder,
    errors,
    initialStarts: initialClient.started,
    languageClient: provider.languageClient,
    readyCalls,
    selectedStarts: selectedClient.started,
    timers: timers.length,
  }, {
    activeFolder: "/workspace/two",
    errors: [],
    initialStarts: 0,
    languageClient: selectedClient,
    readyCalls: 1,
    selectedStarts: 1,
    timers: 1,
  });
});

test("SpecNodeProvider initial readiness suppresses workspace startup failures", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const workspaceReady = deferred();
  const client = createFakeClient();
  const clientsMap = new Map();
  let readyCalls = 0;
  const workspace = createFakeWorkspace(client, {
    clientsMap,
    getDefaultFolder() {
      return undefined;
    },
  });
  workspace.ready = () => {
    readyCalls += 1;
    return workspaceReady.promise;
  };
  workspaceReady.promise.catch(() => undefined);
  const { errors, vscode } = createFakeVscode();
  const provider = new SpecNodeProvider(workspace, {
    pathModule: path.posix,
    vscode,
  });

  workspaceReady.reject(new Error("workspace startup failed"));
  await assert.doesNotReject(() => provider.ready());
  const children = await provider.getChildren();

  assert.deepEqual({
    activeFolder: provider.activeFolder,
    children,
    clientStarts: client.started,
    errors,
    languageClient: provider.languageClient,
    readyCalls,
  }, {
    activeFolder: undefined,
    children: [],
    clientStarts: 0,
    errors: [{ message: "No dependency in empty workspace" }],
    languageClient: undefined,
    readyCalls: 1,
  });
});

test("SpecNodeProvider initial readiness stays neutral after disposal", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const outcomes = [];

  for (const settlement of ["resolve", "reject"]) {
    const workspaceReady = deferred();
    const client = createFakeClient();
    const clientsMap = new Map();
    const workspace = createFakeWorkspace(client, {
      clientsMap,
      getDefaultFolder() {
        return [...clientsMap.keys()].sort()[0];
      },
    });
    workspace.ready = () => workspaceReady.promise;
    const timers = [];
    const { errors, vscode } = createFakeVscode();
    const provider = new SpecNodeProvider(workspace, {
      pathModule: path.posix,
      setTimeout(callback, delay) {
        timers.push({ callback, delay });
        return { unref() {} };
      },
      vscode,
    });
    const refreshes = [];
    provider.onDidChangeTreeData((value) => refreshes.push(value));
    const ready = provider.ready();

    provider.dispose();
    clientsMap.set("/workspace/gauge", { client });
    if (settlement === "resolve") {
      workspaceReady.resolve(undefined);
    } else {
      workspaceReady.reject(new Error("workspace failed after disposal"));
    }
    outcomes.push({
      activeFolder: provider.activeFolder,
      clientStarts: client.started,
      errors,
      languageClient: provider.languageClient,
      ready: (await Promise.allSettled([ready]))[0],
      refreshes,
      timers: timers.length,
    });
  }

  assert.deepEqual(outcomes, [
    {
      activeFolder: undefined,
      clientStarts: 0,
      errors: [],
      languageClient: undefined,
      ready: { status: "fulfilled", value: undefined },
      refreshes: [],
      timers: 0,
    },
    {
      activeFolder: undefined,
      clientStarts: 0,
      errors: [],
      languageClient: undefined,
      ready: { status: "fulfilled", value: undefined },
      refreshes: [],
      timers: 0,
    },
  ]);
});

test("SpecNodeProvider initial readiness keeps the prepopulated fast path", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const client = createFakeClient();
  const clientsMap = new Map([
    ["/workspace/gauge", { client }],
  ]);
  let readyCalls = 0;
  const workspace = createFakeWorkspace(client, { clientsMap });
  workspace.ready = () => {
    readyCalls += 1;
    throw new Error("prepopulated workspace readiness must not be observed");
  };
  const timers = [];
  const { errors, vscode } = createFakeVscode();
  const provider = new SpecNodeProvider(workspace, {
    pathModule: path.posix,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return { unref() {} };
    },
    vscode,
  });

  await provider.ready();

  assert.deepEqual({
    activeFolder: provider.activeFolder,
    clientStarts: client.started,
    errors,
    languageClient: provider.languageClient,
    readyCalls,
    timers: timers.map((timer) => timer.delay),
  }, {
    activeFolder: "/workspace/gauge",
    clientStarts: 1,
    errors: [],
    languageClient: client,
    readyCalls: 0,
    timers: [1000],
  });
});

test("SpecNodeProvider initial readiness stops after synchronous disposal", async () => {
  const { SpecNodeProvider } = require("../src/explorer/specExplorer");
  const workspaceReady = deferred();
  const client = createFakeClient();
  const clientsMap = new Map();
  let defaultFolderCalls = 0;
  let provider;
  const workspace = createFakeWorkspace(client, {
    clientsMap,
    getDefaultFolder() {
      defaultFolderCalls += 1;
      if (defaultFolderCalls === 2) {
        provider.dispose();
      }
      return defaultFolderCalls === 1 ? undefined : "/workspace/gauge";
    },
  });
  workspace.ready = () => workspaceReady.promise;
  const timers = [];
  const { errors, vscode } = createFakeVscode();
  provider = new SpecNodeProvider(workspace, {
    pathModule: path.posix,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return { unref() {} };
    },
    vscode,
  });
  clientsMap.set("/workspace/gauge", { client });

  workspaceReady.resolve(undefined);
  await provider.ready();

  assert.deepEqual({
    activeFolder: provider.activeFolder,
    clientStarts: client.started,
    defaultFolderCalls,
    disposed: provider.disposed,
    errors,
    languageClient: provider.languageClient,
    timers: timers.length,
  }, {
    activeFolder: undefined,
    clientStarts: 0,
    defaultFolderCalls: 2,
    disposed: true,
    errors: [],
    languageClient: undefined,
    timers: 0,
  });
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
