"use strict";

const fs = require("node:fs/promises");
const { fileURLToPath } = require("node:url");
const { isFileSchemeDocument } = require("./workspaceDocumentStore");

const SCENARIOS_REQUEST = "gauge/scenarios";

function specificationUri(vscode, value) {
  if (value.startsWith("file:")) {
    if (vscode.Uri && typeof vscode.Uri.parse === "function") {
      return vscode.Uri.parse(value);
    }
    value = fileURLToPath(value);
  }
  return vscode.Uri && typeof vscode.Uri.file === "function"
    ? vscode.Uri.file(value)
    : { fsPath: value };
}

async function availableSpecification(vscode, uri) {
  const workspace = vscode.workspace || {};
  // getgauge/gauge/api/lang/customResponses.go reads the open buffer directly.
  // A buffer can remain useful after its backing file has been deleted.
  const openDocument = (workspace.textDocuments || []).find((document) => (
    !document.isClosed && isFileSchemeDocument(document)
    && document.uri && document.uri.fsPath === uri.fsPath
  ));
  if (openDocument) {
    return openDocument.uri;
  }
  try {
    if (workspace.fs && typeof workspace.fs.stat === "function") {
      const stat = await workspace.fs.stat(uri);
      return (stat.type & 1) !== 0 ? uri : undefined;
    }
    return (await fs.stat(uri.fsPath)).isFile() ? uri : undefined;
  } catch (error) {
    if (error && ["FileNotFound", "ENOENT", "ENOTDIR"].includes(error.code)) {
      return undefined;
    }
    throw error;
  }
}

async function requestGaugeScenarios(client, params, options) {
  const current = () => (!options.token || !options.token.isCancellationRequested)
    && (!options.isCurrent || options.isCurrent());
  if (!current()) {
    return [];
  }
  // Gauge 1.6.35 exits for an absent closed spec: customResponses.go indexes
  // an empty GetAvailableSpecDetails result. This check suppresses known missing
  // paths; deletion after the check still requires a server-side guard.
  const uri = await availableSpecification(
    options.vscode, specificationUri(options.vscode, params.textDocument.uri),
  );
  if (!uri || !current()) {
    return [];
  }
  // Gauge keys its open document cache by the full URI string. Use the same
  // file URI as didOpen, including escaping, even when the tree supplies a path.
  const value = typeof uri.toString === "function" && uri.toString !== Object.prototype.toString
    ? uri.toString()
    : params.textDocument.uri;
  return client.sendRequest(SCENARIOS_REQUEST, {
    ...params,
    textDocument: { ...params.textDocument, uri: value },
  }, options.token);
}

module.exports = { SCENARIOS_REQUEST, requestGaugeScenarios };
