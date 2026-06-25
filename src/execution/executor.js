"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { ReportEventProcessor } = require("./lineProcessors");
const { buildRunArgs, extractGaugeRunOption } = require("./runArgs");

const SPEC_EXTENSIONS = new Set([".spec", ".md"]);

const EXECUTION_COMMANDS = new Set([
  "gauge.stopExecution",
  "gauge.execute.failed",
  "gauge.execute.repeat",
  "gauge.execute.specification",
  "gauge.execute.specification.all",
  "gauge.specexplorer.runAllActiveProjectSpecs",
  "gauge.specexplorer.runNode",
  "gauge.specexplorer.debugNode",
  "gauge.execute.scenario",
  "gauge.execute.scenarios",
  "gauge.report.html",
]);

function getWorkspaceRoots(vscode) {
  const folders = vscode.workspace && vscode.workspace.workspaceFolders;
  if (!folders) {
    return [];
  }
  return folders
    .map((folder) => {
      const uri = folder.uri || {};
      return uri.fsPath || uri.path;
    })
    .filter(Boolean);
}

function isInside(root, filename, pathModule) {
  const relative = pathModule.relative(root, filename);
  return relative === "" || (!relative.startsWith("..") && !pathModule.isAbsolute(relative));
}

function getProjectRootForSpec(vscode, spec, pathModule) {
  const roots = getWorkspaceRoots(vscode);
  return roots.find((root) => isInside(root, spec, pathModule)) || roots[0];
}

async function selectProjectRoot(vscode, pathModule) {
  const roots = getWorkspaceRoots(vscode);
  if (roots.length === 0) {
    return undefined;
  }
  if (roots.length === 1 || !vscode.window.showQuickPick) {
    return roots[0];
  }

  const items = roots.map((root) => ({
    label: pathModule.basename(root),
    description: root,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: false,
    placeHolder: "Choose a project",
  });
  if (!selected) {
    return undefined;
  }
  return selected.description || selected;
}

function detectProjectKind(projectRoot, fileSystem, pathModule) {
  const exists = (relativePath) => (
    typeof fileSystem.existsSync === "function"
    && fileSystem.existsSync(pathModule.join(projectRoot, relativePath))
  );

  if (exists("build.gradle.kts") || exists("build.gradle") || exists("gradlew")) {
    return "gradle";
  }
  if (exists("pom.xml")) {
    return "maven";
  }
  return "gauge";
}

function commandForProjectKind(projectKind, options) {
  if (projectKind === "gradle") {
    return options.gradleCommand || "gradle";
  }
  if (projectKind === "maven") {
    return options.mavenCommand || "mvn";
  }
  return options.gaugeCommand || "gauge";
}

function getLaunchConfigurations(vscode) {
  if (!vscode.workspace || typeof vscode.workspace.getConfiguration !== "function") {
    return [];
  }
  const configuration = vscode.workspace.getConfiguration("launch");
  if (!configuration || typeof configuration.get !== "function") {
    return [];
  }
  return configuration.get("configurations") || [];
}

function buildArgs(projectKind, projectRoot, spec, option, pathModule) {
  const relativeSpec = spec ? pathModule.relative(projectRoot, spec) : null;
  if (projectKind === "gradle") {
    return buildRunArgs.forGradle(relativeSpec, option);
  }
  if (projectKind === "maven") {
    return buildRunArgs.forMaven(relativeSpec, option);
  }
  return buildRunArgs.forGauge(spec, option);
}

function getScenarioSpecPath(executionIdentifier) {
  const separatorIndex = executionIdentifier.lastIndexOf(":");
  if (separatorIndex < 0) {
    return executionIdentifier;
  }
  return executionIdentifier.slice(0, separatorIndex);
}

function defaultRunner(vscode) {
  return async function runInTerminal(command) {
    if (!vscode.window || typeof vscode.window.createTerminal !== "function") {
      return undefined;
    }
    const terminal = vscode.window.createTerminal({
      name: "Gauge",
      cwd: command.cwd,
    });
    terminal.sendText([command.command, ...command.args].join(" "));
    terminal.show();
    return true;
  };
}

function defaultOpener(vscode) {
  return function openReportPath(reportPath) {
    if (vscode.env && typeof vscode.env.openExternal === "function") {
      if (vscode.Uri && typeof vscode.Uri.file === "function") {
        return vscode.env.openExternal(vscode.Uri.file(reportPath));
      }
      return vscode.env.openExternal(reportPath);
    }
    return Promise.resolve(undefined);
  };
}

function createGaugeExecutionController(options = {}) {
  const vscode = options.vscode || require("vscode");
  const pathModule = options.pathModule || nodePath;
  const fileSystem = options.fileSystem || nodeFs;
  const runner = options.runner || defaultRunner(vscode);
  const scenariosProvider = options.scenariosProvider || (async () => []);
  const opener = options.opener || defaultOpener(vscode);
  let executing = false;
  let activeRun;
  let reportPath = options.reportPath;

  function setReportPath(nextReportPath) {
    reportPath = nextReportPath && nextReportPath.trim();
  }

  function getReportPath() {
    return reportPath;
  }

  const lineProcessors = [
    new ReportEventProcessor({ setReportPath }),
  ];

  function processOutputLine(lineText) {
    for (const processor of lineProcessors) {
      processor.process(lineText);
    }
  }

  async function executeInProject(projectRoot, spec, flags = {}) {
    if (executing) {
      if (vscode.window && typeof vscode.window.showErrorMessage === "function") {
        await vscode.window.showErrorMessage("A Specification or Scenario is still running!");
      }
      return undefined;
    }

    const projectKind = detectProjectKind(projectRoot, fileSystem, pathModule);
    const option = {
      ...extractGaugeRunOption(getLaunchConfigurations(vscode)),
      failed: Boolean(flags.failed),
      repeat: Boolean(flags.repeat),
      parallel: Boolean(flags.parallel),
    };
    if (spec && /:\d+$/.test(spec)) {
      option.tags = null;
      option.scenario = null;
      option["retry-only"] = null;
    }
    const command = {
      command: commandForProjectKind(projectKind, options),
      args: buildArgs(projectKind, projectRoot, spec, option, pathModule),
      cwd: projectRoot,
      status: flags.status || spec || pathModule.join(projectRoot, "All specs"),
    };

    executing = true;
    try {
      activeRun = runner(command);
      return await activeRun;
    } finally {
      executing = false;
      activeRun = undefined;
    }
  }

  function getActiveSpecificationContext(kind) {
    const editor = vscode.window && vscode.window.activeTextEditor;
    if (!editor || !editor.document) {
      return {
        error: "A gauge specification file should be open to run this command.",
      };
    }

    const spec = editor.document.fileName || (editor.document.uri && editor.document.uri.fsPath);
    if (!SPEC_EXTENSIONS.has(pathModule.extname(spec))) {
      return {
        error: `No ${kind} found. Current file is not a gauge specification.`,
      };
    }

    const projectRoot = getProjectRootForSpec(vscode, spec, pathModule);
    if (!projectRoot) {
      return {
        error: "No workspace folder is open.",
      };
    }

    return {
      editor,
      projectRoot,
      spec,
    };
  }

  async function executeActiveSpecification() {
    const context = getActiveSpecificationContext("specification");
    if (context.error) {
      return vscode.window.showErrorMessage(context.error);
    }
    return executeInProject(context.projectRoot, context.spec, { status: context.spec });
  }

  async function executeAllSpecifications() {
    const projectRoot = await selectProjectRoot(vscode, pathModule);
    if (!projectRoot) {
      return undefined;
    }
    return executeInProject(projectRoot, null, {
      status: pathModule.join(projectRoot, "All specs"),
    });
  }

  async function executeFailed() {
    const projectRoot = await selectProjectRoot(vscode, pathModule);
    if (!projectRoot) {
      return undefined;
    }
    return executeInProject(projectRoot, null, {
      failed: true,
      status: pathModule.join(projectRoot, "failed scenarios"),
    });
  }

  async function repeatExecution() {
    const projectRoot = await selectProjectRoot(vscode, pathModule);
    if (!projectRoot) {
      return undefined;
    }
    return executeInProject(projectRoot, null, {
      repeat: true,
      status: pathModule.join(projectRoot, "previous run"),
    });
  }

  function getScenarioQuickPickItems(scenarios) {
    return scenarios.map((scenario) => ({
      label: scenario.heading,
      detail: "Scenario",
    }));
  }

  async function executeScenarioIdentifier(executionIdentifier) {
    const specPath = getScenarioSpecPath(executionIdentifier);
    const projectRoot = getProjectRootForSpec(vscode, specPath, pathModule);
    if (!projectRoot) {
      return vscode.window.showErrorMessage("No workspace folder is open.");
    }
    return executeInProject(projectRoot, executionIdentifier, {
      status: executionIdentifier,
    });
  }

  async function chooseAndExecuteScenario(scenarios) {
    if (!Array.isArray(scenarios) || scenarios.length === 0) {
      return undefined;
    }
    const selected = await vscode.window.showQuickPick(getScenarioQuickPickItems(scenarios));
    if (!selected) {
      return undefined;
    }
    const scenario = scenarios.find((entry) => entry.heading === selected.label);
    if (!scenario) {
      return undefined;
    }
    return executeScenarioIdentifier(scenario.executionIdentifier);
  }

  async function executeScenario(atCursor) {
    const context = getActiveSpecificationContext("scenario(s)");
    if (context.error) {
      return vscode.window.showErrorMessage(context.error);
    }

    const position = atCursor
      ? (context.editor.selection && context.editor.selection.active)
      : { line: 1, character: 1 };
    const scenarios = await scenariosProvider({
      projectRoot: context.projectRoot,
      spec: context.spec,
      position,
      atCursor,
    });

    if (atCursor && !Array.isArray(scenarios)) {
      return executeScenarioIdentifier(scenarios.executionIdentifier);
    }
    return chooseAndExecuteScenario(scenarios);
  }

  async function stopExecution() {
    if (activeRun && typeof activeRun.cancel === "function") {
      return activeRun.cancel();
    }
    return undefined;
  }

  async function openReport() {
    try {
      return await opener(getReportPath());
    } catch (error) {
      return vscode.window.showErrorMessage(`Can't open html report. ${error}`);
    }
  }

  function handleCommand(command) {
    switch (command) {
      case "gauge.execute.specification":
        return executeActiveSpecification();
      case "gauge.execute.specification.all":
      case "gauge.specexplorer.runAllActiveProjectSpecs":
        return executeAllSpecifications();
      case "gauge.execute.failed":
        return executeFailed();
      case "gauge.execute.repeat":
        return repeatExecution();
      case "gauge.execute.scenario":
        return executeScenario(true);
      case "gauge.execute.scenarios":
        return executeScenario(false);
      case "gauge.report.html":
        return openReport();
      case "gauge.stopExecution":
        return stopExecution();
      default:
        return undefined;
    }
  }

  return {
    executeActiveSpecification,
    executeAllSpecifications,
    executeFailed,
    executeScenario,
    getReportPath,
    handleCommand,
    openReport,
    processOutputLine,
    repeatExecution,
    setReportPath,
    stopExecution,
  };
}

module.exports = {
  EXECUTION_COMMANDS,
  createGaugeExecutionController,
};
