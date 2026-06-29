"use strict";

const MARKDOWN_LANGUAGE = "markdown";
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

class GaugeEnterHandler {
  constructor(options = {}) {
    this.vscode = options.vscode || require("vscode");
    this.projectFactory = options.projectFactory;
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
    if (!this.isGaugeDocument(document) || typeof document.save !== "function") {
      return undefined;
    }
    const contentChanges = Array.isArray(event.contentChanges) ? event.contentChanges : [];
    if (!contentChanges.some((change) => typeof change.text === "string" && change.text.includes("\n"))) {
      return undefined;
    }
    return document.save();
  }

  isGaugeDocument(document) {
    if (!document) {
      return false;
    }
    if (document.languageId === "gauge") {
      return true;
    }
    if (
      document.languageId !== MARKDOWN_LANGUAGE
      || !MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document))
      || !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return false;
    }
    try {
      this.projectFactory.getGaugeRootFromFilePath(documentPath(document));
      return true;
    } catch (_error) {
      return false;
    }
  }
}

module.exports = {
  GaugeEnterHandler,
};
