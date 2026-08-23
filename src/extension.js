"use strict";

const { CLI } = require("./cli");
const { GaugeCodeLensProvider } = require("./codeLensProvider");
const {
  GaugeArgumentCodeActionProvider,
  registerArgumentSelectionCommand,
} = require("./argumentCodeActions");
const { ConfigProvider } = require("./config/configProvider");
const { toggleGaugeLineComment } = require("./commentCommand");
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
const { GaugeDocumentSymbolProvider } = require("./documentSymbolProvider");
const { DependencyStepIndex } = require("./dependencyStepIndex");
const { GaugeFoldingRangeProvider } = require("./foldingRangeProvider");
const { GaugeStepCodeActionProvider } = require("./stepCodeActions");
const { GaugeClients } = require("./gaugeClients");
const { ReferenceProvider } = require("./gaugeReference");
const { GaugeState } = require("./gaugeState");
const { GaugeWorkspace } = require("./gaugeWorkspace");
const { ProjectInitializer } = require("./init/projectInit");
const { GaugePreviewController, previewGaugeDocument } = require("./preview");
const { ProjectEnvironmentService } = require("./projectEnvironmentService");
const { createProjectFactory } = require("./project/projectFactory");
const {
  GaugeSemanticTokensProvider,
  createLegend,
} = require("./semanticTokensProvider");
const { GaugeStepDefinitionProvider } = require("./stepDefinitionProvider");
const { GaugeStepDiagnosticsProvider } = require("./stepDiagnostics");
const { GaugeTestController } = require("./testController");
const { TerminalProvider } = require("./terminalProvider");
const {
  GaugeUnusedReferenceDiagnosticsProvider,
} = require("./unusedReferenceDiagnosticsProvider");
const { WorkspaceDocumentStore } = require("./workspaceDocumentStore");
const { WorkspaceStepIndex } = require("./workspaceStepIndex");
const { SpecificationProvider } = require("./specification");
const { GaugeRenameProvider } = require("./renameProvider");
const {
  showInstallGaugeNotification,
  showUnsupportedGaugeVersionNotification,
  showWelcomeNotification,
} = require("./welcomeNotifications");

const MINIMUM_SUPPORTED_GAUGE_VERSION = "0.9.6";
const DIRECT_DEBUG_CONFIGURATION_ERROR = "Starting with the Gauge debug configuration is not supported. Please use the 'Gauge' commands instead.";
const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const JAVA_LANGUAGE = "java";
const KOTLIN_LANGUAGE = "kotlin";
const IMPLEMENTATION_LANGUAGES = new Set([JAVA_LANGUAGE, KOTLIN_LANGUAGE]);
const CODE_LENS_EXECUTION_COMMANDS = new Set([
  "gauge.execute",
  "gauge.debug",
  "gauge.execute.inParallel",
]);
const MARKDOWN_GAUGE_SPEC_SELECTOR = { language: "markdown", scheme: "file", pattern: "**/*.md" };
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_SELECTOR = { scheme: "file", pattern: "**/*.spec" };
const SPEC_FILE_PATTERN = /\.spec$/i;
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const CONCEPT_FILE_SELECTOR = { scheme: "file", pattern: "**/*.cpt" };
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const JAVA_IMPLEMENTATION_SELECTOR = { scheme: "file", pattern: "**/*.java" };
const KOTLIN_IMPLEMENTATION_SELECTOR = { scheme: "file", pattern: "**/*.kt" };
const PROVIDER_COMMANDS = new Set([
  "gauge.createProject",
  "gauge.create.specification",
  "gauge.create.concept",
  "gauge.config.saveRecommended",
  "gauge.extract.concept",
  "gauge.showReferences.atCursor",
  "gauge.specexplorer.debugNode",
  "gauge.specexplorer.runAllActiveProjectSpecs",
  "gauge.specexplorer.runNode",
  "gauge.specexplorer.switchProject",
]);
const GAUGE_WORD_PATTERN = /^(?:[*])([^*].*)$/g;
const GAUGE_BRACKET_PAIRS = [
  ["<", ">"],
  ["\"", "\""],
];
const GAUGE_AUTO_CLOSING_PAIRS = GAUGE_BRACKET_PAIRS.map(([open, close]) => ({
  open,
  close,
}));
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
  "gauge.toggle.lineComment",
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
const EXECUTION_FLAG_KEYS = new Set([
  "debug",
  "failed",
  "hide-suggestion",
  "machine-readable",
  "parallel",
  "repeat",
]);

let activeClientsMap;
let activeGaugeWorkspace;
let activeGaugeWorkspaceDisposal;

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
  if (!hasActiveGaugeDocument(vscode, options.projectFactory)) {
    return notify(vscode, "No Gauge file is active.");
  }
  const document = vscode.window.activeTextEditor.document;
  const provider = new GaugeFormatProvider({
    cli: options.cli,
    createCli: options.createCli,
    env: options.env,
    fileSystem: options.fileSystem,
    projectFactory: options.projectFactory,
    projectEnvironmentService: options.projectEnvironmentService,
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

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function isMarkdownPath(document) {
  return MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document));
}

function isSpecPath(document) {
  return SPEC_FILE_PATTERN.test(documentPath(document));
}

function isConceptPath(document) {
  return CONCEPT_FILE_PATTERN.test(documentPath(document));
}

function isGaugeProjectFile(document, projectFactory) {
  const file = documentPath(document);
  if (
    !document
    || !file
    || !projectFactory
    || typeof projectFactory.getGaugeRootFromFilePath !== "function"
  ) {
    return false;
  }
  try {
    const root = projectFactory.getGaugeRootFromFilePath(file);
    if (!root) {
      return false;
    }
    if (typeof projectFactory.isGaugeProject === "function") {
      return projectFactory.isGaugeProject(root) !== false;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function isMarkdownGaugeSpecDocument(document, projectFactory) {
  if (
    !document
    || !isMarkdownPath(document)
    || ![MARKDOWN_LANGUAGE, "gauge"].includes(document.languageId)
  ) {
    return false;
  }
  return isGaugeProjectFile(document, projectFactory);
}

function hasActiveGaugeDocument(vscode, projectFactory) {
  const editor = vscode.window && vscode.window.activeTextEditor;
  if (!editor || !editor.document) {
    return false;
  }
  if (
    [GAUGE_LANGUAGE, GAUGE_CONCEPT_LANGUAGE].includes(editor.document.languageId)
    && !isMarkdownPath(editor.document)
  ) {
    return true;
  }
  if (isSpecPath(editor.document) || isConceptPath(editor.document)) {
    return isGaugeProjectFile(editor.document, projectFactory);
  }
  return isMarkdownGaugeSpecDocument(editor.document, projectFactory);
}

function hasActiveImplementationGaugeDocument(vscode, projectFactory) {
  const editor = vscode.window && vscode.window.activeTextEditor;
  if (!editor || !editor.document || !IMPLEMENTATION_LANGUAGES.has(editor.document.languageId)) {
    return false;
  }
  try {
    return Boolean(projectFactory.getGaugeRootFromFilePath(editor.document.uri.fsPath));
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
    if (typeof projectFactory.findGaugeProjectRootsAsync === "function") {
      return false;
    }
    if (typeof projectFactory.findGaugeProjectRoots === "function") {
      return projectFactory.findGaugeProjectRoots(folderPath).length > 0;
    }
    return false;
  });
}

async function hasGaugeProjectAsync(vscode, projectFactory) {
  for (const folder of workspaceFolders(vscode)) {
    const folderPath = folder.uri.fsPath;
    try {
      if (projectFactory.isGaugeProject(folderPath)) {
        return true;
      }
      if (typeof projectFactory.findGaugeProjectRootsAsync === "function") {
        const roots = await projectFactory.findGaugeProjectRootsAsync(folderPath);
        if (roots.length > 0) {
          return true;
        }
      }
    } catch (_error) {
      // Continue checking the remaining workspace folders.
    }
  }
  return false;
}

function shouldStartGaugeServices(vscode, projectFactory) {
  return hasActiveGaugeDocument(vscode, projectFactory)
    || hasActiveImplementationGaugeDocument(vscode, projectFactory)
    || hasGaugeProject(vscode, projectFactory);
}

async function shouldStartGaugeServicesAsync(vscode, projectFactory) {
  return shouldStartGaugeServices(vscode, projectFactory)
    || hasGaugeProjectAsync(vscode, projectFactory);
}

function registerGaugeLanguageConfiguration(context, vscode) {
  if (!vscode.languages || typeof vscode.languages.setLanguageConfiguration !== "function") {
    return;
  }
  const configuration = {
    comments: {
      lineComment: "//",
    },
    brackets: GAUGE_BRACKET_PAIRS,
    autoClosingPairs: GAUGE_AUTO_CLOSING_PAIRS,
    surroundingPairs: GAUGE_BRACKET_PAIRS,
    wordPattern: GAUGE_WORD_PATTERN,
  };
  for (const language of [GAUGE_LANGUAGE, GAUGE_CONCEPT_LANGUAGE]) {
    const disposable = vscode.languages.setLanguageConfiguration(language, configuration);
    if (disposable) {
      context.subscriptions.push(disposable);
    }
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
  const provider = new ArgumentCodeActionProviderCtor({
    projectFactory: options.projectFactory,
    vscode,
  });
  const disposable = vscode.languages.registerCodeActionsProvider(
    [
      { language: GAUGE_LANGUAGE },
      { language: GAUGE_CONCEPT_LANGUAGE },
      SPEC_FILE_SELECTOR,
      MARKDOWN_GAUGE_SPEC_SELECTOR,
      CONCEPT_FILE_SELECTOR,
    ],
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

function registerStepCodeActionProvider(context, vscode, options) {
  if (!vscode.languages || typeof vscode.languages.registerCodeActionsProvider !== "function") {
    return;
  }
  const StepCodeActionProviderCtor = options.GaugeStepCodeActionProvider
    || GaugeStepCodeActionProvider;
  const provider = new StepCodeActionProviderCtor({
    projectFactory: options.projectFactory,
    vscode,
  });
  const disposable = vscode.languages.registerCodeActionsProvider(
    [
      { language: GAUGE_LANGUAGE },
      { language: GAUGE_CONCEPT_LANGUAGE },
      SPEC_FILE_SELECTOR,
      MARKDOWN_GAUGE_SPEC_SELECTOR,
      CONCEPT_FILE_SELECTOR,
    ],
    provider,
  );
  if (disposable) {
    context.subscriptions.push(disposable);
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
    documentStore: options.documentStore,
    projectFactory: options.projectFactory,
    vscode,
    workspaceStepIndex: options.workspaceStepIndex,
  });
  const disposable = vscode.languages.registerCompletionItemProvider(
    [
      { language: GAUGE_LANGUAGE },
      { language: GAUGE_CONCEPT_LANGUAGE },
      SPEC_FILE_SELECTOR,
      MARKDOWN_GAUGE_SPEC_SELECTOR,
      CONCEPT_FILE_SELECTOR,
    ],
    provider,
    "*",
    " ",
    "<",
    "\"",
    ":",
    ",",
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
    documentStore: options.documentStore,
    projectFactory: options.projectFactory,
    vscode,
    workspaceStepIndex: options.workspaceStepIndex,
  });
  const disposable = vscode.languages.registerCodeLensProvider(
    [
      { language: GAUGE_LANGUAGE },
      { language: GAUGE_CONCEPT_LANGUAGE },
      SPEC_FILE_SELECTOR,
      CONCEPT_FILE_SELECTOR,
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
      { language: GAUGE_LANGUAGE },
      { language: GAUGE_CONCEPT_LANGUAGE },
      SPEC_FILE_SELECTOR,
      MARKDOWN_GAUGE_SPEC_SELECTOR,
      CONCEPT_FILE_SELECTOR,
    ],
    provider,
  );
  if (disposable) {
    context.subscriptions.push(disposable);
  }
}

function registerDocumentSymbolProvider(context, vscode, options) {
  if (!vscode.languages) {
    return;
  }
  const hasDocumentSymbols = typeof vscode.languages.registerDocumentSymbolProvider === "function";
  const hasWorkspaceSymbols = typeof vscode.languages.registerWorkspaceSymbolProvider === "function";
  if (!hasDocumentSymbols && !hasWorkspaceSymbols) {
    return;
  }
  const DocumentSymbolProviderCtor = options.GaugeDocumentSymbolProvider || GaugeDocumentSymbolProvider;
  const provider = new DocumentSymbolProviderCtor({
    documentStore: options.documentStore,
    projectFactory: options.projectFactory,
    vscode,
  });
  if (hasDocumentSymbols) {
    const disposable = vscode.languages.registerDocumentSymbolProvider(
      [
        { language: GAUGE_LANGUAGE },
        { language: GAUGE_CONCEPT_LANGUAGE },
        SPEC_FILE_SELECTOR,
        MARKDOWN_GAUGE_SPEC_SELECTOR,
        CONCEPT_FILE_SELECTOR,
      ],
      provider,
    );
    if (disposable) {
      context.subscriptions.push(disposable);
    }
  }
  if (hasWorkspaceSymbols) {
    const disposable = vscode.languages.registerWorkspaceSymbolProvider(provider);
    if (disposable) {
      context.subscriptions.push(disposable);
    }
  }
  if (typeof provider.dispose === "function") {
    context.subscriptions.push(provider);
  }
}

function registerStepDiagnosticsProvider(context, vscode, options) {
  const StepDiagnosticsProviderCtor = options.GaugeStepDiagnosticsProvider || GaugeStepDiagnosticsProvider;
  const provider = options.stepDiagnosticsProvider || new StepDiagnosticsProviderCtor({
    dependencyStepIndex: options.dependencyStepIndex,
    documentStore: options.documentStore,
    projectFactory: options.projectFactory,
    vscode,
  });
  const disposable = typeof provider.register === "function" ? provider.register() : undefined;
  if (disposable) {
    context.subscriptions.push(disposable);
  }
  return provider;
}

function registerUnusedReferenceDiagnosticsProvider(context, vscode, options) {
  const UnusedReferenceDiagnosticsProviderCtor = options.GaugeUnusedReferenceDiagnosticsProvider
    || GaugeUnusedReferenceDiagnosticsProvider;
  const provider = new UnusedReferenceDiagnosticsProviderCtor({
    documentStore: options.documentStore,
    vscode,
    workspaceStepIndex: options.workspaceStepIndex,
  });
  const disposable = typeof provider.register === "function" ? provider.register() : undefined;
  if (disposable) {
    context.subscriptions.push(disposable);
  }
  return provider;
}

function registerStepDefinitionProvider(context, vscode, options) {
  const StepDefinitionProviderCtor = options.GaugeStepDefinitionProvider
    || GaugeStepDefinitionProvider;
  const provider = options.stepDefinitionProvider || new StepDefinitionProviderCtor({
    dependencyStepIndex: options.dependencyStepIndex,
    documentStore: options.documentStore,
    projectFactory: options.projectFactory,
    vscode,
    workspaceStepIndex: options.workspaceStepIndex,
  });
  const disposable = typeof provider.register === "function"
    ? provider.register()
    : (
      vscode.languages
      && typeof vscode.languages.registerDefinitionProvider === "function"
        ? vscode.languages.registerDefinitionProvider(
          [
            { language: GAUGE_LANGUAGE },
            { language: GAUGE_CONCEPT_LANGUAGE },
            SPEC_FILE_SELECTOR,
            CONCEPT_FILE_SELECTOR,
            MARKDOWN_GAUGE_SPEC_SELECTOR,
          ],
          provider,
        )
        : undefined
    );
  if (disposable) {
    context.subscriptions.push(disposable);
  }
  return provider;
}

function registerRenameProvider(context, vscode, options) {
  const RenameProviderCtor = options.GaugeRenameProvider || GaugeRenameProvider;
  const provider = new RenameProviderCtor({
    cli: options.cli,
    clientsMap: options.clientsMap,
    documentStore: options.documentStore,
    projectFactory: options.projectFactory,
    vscode,
    workspaceStepIndex: options.workspaceStepIndex,
  });
  const disposable = typeof provider.register === "function"
    ? provider.register()
    : (
      vscode.languages
      && typeof vscode.languages.registerRenameProvider === "function"
        ? vscode.languages.registerRenameProvider(
          [
            { language: GAUGE_LANGUAGE },
            { language: GAUGE_CONCEPT_LANGUAGE },
            SPEC_FILE_SELECTOR,
            CONCEPT_FILE_SELECTOR,
            MARKDOWN_GAUGE_SPEC_SELECTOR,
            { language: KOTLIN_LANGUAGE },
            KOTLIN_IMPLEMENTATION_SELECTOR,
            { language: JAVA_LANGUAGE },
            JAVA_IMPLEMENTATION_SELECTOR,
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
  const provider = new SemanticTokensProviderCtor({
    projectFactory: options.projectFactory,
    vscode,
    legend,
  });
  const disposable = vscode.languages.registerDocumentSemanticTokensProvider(
    [
      { language: GAUGE_LANGUAGE },
      { language: GAUGE_CONCEPT_LANGUAGE },
      SPEC_FILE_SELECTOR,
      MARKDOWN_GAUGE_SPEC_SELECTOR,
      CONCEPT_FILE_SELECTOR,
    ],
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
  const current = typeof editorConfig.get === "function"
    ? editorConfig.get("semanticTokenColorCustomizations")
    : undefined;
  if (semanticTokenRulesEqual(current && current.rules, rules)) {
    return undefined;
  }
  return editorConfig.update(
    "semanticTokenColorCustomizations",
    { rules },
    vscode.ConfigurationTarget && vscode.ConfigurationTarget.Global,
  );
}

function semanticTokenRulesEqual(currentRules, desiredRules) {
  if (!currentRules || typeof currentRules !== "object") {
    return false;
  }
  const currentKeys = Object.keys(currentRules);
  const desiredKeys = Object.keys(desiredRules);
  if (currentKeys.length !== desiredKeys.length) {
    return false;
  }
  return desiredKeys.every((key) => {
    const current = currentRules[key];
    const desired = desiredRules[key];
    return current
      && typeof current === "object"
      && Object.keys(current).length === 1
      && current.foreground === desired.foreground;
  });
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

function executionCommandArgs(_command, args) {
  if (args.length === 1 && isExecutionFlagObject(args[0])) {
    return [undefined, args[0]];
  }
  return args;
}

function createCommandHandler(command, vscode, executionController, options = {}) {
  return function handleGaugeCommand(...args) {
    if (EXECUTION_COMMANDS.has(command)) {
      if (
        CODE_LENS_EXECUTION_COMMANDS.has(command)
        && args.length === 1
        && typeof args[0] === "string"
        && options.testController
        && typeof options.testController.runCodeLensTarget === "function"
      ) {
        return options.testController.runCodeLensTarget(command, args[0]);
      }
      return executionController.handleCommand(command, ...executionCommandArgs(command, args));
    }

    switch (command) {
      case "gauge.preview":
        if (options.createPreview) {
          return options.createPreview({
            vscode,
            cli: options.cli,
            createCli: options.createCli,
            env: options.env,
            fileSystem: options.fileSystem,
            pathModule: options.pathModule,
            projectEnvironmentService: options.projectEnvironmentService,
            projectFactory: options.projectFactory,
            tempDirProvider: options.tempDirProvider,
          });
        }
        if (options.previewController
          && typeof options.previewController.preview === "function") {
          return options.previewController.preview();
        }
        return previewGaugeDocument({
          vscode,
          cli: options.cli,
          createCli: options.createCli,
          env: options.env,
          fileSystem: options.fileSystem,
          pathModule: options.pathModule,
          projectEnvironmentService: options.projectEnvironmentService,
          projectFactory: options.projectFactory,
          tempDirProvider: options.tempDirProvider,
        });
      case "gauge.format":
        return (options.formatDocument || formatActiveGaugeDocument)(vscode, options);
      case "gauge.toggle.lineComment":
        return (options.toggleLineComment || toggleGaugeLineComment)(vscode, options);
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
  if (!options.gaugeServiceGateResolved && !shouldStartGaugeServices(vscode, projectFactory)) {
    if (typeof projectFactory.findGaugeProjectRootsAsync !== "function") {
      return undefined;
    }
    return shouldStartGaugeServicesAsync(vscode, projectFactory).then((shouldStart) => (
      shouldStart
        ? startGaugeServices(context, vscode, {
          ...options,
          gaugeServiceGateResolved: true,
          projectFactory,
        })
        : undefined
    ));
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
  const DependencyStepIndexCtor = options.DependencyStepIndex || DependencyStepIndex;
  const dependencyStepIndex = options.dependencyStepIndex || new DependencyStepIndexCtor({
    cli,
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    projectFactory,
    projectEnvironmentService: options.projectEnvironmentService,
    vscode,
  });
  const dependencyStepIndexDisposable = typeof dependencyStepIndex.register === "function"
    ? dependencyStepIndex.register()
    : undefined;
  if (dependencyStepIndexDisposable) {
    context.subscriptions.push(dependencyStepIndexDisposable);
  }
  (options.showWelcomeNotification || showWelcomeNotification)(context, vscode);
  registerDebugConfigurationProvider(context, vscode);
  registerGaugeLanguageConfiguration(context, vscode);
  const WorkspaceDocumentStoreCtor = options.WorkspaceDocumentStore || WorkspaceDocumentStore;
  const documentStore = options.documentStore || new WorkspaceDocumentStoreCtor({
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    projectFactory,
    vscode,
  });
  if (!options.documentStore) {
    context.subscriptions.push(documentStore);
  }
  documentStore.start();
  const StepDiagnosticsProviderCtor = options.GaugeStepDiagnosticsProvider
    || GaugeStepDiagnosticsProvider;
  const stepDiagnosticsProvider = options.stepDiagnosticsProvider
    || new StepDiagnosticsProviderCtor({
      dependencyStepIndex,
      documentStore,
      projectFactory,
      vscode,
    });
  const WorkspaceStepIndexCtor = options.WorkspaceStepIndex || WorkspaceStepIndex;
  const workspaceStepIndex = options.workspaceStepIndex || new WorkspaceStepIndexCtor({
    diagnosticsProvider: stepDiagnosticsProvider,
    documentStore,
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    projectFactory,
    vscode,
  });
  if (!options.workspaceStepIndex) {
    context.subscriptions.push(workspaceStepIndex);
  }
  workspaceStepIndex.start();
  registerDynamicArgumentCompletionProvider(context, vscode, {
    ...options,
    clientsMap,
    documentStore,
    projectFactory,
    workspaceStepIndex,
  });
  registerCodeLensProvider(context, vscode, {
    ...options,
    documentStore,
    projectFactory,
    workspaceStepIndex,
  });
  registerFoldingRangeProvider(context, vscode, {
    ...options,
    projectFactory,
  });
  registerDocumentSymbolProvider(context, vscode, {
    ...options,
    documentStore,
    projectFactory,
  });
  const stepDefinitionProvider = registerStepDefinitionProvider(context, vscode, {
    ...options,
    dependencyStepIndex,
    documentStore,
    projectFactory,
    workspaceStepIndex,
  });
  registerRenameProvider(context, vscode, {
    ...options,
    clientsMap,
    cli,
    documentStore,
    projectFactory,
    workspaceStepIndex,
  });
  registerStepDiagnosticsProvider(context, vscode, {
    ...options,
    dependencyStepIndex,
    documentStore,
    projectFactory,
    stepDiagnosticsProvider,
    workspaceStepIndex,
  });
  registerUnusedReferenceDiagnosticsProvider(context, vscode, {
    ...options,
    documentStore,
    workspaceStepIndex,
  });
  registerSemanticTokensProvider(context, vscode, {
    ...options,
    projectFactory,
  });
  registerSemanticTokenColorUpdates(context, vscode);

  const state = createGaugeState(context, options);
  const GaugeWorkspaceCtor = options.GaugeWorkspace || GaugeWorkspace;
  const ReferenceProviderCtor = options.ReferenceProvider || ReferenceProvider;
  const ExtractConceptCommandProviderCtor = options.ExtractConceptCommandProvider
    || ExtractConceptCommandProvider;
  const GenerateStubCommandProviderCtor = options.GenerateStubCommandProvider || GenerateStubCommandProvider;
  const SpecNodeProviderCtor = options.SpecNodeProvider || SpecNodeProvider;
  const ConfigProviderCtor = options.ConfigProvider || ConfigProvider;
  const gaugeWorkspace = new GaugeWorkspaceCtor({
    cli,
    clientsMap,
    dependencyStepIndex,
    documentStore,
    localDefinitionOwnedExternally: true,
    env: options.env,
    execSync: options.execSync,
    fileSystem: options.fileSystem,
    LanguageClient: options.LanguageClient,
    pathModule: options.pathModule,
    projectFactory,
    projectEnvironmentService: options.projectEnvironmentService,
    RevealOutputChannelOn: options.RevealOutputChannelOn,
    state,
    stepDefinitionProvider,
    stepDiagnosticsProvider,
    vscode,
  });
  const referenceProvider = new ReferenceProviderCtor(clientsMap, {
    documentStore,
    projectFactory,
    vscode,
    workspaceStepIndex,
  });
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
  const configProvider = new ConfigProviderCtor(context, { vscode });
  activeClientsMap = clientsMap;
  activeGaugeWorkspace = gaugeWorkspace;
  activeGaugeWorkspaceDisposal = undefined;
  context.subscriptions.push(
    gaugeWorkspace,
    referenceProvider,
    extractConceptProvider,
    generateStubProvider,
    specNodeProvider,
    configProvider,
  );
  return gaugeWorkspace;
}

function activate(context, vscodeApi, options = {}) {
  const vscode = getVscode(vscodeApi);
  const baseCreateCli = options.createCli || ((cliOptions) => CLI.instance(cliOptions));
  let sharedCli = options.cli;
  let sharedCliResolved = options.cli !== undefined;
  const sharedCreateCli = (cliOptions) => {
    if (!sharedCliResolved) {
      sharedCliResolved = true;
      sharedCli = baseCreateCli(cliOptions);
    }
    return sharedCli;
  };
  options = { ...options, createCli: sharedCreateCli };
  const state = createGaugeState(context, options);
  const projectFactory = options.projectFactory || createProjectFactory({
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    vscode,
  });
  const ProjectEnvironmentServiceCtor = options.ProjectEnvironmentService
    || ProjectEnvironmentService;
  const projectEnvironmentService = options.projectEnvironmentService
    || new ProjectEnvironmentServiceCtor({
      projectFactory,
      vscode,
    });
  if (!options.projectEnvironmentService) {
    context.subscriptions.push(projectEnvironmentService);
  }
  const GaugeClientsCtor = options.GaugeClients || GaugeClients;
  const clientsMap = options.clientsMap || new GaugeClientsCtor();
  const GaugePreviewControllerCtor = options.GaugePreviewController || GaugePreviewController;
  const previewController = options.previewController || new GaugePreviewControllerCtor({
    cli: options.cli,
    createCli: options.createCli,
    env: options.env,
    fileSystem: options.fileSystem,
    osModule: options.osModule,
    pathModule: options.pathModule,
    projectEnvironmentService,
    projectFactory,
    tempDirProvider: options.tempDirProvider,
    vscode,
  });
  if (previewController && typeof previewController.dispose === "function") {
    context.subscriptions.push(previewController);
  }
  const serviceOptions = {
    ...options,
    clientsMap,
    previewController,
    projectFactory,
    projectEnvironmentService,
  };
  const GaugeTestControllerCtor = options.GaugeTestController || GaugeTestController;
  const testController = new GaugeTestControllerCtor({ clientsMap, projectFactory, vscode });
  const commandOptions = { ...serviceOptions, testController };
  const executionEventSink = typeof testController.createExecutionEventSink === "function"
    ? testController.createExecutionEventSink()
    : undefined;
  const ownsExecutionStatusProvider = !options.executionStatusProvider;
  const executionStatusProvider = options.executionStatusProvider || createGaugeExecutionStatusProvider(
    () => activeClientsMap,
    { vscode },
  );
  const ownsScenariosProvider = !options.scenariosProvider;
  const scenariosProvider = options.scenariosProvider || createGaugeScenariosProvider(
    () => activeClientsMap,
    { vscode },
  );
  const executionController = (options.createExecutionController || createGaugeExecutionController)({
    vscode,
    cli: options.cli,
    createCli: options.createCli,
    executionStatusProvider,
    fileSystem: options.fileSystem,
    ownsExecutionStatusProvider,
    ownsScenariosProvider,
    pathModule: options.pathModule,
    projectFactory,
    projectEnvironmentService,
    executionEventSink,
    runner: options.runner,
    scenariosProvider,
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
  registerArgumentCodeActionProvider(context, vscode, serviceOptions);
  registerStepCodeActionProvider(context, vscode, serviceOptions);
  for (const command of GAUGE_COMMANDS) {
    if (command === "gauge.create.specification") {
      const SpecificationProviderCtor = options.SpecificationProvider || SpecificationProvider;
      const specificationProvider = new SpecificationProviderCtor(
        () => clientsMap,
        {
          createConcept: options.createConcept,
          createSpecification: options.createSpecification,
          date: options.date,
          eol: options.eol,
          fileSystem: options.fileSystem,
          getProjects() {
            if (!clientsMap || typeof clientsMap.keys !== "function") {
              return undefined;
            }
            const projects = Array.from(clientsMap.keys()).filter(Boolean);
            return projects.length > 0 ? projects : undefined;
          },
          pathModule: options.pathModule,
          specDirsProvider: options.specDirsProvider,
          user: options.user,
          vscode,
        },
      );
      context.subscriptions.push(specificationProvider);
      continue;
    }
    if (PROVIDER_COMMANDS.has(command)) {
      continue;
    }
    const disposable = vscode.commands.registerCommand(
      command,
      createCommandHandler(command, vscode, executionController, commandOptions),
    );
    context.subscriptions.push(disposable);
  }

  const gaugeWorkspace = startGaugeServices(context, vscode, {
    ...serviceOptions,
    executionController,
    state,
  });
  const connectGaugeWorkspace = (resolvedWorkspace) => {
    if (
      resolvedWorkspace
      && typeof testController.registerProjectChangeListener === "function"
    ) {
      const disposable = testController.registerProjectChangeListener(resolvedWorkspace);
      if (disposable) {
        context.subscriptions.push(disposable);
      }
    }
    if (
      resolvedWorkspace
      && typeof resolvedWorkspace.ready === "function"
      && typeof testController.discoverWorkspaceTests === "function"
    ) {
      Promise.resolve(resolvedWorkspace.ready())
        .then(() => testController.discoverWorkspaceTests())
        .catch(() => undefined);
    }
  };
  if (gaugeWorkspace && typeof gaugeWorkspace.then === "function") {
    return Promise.resolve(gaugeWorkspace).then(connectGaugeWorkspace);
  }
  connectGaugeWorkspace(gaugeWorkspace);
  return undefined;
}

function deactivate() {
  if (activeGaugeWorkspaceDisposal) {
    return activeGaugeWorkspaceDisposal;
  }
  const gaugeWorkspace = activeGaugeWorkspace;
  activeGaugeWorkspace = undefined;
  activeClientsMap = undefined;
  if (!gaugeWorkspace || typeof gaugeWorkspace.dispose !== "function") {
    activeGaugeWorkspaceDisposal = Promise.resolve(undefined);
    return activeGaugeWorkspaceDisposal;
  }
  let resolveDisposal;
  let rejectDisposal;
  activeGaugeWorkspaceDisposal = new Promise((resolve, reject) => {
    resolveDisposal = resolve;
    rejectDisposal = reject;
  });
  try {
    Promise.resolve(gaugeWorkspace.dispose()).then(
      () => resolveDisposal(undefined),
      rejectDisposal,
    );
  } catch (error) {
    rejectDisposal(error);
  }
  return activeGaugeWorkspaceDisposal;
}

module.exports = {
  GAUGE_COMMANDS,
  activate,
  deactivate,
};
