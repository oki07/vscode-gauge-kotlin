"use strict";

const nodeFs = require("node:fs");
const nodeOs = require("node:os");
const nodePath = require("node:path");
const { GaugeConfig, envWithGaugeHome } = require("./config/gaugeConfig");
const { GaugeJavaProjectConfig } = require("./config/gaugeProjectConfig");
const { GaugeClients } = require("./gaugeClients");
const { GaugeWorkspaceFeature } = require("./gaugeWorkspaceFeature");
const { MavenProject } = require("./project/mavenProject");
const { createProjectFactory } = require("./project/projectFactory");
const { GaugeStepDefinitionProvider } = require("./stepDefinitionProvider");

const GAUGE_MULTI_PROJECT_CONTEXT = "gauge:multipleProjects?";
const GAUGE_LAUNCH_CONFIG = "gauge.launch";
const CODE_LENS_METHOD = "textDocument/codeLens";
const DEBUG_LOG_LEVEL_CONFIG = "enableDebugLogs";
const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const JAVA_RUNNER = "java";
const KOTLIN_RUNNER = "kotlin";
const MARKDOWN_LANGUAGE = "markdown";
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const SPEC_FILE_PATTERN = /\.spec$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const ACTIVE_DOCUMENT_LANGUAGES = new Set([GAUGE_LANGUAGE, GAUGE_CONCEPT_LANGUAGE, KOTLIN_RUNNER, JAVA_RUNNER]);
const RELOAD_WINDOW_COMMAND = "workbench.action.reloadWindow";
const RESTART_MESSAGE = "Gauge Language Server configuration changed, please restart VS Code.";
const RESTART_ACTION = "Restart Now";
const EXTERNAL_IMPLEMENTATION_SOURCE_ERROR =
  "implementation source not found: Step implementation referred from an external project or library";
const NESTED_PROJECT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".gradle",
  ".hg",
  ".svn",
  ".vscode",
  "build",
  "dist",
  "node_modules",
  "out",
  "target",
]);

function getVscode(vscode) {
  return vscode || require("vscode");
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function isActiveGaugeWorkspaceDocument(document) {
  if (!document) {
    return false;
  }
  if (ACTIVE_DOCUMENT_LANGUAGES.has(document.languageId)) {
    return true;
  }
  const file = documentPath(document);
  if (SPEC_FILE_PATTERN.test(file) || CONCEPT_FILE_PATTERN.test(file)) {
    return true;
  }
  return document.languageId === MARKDOWN_LANGUAGE
    && MARKDOWN_SPEC_FILE_PATTERN.test(file);
}

function getLanguageClientModule(options) {
  if (options.LanguageClient) {
    return {
      LanguageClient: options.LanguageClient,
      RevealOutputChannelOn: options.RevealOutputChannelOn,
      ShowMessageNotification: options.ShowMessageNotification,
      MessageType: options.MessageType,
      ErrorAction: options.ErrorAction,
      CloseAction: options.CloseAction,
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
    dependencyStepIndex: options.dependencyStepIndex,
    projectFactory: options.projectFactory,
    vscode: options.vscode,
  });
  return {
    provideCodeLenses() {
      return [];
    },
    async provideDefinition(document, position, token, next) {
      let localDefinitions;
      try {
        localDefinitions = await localDefinitionProvider.provideDefinition(document, position, token);
        if (
          Array.isArray(localDefinitions)
            ? localDefinitions.length > 0
            : Boolean(localDefinitions)
        ) {
          return options.localDefinitionOwnedExternally ? [] : localDefinitions;
        }
      } catch (_localError) {
        localDefinitions = undefined;
      }
      try {
        return await next(document, position, token);
      } catch (error) {
        if (isExternalImplementationSourceError(error)) {
          return localDefinitions || [];
        }
        throw error;
      }
    },
  };
}

function clearLspCodeLensFeature(languageClient) {
  if (!languageClient || typeof languageClient.getFeature !== "function") {
    return;
  }
  const feature = languageClient.getFeature(CODE_LENS_METHOD);
  if (feature && typeof feature.clear === "function") {
    feature.clear();
  }
}

function isInside(root, filename, pathModule) {
  const relative = pathModule.relative(root, filename);
  return relative === "" || (!relative.startsWith("..") && !pathModule.isAbsolute(relative));
}

function errorMessage(error) {
  if (!error) {
    return "";
  }
  if (typeof error.message === "string" && error.message) {
    return error.message;
  }
  return String(error);
}

class GaugeWorkspace {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.pathModule = options.pathModule || nodePath;
    this.fileSystem = options.fileSystem || nodeFs;
    this.cli = options.cli;
    this.dependencyStepIndex = options.dependencyStepIndex;
    this.localDefinitionOwnedExternally = options.localDefinitionOwnedExternally === true;
    this.stepDefinitionProvider = options.stepDefinitionProvider;
    this.clientsMap = options.clientsMap || new GaugeClients();
    this.clientLanguageMap = new Map();
    this.env = envWithGaugeHome(options.env || process.env, {
      vscode: this.vscode,
      gaugeHome: options.gaugeHome,
    });
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
    this.ErrorAction = languageClientModule.ErrorAction || { Continue: 1 };
    this.CloseAction = languageClientModule.CloseAction || { DoNotRestart: 1 };
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
    const stopPromises = [];
    for (const [projectRoot, projectClient] of this.clientsMap.entries()) {
      this.clientsMap.delete(projectRoot);
      this.clientLanguageMap.delete(projectRoot);
      if (projectClient.client && typeof projectClient.client.stop === "function") {
        stopPromises.push(Promise.resolve(projectClient.client.stop()).catch(() => undefined));
      }
    }
    if (this.outputChannel && typeof this.outputChannel.dispose === "function") {
      this.outputChannel.dispose();
    }
    return Promise.all(stopPromises).then(() => undefined);
  }

  async startWorkspaceProjects() {
    const folders = this.vscode.workspace.workspaceFolders || [];
    for (const folder of folders) {
      await this.startServersForWorkspaceFolder(folder.uri.fsPath);
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

  projectRootsKey() {
    return [...this.clientsMap.keys()].sort((left, right) => (left > right ? 1 : -1)).join("\n");
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
      || !isActiveGaugeWorkspaceDocument(activeEditor.document)
    ) {
      return undefined;
    }
    return this.startServerForSpecFile(documentPath(activeEditor.document));
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
    const beforeProjectRoots = this.projectRootsKey();
    for (const folder of added) {
      await this.startServersForWorkspaceFolder(folder.uri.fsPath);
    }
    for (const folder of removed) {
      await this.stopServersForWorkspaceFolder(folder.uri.fsPath);
    }
    await this.setMultiProjectContext();
    if (this.projectRootsKey() !== beforeProjectRoots) {
      await this.notifyProjectsChanged();
    }
  }

  isDirectory(filename) {
    if (!this.fileSystem || typeof this.fileSystem.statSync !== "function") {
      return false;
    }
    try {
      const stat = this.fileSystem.statSync(filename);
      return Boolean(stat && typeof stat.isDirectory === "function" && stat.isDirectory());
    } catch (_error) {
      return false;
    }
  }

  directoryEntries(dirname) {
    if (!this.fileSystem || typeof this.fileSystem.readdirSync !== "function") {
      return [];
    }
    try {
      return this.fileSystem.readdirSync(dirname)
        .map((entry) => (typeof entry === "string" ? entry : entry.name))
        .filter(Boolean)
        .sort();
    } catch (_error) {
      return [];
    }
  }

  discoverGaugeProjectRoots(workspaceRoot) {
    if (typeof this.projectFactory.findGaugeProjectRoots === "function") {
      return this.projectFactory.findGaugeProjectRoots(workspaceRoot);
    }
    if (!this.isDirectory(workspaceRoot)) {
      return this.projectFactory.isGaugeProject(workspaceRoot) ? [workspaceRoot] : [];
    }

    const roots = this.projectFactory.isGaugeProject(workspaceRoot) ? [workspaceRoot] : [];
    const pending = [workspaceRoot];
    const seen = new Set();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || seen.has(current)) {
        continue;
      }
      seen.add(current);
      for (const entry of this.directoryEntries(current)) {
        if (NESTED_PROJECT_EXCLUDED_DIRECTORIES.has(entry)) {
          continue;
        }
        const child = this.pathModule.join(current, entry);
        if (!this.isDirectory(child)) {
          continue;
        }
        if (this.projectFactory.isGaugeProject(child)) {
          roots.push(child);
        }
        pending.push(child);
      }
    }
    return roots.sort();
  }

  async startServersForWorkspaceFolder(workspaceRoot) {
    for (const projectRoot of this.discoverGaugeProjectRoots(workspaceRoot)) {
      await this.startServerFor(projectRoot);
    }
  }

  async stopServersForWorkspaceFolder(workspaceRoot) {
    for (const projectRoot of [...this.clientsMap.keys()]) {
      if (isInside(workspaceRoot, projectRoot, this.pathModule)) {
        await this.stopServerFor(projectRoot);
      }
    }
  }

  async stopServerFor(folder) {
    const projectClient = this.clientsMap.get(folder);
    if (!projectClient) {
      return;
    }
    const projectRoot = projectClient.project.root();
    this.clientsMap.delete(projectRoot);
    this.clientLanguageMap.delete(projectRoot);
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

    const env = {
      ...minimalEnv(project, this.cli, this.env),
      gauge_lsp_reference_codelens: "false",
    };

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
      { scheme: "file", language: GAUGE_LANGUAGE, pattern: `${project.root()}/**/*` },
      { scheme: "file", language: GAUGE_CONCEPT_LANGUAGE, pattern: `${project.root()}/**/*` },
      { scheme: "file", pattern: `${project.root()}/**/*.spec` },
      { scheme: "file", pattern: `${project.root()}/**/*.cpt` },
      { scheme: "file", language: MARKDOWN_LANGUAGE, pattern: `${project.root()}/**/*.md` },
    ];
    if (project.language() === KOTLIN_RUNNER) {
      documentSelector.push({ scheme: "file", language: KOTLIN_RUNNER, pattern: `${project.root()}/**/*` });
      documentSelector.push({ scheme: "file", pattern: `${project.root()}/**/*.kt` });
      documentSelector.push({ scheme: "file", language: JAVA_RUNNER, pattern: `${project.root()}/**/*` });
      documentSelector.push({ scheme: "file", pattern: `${project.root()}/**/*.java` });
    }
    if (project.language() === JAVA_RUNNER) {
      documentSelector.push({ scheme: "file", language: JAVA_RUNNER, pattern: `${project.root()}/**/*` });
      documentSelector.push({ scheme: "file", pattern: `${project.root()}/**/*.java` });
    }
    return {
      documentSelector,
      diagnosticCollectionName: "gauge",
      outputChannel: this.outputChannel,
      revealOutputChannelOn: this.revealOutputChannelOnNever,
      middleware: clientMiddleware({
        dependencyStepIndex: this.dependencyStepIndex,
        localDefinitionOwnedExternally: this.localDefinitionOwnedExternally,
        projectFactory: this.projectFactory,
        stepDefinitionProvider: this.stepDefinitionProvider,
        vscode: this.vscode,
      }),
      synchronize: {
        configurationSection: "gauge",
      },
      errorHandler: {
        error: (error) => {
          this.showLanguageServerRuntimeError(project, error);
          return { action: this.ErrorAction.Continue };
        },
        closed: () => {
          this.showLanguageServerClosedError(project);
          return { action: this.CloseAction.DoNotRestart };
        },
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

    const javaConfigGenerated = this.generateJavaConfig(project);
    const serverOptions = this.serverOptionsFor(project);
    const languageClient = new this.LanguageClient(
      "gauge",
      "Gauge",
      serverOptions,
      this.clientOptionsFor(project, folder),
    );
    this.clientsMap.set(project.root(), { project, client: languageClient });
    try {
      await this.installRunnerFor(project);
      if (!javaConfigGenerated && this.generateJavaConfig(project)) {
        const refreshedServerOptions = this.serverOptionsFor(project);
        serverOptions.command = refreshedServerOptions.command;
        serverOptions.args = refreshedServerOptions.args;
        serverOptions.options = refreshedServerOptions.options;
      }
      this.registerDynamicFeatures(languageClient);
      await languageClient.start();
      clearLspCodeLensFeature(languageClient);
    } catch (error) {
      this.clientsMap.delete(project.root());
      this.clientLanguageMap.delete(project.root());
      await this.showLanguageServerStartupError(project, error);
      return undefined;
    }
    this.registerServerMessageFilter(languageClient);
    await this.setLanguageId(languageClient, project.root());
    return languageClient;
  }

  async showLanguageServerStartupError(project, error) {
    const window = this.vscode.window || {};
    if (typeof window.showErrorMessage !== "function") {
      return undefined;
    }
    const detail = errorMessage(error);
    const suffix = detail ? ` ${detail}` : "";
    return window.showErrorMessage(`Unable to start Gauge language server for ${project.root()}.${suffix}`);
  }

  showLanguageServerRuntimeError(project, error) {
    const window = this.vscode.window || {};
    if (typeof window.showErrorMessage !== "function") {
      return undefined;
    }
    const detail = errorMessage(error);
    const suffix = detail ? ` ${detail}` : "";
    return window.showErrorMessage(`Gauge language server for ${project.root()} failed.${suffix}`);
  }

  showLanguageServerClosedError(project) {
    const window = this.vscode.window || {};
    if (typeof window.showErrorMessage !== "function") {
      return undefined;
    }
    return window.showErrorMessage(`Gauge language server for ${project.root()} stopped unexpectedly.`);
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
      return false;
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
    return true;
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
  clientMiddleware,
};
