"use strict";

const LAST_REPORT_PATH = "gauge.execution.report";

class GaugeState {
  constructor(context) {
    this.context = context;
  }

  setReportPath(reportPath) {
    return this.context.workspaceState.update(LAST_REPORT_PATH, reportPath);
  }

  getReportPath() {
    return this.context.workspaceState.get(LAST_REPORT_PATH);
  }

  dispose() {}
}

module.exports = {
  GaugeState,
  LAST_REPORT_PATH,
};
