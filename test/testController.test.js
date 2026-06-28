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

test("GaugeTestController runs included Gauge test items instead of all specs", async () => {
  const { GaugeTestController } = require("../src/testController");
  const { calls, controller, vscode } = createFakeVscode();
  const executionCalls = [];
  const gaugeTests = new GaugeTestController({
    vscode,
    executionController: {
      handleCommand(command, argument) {
        executionCalls.push([command, argument]);
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
    ["gauge.execute", "/workspace/specs/example.spec"],
    ["gauge.execute", "/workspace/specs/example.spec:3"],
  ]);
  assert.deepEqual(calls.filter((entry) => entry[0] === "end"), [["end"]]);
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

  assert.deepEqual(calls.slice(3), [
    ["started", "scenario-1"],
    ["failed", "scenario-1", "Expected success", 7],
    ["started", "scenario-2"],
    ["skipped", "scenario-2"],
  ]);
});
