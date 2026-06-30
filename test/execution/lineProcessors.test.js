const assert = require("node:assert/strict");
const test = require("node:test");

test("ReportEventProcessor stores a generated html report path", () => {
  const { ReportEventProcessor } = require("../../src/execution/lineProcessors");
  const calls = [];
  const processor = new ReportEventProcessor({
    setReportPath(reportPath) {
      calls.push(reportPath);
    },
  });

  const line = "Successfully generated html-report to => /workspace/reports/html-report/index.html";

  assert.equal(processor.canProcess(line), true);
  processor.process(line);
  assert.deepEqual(calls, ["/workspace/reports/html-report/index.html"]);
});

test("ReportEventProcessor stores html report paths from machine-readable output", () => {
  const { ReportEventProcessor } = require("../../src/execution/lineProcessors");
  const calls = [];
  const processor = new ReportEventProcessor({
    setReportPath(reportPath) {
      calls.push(reportPath);
    },
  });

  const line = JSON.stringify({
    type: "out",
    message: "Successfully generated html-report to => /workspace/reports/html-report/index.html",
  });

  assert.equal(processor.canProcess(line), true);
  processor.process(line);
  assert.deepEqual(calls, ["/workspace/reports/html-report/index.html"]);
});

test("ReportEventProcessor ignores unrelated output", () => {
  const { ReportEventProcessor } = require("../../src/execution/lineProcessors");
  const calls = [];
  const processor = new ReportEventProcessor({
    setReportPath(reportPath) {
      calls.push(reportPath);
    },
  });

  processor.process("some other stdout event");

  assert.deepEqual(calls, []);
});

test("DebuggerAttachedEventProcessor sets process id and starts debugger", async () => {
  const { DebuggerAttachedEventProcessor } = require("../../src/execution/lineProcessors");
  const calls = [];
  const processor = new DebuggerAttachedEventProcessor({
    cancel(aborted) {
      calls.push(["cancel", aborted]);
    },
  });
  const gaugeDebugger = {
    addProcessId(pid) {
      calls.push(["pid", pid]);
    },
    startDebugger() {
      calls.push(["start"]);
      return Promise.resolve(true);
    },
  };

  const line = "Runner Ready for Debugging at Process ID 23456";

  assert.equal(processor.canProcess(line), true);
  await processor.process(line, gaugeDebugger);

  assert.deepEqual(calls, [["pid", 23456], ["start"]]);
});

test("DebuggerAttachedEventProcessor starts debugger even without process id", async () => {
  const { DebuggerAttachedEventProcessor } = require("../../src/execution/lineProcessors");
  const calls = [];
  const processor = new DebuggerAttachedEventProcessor({
    cancel(aborted) {
      calls.push(["cancel", aborted]);
    },
  });
  const gaugeDebugger = {
    addProcessId(pid) {
      calls.push(["pid", pid]);
    },
    startDebugger() {
      calls.push(["start"]);
      return Promise.resolve(true);
    },
  };

  await processor.process("Runner Ready for Debugging", gaugeDebugger);

  assert.deepEqual(calls, [["pid", 0], ["start"]]);
});

test("DebuggerNotAttachedEventProcessor reports and cancels execution", () => {
  const { DebuggerNotAttachedEventProcessor } = require("../../src/execution/lineProcessors");
  const calls = [];
  const processor = new DebuggerNotAttachedEventProcessor({
    cancel(aborted) {
      calls.push(["cancel", aborted]);
    },
  }, {
    window: {
      showErrorMessage(message) {
        calls.push(["error", message]);
      },
    },
  });

  processor.process("No debugger attached");

  assert.deepEqual(calls, [
    ["error", "No debugger attached. Stopping the execution"],
    ["cancel", false],
  ]);
});

test("MachineReadableEventProcessor maps Gauge spec and scenario JSON events", () => {
  const { MachineReadableEventProcessor } = require("../../src/execution/lineProcessors");
  const events = [];
  const processor = new MachineReadableEventProcessor((event) => events.push(event));

  processor.process(JSON.stringify({
    type: "specStart",
    id: "/workspace/specs/example.spec",
    name: "Checkout",
    filename: "/workspace/specs/example.spec",
    line: 1,
  }));
  processor.process(JSON.stringify({
    type: "scenarioStart",
    id: "/workspace/specs/example.spec:12",
    parentId: "/workspace/specs/example.spec",
    name: "Successful checkout",
    filename: "/workspace/specs/example.spec",
    line: 12,
    result: {
      table: {
        rowIndex: 1,
        text: "\n| user |\n| alice |",
      },
    },
  }));
  processor.process(JSON.stringify({
    type: "scenarioEnd",
    id: "/workspace/specs/example.spec:12",
    parentId: "/workspace/specs/example.spec",
    name: "Successful checkout",
    filename: "/workspace/specs/example.spec",
    line: 12,
    result: {
      status: "fail",
      time: 45,
      table: {
        rowIndex: 1,
        text: "\n| user |\n| alice |",
      },
      errors: [
        {
          text: "Expected payment to succeed",
          filename: "/workspace/specs/example.spec",
          lineNo: "13",
          message: "payment failed",
          stackTrace: "stack line",
        },
      ],
    },
  }));
  processor.process(JSON.stringify({
    type: "specEnd",
    id: "/workspace/specs/example.spec",
    name: "Checkout",
    filename: "/workspace/specs/example.spec",
    line: 1,
    result: {
      status: "fail",
      time: 100,
    },
  }));

  assert.deepEqual(events, [
    {
      type: "suiteStarted",
      id: "/workspace/specs/example.spec",
      parentId: "suite",
      name: "Checkout",
      location: "gauge:///workspace/specs/example.spec:1",
    },
    {
      type: "testStarted",
      id: "/workspace/specs/example.spec:12_2",
      parentId: "/workspace/specs/example.spec",
      name: "Successful checkout_2",
      location: "gauge:///workspace/specs/example.spec:12",
    },
    {
      type: "testFailed",
      id: "/workspace/specs/example.spec:12_2",
      parentId: "/workspace/specs/example.spec",
      name: "Successful checkout_2",
      message: "| user |\n| alice |\nFailed: Expected payment to succeed\nFilename: /workspace/specs/example.spec:13\nMessage: payment failed\nStack Trace:\nstack line",
    },
    {
      type: "testFinished",
      id: "/workspace/specs/example.spec:12_2",
      parentId: "/workspace/specs/example.spec",
      name: "Successful checkout_2",
      duration: 45,
    },
    {
      type: "suiteFinished",
      id: "/workspace/specs/example.spec",
      parentId: "suite",
      name: "Checkout",
      duration: 100,
    },
  ]);
});

test("MachineReadableEventProcessor maps suite and spec hook failures to synthetic tests", () => {
  const { MachineReadableEventProcessor } = require("../../src/execution/lineProcessors");
  const events = [];
  const processor = new MachineReadableEventProcessor((event) => events.push(event));

  processor.process(JSON.stringify({
    type: "suiteEnd",
    result: {
      beforeHookFailure: {
        text: "Suite setup failed",
        filename: "/workspace/env/default/hooks.kt",
        lineNo: "9",
        message: "database unavailable",
        stackTrace: "suite stack",
      },
      afterHookFailure: {
        text: "Suite teardown failed",
        filename: "/workspace/env/default/hooks.kt",
        lineNo: "",
        message: "cleanup failed",
        stackTrace: "suite cleanup stack",
      },
    },
  }));
  processor.process(JSON.stringify({
    type: "specEnd",
    id: "/workspace/specs/example.spec",
    name: "Checkout",
    filename: "/workspace/specs/example.spec",
    line: 1,
    result: {
      time: 100,
      beforeHookFailure: {
        text: "Spec setup failed",
        filename: "/workspace/specs/example.spec",
        lineNo: "2",
        message: "missing fixture",
        stackTrace: "spec stack",
      },
      afterHookFailure: {
        text: "Spec teardown failed",
        filename: "/workspace/specs/example.spec",
        lineNo: "19",
        message: "cleanup failed",
        stackTrace: "spec cleanup stack",
      },
    },
  }));

  assert.deepEqual(events, [
    {
      type: "testStarted",
      id: "Before Suite",
      parentId: "suite",
      name: "Before Suite",
    },
    {
      type: "testFailed",
      id: "Before Suite",
      parentId: "suite",
      name: "Before Suite",
      message: "Failed: Suite setup failed\nFilename: /workspace/env/default/hooks.kt:9\nMessage: database unavailable\nStack Trace:\nsuite stack",
    },
    {
      type: "testFinished",
      id: "Before Suite",
      parentId: "suite",
      name: "Before Suite",
    },
    {
      type: "testStarted",
      id: "After Suite",
      parentId: "suite",
      name: "After Suite",
    },
    {
      type: "testFailed",
      id: "After Suite",
      parentId: "suite",
      name: "After Suite",
      message: "Failed: Suite teardown failed\nFilename: /workspace/env/default/hooks.kt\nMessage: cleanup failed\nStack Trace:\nsuite cleanup stack",
    },
    {
      type: "testFinished",
      id: "After Suite",
      parentId: "suite",
      name: "After Suite",
    },
    {
      type: "testStarted",
      id: "/workspace/specs/example.specBefore Specification",
      parentId: "/workspace/specs/example.spec",
      name: "Before Specification",
      location: "gauge:///workspace/specs/example.spec:1",
    },
    {
      type: "testFailed",
      id: "/workspace/specs/example.specBefore Specification",
      parentId: "/workspace/specs/example.spec",
      name: "Before Specification",
      message: "Failed: Spec setup failed\nFilename: /workspace/specs/example.spec:2\nMessage: missing fixture\nStack Trace:\nspec stack",
    },
    {
      type: "testFinished",
      id: "/workspace/specs/example.specBefore Specification",
      parentId: "/workspace/specs/example.spec",
      name: "Before Specification",
    },
    {
      type: "testStarted",
      id: "/workspace/specs/example.specAfter Specification",
      parentId: "/workspace/specs/example.spec",
      name: "After Specification",
      location: "gauge:///workspace/specs/example.spec:1",
    },
    {
      type: "testFailed",
      id: "/workspace/specs/example.specAfter Specification",
      parentId: "/workspace/specs/example.spec",
      name: "After Specification",
      message: "Failed: Spec teardown failed\nFilename: /workspace/specs/example.spec:19\nMessage: cleanup failed\nStack Trace:\nspec cleanup stack",
    },
    {
      type: "testFinished",
      id: "/workspace/specs/example.specAfter Specification",
      parentId: "/workspace/specs/example.spec",
      name: "After Specification",
    },
    {
      type: "suiteFinished",
      id: "/workspace/specs/example.spec",
      parentId: "suite",
      name: "Checkout",
      duration: 100,
    },
  ]);
});

test("MachineReadableEventProcessor maps Gauge notifications and output events", () => {
  const { MachineReadableEventProcessor } = require("../../src/execution/lineProcessors");
  const events = [];
  const processor = new MachineReadableEventProcessor((event) => events.push(event));

  processor.process(JSON.stringify({
    type: "notification",
    notification: {
      title: "Gauge",
      message: "Install plugin",
      type: "warning",
    },
  }));
  processor.process(JSON.stringify({
    type: "out",
    message: "step output",
  }));
  processor.process("not json");

  assert.deepEqual(events, [
    {
      type: "notification",
      title: "Gauge",
      message: "Install plugin",
      severity: "warning",
    },
    {
      type: "output",
      message: "step output\n",
    },
  ]);
});
