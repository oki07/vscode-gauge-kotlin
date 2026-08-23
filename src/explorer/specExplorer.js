"use strict";

const nodePath = require("node:path");

const ACTIVATED_CONTEXT = "gauge:activated";
const OPEN_COMMAND = "gauge.open";
const SCENARIOS_REQUEST = "gauge/scenarios";
const SPEC_EXPLORER_VIEW = "gauge:specExplorer";
const SPECS_REQUEST = "gauge/specs";
const SPEC_EXTENSIONS = new Set([".spec", ".md"]);

function getVscode(vscodeApi) {
  return vscodeApi || require("vscode");
}

function createPosition(vscode, line, character) {
  if (typeof vscode.Position === "function") {
    return new vscode.Position(line, character);
  }
  return { line, character };
}

function createRange(vscode, line) {
  const start = createPosition(vscode, line, 0);
  const end = createPosition(vscode, line, 0);
  if (typeof vscode.Range === "function") {
    return new vscode.Range(start, end);
  }
  return { start, end };
}

function collapsedState(vscode) {
  return vscode.TreeItemCollapsibleState
    ? vscode.TreeItemCollapsibleState.Collapsed
    : 1;
}

function setCommandContext(vscode, key, value) {
  if (vscode.commands && typeof vscode.commands.executeCommand === "function") {
    return vscode.commands.executeCommand("setContext", key, value);
  }
  return undefined;
}

function isSpecExplorerEnabled(vscode) {
  if (!vscode.workspace || typeof vscode.workspace.getConfiguration !== "function") {
    return false;
  }
  const configuration = vscode.workspace.getConfiguration("gauge.specExplorer");
  return Boolean(configuration && configuration.get("enabled"));
}

function addDisposable(disposables, disposable) {
  if (disposable && typeof disposable.dispose === "function") {
    disposables.push(disposable);
  }
}

function cancellationRequested(token) {
  return Boolean(token && token.isCancellationRequested);
}

function specFileFromExecutionIdentifier(executionIdentifier, lineNo) {
  return executionIdentifier.split(`:${lineNo}`)[0];
}

class GaugeNode {
  constructor(label, file, vscode) {
    this.label = label;
    this.file = file;
    this.collapsibleState = collapsedState(vscode || {});
    this.command = {
      title: "Open File",
      command: OPEN_COMMAND,
      arguments: [this],
    };
  }
}

class Spec extends GaugeNode {
  constructor(label, file, vscode) {
    super(label, file, vscode);
    this.contextValue = "specification";
  }
}

class Scenario extends GaugeNode {
  constructor(label, file, lineNo, vscode) {
    super(label, file, vscode);
    this.lineNo = lineNo;
    this.executionIdentifier = `${this.file}:${this.lineNo}`;
    this.contextValue = "scenario";
  }
}

class SpecNodeProvider {
  constructor(gaugeWorkspace, options = {}) {
    this.gaugeWorkspace = gaugeWorkspace;
    this.vscode = getVscode(options.vscode);
    this.pathModule = options.pathModule || nodePath;
    this.executionController = options.executionController;
    this.setTimeout = options.setTimeout || setTimeout;
    this.clearTimeout = options.clearTimeout || clearTimeout;
    this.disposables = [];
    this.activationTimers = new Set();
    this.requestCancellationSources = new Set();
    this.activeFolder = undefined;
    this.languageClient = undefined;
    this.activation = Promise.resolve(undefined);
    this.disposed = false;
    this.onDidChangeTreeDataEmitter = new this.vscode.EventEmitter();
    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    setCommandContext(this.vscode, ACTIVATED_CONTEXT, false);
    if (isSpecExplorerEnabled(this.vscode)) {
      addDisposable(
        this.disposables,
        this.vscode.window.registerTreeDataProvider(SPEC_EXPLORER_VIEW, this),
      );
      this.activeFolder = this.gaugeWorkspace.getDefaultFolder();
      this.registerRefreshListeners();
      this.registerCommands();
      this.registerProjectChangeListener();
      this.activation = this.activateTreeDataProvider(this.activeFolder);
    }
  }

  ready() {
    return this.activation;
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.activeFolder = undefined;
    this.languageClient = undefined;

    for (const timeout of this.activationTimers) {
      this.clearTimeout(timeout);
    }
    this.activationTimers.clear();

    for (const source of [...this.requestCancellationSources]) {
      this.requestCancellationSources.delete(source);
      if (typeof source.cancel === "function") {
        source.cancel();
      }
      if (typeof source.dispose === "function") {
        source.dispose();
      }
    }

    const disposables = this.disposables;
    this.disposables = [];
    for (const disposable of disposables) {
      disposable.dispose();
    }
    if (this.onDidChangeTreeDataEmitter && typeof this.onDidChangeTreeDataEmitter.dispose === "function") {
      this.onDidChangeTreeDataEmitter.dispose();
    }
    Promise.resolve(setCommandContext(this.vscode, ACTIVATED_CONTEXT, false)).catch(() => undefined);
  }

  refresh(element) {
    if (this.disposed) {
      return;
    }
    this.onDidChangeTreeDataEmitter.fire(element);
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (this.disposed) {
      return [];
    }
    if (!this.activeFolder) {
      if (this.vscode.window && typeof this.vscode.window.showInformationMessage === "function") {
        await this.vscode.window.showInformationMessage("No dependency in empty workspace");
      }
      return [];
    }
    if (!this.languageClient) {
      return [];
    }

    if (element && element.contextValue === "specification") {
      return this.getScenarios(element);
    }
    return this.getSpecifications();
  }

  async getSpecifications() {
    if (this.disposed || !this.languageClient) {
      return [];
    }
    const client = this.languageClient;
    const cancellation = this.createRequestCancellationSource();
    const token = cancellation && cancellation.token;
    try {
      let values;
      try {
        values = await client.sendRequest(SPECS_REQUEST, {}, token);
      } catch (error) {
        if (this.disposed || cancellationRequested(token)) {
          return [];
        }
        throw error;
      }
      if (this.disposed || cancellationRequested(token)) {
        return [];
      }
      return (values || [])
        .filter((entry) => entry && entry.heading)
        .map((entry) => new Spec(entry.heading, entry.executionIdentifier, this.vscode));
    } finally {
      this.releaseRequestCancellationSource(cancellation);
    }
  }

  async getScenarios(spec) {
    if (this.disposed || !this.languageClient) {
      return [];
    }
    const client = this.languageClient;
    const cancellation = this.createRequestCancellationSource();
    const token = cancellation && cancellation.token;
    try {
      let values;
      try {
        values = await client.sendRequest(
          SCENARIOS_REQUEST,
          {
            textDocument: { uri: spec.file },
            position: createPosition(this.vscode, 1, 1),
          },
          token,
        );
      } catch (error) {
        if (this.disposed || cancellationRequested(token)) {
          return [];
        }
        throw error;
      }
      if (this.disposed || cancellationRequested(token)) {
        return [];
      }
      return (values || []).map((entry) => new Scenario(
        entry.heading,
        specFileFromExecutionIdentifier(entry.executionIdentifier, entry.lineNo),
        entry.lineNo,
        this.vscode,
      ));
    } finally {
      this.releaseRequestCancellationSource(cancellation);
    }
  }

  createRequestCancellationSource() {
    if (this.disposed || typeof this.vscode.CancellationTokenSource !== "function") {
      return undefined;
    }
    const source = new this.vscode.CancellationTokenSource();
    this.requestCancellationSources.add(source);
    return source;
  }

  releaseRequestCancellationSource(source) {
    if (!source || !this.requestCancellationSources.delete(source)) {
      return;
    }
    if (typeof source.dispose === "function") {
      source.dispose();
    }
  }

  changeClient(projectPath) {
    if (this.disposed) {
      return undefined;
    }
    setCommandContext(this.vscode, ACTIVATED_CONTEXT, false);
    if (!isSpecExplorerEnabled(this.vscode)) {
      return undefined;
    }
    this.activation = this.activateTreeDataProvider(projectPath);
    return this.activation;
  }

  activateTreeDataProvider(projectPath) {
    if (this.disposed || !projectPath) {
      return Promise.resolve(undefined);
    }
    const workspacePath = this.vscode.Uri && typeof this.vscode.Uri.file === "function"
      ? this.vscode.Uri.file(projectPath).fsPath
      : projectPath;
    const entry = this.gaugeWorkspace.getClientsMap().get(workspacePath);
    if (!entry || !entry.client) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry.client.start())
      .then(() => {
        if (this.disposed) {
          return undefined;
        }
        this.languageClient = entry.client;
        this.activeFolder = projectPath;
        this.refresh();
        if (this.disposed) {
          return undefined;
        }
        this.scheduleActivatedContext();
        return undefined;
      })
      // A second argument is read as options or an item, so the reason would
      // be dropped: fold it in. This fires exactly when the Gauge daemon
      // failed to start, which is when the user most needs to see why.
      .catch((reason) => {
        return this.showActivationError(reason);
      });
  }

  async showActivationError(reason) {
    if (this.disposed) {
      return undefined;
    }
    const detail = (reason && reason.message) || String(reason || "");
    try {
      const result = await this.vscode.window.showErrorMessage(
        `Failed to create test explorer.${detail ? ` ${detail}` : ""}`,
      );
      return this.disposed ? undefined : result;
    } catch (error) {
      if (this.disposed) {
        return undefined;
      }
      throw error;
    }
  }

  scheduleActivatedContext() {
    if (this.disposed) {
      return;
    }
    let timeout;
    let fired = false;
    const callback = () => {
      fired = true;
      if (timeout !== undefined) {
        this.activationTimers.delete(timeout);
      }
      if (this.disposed) {
        return undefined;
      }
      return setCommandContext(this.vscode, ACTIVATED_CONTEXT, true);
    };
    timeout = this.setTimeout(callback, 1000);
    if (!fired && timeout !== undefined) {
      this.activationTimers.add(timeout);
    }
    if (timeout && typeof timeout.unref === "function") {
      timeout.unref();
    }
  }

  shouldRefresh(fileUri) {
    if (
      this.disposed
      || !fileUri
      || !fileUri.fsPath
      || !SPEC_EXTENSIONS.has(this.pathModule.extname(fileUri.fsPath))
    ) {
      return false;
    }
    const entry = this.gaugeWorkspace.getClientsMap().get(fileUri.fsPath);
    return Boolean(
      entry
      && entry.project
      && typeof entry.project.root === "function"
      && entry.project.root() === this.activeFolder,
    );
  }

  registerRefreshListeners() {
    const refreshMethod = (fileUri) => {
      if (this.shouldRefresh(fileUri)) {
        this.refresh();
      }
    };
    const workspace = this.vscode.workspace;
    addDisposable(this.disposables, workspace.onDidSaveTextDocument((document) => {
      refreshMethod(document.uri);
    }));
    addDisposable(this.disposables, workspace.onDidCloseTextDocument((document) => {
      refreshMethod(document.uri);
    }));

    const watcher = workspace.createFileSystemWatcher("**/*.{spec,md}", false, true, false);
    addDisposable(this.disposables, watcher);
    addDisposable(this.disposables, watcher.onDidCreate(refreshMethod));
    addDisposable(this.disposables, watcher.onDidDelete(refreshMethod));
  }

  registerCommands() {
    const registerCommand = this.vscode.commands.registerCommand.bind(this.vscode.commands);
    addDisposable(this.disposables, registerCommand(
      "gauge.specexplorer.switchProject",
      () => this.gaugeWorkspace.showProjectOptions((projectPath) => this.changeClient(projectPath)),
    ));
    addDisposable(this.disposables, registerCommand(
      "gauge.specexplorer.runAllActiveProjectSpecs",
      () => this.runAllActiveProjectSpecs(),
    ));
    addDisposable(this.disposables, registerCommand(
      "gauge.specexplorer.runNode",
      (node) => this.runNode(node, false),
    ));
    addDisposable(this.disposables, registerCommand(
      "gauge.specexplorer.debugNode",
      (node) => this.runNode(node, true),
    ));
    addDisposable(this.disposables, registerCommand(
      OPEN_COMMAND,
      (node) => this.openNode(node),
    ));
  }

  registerProjectChangeListener() {
    if (typeof this.gaugeWorkspace.onDidChangeProjects !== "function") {
      return;
    }
    addDisposable(
      this.disposables,
      this.gaugeWorkspace.onDidChangeProjects((projectPath) => this.changeClient(projectPath)),
    );
  }

  runAllActiveProjectSpecs() {
    if (this.disposed || !this.executionController) {
      return undefined;
    }
    return this.executionController.handleCommand(
      "gauge.specexplorer.runAllActiveProjectSpecs",
      { projectRoot: this.activeFolder },
    );
  }

  runNode(node, debug) {
    if (this.disposed || !this.executionController) {
      return undefined;
    }
    return this.executionController.handleCommand(
      debug ? "gauge.specexplorer.debugNode" : "gauge.specexplorer.runNode",
      node,
    );
  }

  openNode(node) {
    if (this.disposed || !node) {
      return Promise.resolve(undefined);
    }
    return this.vscode.workspace.openTextDocument(node.file)
      .then((document) => this.vscode.window.showTextDocument(
        document,
        this.showDocumentOptions(node),
      ));
  }

  showDocumentOptions(node) {
    if (node instanceof Scenario) {
      return { selection: createRange(this.vscode, node.lineNo - 1) };
    }
    if (node instanceof Spec) {
      return { selection: createRange(this.vscode, 0) };
    }
    return undefined;
  }
}

module.exports = {
  GaugeNode,
  Scenario,
  Spec,
  SpecNodeProvider,
};
