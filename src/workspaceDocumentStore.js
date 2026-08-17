"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { concurrencyLimit, mapWithConcurrency } = require("./asyncWork");

const WORKSPACE_DOCUMENT_GLOB = "**/*.{kt,java,cpt,spec,md}";
const WORKSPACE_STEP_IMPLEMENTATION_SCAN_COMPLETE = "__gaugeStepImplementationScanComplete";
const DEFAULT_INITIAL_READ_CONCURRENCY = 16;

const LANGUAGE_IDS_BY_EXTENSION = [
  [/\.kts?$/i, "kotlin"],
  [/\.java$/i, "java"],
  [/\.cpt$/i, "gauge-concept"],
  [/\.spec$/i, "gauge"],
  [/\.md$/i, "markdown"],
];

function markWorkspaceStepImplementationScanComplete(documents) {
  Object.defineProperty(documents, WORKSPACE_STEP_IMPLEMENTATION_SCAN_COMPLETE, {
    configurable: true,
    enumerable: false,
    value: true,
    writable: false,
  });
  return documents;
}

function isWorkspaceStepImplementationScanComplete(workspaceDocuments) {
  return Boolean(
    workspaceDocuments
    && workspaceDocuments[WORKSPACE_STEP_IMPLEMENTATION_SCAN_COMPLETE] === true,
  );
}

function languageIdForPath(file) {
  for (const [pattern, languageId] of LANGUAGE_IDS_BY_EXTENSION) {
    if (pattern.test(file)) {
      return languageId;
    }
  }
  return undefined;
}

function isWorkspaceDocumentPath(file) {
  return languageIdForPath(file) !== undefined;
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

// Diff views and history providers open documents on other schemes (git:,
// gitlens:, pr:) whose fsPath equals the real file. Letting them into the
// store would shadow the current file content with an older revision.
function isFileSchemeDocument(document) {
  const scheme = document && document.uri && document.uri.scheme;
  return !scheme || scheme === "file";
}

function uriPath(uri) {
  return (uri && (uri.fsPath || uri.path)) || "";
}

function createDiskDocument(file, text, vscode) {
  const uri = vscode
    && vscode.Uri
    && typeof vscode.Uri.file === "function"
    ? vscode.Uri.file(file)
    : { fsPath: file };
  return {
    languageId: languageIdForPath(file),
    uri,
    version: 0,
    getText() {
      return text;
    },
  };
}

class WorkspaceDocumentStore {
  constructor(options = {}) {
    this.vscode = options.vscode || require("vscode");
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.projectFactory = options.projectFactory;
    this.initialReadConcurrency = concurrencyLimit(
      options.initialReadConcurrency,
      DEFAULT_INITIAL_READ_CONCURRENCY,
    );
    this.diskDocuments = new Map();
    this.cachedDocuments = undefined;
    this.changeListeners = new Set();
    this.disposables = [];
    this.disposed = false;
    this.generation = 0;
    this.readyPromise = undefined;
    this.scanComplete = false;
  }

  rootForFile(file) {
    if (
      !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
      || !file
    ) {
      return undefined;
    }
    try {
      const root = this.projectFactory.getGaugeRootFromFilePath(file);
      if (!root) {
        return undefined;
      }
      if (typeof this.projectFactory.isGaugeProject === "function") {
        return this.projectFactory.isGaugeProject(root) !== false ? root : undefined;
      }
      return root;
    } catch (_error) {
      return undefined;
    }
  }

  belongsToGaugeProject(file) {
    if (
      !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return true;
    }
    return this.rootForFile(file) !== undefined;
  }

  onDidChangeDocuments(listener) {
    this.changeListeners.add(listener);
    const listeners = this.changeListeners;
    return {
      dispose() {
        listeners.delete(listener);
      },
    };
  }

  notifyChange(file) {
    if (this.disposed) {
      return;
    }
    this.cachedDocuments = undefined;
    this.generation += 1;
    for (const listener of [...this.changeListeners]) {
      try {
        listener({ file });
      } catch (_error) {
        // One broken listener must not stall the other subscribers.
      }
    }
  }

  async readFileText(file) {
    if (this.fileSystem.promises && typeof this.fileSystem.promises.readFile === "function") {
      const content = await this.fileSystem.promises.readFile(file);
      return String(content);
    }
    return String(this.fileSystem.readFileSync(file));
  }

  async loadDiskDocument(file, options = {}) {
    try {
      const text = await this.readFileText(file);
      if (this.disposed) {
        return;
      }
      this.diskDocuments.set(file, createDiskDocument(file, text, this.vscode));
    } catch (_error) {
      this.diskDocuments.delete(file);
    }
    // A silent load skips waking the listeners, which is what the initial
    // scan wants, but the memoised set must still see the new document or
    // everything reading it during the scan works from a frozen snapshot.
    this.cachedDocuments = undefined;
    if (!options.silent) {
      this.notifyChange(file);
    }
  }

  handleFileEvent(uri) {
    const file = uriPath(uri);
    if (!file || !isWorkspaceDocumentPath(file) || !this.belongsToGaugeProject(file)) {
      return Promise.resolve();
    }
    return this.loadDiskDocument(file);
  }

  handleFileDelete(uri) {
    const file = uriPath(uri);
    if (!file || !this.diskDocuments.has(file)) {
      return Promise.resolve();
    }
    this.diskDocuments.delete(file);
    this.notifyChange(file);
    return Promise.resolve();
  }

  handleDocumentEvent(document) {
    const file = documentPath(document);
    if (!file || !isWorkspaceDocumentPath(file) || !isFileSchemeDocument(document)) {
      return;
    }
    this.notifyChange(file);
  }

  handleDocumentClose(document) {
    const file = documentPath(document);
    if (!file || !isWorkspaceDocumentPath(file) || !isFileSchemeDocument(document)) {
      return Promise.resolve();
    }
    if (this.diskDocuments.has(file) || this.belongsToGaugeProject(file)) {
      return this.loadDiskDocument(file);
    }
    this.notifyChange(file);
    return Promise.resolve();
  }

  registerEventListeners() {
    const workspace = this.vscode.workspace || {};
    const listen = (name, listener) => {
      if (typeof workspace[name] === "function") {
        const disposable = workspace[name](listener);
        if (disposable) {
          this.disposables.push(disposable);
        }
      }
    };
    listen("onDidOpenTextDocument", (document) => this.handleDocumentEvent(document));
    listen("onDidChangeTextDocument", (event) => this.handleDocumentEvent(event && event.document));
    listen("onDidCloseTextDocument", (document) => this.handleDocumentClose(document));
    if (typeof workspace.createFileSystemWatcher === "function") {
      const watcher = workspace.createFileSystemWatcher(WORKSPACE_DOCUMENT_GLOB);
      this.disposables.push(watcher);
      if (typeof watcher.onDidCreate === "function") {
        watcher.onDidCreate((uri) => this.handleFileEvent(uri));
      }
      if (typeof watcher.onDidChange === "function") {
        watcher.onDidChange((uri) => this.handleFileEvent(uri));
      }
      if (typeof watcher.onDidDelete === "function") {
        watcher.onDidDelete((uri) => this.handleFileDelete(uri));
      }
    }
  }

  async scanWorkspace() {
    const workspace = this.vscode.workspace || {};
    if (typeof workspace.findFiles !== "function") {
      this.notifyChange(undefined);
      return;
    }
    let uris = [];
    try {
      uris = (await workspace.findFiles(WORKSPACE_DOCUMENT_GLOB)) || [];
    } catch (_error) {
      uris = [];
    }
    await mapWithConcurrency(uris, this.initialReadConcurrency, async (uri) => {
      const file = uriPath(uri);
      if (!file || !isWorkspaceDocumentPath(file) || !this.belongsToGaugeProject(file)) {
        return;
      }
      await this.loadDiskDocument(file, { silent: true });
    });
    this.scanComplete = true;
    this.notifyChange(undefined);
  }

  start() {
    if (this.readyPromise) {
      return this.readyPromise;
    }
    this.registerEventListeners();
    this.readyPromise = this.scanWorkspace();
    return this.readyPromise;
  }

  whenReady() {
    return this.start();
  }

  isScanComplete() {
    return this.scanComplete;
  }

  documents() {
    if (this.cachedDocuments) {
      return this.cachedDocuments;
    }
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    for (const document of workspace.textDocuments || []) {
      if (!document || typeof document.getText !== "function" || !isFileSchemeDocument(document)) {
        continue;
      }
      const file = documentPath(document);
      if (file) {
        if (seenPaths.has(file)) {
          continue;
        }
        seenPaths.add(file);
      }
      documents.push(document);
    }
    for (const [file, document] of this.diskDocuments) {
      if (!seenPaths.has(file)) {
        documents.push(document);
      }
    }
    if (this.scanComplete) {
      markWorkspaceStepImplementationScanComplete(documents);
    }
    this.cachedDocuments = documents;
    return documents;
  }

  dispose() {
    this.disposed = true;
    this.changeListeners.clear();
    for (const disposable of this.disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
    this.disposables = [];
    this.diskDocuments.clear();
    this.cachedDocuments = undefined;
  }
}

module.exports = {
  DEFAULT_INITIAL_READ_CONCURRENCY,
  WORKSPACE_DOCUMENT_GLOB,
  WorkspaceDocumentStore,
  isFileSchemeDocument,
  isWorkspaceStepImplementationScanComplete,
  languageIdForPath,
  markWorkspaceStepImplementationScanComplete,
};
