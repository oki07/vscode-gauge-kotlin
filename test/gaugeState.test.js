const assert = require("node:assert/strict");
const test = require("node:test");

test("GaugeState persists the last report path in workspace state", () => {
  const { GaugeState, LAST_REPORT_PATH } = require("../src/gaugeState");
  const stored = new Map();
  const updates = [];
  const context = {
    workspaceState: {
      update(key, value) {
        updates.push({ key, value });
        stored.set(key, value);
        return Promise.resolve(undefined);
      },
      get(key) {
        return stored.get(key);
      },
    },
  };
  const state = new GaugeState(context);

  const updateResult = state.setReportPath("/workspace/reports/html-report/index.html");

  assert.equal(LAST_REPORT_PATH, "gauge.execution.report");
  assert.equal(updateResult instanceof Promise, true);
  assert.deepEqual(updates, [
    {
      key: "gauge.execution.report",
      value: "/workspace/reports/html-report/index.html",
    },
  ]);
  assert.equal(state.getReportPath(), "/workspace/reports/html-report/index.html");
});
