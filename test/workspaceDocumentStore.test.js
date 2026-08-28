const assert = require("node:assert/strict");
const test = require("node:test");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((nextResolve, nextReject) => {
    reject = nextReject;
    resolve = nextResolve;
  });
  return { promise, reject, resolve };
}

function controlledThenable() {
  const entered = deferred();
  let reject;
  let resolve;
  const state = { registrations: 0, rejectionHandlers: 0 };
  return {
    entered: entered.promise,
    reject(error) {
      reject(error);
    },
    resolve(value) {
      resolve(value);
    },
    state,
    thenable: {
      then(nextResolve, nextReject) {
        state.registrations += 1;
        if (typeof nextReject === "function") {
          state.rejectionHandlers += 1;
        }
        resolve = nextResolve;
        reject = nextReject;
        entered.resolve();
      },
    },
  };
}

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
    listeners: { open: [], change: [], close: [], folders: [] },
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
    onDidChangeWorkspaceFolders(listener) {
      state.listeners.folders.push(listener);
      return { dispose() {} };
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

// The initial findFiles runs once at start(). A folder added to the workspace
// afterwards brings existing specs and Kotlin sources with it, and the file
// system watcher only reports create/change/delete, so those files stayed
// invisible to every local index until one of them was touched: their steps read
// as undefined and their concepts as missing.
test("WorkspaceDocumentStore scans a workspace folder added after it started", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = {
    "/ws/specs/login.spec": "# Login\n",
  };
  const { vscode, state } = createFakeVscode({ files: Object.keys(files) });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem({
      ...files,
      "/added/src/More.kt": "package more\n",
    }),
    vscode,
  });

  await store.start();
  assert.equal(state.findFilesCalls.length, 1);
  assert.equal(state.listeners.folders.length, 1);

  vscode.workspace.findFiles = async (pattern) => {
    state.findFilesCalls.push(pattern);
    return [{ fsPath: "/ws/specs/login.spec" }, { fsPath: "/added/src/More.kt" }];
  };
  await state.listeners.folders[0]({ added: [{ uri: { fsPath: "/added" } }], removed: [] });

  assert.equal(state.findFilesCalls.length, 2);
  assert.deepEqual(
    store.documents().map((entry) => entry.uri.fsPath).sort(),
    ["/added/src/More.kt", "/ws/specs/login.spec"],
  );
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

test("WorkspaceDocumentStore does not resurrect a deleted file from a pending read", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const file = "/ws/specs/login.spec";
  const { vscode, state } = createFakeVscode({ files: [] });
  let markReadEntered;
  const readEntered = new Promise((resolve) => {
    markReadEntered = resolve;
  });
  let releaseRead;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const store = new WorkspaceDocumentStore({
    fileSystem: {
      promises: {
        async readFile() {
          markReadEntered();
          return readGate;
        },
      },
    },
    vscode,
  });
  await store.start();

  const pendingRead = state.watchers[0].changeListeners[0]({ fsPath: file });
  await readEntered;
  await state.watchers[0].deleteListeners[0]({ fsPath: file });
  releaseRead("# Deleted login\n");
  await pendingRead;

  assert.equal(store.documents().length, 0);
});

test("WorkspaceDocumentStore keeps the newest out-of-order watcher read", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const file = "/ws/specs/login.spec";
  const { vscode, state } = createFakeVscode({ files: [] });
  const releaseReads = [];
  const store = new WorkspaceDocumentStore({
    fileSystem: {
      promises: {
        readFile() {
          return new Promise((resolve) => {
            releaseReads.push(resolve);
          });
        },
      },
    },
    vscode,
  });
  await store.start();

  const olderRead = state.watchers[0].changeListeners[0]({ fsPath: file });
  const newerRead = state.watchers[0].changeListeners[0]({ fsPath: file });
  assert.equal(releaseReads.length, 2);

  releaseReads[1]("# Newest login\n");
  await newerRead;
  assert.equal(store.documents()[0].getText(), "# Newest login\n");
  releaseReads[0]("# Stale login\n");
  await olderRead;

  const documents = store.documents();
  assert.equal(documents.length, 1);
  assert.equal(documents[0].getText(), "# Newest login\n");
});

test("WorkspaceDocumentStore ignores a stale watcher read failure", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const file = "/ws/specs/login.spec";
  const { vscode, state } = createFakeVscode({ files: [] });
  const pendingReads = [];
  const store = new WorkspaceDocumentStore({
    fileSystem: {
      promises: {
        readFile() {
          return new Promise((resolve, reject) => {
            pendingReads.push({ reject, resolve });
          });
        },
      },
    },
    vscode,
  });
  await store.start();

  const olderRead = state.watchers[0].changeListeners[0]({ fsPath: file });
  const newerRead = state.watchers[0].changeListeners[0]({ fsPath: file });
  assert.equal(pendingReads.length, 2);

  pendingReads[1].resolve("# Newest login\n");
  await newerRead;
  pendingReads[0].reject(new Error("stale read failed"));
  await olderRead;

  const documents = store.documents();
  assert.equal(documents.length, 1);
  assert.equal(documents[0].getText(), "# Newest login\n");
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

test("WorkspaceDocumentStore closes pending scans and post-disposal entry points", async () => {
  for (const settlement of ["resolve", "reject"]) {
    const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
    const file = "/ws/specs/login.spec";
    const openDocument = createDocument("# Open login\n", "gauge", file);
    const { state, vscode } = createFakeVscode({ textDocuments: [openDocument] });
    const search = controlledThenable();
    let projectLookups = 0;
    let reads = 0;
    vscode.workspace.findFiles = () => search.thenable;
    const store = new WorkspaceDocumentStore({
      fileSystem: {
        promises: {
          async readFile() {
            reads += 1;
            return "# Disk login\n";
          },
        },
      },
      projectFactory: {
        getGaugeRootFromFilePath() {
          projectLookups += 1;
          return "/ws";
        },
        isGaugeProject() {
          return true;
        },
      },
      vscode,
    });
    let initialOutcome = { status: "pending" };
    const initial = store.start();
    initial.then((value) => {
      initialOutcome = { status: "fulfilled", value };
    });

    try {
      await search.entered;
      store.dispose();
      const retainedSubscription = store.onDidChangeDocuments(() => undefined);
      let startOutcome = { status: "pending" };
      let readyOutcome = { status: "pending" };
      store.start().then((value) => {
        startOutcome = { status: "fulfilled", value };
      });
      store.whenReady().then((value) => {
        readyOutcome = { status: "fulfilled", value };
      });
      const postDocument = createDocument("# Retained\n", "gauge", file);
      const directOperations = [
        store.handleFileEvent({ fsPath: file }),
        store.handleFileDelete({ fsPath: file }),
        store.handleDocumentClose(postDocument),
        store.loadDiskDocument(file),
      ];
      store.handleDocumentEvent(postDocument);
      state.listeners.open[0](postDocument);
      await Promise.all(directOperations);
      await new Promise((resolve) => setImmediate(resolve));
      const terminalSnapshot = {
        changeListeners: store.changeListeners.size,
        documents: store.documents(),
        initialOutcome,
        projectLookups,
        reads,
        readyOutcome,
        readyPromise: store.readyPromise,
        scanComplete: store.isScanComplete(),
        startOutcome,
      };

      if (settlement === "resolve") {
        search.resolve([{ fsPath: file }]);
      } else {
        search.reject(new Error("late workspace search failure"));
      }
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual(terminalSnapshot, {
        changeListeners: 0,
        documents: [],
        initialOutcome: { status: "fulfilled", value: undefined },
        projectLookups: 0,
        reads: 0,
        readyOutcome: { status: "fulfilled", value: undefined },
        readyPromise: undefined,
        scanComplete: false,
        startOutcome: { status: "fulfilled", value: undefined },
      });
      assert.deepEqual({
        diskDocuments: store.diskDocuments.size,
        fileGenerations: store.fileGenerations.size,
        observation: search.state,
        projectLookups,
        reads,
        scanComplete: store.isScanComplete(),
      }, {
        diskDocuments: 0,
        fileGenerations: 0,
        observation: { registrations: 1, rejectionHandlers: 1 },
        projectLookups: 0,
        reads: 0,
        scanComplete: false,
      });
      retainedSubscription.dispose();
    } finally {
      search.resolve([]);
      store.dispose();
      await Promise.allSettled([initial]);
    }
  }
});

test("WorkspaceDocumentStore suppresses pending read publication after disposal", async () => {
  for (const settlement of ["resolve", "reject"]) {
    const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
    const file = "/ws/src/Steps.kt";
    const read = controlledThenable();
    const { vscode } = createFakeVscode({ files: [file] });
    const store = new WorkspaceDocumentStore({
      fileSystem: {
        promises: {
          readFile() {
            return read.thenable;
          },
        },
      },
      vscode,
    });
    let readyOutcome = { status: "pending" };
    const ready = store.start();
    ready.then((value) => {
      readyOutcome = { status: "fulfilled", value };
    });

    try {
      await read.entered;
      store.dispose();
      await new Promise((resolve) => setImmediate(resolve));
      const terminalSnapshot = {
        documents: store.documents(),
        readyOutcome,
        scanComplete: store.isScanComplete(),
      };

      if (settlement === "resolve") {
        read.resolve("package steps\n");
      } else {
        read.reject(new Error("late file read failure"));
      }
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual(terminalSnapshot, {
        documents: [],
        readyOutcome: { status: "fulfilled", value: undefined },
        scanComplete: false,
      });
      assert.deepEqual({
        diskDocuments: store.diskDocuments.size,
        fileGenerations: store.fileGenerations.size,
        observation: read.state,
        scanComplete: store.isScanComplete(),
      }, {
        diskDocuments: 0,
        fileGenerations: 0,
        observation: { registrations: 1, rejectionHandlers: 1 },
        scanComplete: false,
      });
    } finally {
      read.resolve("");
      store.dispose();
      await Promise.allSettled([ready]);
    }
  }
});

test("WorkspaceDocumentStore closes resources returned during registration disposal", async () => {
  for (const boundary of ["document listener", "watcher"]) {
    const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
    const calls = [];
    let store;
    const trackedDisposable = (name) => ({
      disposeCalls: 0,
      dispose() {
        this.disposeCalls += 1;
        calls.push(`dispose:${name}`);
      },
      name,
    });
    const returned = [];
    const workspace = {
      findFiles() {
        calls.push("find");
        return Promise.resolve([]);
      },
      onDidOpenTextDocument() {
        calls.push("open");
        const disposable = trackedDisposable("open");
        returned.push(disposable);
        if (boundary === "document listener") {
          store.dispose();
        }
        return disposable;
      },
      onDidChangeTextDocument() {
        calls.push("change");
        const disposable = trackedDisposable("change");
        returned.push(disposable);
        return disposable;
      },
      onDidCloseTextDocument() {
        calls.push("close");
        const disposable = trackedDisposable("close");
        returned.push(disposable);
        return disposable;
      },
      createFileSystemWatcher() {
        calls.push("watcher");
        const watcher = trackedDisposable("watcher");
        returned.push(watcher);
        if (boundary === "watcher") {
          store.dispose();
        }
        Object.assign(watcher, {
          onDidChange() {
            calls.push("watcher-change");
            return trackedDisposable("watcher-change");
          },
          onDidCreate() {
            calls.push("watcher-create");
            return trackedDisposable("watcher-create");
          },
          onDidDelete() {
            calls.push("watcher-delete");
            return trackedDisposable("watcher-delete");
          },
        });
        return watcher;
      },
    };
    store = new WorkspaceDocumentStore({
      fileSystem: createFakeFileSystem({}),
      vscode: { workspace },
    });

    await store.start();
    store.dispose();
    store.dispose();

    assert.deepEqual(calls, boundary === "document listener"
      ? ["open", "dispose:open"]
      : [
        "open",
        "change",
        "close",
        "watcher",
        "dispose:open",
        "dispose:change",
        "dispose:close",
        "dispose:watcher",
      ]);
    assert.equal(returned.every((disposable) => disposable.disposeCalls === 1), true);
    assert.equal(store.disposables.length, 0);
  }
});

test("WorkspaceDocumentStore rolls back registration failure and drains cleanup errors", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const registrationError = new Error("listener registration failed");
  const disposalError = new Error("listener disposal failed");
  const disposables = [];
  let changeRegistrations = 0;
  const disposable = (name, throws = false) => {
    const value = {
      disposeCalls: 0,
      dispose() {
        this.disposeCalls += 1;
        if (throws) {
          throw disposalError;
        }
      },
      name,
    };
    disposables.push(value);
    return value;
  };
  const workspace = {
    findFiles() {
      return Promise.resolve([]);
    },
    onDidOpenTextDocument() {
      return disposable("open", changeRegistrations > 0);
    },
    onDidChangeTextDocument() {
      changeRegistrations += 1;
      if (changeRegistrations === 1) {
        throw registrationError;
      }
      return disposable("change");
    },
    onDidCloseTextDocument() {
      return disposable("close");
    },
    createFileSystemWatcher() {
      const watcher = disposable("watcher");
      Object.assign(watcher, {
        onDidChange() {
          return disposable("watcher-change");
        },
        onDidCreate() {
          return disposable("watcher-create");
        },
        onDidDelete() {
          return disposable("watcher-delete");
        },
      });
      return watcher;
    },
  };
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem({}),
    vscode: { workspace },
  });

  assert.throws(() => store.start(), (error) => error === registrationError);
  assert.deepEqual(disposables.map(({ disposeCalls, name }) => ({ disposeCalls, name })), [
    { disposeCalls: 1, name: "open" },
  ]);

  await store.start();
  assert.doesNotThrow(() => store.dispose());
  assert.doesNotThrow(() => store.dispose());

  assert.equal(disposables.slice(1).every(({ disposeCalls }) => disposeCalls === 1), true);
  assert.equal(store.disposables.length, 0);
  assert.equal(store.diskDocuments.size, 0);
  assert.equal(store.fileGenerations.size, 0);
});

test("WorkspaceDocumentStore neutralizes terminal registration failures", async () => {
  for (const boundary of ["document listener", "watcher listener"]) {
    const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
    const registrationError = new Error(`terminal ${boundary} failure`);
    const calls = [];
    const resources = [];
    let store;
    const resource = (name) => {
      const value = {
        disposeCalls: 0,
        dispose() {
          this.disposeCalls += 1;
          calls.push(`dispose:${name}`);
        },
        name,
      };
      resources.push(value);
      return value;
    };
    const workspace = {
      findFiles() {
        calls.push("find");
        return Promise.resolve([]);
      },
      onDidOpenTextDocument() {
        calls.push("open");
        return resource("open");
      },
      onDidChangeTextDocument() {
        calls.push("change");
        if (boundary === "document listener") {
          store.dispose();
          throw registrationError;
        }
        return resource("change");
      },
      onDidCloseTextDocument() {
        calls.push("close");
        return resource("close");
      },
      createFileSystemWatcher() {
        calls.push("watcher");
        const watcher = resource("watcher");
        Object.assign(watcher, {
          onDidChange() {
            calls.push("watcher-change");
            return resource("watcher-change");
          },
          onDidCreate() {
            calls.push("watcher-create");
            store.dispose();
            throw registrationError;
          },
          onDidDelete() {
            calls.push("watcher-delete");
            return resource("watcher-delete");
          },
        });
        return watcher;
      },
    };
    store = new WorkspaceDocumentStore({
      fileSystem: createFakeFileSystem({}),
      vscode: { workspace },
    });

    let startError;
    try {
      await store.start();
    } catch (error) {
      startError = error;
    }
    store.dispose();

    assert.deepEqual({
      calls,
      resources: resources.map(({ disposeCalls, name }) => ({ disposeCalls, name })),
      startError,
      state: {
        changeListeners: store.changeListeners.size,
        diskDocuments: store.diskDocuments.size,
        disposables: store.disposables.length,
        fileGenerations: store.fileGenerations.size,
        readyPromise: store.readyPromise,
        scanComplete: store.isScanComplete(),
      },
    }, {
      calls: boundary === "document listener"
        ? ["open", "change", "dispose:open"]
        : [
          "open",
          "change",
          "close",
          "watcher",
          "watcher-create",
          "dispose:open",
          "dispose:change",
          "dispose:close",
          "dispose:watcher",
        ],
      resources: boundary === "document listener"
        ? [{ disposeCalls: 1, name: "open" }]
        : [
          { disposeCalls: 1, name: "open" },
          { disposeCalls: 1, name: "change" },
          { disposeCalls: 1, name: "close" },
          { disposeCalls: 1, name: "watcher" },
        ],
      startError: undefined,
      state: {
        changeListeners: 0,
        diskDocuments: 0,
        disposables: 0,
        fileGenerations: 0,
        readyPromise: undefined,
        scanComplete: false,
      },
    });
  }
});

test("WorkspaceDocumentStore does not retain readiness after synchronous scan disposal", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const search = controlledThenable();
  let store;
  const workspace = {
    findFiles() {
      store.dispose();
      return search.thenable;
    },
    onDidChangeTextDocument() {
      return { dispose() {} };
    },
    onDidCloseTextDocument() {
      return { dispose() {} };
    },
    onDidOpenTextDocument() {
      return { dispose() {} };
    },
  };
  store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem({}),
    vscode: { workspace },
  });

  const ready = store.start();
  await search.entered;
  assert.equal(await ready, undefined);
  const terminalSnapshot = {
    readyPromise: store.readyPromise,
    scanComplete: store.isScanComplete(),
  };

  search.reject(new Error("late synchronous scan failure"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(terminalSnapshot, {
    readyPromise: undefined,
    scanComplete: false,
  });
  assert.deepEqual(search.state, { registrations: 1, rejectionHandlers: 1 });
  assert.equal(store.isScanComplete(), false);
});

test("WorkspaceDocumentStore coalesces synchronous start reentrancy during registration", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const calls = {
    change: 0,
    close: 0,
    find: 0,
    open: 0,
    watchers: 0,
  };
  let nestedReady;
  let reentered = false;
  let store;
  const watcher = {
    dispose() {},
    onDidChange() {
      return { dispose() {} };
    },
    onDidCreate() {
      return { dispose() {} };
    },
    onDidDelete() {
      return { dispose() {} };
    },
  };
  const workspace = {
    findFiles() {
      calls.find += 1;
      return Promise.resolve([]);
    },
    onDidOpenTextDocument() {
      calls.open += 1;
      if (!reentered) {
        reentered = true;
        nestedReady = store.start();
      }
      return { dispose() {} };
    },
    onDidChangeTextDocument() {
      calls.change += 1;
      return { dispose() {} };
    },
    onDidCloseTextDocument() {
      calls.close += 1;
      return { dispose() {} };
    },
    createFileSystemWatcher() {
      calls.watchers += 1;
      return watcher;
    },
  };
  store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem({}),
    vscode: { workspace },
  });

  const outerReady = store.start();
  await outerReady;

  assert.equal(nestedReady, outerReady);
  assert.deepEqual(calls, {
    change: 1,
    close: 1,
    find: 1,
    open: 1,
    watchers: 1,
  });
  store.dispose();
});

test("WorkspaceDocumentStore releases a reentrant start after live registration failure", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const registrationError = new Error("reentrant listener registration failed");
  let changeRegistrations = 0;
  let nestedReady;
  let reentered = false;
  let store;
  const watcher = {
    dispose() {},
    onDidChange() {
      return { dispose() {} };
    },
    onDidCreate() {
      return { dispose() {} };
    },
    onDidDelete() {
      return { dispose() {} };
    },
  };
  const workspace = {
    findFiles() {
      return Promise.resolve([]);
    },
    onDidOpenTextDocument() {
      if (!reentered) {
        reentered = true;
        nestedReady = store.start();
      }
      return { dispose() {} };
    },
    onDidChangeTextDocument() {
      changeRegistrations += 1;
      if (changeRegistrations === 1) {
        throw registrationError;
      }
      return { dispose() {} };
    },
    onDidCloseTextDocument() {
      return { dispose() {} };
    },
    createFileSystemWatcher() {
      return watcher;
    },
  };
  store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem({}),
    vscode: { workspace },
  });

  assert.throws(() => store.start(), (error) => error === registrationError);
  let nestedOutcome = { status: "pending" };
  nestedReady.then(
    (value) => {
      nestedOutcome = { status: "fulfilled", value };
    },
    (error) => {
      nestedOutcome = { error, status: "rejected" };
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.readyPromise, undefined);
  const retry = store.start();

  assert.deepEqual(nestedOutcome, { status: "fulfilled", value: undefined });
  assert.notEqual(retry, nestedReady);
  assert.equal(await retry, undefined);
  assert.equal(store.readyPromise, retry);
  store.dispose();
});

test("WorkspaceDocumentStore clears successful scan state during disposal", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const file = "/ws/src/Steps.kt";
  const { vscode } = createFakeVscode({ files: [file] });
  const store = new WorkspaceDocumentStore({
    fileSystem: createFakeFileSystem({ [file]: "package steps\n" }),
    vscode,
  });
  store.onDidChangeDocuments(() => undefined);

  await store.start();
  store.documents();
  assert.deepEqual({
    cached: Array.isArray(store.cachedDocuments),
    changeListeners: store.changeListeners.size,
    diskDocuments: store.diskDocuments.size,
    scanComplete: store.isScanComplete(),
  }, {
    cached: true,
    changeListeners: 1,
    diskDocuments: 1,
    scanComplete: true,
  });

  store.dispose();

  assert.deepEqual({
    cachedDocuments: store.cachedDocuments,
    changeListeners: store.changeListeners.size,
    diskDocuments: store.diskDocuments.size,
    scanComplete: store.isScanComplete(),
  }, {
    cachedDocuments: undefined,
    changeListeners: 0,
    diskDocuments: 0,
    scanComplete: false,
  });
});

test("WorkspaceDocumentStore skips queued project lookups after disposal", async () => {
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const files = ["/ws/src/First.kt", "/ws/src/Second.kt"];
  const firstRead = controlledThenable();
  const reads = [];
  const projectLookups = [];
  const { vscode } = createFakeVscode({ files });
  const store = new WorkspaceDocumentStore({
    fileSystem: {
      promises: {
        readFile(file) {
          reads.push(file);
          return firstRead.thenable;
        },
      },
    },
    initialReadConcurrency: 1,
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        projectLookups.push(file);
        return "/ws";
      },
      isGaugeProject() {
        return true;
      },
    },
    vscode,
  });
  const scanWorkspace = store.scanWorkspace.bind(store);
  let scan;
  store.scanWorkspace = () => {
    scan = scanWorkspace();
    return scan;
  };
  const ready = store.start();

  try {
    await firstRead.entered;
    store.dispose();
    firstRead.resolve("package first\n");
    await scan;
    await ready;

    assert.deepEqual(projectLookups, [files[0]]);
    assert.deepEqual(reads, [files[0]]);
    assert.equal(store.diskDocuments.size, 0);
    assert.equal(store.isScanComplete(), false);
  } finally {
    firstRead.resolve("");
    store.dispose();
    await Promise.allSettled([ready, scan]);
  }
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
