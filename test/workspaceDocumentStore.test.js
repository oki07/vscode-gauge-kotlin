const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeFileSystem(files) {
  return {
    files,
    promises: {
      async readFile(file) {
        if (!Object.prototype.hasOwnProperty.call(files, file)) {
          const error = new Error(`ENOENT: ${file}`);
          error.code = "ENOENT";
          throw error;
        }
        return files[file];
      },
    },
  };
}

function createFakeWatcher(glob) {
  return {
    glob,
    createListeners: [],
    changeListeners: [],
    deleteListeners: [],
    disposed: false,
    onDidCreate(listener) {
      this.createListeners.push(listener);
      return { dispose() {} };
    },
    onDidChange(listener) {
      this.changeListeners.push(listener);
      return { dispose() {} };
    },
    onDidDelete(listener) {
      this.deleteListeners.push(listener);
      return { dispose() {} };
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function createFakeVscode(options = {}) {
  const state = {
    findFilesCalls: [],
    listeners: { open: [], change: [], close: [] },
    uriFileCalls: [],
    watchers: [],
  };
  const Uri = {
    file(file) {
      state.uriFileCalls.push(file);
      return {
        fsPath: file,
        scheme: "file",
        toString() {
          return `file://${file}`;
        },
      };
    },
  };
  const workspace = {
    textDocuments: options.textDocuments || [],
    async findFiles(pattern) {
      state.findFilesCalls.push(pattern);
      return (options.files || []).map((file) => ({ fsPath: file }));
    },
    onDidOpenTextDocument(listener) {
      state.listeners.open.push(listener);
      return { dispose() {} };
    },
    onDidChangeTextDocument(listener) {
      state.listeners.change.push(listener);
      return { dispose() {} };
    },
    onDidCloseTextDocument(listener) {
      state.listeners.close.push(listener);
      return { dispose() {} };
    },
    createFileSystemWatcher(glob) {
      const watcher = createFakeWatcher(glob);
      state.watchers.push(watcher);
      return watcher;
    },
  };
  return { vscode: { Uri, workspace }, state };
}

function createDocument(text, languageId, fsPath) {
  return {
    languageId,
    uri: { fsPath },
    version: 1,
    getText() {
      return text;
    },
  };
}

test("WorkspaceDocumentStore scans the workspace once and reads files from disk", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const { isWorkspaceStepImplementationScanComplete } = require("../src/workspaceDocumentStore");
  const files = {
    "/ws/src/Steps.kt": "package steps\n",
    "/ws/specs/login.spec": "# Login\n",
  };
  const { vscode, state } = createFakeVscode({ files: Object.keys(files) });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    vscode: vscode,
  });

  await store.start();
  const documents = store.documents();

  assert.equal(state.findFilesCalls.length, 1);
  assert.equal(documents.length, 2);
  const byPath = new Map(documents.map((doc) => [doc.uri.fsPath, doc]));
  assert.equal(byPath.get("/ws/src/Steps.kt").languageId, "kotlin");
  assert.equal(byPath.get("/ws/src/Steps.kt").getText(), "package steps\n");
  assert.equal(byPath.get("/ws/specs/login.spec").languageId, "gauge");
  assert.equal(isWorkspaceStepImplementationScanComplete(documents), true);
});

test("WorkspaceDocumentStore gives unopened definition targets real VS Code file URIs", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = {
    "/ws/specs/concepts/login.cpt": "# Login\n",
    "/ws/src/Steps.kt": "@Step(\"Login\")\nfun login() {}\n",
  };
  const { vscode, state } = createFakeVscode({ files: Object.keys(files) });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    vscode,
  });

  await store.start();
  const documents = store.documents();

  assert.deepEqual(
    state.uriFileCalls.sort(),
    Object.keys(files).sort(),
  );
  assert.equal(documents.every((document) => document.uri.scheme === "file"), true);
});

test("WorkspaceDocumentStore bounds concurrent initial file reads", async () => {
  const {
    DEFAULT_INITIAL_READ_CONCURRENCY,
    WorkspaceDocumentStore,
  } = require("../src/workspaceDocumentStore");
  const files = Array.from(
    { length: DEFAULT_INITIAL_READ_CONCURRENCY + 2 },
    (_value, index) => `/ws/src/Steps${index}.kt`,
  );
  let activeReads = 0;
  let maximumReads = 0;
  let releaseReads;
  const readGate = new Promise((resolve) => {
    releaseReads = resolve;
  });
  const { vscode } = createFakeVscode({ files });
  const store = new WorkspaceDocumentStore({
    fileSystem: {
      promises: {
        async readFile() {
          activeReads += 1;
          maximumReads = Math.max(maximumReads, activeReads);
          await readGate;
          activeReads -= 1;
          return "package steps\n";
        },
      },
    },
    vscode,
  });

  const started = store.start();
  await Promise.resolve();
  await Promise.resolve();
  const observedBeforeRelease = maximumReads;
  releaseReads();
  await started;

  assert.equal(observedBeforeRelease, DEFAULT_INITIAL_READ_CONCURRENCY);
  assert.equal(maximumReads, DEFAULT_INITIAL_READ_CONCURRENCY);
});

test("WorkspaceDocumentStore prefers open text documents over disk content", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = { "/ws/src/Steps.kt": "stale disk content" };
  const openDocument = createDocument("fresh editor content", "kotlin", "/ws/src/Steps.kt");
  const { vscode } = createFakeVscode({
    files: Object.keys(files),
    textDocuments: [openDocument],
  });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    vscode,
  });

  await store.start();
  const documents = store.documents();

  assert.equal(documents.length, 1);
  assert.equal(documents[0].getText(), "fresh editor content");
});

test("WorkspaceDocumentStore never opens editor documents during the scan", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = { "/ws/specs/login.spec": "# Login\n" };
  const { vscode } = createFakeVscode({ files: Object.keys(files) });
  let opened = 0;
  vscode.workspace.openTextDocument = async () => {
    opened += 1;
    return undefined;
  };
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    vscode,
  });

  await store.start();
  store.documents();

  assert.equal(opened, 0);
});

test("WorkspaceDocumentStore updates disk content on watcher change events", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = { "/ws/specs/login.spec": "# Login\n" };
  const { vscode, state } = createFakeVscode({ files: Object.keys(files) });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    vscode,
  });
  await store.start();

  files["/ws/specs/login.spec"] = "# Login updated\n";
  await state.watchers[0].changeListeners[0]({ fsPath: "/ws/specs/login.spec" });
  const documents = store.documents();

  assert.equal(documents.length, 1);
  assert.equal(documents[0].getText(), "# Login updated\n");
});

test("WorkspaceDocumentStore adds and removes documents on watcher create and delete", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = { "/ws/specs/login.spec": "# Login\n" };
  const { vscode, state } = createFakeVscode({ files: Object.keys(files) });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    vscode,
  });
  await store.start();

  files["/ws/src/New.kt"] = "package steps\n";
  await state.watchers[0].createListeners[0]({ fsPath: "/ws/src/New.kt" });
  assert.equal(store.documents().length, 2);

  delete files["/ws/specs/login.spec"];
  await state.watchers[0].deleteListeners[0]({ fsPath: "/ws/specs/login.spec" });
  const documents = store.documents();
  assert.equal(documents.length, 1);
  assert.equal(documents[0].uri.fsPath, "/ws/src/New.kt");
});

test("WorkspaceDocumentStore reuses the documents array until something changes", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = { "/ws/specs/login.spec": "# Login\n" };
  const { vscode, state } = createFakeVscode({ files: Object.keys(files) });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    vscode,
  });
  await store.start();

  const first = store.documents();
  const second = store.documents();
  assert.equal(first, second);

  await state.watchers[0].changeListeners[0]({ fsPath: "/ws/specs/login.spec" });
  assert.notEqual(store.documents(), first);
});

test("WorkspaceDocumentStore excludes files outside Gauge project roots", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = {
    "/other/src/Helper.kt": "package other\n",
    "/ws/src/Steps.kt": "package steps\n",
  };
  const { vscode } = createFakeVscode({ files: Object.keys(files) });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        return file.startsWith("/ws/") ? "/ws" : undefined;
      },
      isGaugeProject(root) {
        return root === "/ws";
      },
    },
    vscode,
  });

  await store.start();
  const documents = store.documents();

  assert.equal(documents.length, 1);
  assert.equal(documents[0].uri.fsPath, "/ws/src/Steps.kt");
});

test("WorkspaceDocumentStore notifies listeners with the changed file path", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = { "/ws/specs/login.spec": "# Login\n" };
  const { vscode, state } = createFakeVscode({ files: Object.keys(files) });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    vscode,
  });
  const changes = [];
  store.onDidChangeDocuments((change) => changes.push(change));
  await store.start();

  await state.watchers[0].changeListeners[0]({ fsPath: "/ws/specs/login.spec" });

  assert.equal(changes.some((change) => change.file === "/ws/specs/login.spec"), true);
});

test("WorkspaceDocumentStore invalidates on text document change events", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const openDocument = createDocument("# Login\n", "gauge", "/ws/specs/login.spec");
  const { vscode, state } = createFakeVscode({ files: [], textDocuments: [openDocument] });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem({}),
    vscode,
  });
  const changes = [];
  store.onDidChangeDocuments((change) => changes.push(change));
  await store.start();
  const before = store.documents();

  state.listeners.change[0]({ document: openDocument });

  assert.notEqual(store.documents(), before);
  assert.equal(changes.some((change) => change.file === "/ws/specs/login.spec"), true);
});

test("WorkspaceDocumentStore ignores text events for unrelated files", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const unrelated = createDocument("{}", "json", "/ws/package.json");
  const { vscode, state } = createFakeVscode({ files: [], textDocuments: [unrelated] });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem({}),
    vscode,
  });
  const changes = [];
  store.onDidChangeDocuments((change) => changes.push(change));
  await store.start();

  state.listeners.change[0]({ document: unrelated });

  assert.deepEqual(changes.filter((change) => change.file !== undefined), []);
});

test("WorkspaceDocumentStore is not scan complete without a findFiles API", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const { isWorkspaceStepImplementationScanComplete } = require("../src/workspaceDocumentStore");
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem({}),
    vscode: { workspace: {} },
  });

  await store.start();

  assert.equal(isWorkspaceStepImplementationScanComplete(store.documents()), false);
});

test("WorkspaceDocumentStore dispose stops watcher and listener updates", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = { "/ws/specs/login.spec": "# Login\n" };
  const { vscode, state } = createFakeVscode({ files: Object.keys(files) });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    vscode,
  });
  await store.start();

  store.dispose();

  assert.equal(state.watchers[0].disposed, true);
});

function createSchemeDocument(text, languageId, fsPath, scheme) {
  return {
    languageId,
    uri: { fsPath, scheme },
    version: 1,
    getText() {
      return text;
    },
  };
}

test("WorkspaceDocumentStore ignores non-file scheme documents that shadow tracked files", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const diskText = "@Step(\"new step\")\nfun fresh() {}\n";
  const files = { "/ws/src/Steps.kt": diskText };
  const gitDocument = createSchemeDocument(
    "committed content without the new step",
    "kotlin",
    "/ws/src/Steps.kt",
    "git",
  );
  const { vscode } = createFakeVscode({
    files: Object.keys(files),
    textDocuments: [gitDocument],
  });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    vscode,
  });

  await store.start();
  const documents = store.documents();

  assert.equal(documents.length, 1);
  assert.equal(documents[0].getText(), diskText);
});

test("WorkspaceDocumentStore keeps file scheme editor documents ahead of disk content", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = { "/ws/src/Steps.kt": "stale disk content" };
  const fileDocument = createSchemeDocument(
    "fresh editor content",
    "kotlin",
    "/ws/src/Steps.kt",
    "file",
  );
  const { vscode } = createFakeVscode({
    files: Object.keys(files),
    textDocuments: [fileDocument],
  });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    vscode,
  });

  await store.start();
  const documents = store.documents();

  assert.equal(documents.length, 1);
  assert.equal(documents[0].getText(), "fresh editor content");
});

test("WorkspaceDocumentStore ignores document events from non-file schemes", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const gitDocument = createSchemeDocument("old", "kotlin", "/ws/src/Steps.kt", "git");
  const { vscode, state } = createFakeVscode({ files: [], textDocuments: [] });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem({}),
    vscode,
  });
  const changes = [];
  store.onDidChangeDocuments((change) => changes.push(change));
  await store.start();

  state.listeners.open[0](gitDocument);
  state.listeners.change[0]({ document: gitDocument });
  state.listeners.close[0](gitDocument);

  assert.deepEqual(changes.filter((change) => change.file !== undefined), []);
});

test("WorkspaceDocumentStore exposes documents loaded during the initial scan", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = {
    "/ws/specs/login.spec": "# Login\n",
    "/ws/src/Steps.kt": "package steps\n",
  };
  const { vscode } = createFakeVscode({ files: Object.keys(files) });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem(files),
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        return String(file).startsWith("/ws/") ? "/ws" : undefined;
      },
    },
    vscode,
  });

  const changes = [];
  store.onDidChangeDocuments((change) => changes.push(change));

  // Something reads the set before the scan has loaded anything, which
  // memoises an empty snapshot.
  assert.deepEqual(store.documents().map((document) => document.uri.fsPath), []);

  await store.loadDiskDocument("/ws/specs/login.spec", { silent: true });

  assert.deepEqual(
    store.documents().map((document) => document.uri.fsPath),
    ["/ws/specs/login.spec"],
  );
  // A silent load must still not wake every listener, which is what the scan
  // uses it for.
  assert.deepEqual(changes, []);
});
