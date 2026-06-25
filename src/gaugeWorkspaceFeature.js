"use strict";

const SAVE_FILES_REQUEST = {
  method: "workspace/saveFiles",
};

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
