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

function createDocument(text, filename = "/workspace/specs/example.spec") {
  const lines = text.split(/\r?\n/);
  return {
    fileName: filename,
    languageId: "gauge",
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
        skipped(item) {
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
        onDidCloseTextDocument() {
          return { dispose() {} };
        },
        onDidOpenTextDocument() {
          return { dispose() {} };
        },
        onDidSaveTextDocument() {
          return { dispose() {} };
        },
      },
    },
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
    ["run", { include: [] }],
    ["started", "/workspace/specs/example.spec"],
    ["started", "/workspace/specs/example.spec:12"],
    ["passed", "/workspace/specs/example.spec:12", 42],
    ["passed", "/workspace/specs/example.spec", 100],
    ["dispose"],
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
