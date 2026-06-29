"use strict";

const { CLI } = require("./cli");
const { GaugeCodeLensProvider } = require("./codeLensProvider");
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
const { GaugeFormatProvider } = require("./formatProvider");
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
const { GaugeTestController } = require("./testController");
const { TerminalProvider } = require("./terminalProvider");
const { GaugeValidateDiagnosticsProvider } = require("./validateDiagnostics");
const {
  createConcept,
  createGaugeSpecDirsProvider,
  createSpecification,
} = require("./specification");
const { GaugeRenameProvider } = require("./renameProvider");
const {
  showInstallGaugeNotification,
  showUnsupportedGaugeVersionNotification,
  showWelcomeNotification,
} = require("./welcomeNotifications");

const MINIMUM_SUPPORTED_GAUGE_VERSION = "0.9.6";
const DIRECT_DEBUG_CONFIGURATION_ERROR = "Starting with the Gauge debug configuration is not supported. Please use the 'Gauge' commands instead.";
const JAVA_LANGUAGE = "java";
const KOTLIN_LANGUAGE = "kotlin";
const MARKDOWN_GAUGE_SPEC_SELECTOR = { language: "markdown", scheme: "file", pattern: "**/*.md" };
const JAVA_IMPLEMENTATION_SELECTOR = { scheme: "file", pattern: "**/*.java" };
const KOTLIN_IMPLEMENTATION_SELECTOR = { scheme: "file", pattern: "**/*.kt" };
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
  "dynamicArgument",
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
const TEST_UI_RUN_FLAGS = {
  "hide-suggestion": true,
  "machine-readable": true,
};
const TEST_UI_DEFAULT_EXECUTION_COMMANDS = new Set([
  "gauge.execute",
  "gauge.debug",
  "gauge.execute.inParallel",
  "gauge.execute.failed",
  "gauge.execute.repeat",
  "gauge.execute.specification",
  "gauge.execute.specification.all",
  "gauge.specexplorer.runAllActiveProjectSpecs",
  "gauge.specexplorer.runNode",
  "gauge.specexplorer.debugNode",
  "gauge.execute.scenario",
  "gauge.execute.scenarios",
]);
const EXECUTION_FLAG_KEYS = new Set([
  "debug",
  "failed",
  "hide-suggestion",
  "machine-readable",
  "parallel",
  "repeat",
]);

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

function showError(vscode, message) {
  if (vscode.window && typeof vscode.window.showErrorMessage === "function") {
    return vscode.window.showErrorMessage(message);
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

async function applyDocumentEdits(vscode, document, edits) {
  if (!Array.isArray(edits) || edits.length === 0) {
    return undefined;
  }
  if (
    !vscode.workspace
    || typeof vscode.workspace.applyEdit !== "function"
    || typeof vscode.WorkspaceEdit !== "function"
  ) {
    return undefined;
  }
  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const edit of edits) {
    workspaceEdit.replace(document.uri, edit.range, edit.newText);
  }
  const applied = await vscode.workspace.applyEdit(workspaceEdit);
  if (applied === false) {
    return showError(vscode, "Unable to apply formatted Gauge document.");
  }
  return undefined;
}

async function formatActiveGaugeDocument(vscode, options = {}) {
  if (!hasActiveGaugeDocument(vscode)) {
    return notify(vscode, "No Gauge file is active.");
  }
  const document = vscode.window.activeTextEditor.document;
  const provider = new GaugeFormatProvider({
    cli: options.cli,
    createCli: options.createCli,
    env: options.env,
    fileSystem: options.fileSystem,
    projectFactory: options.projectFactory,
    vscode,
  });
  const edits = await provider.provideDocumentFormattingEdits(document);
  return applyDocumentEdits(vscode, document, edits);
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
  return workspaceFolders(vscode).some((folder) => {
    const folderPath = folder.uri.fsPath;
    if (projectFactory.isGaugeProject(folderPath)) {
      return true;
    }
    if (typeof projectFactory.findGaugeProjectRoots === "function") {
      return projectFactory.findGaugeProjectRoots(folderPath).length > 0;
    }
    return false;
  });
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
    clientsMap: options.clientsMap,
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

function registerCodeLensProvider(context, vscode, options) {
  if (!vscode.languages || typeof vscode.languages.registerCodeLensProvider !== "function") {
    return;
  }
  const CodeLensProviderCtor = options.GaugeCodeLensProvider || GaugeCodeLensProvider;
  const provider = new CodeLensProviderCtor({
    vscode,
    projectFactory: options.projectFactory,
  });
  const disposable = vscode.languages.registerCodeLensProvider(
    [
      { language: "gauge" },
      MARKDOWN_GAUGE_SPEC_SELECTOR,
      { language: KOTLIN_LANGUAGE },
      KOTLIN_IMPLEMENTATION_SELECTOR,
      { language: JAVA_LANGUAGE },
      JAVA_IMPLEMENTATION_SELECTOR,
    ],
    provider,
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
  const provider = new FoldingRangeProviderCtor({
    vscode,
    projectFactory: options.projectFactory,
  });
  const disposable = vscode.languages.registerFoldingRangeProvider(
    [
      { language: "gauge" },
      MARKDOWN_GAUGE_SPEC_SELECTOR,
    ],
    provider,
  );
  if (disposable) {
    context.subscriptions.push(disposable);
  }
}

function registerFormatProvider(context, vscode, options) {
  if (!vscode.languages || typeof vscode.languages.registerDocumentFormattingEditProvider !== "function") {
    return;
  }
  const FormatProviderCtor = options.GaugeFormatProvider || GaugeFormatProvider;
  const provider = new FormatProviderCtor({
    cli: options.cli,
    createCli: options.createCli,
    fileSystem: options.fileSystem,
    projectFactory: options.projectFactory,
    vscode,
  });
  const disposable = vscode.languages.registerDocumentFormattingEditProvider(
    [
      { language: "gauge" },
      MARKDOWN_GAUGE_SPEC_SELECTOR,
    ],
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

function registerValidateDiagnosticsProvider(context, vscode, options) {
  const ValidateDiagnosticsProviderCtor = options.GaugeValidateDiagnosticsProvider
    || GaugeValidateDiagnosticsProvider;
  const provider = new ValidateDiagnosticsProviderCtor({
    cli: options.cli,
    env: options.env,
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

function registerRenameProvider(context, vscode, options) {
  const RenameProviderCtor = options.GaugeRenameProvider || GaugeRenameProvider;
  const provider = new RenameProviderCtor({
    clientsMap: options.clientsMap,
    projectFactory: options.projectFactory,
    vscode,
  });
  const disposable = typeof provider.register === "function"
    ? provider.register()
    : (
      vscode.languages
      && typeof vscode.languages.registerRenameProvider === "function"
        ? vscode.languages.registerRenameProvider(
          [
            { language: "gauge" },
            { language: KOTLIN_LANGUAGE },
            { scheme: "file", pattern: "**/*.kt" },
          ],
          provider,
        )
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

function folderPathFromUri(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value.fsPath || value.path;
}

function testUiRunFlags() {
  return { ...TEST_UI_RUN_FLAGS };
}

function isExecutionFlagObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  for (const key of EXECUTION_FLAG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      return true;
    }
  }
  return false;
}

function executionCommandArgs(command, args) {
  if (!TEST_UI_DEFAULT_EXECUTION_COMMANDS.has(command)) {
    return args;
  }
  if (args.length === 1 && isExecutionFlagObject(args[0])) {
    return [undefined, args[0]];
  }
  if (args.length > 1 && isExecutionFlagObject(args[args.length - 1])) {
    return args;
  }
  if (Array.isArray(args[1])) {
    return [args[0], args[1], testUiRunFlags()];
  }
  if (args.length === 0) {
    return [undefined, testUiRunFlags()];
  }
  return [args[0], testUiRunFlags()];
}

function createCommandHandler(command, vscode, executionController, options = {}) {
  return function handleGaugeCommand(...args) {
    if (EXECUTION_COMMANDS.has(command)) {
      return executionController.handleCommand(command, ...executionCommandArgs(command, args));
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
          specDir: folderPathFromUri(args[0]),
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
          specDir: folderPathFromUri(args[0]),
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
        return (options.formatDocument || formatActiveGaugeDocument)(vscode, options);
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
  if (!cli.isGaugeInstalled()) {
    return (options.showInstallGaugeNotification || showInstallGaugeNotification)(vscode);
  }
  if (!cli.isGaugeVersionGreaterOrEqual(MINIMUM_SUPPORTED_GAUGE_VERSION)) {
    return (
      options.showUnsupportedGaugeVersionNotification
      || showUnsupportedGaugeVersionNotification
    )(vscode, MINIMUM_SUPPORTED_GAUGE_VERSION);
  }

  const GaugeClientsCtor = options.GaugeClients || GaugeClients;
  const clientsMap = options.clientsMap || new GaugeClientsCtor();
  (options.showWelcomeNotification || showWelcomeNotification)(context, vscode);
  setActivatedContext(vscode);
  registerGaugeLanguageConfiguration(context, vscode);
  registerGaugeEnterHandler(context, vscode, options);
  registerArgumentCodeActionProvider(context, vscode, options);
  registerDynamicArgumentCompletionProvider(context, vscode, {
    ...options,
    clientsMap,
    projectFactory,
  });
  registerCodeLensProvider(context, vscode, {
    ...options,
    projectFactory,
  });
  registerFoldingRangeProvider(context, vscode, options);
  registerFormatProvider(context, vscode, {
    ...options,
    cli,
    projectFactory,
  });
  registerStepDefinitionProvider(context, vscode, {
    ...options,
    projectFactory,
  });
  registerRenameProvider(context, vscode, {
    ...options,
    clientsMap,
    projectFactory,
  });
  registerStepDiagnosticsProvider(context, vscode, {
    ...options,
    projectFactory,
  });
  registerValidateDiagnosticsProvider(context, vscode, {
    ...options,
    cli,
    projectFactory,
  });
  registerSemanticTokensProvider(context, vscode, options);
  registerSemanticTokenColorUpdates(context, vscode);

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
  const GaugeClientsCtor = options.GaugeClients || GaugeClients;
  const clientsMap = options.clientsMap || new GaugeClientsCtor();
  const serviceOptions = {
    ...options,
    clientsMap,
    projectFactory,
  };
  const GaugeTestControllerCtor = options.GaugeTestController || GaugeTestController;
  const testController = new GaugeTestControllerCtor({ clientsMap, projectFactory, vscode });
  const executionEventSink = typeof testController.createExecutionEventSink === "function"
    ? testController.createExecutionEventSink()
    : undefined;
  const executionController = (options.createExecutionController || createGaugeExecutionController)({
    vscode,
    cli: options.cli,
    createCli: options.createCli,
    executionStatusProvider: options.executionStatusProvider || createGaugeExecutionStatusProvider(
      () => activeClientsMap,
      { vscode },
    ),
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    projectFactory,
    executionEventSink,
    runner: options.runner,
    scenariosProvider: options.scenariosProvider || createGaugeScenariosProvider(
      () => activeClientsMap,
      { vscode },
    ),
    state,
  });
  if (typeof testController.setExecutionController === "function") {
    testController.setExecutionController(executionController);
  }
  if (executionController && typeof executionController.dispose === "function") {
    context.subscriptions.push(executionController);
  }
  const testControllerDisposable = typeof testController.register === "function"
    ? testController.register()
    : undefined;
  if (testControllerDisposable) {
    context.subscriptions.push(testControllerDisposable);
  }
  const ProjectInitializerCtor = options.ProjectInitializer || ProjectInitializer;
  context.subscriptions.push(new ProjectInitializerCtor({
    cli: options.cli,
    createCli: options.createCli || ((cliOptions) => CLI.instance(cliOptions)),
    env: options.env,
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    vscode,
  }));
  const TerminalProviderCtor = options.TerminalProvider || TerminalProvider;
  context.subscriptions.push(new TerminalProviderCtor(context, {
    setTimeout: options.setTimeout,
    vscode,
  }));
  registerDebugConfigurationProvider(context, vscode);

  for (const command of GAUGE_COMMANDS.filter((entry) => !PROVIDER_COMMANDS.has(entry))) {
    const disposable = vscode.commands.registerCommand(
      command,
      createCommandHandler(command, vscode, executionController, serviceOptions),
    );
    context.subscriptions.push(disposable);
  }

  const gaugeWorkspace = startGaugeServices(context, vscode, {
    ...serviceOptions,
    executionController,
    state,
  });
  if (
    gaugeWorkspace
    && typeof gaugeWorkspace.ready === "function"
    && typeof testController.discoverWorkspaceTests === "function"
  ) {
    Promise.resolve(gaugeWorkspace.ready())
      .then(() => testController.discoverWorkspaceTests())
      .catch(() => undefined);
  }
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
