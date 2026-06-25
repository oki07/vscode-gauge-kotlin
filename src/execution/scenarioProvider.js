"use strict";

const SCENARIOS_REQUEST = "gauge/scenarios";

function getVscode(vscodeApi) {
  return vscodeApi || require("vscode");
}

function createToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
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
  return async function provideGaugeScenarios(request = {}) {
    const editor = vscode.window && vscode.window.activeTextEditor;
    const resolvedClientsMap = resolveClientsMap(clientsMap);
    if (!resolvedClientsMap || typeof resolvedClientsMap.get !== "function") {
      throw missingClientError(request.spec);
    }

    const entry = resolvedClientsMap.get(documentFsPath(editor, request.spec));
    if (!entry || !entry.client) {
      throw missingClientError(request.spec);
    }

    if (typeof entry.client.start === "function") {
      await entry.client.start();
    }

    const params = {
      textDocument: { uri: documentUri(editor, request.spec, vscode) },
      position: request.atCursor ? request.position : { line: 1, character: 1 },
    };
    return entry.client.sendRequest(
      SCENARIOS_REQUEST,
      params,
      createToken(vscode),
    );
  };
}

module.exports = {
  SCENARIOS_REQUEST,
  createGaugeScenariosProvider,
};
