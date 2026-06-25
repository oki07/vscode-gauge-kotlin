"use strict";

const { CLI } = require("./cli");
const { EXECUTION_COMMANDS, createGaugeExecutionController } = require("./execution/executor");
const { GaugeClients } = require("./gaugeClients");
const { ReferenceProvider } = require("./gaugeReference");
const { GaugeWorkspace } = require("./gaugeWorkspace");
const { createProjectFactory } = require("./project/projectFactory");
const { createSpecification } = require("./specification");

const MINIMUM_SUPPORTED_GAUGE_VERSION = "0.9.6";
const PROVIDER_COMMANDS = new Set(["gauge.showReferences.atCursor"]);
const GAUGE_WORD_PATTERN = /^(?:[*])([^*].*)$/g;

const GAUGE_COMMANDS = [
  "gauge.createProject",
  "gauge.create.specification",
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

function hasGaugeProject(vscode, projectFactory) {
  return workspaceFolders(vscode).some((folder) => projectFactory.isGaugeProject(folder.uri.fsPath));
}

function shouldStartGaugeServices(vscode, projectFactory) {
  return hasActiveGaugeDocument(vscode) || hasGaugeProject(vscode, projectFactory);
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
        });
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
    return notify(vscode, "Gauge is not installed or does not meet the minimum supported version.");
  }

  setActivatedContext(vscode);
  registerGaugeLanguageConfiguration(context, vscode);

  const GaugeClientsCtor = options.GaugeClients || GaugeClients;
  const clientsMap = options.clientsMap || new GaugeClientsCtor();
  const GaugeWorkspaceCtor = options.GaugeWorkspace || GaugeWorkspace;
  const ReferenceProviderCtor = options.ReferenceProvider || ReferenceProvider;
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
    state: options.state,
    vscode,
  });
  const referenceProvider = new ReferenceProviderCtor(clientsMap, { vscode });
  activeClientsMap = clientsMap;
  context.subscriptions.push(gaugeWorkspace, referenceProvider);
  return gaugeWorkspace;
}

function activate(context, vscodeApi, options = {}) {
  const vscode = getVscode(vscodeApi);
  const executionController = (options.createExecutionController || createGaugeExecutionController)({
    vscode,
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    runner: options.runner,
  });

  for (const command of GAUGE_COMMANDS.filter((entry) => !PROVIDER_COMMANDS.has(entry))) {
    const disposable = vscode.commands.registerCommand(
      command,
      createCommandHandler(command, vscode, executionController, options),
    );
    context.subscriptions.push(disposable);
  }

  startGaugeServices(context, vscode, options);
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
