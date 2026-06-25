const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function createFakeVscode(overrides = {}) {
  const commands = [];
  const contexts = [];
  const documents = [];
  const errors = [];
  const shownDocuments = [];
  const treeProviders = [];
  const watcherListeners = [];
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
      showErrorMessage(message, reason) {
        errors.push({ message, reason });
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

  const provider = new SpecNodeProvider(workspace, {
    pathModule: path.posix,
    vscode,
  });
  await provider.ready();

  assert.equal(client.started, 1);
  assert.deepEqual(treeProviders.map((entry) => entry.viewId), ["gauge:specExplorer"]);
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

test("SpecNodeProvider registers explorer commands", async () => {
  const { Spec, SpecNodeProvider } = require("../src/explorer/specExplorer");
  const client = createFakeClient();
  const executionCalls = [];
  const { commands, documents, shownDocuments, vscode } = createFakeVscode();
  const workspace = createFakeWorkspace(client);
  const provider = new SpecNodeProvider(workspace, {
    executionController: {
      handleCommand(command, argument) {
        executionCalls.push({ command, argument });
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
    {
      command: "gauge.specexplorer.runAllActiveProjectSpecs",
      argument: { projectRoot: "/workspace/gauge" },
    },
    {
      command: "gauge.specexplorer.runNode",
      argument: spec,
    },
    {
      command: "gauge.specexplorer.debugNode",
      argument: spec,
    },
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
