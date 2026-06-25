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
