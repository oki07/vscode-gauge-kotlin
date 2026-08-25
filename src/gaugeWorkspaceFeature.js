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

function disposeSafely(disposable) {
  if (!disposable || typeof disposable.dispose !== "function") {
    return;
  }
  try {
    disposable.dispose();
  } catch (_error) {
    // Feature cleanup must continue after a host registration cleanup failure.
  }
}

class GaugeWorkspaceFeature {
  constructor(client, options = {}) {
    this.client = client;
    this.disposed = false;
    this.vscode = getVscode(options.vscode);
    this.listeners = new Map();
    this.registrationType = undefined;
    this.requestGeneration = 0;
    this.requestInitialized = false;
    this.requestRegistration = undefined;
  }

  get messages() {
    return SAVE_FILES_REQUEST;
  }

  fillInitializeParams() {}

  fillClientCapabilities(capabilities) {
    capabilities.saveFiles = true;
  }

  initialize() {
    if (this.disposed || this.requestInitialized) {
      return;
    }
    this.requestInitialized = true;
    this.requestGeneration += 1;
    const generation = this.requestGeneration;
    let registration;
    try {
      registration = this.client.onRequest(SAVE_FILES_REQUEST.method, () => {
        if (!this.isRequestGenerationCurrent(generation)) {
          return null;
        }
        return Promise.resolve(this.vscode.workspace.saveAll(false)).then(() => null);
      });
    } catch (error) {
      if (this.requestGeneration === generation) {
        this.requestGeneration += 1;
        this.requestInitialized = false;
      }
      throw error;
    }
    if (!this.isRequestGenerationCurrent(generation)) {
      disposeSafely(registration);
      return;
    }
    this.requestRegistration = registration;
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
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.releaseRequestRegistration();
    for (const disposable of this.listeners.values()) {
      disposable.dispose();
    }
    this.listeners.clear();
  }

  clear() {
    if (this.disposed) {
      return;
    }
    this.releaseRequestRegistration();
  }

  isRequestGenerationCurrent(generation) {
    return !this.disposed
      && this.requestInitialized
      && this.requestGeneration === generation;
  }

  releaseRequestRegistration() {
    this.requestGeneration += 1;
    this.requestInitialized = false;
    const registration = this.requestRegistration;
    this.requestRegistration = undefined;
    disposeSafely(registration);
  }

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
