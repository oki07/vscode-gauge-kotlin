"use strict";

class GaugeEnterHandler {
  constructor(options = {}) {
    this.vscode = options.vscode || require("vscode");
  }

  register() {
    if (!this.vscode.workspace
      || typeof this.vscode.workspace.onDidChangeTextDocument !== "function") {
      return undefined;
    }
    return this.vscode.workspace.onDidChangeTextDocument((event) => this.handleChange(event));
  }

  handleChange(event) {
    const document = event && event.document;
    if (!document || document.languageId !== "gauge" || typeof document.save !== "function") {
      return undefined;
    }
    const contentChanges = Array.isArray(event.contentChanges) ? event.contentChanges : [];
    if (!contentChanges.some((change) => typeof change.text === "string" && change.text.includes("\n"))) {
      return undefined;
    }
    return document.save();
  }
}

module.exports = {
  GaugeEnterHandler,
};
