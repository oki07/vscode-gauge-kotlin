"use strict";

const nodeFs = require("node:fs");
const nodeOs = require("node:os");
const nodePath = require("node:path");
const { concurrencyLimit, mapWithConcurrency } = require("./asyncWork");
const { GaugeConfig, envWithGaugeHome } = require("./config/gaugeConfig");
const { GaugeJavaProjectConfig } = require("./config/gaugeProjectConfig");
const { GaugeClients } = require("./gaugeClients");
const { configuredSpecDirs, markdownIsASpecExtension } = require("./gaugeSpecScope");
const { GaugeWorkspaceFeature } = require("./gaugeWorkspaceFeature");
const { MavenProject } = require("./project/mavenProject");
const { createProjectFactory } = require("./project/projectFactory");
const { isLocalStepCodeActionDiagnostic } = require("./stepCodeActions");
const { GaugeStepDefinitionProvider } = require("./stepDefinitionProvider");
const { UNDEFINED_STEP_MESSAGE } = require("./stepDiagnostics");

const GAUGE_MULTI_PROJECT_CONTEXT = "gauge:multipleProjects?";
const GAUGE_CONFIG = "gauge";
const GAUGE_LAUNCH_CONFIG = "gauge.launch";
const CODE_LENS_METHOD = "textDocument/codeLens";
const RENAME_METHOD = "textDocument/rename";
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
const DEFAULT_LANGUAGE_CLIENT_RUNNING_STATE = 2;
const CANCELLED_PROJECT_SELECTION = Symbol("cancelled project selection");
const CANCELLED_RUNNER_LANGUAGE_REQUEST = Symbol("cancelled runner language request");

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
      State: options.LanguageClientState,
      RevealOutputChannelOn: options.RevealOutputChannelOn,
      ShowMessageNotification: options.ShowMessageNotification,
      MessageType: options.MessageType,
    };
  }
  return require("vscode-languageclient/node");
}

function createTokenSource(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource();
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
// getgauge/gauge/api/lang/runner.go). The Java extension pack cannot build
// Kotlin step implementations, so the hint misleads in this extension's
// projects; drop only that sentence and keep the rest of Gauge's message.
//
// Gauge reports a failed runner before it answers "initialize"
// (getgauge/gauge/api/lang/server.go Start), so this runs as a connection
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

function clearLocallyOwnedLspFeatures(languageClient) {
  if (!languageClient || typeof languageClient.getFeature !== "function") {
    return;
  }
  for (const method of [CODE_LENS_METHOD, RENAME_METHOD]) {
    const feature = languageClient.getFeature(method);
    if (feature && typeof feature.clear === "function") {
      feature.clear();
    }
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
    this.workspaceFolderProjectRoots = new Map();
    this.stoppedLanguageClients = new WeakSet();
    this.localFeatureStateDisposables = new WeakMap();
    this.localFeatureRefreshes = new WeakMap();
    this.serverMessageFilterRegistrations = new WeakMap();
    this.projectSelectionOperations = new Set();
    this.runnerLanguageRequests = new Set();
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
    this.languageClientRunningState = languageClientModule.State
      ? languageClientModule.State.Running
      : DEFAULT_LANGUAGE_CLIENT_RUNNING_STATE;
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
    // Seeded here so the first change to gauge.executablePath or gauge.home is
    // already a change to compare against.
    this.executableSettings = this.readExecutableSettings();
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
    this.cancelProjectSelectionOperations();
    this.cancelAllRunnerLanguageRequests();
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
    this.workspaceFolderProjectRoots.clear();
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
    const notifications = [];
    for (const listener of [...this.projectChangeListeners]) {
      try {
        notifications.push(Promise.resolve(listener(defaultFolder)));
      } catch (error) {
        notifications.push(Promise.reject(error));
      }
    }
    const outcomes = await Promise.allSettled(notifications);
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure) {
      throw failure.reason;
    }
  }

  async showProjectOptions(onChange) {
    const operation = this.createProjectSelectionOperation();
    if (!operation) {
      return undefined;
    }
    try {
      const projectItems = [];
      for (const projectRoot of [...this.clientsMap.keys()]
        .sort((left, right) => (left > right ? 1 : -1))) {
        if (!this.projectSelectionOperationActive(operation)) {
          return undefined;
        }
        const label = this.pathModule.basename(projectRoot);
        if (!this.projectSelectionOperationActive(operation)) {
          return undefined;
        }
        projectItems.push({ label, description: projectRoot });
      }
      let picker;
      try {
        picker = this.vscode.window.showQuickPick(projectItems, {
          canPickMany: false,
          placeHolder: "Choose a project",
        });
      } catch (error) {
        if (!this.projectSelectionOperationActive(operation)) {
          return undefined;
        }
        return await this.showProjectSelectionError(operation, error);
      }
      const pickerOutcome = await this.projectSelectionOutcome(operation, picker);
      if (pickerOutcome === CANCELLED_PROJECT_SELECTION) {
        return undefined;
      }
      if (pickerOutcome.status === "rejected") {
        return await this.showProjectSelectionError(operation, pickerOutcome.error);
      }
      const selected = pickerOutcome.value;
      if (!selected) {
        return undefined;
      }
      if (!this.projectSelectionOperationActive(operation)) {
        return undefined;
      }
      let projectRoot;
      try {
        projectRoot = selected.description;
      } catch (error) {
        if (!this.projectSelectionOperationActive(operation)) {
          return undefined;
        }
        return await this.showProjectSelectionError(operation, error);
      }
      if (!this.projectSelectionOperationActive(operation)) {
        return undefined;
      }
      let callback;
      try {
        callback = onChange(projectRoot);
      } catch (error) {
        if (!this.projectSelectionOperationActive(operation)) {
          return undefined;
        }
        return await this.showProjectSelectionError(operation, error);
      }
      const callbackOutcome = await this.projectSelectionOutcome(operation, callback);
      if (callbackOutcome === CANCELLED_PROJECT_SELECTION) {
        return undefined;
      }
      if (callbackOutcome.status === "rejected") {
        throw callbackOutcome.error;
      }
      return callbackOutcome.value;
    } finally {
      this.releaseProjectSelectionOperation(operation);
    }
  }

  createProjectSelectionOperation() {
    if (this.disposed) {
      return undefined;
    }
    let resolveCancellation;
    const operation = {
      active: true,
      cancellation: new Promise((resolve) => {
        resolveCancellation = resolve;
      }),
      resolveCancellation,
    };
    this.projectSelectionOperations.add(operation);
    return operation;
  }

  projectSelectionOperationActive(operation) {
    return !this.disposed
      && operation
      && operation.active
      && this.projectSelectionOperations.has(operation);
  }

  async projectSelectionOutcome(operation, value) {
    const observed = Promise.resolve(value).then(
      (result) => ({ status: "fulfilled", value: result }),
      (error) => ({ error, status: "rejected" }),
    );
    const outcome = await Promise.race([observed, operation.cancellation]);
    return this.projectSelectionOperationActive(operation)
      ? outcome
      : CANCELLED_PROJECT_SELECTION;
  }

  async showProjectSelectionError(operation, error) {
    if (!this.projectSelectionOperationActive(operation)) {
      return undefined;
    }
    // showErrorMessage reads a second argument as options or an item, so an
    // Error passed there is dropped: fold the cause into the message.
    let detail;
    try {
      detail = errorMessage(error);
    } catch (detailError) {
      if (!this.projectSelectionOperationActive(operation)) {
        return undefined;
      }
      throw detailError;
    }
    if (!this.projectSelectionOperationActive(operation)) {
      return undefined;
    }
    let notification;
    try {
      notification = this.vscode.window.showErrorMessage(
        `Unable to select project.${detail ? ` ${detail}` : ""}`,
      );
    } catch (notificationError) {
      if (!this.projectSelectionOperationActive(operation)) {
        return undefined;
      }
      throw notificationError;
    }
    const notificationOutcome = await this.projectSelectionOutcome(operation, notification);
    if (notificationOutcome === CANCELLED_PROJECT_SELECTION) {
      return undefined;
    }
    if (notificationOutcome.status === "rejected") {
      throw notificationOutcome.error;
    }
    return notificationOutcome.value;
  }

  releaseProjectSelectionOperation(operation) {
    if (!operation || !operation.active) {
      return;
    }
    operation.active = false;
    this.projectSelectionOperations.delete(operation);
    operation.resolveCancellation(CANCELLED_PROJECT_SELECTION);
  }

  cancelProjectSelectionOperations() {
    for (const operation of [...this.projectSelectionOperations]) {
      this.releaseProjectSelectionOperation(operation);
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
      if (this.disposed) {
        return undefined;
      }
      let affectsGauge = true;
      try {
        if (event && typeof event.affectsConfiguration === "function") {
          affectsGauge = event.affectsConfiguration("gauge");
        }
      } catch (error) {
        if (this.disposed) {
          return undefined;
        }
        throw error;
      }
      if (!affectsGauge) {
        return undefined;
      }
      const configurationChange = this.onConfigurationChanged();
      if (configurationChange && typeof configurationChange.then === "function") {
        Promise.resolve(configurationChange).catch(() => undefined);
      }
      return configurationChange;
    });
    if (disposable) {
      this.disposables.push(disposable);
    }
  }

  readExecutableSettings() {
    const configuration = this.getWorkspaceConfiguration(GAUGE_CONFIG);
    if (!configuration || typeof configuration.get !== "function") {
      return "";
    }
    return `${configuration.get("executablePath") || ""}\u0000${configuration.get("home") || ""}`;
  }

  onConfigurationChanged() {
    if (this.disposed) {
      return undefined;
    }
    let newLaunchConfig;
    let oldDebugLogs;
    let newDebugLogs;
    let newExecutableSettings;
    try {
      newLaunchConfig = this.getWorkspaceConfiguration(GAUGE_LAUNCH_CONFIG);
      if (this.disposed) {
        return undefined;
      }
      oldDebugLogs = this.launchConfig && this.launchConfig.get(DEBUG_LOG_LEVEL_CONFIG);
      if (this.disposed) {
        return undefined;
      }
      newDebugLogs = newLaunchConfig && newLaunchConfig.get(DEBUG_LOG_LEVEL_CONFIG);
      if (this.disposed) {
        return undefined;
      }
      newExecutableSettings = this.readExecutableSettings();
    } catch (error) {
      if (this.disposed) {
        return undefined;
      }
      throw error;
    }
    if (this.disposed) {
      return undefined;
    }
    this.launchConfig = newLaunchConfig;
    // gauge.executablePath and gauge.home are read once, when activation builds
    // the shared CLI, so changing them does nothing until the window reloads.
    // Without this the user who sets executablePath because the extension said
    // "Gauge executable not found!" saw no change and no explanation.
    const executableChanged = this.executableSettings !== undefined
      && this.executableSettings !== newExecutableSettings;
    this.executableSettings = newExecutableSettings;
    if (oldDebugLogs === newDebugLogs && !executableChanged) {
      return undefined;
    }
    let prompt;
    try {
      prompt = this.vscode.window.showWarningMessage(RESTART_MESSAGE, RESTART_ACTION);
    } catch (error) {
      if (this.disposed) {
        return undefined;
      }
      throw error;
    }
    return Promise.resolve(prompt).then((selection) => {
      if (this.disposed || selection !== RESTART_ACTION) {
        return undefined;
      }
      let reload;
      try {
        reload = this.vscode.commands.executeCommand(RELOAD_WINDOW_COMMAND);
      } catch (error) {
        if (this.disposed) {
          return undefined;
        }
        throw error;
      }
      return Promise.resolve(reload).then(
        (result) => (this.disposed ? undefined : result),
        (error) => {
          if (this.disposed) {
            return undefined;
          }
          throw error;
        },
      );
    }, (error) => {
      if (this.disposed) {
        return undefined;
      }
      throw error;
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
    } catch (_error) {
      return undefined;
    }
    return this.startServerFor(projectRoot);
  }

  async onWorkspaceFoldersChanged(event) {
    const added = event && event.added ? event.added : [];
    const removed = event && event.removed ? event.removed : [];
    const beforeProjectRoots = this.projectRootsKey();
    const removedProjectRoots = new Set();
    for (const folder of removed) {
      const workspaceRoot = folder.uri.fsPath;
      this.invalidateWorkspaceFolderDiscovery(workspaceRoot);
      for (const projectRoot of this.workspaceFolderProjectRoots.get(workspaceRoot) || []) {
        removedProjectRoots.add(projectRoot);
      }
      this.workspaceFolderProjectRoots.delete(workspaceRoot);
    }
    for (const folder of added) {
      await this.startServersForWorkspaceFolder(folder.uri.fsPath);
    }
    const currentProjectRoots = new Set([
      ...this.clientsMap.keys(),
      ...this.pendingServerStarts.keys(),
    ]);
    for (const folder of removed) {
      for (const projectRoot of currentProjectRoots) {
        if (isInside(folder.uri.fsPath, projectRoot, this.pathModule)) {
          removedProjectRoots.add(projectRoot);
        }
      }
    }
    const orphanedProjectRoots = [...removedProjectRoots].filter((projectRoot) => (
      !this.workspaceFolderOwnsProject(projectRoot)
    ));
    const removedProjectStopsSettled = Promise.allSettled([
      this.stopProjectRoots(orphanedProjectRoots),
    ]);
    await this.setMultiProjectContext();
    if (this.projectRootsKey() !== beforeProjectRoots) {
      try {
        await this.notifyProjectsChanged();
      } catch (_error) {
        // Project observers cannot roll back a completed workspace change.
      }
    }
    await removedProjectStopsSettled;
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
    const currentProjectRoots = [...new Set(projectRoots)];
    this.workspaceFolderProjectRoots.set(workspaceRoot, new Set(currentProjectRoots));
    return currentProjectRoots.map((projectRoot) => ({
      generation,
      projectRoot,
      workspaceRoot,
    }));
  }

  workspaceFolderOwnsProject(projectRoot) {
    for (const projectRoots of this.workspaceFolderProjectRoots.values()) {
      if (projectRoots.has(projectRoot)) {
        return true;
      }
    }
    return false;
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

  async stopProjectRoots(projectRoots) {
    const stopResults = await Promise.allSettled(
      [...new Set(projectRoots)].map((projectRoot) => this.stopServerFor(projectRoot)),
    );
    const stopFailure = stopResults.find((result) => result.status === "rejected");
    if (stopFailure) {
      throw stopFailure.reason;
    }
  }

  async stopServersForWorkspaceFolder(workspaceRoot, invalidateDiscovery = true) {
    if (invalidateDiscovery) {
      this.invalidateWorkspaceFolderDiscovery(workspaceRoot);
    }
    const projectRoots = new Set([
      ...this.clientsMap.keys(),
      ...this.pendingServerStarts.keys(),
    ]);
    await this.stopProjectRoots(
      [...projectRoots].filter((projectRoot) => (
        isInside(workspaceRoot, projectRoot, this.pathModule)
      )),
    );
  }

  async stopServerFor(folder) {
    // GaugeClients.get resolves by containment, so asking with a folder that is
    // not itself a project root hands back the ENCLOSING project's client.
    // Stopping that would take down a project the user still has open, so only a
    // client whose own root is this folder may be stopped.
    const enclosing = this.clientsMap.get(folder);
    const projectClient = enclosing && enclosing.project.root() === folder
      ? enclosing
      : undefined;
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

  // Gauge documents only. Gauge LSP advertises DocumentFormattingProvider and
  // CodeActionProvider (getgauge/gauge/api/lang/capabilities.go) and treats
  // every document it is offered as a Gauge specification, so offering it a
  // Kotlin or Java source registers Gauge as a formatter for that language:
  // Format Document would rewrite an implementation file as a specification,
  // and with no Kotlin extension installed Gauge would be the only formatter
  // registered for `.kt`. getgauge/gauge-vscode/src/gaugeWorkspace.ts selects
  // only `{ language: 'gauge' }`.
  //
  // Nothing is lost. Implementation-file references, definitions, diagnostics
  // and completions are all computed locally (src/gaugeReference.js routes
  // implementation documents to stepImplementationValuesAt without touching the
  // client), and gauge-java builds its step registry by reflection at runner
  // start rather than from synchronised document text.
  markdownSpecSelectors(projectRoot) {
    const scopeOptions = {
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectRoot,
    };
    // A project that narrows gauge_spec_file_extensions to ".spec" is saying its
    // Markdown is documentation, so it must not reach the daemon either.
    if (!markdownIsASpecExtension(scopeOptions)) {
      return [];
    }
    return configuredSpecDirs({
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectRoot,
    }).map((segments) => ({
      scheme: "file",
      language: MARKDOWN_LANGUAGE,
      pattern: `${projectRoot}/${segments.join("/")}/**/*.md`,
    }));
  }

  clientOptionsFor(project, folder) {
    const documentSelector = [
      { scheme: "file", language: GAUGE_LANGUAGE, pattern: `${project.root()}/**/*` },
      { scheme: "file", language: GAUGE_CONCEPT_LANGUAGE, pattern: `${project.root()}/**/*` },
      { scheme: "file", pattern: `${project.root()}/**/*.spec` },
      { scheme: "file", pattern: `${project.root()}/**/*.cpt` },
      // Scope the Markdown arm to the configured gauge_specs_dir. The daemon
      // classifies a document by extension alone
      // (getgauge/gauge/util/fileUtils.go IsValidSpecExtension, default list
      // ".spec, .md") and advertises CodeLensProvider
      // (getgauge/gauge/api/lang/capabilities.go), so a bare "**/*.md" put the
      // daemon's Run Spec and Debug Spec lenses on any README in the project,
      // and an unparseable one made it answer with an error. The rule lives in
      // src/gaugeSpecScope.js so every surface gives the same answer.
      ...this.markdownSpecSelectors(project.root()),
    ];
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
      await this.installRunnerFor(project, projectRoot, startGeneration);
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
      this.maintainLocallyOwnedLspFeatures(languageClient, projectRoot);
      this.registerServerMessageFilter(languageClient, projectRoot, startGeneration);
    } catch (error) {
      await this.cleanupLanguageClient(projectRoot, languageClient);
      if (this.isServerStartCurrent(projectRoot, startGeneration)) {
        await this.showLanguageServerStartupError(project, error);
      }
      return undefined;
    }
    this.setLanguageId(languageClient, projectRoot, startGeneration);
    if (!this.languageClientStartCurrent(languageClient, projectRoot, startGeneration)) {
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
    this.releaseServerMessageFilter(languageClient);
    this.releaseLocallyOwnedLspFeatures(languageClient);
    if (!languageClient) {
      return undefined;
    }
    this.cancelRunnerLanguageRequestsFor(languageClient);
    if (
      typeof languageClient.stop !== "function"
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

  maintainLocallyOwnedLspFeatures(languageClient, projectRoot) {
    clearLocallyOwnedLspFeatures(languageClient);
    if (
      !languageClient
      || typeof languageClient.onDidChangeState !== "function"
      || this.localFeatureStateDisposables.has(languageClient)
    ) {
      return;
    }
    const disposable = languageClient.onDidChangeState((event) => {
      const current = this.clientsMap.get(projectRoot);
      if (
        this.disposed
        || !event
        || event.newState !== this.languageClientRunningState
        || !current
        || current.client !== languageClient
      ) {
        return;
      }
      this.refreshLocallyOwnedLspFeatures(languageClient, projectRoot);
    });
    if (
      this.disposed
      || !this.clientsMap.has(projectRoot)
      || this.clientsMap.get(projectRoot).client !== languageClient
    ) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
      return;
    }
    this.localFeatureStateDisposables.set(languageClient, disposable);
  }

  refreshLocallyOwnedLspFeatures(languageClient, projectRoot) {
    if (
      !languageClient
      || typeof languageClient.start !== "function"
      || this.localFeatureRefreshes.has(languageClient)
    ) {
      return;
    }
    let start;
    try {
      start = languageClient.start();
    } catch (_error) {
      return;
    }
    const refresh = Promise.resolve(start).then(() => {
      if (this.localFeatureRefreshes.get(languageClient) === refresh) {
        this.localFeatureRefreshes.delete(languageClient);
      }
      const current = this.clientsMap.get(projectRoot);
      if (!this.disposed && current && current.client === languageClient) {
        try {
          clearLocallyOwnedLspFeatures(languageClient);
        } catch (_error) {
          // A feature cleanup failure must not escape the language client's restart lifecycle.
        }
      }
    }, () => {
      if (this.localFeatureRefreshes.get(languageClient) === refresh) {
        this.localFeatureRefreshes.delete(languageClient);
      }
    });
    this.localFeatureRefreshes.set(languageClient, refresh);
  }

  releaseLocallyOwnedLspFeatures(languageClient) {
    if (!languageClient) {
      return;
    }
    const disposable = this.localFeatureStateDisposables.get(languageClient);
    this.localFeatureStateDisposables.delete(languageClient);
    this.localFeatureRefreshes.delete(languageClient);
    if (disposable && typeof disposable.dispose === "function") {
      try {
        disposable.dispose();
      } catch (_error) {
        // Language client shutdown remains authoritative when listener cleanup fails.
      }
    }
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

  languageClientStartCurrent(languageClient, projectRoot, startGeneration) {
    const current = Map.prototype.get.call(this.clientsMap, projectRoot);
    return this.isServerStartCurrent(projectRoot, startGeneration)
      && current
      && current.client === languageClient;
  }

  serverMessageFilterCurrent(operation) {
    return Boolean(operation && operation.active) && this.languageClientStartCurrent(
      operation.languageClient,
      operation.projectRoot,
      operation.startGeneration,
    );
  }

  disposeServerMessageFilter(disposable) {
    if (!disposable || typeof disposable.dispose !== "function") {
      return;
    }
    try {
      disposable.dispose();
    } catch (_error) {
      // Language client shutdown remains authoritative when handler cleanup fails.
    }
  }

  releaseServerMessageFilter(languageClient) {
    if (!languageClient) {
      return;
    }
    const operation = this.serverMessageFilterRegistrations.get(languageClient);
    if (!operation) {
      return;
    }
    this.serverMessageFilterRegistrations.delete(languageClient);
    operation.active = false;
    const disposable = operation.disposable;
    operation.disposable = undefined;
    this.disposeServerMessageFilter(disposable);
  }

  registerServerMessageFilter(languageClient, projectRoot, startGeneration) {
    if (
      !languageClient
      || typeof languageClient.onNotification !== "function"
      || !this.ShowMessageNotification
      || !this.languageClientStartCurrent(languageClient, projectRoot, startGeneration)
    ) {
      return;
    }
    const existing = this.serverMessageFilterRegistrations.get(languageClient);
    if (existing) {
      if (this.serverMessageFilterCurrent(existing)) {
        return;
      }
      this.releaseServerMessageFilter(languageClient);
    }
    const operation = {
      active: true,
      disposable: undefined,
      languageClient,
      projectRoot,
      startGeneration,
    };
    this.serverMessageFilterRegistrations.set(languageClient, operation);
    const disposable = languageClient.onNotification(this.ShowMessageNotification.type, (params) => {
      if (!this.serverMessageFilterCurrent(operation)) {
        return;
      }
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
    if (!operation.active || !this.serverMessageFilterCurrent(operation)) {
      if (this.serverMessageFilterRegistrations.get(languageClient) === operation) {
        this.serverMessageFilterRegistrations.delete(languageClient);
      }
      operation.active = false;
      this.disposeServerMessageFilter(disposable);
      return;
    }
    operation.disposable = disposable;
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

  async installRunnerFor(project, projectRoot, startGeneration) {
    if (!this.isServerStartCurrent(projectRoot, startGeneration)) {
      return undefined;
    }
    const language = project.language();
    if (!language || this.cli.isPluginInstalled(language)) {
      return undefined;
    }
    const message = `The project ${this.pathModule.basename(project.root())} requires gauge ${language} to be installed. Would you like to install it?`;
    if (!this.isServerStartCurrent(projectRoot, startGeneration)) {
      return undefined;
    }
    const action = await this.vscode.window.showErrorMessage(message, { modal: true }, "Yes", "No");
    if (
      action === "Yes"
      && this.isServerStartCurrent(projectRoot, startGeneration)
    ) {
      return this.cli.installGaugeRunner(language, { vscode: this.vscode });
    }
    return undefined;
  }

  async setLanguageId(languageClient, projectRoot, startGeneration) {
    let operation;
    try {
      if (!this.runnerLanguageRequestCurrent(languageClient, projectRoot, startGeneration)) {
        return undefined;
      }
      operation = this.createRunnerLanguageRequest(languageClient);
      if (!operation) {
        return undefined;
      }
      if (!this.runnerLanguageRequestCurrent(languageClient, projectRoot, startGeneration)) {
        this.releaseRunnerLanguageRequest(operation, true);
        return undefined;
      }
      const token = operation.source ? operation.source.token : undefined;
      if (!operation.active) {
        return undefined;
      }
      const request = languageClient.sendRequest("gauge/getRunnerLanguage", token);
      const observedRequest = Promise.resolve(request);
      const language = await Promise.race([observedRequest, operation.cancellation]);
      if (
        operation.active
        && language !== CANCELLED_RUNNER_LANGUAGE_REQUEST
        && this.runnerLanguageRequestCurrent(languageClient, projectRoot, startGeneration)
      ) {
        this.clientLanguageMap.set(projectRoot, language);
      }
    } catch (_error) {
      return undefined;
    } finally {
      this.releaseRunnerLanguageRequest(operation);
    }
    return undefined;
  }

  createRunnerLanguageRequest(languageClient) {
    if (this.disposed) {
      return undefined;
    }
    const source = createTokenSource(this.vscode);
    if (this.disposed) {
      this.cleanupRunnerLanguageSource(source, true);
      return undefined;
    }
    let resolveCancellation;
    const operation = {
      active: true,
      cancellation: new Promise((resolve) => {
        resolveCancellation = resolve;
      }),
      languageClient,
      resolveCancellation,
      source,
    };
    this.runnerLanguageRequests.add(operation);
    return operation;
  }

  runnerLanguageRequestCurrent(languageClient, projectRoot, startGeneration) {
    const currentEntry = this.clientsMap.has(projectRoot)
      ? Map.prototype.get.call(this.clientsMap, projectRoot)
      : undefined;
    return this.isServerStartCurrent(projectRoot, startGeneration)
      && currentEntry
      && currentEntry.client === languageClient;
  }

  cleanupRunnerLanguageSource(source, cancel) {
    if (!source) {
      return;
    }
    if (cancel) {
      try {
        if (typeof source.cancel === "function") {
          source.cancel();
        }
      } catch (_error) {
        // Continue disposing the owned request source after cancellation fails.
      }
    }
    try {
      if (typeof source.dispose === "function") {
        source.dispose();
      }
    } catch (_error) {
      // Request-source cleanup cannot reactivate a terminal language lookup.
    }
  }

  releaseRunnerLanguageRequest(operation, cancel = false) {
    if (!operation || !operation.active) {
      return;
    }
    operation.active = false;
    this.runnerLanguageRequests.delete(operation);
    const source = operation.source;
    operation.source = undefined;
    if (cancel) {
      operation.resolveCancellation(CANCELLED_RUNNER_LANGUAGE_REQUEST);
    }
    this.cleanupRunnerLanguageSource(source, cancel);
  }

  cancelRunnerLanguageRequestsFor(languageClient) {
    if (!languageClient) {
      return;
    }
    for (const operation of [...this.runnerLanguageRequests]) {
      if (operation.languageClient === languageClient) {
        this.releaseRunnerLanguageRequest(operation, true);
      }
    }
  }

  cancelAllRunnerLanguageRequests() {
    for (const operation of [...this.runnerLanguageRequests]) {
      this.releaseRunnerLanguageRequest(operation, true);
    }
  }
}

module.exports = {
  DEFAULT_CLIENT_START_CONCURRENCY,
  GaugeWorkspace,
  clientMiddleware,
};
