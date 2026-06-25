"use strict";

class BaseProcessor {
  constructor(prefix) {
    this.eventPrefix = prefix;
  }

  canProcess(lineText) {
    return lineText.includes(this.eventPrefix);
  }
}

class ReportEventProcessor extends BaseProcessor {
  constructor(workspace) {
    super("Successfully generated html-report to => ");
    this.workspace = workspace;
  }

  process(lineText) {
    if (!this.canProcess(lineText)) {
      return;
    }
    this.workspace.setReportPath(lineText.replace(this.eventPrefix, ""));
  }
}

module.exports = {
  ReportEventProcessor,
};
