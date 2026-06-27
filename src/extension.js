"use strict";

const { CLI } = require("./cli");
const {
  GaugeArgumentCodeActionProvider,
  registerArgumentSelectionCommand,
} = require("./argumentCodeActions");
const { ConfigProvider } = require("./config/configProvider");
const {
  EXECUTION_COMMANDS,
  createGaugeExecutionController,
  createGaugeExecutionStatusProvider,
} = require("./execution/executor");
const { createGaugeScenariosProvider } = require("./execution/scenarioProvider");
const { ExtractConceptCommandProvider } = require("./extractConcept");
const { GaugeDynamicArgumentCompletionProvider } = require("./dynamicArgumentCompletion");
const { SpecNodeProvider } = require("./explorer/specExplorer");
const { GenerateStubCommandProvider } = require("./annotator/generateStub");
const { GaugeFoldingRangeProvider } = require("./foldingRangeProvider");
const { GaugeClients } = require("./gaugeClients");
const { GaugeEnterHandler } = require("./gaugeEnterHandler");
const { ReferenceProvider } = require("./gaugeReference");
const { GaugeState } = require("./gaugeState");
const { GaugeWorkspace } = require("./gaugeWorkspace");
const { ProjectInitializer } = require("./init/projectInit");
const { previewGaugeDocument } = require("./preview");
const { createProjectFactory } = require("./project/projectFactory");
const {
  GaugeSemanticTokensProvider,
  createLegend,
} = require("./semanticTokensProvider");
const { GaugeStepDefinitionProvider } = require("./stepDefinitionProvider");
const { GaugeStepDiagnosticsProvider } = require("./stepDiagnostics");
const {
  createConcept,
  createGaugeSpecDirsProvider,
  createSpecification,
} = require("./specification");
const {
  showInstallGaugeNotification,
  showWelcomeNotification,
} = require("./welcomeNotifications");

const MINIMUM_SUPPORTED_GAUGE_VERSION = "0.9.6";
const DIRECT_DEBUG_CONFIGURATION_ERROR = "Starting with the Gauge debug configuration is not supported. Please use the 'Gauge' commands instead.";
const FORMAT_DOCUMENT_COMMAND = "editor.action.formatDocument";
const KOTLIN_LANGUAGE = "kotlin";
const PROVIDER_COMMANDS = new Set([
  "gauge.createProject",
  "gauge.config.saveRecommended",
  "gauge.extract.concept",
  "gauge.showReferences.atCursor",
  "gauge.specexplorer.debugNode",
  "gauge.specexplorer.runAllActiveProjectSpecs",
  "gauge.specexplorer.runNode",
  "gauge.specexplorer.switchProject",
]);
const GAUGE_WORD_PATTERN = /^(?:[*])([^*].*)$/g;
const SEMANTIC_TOKEN_COLOR_KEYS = [
  "argument",
  "stepMarker",
  "step",
  "table",
  "tableHeader",
  "tableHeaderSeparator",
  "tableBorder",
  "tableKeyword",
  "tableFileValue",
  "tagKeyword",
  "tagValue",
  "specification",
  "scenario",
  "disabledStep",
];

const GAUGE_COMMANDS = [
  "gauge.createProject",
  "gauge.execute",
  "gauge.debug",
  "gauge.execute.inParallel",
  "gauge.create.specification",
  "gauge.create.concept",
  "gauge.extract.concept",
  "gauge.format",
  "gauge.preview",
  "gauge.config.saveRecommended",
  "gauge.stopExecution",
  "gauge.execute.failed",
  "gauge.report.html",
  "gauge.execute.repeat",
  "gauge.execute.specification",
  "gauge.execute.specification.all",
  "gauge.specexplorer.runAllActiveProjectSpecs",
  "gauge.specexplorer.runNode",
  "gauge.specexplorer.debugNode",
  "gauge.execute.scenario",
  "gauge.execute.scenarios",
  "gauge.showReferences.atCursor",
  "gauge.specexplorer.switchProject",
];

let activeClientsMap;

function getVscode(vscodeApi) {
  return vscodeApi || require("vscode");
}

function notify(vscode, message) {
  if (vscode.window && typeof vscode.window.showInformationMessage === "function") {
    return vscode.window.showInformationMessage(message);
  }
  return undefined;
}

function activeProjectRoots() {
  if (!activeClientsMap || typeof activeClientsMap.keys !== "function") {
    return undefined;
  }
  const roots = Array.from(activeClientsMap.keys()).filter(Boolean);
  return roots.length > 0 ? roots : undefined;
}

async function formatActiveGaugeDocument(vscode) {
  if (!hasActiveGaugeDocument(vscode)) {
    return notify(vscode, "No Gauge file is active.");
  }
  const document = vscode.window.activeTextEditor.document;
  if (typeof document.save === "function") {
    await document.save();
  }
  if (vscode.commands && typeof vscode.commands.executeCommand === "function") {
    return vscode.commands.executeCommand(FORMAT_DOCUMENT_COMMAND);
  }
  return undefined;
}

function workspaceFolders(vscode) {
  if (!vscode.workspace || !vscode.workspace.workspaceFolders) {
    return [];
  }
  return vscode.workspace.workspaceFolders;
}

function hasActiveGaugeDocument(vscode) {
  const editor = vscode.window && vscode.window.activeTextEditor;
  return Boolean(editor && editor.document && editor.document.languageId === "gauge");
}

function hasActiveKotlinGaugeDocument(vscode, projectFactory) {
  const editor = vscode.window && vscode.window.activeTextEditor;
  if (!editor || !editor.document || editor.document.languageId !== KOTLIN_LANGUAGE) {
    return false;
  }
  try {
    projectFactory.getGaugeRootFromFilePath(editor.document.uri.fsPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function hasGaugeProject(vscode, projectFactory) {
  return workspaceFolders(vscode).some((folder) => projectFactory.isGaugeProject(folder.uri.fsPath));
}

function shouldStartGaugeServices(vscode, projectFactory) {
  return hasActiveGaugeDocument(vscode)
    || hasActiveKotlinGaugeDocument(vscode, projectFactory)
    || hasGaugeProject(vscode, projectFactory);
}

function setActivatedContext(vscode) {
  if (vscode.commands && typeof vscode.commands.executeCommand === "function") {
    return vscode.commands.executeCommand("setContext", "gauge:activated", true);
  }
  return undefined;
}

function registerGaugeLanguageConfiguration(context, vscode) {
  if (!vscode.languages || typeof vscode.languages.setLanguageConfiguration !== "function") {
    return;
  }
  const disposable = vscode.languages.setLanguageConfiguration("gauge", {
    wordPattern: GAUGE_WORD_PATTERN,
  });
  if (disposable) {
    context.subscriptions.push(disposable);
  }
}

function registerGaugeEnterHandler(context, vscode, options) {
  const GaugeEnterHandlerCtor = options.GaugeEnterHandler || GaugeEnterHandler;
  const handler = new GaugeEnterHandlerCtor({ vscode });
  const disposable = typeof handler.register === "function" ? handler.register() : undefined;
  if (disposable) {
    context.subscriptions.push(disposable);
  }
}

function registerDebugConfigurationProvider(context, vscode) {
  if (!vscode.debug || typeof vscode.debug.registerDebugConfigurationProvider !== "function") {
    return;
  }
  const disposable = vscode.debug.registerDebugConfigurationProvider("gauge", {
    resolveDebugConfiguration() {
      throw new Error(DIRECT_DEBUG_CONFIGURATION_ERROR);
    },
  });
  if (disposable) {
    context.subscriptions.push(disposable);
  }
}

function registerArgumentCodeActionProvider(context, vscode, options) {
  if (!vscode.languages || typeof vscode.languages.registerCodeActionsProvider !== "function") {
    return;
  }
  const ArgumentCodeActionProviderCtor = options.GaugeArgumentCodeActionProvider
    || GaugeArgumentCodeActionProvider;
  const provider = new ArgumentCodeActionProviderCtor({ vscode });
  const disposable = vscode.languages.registerCodeActionsProvider(
    { language: "gauge" },
    provider,
  );
  if (disposable) {
    context.subscriptions.push(disposable);
  }
  const commandDisposable = registerArgumentSelectionCommand(vscode);
  if (commandDisposable) {
    context.subscriptions.push(commandDisposable);
  }
}

function registerDynamicArgumentCompletionProvider(context, vscode, options) {
  if (!vscode.languages || typeof vscode.languages.registerCompletionItemProvider !== "function") {
    return;
  }
  const CompletionProviderCtor = options.DynamicArgumentCompletionProvider
    || GaugeDynamicArgumentCompletionProvider;
  const provider = new CompletionProviderCtor({
    projectFactory: options.projectFactory,
    vscode,
  });
  const disposable = vscode.languages.registerCompletionItemProvider(
    { language: "gauge" },
    provider,
    "<",
    "\"",
  );
  if (disposable) {
    context.subscriptions.push(disposable);
  }
}

function registerFoldingRangeProvider(context, vscode, options) {
  if (!vscode.languages || typeof vscode.languages.registerFoldingRangeProvider !== "function") {
    return;
  }
  const FoldingRangeProviderCtor = options.GaugeFoldingRangeProvider || GaugeFoldingRangeProvider;
  const provider = new FoldingRangeProviderCtor({ vscode });
  const disposable = vscode.languages.registerFoldingRangeProvider(
    { language: "gauge" },
    provider,
  );
  if (disposable) {
    context.subscriptions.push(disposable);
  }
}

function registerStepDiagnosticsProvider(context, vscode, options) {
  const StepDiagnosticsProviderCtor = options.GaugeStepDiagnosticsProvider || GaugeStepDiagnosticsProvider;
  const provider = new StepDiagnosticsProviderCtor({
    projectFactory: options.projectFactory,
    vscode,
  });
  const disposable = typeof provider.register === "function" ? provider.register() : undefined;
  if (disposable) {
    context.subscriptions.push(disposable);
  }
}

function registerStepDefinitionProvider(context, vscode, options) {
  const StepDefinitionProviderCtor = options.GaugeStepDefinitionProvider || GaugeStepDefinitionProvider;
  const provider = new StepDefinitionProviderCtor({
    projectFactory: options.projectFactory,
    vscode,
  });
  const disposable = typeof provider.register === "function"
    ? provider.register()
    : (
      vscode.languages
      && typeof vscode.languages.registerDefinitionProvider === "function"
        ? vscode.languages.registerDefinitionProvider({ language: "gauge" }, provider)
        : undefined
    );
  if (disposable) {
    context.subscriptions.push(disposable);
  }
}

function registerSemanticTokensProvider(context, vscode, options) {
  if (!vscode.languages || typeof vscode.languages.registerDocumentSemanticTokensProvider !== "function") {
    return;
  }
  const SemanticTokensProviderCtor = options.GaugeSemanticTokensProvider || GaugeSemanticTokensProvider;
  const legend = options.semanticTokensLegend || createLegend(vscode);
  const provider = new SemanticTokensProviderCtor({ vscode, legend });
  const disposable = vscode.languages.registerDocumentSemanticTokensProvider(
    { language: "gauge" },
    provider,
    legend,
  );
  if (disposable) {
    context.subscriptions.push(disposable);
  }
}

function updateGaugeSemanticTokenColors(vscode) {
  if (!vscode.workspace || typeof vscode.workspace.getConfiguration !== "function") {
    return undefined;
  }
  const gaugeConfig = vscode.workspace.getConfiguration("gauge.semanticTokenColors");
  const rules = {};
  for (const key of SEMANTIC_TOKEN_COLOR_KEYS) {
    rules[key] = { foreground: gaugeConfig.get(key) };
  }
  rules.gaugeComment = { foreground: gaugeConfig.get("comment") };
  const editorConfig = vscode.workspace.getConfiguration("editor");
  return editorConfig.update(
    "semanticTokenColorCustomizations",
    { rules },
    vscode.ConfigurationTarget && vscode.ConfigurationTarget.Global,
  );
}

function registerSemanticTokenColorUpdates(context, vscode) {
  updateGaugeSemanticTokenColors(vscode);
  if (!vscode.workspace || typeof vscode.workspace.onDidChangeConfiguration !== "function") {
    return;
  }
  const disposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("gauge.semanticTokenColors")) {
      updateGaugeSemanticTokenColors(vscode);
    }
  });
  if (disposable) {
    context.subscriptions.push(disposable);
  }
}

function createCommandHandler(command, vscode, executionController, options = {}) {
  return function handleGaugeCommand(...args) {
    if (EXECUTION_COMMANDS.has(command)) {
      return executionController.handleCommand(command, ...args);
    }

    switch (command) {
      case "gauge.create.specification":
        return (options.createSpecification || createSpecification)({
          vscode,
          fileSystem: options.fileSystem,
          pathModule: options.pathModule,
          eol: options.eol,
          projects: activeProjectRoots(),
          specDirsProvider: options.specDirsProvider || createGaugeSpecDirsProvider(
            () => activeClientsMap,
            { vscode },
          ),
        });
      case "gauge.create.concept":
        return (options.createConcept || createConcept)({
          vscode,
          fileSystem: options.fileSystem,
          pathModule: options.pathModule,
          eol: options.eol,
          projects: activeProjectRoots(),
          specDirsProvider: options.specDirsProvider || createGaugeSpecDirsProvider(
            () => activeClientsMap,
            { vscode },
          ),
        });
      case "gauge.preview":
        return (options.createPreview || previewGaugeDocument)({
          vscode,
          cli: options.cli,
          createCli: options.createCli,
          env: options.env,
          fileSystem: options.fileSystem,
          pathModule: options.pathModule,
          projectFactory: options.projectFactory,
          tempDirProvider: options.tempDirProvider,
        });
      case "gauge.format":
        return (options.formatDocument || formatActiveGaugeDocument)(vscode);
      case "gauge.config.saveRecommended":
        return notify(vscode, "Gauge recommended settings are not available yet.");
      case "gauge.stopExecution":
        return notify(vscode, "No Gauge execution is currently running.");
      default:
        return notify(vscode, "Gauge Kotlin command is not implemented yet.");
    }
  };
}

function createCli(vscode, options) {
  const cliFactory = options.createCli || ((cliOptions) => CLI.instance(cliOptions));
  return cliFactory({ vscode });
}

function createGaugeState(context, options) {
  if (options.state) {
    return options.state;
  }
  const GaugeStateCtor = options.GaugeState || GaugeState;
  return new GaugeStateCtor(context);
}

function startGaugeServices(context, vscode, options = {}) {
  const projectFactory = options.projectFactory || createProjectFactory({
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    vscode,
  });
  if (!shouldStartGaugeServices(vscode, projectFactory)) {
    return undefined;
  }

  const cli = createCli(vscode, options);
  if (!cli) {
    return undefined;
  }
  if (!cli.isGaugeInstalled() || !cli.isGaugeVersionGreaterOrEqual(MINIMUM_SUPPORTED_GAUGE_VERSION)) {
    return (options.showInstallGaugeNotification || showInstallGaugeNotification)(vscode);
  }

  (options.showWelcomeNotification || showWelcomeNotification)(context, vscode);
  setActivatedContext(vscode);
  registerGaugeLanguageConfiguration(context, vscode);
  registerGaugeEnterHandler(context, vscode, options);
  registerDebugConfigurationProvider(context, vscode);
  registerArgumentCodeActionProvider(context, vscode, options);
  registerDynamicArgumentCompletionProvider(context, vscode, {
    ...options,
    projectFactory,
  });
  registerFoldingRangeProvider(context, vscode, options);
  registerStepDefinitionProvider(context, vscode, {
    ...options,
    projectFactory,
  });
  registerStepDiagnosticsProvider(context, vscode, {
    ...options,
    projectFactory,
  });
  registerSemanticTokensProvider(context, vscode, options);
  registerSemanticTokenColorUpdates(context, vscode);

  const GaugeClientsCtor = options.GaugeClients || GaugeClients;
  const clientsMap = options.clientsMap || new GaugeClientsCtor();
  const state = createGaugeState(context, options);
  const GaugeWorkspaceCtor = options.GaugeWorkspace || GaugeWorkspace;
  const ReferenceProviderCtor = options.ReferenceProvider || ReferenceProvider;
  const ConfigProviderCtor = options.ConfigProvider || ConfigProvider;
  const ExtractConceptCommandProviderCtor = options.ExtractConceptCommandProvider
    || ExtractConceptCommandProvider;
  const GenerateStubCommandProviderCtor = options.GenerateStubCommandProvider || GenerateStubCommandProvider;
  const SpecNodeProviderCtor = options.SpecNodeProvider || SpecNodeProvider;
  const gaugeWorkspace = new GaugeWorkspaceCtor({
    cli,
    clientsMap,
    env: options.env,
    execSync: options.execSync,
    fileSystem: options.fileSystem,
    LanguageClient: options.LanguageClient,
    pathModule: options.pathModule,
    projectFactory,
    RevealOutputChannelOn: options.RevealOutputChannelOn,
    state,
    vscode,
  });
  const referenceProvider = new ReferenceProviderCtor(clientsMap, {
    projectFactory,
    vscode,
  });
  const configProvider = new ConfigProviderCtor(context, { vscode });
  const extractConceptProvider = new ExtractConceptCommandProviderCtor(clientsMap, {
    pathModule: options.pathModule,
    vscode,
  });
  const generateStubProvider = new GenerateStubCommandProviderCtor(clientsMap, { vscode });
  const specNodeProvider = new SpecNodeProviderCtor(gaugeWorkspace, {
    executionController: options.executionController,
    pathModule: options.pathModule,
    vscode,
  });
  activeClientsMap = clientsMap;
  context.subscriptions.push(
    gaugeWorkspace,
    referenceProvider,
    configProvider,
    extractConceptProvider,
    generateStubProvider,
    specNodeProvider,
  );
  return gaugeWorkspace;
}

function activate(context, vscodeApi, options = {}) {
  const vscode = getVscode(vscodeApi);
  const state = createGaugeState(context, options);
  const projectFactory = options.projectFactory || createProjectFactory({
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    vscode,
  });
  const serviceOptions = {
    ...options,
    projectFactory,
  };
  const executionController = (options.createExecutionController || createGaugeExecutionController)({
    vscode,
    executionStatusProvider: options.executionStatusProvider || createGaugeExecutionStatusProvider(
      () => activeClientsMap,
      { vscode },
    ),
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    projectFactory,
    runner: options.runner,
    scenariosProvider: options.scenariosProvider || createGaugeScenariosProvider(
      () => activeClientsMap,
      { vscode },
    ),
    state,
  });
  const ProjectInitializerCtor = options.ProjectInitializer || ProjectInitializer;
  context.subscriptions.push(new ProjectInitializerCtor({
    cli: options.cli,
    createCli: options.createCli || ((cliOptions) => CLI.instance(cliOptions)),
    env: options.env,
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    vscode,
  }));

  for (const command of GAUGE_COMMANDS.filter((entry) => !PROVIDER_COMMANDS.has(entry))) {
    const disposable = vscode.commands.registerCommand(
      command,
      createCommandHandler(command, vscode, executionController, serviceOptions),
    );
    context.subscriptions.push(disposable);
  }

  startGaugeServices(context, vscode, {
    ...serviceOptions,
    executionController,
    state,
  });
}

function deactivate() {
  if (!activeClientsMap) {
    return Promise.resolve(undefined);
  }
  const stopPromises = [];
  for (const entry of activeClientsMap.values()) {
    if (entry.client && typeof entry.client.stop === "function") {
      stopPromises.push(entry.client.stop());
    }
  }
  return Promise.all(stopPromises).then(() => undefined);
}

module.exports = {
  GAUGE_COMMANDS,
  activate,
  deactivate,
};
