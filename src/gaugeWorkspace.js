"use strict";

const nodeOs = require("node:os");
const nodePath = require("node:path");
const { GaugeConfig } = require("./config/gaugeConfig");
const { GaugeJavaProjectConfig } = require("./config/gaugeProjectConfig");
const { GaugeClients } = require("./gaugeClients");
const { GaugeWorkspaceFeature } = require("./gaugeWorkspaceFeature");
const { MavenProject } = require("./project/mavenProject");
const { createProjectFactory } = require("./project/projectFactory");
const { GaugeStepDefinitionProvider } = require("./stepDefinitionProvider");

const GAUGE_MULTI_PROJECT_CONTEXT = "gauge:multipleProjects?";
const GAUGE_LAUNCH_CONFIG = "gauge.launch";
const GAUGE_CODELENS_CONFIG = "gauge.codeLenses";
const DEBUG_LOG_LEVEL_CONFIG = "enableDebugLogs";
const REFERENCE_CONFIG = "reference";
const JAVA_RUNNER = "java";
const KOTLIN_RUNNER = "kotlin";
const ACTIVE_DOCUMENT_LANGUAGES = new Set(["gauge", KOTLIN_RUNNER]);
const RELOAD_WINDOW_COMMAND = "workbench.action.reloadWindow";
const RESTART_MESSAGE = "Gauge Language Server configuration changed, please restart VS Code.";
const RESTART_ACTION = "Restart Now";
const EXTERNAL_IMPLEMENTATION_SOURCE_ERROR =
  "implementation source not found: Step implementation referred from an external project or library";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function getLanguageClientModule(options) {
  if (options.LanguageClient) {
    return {
      LanguageClient: options.LanguageClient,
      RevealOutputChannelOn: options.RevealOutputChannelOn,
      ShowMessageNotification: options.ShowMessageNotification,
      MessageType: options.MessageType,
    };
  }
  return require("vscode-languageclient/node");
}

function createToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
}

function stateOrMemory(state) {
  if (state) {
    return state;
  }
  let reportPath;
  return {
    setReportPath(nextReportPath) {
      reportPath = nextReportPath;
    },
    getReportPath() {
      return reportPath;
    },
  };
}

function minimalEnv(project, cli, baseEnv) {
  const env = {
    ...baseEnv,
    GAUGE_IGNORE_RUNNER_BUILD_FAILURES: "true",
  };
  return {
    ...env,
    ...(project.envs(cli) || {}),
  };
}

function isExternalImplementationSourceError(error) {
  return errorMessages(error).some((message) => message.includes(EXTERNAL_IMPLEMENTATION_SOURCE_ERROR));
}

function errorMessages(error, seen = new Set()) {
  if (error == null) {
    return [];
  }
  if (typeof error === "string") {
    return [error];
  }
  if (typeof error !== "object") {
    return [String(error)];
  }
  if (seen.has(error)) {
    return [];
  }
  seen.add(error);

  const messages = [];
  for (const key of ["message", "data", "error", "reason", "response"]) {
    if (Object.prototype.hasOwnProperty.call(error, key)) {
      messages.push(...errorMessages(error[key], seen));
    }
  }
  return messages;
}

function clientMiddleware(options = {}) {
  const localDefinitionProvider = options.stepDefinitionProvider || new GaugeStepDefinitionProvider({
    projectFactory: options.projectFactory,
    vscode: options.vscode,
  });
  return {
    async provideDefinition(document, position, token, next) {
      try {
        return await next(document, position, token);
      } catch (error) {
        if (isExternalImplementationSourceError(error)) {
          try {
            return await localDefinitionProvider.provideDefinition(document, position, token);
          } catch (_fallbackError) {
            return [];
          }
        }
        throw error;
      }
    },
  };
}

class GaugeWorkspace {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.pathModule = options.pathModule || nodePath;
    this.cli = options.cli;
    this.clientsMap = options.clientsMap || new GaugeClients();
    this.clientLanguageMap = new Map();
    this.env = options.env || process.env;
    this.state = stateOrMemory(options.state);
    this.GaugeWorkspaceFeature = options.GaugeWorkspaceFeature || GaugeWorkspaceFeature;
    this.JavaProjectConfig = options.JavaProjectConfig || GaugeJavaProjectConfig;
    this.platform = options.platform || nodeOs.platform;
    this.gaugeConfigFactory = options.gaugeConfigFactory || (
      (platformName) => new GaugeConfig(platformName, {
        env: this.env,
        pathModule: this.pathModule,
      })
    );
    const languageClientModule = getLanguageClientModule(options);
    this.LanguageClient = languageClientModule.LanguageClient;
    this.revealOutputChannelOnNever = languageClientModule.RevealOutputChannelOn
      ? languageClientModule.RevealOutputChannelOn.Never
      : "never";
    this.ShowMessageNotification = languageClientModule.ShowMessageNotification;
    this.MessageType = languageClientModule.MessageType;
    this.projectFactory = options.projectFactory || createProjectFactory({
      execSync: options.execSync,
      fileSystem: options.fileSystem,
      pathModule: this.pathModule,
      vscode: this.vscode,
    });
    this.disposables = [];
    this.projectChangeListeners = new Set();
    this.outputChannel = this.vscode.window.createOutputChannel("gauge");
    this.launchConfig = this.getWorkspaceConfiguration(GAUGE_LAUNCH_CONFIG);
    this.registerActiveEditorChanges();
    this.registerWorkspaceFolderChanges();
    this.registerConfigurationChanges();
    this.startup = this.startWorkspaceProjects();
  }

  ready() {
    return this.startup;
  }

  dispose() {
    for (const disposable of this.disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
  }

  async startWorkspaceProjects() {
    const folders = this.vscode.workspace.workspaceFolders || [];
    for (const folder of folders) {
      await this.startServerFor(folder.uri.fsPath);
    }
    await this.startServerForActiveGaugeDocument();
    await this.setMultiProjectContext();
  }

  setReportPath(reportPath) {
    this.state.setReportPath(reportPath.trim());
  }

  getReportPath() {
    return this.state.getReportPath();
  }

  getClientsMap() {
    return this.clientsMap;
  }

  getClientLanguageMap() {
    return this.clientLanguageMap;
  }

  getDefaultFolder() {
    return [...this.clientsMap.keys()].sort((left, right) => (left > right ? 1 : -1))[0];
  }

  onDidChangeProjects(listener) {
    this.projectChangeListeners.add(listener);
    return {
      dispose: () => this.projectChangeListeners.delete(listener),
    };
  }

  async notifyProjectsChanged() {
    const defaultFolder = this.getDefaultFolder();
    await Promise.all([...this.projectChangeListeners].map((listener) => listener(defaultFolder)));
  }

  async showProjectOptions(onChange) {
    const projectItems = [...this.clientsMap.keys()]
      .sort((left, right) => (left > right ? 1 : -1))
      .map((projectRoot) => ({
        label: this.pathModule.basename(projectRoot),
        description: projectRoot,
      }));
    try {
      const selected = await this.vscode.window.showQuickPick(projectItems, {
        canPickMany: false,
        placeHolder: "Choose a project",
      });
      if (!selected) {
        return undefined;
      }
      return onChange(selected.description);
    } catch (error) {
      return this.vscode.window.showErrorMessage("Unable to select project.", error);
    }
  }

  async setMultiProjectContext() {
    if (this.vscode.commands && typeof this.vscode.commands.executeCommand === "function") {
      await this.vscode.commands.executeCommand(
        "setContext",
        GAUGE_MULTI_PROJECT_CONTEXT,
        this.clientsMap.size > 1,
      );
    }
  }

  getWorkspaceConfiguration(section) {
    if (!this.vscode.workspace || typeof this.vscode.workspace.getConfiguration !== "function") {
      return undefined;
    }
    return this.vscode.workspace.getConfiguration(section);
  }

  registerWorkspaceFolderChanges() {
    if (!this.vscode.workspace || typeof this.vscode.workspace.onDidChangeWorkspaceFolders !== "function") {
      return;
    }
    const disposable = this.vscode.workspace.onDidChangeWorkspaceFolders(
      (event) => this.onWorkspaceFoldersChanged(event),
    );
    if (disposable) {
      this.disposables.push(disposable);
    }
  }

  registerActiveEditorChanges() {
    if (!this.vscode.window || typeof this.vscode.window.onDidChangeActiveTextEditor !== "function") {
      return;
    }
    const disposable = this.vscode.window.onDidChangeActiveTextEditor(
      (editor) => this.startServerForActiveGaugeDocument(editor),
    );
    if (disposable) {
      this.disposables.push(disposable);
    }
  }

  registerConfigurationChanges() {
    if (!this.vscode.workspace || typeof this.vscode.workspace.onDidChangeConfiguration !== "function") {
      return;
    }
    const disposable = this.vscode.workspace.onDidChangeConfiguration(
      () => this.onConfigurationChanged(),
    );
    if (disposable) {
      this.disposables.push(disposable);
    }
  }

  onConfigurationChanged() {
    const newLaunchConfig = this.getWorkspaceConfiguration(GAUGE_LAUNCH_CONFIG);
    const oldDebugLogs = this.launchConfig && this.launchConfig.get(DEBUG_LOG_LEVEL_CONFIG);
    const newDebugLogs = newLaunchConfig && newLaunchConfig.get(DEBUG_LOG_LEVEL_CONFIG);
    this.launchConfig = newLaunchConfig;
    if (oldDebugLogs === newDebugLogs) {
      return undefined;
    }
    return this.vscode.window.showWarningMessage(RESTART_MESSAGE, RESTART_ACTION)
      .then((selection) => {
        if (selection === RESTART_ACTION) {
          return this.vscode.commands.executeCommand(RELOAD_WINDOW_COMMAND);
        }
        return undefined;
      });
  }

  async startServerForActiveGaugeDocument(editor) {
    const activeEditor = editor || (this.vscode.window && this.vscode.window.activeTextEditor);
    if (
      !activeEditor
      || !activeEditor.document
      || !ACTIVE_DOCUMENT_LANGUAGES.has(activeEditor.document.languageId)
    ) {
      return undefined;
    }
    return this.startServerForSpecFile(activeEditor.document.uri.fsPath);
  }

  async startServerForSpecFile(file) {
    let projectRoot;
    try {
      projectRoot = this.projectFactory.getGaugeRootFromFilePath(file);
    } catch (error) {
      return undefined;
    }
    return this.startServerFor(projectRoot);
  }

  async onWorkspaceFoldersChanged(event) {
    const added = event && event.added ? event.added : [];
    const removed = event && event.removed ? event.removed : [];
    for (const folder of added) {
      await this.startServerFor(folder.uri.fsPath);
    }
    for (const folder of removed) {
      await this.stopServerFor(folder.uri.fsPath);
    }
    await this.setMultiProjectContext();
    if (removed.length > 0) {
      await this.notifyProjectsChanged();
    }
  }

  async stopServerFor(folder) {
    const projectClient = this.clientsMap.get(folder);
    if (!projectClient) {
      return;
    }
    this.clientsMap.delete(projectClient.project.root());
    if (projectClient.client && typeof projectClient.client.stop === "function") {
      await projectClient.client.stop();
    }
  }

  serverOptionsFor(project) {
    const command = this.cli.gaugeCommand();
    const args = command.argsForSpawnType(["daemon", "--lsp", "--dir", project.root()]);
    const launchConfig = this.getWorkspaceConfiguration(GAUGE_LAUNCH_CONFIG);
    this.launchConfig = launchConfig;
    if (launchConfig && launchConfig.get(DEBUG_LOG_LEVEL_CONFIG)) {
      args.push("-l", "debug");
    }

    const env = minimalEnv(project, this.cli, this.env);
    const codeLensConfig = this.vscode.workspace.getConfiguration(GAUGE_CODELENS_CONFIG);
    if (codeLensConfig && codeLensConfig.has(REFERENCE_CONFIG) && !codeLensConfig.get(REFERENCE_CONFIG)) {
      env.gauge_lsp_reference_codelens = "false";
    }

    return {
      command: command.command,
      args,
      options: {
        env,
        ...command.defaultSpawnOptions,
      },
    };
  }

  clientOptionsFor(project, folder) {
    const documentSelector = [
      { scheme: "file", language: "gauge", pattern: `${project.root()}/**/*` },
    ];
    if (project.language() === KOTLIN_RUNNER) {
      documentSelector.push({ scheme: "file", language: KOTLIN_RUNNER, pattern: `${project.root()}/**/*` });
      documentSelector.push({ scheme: "file", pattern: `${project.root()}/**/*.kt` });
    }
    return {
      documentSelector,
      diagnosticCollectionName: "gauge",
      outputChannel: this.outputChannel,
      revealOutputChannelOn: this.revealOutputChannelOnNever,
      middleware: clientMiddleware({
        projectFactory: this.projectFactory,
        vscode: this.vscode,
      }),
      synchronize: {
        configurationSection: "gauge",
      },
      workspaceFolder: this.vscode.workspace.getWorkspaceFolder(this.vscode.Uri.file(folder)),
    };
  }

  async startServerFor(folder) {
    if (!this.projectFactory.isGaugeProject(folder)) {
      return undefined;
    }
    const project = this.projectFactory.get(folder);
    if (this.clientsMap.has(project.root())) {
      return this.clientsMap.get(project.root()).client;
    }

    await this.installRunnerFor(project);
    this.generateJavaConfig(project);
    const languageClient = new this.LanguageClient(
      "gauge",
      "Gauge",
      this.serverOptionsFor(project),
      this.clientOptionsFor(project, folder),
    );
    this.clientsMap.set(project.root(), { project, client: languageClient });
    this.registerDynamicFeatures(languageClient);
    await languageClient.start();
    this.registerServerMessageFilter(languageClient);
    await this.setLanguageId(languageClient, project.root());
    return languageClient;
  }

  registerServerMessageFilter(languageClient) {
    if (typeof languageClient.onNotification !== "function" || !this.ShowMessageNotification) {
      return;
    }
    languageClient.onNotification(this.ShowMessageNotification.type, (params) => {
      // The Gauge runner statically scans only Java sources, so every Kotlin
      // @Step is reported as external and the Gauge LSP raises this error for
      // valid step-to-implementation navigation, including from .cpt concept
      // steps. The local Kotlin definition provider resolves those steps, so
      // suppress only this misleading server popup and forward everything else.
      if (isExternalImplementationSourceError(params)) {
        return;
      }
      this.showServerMessage(params);
    });
  }

  showServerMessage(params) {
    if (!params || typeof params.message !== "string") {
      return;
    }
    const window = this.vscode.window || {};
    const messageType = this.MessageType || {};
    if (params.type === messageType.Error && typeof window.showErrorMessage === "function") {
      window.showErrorMessage(params.message);
      return;
    }
    if (params.type === messageType.Warning && typeof window.showWarningMessage === "function") {
      window.showWarningMessage(params.message);
      return;
    }
    if (typeof window.showInformationMessage === "function") {
      window.showInformationMessage(params.message);
    }
  }

  registerDynamicFeatures(languageClient) {
    if (typeof languageClient.registerFeatures !== "function") {
      return;
    }
    languageClient.registerFeatures([
      new this.GaugeWorkspaceFeature(languageClient, { vscode: this.vscode }),
    ]);
  }

  generateJavaConfig(project) {
    if (!project.isProjectLanguage(JAVA_RUNNER) || !this.cli.isPluginInstalled(JAVA_RUNNER)) {
      return;
    }
    if (!(project instanceof MavenProject)) {
      const gaugeConfig = this.gaugeConfigFactory(this.platform());
      new this.JavaProjectConfig(
        project.root(),
        this.cli.getGaugePluginVersion(JAVA_RUNNER),
        gaugeConfig,
      ).generate();
    }
    this.env.SHOULD_BUILD_PROJECT = "false";
  }

  async installRunnerFor(project) {
    const language = project.language();
    if (!language || this.cli.isPluginInstalled(language)) {
      return undefined;
    }
    const message = `The project ${this.pathModule.basename(project.root())} requires gauge ${language} to be installed. Would you like to install it?`;
    const action = await this.vscode.window.showErrorMessage(message, { modal: true }, "Yes", "No");
    if (action === "Yes") {
      return this.cli.installGaugeRunner(language, { vscode: this.vscode });
    }
    return undefined;
  }

  async setLanguageId(languageClient, projectRoot) {
    try {
      const language = await languageClient.sendRequest("gauge/getRunnerLanguage", createToken(this.vscode));
      this.clientLanguageMap.set(projectRoot, language);
    } catch (_error) {
      return undefined;
    }
    return undefined;
  }
}

module.exports = {
  GaugeWorkspace,
};
