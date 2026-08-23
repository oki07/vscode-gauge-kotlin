"use strict";

const { createLspRequestOwner } = require("./lspRequestOwner");

const SCENARIOS_REQUEST = "gauge/scenarios";

function getVscode(vscodeApi) {
  return vscodeApi || require("vscode");
}

function documentUri(editor, spec, vscode) {
  if (editor && editor.document && editor.document.uri) {
    const uri = editor.document.uri;
    if (typeof uri.toString === "function") {
      return uri.toString();
    }
  }
  if (vscode.Uri && typeof vscode.Uri.file === "function") {
    const uri = vscode.Uri.file(spec);
    if (uri && typeof uri.toString === "function") {
      return uri.toString();
    }
  }
  return spec;
}

function documentFsPath(editor, spec) {
  if (editor && editor.document && editor.document.uri && editor.document.uri.fsPath) {
    return editor.document.uri.fsPath;
  }
  return spec;
}

function resolveClientsMap(clientsMap) {
  if (typeof clientsMap === "function") {
    return clientsMap();
  }
  return clientsMap;
}

function missingClientError(spec) {
  return new Error(`No Gauge language client available for ${spec}.`);
}

function createGaugeScenariosProvider(clientsMap, options = {}) {
  const vscode = getVscode(options.vscode);
  const owner = createLspRequestOwner(undefined);
  const provideGaugeScenarios = (request = {}) => owner.run(async (operation) => {
    const editor = vscode.window && vscode.window.activeTextEditor;
    if (owner.operationStopped(operation)) {
      return undefined;
    }
    const resolvedClientsMap = resolveClientsMap(clientsMap);
    if (owner.operationStopped(operation)) {
      return undefined;
    }
    if (!resolvedClientsMap || typeof resolvedClientsMap.get !== "function") {
      throw missingClientError(request.spec);
    }

    const specPath = documentFsPath(editor, request.spec);
    if (owner.operationStopped(operation)) {
      return undefined;
    }
    const entry = resolvedClientsMap.get(specPath);
    if (owner.operationStopped(operation)) {
      return undefined;
    }
    if (!entry || !entry.client) {
      throw missingClientError(request.spec);
    }

    if (typeof entry.client.start === "function") {
      await entry.client.start();
      if (owner.operationStopped(operation)) {
        return undefined;
      }
    }

    const params = {
      textDocument: { uri: documentUri(editor, request.spec, vscode) },
      position: request.atCursor ? request.position : { line: 1, character: 1 },
    };
    const source = owner.createSource(operation, vscode.CancellationTokenSource);
    if (owner.operationStopped(operation)) {
      return undefined;
    }
    return entry.client.sendRequest(
      SCENARIOS_REQUEST,
      params,
      source && source.token,
    );
  });
  provideGaugeScenarios.dispose = owner.dispose;
  return provideGaugeScenarios;
}

module.exports = {
  SCENARIOS_REQUEST,
  createGaugeScenariosProvider,
};
