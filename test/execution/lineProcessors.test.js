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
