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

class DebuggerAttachedEventProcessor extends BaseProcessor {
  constructor(executor, vscode) {
    super("Runner Ready for Debugging");
    this.executor = executor;
    this.vscode = vscode;
  }

  process(lineText, gaugeDebugger) {
    if (!this.canProcess(lineText)) {
      return Promise.resolve(undefined);
    }

    const pidText = lineText.replace(/^\D+/g, "");
    if (pidText) {
      gaugeDebugger.addProcessId(Number(pidText));
    }

    return gaugeDebugger.startDebugger().catch((error) => {
      if (this.vscode && this.vscode.window) {
        this.vscode.window.showErrorMessage(`Failed to start debugger: ${error.message}`);
      }
      this.executor.cancel(false);
      return undefined;
    });
  }
}

class DebuggerNotAttachedEventProcessor extends BaseProcessor {
  constructor(executor, vscode) {
    super("No debugger attached");
    this.executor = executor;
    this.vscode = vscode;
  }

  process(lineText) {
    if (!this.canProcess(lineText)) {
      return;
    }
    if (this.vscode && this.vscode.window) {
      this.vscode.window.showErrorMessage("No debugger attached. Stopping the execution");
    }
    this.executor.cancel(false);
  }
}

module.exports = {
  DebuggerAttachedEventProcessor,
  DebuggerNotAttachedEventProcessor,
  ReportEventProcessor,
};
