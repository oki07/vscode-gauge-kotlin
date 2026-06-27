"use strict";

const SHOW_REFERENCES = "editor.action.showReferences";
const SHOW_REFERENCES_AT_CURSOR = "gauge.showReferences.atCursor";
const SHOW_REFERENCES_FOR_STEP = "gauge.showReferences";
const STEP_REFERENCES_REQUEST = "gauge/stepReferences";
const STEP_VALUE_AT_REQUEST = "gauge/stepValueAt";
const KOTLIN_LANGUAGE = "kotlin";

const {
  GaugeStepDiagnosticsProvider,
  findStepFunctions,
} = require("./stepDiagnostics");

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createCancellationToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
}

function textDocumentIdentifier(uri) {
  return { uri };
}

function offsetAt(text, position) {
  let offset = 0;
  let line = 0;
  while (line < position.line && offset < text.length) {
    const nextLine = text.indexOf("\n", offset);
    if (nextLine === -1) {
      return text.length;
    }
    offset = nextLine + 1;
    line += 1;
  }
  return Math.min(offset + position.character, text.length);
}

class ReferenceProvider {
  constructor(clients, options = {}) {
    this.clients = clients;
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
    this.diagnosticsProvider = new GaugeStepDiagnosticsProvider({
      projectFactory: this.projectFactory,
      vscode: this.vscode,
    });
    this.disposables = [];
    this.registerCommands();
  }

  registerCommands() {
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return;
    }

    this.disposables.push(
      this.vscode.commands.registerCommand(
        SHOW_REFERENCES_AT_CURSOR,
        () => this.showStepReferencesAtCursor(),
      ),
    );
    this.disposables.push(
      this.vscode.commands.registerCommand(
        SHOW_REFERENCES_FOR_STEP,
        (uri, position, stepValue) => this.showStepReferences(uri, position, stepValue),
      ),
    );
  }

  dispose() {
    for (const disposable of this.disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
  }

  showStepReferences(uri, position, stepValue) {
    const languageClient = this.clients.get(this.vscode.Uri.parse(uri).fsPath).client;
    return languageClient
      .sendRequest(STEP_REFERENCES_REQUEST, stepValue, createCancellationToken(this.vscode))
      .then((locations) => this.showReferences(locations, uri, languageClient, position));
  }

  showStepReferencesAtCursor() {
    const editor = this.vscode.window.activeTextEditor;
    const position = editor.selection.active;
    const activeUri = editor.document.uri;
    const documentId = textDocumentIdentifier(activeUri.toString());
    const languageClient = this.clients.get(activeUri.fsPath).client;
    const params = { textDocument: documentId, position };

    return languageClient
      .sendRequest(STEP_VALUE_AT_REQUEST, params, createCancellationToken(this.vscode))
      .then((stepValue) => {
        const localStepValue = this.kotlinStepValueAt(editor.document, position);
        return this.showStepReferences(
          documentId.uri,
          position,
          stepValue || localStepValue || stepValue,
        );
      });
  }

  kotlinStepValueAt(document, position) {
    if (
      !document
      || document.languageId !== KOTLIN_LANGUAGE
      || typeof document.getText !== "function"
      || !position
    ) {
      return undefined;
    }

    const text = document.getText();
    const offset = offsetAt(text, position);
    const externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(document);
    for (const entry of findStepFunctions(text, externalConstants)) {
      const start = entry.annotationStart !== undefined ? entry.annotationStart : entry.parameterStart;
      const end = entry.declarationEnd !== undefined ? entry.declarationEnd : entry.parameterEnd;
      if (offset >= start && offset <= end) {
        return entry.aliases[0];
      }
    }
    return undefined;
  }

  showReferences(locations, uri, languageClient, position) {
    if (locations) {
      return this.vscode.commands.executeCommand(
        SHOW_REFERENCES,
        this.vscode.Uri.parse(uri),
        languageClient.protocol2CodeConverter.asPosition(position),
        locations.map((location) => languageClient.protocol2CodeConverter.asLocation(location)),
      );
    }
    this.vscode.window.showInformationMessage("Action NA: Try this on an implementation.");
    return Promise.resolve(false);
  }
}

module.exports = {
  ReferenceProvider,
};
