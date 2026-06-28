"use strict";

const nodePath = require("node:path");

const ACTIVATED_CONTEXT = "gauge:activated";
const OPEN_COMMAND = "gauge.open";
const SCENARIOS_REQUEST = "gauge/scenarios";
const SPEC_EXPLORER_VIEW = "gauge:specExplorer";
const SPECS_REQUEST = "gauge/specs";
const SPEC_EXTENSIONS = new Set([".spec", ".md"]);
const TEST_UI_RUN_FLAGS = {
  "hide-suggestion": true,
  "machine-readable": true,
};

function getVscode(vscodeApi) {
  return vscodeApi || require("vscode");
}

function createToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
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

function specFileFromExecutionIdentifier(executionIdentifier, lineNo) {
  return executionIdentifier.split(`:${lineNo}`)[0];
}

function testUiRunFlags() {
  return { ...TEST_UI_RUN_FLAGS };
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
    this.disposables = [];
    this.activeFolder = undefined;
    this.languageClient = undefined;
    this.activation = Promise.resolve(undefined);
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
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    if (this.onDidChangeTreeDataEmitter && typeof this.onDidChangeTreeDataEmitter.dispose === "function") {
      this.onDidChangeTreeDataEmitter.dispose();
    }
  }

  refresh(element) {
    this.onDidChangeTreeDataEmitter.fire(element);
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
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
    const values = await this.languageClient.sendRequest(
      SPECS_REQUEST,
      {},
      createToken(this.vscode),
    );
    return (values || [])
      .filter((entry) => entry && entry.heading)
      .map((entry) => new Spec(entry.heading, entry.executionIdentifier, this.vscode));
  }

  async getScenarios(spec) {
    const values = await this.languageClient.sendRequest(
      SCENARIOS_REQUEST,
      {
        textDocument: { uri: spec.file },
        position: createPosition(this.vscode, 1, 1),
      },
      createToken(this.vscode),
    );
    return (values || []).map((entry) => new Scenario(
      entry.heading,
      specFileFromExecutionIdentifier(entry.executionIdentifier, entry.lineNo),
      entry.lineNo,
      this.vscode,
    ));
  }

  changeClient(projectPath) {
    setCommandContext(this.vscode, ACTIVATED_CONTEXT, false);
    if (!isSpecExplorerEnabled(this.vscode)) {
      return undefined;
    }
    this.activation = this.activateTreeDataProvider(projectPath);
    return this.activation;
  }

  activateTreeDataProvider(projectPath) {
    if (!projectPath) {
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
        this.languageClient = entry.client;
        this.activeFolder = projectPath;
        this.refresh();
        const timeout = this.setTimeout(
          () => setCommandContext(this.vscode, ACTIVATED_CONTEXT, true),
          1000,
        );
        if (timeout && typeof timeout.unref === "function") {
          timeout.unref();
        }
        return undefined;
      })
      .catch((reason) => this.vscode.window.showErrorMessage(
        "Failed to create test explorer.",
        reason,
      ));
  }

  shouldRefresh(fileUri) {
    if (!fileUri || !fileUri.fsPath || !SPEC_EXTENSIONS.has(this.pathModule.extname(fileUri.fsPath))) {
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

    const watcher = workspace.createFileSystemWatcher("**/*.{spec,md}", true, false, true);
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
    if (!this.executionController) {
      return undefined;
    }
    return this.executionController.handleCommand(
      "gauge.specexplorer.runAllActiveProjectSpecs",
      { projectRoot: this.activeFolder },
      testUiRunFlags(),
    );
  }

  runNode(node, debug) {
    if (!this.executionController) {
      return undefined;
    }
    return this.executionController.handleCommand(
      debug ? "gauge.specexplorer.debugNode" : "gauge.specexplorer.runNode",
      node,
      testUiRunFlags(),
    );
  }

  openNode(node) {
    if (!node) {
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
