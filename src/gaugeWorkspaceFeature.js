"use strict";

const WORKSPACE_SAVE_FILES_METHOD = "workspace/saveFiles";

class FallbackRequestType0 {
  constructor(method) {
    this.method = method;
    this.numberOfParams = 0;
  }

  get parameterStructures() {
    return {
      toString() {
        return "auto";
      },
    };
  }
}

function requestType0Constructor() {
  for (const moduleName of ["vscode-languageclient", "vscode-jsonrpc"]) {
    try {
      const candidate = require(moduleName).RequestType0;
      if (typeof candidate === "function") {
        return candidate;
      }
    } catch (_error) {
      // The unit test environment does not install extension runtime dependencies.
    }
  }
  return FallbackRequestType0;
}

const RequestType0 = requestType0Constructor();
const SAVE_FILES_REQUEST = new RequestType0(WORKSPACE_SAVE_FILES_METHOD);

function getVscode(vscodeApi) {
  return vscodeApi || require("vscode");
}

class GaugeWorkspaceFeature {
  constructor(client, options = {}) {
    this.client = client;
    this.vscode = getVscode(options.vscode);
    this.listeners = new Map();
    this.registrationType = undefined;
  }

  get messages() {
    return SAVE_FILES_REQUEST;
  }

  fillInitializeParams() {}

  fillClientCapabilities(capabilities) {
    capabilities.saveFiles = true;
  }

  initialize() {
    this.client.onRequest(SAVE_FILES_REQUEST.method, () => (
      this.vscode.workspace.saveAll(false).then(() => null)
    ));
  }

  register() {}

  unregister(id) {
    const disposable = this.listeners.get(id);
    if (!disposable) {
      return;
    }
    this.listeners.delete(id);
    disposable.dispose();
  }

  dispose() {
    for (const disposable of this.listeners.values()) {
      disposable.dispose();
    }
    this.listeners.clear();
  }

  clear() {}

  getState() {
    return {
      kind: "workspace",
      id: this.registrationType,
      registrations: this.listeners.size > 0,
    };
  }
}

module.exports = {
  GaugeWorkspaceFeature,
  SAVE_FILES_REQUEST,
};
