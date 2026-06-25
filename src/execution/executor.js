"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { createGaugeDebugger } = require("./debug");
const {
  DebuggerAttachedEventProcessor,
  DebuggerNotAttachedEventProcessor,
  ReportEventProcessor,
} = require("./lineProcessors");
const { createGaugeProcessRunner } = require("./processRunner");
const { buildRunArgs, extractGaugeRunOption } = require("./runArgs");
const { createProjectFactory } = require("../project/projectFactory");

const SPEC_EXTENSIONS = new Set([".spec", ".md"]);

const EXECUTION_COMMANDS = new Set([
  "gauge.execute",
  "gauge.debug",
  "gauge.execute.inParallel",
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

function getProjectRootForSpec(vscode, spec, pathModule, projectFactory) {
  if (projectFactory && typeof projectFactory.getGaugeRootFromFilePath === "function") {
    try {
      return projectFactory.getGaugeRootFromFilePath(spec);
    } catch (_error) {
      // Fall back to workspace folders for non-Gauge files or lightweight tests.
    }
  }
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

function memoryReportState(initialReportPath) {
  let reportPath = initialReportPath;
  return {
    setReportPath(nextReportPath) {
      reportPath = nextReportPath;
      return undefined;
    },
    getReportPath() {
      return reportPath;
    },
  };
}

function createGaugeExecutionController(options = {}) {
  const vscode = options.vscode || require("vscode");
  const pathModule = options.pathModule || nodePath;
  const fileSystem = options.fileSystem || nodeFs;
  const projectFactory = options.projectFactory || createProjectFactory({
    fileSystem,
    pathModule,
    vscode,
  });
  const scenariosProvider = options.scenariosProvider || (async () => []);
  const debuggerFactory = options.debuggerFactory || createGaugeDebugger;
  const opener = options.opener || defaultOpener(vscode);
  const reportState = options.state || memoryReportState(options.reportPath);
  let executing = false;
  let activeRun;
  let activeDebugger;

  function setReportPath(nextReportPath) {
    return reportState.setReportPath(nextReportPath && nextReportPath.trim());
  }

  function getReportPath() {
    return reportState.getReportPath();
  }

  let lineProcessors;

  function processOutputLine(lineText) {
    for (const processor of lineProcessors) {
      processor.process(lineText, activeDebugger);
    }
  }

  const runner = options.runner || createGaugeProcessRunner({
    vscode,
    pathModule,
    outputChannel: options.outputChannel,
    processOutputLine,
    spawn: options.spawn,
    env: options.env,
  });

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

    if (flags.debug) {
      activeDebugger = debuggerFactory({
        vscode,
        projectRoot,
        language: options.language || "kotlin",
        baseEnv: options.env || process.env,
        debugPortProvider: options.debugPortProvider,
      });
      command.env = await activeDebugger.addDebugEnv(options.env || process.env);
    }

    executing = true;
    try {
      activeRun = runner(command);
      return await activeRun;
    } finally {
      executing = false;
      activeRun = undefined;
      activeDebugger = undefined;
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

    const projectRoot = getProjectRootForSpec(vscode, spec, pathModule, projectFactory);
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

  async function executeAllSpecifications(projectRoot) {
    const selectedProjectRoot = projectRoot || (await selectProjectRoot(vscode, pathModule));
    if (!selectedProjectRoot) {
      return undefined;
    }
    return executeInProject(selectedProjectRoot, null, {
      status: pathModule.join(selectedProjectRoot, "All specs"),
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
    const projectRoot = getProjectRootForSpec(vscode, specPath, pathModule, projectFactory);
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
    let scenarios;
    try {
      scenarios = await scenariosProvider({
        projectRoot: context.projectRoot,
        spec: context.spec,
        position,
        atCursor,
      });
    } catch (_error) {
      return vscode.window.showErrorMessage(
        `found some problems in ${context.spec}. Fix all problems before running scenarios.`,
      );
    }

    if (atCursor && !Array.isArray(scenarios)) {
      return executeScenarioIdentifier(scenarios.executionIdentifier);
    }
    return chooseAndExecuteScenario(scenarios);
  }

  async function stopExecution() {
    if (activeRun && typeof activeRun.cancel === "function") {
      if (activeDebugger && typeof activeDebugger.stopDebugger === "function") {
        activeDebugger.stopDebugger();
      }
      return activeRun.cancel();
    }
    return undefined;
  }

  lineProcessors = [
    new ReportEventProcessor({ setReportPath }),
    new DebuggerAttachedEventProcessor({ cancel: stopExecution }, vscode),
    new DebuggerNotAttachedEventProcessor({ cancel: stopExecution }, vscode),
  ];

  async function openReport() {
    try {
      return await opener(getReportPath());
    } catch (error) {
      return vscode.window.showErrorMessage(`Can't open html report. ${error}`);
    }
  }

  function getNodeSpec(node) {
    if (!node) {
      return undefined;
    }
    return node.executionIdentifier || node.file;
  }

  function getNodeStatus(node, spec) {
    return (node && node.file) || spec;
  }

  async function executeNode(node, debug) {
    const spec = getNodeSpec(node);
    if (!spec) {
      return undefined;
    }
    const projectRoot = getProjectRootForSpec(
      vscode,
      getScenarioSpecPath(spec),
      pathModule,
      projectFactory,
    );
    if (!projectRoot) {
      return vscode.window.showErrorMessage("No workspace folder is open.");
    }
    return executeInProject(projectRoot, spec, {
      debug,
      status: getNodeStatus(node, spec),
    });
  }

  async function executeCodeLensTarget(spec, flags = {}) {
    if (!spec) {
      return undefined;
    }
    const projectRoot = getProjectRootForSpec(
      vscode,
      getScenarioSpecPath(spec),
      pathModule,
      projectFactory,
    );
    if (!projectRoot) {
      return vscode.window.showErrorMessage("No workspace folder is open.");
    }
    return executeInProject(projectRoot, spec, {
      ...flags,
      status: spec,
    });
  }

  function handleCommand(command, argument) {
    switch (command) {
      case "gauge.execute":
        return executeCodeLensTarget(argument);
      case "gauge.debug":
        return executeCodeLensTarget(argument, { debug: true });
      case "gauge.execute.inParallel":
        return executeCodeLensTarget(argument, { parallel: true });
      case "gauge.execute.specification":
        return executeActiveSpecification();
      case "gauge.execute.specification.all":
        return executeAllSpecifications();
      case "gauge.specexplorer.runAllActiveProjectSpecs":
        return executeAllSpecifications(argument && argument.projectRoot);
      case "gauge.execute.failed":
        return executeFailed();
      case "gauge.execute.repeat":
        return repeatExecution();
      case "gauge.execute.scenario":
        return executeScenario(true);
      case "gauge.execute.scenarios":
        return executeScenario(false);
      case "gauge.specexplorer.runNode":
        return executeNode(argument, false);
      case "gauge.specexplorer.debugNode":
        return executeNode(argument, true);
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
