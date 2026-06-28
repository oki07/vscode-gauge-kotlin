const assert = require("node:assert/strict");
const test = require("node:test");

function createCollection() {
  const entries = new Map();
  return {
    add(item) {
      entries.set(item.id, item);
    },
    get(id) {
      return entries.get(id);
    },
    values() {
      return [...entries.values()];
    },
  };
}

function createFakeVscode() {
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
