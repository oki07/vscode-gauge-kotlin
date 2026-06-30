const assert = require("node:assert/strict");
const test = require("node:test");

function createCollection() {
  const entries = new Map();
  return {
    add(item) {
      entries.set(item.id, item);
    },
    delete(id) {
      entries.delete(id);
    },
    get(id) {
      return entries.get(id);
    },
    values() {
      return [...entries.values()];
    },
  };
}

function createDocument(text, filename = "/workspace/specs/example.spec", languageId = "gauge") {
  const lines = text.split(/\r?\n/);
  return {
    fileName: filename,
    languageId,
    lineCount: lines.length,
    uri: { fsPath: filename },
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] || "" };
    },
  };
}

function createFakeVscode(options = {}) {
  const calls = [];
  const documentListeners = {
    close: undefined,
  };
  const watcherListeners = {
    create: undefined,
    delete: undefined,
  };
  const controller = {
    id: "gauge",
    items: createCollection(),
    createRunProfile(label, kind, handler, isDefault) {
      calls.push(["profile", label, kind, handler, isDefault]);
      return { dispose() {} };
    },
    createTestItem(id, label, uri) {
      return {
        id,
        label,
        uri,
        children: createCollection(),
      };
    },
    createTestRun(request) {
      calls.push(["run", request]);
      return {
        appendOutput(output) {
          calls.push(["output", output]);
        },
        end() {
          calls.push(["end"]);
        },
        failed(item, message, duration) {
          calls.push(["failed", item.id, message.message || message, duration]);
        },
        passed(item, duration) {
          calls.push(["passed", item.id, duration]);
        },
        skipped(item, message) {
          calls.push(["skipped", item.id, message && (message.message || message)]);
        },
        started(item) {
          calls.push(["started", item.id]);
        },
      };
    },
    dispose() {
      calls.push(["dispose"]);
    },
  };
  return {
    calls,
    controller,
    vscode: {
      TestMessage: class TestMessage {
        constructor(message) {
          this.message = message;
        }
      },
      TestRunProfileKind: {
        Debug: 2,
        Run: 1,
      },
      Uri: {
        file(filename) {
          return { fsPath: filename };
        },
      },
      tests: {
        createTestController(id, label) {
          calls.push(["controller", id, label]);
          return controller;
        },
      },
      window: {
        showErrorMessage(message) {
          calls.push(["errorMessage", message]);
          return Promise.resolve(undefined);
        },
        showInformationMessage(message) {
          calls.push(["informationMessage", message]);
          return Promise.resolve(undefined);
        },
        showWarningMessage(message) {
          calls.push(["warningMessage", message]);
          return Promise.resolve(undefined);
        },
      },
      workspace: {
        textDocuments: options.textDocuments || [],
        onDidChangeTextDocument() {
          return { dispose() {} };
        },
        onDidCloseTextDocument(listener) {
          documentListeners.close = listener;
          return { dispose() {} };
        },
        createFileSystemWatcher(pattern, ignoreCreate, ignoreChange, ignoreDelete) {
          watcherListeners.pattern = pattern;
          watcherListeners.ignoreCreate = ignoreCreate;
          watcherListeners.ignoreChange = ignoreChange;
          watcherListeners.ignoreDelete = ignoreDelete;
          return {
            dispose() {},
            onDidCreate(listener) {
              watcherListeners.create = listener;
              return { dispose() {} };
            },
            onDidDelete(listener) {
              watcherListeners.delete = listener;
              return { dispose() {} };
            },
          };
        },
        onDidOpenTextDocument() {
          return { dispose() {} };
        },
        onDidSaveTextDocument() {
          return { dispose() {} };
        },
      },
    },
    documentListeners,
    watcherListeners,
  };
}

function createCancellationToken() {
  const listeners = [];
  let disposed = false;
  return {
    token: {
      isCancellationRequested: false,
      onCancellationRequested(listener) {
        listeners.push(listener);
        return {
          dispose() {
            disposed = true;
          },
        };
      },
    },
    cancel() {
      this.token.isCancellationRequested = true;
      for (const listener of listeners) {
        listener();
      }
    },
    get disposed() {
      return disposed;
    },
  };
}

test("GaugeTestController maps execution events into VS Code TestRun calls", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });

  const disposable = gaugeTests.register();
  gaugeTests.startTestRun({ include: [] });
  const sink = gaugeTests.createExecutionEventSink();
  sink({
    type: "suiteStarted",
    id: "/workspace/specs/example.spec",
    name: "Checkout",
    location: "gauge:///workspace/specs/example.spec:1",
  });
  sink({
    type: "testStarted",
    id: "/workspace/specs/example.spec:12",
    parentId: "/workspace/specs/example.spec",
    name: "Successful checkout",
    location: "gauge:///workspace/specs/example.spec:12",
  });
  sink({
    type: "testFinished",
    id: "/workspace/specs/example.spec:12",
    name: "Successful checkout",
    duration: 42,
  });
  sink({
    type: "suiteFinished",
    id: "/workspace/specs/example.spec",
    name: "Checkout",
    duration: 100,
  });
  disposable.dispose();

  assert.deepEqual(controller.items.values().map((item) => item.id), [
    "/workspace/specs/example.spec",
  ]);
  assert.deepEqual(controller.items.get("/workspace/specs/example.spec").children.values().map((item) => item.id), [
    "/workspace/specs/example.spec:12",
  ]);
  assert.deepEqual(calls, [
    ["controller", "gauge", "Gauge"],
    ["profile", "Run", 1, calls[1][3], true],
    ["profile", "Debug", 2, calls[2][3], false],
    ["profile", "Run Failed", 1, calls[3][3], false],
    ["run", { include: [] }],
    ["started", "/workspace/specs/example.spec"],
    ["started", "/workspace/specs/example.spec:12"],
    ["passed", "/workspace/specs/example.spec:12", 42],
    ["passed", "/workspace/specs/example.spec", 100],
    ["dispose"],
  ]);
});

test("GaugeTestController does not pass a specification with a failed scenario", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();
  gaugeTests.startTestRun({});
  const sink = gaugeTests.createExecutionEventSink();
  sink({
    type: "suiteStarted",
    id: "/workspace/specs/example.spec",
    name: "Checkout",
  });
  sink({
    type: "testStarted",
    id: "/workspace/specs/example.spec:12",
    parentId: "/workspace/specs/example.spec",
    name: "Successful checkout",
  });
  sink({
    type: "testFinished",
    id: "/workspace/specs/example.spec:12",
    parentId: "/workspace/specs/example.spec",
    name: "Successful checkout",
    duration: 42,
  });
  sink({
    type: "testStarted",
    id: "/workspace/specs/example.spec:20",
    parentId: "/workspace/specs/example.spec",
    name: "Failed checkout",
  });
  sink({
    type: "testFailed",
    id: "/workspace/specs/example.spec:20",
    parentId: "/workspace/specs/example.spec",
    name: "Failed checkout",
    message: "Expected success",
  });
  sink({
    type: "testFinished",
    id: "/workspace/specs/example.spec:20",
    parentId: "/workspace/specs/example.spec",
    name: "Failed checkout",
    duration: 9,
  });
  sink({
    type: "suiteFinished",
    id: "/workspace/specs/example.spec",
    name: "Checkout",
    duration: 100,
  });

  assert.deepEqual(calls.filter((entry) => entry[0] === "passed"), [
    ["passed", "/workspace/specs/example.spec:12", 42],
  ]);
  assert.deepEqual(calls.filter((entry) => entry[0] === "failed"), [
    ["failed", "/workspace/specs/example.spec:20", "Expected success", 9],
    ["failed", "/workspace/specs/example.spec", "Expected success", 100],
  ]);
});

test("GaugeTestController discovers specification and scenario test items from open Gauge documents", () => {
  const { GaugeTestController } = require("../src/testController");
  const document = createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
    "* Pay by card",
    "",
    "## Declined checkout",
    "* Pay by expired card",
    "",
  ].join("\n"));
  const { controller, vscode } = createFakeVscode({ textDocuments: [document] });
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();

  const spec = controller.items.get("/workspace/specs/example.spec");
  assert.equal(spec.label, "Checkout");
  assert.deepEqual(spec.uri, { fsPath: "/workspace/specs/example.spec" });
  assert.deepEqual(spec.children.values().map((item) => [item.id, item.label]), [
    ["/workspace/specs/example.spec:3", "Successful checkout"],
    ["/workspace/specs/example.spec:6", "Declined checkout"],
  ]);
});

test("GaugeTestController discovers specification and scenario test items from open Markdown Gauge specs", () => {
  const { GaugeTestController } = require("../src/testController");
  const document = createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
    "* Pay by card",
    "",
  ].join("\n"), "/workspace/gauge/specs/example.md", "markdown");
  const { controller, vscode } = createFakeVscode({ textDocuments: [document] });
  const gaugeTests = new GaugeTestController({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/example.md");
        return "/workspace/gauge";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/gauge");
        return true;
      },
    },
    vscode,
  });

  gaugeTests.register();

  const spec = controller.items.get("/workspace/gauge/specs/example.md");
  assert.equal(spec.label, "Checkout");
  assert.deepEqual(spec.uri, { fsPath: "/workspace/gauge/specs/example.md" });
  assert.deepEqual(spec.children.values().map((item) => [item.id, item.label]), [
    ["/workspace/gauge/specs/example.md:3", "Successful checkout"],
  ]);
});

test("GaugeTestController ignores open Gauge documents outside Gauge projects", () => {
  const { GaugeTestController } = require("../src/testController");
  const document = createDocument([
    "# Notes",
    "",
    "## Draft",
    "* Not a Gauge project",
    "",
  ].join("\n"), "/workspace/notes/example.spec");
  const { controller, vscode } = createFakeVscode({ textDocuments: [document] });
  const gaugeTests = new GaugeTestController({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/example.spec");
        throw new Error("not a Gauge project");
      },
    },
    vscode,
  });

  gaugeTests.register();

  assert.deepEqual(controller.items.values(), []);
});

test("GaugeTestController ignores markdown subheadings in open Gauge documents", () => {
  const { GaugeTestController } = require("../src/testController");
  const document = createDocument([
    "# Checkout",
    "",
    "### Notes",
    "* Plain markdown bullet",
    "",
  ].join("\n"));
  const { controller, vscode } = createFakeVscode({ textDocuments: [document] });
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();

  const spec = controller.items.get("/workspace/specs/example.spec");
  assert.equal(spec.label, "Checkout");
  assert.deepEqual(spec.children.values(), []);
  assert.equal(controller.items.get("/workspace/specs/example.spec:3"), undefined);
});

test("GaugeTestController resolves unopened workspace specs from Gauge LSP", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, vscode } = createFakeVscode();
  const requests = [];
  const clientsMap = new Map([
    [
      "/workspace/gauge",
      {
        client: {
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
        },
      },
    ],
  ]);
  const gaugeTests = new GaugeTestController({ clientsMap, vscode });

  gaugeTests.register();
  await gaugeTests.discoverWorkspaceTests();

  const spec = controller.items.get("/workspace/gauge/specs/checkout.spec");
  assert.equal(spec.label, "Checkout");
  assert.deepEqual(spec.uri, { fsPath: "/workspace/gauge/specs/checkout.spec" });
  assert.deepEqual(spec.children.values().map((item) => ({
    id: item.id,
    label: item.label,
    range: {
      start: { ...item.range.start },
      end: { ...item.range.end },
    },
  })), [
    {
      id: "/workspace/gauge/specs/checkout.spec:12",
      label: "Successful checkout",
      range: {
        start: { line: 11, character: 0 },
        end: { line: 11, character: 0 },
      },
    },
  ]);
  assert.deepEqual(requests.map((request) => request.method), [
    "gauge/specs",
    "gauge/scenarios",
  ]);
  assert.deepEqual({
    ...requests[1].params,
    position: { ...requests[1].params.position },
  }, {
    textDocument: { uri: "/workspace/gauge/specs/checkout.spec" },
    position: { line: 1, character: 1 },
  });
});

test("GaugeTestController refreshes and prunes workspace tests on spec file changes", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, vscode, watcherListeners } = createFakeVscode();
  let specs = [
    {
      heading: "Old checkout",
      executionIdentifier: "/workspace/gauge/specs/old.spec",
    },
  ];
  const requests = [];
  const clientsMap = new Map([
    [
      "/workspace/gauge",
      {
        client: {
          sendRequest(method, params) {
            requests.push({ method, params });
            if (method === "gauge/specs") {
              return Promise.resolve(specs);
            }
            if (method === "gauge/scenarios") {
              return Promise.resolve([]);
            }
            return Promise.resolve([]);
          },
        },
      },
    ],
  ]);
  const gaugeTests = new GaugeTestController({ clientsMap, vscode });

  gaugeTests.register();
  await gaugeTests.discoverWorkspaceTests();

  assert.equal(controller.items.get("/workspace/gauge/specs/old.spec").label, "Old checkout");
  assert.deepEqual({
    pattern: watcherListeners.pattern,
    ignoreCreate: watcherListeners.ignoreCreate,
    ignoreChange: watcherListeners.ignoreChange,
    ignoreDelete: watcherListeners.ignoreDelete,
  }, {
    pattern: "**/*.{spec,md}",
    ignoreCreate: false,
    ignoreChange: true,
    ignoreDelete: false,
  });

  specs = [
    {
      heading: "New checkout",
      executionIdentifier: "/workspace/gauge/specs/new.spec",
    },
  ];
  await watcherListeners.create({ fsPath: "/workspace/gauge/specs/new.spec" });

  assert.equal(controller.items.get("/workspace/gauge/specs/old.spec"), undefined);
  assert.equal(controller.items.get("/workspace/gauge/specs/new.spec").label, "New checkout");
  assert.deepEqual(requests.map((request) => request.method), [
    "gauge/specs",
    "gauge/scenarios",
    "gauge/specs",
    "gauge/scenarios",
  ]);
});

test("GaugeTestController prunes removed client workspace tests on project changes", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, vscode } = createFakeVscode();
  const projectListeners = [];
  const projectChanges = {
    onDidChangeProjects(listener) {
      projectListeners.push(listener);
      return { dispose() {} };
    },
  };
  const firstClient = {
    sendRequest(method) {
      if (method === "gauge/specs") {
        return Promise.resolve([
          {
            heading: "Old checkout",
            executionIdentifier: "/workspace/old/specs/checkout.spec",
          },
        ]);
      }
      if (method === "gauge/scenarios") {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    },
  };
  const secondClient = {
    sendRequest(method) {
      if (method === "gauge/specs") {
        return Promise.resolve([
          {
            heading: "New checkout",
            executionIdentifier: "/workspace/new/specs/checkout.spec",
          },
        ]);
      }
      if (method === "gauge/scenarios") {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    },
  };
  const clientsMap = new Map([
    ["/workspace/old", { client: firstClient }],
  ]);
  const gaugeTests = new GaugeTestController({ clientsMap, projectChanges, vscode });

  gaugeTests.register();
  await gaugeTests.discoverWorkspaceTests();
  clientsMap.delete("/workspace/old");
  clientsMap.set("/workspace/new", { client: secondClient });
  await projectListeners[0]("/workspace/new");

  assert.equal(controller.items.get("/workspace/old/specs/checkout.spec"), undefined);
  assert.equal(controller.items.get("/workspace/new/specs/checkout.spec").label, "New checkout");
});

test("GaugeTestController keeps workspace-discovered tests when documents close", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, documentListeners, vscode } = createFakeVscode();
  const clientsMap = new Map([
    [
      "/workspace/gauge",
      {
        client: {
          sendRequest(method) {
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
        },
      },
    ],
  ]);
  const gaugeTests = new GaugeTestController({ clientsMap, vscode });

  gaugeTests.register();
  await gaugeTests.discoverWorkspaceTests();

  documentListeners.close(createDocument("", "/workspace/gauge/specs/checkout.spec"));

  const spec = controller.items.get("/workspace/gauge/specs/checkout.spec");
  assert.equal(spec.label, "Checkout");
  assert.deepEqual(spec.children.values().map((item) => [item.id, item.label]), [
    ["/workspace/gauge/specs/checkout.spec:12", "Successful checkout"],
  ]);
});

test("GaugeTestController runs included Gauge test items instead of all specs", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();
  const spec = controller.createTestItem(
    "/workspace/specs/example.spec",
    "Checkout",
    { fsPath: "/workspace/specs/example.spec" },
  );
  const scenario = controller.createTestItem(
    "/workspace/specs/example.spec:3",
    "Successful checkout",
    { fsPath: "/workspace/specs/example.spec" },
  );

  await gaugeTests.run({ include: [spec, scenario] });

  assert.deepEqual(executionCalls, [
    ["gauge.execute", "/workspace/specs/example.spec", {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
    ["gauge.execute", "/workspace/specs/example.spec:3", {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
  ]);
  assert.deepEqual(calls.filter((entry) => entry[0] === "end"), [["end"]]);
});

test("GaugeTestController batches multiple included specification items into one execution request", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, vscode } = createFakeVscode();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();
  const checkout = controller.createTestItem(
    "/workspace/specs/checkout.spec",
    "Checkout",
    { fsPath: "/workspace/specs/checkout.spec" },
  );
  const accounts = controller.createTestItem(
    "/workspace/specs/accounts.spec",
    "Accounts",
    { fsPath: "/workspace/specs/accounts.spec" },
  );

  await gaugeTests.run({ include: [checkout, accounts] });

  assert.deepEqual(executionCalls, [
    ["gauge.execute.specification", undefined, [
      "/workspace/specs/checkout.spec",
      "/workspace/specs/accounts.spec",
    ], {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
  ]);
});

test("GaugeTestController splits included specification batches by project root", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, vscode } = createFakeVscode();
  const executionCalls = [];
  const clientsMap = new Map([
    ["/workspace/checkout", { client: {} }],
    ["/workspace/accounts", { client: {} }],
  ]);
  const gaugeTests = new GaugeTestController({
    clientsMap,
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();
  const checkout = controller.createTestItem(
    "/workspace/checkout/specs/checkout.spec",
    "Checkout",
    { fsPath: "/workspace/checkout/specs/checkout.spec" },
  );
  const accounts = controller.createTestItem(
    "/workspace/accounts/specs/accounts.spec",
    "Accounts",
    { fsPath: "/workspace/accounts/specs/accounts.spec" },
  );

  await gaugeTests.run({ include: [checkout, accounts] });

  assert.deepEqual(executionCalls, [
    ["gauge.execute.specification", undefined, [
      "/workspace/checkout/specs/checkout.spec",
    ], {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
    ["gauge.execute.specification", undefined, [
      "/workspace/accounts/specs/accounts.spec",
    ], {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
  ]);
});

test("GaugeTestController expands included specifications when scenarios are excluded", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, vscode } = createFakeVscode();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();
  const spec = controller.createTestItem(
    "/workspace/specs/example.spec",
    "Checkout",
    { fsPath: "/workspace/specs/example.spec" },
  );
  const successful = controller.createTestItem(
    "/workspace/specs/example.spec:3",
    "Successful checkout",
    { fsPath: "/workspace/specs/example.spec" },
  );
  const declined = controller.createTestItem(
    "/workspace/specs/example.spec:8",
    "Declined checkout",
    { fsPath: "/workspace/specs/example.spec" },
  );
  spec.children.add(successful);
  spec.children.add(declined);

  await gaugeTests.run({ include: [spec], exclude: [declined] });

  assert.deepEqual(executionCalls, [
    ["gauge.execute", "/workspace/specs/example.spec:3", {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
  ]);
});

test("GaugeTestController runs known tests except excluded items", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, vscode } = createFakeVscode();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();
  const checkout = controller.createTestItem(
    "/workspace/specs/checkout.spec",
    "Checkout",
    { fsPath: "/workspace/specs/checkout.spec" },
  );
  const successful = controller.createTestItem(
    "/workspace/specs/checkout.spec:3",
    "Successful checkout",
    { fsPath: "/workspace/specs/checkout.spec" },
  );
  const declined = controller.createTestItem(
    "/workspace/specs/checkout.spec:8",
    "Declined checkout",
    { fsPath: "/workspace/specs/checkout.spec" },
  );
  const accounts = controller.createTestItem(
    "/workspace/specs/accounts.spec",
    "Accounts",
    { fsPath: "/workspace/specs/accounts.spec" },
  );
  checkout.children.add(successful);
  checkout.children.add(declined);
  controller.items.add(checkout);
  controller.items.add(accounts);

  await gaugeTests.run({ exclude: [declined] });

  assert.deepEqual(executionCalls, [
    ["gauge.execute", "/workspace/specs/checkout.spec:3", {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
    ["gauge.execute", "/workspace/specs/accounts.spec", {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
  ]);
});

test("GaugeTestController debug profile runs included Gauge test items in debug mode", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();
  const debugProfile = calls.find((entry) => entry[0] === "profile" && entry[1] === "Debug");
  const spec = controller.createTestItem(
    "/workspace/specs/example.spec",
    "Checkout",
    { fsPath: "/workspace/specs/example.spec" },
  );
  const scenario = controller.createTestItem(
    "/workspace/specs/example.spec:3",
    "Successful checkout",
    { fsPath: "/workspace/specs/example.spec" },
  );

  await debugProfile[3]({ include: [spec, scenario] });

  assert.deepEqual(executionCalls, [
    ["gauge.execute", "/workspace/specs/example.spec", {
      debug: true,
      "hide-suggestion": true,
      "machine-readable": true,
    }],
    ["gauge.execute", "/workspace/specs/example.spec:3", {
      debug: true,
      "hide-suggestion": true,
      "machine-readable": true,
    }],
  ]);
  assert.deepEqual(calls.filter((entry) => entry[0] === "end"), [["end"]]);
});

test("GaugeTestController forces machine-readable output for all-spec Test UI runs", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { vscode } = createFakeVscode();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();

  await gaugeTests.run({});

  assert.deepEqual(executionCalls, [
    ["gauge.execute.specification.all", undefined, {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
  ]);
});

test("GaugeTestController runs all known project roots for Test UI run all", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { vscode } = createFakeVscode();
  const executionCalls = [];
  const clientsMap = new Map([
    ["/workspace/checkout", { client: {} }],
    ["/workspace/accounts", { client: {} }],
  ]);
  const gaugeTests = new GaugeTestController({
    clientsMap,
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();

  await gaugeTests.run({});

  assert.deepEqual(executionCalls, [
    ["gauge.specexplorer.runAllActiveProjectSpecs", { projectRoot: "/workspace/checkout" }, {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
    ["gauge.specexplorer.runAllActiveProjectSpecs", { projectRoot: "/workspace/accounts" }, {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
  ]);
});

test("GaugeTestController registers a failed run profile for Test UI reruns", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, vscode } = createFakeVscode();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();
  const failedProfile = calls.find((entry) => entry[0] === "profile" && entry[1] === "Run Failed");

  assert.ok(failedProfile);
  assert.equal(failedProfile[2], 1);
  assert.equal(failedProfile[4], false);

  await failedProfile[3]({});

  assert.deepEqual(executionCalls, [
    ["gauge.execute.failed", undefined, {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
  ]);
  assert.deepEqual(calls.filter((entry) => entry[0] === "end"), [["end"]]);
});

test("GaugeTestController debug profile debugs all specs when no tests are included", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, vscode } = createFakeVscode();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();
  const debugProfile = calls.find((entry) => entry[0] === "profile" && entry[1] === "Debug");

  await debugProfile[3]({});

  assert.deepEqual(executionCalls, [
    ["gauge.execute.specification.all", undefined, {
      debug: true,
      "hide-suggestion": true,
      "machine-readable": true,
    }],
  ]);
});

test("GaugeTestController stops Gauge execution when Test UI run is cancelled", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, vscode } = createFakeVscode();
  const executionCalls = [];
  let finishRun;
  const runningCommand = new Promise((resolve) => {
    finishRun = resolve;
  });
  const gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        if (command === "gauge.execute") {
          return runningCommand;
        }
        return Promise.resolve(undefined);
      },
    },
  });
  const cancellation = createCancellationToken();

  gaugeTests.register();
  const scenario = controller.createTestItem(
    "/workspace/specs/example.spec:3",
    "Successful checkout",
    { fsPath: "/workspace/specs/example.spec" },
  );

  const run = gaugeTests.run({ include: [scenario] }, cancellation.token);
  cancellation.cancel();
  finishRun();
  await run;

  assert.deepEqual(executionCalls, [
    ["gauge.execute", "/workspace/specs/example.spec:3", {
      "hide-suggestion": true,
      "machine-readable": true,
    }],
    ["gauge.stopExecution"],
  ]);
  assert.equal(cancellation.disposed, true);
});

test("GaugeTestController delays failed and skipped results until finish events provide duration", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();
  gaugeTests.startTestRun({});
  const sink = gaugeTests.createExecutionEventSink();
  sink({
    type: "testStarted",
    id: "scenario-1",
    name: "Scenario one",
  });
  sink({
    type: "testFailed",
    id: "scenario-1",
    name: "Scenario one",
    message: "Expected success",
  });
  sink({
    type: "testFinished",
    id: "scenario-1",
    name: "Scenario one",
    duration: 7,
  });
  sink({
    type: "testStarted",
    id: "scenario-2",
    name: "Scenario two",
  });
  sink({
    type: "testIgnored",
    id: "scenario-2",
    name: "Scenario two",
    message: "Skipped: missing dependency",
  });
  sink({
    type: "testFinished",
    id: "scenario-2",
    name: "Scenario two",
    duration: 9,
  });

  assert.deepEqual(calls.filter((entry) => [
    "failed",
    "passed",
    "skipped",
    "started",
  ].includes(entry[0])), [
    ["started", "scenario-1"],
    ["failed", "scenario-1", "Expected success", 7],
    ["started", "scenario-2"],
    ["skipped", "scenario-2", "Skipped: missing dependency"],
  ]);
});

test("GaugeTestController displays Gauge notification events through VS Code messages", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();
  const sink = gaugeTests.createExecutionEventSink();
  sink({
    type: "notification",
    title: "Gauge",
    message: "Install plugin",
    severity: "warning",
  });
  sink({
    type: "notification",
    title: "Gauge",
    message: "Execution failed",
    severity: "error",
  });
  sink({
    type: "notification",
    title: "Gauge",
    message: "Execution completed",
    severity: "info",
  });

  assert.deepEqual(calls.filter((entry) => entry[0].endsWith("Message")), [
    ["warningMessage", "Gauge: Install plugin"],
    ["errorMessage", "Gauge: Execution failed"],
    ["informationMessage", "Gauge: Execution completed"],
  ]);
});
