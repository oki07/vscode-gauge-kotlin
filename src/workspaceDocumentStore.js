"use strict";

const nodeFs = require("node:fs");
const { canonicalFilePath } = require("./gaugeExecutionIdentifier");
const nodePath = require("node:path");
const { concurrencyLimit, mapWithConcurrency } = require("./asyncWork");

const WORKSPACE_DOCUMENT_GLOB = "**/*.{kt,java,cpt,spec,md}";
const WORKSPACE_STEP_IMPLEMENTATION_SCAN_COMPLETE = "__gaugeStepImplementationScanComplete";
const DEFAULT_INITIAL_READ_CONCURRENCY = 16;

/** @type {Array<[RegExp, string]>} */
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
    this.sourceScope = options.sourceScope;
    this.sourceWatchers = [];
    this.sourceRootKey = "[]";
    this.initialReadConcurrency = concurrencyLimit(
      options.initialReadConcurrency,
      DEFAULT_INITIAL_READ_CONCURRENCY,
    );
    this.diskDocuments = new Map();
    this.fileGenerations = new Map();
    this.cachedDocuments = undefined;
    this.changeListeners = new Set();
    this.disposables = [];
    this.disposed = false;
    this.generation = 0;
    this.readyPromise = undefined;
    this.scanComplete = false;
    this.disposalSignal = new Promise((resolve) => {
      this.resolveDisposal = resolve;
    });
  }

  allowsSourceDocument(document) {
    const file = typeof document === "string" ? document : documentPath(document);
    return !/\.(?:kt|java)$/i.test(file || "") || !this.sourceScope
      || this.sourceScope.allows(canonicalFilePath(file, this.fileSystem, this.pathModule)) !== false;
  }

  gaugeRoots() {
    const files = [...this.diskDocuments.keys(), ...(this.vscode.workspace?.textDocuments || []).map(documentPath)];
    for (const root of this.sourceScope?.moduleRoots?.() || []) files.push(this.pathModule.join(root, ".gauge-source-context.kt"));
    return [...new Set(files.map((file) => this.rootForFile(file)).filter(Boolean))];
  }

  consumerRoots(contextRoot) {
    if (!this.sourceScope?.canUse) return [];
    return this.gaugeRoots().filter((root) => this.sourceScope.canUse(root, contextRoot));
  }

  importedContext(file) {
    return /\.(?:kt|java)$/i.test(file || "") ? this.sourceScope?.contextRoot?.(file) : undefined;
  }

  contextRootForFile(file) {
    const ownRoot = this.rootForFile(file);
    if (ownRoot) return ownRoot;
    if (!/\.(?:kt|java)$/i.test(file || "") || this.sourceScope?.allows(file) !== true) return undefined;
    return this.importedContext(file);
  }

  isGaugeSource(file) {
    if (this.rootForFile(file)) return true;
    const root = this.sourceScope?.contextRoot?.(file);
    return Boolean(root && this.consumerRoots(root).length);
  }

  belongsToContext(document, root, includeConsumers = false) {
    if (!root || !this.sourceScope?.modulesFor || !this.sourceScope.modulesFor(root).length) return undefined;
    const file = typeof document === "string" ? document : documentPath(document);
    const roots = includeConsumers ? [...new Set([root, ...this.consumerRoots(root)])] : [root];
    if (/\.(?:kt|java)$/i.test(file || "")) return roots.some((context) => this.sourceScope.allows(file, context) === true);
    const candidate = this.rootForFile(file);
    return roots.includes(candidate);
  }

  syncSourceWatchers() {
    const roots = [...(this.sourceScope?.sourceRoots?.() || [])].sort();
    const key = JSON.stringify(roots);
    if (key === this.sourceRootKey) return false;
    this.sourceRootKey = key;
    for (const disposable of this.sourceWatchers) this.disposeSafely(disposable);
    this.sourceWatchers = [];
    const workspace = this.vscode.workspace || {};
    if (workspace.createFileSystemWatcher && this.vscode.RelativePattern) {
      for (const root of roots) {
        const watcher = workspace.createFileSystemWatcher(new this.vscode.RelativePattern(root, "**/*.{kt,java}"));
        this.sourceWatchers.push(watcher);
        for (const event of ["onDidCreate", "onDidChange", "onDidDelete"]) {
          this.sourceWatchers.push(watcher[event]((uri) => event === "onDidDelete" ? this.handleFileDelete(uri) : this.handleFileEvent(uri)));
        }
      }
    }
    return true;
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
    if (/\.(?:kt|java)$/i.test(file || "") && this.sourceScope?.allows(file) === true) return true;
    if (
      !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return true;
    }
    return this.rootForFile(file) !== undefined;
  }

  onDidChangeDocuments(listener) {
    if (this.disposed) {
      return { dispose() {} };
    }
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

  nextFileGeneration(file) {
    const generation = (this.fileGenerations.get(file) || 0) + 1;
    this.fileGenerations.set(file, generation);
    return generation;
  }

  isCurrentFileGeneration(file, generation) {
    return this.fileGenerations.get(file) === generation;
  }

  async loadDiskDocument(file, options = {}) {
    if (this.disposed) {
      return;
    }
    const fileGeneration = this.nextFileGeneration(file);
    try {
      const text = await this.readFileText(file);
      if (this.disposed || !this.isCurrentFileGeneration(file, fileGeneration)) {
        return;
      }
      this.diskDocuments.set(file, createDiskDocument(file, text, this.vscode));
    } catch (_error) {
      if (this.disposed || !this.isCurrentFileGeneration(file, fileGeneration)) {
        return;
      }
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
    if (this.disposed) {
      return Promise.resolve();
    }
    const file = uriPath(uri);
    if (!file || !isWorkspaceDocumentPath(file) || !this.belongsToGaugeProject(file)) {
      return Promise.resolve();
    }
    return this.loadDiskDocument(file);
  }

  handleFileDelete(uri) {
    if (this.disposed) {
      return Promise.resolve();
    }
    const file = uriPath(uri);
    if (!file || (!this.diskDocuments.has(file) && !this.fileGenerations.has(file))) {
      return Promise.resolve();
    }
    this.nextFileGeneration(file);
    this.diskDocuments.delete(file);
    this.notifyChange(file);
    return Promise.resolve();
  }

  handleDocumentEvent(document) {
    if (this.disposed) {
      return;
    }
    const file = documentPath(document);
    if (!file || !isWorkspaceDocumentPath(file) || !isFileSchemeDocument(document)) {
      return;
    }
    this.notifyChange(file);
  }

  handleDocumentClose(document) {
    if (this.disposed) {
      return Promise.resolve();
    }
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
    if (this.disposed) {
      return false;
    }
    const workspace = this.vscode.workspace || {};
    const registered = [];
    const own = (disposable) => {
      if (!disposable) {
        return !this.disposed;
      }
      if (this.disposed) {
        this.disposeSafely(disposable);
        return false;
      }
      this.disposables.push(disposable);
      registered.push(disposable);
      return true;
    };
    const listen = (name, listener) => {
      if (this.disposed) {
        return false;
      }
      if (typeof workspace[name] === "function") {
        const disposable = workspace[name](listener);
        return own(disposable);
      }
      return !this.disposed;
    };
    try {
      if (!listen("onDidOpenTextDocument", (document) => this.handleDocumentEvent(document))) {
        return false;
      }
      if (!listen(
        "onDidChangeTextDocument",
        (event) => this.handleDocumentEvent(event && event.document),
      )) {
        return false;
      }
      if (!listen("onDidCloseTextDocument", (document) => this.handleDocumentClose(document))) {
        return false;
      }
      // The initial findFiles runs once at start(). A folder added afterwards
      // brings existing specs and Kotlin sources with it, and the file system
      // watcher only reports create/change/delete, so those files would stay
      // invisible to every local index until one of them was touched.
      // Removing a folder fires no watcher delete events either, so a rescan is
      // the only thing that evicts its files: without one their concepts kept
      // appearing in Go to Symbol in Workspace and opened a file that is no
      // longer part of the workspace.
      if (!listen("onDidChangeWorkspaceFolders", () => {
        // Returned so a caller can await the rescan. VS Code ignores it.
        return this.rescanWorkspace();
      })) {
        return false;
      }
      if (this.disposed || typeof workspace.createFileSystemWatcher !== "function") {
        return !this.disposed;
      }
      const watcher = workspace.createFileSystemWatcher(WORKSPACE_DOCUMENT_GLOB);
      if (!own(watcher)) {
        return false;
      }
      const listenToWatcher = (name, listener) => {
        if (this.disposed) {
          return false;
        }
        if (typeof watcher[name] !== "function") {
          return true;
        }
        return own(watcher[name](listener));
      };
      if (!listenToWatcher("onDidCreate", (uri) => this.handleFileEvent(uri))) {
        return false;
      }
      if (!listenToWatcher("onDidChange", (uri) => this.handleFileEvent(uri))) {
        return false;
      }
      if (!listenToWatcher("onDidDelete", (uri) => this.handleFileDelete(uri))) {
        return false;
      }
      return !this.disposed;
    } catch (error) {
      for (const disposable of registered) {
        const index = this.disposables.indexOf(disposable);
        if (index >= 0) {
          this.disposables.splice(index, 1);
          this.disposeSafely(disposable);
        }
      }
      if (this.disposed) {
        return false;
      }
      throw error;
    }
  }

  // Two scans can overlap when folders change twice in quick succession. Without
  // a generation the older one finishes last and marks its own, incomplete
  // result authoritative. This mirrors the per-file guard in loadDiskDocument.
  isCurrentScanGeneration(generation) {
    return this.scanGeneration === generation;
  }

  async scanWorkspace() {
    if (this.disposed) {
      return;
    }
    this.scanGeneration = (this.scanGeneration || 0) + 1;
    const generation = this.scanGeneration;
    const workspace = this.vscode.workspace || {};
    if (typeof workspace.findFiles !== "function") {
      this.notifyChange(undefined);
      return;
    }
    // Snapshot before the await: a file the watcher touches during the scan has
    // a newer generation afterwards and must survive the reconciliation below.
    const knownBefore = new Map(
      [...this.diskDocuments.keys()].map((file) => [file, this.fileGenerations.get(file)]),
    );
    let uris;
    try {
      uris = (await workspace.findFiles(WORKSPACE_DOCUMENT_GLOB)) || [];
      if (this.vscode.RelativePattern) {
        const additional = [];
        await mapWithConcurrency(this.sourceScope?.sourceRoots?.() || [], this.initialReadConcurrency, async (root) => {
          additional.push(...await workspace.findFiles(new this.vscode.RelativePattern(root, "**/*.{kt,java}")));
        });
        uris = [...uris, ...additional];
      }
    } catch (_error) {
      // A search that failed is not a listing of "no files". Reconciling against
      // it would delete the whole index and then call it authoritative, so every
      // step in the project would read as undefined until something else
      // changed. Keep what is already known, and leave the scan INCOMPLETE: the
      // folder that triggered this rescan really has not been read, and
      // consumers suppress rather than accuse when the index is not
      // authoritative.
      this.cachedDocuments = undefined;
      return;
    }
    if (this.disposed || !this.isCurrentScanGeneration(generation)) {
      return;
    }
    const seen = new Set();
    await mapWithConcurrency(uris, this.initialReadConcurrency, async (uri) => {
      if (this.disposed || !this.isCurrentScanGeneration(generation)) {
        return;
      }
      const file = uriPath(uri);
      if (!file || !isWorkspaceDocumentPath(file) || !this.belongsToGaugeProject(file)) {
        return;
      }
      if (seen.has(file)) return;
      seen.add(file);
      await this.loadDiskDocument(file, { silent: true });
    });
    if (this.disposed || !this.isCurrentScanGeneration(generation)) {
      return;
    }
    for (const [file, generationBefore] of knownBefore) {
      if (seen.has(file) || this.fileGenerations.get(file) !== generationBefore) {
        continue;
      }
      this.diskDocuments.delete(file);
      this.fileGenerations.delete(file);
    }
    this.scanComplete = true;
    this.notifyChange(undefined);
  }

  rescanWorkspace() {
    if (this.disposed) {
      return Promise.resolve(undefined);
    }
    // The scan is not complete again until it finishes. Leaving the flag set
    // told every consumer the index was authoritative, so specs in the folder
    // just added were diagnosed against an empty step set and every step showed
    // as undefined until the rescan caught up.
    this.scanComplete = false;
    const scan = this.scanWorkspace();
    this.pendingRescan = scan;
    return scan.catch(() => undefined);
  }

  start() {
    if (this.disposed) {
      return Promise.resolve(undefined);
    }
    if (this.readyPromise) {
      return this.readyPromise;
    }
    /** @type {(reason?: unknown) => void} */
    let rejectReady;
    /** @type {(value: unknown) => void} */
    let resolveReady;
    const ready = new Promise((resolve, reject) => {
      rejectReady = reject;
      resolveReady = resolve;
    });
    this.readyPromise = ready;
    try {
      if (!this.registerEventListeners() || this.disposed) {
        resolveReady(undefined);
        return ready;
      }
      if (this.sourceScope && typeof this.sourceScope.onDidChange === "function") {
        this.disposables.push(this.sourceScope.onDidChange(() => {
          if (this.syncSourceWatchers()) void this.rescanWorkspace();
          else this.notifyChange(undefined);
        }));
      }
      this.syncSourceWatchers();
      const scan = this.scanWorkspace();
      Promise.race([scan, this.disposalSignal]).then(
        () => resolveReady(undefined),
        (error) => rejectReady(error),
      );
      return ready;
    } catch (error) {
      if (this.readyPromise === ready) {
        this.readyPromise = undefined;
      }
      resolveReady(undefined);
      throw error;
    }
  }

  async whenReady() {
    await this.start();
    if (this.pendingRescan) await this.pendingRescan;
  }

  isScanComplete() {
    return this.scanComplete;
  }

  documents() {
    if (this.disposed) {
      return [];
    }
    if (this.cachedDocuments) {
      return this.cachedDocuments;
    }
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    const openDocuments = [...(workspace.textDocuments || [])]
      .sort((left, right) => Number(Boolean(right && right.isDirty)) - Number(Boolean(left && left.isDirty)));
    for (const document of openDocuments) {
      if (!document || typeof document.getText !== "function" || !isFileSchemeDocument(document)
        || !this.allowsSourceDocument(document)) {
        continue;
      }
      const file = canonicalFilePath(documentPath(document), this.fileSystem, this.pathModule);
      if (file) {
        if (seenPaths.has(file)) {
          continue;
        }
        seenPaths.add(file);
      }
      documents.push(document);
    }
    for (const [file, document] of this.diskDocuments) {
      if (!this.allowsSourceDocument(file)) continue;
      const identity = canonicalFilePath(file, this.fileSystem, this.pathModule);
      if (!seenPaths.has(identity)) {
        seenPaths.add(identity);
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
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const resolveDisposal = this.resolveDisposal;
    this.resolveDisposal = undefined;
    if (resolveDisposal) {
      resolveDisposal(undefined);
    }
    this.changeListeners.clear();
    for (const disposable of this.sourceWatchers) this.disposeSafely(disposable);
    this.sourceWatchers = [];
    const disposables = this.disposables;
    this.disposables = [];
    this.diskDocuments.clear();
    this.fileGenerations.clear();
    this.cachedDocuments = undefined;
    this.readyPromise = undefined;
    this.scanComplete = false;
    for (const disposable of disposables) {
      this.disposeSafely(disposable);
    }
  }

  disposeSafely(disposable) {
    if (!disposable || typeof disposable.dispose !== "function") {
      return;
    }
    try {
      disposable.dispose();
    } catch (_error) {
      // Cleanup failure cannot reactivate a terminal document store.
    }
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
