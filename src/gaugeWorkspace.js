"use strict";

const nodeFs = require("node:fs");
const nodeOs = require("node:os");
const nodePath = require("node:path");
const { concurrencyLimit, mapWithConcurrency } = require("./asyncWork");
const { GaugeConfig, envWithGaugeHome } = require("./config/gaugeConfig");
const { GaugeJavaProjectConfig } = require("./config/gaugeProjectConfig");
const { GaugeClients } = require("./gaugeClients");
const { GaugeWorkspaceFeature } = require("./gaugeWorkspaceFeature");
const { MavenProject } = require("./project/mavenProject");
const { createProjectFactory } = require("./project/projectFactory");
const { isLocalStepCodeActionDiagnostic } = require("./stepCodeActions");
const { GaugeStepDefinitionProvider } = require("./stepDefinitionProvider");
const { UNDEFINED_STEP_MESSAGE } = require("./stepDiagnostics");

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
const MISLEADING_JAVA_EXTENSION_HINT =
  " Install 'vscjava.vscode-java-pack' extension for code insights.";
const SHOW_MESSAGE_METHOD = "window/showMessage";
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
const DEFAULT_CLIENT_START_CONCURRENCY = 4;

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

function isLocalGaugeCompletionDocument(document) {
  if (!document) {
    return false;
  }
  if (document.languageId === GAUGE_LANGUAGE || document.languageId === GAUGE_CONCEPT_LANGUAGE) {
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

function isExternalImplementationSourceError(error) {
  return errorMessages(error).some((message) => message.includes(EXTERNAL_IMPLEMENTATION_SOURCE_ERROR));
}

// Gauge appends this hint to every runner startup failure based solely on the
// manifest language ("java"), not on the actual failure (see
// references/gauge/api/lang/runner.go). The Java extension pack cannot build
// Kotlin step implementations, so the hint misleads in this extension's
// projects; drop only that sentence and keep the rest of Gauge's message.
//
// Gauge reports a failed runner before it answers "initialize"
// (references/gauge/api/lang/server.go Start), so this runs as a connection
// message strategy: notification handlers are only attached once the handshake
// has completed and would never see that message.
function withoutMisleadingJavaExtensionHint(message) {
  if (!message
    || message.method !== SHOW_MESSAGE_METHOD
    || !message.params
    || typeof message.params.message !== "string"
    || !message.params.message.includes(MISLEADING_JAVA_EXTENSION_HINT)) {
    return message;
  }
  return {
    ...message,
    params: {
      ...message.params,
      message: message.params.message.split(MISLEADING_JAVA_EXTENSION_HINT).join(""),
    },
  };
}

function serverMessageStrategy() {
  return {
    handleMessage(message, next) {
      next(withoutMisleadingJavaExtensionHint(message));
    },
  };
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

const MISSING_IMPLEMENTATION_MESSAGE = "Step implementation not found";

function isMissingImplementationDiagnostic(diagnostic) {
  return Boolean(diagnostic)
    && typeof diagnostic.message === "string"
    && diagnostic.message.includes(MISSING_IMPLEMENTATION_MESSAGE);
}

// The Gauge Java runner builds its step registry once, from compiled classes,
// and cannot re-scan Kotlin sources afterwards. Its "Step implementation not
// found" verdicts therefore go stale for steps added or renamed after the
// language server started. The local source index is authoritative for those,
// so its positive answers override the runner while everything else passes
// through unchanged.
// The runner and the document store can spell the same file differently, and a
// miss here silently disables arbitration for that file. Comparing resolved
// paths cannot introduce a wrong match, unlike relaxing case.
function comparablePath(file) {
  const segments = String(file || "").replace(/\\/g, "/").split("/");
  const resolved = [];
  for (const segment of segments) {
    if (segment === "" && resolved.length > 0) {
      continue;
    }
    if (segment === ".") {
      continue;
    }
    if (segment === ".." && resolved.length > 0 && resolved[resolved.length - 1] !== "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join("/");
}

function diagnosticLine(diagnostic) {
  const start = diagnostic && diagnostic.range && diagnostic.range.start;
  return start ? start.line : undefined;
}

// The local provider reproduces Gauge's own parser messages verbatim, so a
// malformed spec would otherwise show two identical Problems rows for one
// mistake: one from the runner over LSP and one from this extension.
function isLocallyPublished(provider, document, diagnostic, message) {
  if (typeof provider.publishedDiagnosticLines !== "function") {
    return false;
  }
  const lines = provider.publishedDiagnosticLines(
    document,
    message === undefined ? diagnostic && diagnostic.message : message,
  );
  const line = diagnosticLine(diagnostic);
  return Boolean(lines && line !== undefined && lines.has(line));
}

function arbitratedDiagnostics(uri, diagnostics, options) {
  const provider = options.stepDiagnosticsProvider;
  const store = options.documentStore;
  if (
    !provider
    || typeof provider.stepImplementedAt !== "function"
    || !store
    || typeof store.documents !== "function"
    || !Array.isArray(diagnostics)
    || diagnostics.length === 0
  ) {
    return diagnostics;
  }
  const file = comparablePath((uri && (uri.fsPath || uri.path)) || "");
  const workspaceDocuments = store.documents();
  const document = workspaceDocuments.find(
    (candidate) => comparablePath(documentPath(candidate)) === file,
  );
  if (!document) {
    return diagnostics;
  }
  return diagnostics.filter((diagnostic) => {
    if (isLocallyPublished(provider, document, diagnostic)) {
      return false;
    }
    if (!isMissingImplementationDiagnostic(diagnostic)) {
      return true;
    }
    // The runner words the same verdict differently, so an exact message match
    // cannot catch this one.
    if (isLocallyPublished(provider, document, diagnostic, UNDEFINED_STEP_MESSAGE)) {
      return false;
    }
    const line = diagnosticLine(diagnostic);
    return provider.stepImplementedAt(document, line, workspaceDocuments) !== true;
  });
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
    provideCompletionItem(document, position, context, token, next) {
      if (isLocalGaugeCompletionDocument(document)) {
        return [];
      }
      return next(document, position, context, token);
    },
    provideCodeActions(document, range, context, token, next) {
      const diagnostics = context && Array.isArray(context.diagnostics)
        ? context.diagnostics
        : undefined;
      if (!diagnostics || !diagnostics.some(isLocalStepCodeActionDiagnostic)) {
        return next(document, range, context, token);
      }
      const remoteDiagnostics = diagnostics.filter(
        (diagnostic) => !isLocalStepCodeActionDiagnostic(diagnostic),
      );
      if (remoteDiagnostics.length === 0) {
        return [];
      }
      return next(document, range, { ...context, diagnostics: remoteDiagnostics }, token);
    },
    handleDiagnostics(uri, diagnostics, next) {
      next(uri, arbitratedDiagnostics(uri, diagnostics, options));
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
    this.projectEnvironmentService = options.projectEnvironmentService;
    this.clientStartConcurrency = concurrencyLimit(
      options.clientStartConcurrency,
      DEFAULT_CLIENT_START_CONCURRENCY,
    );
    this.localDefinitionOwnedExternally = options.localDefinitionOwnedExternally === true;
    this.stepDefinitionProvider = options.stepDefinitionProvider;
    this.stepDiagnosticsProvider = options.stepDiagnosticsProvider;
    this.documentStore = options.documentStore;
    this.clientsMap = options.clientsMap || new GaugeClients();
    this.clientLanguageMap = new Map();
    this.projectEnvironmentCache = new Map();
    this.pendingServerStarts = new Map();
    this.serverStartGenerations = new Map();
    this.workspaceFolderDiscoveryGenerations = new Map();
    this.stoppedLanguageClients = new WeakSet();
    this.disposed = false;
    this.disposalPromise = undefined;
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
    if (this.disposalPromise) {
      return this.disposalPromise;
    }
    let resolveDisposal;
    let rejectDisposal;
    this.disposalPromise = new Promise((resolve, reject) => {
      resolveDisposal = resolve;
      rejectDisposal = reject;
    });
    this.disposalPromise.catch(() => undefined);
    this.disposed = true;
    const pendingServerStartRoots = new Set(this.pendingServerStarts.keys());
    this.pendingServerStarts.clear();
    const cleanupErrors = [];
    const disposables = this.disposables;
    this.disposables = [];
    for (const disposable of disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        try {
          disposable.dispose();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    }
    this.projectChangeListeners.clear();
    const stopPromises = [];
    for (const [projectRoot, projectClient] of [...this.clientsMap.entries()]) {
      stopPromises.push(this.cleanupLanguageClient(
        projectRoot,
        projectClient.client,
        pendingServerStartRoots.has(projectRoot),
      ));
    }
    const outputChannel = this.outputChannel;
    this.outputChannel = undefined;
    if (outputChannel && typeof outputChannel.dispose === "function") {
      try {
        outputChannel.dispose();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    Promise.allSettled(stopPromises).then((results) => {
      const stopFailure = results.find((result) => result.status === "rejected");
      const error = cleanupErrors[0] || (stopFailure && stopFailure.reason);
      if (error) {
        rejectDisposal(error);
        return;
      }
      resolveDisposal(undefined);
    });
    return this.disposalPromise;
  }

  async startWorkspaceProjects() {
    const folders = this.vscode.workspace.workspaceFolders || [];
    const discoveredProjects = await mapWithConcurrency(
      folders,
      this.clientStartConcurrency,
      (folder) => this.discoverWorkspaceFolderProjects(folder.uri.fsPath),
    );
    const projectsByRoot = new Map();
    for (const project of discoveredProjects.flat()) {
      if (!projectsByRoot.has(project.projectRoot)) {
        projectsByRoot.set(project.projectRoot, []);
      }
      projectsByRoot.get(project.projectRoot).push(project);
    }
    await mapWithConcurrency(
      projectsByRoot.values(),
      this.clientStartConcurrency,
      (projects) => {
        const current = projects.find((project) => this.isWorkspaceFolderDiscoveryCurrent(
          project.workspaceRoot,
          project.generation,
        ));
        return current ? this.startServerFor(current.projectRoot) : undefined;
      },
    );
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
      // showErrorMessage reads a second argument as options or an item, so an
      // Error passed there is dropped: fold the cause into the message.
      const detail = errorMessage(error);
      return this.vscode.window.showErrorMessage(
        `Unable to select project.${detail ? ` ${detail}` : ""}`,
      );
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
    const disposable = this.vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event
        && typeof event.affectsConfiguration === "function"
        && !event.affectsConfiguration("gauge")
      ) {
        return undefined;
      }
      return this.onConfigurationChanged();
    });
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
    for (const folder of removed) {
      this.invalidateWorkspaceFolderDiscovery(folder.uri.fsPath);
    }
    for (const folder of added) {
      await this.startServersForWorkspaceFolder(folder.uri.fsPath);
    }
    const removedFolderStops = removed.map((folder) => (
      this.stopServersForWorkspaceFolder(folder.uri.fsPath, false)
    ));
    const removedFolderStopsSettled = Promise.allSettled(removedFolderStops);
    await this.setMultiProjectContext();
    if (this.projectRootsKey() !== beforeProjectRoots) {
      await this.notifyProjectsChanged();
    }
    await removedFolderStopsSettled;
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

  async discoverGaugeProjectRoots(workspaceRoot) {
    if (typeof this.projectFactory.findGaugeProjectRootsAsync === "function") {
      return this.projectFactory.findGaugeProjectRootsAsync(workspaceRoot);
    }
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

  workspaceFolderDiscoveryGeneration(workspaceRoot) {
    return this.workspaceFolderDiscoveryGenerations.get(workspaceRoot) || 0;
  }

  invalidateWorkspaceFolderDiscovery(workspaceRoot) {
    this.workspaceFolderDiscoveryGenerations.set(
      workspaceRoot,
      this.workspaceFolderDiscoveryGeneration(workspaceRoot) + 1,
    );
  }

  isWorkspaceFolderDiscoveryCurrent(workspaceRoot, generation) {
    return !this.disposed
      && this.workspaceFolderDiscoveryGeneration(workspaceRoot) === generation;
  }

  async discoverWorkspaceFolderProjects(workspaceRoot) {
    const generation = this.workspaceFolderDiscoveryGeneration(workspaceRoot);
    const projectRoots = await this.discoverGaugeProjectRoots(workspaceRoot);
    if (!this.isWorkspaceFolderDiscoveryCurrent(workspaceRoot, generation)) {
      return [];
    }
    return projectRoots.map((projectRoot) => ({
      generation,
      projectRoot,
      workspaceRoot,
    }));
  }

  async startServersForWorkspaceFolder(workspaceRoot) {
    const projects = await this.discoverWorkspaceFolderProjects(workspaceRoot);
    await mapWithConcurrency(
      projects,
      this.clientStartConcurrency,
      (project) => (
        this.isWorkspaceFolderDiscoveryCurrent(project.workspaceRoot, project.generation)
          ? this.startServerFor(project.projectRoot)
          : undefined
      ),
    );
  }

  async stopServersForWorkspaceFolder(workspaceRoot, invalidateDiscovery = true) {
    if (invalidateDiscovery) {
      this.invalidateWorkspaceFolderDiscovery(workspaceRoot);
    }
    const projectRoots = new Set([
      ...this.clientsMap.keys(),
      ...this.pendingServerStarts.keys(),
    ]);
    const stopResults = await Promise.allSettled(
      [...projectRoots]
        .filter((projectRoot) => isInside(workspaceRoot, projectRoot, this.pathModule))
        .map((projectRoot) => this.stopServerFor(projectRoot)),
    );
    const stopFailure = stopResults.find((result) => result.status === "rejected");
    if (stopFailure) {
      throw stopFailure.reason;
    }
  }

  async stopServerFor(folder) {
    const projectClient = this.clientsMap.get(folder);
    const projectRoot = projectClient ? projectClient.project.root() : folder;
    this.cancelServerStart(projectRoot);
    if (!projectClient) {
      this.clientLanguageMap.delete(projectRoot);
      this.projectEnvironmentCache.delete(projectRoot);
      return;
    }
    this.clientsMap.delete(projectRoot);
    this.clientLanguageMap.delete(projectRoot);
    this.projectEnvironmentCache.delete(projectRoot);
    if (projectClient.client && typeof projectClient.client.stop === "function") {
      await this.stopLanguageClient(projectClient.client, false);
    }
  }

  async cachedProjectEnvs(project) {
    if (
      this.projectEnvironmentService
      && typeof this.projectEnvironmentService.environmentFor === "function"
    ) {
      return this.projectEnvironmentService.environmentFor(project, this.cli);
    }
    const projectRoot = project.root();
    if (this.projectEnvironmentCache.has(projectRoot)) {
      return this.projectEnvironmentCache.get(projectRoot);
    }
    const envs = project.envs(this.cli) || {};
    this.projectEnvironmentCache.set(projectRoot, envs);
    return envs;
  }

  async serverOptionsFor(project) {
    const command = this.cli.gaugeCommand();
    const args = command.argsForSpawnType(["daemon", "--lsp", "--dir", project.root()]);
    const launchConfig = this.getWorkspaceConfiguration(GAUGE_LAUNCH_CONFIG);
    this.launchConfig = launchConfig;
    if (launchConfig && launchConfig.get(DEBUG_LOG_LEVEL_CONFIG)) {
      args.push("-l", "debug");
    }

    const env = {
      ...this.env,
      GAUGE_IGNORE_RUNNER_BUILD_FAILURES: "true",
      ...await this.cachedProjectEnvs(project),
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
        documentStore: this.documentStore,
        localDefinitionOwnedExternally: this.localDefinitionOwnedExternally,
        projectFactory: this.projectFactory,
        stepDefinitionProvider: this.stepDefinitionProvider,
        stepDiagnosticsProvider: this.stepDiagnosticsProvider,
        vscode: this.vscode,
      }),
      synchronize: {
        configurationSection: "gauge",
      },
      // No errorHandler: the default one restarts the client when the Gauge
      // daemon exits, which it does on any recovered LSP handler panic.
      connectionOptions: {
        messageStrategy: serverMessageStrategy(),
      },
      workspaceFolder: this.vscode.workspace.getWorkspaceFolder(this.vscode.Uri.file(folder)),
    };
  }

  async startServerFor(folder) {
    if (this.disposed || !this.projectFactory.isGaugeProject(folder)) {
      return undefined;
    }
    const project = this.projectFactory.get(folder);
    const projectRoot = project.root();
    if (this.pendingServerStarts.has(projectRoot)) {
      return this.pendingServerStarts.get(projectRoot);
    }
    if (this.clientsMap.has(projectRoot)) {
      return this.clientsMap.get(projectRoot).client;
    }
    const startGeneration = this.serverStartGeneration(projectRoot);
    const pendingStart = this.startLanguageServer(project, folder, startGeneration);
    this.pendingServerStarts.set(projectRoot, pendingStart);
    try {
      return await pendingStart;
    } finally {
      if (this.pendingServerStarts.get(projectRoot) === pendingStart) {
        this.pendingServerStarts.delete(projectRoot);
      }
    }
  }

  serverStartGeneration(projectRoot) {
    return this.serverStartGenerations.get(projectRoot) || 0;
  }

  cancelServerStart(projectRoot) {
    this.serverStartGenerations.set(projectRoot, this.serverStartGeneration(projectRoot) + 1);
    this.pendingServerStarts.delete(projectRoot);
  }

  isServerStartCurrent(projectRoot, startGeneration) {
    return !this.disposed && this.serverStartGeneration(projectRoot) === startGeneration;
  }

  async startLanguageServer(project, folder, startGeneration) {
    const projectRoot = project.root();
    const javaConfigGenerated = this.generateJavaConfig(project);
    const serverOptions = await this.serverOptionsFor(project);
    if (!this.isServerStartCurrent(projectRoot, startGeneration)) {
      return this.cleanupLanguageClient(projectRoot);
    }
    const languageClient = new this.LanguageClient(
      "gauge",
      "Gauge",
      serverOptions,
      this.clientOptionsFor(project, folder),
    );
    this.clientsMap.set(project.root(), { project, client: languageClient });
    try {
      await this.installRunnerFor(project);
      if (!this.isServerStartCurrent(projectRoot, startGeneration)) {
        return this.cleanupLanguageClient(projectRoot, languageClient);
      }
      if (!javaConfigGenerated && this.generateJavaConfig(project)) {
        const refreshedServerOptions = await this.serverOptionsFor(project);
        if (!this.isServerStartCurrent(projectRoot, startGeneration)) {
          return this.cleanupLanguageClient(projectRoot, languageClient);
        }
        serverOptions.command = refreshedServerOptions.command;
        serverOptions.args = refreshedServerOptions.args;
        serverOptions.options = refreshedServerOptions.options;
      }
      this.registerDynamicFeatures(languageClient);
      await languageClient.start();
      if (!this.isServerStartCurrent(projectRoot, startGeneration)) {
        return this.cleanupLanguageClient(projectRoot, languageClient);
      }
      clearLspCodeLensFeature(languageClient);
    } catch (error) {
      await this.cleanupLanguageClient(projectRoot, languageClient);
      if (this.isServerStartCurrent(projectRoot, startGeneration)) {
        await this.showLanguageServerStartupError(project, error);
      }
      return undefined;
    }
    this.registerServerMessageFilter(languageClient);
    await this.setLanguageId(languageClient, projectRoot, startGeneration);
    if (!this.isServerStartCurrent(projectRoot, startGeneration)) {
      return this.cleanupLanguageClient(projectRoot, languageClient);
    }
    return languageClient;
  }

  async cleanupLanguageClient(projectRoot, languageClient, suppressStopError = true) {
    const ownsClientRegistration = !this.clientsMap.has(projectRoot)
      || Map.prototype.get.call(this.clientsMap, projectRoot).client === languageClient;
    if (ownsClientRegistration) {
      this.clientsMap.delete(projectRoot);
      this.clientLanguageMap.delete(projectRoot);
      this.projectEnvironmentCache.delete(projectRoot);
    }
    await this.stopLanguageClient(languageClient, suppressStopError);
    return undefined;
  }

  async stopLanguageClient(languageClient, suppressStopError) {
    if (
      !languageClient
      || typeof languageClient.stop !== "function"
      || this.stoppedLanguageClients.has(languageClient)
    ) {
      return undefined;
    }
    try {
      await languageClient.stop();
      this.stoppedLanguageClients.add(languageClient);
    } catch (error) {
      if (!suppressStopError) {
        throw error;
      }
    }
    return undefined;
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

  async setLanguageId(languageClient, projectRoot, startGeneration) {
    try {
      const language = await languageClient.sendRequest("gauge/getRunnerLanguage", createToken(this.vscode));
      const currentEntry = this.clientsMap.has(projectRoot)
        ? Map.prototype.get.call(this.clientsMap, projectRoot)
        : undefined;
      if (
        this.isServerStartCurrent(projectRoot, startGeneration)
        && currentEntry
        && currentEntry.client === languageClient
      ) {
        this.clientLanguageMap.set(projectRoot, language);
      }
    } catch (_error) {
      return undefined;
    }
    return undefined;
  }
}

module.exports = {
  DEFAULT_CLIENT_START_CONCURRENCY,
  GaugeWorkspace,
  clientMiddleware,
};
