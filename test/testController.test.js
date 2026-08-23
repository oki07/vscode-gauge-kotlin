const assert = require("node:assert/strict");
const test = require("node:test");

function collectionItems(collection) {
  const items = [];
  collection.forEach((item) => items.push(item));
  return items;
}

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
    // TestItemCollection has no values(): vscode.d.ts declares size, replace,
    // forEach, add, delete, get and Iterable<[id, TestItem]>.
    get size() {
      return entries.size;
    },
    replace(items) {
      entries.clear();
      for (const item of items) {
        entries.set(item.id, item);
      }
    },
    forEach(callback, thisArg) {
      for (const item of [...entries.values()]) {
        callback.call(thisArg, item, this);
      }
    },
    [Symbol.iterator]() {
      return entries.entries();
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
  const commandCalls = [];
  const profiles = [];
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
    createRunProfile(label, kind, handler, isDefault, tag) {
      calls.push(["profile", label, kind, handler, isDefault]);
      const profile = { dispose() {}, tag };
      profiles.push(profile);
      return profile;
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
        appendOutput(output, location, item) {
          calls.push(item
            ? ["output", output, location, item.id]
            : ["output", output]);
        },
        end() {
          calls.push(["end"]);
        },
        errored(item, message, duration) {
          calls.push(["errored", item.id, message.message || message, duration, message.location]);
        },
        failed(item, message, duration) {
          calls.push(["failed", item.id, message.message || message, duration]);
        },
        passed(item, duration) {
          calls.push(["passed", item.id, duration]);
        },
        skipped(item) {
          // TestRun.skipped takes no message: vscode.d.ts declares
          // skipped(test: TestItem): void
          calls.push(["skipped", item.id]);
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
    commandCalls,
    controller,
    profiles,
    vscode: {
      commands: {
        executeCommand(command) {
          commandCalls.push(command);
          return Promise.resolve(undefined);
        },
      },
      TestMessage: class TestMessage {
        constructor(message) {
          this.message = message;
        }
      },
      TestTag: class TestTag {
        constructor(id) {
          this.id = id;
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

  assert.deepEqual(collectionItems(controller.items).map((item) => item.id), [
    "/workspace/specs/example.spec",
  ]);
  assert.deepEqual(collectionItems(controller.items.get("/workspace/specs/example.spec").children).map((item) => item.id), [
    "/workspace/specs/example.spec:12",
  ]);
  assert.deepEqual(calls, [
    ["controller", "gauge", "Gauge"],
    ["profile", "Run", 1, calls[1][3], true],
    ["profile", "Debug", 2, calls[2][3], false],
    ["profile", "Run Failed", 1, calls[3][3], false],
    ["profile", "Run Repeat", 1, calls[4][3], false],
    ["run", { include: [] }],
    ["started", "/workspace/specs/example.spec:12"],
    ["passed", "/workspace/specs/example.spec:12", 42],
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
  ]);
});

test("GaugeTestController maps specification diagnostics to TestRun errors", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();
  gaugeTests.startTestRun({});
  const sink = gaugeTests.createExecutionEventSink();
  const event = {
    id: "/workspace/specs/example.spec::result:specification-errors",
    parentId: "/workspace/specs/example.spec",
    name: "Specification Errors",
    location: "gauge:///workspace/specs/example.spec:9",
    resultOnly: true,
  };
  sink({ type: "testStarted", ...event });
  sink({ type: "testErrored", ...event, message: "Validation failed" });
  sink({ type: "testFinished", ...event, duration: 7 });

  assert.deepEqual(calls.filter((call) => call[0] === "errored"), [[
    "errored",
    event.id,
    "Validation failed",
    7,
    {
      uri: { fsPath: "/workspace/specs/example.spec" },
      range: {
        start: { line: 8, character: 0 },
        end: { line: 8, character: 0 },
      },
    },
  ]]);
  assert.deepEqual(calls.filter((call) => call[0] === "passed"), []);
  const spec = gaugeTests.controller.items.get("/workspace/specs/example.spec");
  assert.equal(spec.children.get(event.id).uri, undefined);
});

test("GaugeTestController keeps retry attempts distinct for repeated scenario ids", () => {
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
    name: "Flaky checkout",
  });
  sink({
    type: "testFailed",
    id: "/workspace/specs/example.spec:12",
    parentId: "/workspace/specs/example.spec",
    name: "Flaky checkout",
    message: "First attempt failed",
  });
  sink({
    type: "testFinished",
    id: "/workspace/specs/example.spec:12",
    parentId: "/workspace/specs/example.spec",
    name: "Flaky checkout",
    duration: 4,
  });
  sink({
    type: "testStarted",
    id: "/workspace/specs/example.spec:12",
    parentId: "/workspace/specs/example.spec",
    name: "Flaky checkout",
  });
  sink({
    type: "testFinished",
    id: "/workspace/specs/example.spec:12",
    parentId: "/workspace/specs/example.spec",
    name: "Flaky checkout",
    duration: 5,
  });
  sink({
    type: "suiteFinished",
    id: "/workspace/specs/example.spec",
    name: "Checkout",
    duration: 20,
  });

  assert.deepEqual(calls.filter((entry) => [
    "failed",
    "passed",
    "started",
  ].includes(entry[0])), [
    ["started", "/workspace/specs/example.spec:12"],
    ["failed", "/workspace/specs/example.spec:12", "First attempt failed", 4],
    ["started", "/workspace/specs/example.spec:12#attempt=2"],
    ["passed", "/workspace/specs/example.spec:12#attempt=2", 5],
  ]);
});

test("GaugeTestController keeps result-only leaves non-runnable and clears them before the next run", () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, profiles, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();
  gaugeTests.discoverDocument(createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
  ].join("\n")));
  gaugeTests.startTestRun({});
  const sink = gaugeTests.createExecutionEventSink();
  sink({
    type: "testStarted",
    id: "/workspace/specs/example.spec::hook:before-specification",
    parentId: "/workspace/specs/example.spec",
    name: "Before Specification",
    resultOnly: true,
  });
  sink({
    type: "testFailed",
    id: "/workspace/specs/example.spec::hook:before-specification",
    parentId: "/workspace/specs/example.spec",
    name: "Before Specification",
    message: "Setup failed",
    resultOnly: true,
  });
  sink({
    type: "testFinished",
    id: "/workspace/specs/example.spec::hook:before-specification",
    parentId: "/workspace/specs/example.spec",
    name: "Before Specification",
    resultOnly: true,
  });

  const spec = controller.items.get("/workspace/specs/example.spec");
  const scenario = spec.children.get("/workspace/specs/example.spec:3");
  const hook = spec.children.get("/workspace/specs/example.spec::hook:before-specification");
  assert.deepEqual(spec.tags.map((tag) => tag.id), ["gauge-runnable"]);
  assert.deepEqual(scenario.tags.map((tag) => tag.id), ["gauge-runnable"]);
  assert.deepEqual(hook.tags, []);
  assert.equal(profiles.length, 4);
  assert.equal(profiles.every((profile) => profile.tag.id === "gauge-runnable"), true);

  gaugeTests.startTestRun({});

  assert.equal(
    spec.children.get("/workspace/specs/example.spec::hook:before-specification"),
    undefined,
  );
  assert.equal(controller.items.get("/workspace/specs/example.spec"), spec);
});

test("GaugeTestController anchors a result-only hook inside a scenario-only run and removes it after end", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  let gaugeTests;
  let hookDuringRun;
  const hookId = "/workspace/specs/example.spec::hook:before-specification";
  const executionController = {
    handleCommand() {
      const sink = gaugeTests.createExecutionEventSink();
      for (const type of ["testStarted", "testFailed", "testFinished"]) {
        sink({
          type,
          id: hookId,
          parentId: "/workspace/specs/example.spec",
          name: "Before Specification",
          message: type === "testFailed" ? "Setup failed" : undefined,
          resultOnly: true,
        });
      }
      const spec = controller.items.get("/workspace/specs/example.spec");
      const scenario = spec.children.get("/workspace/specs/example.spec:3");
      hookDuringRun = scenario.children.get(hookId);
      return Promise.resolve(undefined);
    },
  };
  gaugeTests = new GaugeTestController({ executionController, vscode });
  gaugeTests.register();
  gaugeTests.discoverDocument(createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
  ].join("\n")));
  const spec = controller.items.get("/workspace/specs/example.spec");
  const scenario = spec.children.get("/workspace/specs/example.spec:3");

  await gaugeTests.run({ include: [scenario] });

  assert.equal(hookDuringRun && hookDuringRun.id, hookId);
  assert.equal(spec.children.get(hookId), undefined);
  assert.equal(scenario.children.get(hookId), undefined);
  assert.ok(calls.findIndex((call) => call[0] === "failed") < calls.findIndex((call) => call[0] === "end"));
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
  assert.deepEqual(collectionItems(spec.children).map((item) => [item.id, item.label]), [
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
  assert.deepEqual(collectionItems(spec.children).map((item) => [item.id, item.label]), [
    ["/workspace/gauge/specs/example.md:3", "Successful checkout"],
  ]);
});

test("GaugeTestController discovers specification and scenario test items from open spec files by extension", () => {
  const { GaugeTestController } = require("../src/testController");
  const document = createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
    "* Pay by card",
    "",
  ].join("\n"), "/workspace/gauge/specs/plain.spec", "plaintext");
  const { controller, vscode } = createFakeVscode({ textDocuments: [document] });
  const gaugeTests = new GaugeTestController({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/plain.spec");
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

  const spec = controller.items.get("/workspace/gauge/specs/plain.spec");
  assert.equal(spec.label, "Checkout");
  assert.deepEqual(spec.uri, { fsPath: "/workspace/gauge/specs/plain.spec" });
  assert.deepEqual(collectionItems(spec.children).map((item) => [item.id, item.label]), [
    ["/workspace/gauge/specs/plain.spec:3", "Successful checkout"],
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

  assert.deepEqual(collectionItems(controller.items), []);
});

test("GaugeTestController treats triple-hash headings as scenarios", () => {
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
  const scenarios = collectionItems(spec.children);
  assert.deepEqual(scenarios.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
  })), [
    {
      id: "/workspace/specs/example.spec:3",
      label: "Notes",
    },
  ]);
});

test("GaugeTestController ignores headings inside closed step docstrings", () => {
  const { GaugeTestController } = require("../src/testController");
  const document = createDocument([
    "# Execution",
    "* Execute content",
    "\"\"\"",
    "## Payload heading",
    "\"\"\"",
    "## Real scenario",
    "* Continue",
  ].join("\n"));
  const { controller, vscode } = createFakeVscode({ textDocuments: [document] });
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();

  const spec = controller.items.get("/workspace/specs/example.spec");
  assert.deepEqual(collectionItems(spec.children).map((scenario) => scenario.id), [
    "/workspace/specs/example.spec:6",
  ]);
});

test("GaugeTestController discovers legacy underline headings", () => {
  const { GaugeTestController } = require("../src/testController");
  const document = createDocument([
    "Legacy specification",
    "====================",
    "",
    "Legacy scenario",
    "---------------",
    "* Continue",
  ].join("\n"));
  const { controller, vscode } = createFakeVscode({ textDocuments: [document] });
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();

  const spec = controller.items.get("/workspace/specs/example.spec");
  assert.equal(spec.label, "Legacy specification");
  assert.deepEqual(collectionItems(spec.children).map((scenario) => [scenario.id, scenario.label]), [
    ["/workspace/specs/example.spec:4", "Legacy scenario"],
  ]);
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
  assert.deepEqual(collectionItems(spec.children).map((item) => ({
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

test("GaugeTestController accepts a single scenario response from Gauge LSP", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, vscode } = createFakeVscode();
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
              return Promise.resolve({
                heading: "Successful checkout",
                executionIdentifier: "/workspace/gauge/specs/checkout.spec:2",
                lineNo: 2,
              });
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
  assert.deepEqual(collectionItems(spec.children).map((item) => item.id), [
    "/workspace/gauge/specs/checkout.spec:2",
  ]);
});

test("GaugeTestController discovers and refreshes tests through Test Explorer handlers", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, vscode } = createFakeVscode();
  let specs = [
    {
      heading: "Checkout",
      executionIdentifier: "/workspace/gauge/specs/checkout.spec",
    },
  ];
  const clientsMap = new Map([
    [
      "/workspace/gauge",
      {
        client: {
          sendRequest(method) {
            if (method === "gauge/specs") {
              return Promise.resolve(specs);
            }
            if (method === "gauge/scenarios") {
              return Promise.resolve([
                {
                  heading: "Successful checkout",
                  executionIdentifier: `${specs[0].executionIdentifier}:12`,
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

  assert.equal(typeof controller.resolveHandler, "function");
  assert.equal(typeof controller.refreshHandler, "function");

  await controller.resolveHandler(undefined);

  const checkout = controller.items.get("/workspace/gauge/specs/checkout.spec");
  assert.equal(checkout.label, "Checkout");
  assert.deepEqual(collectionItems(checkout.children).map((item) => item.label), [
    "Successful checkout",
  ]);

  specs = [
    {
      heading: "Accounts",
      executionIdentifier: "/workspace/gauge/specs/accounts.spec",
    },
  ];
  await controller.refreshHandler();

  assert.equal(controller.items.get("/workspace/gauge/specs/checkout.spec"), undefined);
  assert.equal(controller.items.get("/workspace/gauge/specs/accounts.spec").label, "Accounts");
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
  assert.deepEqual(collectionItems(spec.children).map((item) => [item.id, item.label]), [
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
      "simple-console": false,
      testUi: true,
    }],
    ["gauge.execute", "/workspace/specs/example.spec:3", {
      "hide-suggestion": true,
      "simple-console": false,
      testUi: true,
    }],
  ]);
  assert.deepEqual(calls.filter((entry) => entry[0] === "started"), []);
});

test("GaugeTestController creates and opens native Test Output only after Gauge starts", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, commandCalls, vscode } = createFakeVscode();
  let finishExecution;
  const execution = new Promise((resolve) => {
    finishExecution = resolve;
  });
  const gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand() {
        return execution;
      },
    },
  });

  gaugeTests.register();
  const run = gaugeTests.run({});
  await Promise.resolve();

  assert.deepEqual(commandCalls, []);
  assert.deepEqual(calls.filter((entry) => entry[0] === "run"), []);

  gaugeTests.handleExecutionEvent({ type: "processStarted" });
  gaugeTests.handleExecutionEvent({ type: "processStarted" });

  assert.deepEqual(commandCalls, ["testing.showMostRecentOutput"]);
  assert.equal(calls.filter((entry) => entry[0] === "run").length, 1);

  finishExecution();
  await run;
  assert.deepEqual(calls.filter((entry) => entry[0] === "end"), [["end"]]);
});

test("GaugeTestController does not create an empty TestRun before Gauge starts", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, commandCalls, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand() {
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();
  await gaugeTests.run({});

  assert.deepEqual(calls.filter((entry) => entry[0] === "run"), []);
  assert.deepEqual(calls.filter((entry) => entry[0] === "end"), []);
  assert.deepEqual(commandCalls, []);
});

test("GaugeTestController creates TestRuns only for requests selected by the execution scheduler", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  const scheduled = [];
  let active;
  let pending;
  let gaugeTests;
  const start = (entry) => {
    active = entry;
    entry.metadata.onStart();
  };
  const executionController = {
    handleCommand() {
      return Promise.resolve(undefined);
    },
    handleCommandWithMetadata(command, metadata, ...args) {
      return new Promise((resolve) => {
        const entry = { args, command, metadata, resolve };
        scheduled.push(entry);
        if (!active) {
          start(entry);
          return;
        }
        active.metadata.onSuperseded();
        if (pending) {
          pending.metadata.onSuperseded();
          pending.resolve(undefined);
        }
        pending = entry;
      });
    },
  };
  gaugeTests = new GaugeTestController({ vscode, executionController });
  gaugeTests.register();
  const firstItem = controller.createTestItem(
    "/workspace/specs/first.spec:3",
    "First",
    { fsPath: "/workspace/specs/first.spec" },
  );
  const supersededItem = controller.createTestItem(
    "/workspace/specs/superseded.spec:3",
    "Superseded",
    { fsPath: "/workspace/specs/superseded.spec" },
  );
  const latestItem = controller.createTestItem(
    "/workspace/specs/latest.spec:3",
    "Latest",
    { fsPath: "/workspace/specs/latest.spec" },
  );
  const firstRequest = { include: [firstItem] };
  const supersededRequest = { include: [supersededItem] };
  const latestRequest = { include: [latestItem] };

  const firstRun = gaugeTests.run(firstRequest);
  await Promise.resolve();
  assert.equal(scheduled.length, 1);
  gaugeTests.handleExecutionEvent({ type: "processStarted" });

  const supersededRun = gaugeTests.run(supersededRequest);
  const latestRun = gaugeTests.run(latestRequest);
  await Promise.resolve();

  assert.equal(scheduled.length, 3);
  assert.equal(await supersededRun, undefined);

  active.resolve(false);
  active = undefined;
  await firstRun;
  await Promise.resolve();
  const next = pending;
  pending = undefined;
  start(next);
  gaugeTests.handleExecutionEvent({ type: "processStarted" });
  active.resolve(true);
  active = undefined;
  await latestRun;

  assert.deepEqual(calls.filter((entry) => entry[0] === "run"), [
    ["run", firstRequest],
    ["run", latestRequest],
  ]);
  assert.deepEqual(calls.filter((entry) => entry[0] === "end"), [
    ["end"],
    ["end"],
  ]);
});

test("GaugeTestController starts a targeted TestRun for CodeLens execution", async () => {
  const { GaugeTestController } = require("../src/testController");
  const document = createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
    "* Pay",
  ].join("\n"));
  const { calls, vscode } = createFakeVscode({ textDocuments: [document] });
  vscode.TestRunRequest = class TestRunRequest {
    constructor(include, exclude, profile, continuous, preserveFocus) {
      this.include = include;
      this.exclude = exclude;
      this.profile = profile;
      this.continuous = continuous;
      this.preserveFocus = preserveFocus;
    }
  };
  const executionCalls = [];
  let gaugeTests;
  gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        gaugeTests.handleExecutionEvent({ type: "processStarted" });
        return Promise.resolve(undefined);
      },
    },
  });
  gaugeTests.register();

  await gaugeTests.runCodeLensTarget("gauge.execute", "/workspace/specs/example.spec:3");

  const runCall = calls.find((entry) => entry[0] === "run");
  assert.equal(runCall[1].preserveFocus, false);
  assert.deepEqual(runCall[1].include.map((item) => item.id), [
    "/workspace/specs/example.spec:3",
  ]);
  assert.deepEqual(executionCalls, [
    ["gauge.execute", "/workspace/specs/example.spec:3", {
      "hide-suggestion": true,
      "simple-console": false,
      testUi: true,
    }],
  ]);
});

test("GaugeTestController maps parallel CodeLens execution into TestRun flags", async () => {
  const { GaugeTestController } = require("../src/testController");
  const document = createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
    "* Pay",
  ].join("\n"));
  const { vscode } = createFakeVscode({ textDocuments: [document] });
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

  await gaugeTests.runCodeLensTarget("gauge.execute.inParallel", "/workspace/specs/example.spec");

  assert.deepEqual(executionCalls, [
    ["gauge.execute", "/workspace/specs/example.spec", {
      "hide-suggestion": true,
      "simple-console": false,
      testUi: true,
      parallel: true,
    }],
  ]);
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
      "simple-console": false,
      testUi: true,
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
      "simple-console": false,
      testUi: true,
    }],
    ["gauge.execute.specification", undefined, [
      "/workspace/accounts/specs/accounts.spec",
    ], {
      "hide-suggestion": true,
      "simple-console": false,
      testUi: true,
    }],
  ]);
});

test("GaugeTestController uses projectFactory roots to split specification batches", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, vscode } = createFakeVscode();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        if (filename.startsWith("/workspace/checkout/")) {
          return "/workspace/checkout";
        }
        if (filename.startsWith("/workspace/accounts/")) {
          return "/workspace/accounts";
        }
        return undefined;
      },
    },
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
      "simple-console": false,
      testUi: true,
    }],
    ["gauge.execute.specification", undefined, [
      "/workspace/accounts/specs/accounts.spec",
    ], {
      "hide-suggestion": true,
      "simple-console": false,
      testUi: true,
    }],
  ]);
});

test("GaugeTestController skips included specification targets resolved to non-Gauge projects", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { controller, vscode } = createFakeVscode();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/specs/draft.spec");
        return "/workspace/notes";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/notes");
        return false;
      },
    },
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();
  const draft = controller.createTestItem(
    "/workspace/notes/specs/draft.spec",
    "Draft",
    { fsPath: "/workspace/notes/specs/draft.spec" },
  );

  await gaugeTests.run({ include: [draft] });

  assert.deepEqual(executionCalls, []);
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
      "simple-console": false,
      testUi: true,
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
      "simple-console": false,
      testUi: true,
    }],
    ["gauge.execute", "/workspace/specs/accounts.spec", {
      "hide-suggestion": true,
      "simple-console": false,
      testUi: true,
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
      "simple-console": false,
      testUi: true,
    }],
    ["gauge.execute", "/workspace/specs/example.spec:3", {
      debug: true,
      "hide-suggestion": true,
      "simple-console": false,
      testUi: true,
    }],
  ]);
});

test("GaugeTestController uses native Gauge output for all-spec Test UI runs", async () => {
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
      "simple-console": false,
      testUi: true,
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
      "simple-console": false,
      testUi: true,
    }],
    ["gauge.specexplorer.runAllActiveProjectSpecs", { projectRoot: "/workspace/accounts" }, {
      "hide-suggestion": true,
      "simple-console": false,
      testUi: true,
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
      "simple-console": false,
      testUi: true,
    }],
  ]);
});

test("GaugeTestController registers a repeat run profile for Test UI reruns", async () => {
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
  const repeatProfile = calls.find((entry) => entry[0] === "profile" && entry[1] === "Run Repeat");

  assert.ok(repeatProfile);
  assert.equal(repeatProfile[2], 1);
  assert.equal(repeatProfile[4], false);

  await repeatProfile[3]({});

  assert.deepEqual(executionCalls, [
    ["gauge.execute.repeat", undefined, {
      "hide-suggestion": true,
      "simple-console": false,
      testUi: true,
    }],
  ]);
});

test("GaugeTestController scopes failed Test UI reruns to included project roots", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  const executionCalls = [];
  const clientsMap = new Map([
    ["/workspace/checkout", { client: {} }],
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
  const failedProfile = calls.find((entry) => entry[0] === "profile" && entry[1] === "Run Failed");
  const spec = controller.createTestItem(
    "/workspace/checkout/specs/checkout.spec",
    "Checkout",
    { fsPath: "/workspace/checkout/specs/checkout.spec" },
  );

  await failedProfile[3]({ include: [spec] });

  assert.deepEqual(executionCalls, [
    ["gauge.execute.failed", { projectRoot: "/workspace/checkout" }, {
      "hide-suggestion": true,
      "simple-console": false,
      testUi: true,
    }],
  ]);
});

test("GaugeTestController scopes repeat Test UI reruns to included project roots", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  const executionCalls = [];
  const clientsMap = new Map([
    ["/workspace/checkout", { client: {} }],
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
  const repeatProfile = calls.find((entry) => entry[0] === "profile" && entry[1] === "Run Repeat");
  const spec = controller.createTestItem(
    "/workspace/checkout/specs/checkout.spec",
    "Checkout",
    { fsPath: "/workspace/checkout/specs/checkout.spec" },
  );

  await repeatProfile[3]({ include: [spec] });

  assert.deepEqual(executionCalls, [
    ["gauge.execute.repeat", { projectRoot: "/workspace/checkout" }, {
      "hide-suggestion": true,
      "simple-console": false,
      testUi: true,
    }],
  ]);
});

test("GaugeTestController skips project-scoped reruns resolved to non-Gauge projects", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/specs/draft.spec");
        return "/workspace/notes";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/notes");
        return false;
      },
    },
    vscode,
    executionController: {
      handleCommand(command, ...args) {
        executionCalls.push([command, ...args]);
        return Promise.resolve(undefined);
      },
    },
  });

  gaugeTests.register();
  const repeatProfile = calls.find((entry) => entry[0] === "profile" && entry[1] === "Run Repeat");
  const draft = controller.createTestItem(
    "/workspace/notes/specs/draft.spec",
    "Draft",
    { fsPath: "/workspace/notes/specs/draft.spec" },
  );

  await repeatProfile[3]({ include: [draft] });

  assert.deepEqual(executionCalls, []);
  assert.deepEqual(calls.filter((entry) => entry[0] === "run"), []);
  assert.deepEqual(calls.filter((entry) => entry[0] === "end"), []);
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
      "simple-console": false,
      testUi: true,
    }],
  ]);
});

test("GaugeTestController stops queuing Test UI project runs after cancellation", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { vscode } = createFakeVscode();
  const executionCalls = [];
  let finishRun;
  const runningCommand = new Promise((resolve) => {
    finishRun = resolve;
  });
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
        if (
          command === "gauge.specexplorer.runAllActiveProjectSpecs"
          && args[0]
          && args[0].projectRoot === "/workspace/checkout"
        ) {
          return runningCommand;
        }
        return Promise.resolve(undefined);
      },
    },
  });
  const cancellation = createCancellationToken();

  gaugeTests.register();

  const run = gaugeTests.run({}, cancellation.token);
  cancellation.cancel();
  finishRun();
  await run;

  assert.deepEqual(executionCalls, [
    ["gauge.specexplorer.runAllActiveProjectSpecs", { projectRoot: "/workspace/checkout" }, {
      "hide-suggestion": true,
      "simple-console": false,
      testUi: true,
    }],
    ["gauge.stopExecution"],
  ]);
  assert.equal(cancellation.disposed, true);
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
      "simple-console": false,
      testUi: true,
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
    ["skipped", "scenario-2"],
  ]);
});

test("GaugeTestController writes Test Results output with CRLF line endings", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();
  gaugeTests.startTestRun({});
  const sink = gaugeTests.createExecutionEventSink();
  sink({
    type: "output",
    message: "\x1b[35mfirst\x1b[0m\nsecond\r\nthird\rfour",
  });
  sink({ type: "lineBreak" });

  assert.deepEqual(calls.filter((entry) => entry[0] === "output"), [
    ["output", "\x1b[35mfirst\x1b[0m\r\nsecond\r\nthird\rfour"],
  ]);
});

test("GaugeTestController preserves Gauge output without synthetic formatting", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();
  gaugeTests.startTestRun({});
  const sink = gaugeTests.createExecutionEventSink();
  sink({ type: "suiteStarted", id: "spec", name: "Checkout" });
  sink({ type: "testStarted", id: "passing", parentId: "spec", name: "Successful checkout" });
  sink({
    type: "output",
    message: "\x1b[0;36m# Checkout\n\x1b[0m\x1b[0;33m  ## Successful checkout\t\x1b[0m",
  });
  sink({ type: "testFinished", id: "passing", parentId: "spec", name: "Successful checkout" });
  sink({ type: "testStarted", id: "failing", parentId: "spec", name: "Failed checkout" });
  sink({ type: "testFailed", id: "failing", parentId: "spec", message: "Expected success" });
  sink({ type: "testFinished", id: "failing", parentId: "spec", name: "Failed checkout" });
  sink({ type: "testStarted", id: "skipped", parentId: "spec", name: "Skipped checkout" });
  sink({ type: "testIgnored", id: "skipped", parentId: "spec", message: "Not applicable" });
  sink({ type: "testFinished", id: "skipped", parentId: "spec", name: "Skipped checkout" });

  assert.deepEqual(
    calls.filter((entry) => entry[0] === "output" && entry.length === 2),
    [["output", "\x1b[0;36m# Checkout\r\n\x1b[0m\x1b[0;33m  ## Successful checkout\t\x1b[0m"]],
  );
});

test("GaugeTestController keeps Test Explorer hierarchy separate from Test Results output", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();
  gaugeTests.startTestRun({});
  const sink = gaugeTests.createExecutionEventSink();
  sink({
    type: "suiteStarted",
    id: "/workspace/specs/example.spec",
    name: "Checkout",
    location: "gauge:///workspace/specs/example.spec:1",
  });
  sink({
    type: "testStarted",
    id: "/workspace/specs/example.spec:3",
    parentId: "/workspace/specs/example.spec",
    name: "Successful checkout",
    location: "gauge:///workspace/specs/example.spec:3",
  });
  sink({
    type: "testFinished",
    id: "/workspace/specs/example.spec:3",
    parentId: "/workspace/specs/example.spec",
    name: "Successful checkout",
    duration: 42,
  });

  const spec = controller.items.get("/workspace/specs/example.spec");
  const scenario = spec.children.get("/workspace/specs/example.spec:3");
  assert.equal(scenario.label, "Successful checkout");
  assert.deepEqual(calls.filter((entry) => entry[0] === "output"), []);
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

test("GaugeTestController bounds concurrent spec scenario requests", async () => {
  const {
    DEFAULT_SCENARIO_REQUEST_CONCURRENCY,
    GaugeTestController,
  } = require("../src/testController");
  const { vscode } = createFakeVscode();
  const scenarioRequests = [];
  let activeRequests = 0;
  let maximumRequests = 0;
  const clientsMap = new Map([
    [
      "/workspace/gauge",
      {
        client: {
          sendRequest(method, params) {
            if (method === "gauge/specs") {
              return Promise.resolve(Array.from(
                { length: DEFAULT_SCENARIO_REQUEST_CONCURRENCY + 2 },
                (_value, index) => ({
                  heading: `Spec ${index}`,
                  executionIdentifier: `/workspace/gauge/specs/spec-${index}.spec`,
                }),
              ));
            }
            if (method === "gauge/scenarios") {
              scenarioRequests.push(params.textDocument.uri);
              activeRequests += 1;
              maximumRequests = Math.max(maximumRequests, activeRequests);
              return new Promise((resolve) => {
                setImmediate(() => {
                  activeRequests -= 1;
                  resolve([]);
                });
              });
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

  assert.equal(scenarioRequests.length, DEFAULT_SCENARIO_REQUEST_CONCURRENCY + 2);
  assert.equal(maximumRequests, DEFAULT_SCENARIO_REQUEST_CONCURRENCY);
});

test("GaugeTestController attaches Gauge skip reasons to the skipped test item", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();
  gaugeTests.startTestRun({});
  const sink = gaugeTests.createExecutionEventSink();
  const skipReason = "/workspace/specs/example.spec:7 Step implementation not found"
    + " => 'the wiremock is initialized'";

  sink({ type: "testStarted", id: "scenario-1", parentId: "spec", name: "Checkout" });
  sink({
    type: "testIgnored",
    id: "scenario-1",
    parentId: "spec",
    location: "gauge:///workspace/specs/example.spec:7",
    message: skipReason,
  });
  sink({ type: "testFinished", id: "scenario-1", parentId: "spec", name: "Checkout" });

  assert.ok(controller);
  const outputs = calls.filter((entry) => entry[0] === "output" && entry.length === 4);
  assert.deepEqual(outputs.map((entry) => [entry[1], entry[3]]), [
    [`${skipReason}\r\n`, "scenario-1"],
  ]);
  assert.notEqual(outputs[0][2], undefined);
  assert.deepEqual(
    calls.filter((entry) => entry[0] === "skipped"),
    [["skipped", "scenario-1"]],
  );
});

test("GaugeTestController explains a skip Gauge reported without a reason", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });

  gaugeTests.register();
  gaugeTests.startTestRun({});
  const sink = gaugeTests.createExecutionEventSink();

  sink({ type: "testStarted", id: "scenario-1", parentId: "spec", name: "Checkout" });
  sink({ type: "testIgnored", id: "scenario-1", parentId: "spec", message: " " });
  sink({ type: "testFinished", id: "scenario-1", parentId: "spec", name: "Checkout" });

  const itemOutputs = calls.filter((entry) => entry[0] === "output" && entry.length === 4);
  assert.deepEqual(itemOutputs.map((entry) => [entry[1], entry[3]]), [
    ["Gauge skipped this scenario without reporting a reason.\r\n", "scenario-1"],
  ]);
  assert.deepEqual(
    calls.filter((entry) => entry[0] === "skipped"),
    [["skipped", "scenario-1"]],
  );
});

test("GaugeTestController terminates and de-duplicates skip reasons in the run output", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });
  const reason = "/workspace/specs/example.spec:7 Step implementation not found => 'the step'";

  gaugeTests.register();
  gaugeTests.startTestRun({});
  const sink = gaugeTests.createExecutionEventSink();

  // Gauge prints its own validation line first; the extension forwards it.
  sink({ type: "output", message: `[ValidationError] ${reason}\n` });
  sink({ type: "testStarted", id: "scenario-1", parentId: "spec", name: "Checkout" });
  sink({ type: "testIgnored", id: "scenario-1", parentId: "spec", message: reason });
  sink({ type: "testFinished", id: "scenario-1", parentId: "spec", name: "Checkout" });

  // A second scenario Gauge never explained still gets its own terminated line.
  sink({ type: "testStarted", id: "scenario-2", parentId: "spec", name: "Payment" });
  sink({ type: "testIgnored", id: "scenario-2", parentId: "spec", message: "" });
  sink({ type: "testFinished", id: "scenario-2", parentId: "spec", name: "Payment" });

  const itemOutputs = calls.filter((entry) => entry[0] === "output" && entry.length === 4);
  assert.deepEqual(itemOutputs.map((entry) => [entry[1], entry[3]]), [
    ["Gauge skipped this scenario without reporting a reason.\r\n", "scenario-2"],
  ]);
});
