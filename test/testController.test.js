const assert = require("node:assert/strict");
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

async function drainMicrotasks() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

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
  const runCancellations = [];
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
      const cancellation = createCancellationToken();
      runCancellations.push(cancellation);
      return {
        token: cancellation.token,
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
    runCancellations,
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
  const listeners = new Set();
  let disposalCalls = 0;
  let registrationCalls = 0;
  return {
    token: {
      isCancellationRequested: false,
      onCancellationRequested(listener) {
        registrationCalls += 1;
        listeners.add(listener);
        let disposed = false;
        return {
          dispose() {
            if (disposed) {
              return;
            }
            disposed = true;
            disposalCalls += 1;
            listeners.delete(listener);
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
    get disposalCalls() {
      return disposalCalls;
    },
    get disposed() {
      return disposalCalls > 0;
    },
    get listenerCount() {
      return listeners.size;
    },
    get registrationCalls() {
      return registrationCalls;
    },
  };
}

// A run started outside the Test Explorer - from the Spec Explorer, or from the
// palette with "machine-readable" in the launch configuration - still streams
// Gauge's JSON events into the sink. ensureRun creates a TestRun for them, but
// with no run context nothing ever calls run.end, so the Test Results view kept
// spinning after Gauge exited and the cancellation listener leaked with it.
test("GaugeTestController ends a run it created outside the Test Explorer", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });

  const disposable = gaugeTests.register();
  const sink = gaugeTests.createExecutionEventSink();
  sink({
    type: "suiteStarted",
    id: "/workspace/specs/example.spec",
    name: "Checkout",
    location: "gauge:///workspace/specs/example.spec:1",
  });
  sink({ type: "suiteFinished" });

  const kinds = calls.map((entry) => entry[0]);
  assert.equal(kinds.filter((kind) => kind === "run").length, 1);
  assert.equal(kinds.includes("end"), true);
  assert.equal(gaugeTests.runTokenDisposables.size, 0);

  disposable.dispose();
});

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

  assert.deepEqual(collectionItems(controller.items).map((item) => item.id), [
    "/workspace/specs/example.spec",
  ]);
  assert.deepEqual(collectionItems(controller.items.get("/workspace/specs/example.spec").children).map((item) => item.id), [
    "/workspace/specs/example.spec:12",
  ]);
  disposable.dispose();
  assert.deepEqual(calls, [
    ["controller", "gauge", "Gauge"],
    ["profile", "Run", 1, calls[1][3], true],
    ["profile", "Debug", 2, calls[2][3], false],
    ["profile", "Run Failed", 1, calls[3][3], false],
    ["profile", "Run Repeat", 1, calls[4][3], false],
    ["run", { include: [] }],
    ["started", "/workspace/specs/example.spec:12"],
    ["passed", "/workspace/specs/example.spec:12", 42],
    ["end"],
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

// Proven at runtime by the second sweep: a README in a Gauge project became a
// runnable Test Explorer node with its "## Installation" heading as a scenario,
// and pressing Run started a Gauge process against it. Gauge reads Markdown as a
// specification only inside gauge_specs_dir (references/gauge/util/util.go
// GetSpecDirs).
test("GaugeTestController leaves a README in a Gauge project out of the tree", () => {
  const { GaugeTestController } = require("../src/testController");
  const document = createDocument([
    "# vscode-gauge-kotlin",
    "",
    "## Installation",
    "* Download the VSIX",
    "",
  ].join("\n"), "/workspace/gauge/README.md", "markdown");
  const { controller, vscode } = createFakeVscode({ textDocuments: [document] });
  const gaugeTests = new GaugeTestController({
    fileSystem: {
      readFileSync() {
        throw new Error("no project properties");
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath() {
        return "/workspace/gauge";
      },
      isGaugeProject() {
        return true;
      },
    },
    vscode,
  });

  gaugeTests.register();

  assert.equal(controller.items.get("/workspace/gauge/README.md"), undefined);
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

// references/gauge/parser/lex.go isScenarioHeading rejects a third '#', so
// "### Notes" is a comment. Verified against the real parser: a spec whose only
// "##"-looking line is "### Notes" has zero scenarios, and Gauge reports
// "Spec should have at least one scenario".
test("GaugeTestController treats triple-hash headings as comments", () => {
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
  assert.deepEqual(collectionItems(spec.children), []);
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

test("GaugeTestController settles in-flight specification discovery when disposed", async () => {
  const { GaugeTestController } = require("../src/testController");
  const requestEntered = deferred();
  const releaseRequest = deferred();
  const { calls, controller, vscode } = createFakeVscode();
  let cancelCalls = 0;
  let createdItems = 0;
  let sourceDisposals = 0;
  const originalCreateTestItem = controller.createTestItem.bind(controller);
  controller.createTestItem = (...args) => {
    createdItems += 1;
    return originalCreateTestItem(...args);
  };
  vscode.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
      this.token = { isCancellationRequested: false };
    }

    cancel() {
      cancelCalls += 1;
      this.token.isCancellationRequested = true;
    }

    dispose() {
      sourceDisposals += 1;
    }
  };
  let specsCalls = 0;
  const client = {
    async sendRequest(method) {
      if (method === "gauge/specs") {
        specsCalls += 1;
        if (specsCalls === 1) {
          return [
            {
              heading: "Existing checkout",
              executionIdentifier: "/workspace/gauge/specs/existing.spec",
            },
          ];
        }
        requestEntered.resolve();
        return releaseRequest.promise;
      }
      if (method === "gauge/scenarios") {
        return [
          {
            heading: "Existing scenario",
            executionIdentifier: "/workspace/gauge/specs/existing.spec:4",
            lineNo: 4,
          },
        ];
      }
      return [];
    },
  };
  const clientsMap = new Map([
    ["/workspace/gauge", { client }],
  ]);
  const gaugeTests = new GaugeTestController({ clientsMap, vscode });
  const registration = gaugeTests.register();

  await gaugeTests.discoverWorkspaceTests();
  assert.equal(gaugeTests.items.size, 2);
  assert.equal(controller.items.size, 1);
  assert.equal(gaugeTests.workspaceDiscoveredIdsByClient.size, 1);

  const pending = gaugeTests.discoverWorkspaceTests();
  await requestEntered.promise;
  registration.dispose();
  registration.dispose();

  releaseRequest.resolve([
    {
      heading: "Checkout",
      executionIdentifier: "/workspace/gauge/specs/checkout.spec",
    },
  ]);
  const pendingResult = await pending;
  const later = await gaugeTests.discoverWorkspaceTests();
  gaugeTests.discoverDocument(createDocument(
    "# Open specification\n## Scenario\n* step",
    "/workspace/gauge/specs/open.spec",
  ));
  gaugeTests.setClientsMap(new Map([["/replacement", { client }]]));

  assert.deepEqual({
    cancelCalls,
    clientsMapReleased: gaugeTests.clientsMap === undefined,
    controllerDisposals: calls.filter((entry) => entry[0] === "dispose").length,
    controllerItems: controller.items.size,
    controllerReleased: gaugeTests.controller === undefined,
    createdItems,
    externalClients: clientsMap.size,
    internalItems: gaugeTests.items.size,
    later,
    pendingResult,
    sourceDisposals,
    workspaceClients: gaugeTests.workspaceDiscoveredIdsByClient.size,
  }, {
    cancelCalls: 1,
    clientsMapReleased: true,
    controllerDisposals: 1,
    controllerItems: 0,
    controllerReleased: true,
    createdItems: 2,
    externalClients: 1,
    internalItems: 0,
    later: [],
    pendingResult: [],
    sourceDisposals: 2,
    workspaceClients: 0,
  });
});

test("GaugeTestController settles in-flight scenario discovery when disposed", async () => {
  const { GaugeTestController } = require("../src/testController");
  const scenarioEntered = deferred();
  const releaseScenario = deferred();
  const { controller, vscode } = createFakeVscode();
  let cancelCalls = 0;
  let createdItems = 0;
  let scenarioCalls = 0;
  let sourceDisposals = 0;
  const originalCreateTestItem = controller.createTestItem.bind(controller);
  controller.createTestItem = (...args) => {
    createdItems += 1;
    return originalCreateTestItem(...args);
  };
  vscode.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
      this.token = { isCancellationRequested: false };
    }

    cancel() {
      cancelCalls += 1;
      this.token.isCancellationRequested = true;
    }

    dispose() {
      sourceDisposals += 1;
    }
  };
  const client = {
    async sendRequest(method) {
      if (method === "gauge/specs") {
        return [
          {
            heading: "Checkout",
            executionIdentifier: "/workspace/gauge/specs/checkout.spec",
          },
          {
            heading: "Accounts",
            executionIdentifier: "/workspace/gauge/specs/accounts.spec",
          },
        ];
      }
      if (method === "gauge/scenarios") {
        scenarioCalls += 1;
        if (scenarioCalls === 1) {
          scenarioEntered.resolve();
          return releaseScenario.promise;
        }
        return [];
      }
      return [];
    },
  };
  const gaugeTests = new GaugeTestController({
    clientsMap: new Map([["/workspace/gauge", { client }]]),
    scenarioRequestConcurrency: 1,
    vscode,
  });
  const registration = gaugeTests.register();

  const pending = gaugeTests.discoverWorkspaceTests();
  await scenarioEntered.promise;
  registration.dispose();

  releaseScenario.resolve([
    {
      heading: "Successful checkout",
      executionIdentifier: "/workspace/gauge/specs/checkout.spec:12",
      lineNo: 12,
    },
  ]);
  const pendingResult = await pending;

  assert.deepEqual({
    cancelCalls,
    controllerItems: controller.items.size,
    createdItems,
    internalItems: gaugeTests.items.size,
    pendingResult,
    scenarioCalls,
    sourceDisposals,
  }, {
    cancelCalls: 1,
    controllerItems: 0,
    createdItems: 0,
    internalItems: 0,
    pendingResult: [],
    scenarioCalls: 1,
    sourceDisposals: 1,
  });
});

test("GaugeTestController keeps the latest overlapping workspace discovery", async () => {
  const { GaugeTestController } = require("../src/testController");
  const firstEntered = deferred();
  const firstResponse = deferred();
  const { controller, vscode } = createFakeVscode();
  const scenarioRequests = [];
  let specsCalls = 0;
  let secondClientSpecsCalls = 0;
  const firstClient = {
    async sendRequest(method, params) {
      if (method === "gauge/specs") {
        specsCalls += 1;
        if (specsCalls === 1) {
          firstEntered.resolve();
          return firstResponse.promise;
        }
        return [
          {
            heading: "Current checkout",
            executionIdentifier: "/workspace/first/specs/current.spec",
          },
        ];
      }
      if (method === "gauge/scenarios") {
        scenarioRequests.push(params.textDocument.uri);
        return [
          {
            heading: "Current scenario",
            executionIdentifier: `${params.textDocument.uri}:8`,
            lineNo: 8,
          },
        ];
      }
      return [];
    },
  };
  const secondClient = {
    async sendRequest(method) {
      if (method === "gauge/specs") {
        secondClientSpecsCalls += 1;
        return [
          {
            heading: "Current accounts",
            executionIdentifier: "/workspace/second/specs/current.spec",
          },
        ];
      }
      return [];
    },
  };
  const gaugeTests = new GaugeTestController({
    clientsMap: new Map([
      ["/workspace/first", { client: firstClient }],
      ["/workspace/second", { client: secondClient }],
    ]),
    vscode,
  });
  gaugeTests.register();

  const first = gaugeTests.discoverWorkspaceTests();
  await firstEntered.promise;
  const second = gaugeTests.discoverWorkspaceTests();
  const secondResult = await second;
  firstResponse.resolve([
    {
      heading: "Stale checkout",
      executionIdentifier: "/workspace/first/specs/stale.spec",
    },
  ]);
  const firstResult = await first;

  assert.deepEqual({
    firstResult: firstResult.map((item) => item.id),
    firstWorkspaceIds: [...gaugeTests.workspaceDiscoveredIdsByClient.get(firstClient)],
    scenarioRequests,
    secondClientSpecsCalls,
    secondResult: secondResult.map((item) => item.id),
    testItems: collectionItems(controller.items).map((item) => item.id),
  }, {
    firstResult: [],
    firstWorkspaceIds: [
      "/workspace/first/specs/current.spec",
      "/workspace/first/specs/current.spec:8",
    ],
    scenarioRequests: ["/workspace/first/specs/current.spec"],
    secondClientSpecsCalls: 1,
    secondResult: [
      "/workspace/first/specs/current.spec",
      "/workspace/first/specs/current.spec:8",
      "/workspace/second/specs/current.spec",
    ],
    testItems: [
      "/workspace/first/specs/current.spec",
      "/workspace/second/specs/current.spec",
    ],
  });
});

test("GaugeTestController ignores a scenario response superseded by workspace discovery", async () => {
  const { GaugeTestController } = require("../src/testController");
  const firstScenarioEntered = deferred();
  const firstScenarioResponse = deferred();
  const { controller, vscode } = createFakeVscode();
  let specsCalls = 0;
  const client = {
    async sendRequest(method, params) {
      if (method === "gauge/specs") {
        specsCalls += 1;
        return [
          specsCalls === 1
            ? {
              heading: "Stale checkout",
              executionIdentifier: "/workspace/gauge/specs/stale.spec",
            }
            : {
              heading: "Current checkout",
              executionIdentifier: "/workspace/gauge/specs/current.spec",
            },
        ];
      }
      if (method === "gauge/scenarios") {
        if (params.textDocument.uri.endsWith("/stale.spec")) {
          firstScenarioEntered.resolve();
          return firstScenarioResponse.promise;
        }
        return [
          {
            heading: "Current scenario",
            executionIdentifier: "/workspace/gauge/specs/current.spec:8",
            lineNo: 8,
          },
        ];
      }
      return [];
    },
  };
  const gaugeTests = new GaugeTestController({
    clientsMap: new Map([["/workspace/gauge", { client }]]),
    vscode,
  });
  gaugeTests.register();

  const first = gaugeTests.discoverWorkspaceTests();
  await firstScenarioEntered.promise;
  const secondResult = await gaugeTests.discoverWorkspaceTests();
  firstScenarioResponse.resolve([
    {
      heading: "Stale scenario",
      executionIdentifier: "/workspace/gauge/specs/stale.spec:12",
      lineNo: 12,
    },
  ]);
  const firstResult = await first;
  const currentSpec = controller.items.get("/workspace/gauge/specs/current.spec");

  assert.deepEqual({
    firstResult: firstResult.map((item) => item.id),
    scenarioItems: currentSpec
      ? collectionItems(currentSpec.children).map((item) => item.id)
      : [],
    secondResult: secondResult.map((item) => item.id),
    testItems: collectionItems(controller.items).map((item) => item.id),
    workspaceIds: [...gaugeTests.workspaceDiscoveredIdsByClient.get(client)],
  }, {
    firstResult: [],
    scenarioItems: ["/workspace/gauge/specs/current.spec:8"],
    secondResult: [
      "/workspace/gauge/specs/current.spec",
      "/workspace/gauge/specs/current.spec:8",
    ],
    testItems: ["/workspace/gauge/specs/current.spec"],
    workspaceIds: [
      "/workspace/gauge/specs/current.spec",
      "/workspace/gauge/specs/current.spec:8",
    ],
  });
});

test("GaugeTestController does not restore discovery for a removed client", async () => {
  const { GaugeTestController } = require("../src/testController");
  const removedRequestEntered = deferred();
  const removedResponse = deferred();
  const { controller, vscode } = createFakeVscode();
  const scenarioRequests = [];
  let oldSpecsCalls = 0;
  const oldClient = {
    async sendRequest(method, params) {
      if (method === "gauge/specs") {
        oldSpecsCalls += 1;
        if (oldSpecsCalls === 1) {
          return [
            {
              heading: "Existing checkout",
              executionIdentifier: "/workspace/old/specs/existing.spec",
            },
          ];
        }
        removedRequestEntered.resolve();
        return removedResponse.promise;
      }
      if (method === "gauge/scenarios") {
        scenarioRequests.push(params.textDocument.uri);
        return [
          {
            heading: "Existing scenario",
            executionIdentifier: `${params.textDocument.uri}:4`,
            lineNo: 4,
          },
        ];
      }
      return [];
    },
  };
  const clientsMap = new Map([["/workspace/old", { client: oldClient }]]);
  const gaugeTests = new GaugeTestController({ clientsMap, vscode });
  gaugeTests.register();

  await gaugeTests.discoverWorkspaceTests();
  const removedPending = gaugeTests.discoverClientTests(oldClient);
  await removedRequestEntered.promise;
  clientsMap.delete("/workspace/old");
  gaugeTests.pruneRemovedClientWorkspaceTests();
  assert.deepEqual({
    controllerItems: controller.items.size,
    internalItems: gaugeTests.items.size,
    workspaceClients: gaugeTests.workspaceDiscoveredIdsByClient.size,
  }, {
    controllerItems: 0,
    internalItems: 0,
    workspaceClients: 0,
  });

  removedResponse.resolve([
    {
      heading: "Removed checkout",
      executionIdentifier: "/workspace/old/specs/removed.spec",
    },
  ]);
  const removedResult = await removedPending;

  assert.deepEqual({
    removedClientTracked: gaugeTests.workspaceDiscoveredIdsByClient.has(oldClient),
    removedResult: removedResult.map((item) => item.id),
    scenarioRequests,
    testItems: collectionItems(controller.items).map((item) => item.id),
    workspaceClients: gaugeTests.workspaceDiscoveredIdsByClient.size,
  }, {
    removedClientTracked: false,
    removedResult: [],
    scenarioRequests: ["/workspace/old/specs/existing.spec"],
    testItems: [],
    workspaceClients: 0,
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
    ["gauge.execute.specification", undefined, [
      "/workspace/specs/example.spec",
      "/workspace/specs/example.spec:3",
    ], {
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

test("GaugeTestController closes active execution surfaces when disposed", async () => {
  const { GaugeTestController } = require("../src/testController");
  const executionEntered = deferred();
  const executionResponse = deferred();
  const executionError = new Error("late Test UI execution failed");
  const { calls, commandCalls, controller, vscode } = createFakeVscode();
  const cancellation = createCancellationToken();
  let executionCalls = 0;
  let executionControllerDisposals = 0;
  let executionControllerStops = 0;
  let retainedMetadata;
  const stopCommands = [];
  const executionController = {
    dispose() {
      executionControllerDisposals += 1;
    },
    handleCommand(command) {
      stopCommands.push(command);
      return Promise.resolve(undefined);
    },
    handleCommandWithMetadata(_command, metadata) {
      executionCalls += 1;
      retainedMetadata = metadata;
      metadata.onStart();
      if (executionCalls === 1) {
        executionEntered.resolve();
        return executionResponse.promise;
      }
      return Promise.resolve(undefined);
    },
    stop() {
      executionControllerStops += 1;
    },
  };
  const gaugeTests = new GaugeTestController({ executionController, vscode });
  const registration = gaugeTests.register();
  const runProfile = calls.find((entry) => entry[0] === "profile" && entry[1] === "Run");
  const scenario = controller.createTestItem(
    "/workspace/specs/example.spec:3",
    "Successful checkout",
    { fsPath: "/workspace/specs/example.spec" },
  );
  const sink = gaugeTests.createExecutionEventSink();

  const pendingRun = gaugeTests.run({ include: [scenario] }, cancellation.token);
  await executionEntered.promise;
  sink({
    type: "testStarted",
    id: scenario.id,
    name: scenario.label,
  });
  sink({
    type: "testFailed",
    id: scenario.id,
    message: "Expected success",
    name: scenario.label,
  });
  sink({ type: "output", message: "before disposal\n" });
  const retainedContext = [...gaugeTests.executionRunContexts][0];
  const publicOutcomes = [];
  pendingRun.then(
    (value) => publicOutcomes.push({ status: "fulfilled", value }),
    (reason) => publicOutcomes.push({ reason, status: "rejected" }),
  );

  registration.dispose();
  registration.dispose();
  await drainMicrotasks();
  const disposalCallIndex = calls.findIndex((entry) => entry[0] === "dispose");
  const endCallIndex = calls.findIndex((entry) => entry[0] === "end");
  const afterDispose = {
    activeContexts: gaugeTests.executionRunContexts
      ? gaugeTests.executionRunContexts.size
      : undefined,
    activeRunContext: gaugeTests.activeRunContext,
    activeAttempts: gaugeTests.activeAttemptIds.size,
    attemptCounts: gaugeTests.attemptCounts.size,
    cancellationDisposed: cancellation.disposed,
    currentRequest: gaugeTests.currentRequest,
    currentRun: gaugeTests.currentRun,
    endBeforeControllerDispose: endCallIndex !== -1 && endCallIndex < disposalCallIndex,
    endCalls: calls.filter((entry) => entry[0] === "end").length,
    executionControllerReleased: gaugeTests.executionController === undefined,
    forwardedOutput: gaugeTests.forwardedOutput,
    pendingResults: gaugeTests.pendingResults.size,
    publicOutcomes: [...publicOutcomes],
    resultOnlyItems: gaugeTests.resultOnlyItemIds.size,
    retainedContextRequest: retainedContext && retainedContext.request,
    retainedContextRun: retainedContext && retainedContext.run,
  };

  const callsBeforeLateEvents = calls.length;
  const commandsBeforeLateEvents = commandCalls.length;
  retainedMetadata.onStart();
  sink({ type: "processStarted" });
  sink({ type: "output", message: "after disposal\n" });
  sink({ type: "notification", message: "after disposal", severity: "info" });
  sink({
    type: "testFailed",
    id: scenario.id,
    message: "after disposal",
    name: scenario.label,
  });
  const retainedProfile = runProfile[3]({ include: [scenario] });
  const retainedCodeLens = gaugeTests.runCodeLensTarget(
    "gauge.execute",
    scenario.id,
  );
  const retainedOutcomes = await Promise.allSettled([retainedProfile, retainedCodeLens]);
  const afterRetainedCalls = {
    calls: calls.length,
    commands: commandCalls.length,
    executionCalls,
    pendingResults: gaugeTests.pendingResults.size,
  };

  executionResponse.reject(executionError);
  const [lateOutcome] = await Promise.allSettled([pendingRun]);

  assert.deepEqual(afterDispose, {
    activeContexts: 0,
    activeRunContext: undefined,
    activeAttempts: 0,
    attemptCounts: 0,
    cancellationDisposed: true,
    currentRequest: undefined,
    currentRun: undefined,
    endBeforeControllerDispose: true,
    endCalls: 1,
    executionControllerReleased: true,
    forwardedOutput: undefined,
    pendingResults: 0,
    publicOutcomes: [{ status: "fulfilled", value: undefined }],
    resultOnlyItems: 0,
    retainedContextRequest: undefined,
    retainedContextRun: undefined,
  });
  assert.deepEqual(afterRetainedCalls, {
    calls: callsBeforeLateEvents,
    commands: commandsBeforeLateEvents,
    executionCalls: 1,
    pendingResults: 0,
  });
  assert.deepEqual(retainedOutcomes, [
    { status: "fulfilled", value: undefined },
    { status: "fulfilled", value: undefined },
  ]);
  assert.deepEqual(lateOutcome, { status: "fulfilled", value: undefined });
  assert.equal(calls.filter((entry) => entry[0] === "end").length, 1);
  assert.equal(calls.filter((entry) => entry[0] === "dispose").length, 1);
  assert.equal(executionControllerDisposals, 0);
  assert.equal(executionControllerStops, 0);
  assert.deepEqual(stopCommands, []);
});

test("GaugeTestController suppresses late execution start and later project runs after disposal", async () => {
  const { GaugeTestController } = require("../src/testController");
  const executionEntered = deferred();
  const executionResponse = deferred();
  const { calls, commandCalls, vscode } = createFakeVscode();
  const executionCommands = [];
  let retainedMetadata;
  const gaugeTests = new GaugeTestController({
    clientsMap: new Map([
      ["/workspace/one", { client: {} }],
      ["/workspace/two", { client: {} }],
    ]),
    executionController: {
      handleCommandWithMetadata(command, metadata, ...args) {
        executionCommands.push([command, ...args]);
        retainedMetadata = metadata;
        if (executionCommands.length === 1) {
          executionEntered.resolve();
          return executionResponse.promise;
        }
        return Promise.resolve(undefined);
      },
    },
    vscode,
  });
  const registration = gaugeTests.register();
  const sink = gaugeTests.createExecutionEventSink();
  const pendingRun = gaugeTests.run({});
  const publicOutcomes = [];
  pendingRun.then(
    (value) => publicOutcomes.push({ status: "fulfilled", value }),
    (reason) => publicOutcomes.push({ reason, status: "rejected" }),
  );
  await executionEntered.promise;

  registration.dispose();
  await drainMicrotasks();
  const beforeLateStart = {
    activeContexts: gaugeTests.executionRunContexts.size,
    endCalls: calls.filter((entry) => entry[0] === "end").length,
    publicOutcomes: [...publicOutcomes],
    runCalls: calls.filter((entry) => entry[0] === "run").length,
  };

  retainedMetadata.onStart();
  sink({ type: "processStarted" });
  sink({ type: "output", message: "late output\n" });
  sink({ type: "notification", message: "late notification", severity: "warning" });
  executionResponse.resolve("late result");
  await pendingRun;
  await drainMicrotasks();

  const retainedProfiles = calls
    .filter((entry) => entry[0] === "profile")
    .map((entry) => entry[3]({}));
  const retainedCodeLens = gaugeTests.runCodeLensTarget(
    "gauge.execute",
    "/workspace/one/specs/example.spec:3",
  );
  const retainedOutcomes = await Promise.allSettled([
    ...retainedProfiles,
    retainedCodeLens,
  ]);

  assert.deepEqual(beforeLateStart, {
    activeContexts: 0,
    endCalls: 0,
    publicOutcomes: [{ status: "fulfilled", value: undefined }],
    runCalls: 0,
  });
  assert.deepEqual(executionCommands, [
    [
      "gauge.specexplorer.runAllActiveProjectSpecs",
      { projectRoot: "/workspace/one" },
      {
        "hide-suggestion": true,
        "simple-console": false,
        testUi: true,
      },
    ],
  ]);
  assert.deepEqual(commandCalls, []);
  assert.deepEqual(calls.filter((entry) => entry[0] === "run"), []);
  assert.deepEqual(calls.filter((entry) => entry[0] === "end"), []);
  assert.deepEqual(retainedOutcomes, Array.from(
    { length: 5 },
    () => ({ status: "fulfilled", value: undefined }),
  ));
});

test("GaugeTestController ends a TestRun returned during synchronous disposal", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });
  const registration = gaugeTests.register();
  const createTestRun = controller.createTestRun.bind(controller);
  controller.createTestRun = (request) => {
    const run = createTestRun(request);
    registration.dispose();
    return run;
  };

  const result = gaugeTests.startTestRun({});

  assert.equal(result, undefined);
  assert.equal(gaugeTests.currentRun, undefined);
  assert.equal(calls.filter((entry) => entry[0] === "run").length, 1);
  assert.equal(calls.filter((entry) => entry[0] === "end").length, 1);
  assert.equal(calls.filter((entry) => entry[0] === "dispose").length, 1);
});

test("GaugeTestController drops TestItems created during synchronous disposal", () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  const gaugeTests = new GaugeTestController({ vscode });
  const registration = gaugeTests.register();
  const createTestItem = controller.createTestItem.bind(controller);
  gaugeTests.startTestRun({});
  controller.createTestItem = (...args) => {
    const item = createTestItem(...args);
    registration.dispose();
    return item;
  };

  assert.doesNotThrow(() => gaugeTests.handleExecutionEvent({
    id: "/workspace/specs/example.spec:3",
    name: "Successful checkout",
    type: "testStarted",
  }));

  assert.equal(gaugeTests.items.size, 0);
  assert.equal(calls.filter((entry) => entry[0] === "started").length, 0);
  assert.equal(calls.filter((entry) => entry[0] === "end").length, 1);
  assert.equal(calls.filter((entry) => entry[0] === "dispose").length, 1);
});

test("GaugeTestController releases run cancellation synchronously and only once", async () => {
  const { GaugeTestController } = require("../src/testController");
  const executionEntered = deferred();
  const executionResponse = deferred();
  const { vscode } = createFakeVscode();
  const cancellation = createCancellationToken();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    executionController: {
      handleCommand(command) {
        executionCalls.push(command);
        if (command === "gauge.execute.specification.all") {
          executionEntered.resolve();
          return executionResponse.promise;
        }
        return Promise.resolve(undefined);
      },
    },
    vscode,
  });
  const registration = gaugeTests.register();
  const pendingRun = gaugeTests.run({}, cancellation.token);
  await executionEntered.promise;

  registration.dispose();
  const immediateCancellationState = {
    disposalCalls: cancellation.disposalCalls,
    listenerCount: cancellation.listenerCount,
    registrationCalls: cancellation.registrationCalls,
  };
  executionResponse.resolve(undefined);
  await pendingRun;

  let preCancelledRegistrations = 0;
  let preCancelledDisposals = 0;
  const preCancelledToken = {
    isCancellationRequested: true,
    onCancellationRequested(listener) {
      preCancelledRegistrations += 1;
      listener();
      return {
        dispose() {
          preCancelledDisposals += 1;
        },
      };
    },
  };
  const secondExecutionCalls = [];
  const secondController = new GaugeTestController({
    executionController: {
      handleCommand(command) {
        secondExecutionCalls.push(command);
        return Promise.resolve(undefined);
      },
    },
    vscode: createFakeVscode().vscode,
  });
  secondController.register();

  await secondController.run({}, preCancelledToken);

  assert.deepEqual(immediateCancellationState, {
    disposalCalls: 1,
    listenerCount: 0,
    registrationCalls: 1,
  });
  assert.deepEqual(executionCalls, ["gauge.execute.specification.all"]);
  assert.equal(cancellation.disposalCalls, 1);
  assert.equal(preCancelledRegistrations, 1);
  assert.equal(preCancelledDisposals, 1);
  assert.deepEqual(secondExecutionCalls, []);
  assert.equal(secondController.executionRunContexts.size, 0);
});

test("GaugeTestController defers prestart cancellation until the Test UI execution starts", async () => {
  const { GaugeTestController } = require("../src/testController");
  const executionEntered = deferred();
  const executionResponse = deferred();
  const cancellation = createCancellationToken();
  const { calls, vscode } = createFakeVscode();
  const stopCalls = [];
  let retainedMetadata;
  const gaugeTests = new GaugeTestController({
    executionController: {
      handleCommand(command) {
        stopCalls.push(command);
        return Promise.resolve(undefined);
      },
      handleCommandWithMetadata(_command, metadata) {
        retainedMetadata = metadata;
        executionEntered.resolve();
        return executionResponse.promise;
      },
    },
    vscode,
  });
  gaugeTests.register();

  const pendingRun = gaugeTests.run({}, cancellation.token);
  await executionEntered.promise;
  cancellation.cancel();
  const stopCallsBeforeStart = [...stopCalls];
  retainedMetadata.onStart();
  retainedMetadata.onStart();
  cancellation.cancel();
  const stopCallsAfterStart = [...stopCalls];
  executionResponse.resolve(undefined);
  await pendingRun;

  assert.deepEqual(stopCallsBeforeStart, []);
  assert.deepEqual(stopCallsAfterStart, ["gauge.stopExecution"]);
  assert.equal(cancellation.registrationCalls, 1);
  assert.equal(cancellation.disposalCalls, 1);
  assert.equal(cancellation.listenerCount, 0);
  assert.equal(gaugeTests.executionRunContexts.size, 0);
  assert.equal(calls.filter((entry) => entry[0] === "run").length, 0);
  assert.equal(calls.filter((entry) => entry[0] === "end").length, 0);
});

test("GaugeTestController detaches cancelled prestart commands from borrowed work", async () => {
  const { GaugeTestController } = require("../src/testController");
  const executionEntered = deferred();
  const executionResponse = deferred();
  const cancellation = createCancellationToken();
  const lateError = new Error("late prestart execution failure");
  const outcomes = [];
  const stopCalls = [];
  let retainedMetadata;
  const gaugeTests = new GaugeTestController({
    executionController: {
      handleCommand(command) {
        stopCalls.push(command);
        return Promise.resolve(undefined);
      },
      handleCommandWithMetadata(_command, metadata) {
        retainedMetadata = metadata;
        executionEntered.resolve();
        return executionResponse.promise;
      },
    },
    vscode: createFakeVscode().vscode,
  });
  gaugeTests.register();

  const pendingRun = gaugeTests.run({}, cancellation.token);
  pendingRun.then(
    (value) => outcomes.push({ status: "fulfilled", value }),
    (reason) => outcomes.push({ reason, status: "rejected" }),
  );
  await executionEntered.promise;
  cancellation.cancel();
  await drainMicrotasks();
  const stateBeforeLateWork = {
    activeContexts: gaugeTests.executionRunContexts.size,
    cancellationDisposals: cancellation.disposalCalls,
    cancellationListeners: cancellation.listenerCount,
    metadataCancelled: retainedMetadata.isCancellationRequested(),
    outcomes: [...outcomes],
    stopCalls: [...stopCalls],
  };

  retainedMetadata.onStart();
  executionResponse.reject(lateError);
  await drainMicrotasks();

  assert.deepEqual(stateBeforeLateWork, {
    activeContexts: 0,
    cancellationDisposals: 1,
    cancellationListeners: 0,
    metadataCancelled: true,
    outcomes: [{ status: "fulfilled", value: undefined }],
    stopCalls: [],
  });
  assert.deepEqual(outcomes, [{ status: "fulfilled", value: undefined }]);
  assert.deepEqual(stopCalls, []);
});

test("GaugeTestController scopes prestart cancellation to the current project command", async () => {
  const { GaugeTestController } = require("../src/testController");
  const secondCommandEntered = deferred();
  const secondCommandResponse = deferred();
  const cancellation = createCancellationToken();
  const stopCalls = [];
  let commandCalls = 0;
  let secondMetadata;
  const gaugeTests = new GaugeTestController({
    clientsMap: new Map([
      ["/workspace/one", { client: {} }],
      ["/workspace/two", { client: {} }],
    ]),
    executionController: {
      handleCommand(command) {
        stopCalls.push(command);
        return Promise.resolve(undefined);
      },
      handleCommandWithMetadata(_command, metadata) {
        commandCalls += 1;
        if (commandCalls === 1) {
          metadata.onStart();
          return Promise.resolve(undefined);
        }
        secondMetadata = metadata;
        secondCommandEntered.resolve();
        return secondCommandResponse.promise;
      },
    },
    vscode: createFakeVscode().vscode,
  });
  gaugeTests.register();

  const pendingRun = gaugeTests.run({}, cancellation.token);
  await secondCommandEntered.promise;
  cancellation.cancel();
  const stopCallsBeforeSecondStart = [...stopCalls];
  secondMetadata.onStart();
  const stopCallsAfterSecondStart = [...stopCalls];
  secondCommandResponse.resolve(undefined);
  await pendingRun;

  assert.deepEqual(stopCallsBeforeSecondStart, []);
  assert.deepEqual(stopCallsAfterSecondStart, ["gauge.stopExecution"]);
  assert.equal(commandCalls, 2);
  assert.equal(cancellation.disposalCalls, 1);
  assert.equal(gaugeTests.executionRunContexts.size, 0);
});

test("GaugeTestController releases execution ownership after scheduler cancellation", async () => {
  const { GaugeTestController } = require("../src/testController");
  for (const callback of ["onCancelled", "onSuperseded"]) {
    const executionEntered = deferred();
    const executionResponse = deferred();
    const cancellation = createCancellationToken();
    const stopCalls = [];
    let retainedMetadata;
    const gaugeTests = new GaugeTestController({
      executionController: {
        handleCommand(command) {
          stopCalls.push(command);
          return Promise.resolve(undefined);
        },
        handleCommandWithMetadata(_command, metadata) {
          retainedMetadata = metadata;
          executionEntered.resolve();
          return executionResponse.promise;
        },
      },
      vscode: createFakeVscode().vscode,
    });
    gaugeTests.register();

    const pendingRun = gaugeTests.run({}, cancellation.token);
    await executionEntered.promise;
    retainedMetadata.onStart();
    retainedMetadata[callback]();
    cancellation.cancel();
    executionResponse.resolve(undefined);
    await pendingRun;

    assert.deepEqual(stopCalls, []);
    assert.equal(cancellation.disposalCalls, 1);
    assert.equal(cancellation.listenerCount, 0);
    assert.equal(gaugeTests.executionRunContexts.size, 0);
  }
});

test("GaugeTestController waits for active execution cancellation to settle", async () => {
  const { GaugeTestController } = require("../src/testController");
  const executionEntered = deferred();
  const executionResponse = deferred();
  const cancellation = createCancellationToken();
  const outcomes = [];
  const stopCalls = [];
  const { calls, vscode } = createFakeVscode();
  let gaugeTests;
  let retainedMetadata;
  gaugeTests = new GaugeTestController({
    executionController: {
      handleCommand(command) {
        stopCalls.push(command);
        retainedMetadata.onCancelled();
        return Promise.resolve(undefined);
      },
      handleCommandWithMetadata(_command, metadata) {
        retainedMetadata = metadata;
        metadata.onStart();
        gaugeTests.handleExecutionEvent({ type: "processStarted" });
        executionEntered.resolve();
        return executionResponse.promise;
      },
    },
    vscode,
  });
  gaugeTests.register();

  const pendingRun = gaugeTests.run({}, cancellation.token);
  pendingRun.then(
    (value) => outcomes.push({ status: "fulfilled", value }),
    (reason) => outcomes.push({ reason, status: "rejected" }),
  );
  await executionEntered.promise;
  cancellation.cancel();
  await drainMicrotasks();
  const stateBeforeExecutionSettles = {
    activeContexts: gaugeTests.executionRunContexts.size,
    cancellationDisposals: cancellation.disposalCalls,
    cancellationListeners: cancellation.listenerCount,
    endCalls: calls.filter((entry) => entry[0] === "end").length,
    outcomes: [...outcomes],
  };

  executionResponse.resolve(undefined);
  await pendingRun;

  assert.deepEqual(stateBeforeExecutionSettles, {
    activeContexts: 1,
    cancellationDisposals: 0,
    cancellationListeners: 1,
    endCalls: 0,
    outcomes: [],
  });
  assert.deepEqual(outcomes, [{ status: "fulfilled", value: undefined }]);
  assert.deepEqual(stopCalls, ["gauge.stopExecution"]);
  assert.equal(cancellation.disposalCalls, 1);
  assert.equal(cancellation.listenerCount, 0);
  assert.equal(gaugeTests.executionRunContexts.size, 0);
  assert.equal(calls.filter((entry) => entry[0] === "run").length, 1);
  assert.equal(calls.filter((entry) => entry[0] === "end").length, 1);
});

test("GaugeTestController normalizes active execution cancellation failures", async () => {
  const { GaugeTestController } = require("../src/testController");
  const executionEntered = deferred();
  const executionResponse = deferred();
  const cancellation = createCancellationToken();
  const executionError = new Error("cancelled execution failed");
  const outcomes = [];
  const { calls, vscode } = createFakeVscode();
  let gaugeTests;
  let retainedMetadata;
  gaugeTests = new GaugeTestController({
    executionController: {
      handleCommand() {
        retainedMetadata.onCancelled();
        return Promise.resolve(undefined);
      },
      handleCommandWithMetadata(_command, metadata) {
        retainedMetadata = metadata;
        metadata.onStart();
        gaugeTests.handleExecutionEvent({ type: "processStarted" });
        executionEntered.resolve();
        return executionResponse.promise;
      },
    },
    vscode,
  });
  gaugeTests.register();

  const pendingRun = gaugeTests.run({}, cancellation.token);
  pendingRun.then(
    (value) => outcomes.push({ status: "fulfilled", value }),
    (reason) => outcomes.push({ reason, status: "rejected" }),
  );
  await executionEntered.promise;
  cancellation.cancel();
  await drainMicrotasks();
  const endCallsBeforeExecutionSettles = calls.filter((entry) => entry[0] === "end").length;
  executionResponse.reject(executionError);
  await pendingRun;

  assert.equal(endCallsBeforeExecutionSettles, 0);
  assert.deepEqual(outcomes, [{ status: "fulfilled", value: undefined }]);
  assert.equal(cancellation.disposalCalls, 1);
  assert.equal(cancellation.listenerCount, 0);
  assert.equal(gaugeTests.executionRunContexts.size, 0);
  assert.equal(calls.filter((entry) => entry[0] === "run").length, 1);
  assert.equal(calls.filter((entry) => entry[0] === "end").length, 1);
});

test("GaugeTestController preserves live execution failures and releases run ownership", async () => {
  const { GaugeTestController } = require("../src/testController");
  const executionError = new Error("Test UI execution failed");
  const { calls, vscode } = createFakeVscode();
  const cancellation = createCancellationToken();
  let gaugeTests;
  gaugeTests = new GaugeTestController({
    executionController: {
      handleCommandWithMetadata(_command, metadata) {
        metadata.onStart();
        gaugeTests.handleExecutionEvent({ type: "processStarted" });
        return Promise.reject(executionError);
      },
    },
    vscode,
  });
  gaugeTests.register();

  await assert.rejects(
    gaugeTests.run({}, cancellation.token),
    (error) => error === executionError,
  );

  assert.equal(cancellation.disposed, true);
  assert.equal(gaugeTests.executionRunContexts.size, 0);
  assert.equal(gaugeTests.activeRunContext, undefined);
  assert.equal(gaugeTests.currentRequest, undefined);
  assert.equal(gaugeTests.currentRun, undefined);
  assert.equal(calls.filter((entry) => entry[0] === "run").length, 1);
  assert.equal(calls.filter((entry) => entry[0] === "end").length, 1);
});

test("GaugeTestController normalizes synchronous execution failures only after disposal", async () => {
  const { GaugeTestController } = require("../src/testController");
  for (const scenario of ["live throw", "disposed throw", "disposed rejection"]) {
    const executionError = new Error(scenario);
    const { calls, vscode } = createFakeVscode();
    const cancellation = createCancellationToken();
    let gaugeTests;
    let registration;
    gaugeTests = new GaugeTestController({
      executionController: {
        handleCommandWithMetadata(_command, metadata) {
          if (scenario === "live throw") {
            metadata.onStart();
            gaugeTests.handleExecutionEvent({ type: "processStarted" });
          } else {
            registration.dispose();
          }
          if (scenario === "disposed rejection") {
            return Promise.reject(executionError);
          }
          throw executionError;
        },
      },
      vscode,
    });
    registration = gaugeTests.register();

    const [outcome] = await Promise.allSettled([
      gaugeTests.run({}, cancellation.token),
    ]);

    if (scenario === "live throw") {
      assert.deepEqual(outcome, { reason: executionError, status: "rejected" });
      assert.equal(calls.filter((entry) => entry[0] === "run").length, 1);
      assert.equal(calls.filter((entry) => entry[0] === "end").length, 1);
    } else {
      assert.deepEqual(outcome, { status: "fulfilled", value: undefined });
      assert.equal(calls.filter((entry) => entry[0] === "run").length, 0);
      assert.equal(calls.filter((entry) => entry[0] === "end").length, 0);
    }
    assert.equal(cancellation.registrationCalls, 1);
    assert.equal(cancellation.disposalCalls, 1);
    assert.equal(cancellation.listenerCount, 0);
    assert.equal(gaugeTests.executionRunContexts.size, 0);
    assert.equal(gaugeTests.activeRunContext, undefined);
    assert.equal(gaugeTests.currentRun, undefined);
  }
});

test("GaugeTestController finalizes run contexts before cancellation cleanup", async () => {
  const { GaugeTestController } = require("../src/testController");
  {
    const { calls, vscode } = createFakeVscode();
    let retainedMetadata;
    let cancellationDisposals = 0;
    const gaugeTests = new GaugeTestController({
      executionController: {
        handleCommandWithMetadata(_command, metadata) {
          retainedMetadata = metadata;
          return Promise.resolve(undefined);
        },
      },
      vscode,
    });
    gaugeTests.register();
    const token = {
      isCancellationRequested: false,
      onCancellationRequested() {
        return {
          dispose() {
            cancellationDisposals += 1;
            retainedMetadata.onStart();
          },
        };
      },
    };

    await gaugeTests.run({}, token);

    assert.equal(cancellationDisposals, 1);
    assert.equal(gaugeTests.executionRunContexts.size, 0);
    assert.equal(gaugeTests.activeRunContext, undefined);
    assert.equal(gaugeTests.currentRun, undefined);
    assert.equal(calls.filter((entry) => entry[0] === "run").length, 0);
    assert.equal(calls.filter((entry) => entry[0] === "end").length, 0);
  }

  {
    const executionError = new Error("live execution failed");
    const cleanupError = new Error("cancellation cleanup failed");
    const { calls, vscode } = createFakeVscode();
    let cancellationDisposals = 0;
    let gaugeTests;
    gaugeTests = new GaugeTestController({
      executionController: {
        handleCommandWithMetadata(_command, metadata) {
          metadata.onStart();
          gaugeTests.handleExecutionEvent({ type: "processStarted" });
          return Promise.reject(executionError);
        },
      },
      vscode,
    });
    gaugeTests.register();
    const token = {
      isCancellationRequested: false,
      onCancellationRequested() {
        return {
          dispose() {
            cancellationDisposals += 1;
            throw cleanupError;
          },
        };
      },
    };

    await assert.rejects(gaugeTests.run({}, token), (error) => error === executionError);

    assert.equal(cancellationDisposals, 1);
    assert.equal(gaugeTests.executionRunContexts.size, 0);
    assert.equal(gaugeTests.activeRunContext, undefined);
    assert.equal(gaugeTests.currentRun, undefined);
    assert.equal(calls.filter((entry) => entry[0] === "run").length, 1);
    assert.equal(calls.filter((entry) => entry[0] === "end").length, 1);
  }

  {
    const executionEntered = deferred();
    const executionResponse = deferred();
    const cleanupError = new Error("terminal cancellation cleanup failed");
    const { calls, vscode } = createFakeVscode();
    let cancellationDisposals = 0;
    let gaugeTests;
    gaugeTests = new GaugeTestController({
      executionController: {
        handleCommandWithMetadata(_command, metadata) {
          metadata.onStart();
          gaugeTests.handleExecutionEvent({ type: "processStarted" });
          executionEntered.resolve();
          return executionResponse.promise;
        },
      },
      vscode,
    });
    const registration = gaugeTests.register();
    const token = {
      isCancellationRequested: false,
      onCancellationRequested() {
        return {
          dispose() {
            cancellationDisposals += 1;
            throw cleanupError;
          },
        };
      },
    };
    const pendingRun = gaugeTests.run({}, token);
    await executionEntered.promise;

    assert.doesNotThrow(() => registration.dispose());
    const [outcome] = await Promise.allSettled([pendingRun]);
    executionResponse.reject(new Error("late execution failure"));
    await drainMicrotasks();

    assert.deepEqual(outcome, { status: "fulfilled", value: undefined });
    assert.equal(cancellationDisposals, 1);
    assert.equal(gaugeTests.executionRunContexts.size, 0);
    assert.equal(gaugeTests.activeRunContext, undefined);
    assert.equal(gaugeTests.currentRun, undefined);
    assert.equal(calls.filter((entry) => entry[0] === "run").length, 1);
    assert.equal(calls.filter((entry) => entry[0] === "end").length, 1);
    assert.equal(calls.filter((entry) => entry[0] === "dispose").length, 1);
  }
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

  // One Gauge process for the whole selection. Gauge accepts scenario
  // identifiers alongside specification paths on a single command line, and one
  // process per target would run Before Suite and After Suite, the JVM and the
  // build once per target instead of once per run.
  assert.deepEqual(executionCalls, [
    ["gauge.execute.specification", undefined, [
      "/workspace/specs/checkout.spec:3",
      "/workspace/specs/accounts.spec",
    ], {
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
    ["gauge.execute.specification", undefined, [
      "/workspace/specs/example.spec",
      "/workspace/specs/example.spec:3",
    ], {
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

test("GaugeTestController stops execution when the Test Results run is cancelled", async () => {
  const { GaugeTestController } = require("../src/testController");
  const executionEntered = deferred();
  const executionResponse = deferred();
  const { calls, controller, runCancellations, vscode } = createFakeVscode();
  const stopCommands = [];
  const executionController = {
    handleCommand(command) {
      stopCommands.push(command);
      return Promise.resolve(undefined);
    },
    handleCommandWithMetadata(_command, metadata) {
      metadata.onStart();
      executionEntered.resolve();
      return executionResponse.promise;
    },
  };
  const gaugeTests = new GaugeTestController({ executionController, vscode });
  gaugeTests.register();
  const scenario = controller.createTestItem(
    "/workspace/specs/example.spec:3",
    "Successful checkout",
    { fsPath: "/workspace/specs/example.spec" },
  );
  const sink = gaugeTests.createExecutionEventSink();

  // A CodeLens run carries no run-handler token, so the Test Results stop
  // button can only reach the extension through TestRun.token.
  const pendingRun = gaugeTests.runCodeLensTarget("gauge.execute", scenario.id);
  await executionEntered.promise;
  sink({ type: "testStarted", id: scenario.id, name: scenario.label });

  assert.equal(calls.filter((entry) => entry[0] === "run").length, 1);
  assert.equal(runCancellations.length, 1);

  runCancellations[0].cancel();
  await drainMicrotasks();

  assert.deepEqual(stopCommands, ["gauge.stopExecution"]);

  executionResponse.resolve(undefined);
  await pendingRun;

  assert.equal(runCancellations[0].listenerCount, 0);
  assert.equal(runCancellations[0].disposalCalls, 1);
});
