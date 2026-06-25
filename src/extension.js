"use strict";

const { createSpecification } = require("./specification");

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

function getVscode(vscodeApi) {
  return vscodeApi || require("vscode");
}

function notify(vscode, message) {
  if (vscode.window && typeof vscode.window.showInformationMessage === "function") {
    return vscode.window.showInformationMessage(message);
  }
  return undefined;
}

function createCommandHandler(command, vscode, options = {}) {
  return function handleGaugeCommand() {
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

function activate(context, vscodeApi, options = {}) {
  const vscode = getVscode(vscodeApi);

  if (vscode.commands && typeof vscode.commands.executeCommand === "function") {
    vscode.commands.executeCommand("setContext", "gauge:activated", true);
  }

  for (const command of GAUGE_COMMANDS) {
    const disposable = vscode.commands.registerCommand(
      command,
      createCommandHandler(command, vscode, options),
    );
    context.subscriptions.push(disposable);
  }
}

function deactivate() {}

module.exports = {
  GAUGE_COMMANDS,
  activate,
  deactivate,
};
