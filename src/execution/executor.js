"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { createGaugeDebugger } = require("./debug");
const { envWithGaugeHome } = require("../config/gaugeConfig");
const {
  DebuggerAttachedEventProcessor,
  DebuggerNotAttachedEventProcessor,
  MachineReadableEventProcessor,
  ReportEventProcessor,
} = require("./lineProcessors");
const { createGaugeProcessRunner } = require("./processRunner");
const {
  buildRunArgs,
  extractGaugeExecutionOption,
  extractGaugeRunOption,
} = require("./runArgs");
const { CLI } = require("../cli");
const { GradleProject } = require("../project/gradleProject");
const { MavenProject } = require("../project/mavenProject");
const { createProjectFactory } = require("../project/projectFactory");

const BUILD_FILE_GLOB = "**/{build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts,pom.xml}";
const EXECUTION_STATUS_REQUEST = "gauge/executionStatus";
const SPEC_EXTENSIONS = new Set([".spec", ".md"]);
const SHOW_REPORT_COMMAND = "gauge.report.html";
const STOP_EXECUTION_COMMAND = "gauge.stopExecution";
const EXECUTING_CONTEXT = "gauge:executing";
const COMMAND_FLAG_KEYS = [
  "failed",
  "hide-suggestion",
  "machine-readable",
  "parallel",
  "repeat",
];

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
const EXECUTION_TEST_EVENT_TYPES = new Set([
  "suiteStarted",
  "suiteFinished",
  "testFailed",
  "testFinished",
  "testIgnored",
  "testStarted",
]);

function createToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
}

function resolveClientsMap(getClientsMap) {
  return typeof getClientsMap === "function" ? getClientsMap() : getClientsMap;
}

function createGaugeExecutionStatusProvider(getClientsMap, options = {}) {
  const vscode = options.vscode || {};
  return function executionStatusProvider(projectRoot) {
    const clientsMap = resolveClientsMap(getClientsMap);
    const projectClient = clientsMap && typeof clientsMap.get === "function"
      ? clientsMap.get(projectRoot)
      : undefined;
    if (!projectClient || !projectClient.client || typeof projectClient.client.sendRequest !== "function") {
      return undefined;
    }
    return projectClient.client.sendRequest(
      EXECUTION_STATUS_REQUEST,
      {},
      createToken(vscode),
    );
  };
}

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

function isGaugeProjectRoot(projectFactory, root) {
  if (!root) {
    return false;
  }
  if (projectFactory && typeof projectFactory.isGaugeProject === "function") {
    return projectFactory.isGaugeProject(root) !== false;
  }
  return true;
}

function getProjectRootForSpec(vscode, spec, pathModule, projectFactory, allowWorkspaceFallback = true) {
  if (projectFactory && typeof projectFactory.getGaugeRootFromFilePath === "function") {
    try {
      const root = projectFactory.getGaugeRootFromFilePath(spec);
      return isGaugeProjectRoot(projectFactory, root) ? root : undefined;
    } catch (_error) {
      if (!allowWorkspaceFallback) {
        return undefined;
      }
    }
  }
  const roots = getWorkspaceRoots(vscode);
  return roots.find((root) => isInside(root, spec, pathModule)) || roots[0];
}

function uniqueProjectRoots(roots) {
  const seen = new Set();
  return roots.filter((root) => {
    if (!root || seen.has(root)) {
      return false;
    }
    seen.add(root);
    return true;
  });
}

function discoverProjectRoots(workspaceRoot, projectFactory) {
  if (!projectFactory) {
    return [];
  }
  if (typeof projectFactory.findGaugeProjectRoots === "function") {
    try {
      const roots = projectFactory.findGaugeProjectRoots(workspaceRoot);
      return Array.isArray(roots) ? roots.filter(Boolean) : [];
    } catch (_error) {
      return [];
    }
  }
  if (typeof projectFactory.isGaugeProject === "function") {
    try {
      return projectFactory.isGaugeProject(workspaceRoot) ? [workspaceRoot] : [];
    } catch (_error) {
      return [];
    }
  }
  return [];
}

function selectableProjectRoots(vscode, projectFactory) {
  const roots = getWorkspaceRoots(vscode);
  if (!projectFactory) {
    return roots;
  }
  const gaugeRoots = uniqueProjectRoots(
    roots.flatMap((root) => discoverProjectRoots(root, projectFactory)),
  );
  return gaugeRoots.length > 0 ? gaugeRoots : roots;
}

function activeProjectRoot(vscode, projectFactory) {
  if (!projectFactory || typeof projectFactory.getGaugeRootFromFilePath !== "function") {
    return undefined;
  }
  const editor = vscode.window && vscode.window.activeTextEditor;
  const document = editor && editor.document;
  const file = document && (document.fileName || (document.uri && document.uri.fsPath));
  if (!file) {
    return undefined;
  }
  try {
    const root = projectFactory.getGaugeRootFromFilePath(file);
    return isGaugeProjectRoot(projectFactory, root) ? root : undefined;
  } catch (_error) {
    return undefined;
  }
}

async function selectProjectRoot(vscode, pathModule, projectFactory) {
  let roots = selectableProjectRoots(vscode, projectFactory);
  if (roots.length === 0) {
    const activeRoot = activeProjectRoot(vscode, projectFactory);
    roots = activeRoot ? [activeRoot] : roots;
  }
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

function projectKindFromProject(project) {
  if (project && typeof project.executionKind === "function") {
    return project.executionKind();
  }
  if (project instanceof MavenProject) {
    return "maven";
  }
  if (project instanceof GradleProject) {
    return "gradle";
  }
  return undefined;
}

function projectRunnerLanguage(project, fallbackLanguage) {
  if (project && typeof project.language === "function") {
    const language = project.language();
    if (language) {
      return language;
    }
  }
  return fallbackLanguage;
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

function getProjectForExecution(projectFactory, projectRoot) {
  if (!projectFactory || typeof projectFactory.get !== "function") {
    return undefined;
  }
  try {
    return projectFactory.get(projectRoot);
  } catch (_error) {
    return undefined;
  }
}

function resourcePath(resource) {
  if (typeof resource === "string") {
    return resource;
  }
  if (!resource || typeof resource !== "object") {
    return undefined;
  }
  if (resource.executionIdentifier || resource.file) {
    return undefined;
  }
  return resource.fsPath || resource.path;
}

function isSpecPath(filename, pathModule) {
  return Boolean(filename && SPEC_EXTENSIONS.has(pathModule.extname(filename)));
}

function isDirectory(filename, fileSystem) {
  if (!filename || !fileSystem || typeof fileSystem.statSync !== "function") {
    return false;
  }
  try {
    const stat = fileSystem.statSync(filename);
    return Boolean(stat && typeof stat.isDirectory === "function" && stat.isDirectory());
  } catch (_error) {
    return false;
  }
}

function directoryContainsSpec(filename, fileSystem, pathModule) {
  if (!fileSystem || typeof fileSystem.readdirSync !== "function") {
    return false;
  }
  try {
    return fileSystem.readdirSync(filename).some((entry) => {
      const entryName = typeof entry === "string" ? entry : entry.name;
      return isSpecPath(entryName, pathModule);
    });
  } catch (_error) {
    return false;
  }
}

function isRunnableDirectory(filename, fileSystem, pathModule) {
  return isDirectory(filename, fileSystem)
    && directoryContainsSpec(filename, fileSystem, pathModule);
}

function uniqueTargets(targets) {
  const seen = new Set();
  const result = [];
  for (const target of targets) {
    if (!target || seen.has(target)) {
      continue;
    }
    seen.add(target);
    result.push(target);
  }
  return result;
}

function commandFromProject(project, cli) {
  if (
    !project
    || !cli
    || typeof project.getExecutionCommand !== "function"
  ) {
    return undefined;
  }
  const command = project.getExecutionCommand(cli);
  if (!command || !command.command) {
    return undefined;
  }
  return command;
}

function projectEnvironment(project, cli) {
  if (!project || typeof project.envs !== "function") {
    return {};
  }
  return project.envs(cli) || {};
}

function projectExecutionEnvironment(project, cli) {
  if (!project || typeof project.executionEnvs !== "function") {
    return projectEnvironment(project, cli);
  }
  return project.executionEnvs(cli);
}

function hasEnvironment(env) {
  return Boolean(env && Object.keys(env).length > 0);
}

function executionCwd(projectRoot, configuredCwd, pathModule) {
  if (typeof configuredCwd !== "string" || !configuredCwd.trim()) {
    return projectRoot;
  }
  const cwd = configuredCwd.trim();
  return pathModule.isAbsolute(cwd) ? cwd : pathModule.join(projectRoot, cwd);
}

function saveWorkspaceDocuments(vscode) {
  if (!vscode.workspace || typeof vscode.workspace.saveAll !== "function") {
    return undefined;
  }
  try {
    return Promise.resolve(vscode.workspace.saveAll(false)).catch(() => undefined);
  } catch (_error) {
    // Match editor runner behavior as a best-effort save before execution.
  }
  return undefined;
}

function getWorkspaceFolderForProject(vscode, projectRoot) {
  if (!vscode.workspace || typeof vscode.workspace.getWorkspaceFolder !== "function") {
    return undefined;
  }
  const uri = vscode.Uri && typeof vscode.Uri.file === "function"
    ? vscode.Uri.file(projectRoot)
    : { fsPath: projectRoot, path: projectRoot };
  return vscode.workspace.getWorkspaceFolder(uri);
}

function getLaunchConfigurations(vscode, projectRoot) {
  if (!vscode.workspace || typeof vscode.workspace.getConfiguration !== "function") {
    return [];
  }
  const workspaceFolder = projectRoot
    ? getWorkspaceFolderForProject(vscode, projectRoot)
    : undefined;
  const configuration = vscode.workspace.getConfiguration("launch", workspaceFolder);
  if (!configuration || typeof configuration.get !== "function") {
    return [];
  }
  return configuration.get("configurations") || [];
}

function statusBarAlignment(vscode) {
  return vscode.StatusBarAlignment && vscode.StatusBarAlignment.Left !== undefined
    ? vscode.StatusBarAlignment.Left
    : 1;
}

function createStatusBarItem(vscode, priority) {
  if (!vscode.window || typeof vscode.window.createStatusBarItem !== "function") {
    return undefined;
  }
  return vscode.window.createStatusBarItem(statusBarAlignment(vscode), priority);
}

function setExecutingContext(vscode, value) {
  if (!vscode.commands || typeof vscode.commands.executeCommand !== "function") {
    return undefined;
  }
  return vscode.commands.executeCommand("setContext", EXECUTING_CONTEXT, value);
}

function formatExecutionTooltip(status) {
  return `Specs : ${status.specsExecuted} Executed, ${status.specsPassed} Passed, `
    + `${status.specsFailed} Failed, ${status.specsSkipped} Skipped\n`
    + `Scenarios : ${status.sceExecuted} Executed, ${status.scePassed} Passed, `
    + `${status.sceFailed} Failed, ${status.sceSkipped} Skipped`;
}

function formatRunningStatus(projectRoot, status, pathModule) {
  if (!status || !pathModule.isAbsolute(status) || !isInside(projectRoot, status, pathModule)) {
    return status;
  }
  return pathModule.relative(projectRoot, status);
}

function executionStatusColor(status) {
  if (status.sceFailed > 0) {
    return "#E73E48";
  }
  if (status.scePassed > 0) {
    return "#66ff66";
  }
  return "#999999";
}

function createExecutionStatusBar(vscode, executionStatusProvider) {
  const stopExecution = createStatusBarItem(vscode, 2);
  const executionStatus = createStatusBarItem(vscode, 1);
  if (!stopExecution || !executionStatus) {
    return {
      afterExecute() {
        return undefined;
      },
      beforeExecute() {},
      dispose() {},
    };
  }

  stopExecution.command = STOP_EXECUTION_COMMAND;
  stopExecution.tooltip = "Click to Stop Run";
  executionStatus.command = SHOW_REPORT_COMMAND;

  return {
    beforeExecute(command, runningStatus) {
      executionStatus.hide();
      if (command.env && command.env.DEBUGGING) {
        return;
      }
      stopExecution.text = `$(primitive-square) Running ${runningStatus || command.status}`;
      stopExecution.show();
    },
    async afterExecute(projectRoot, aborted) {
      stopExecution.hide();
      if (aborted) {
        executionStatus.hide();
        return undefined;
      }
      if (typeof executionStatusProvider !== "function") {
        return undefined;
      }
      let status;
      try {
        status = await executionStatusProvider(projectRoot);
      } catch (_error) {
        return undefined;
      }
      if (!status) {
        return undefined;
      }
      executionStatus.color = executionStatusColor(status);
      executionStatus.text = `$(check) ${status.scePassed}  $(x) ${status.sceFailed}`
        + `  $(issue-opened) ${status.sceSkipped}`;
      executionStatus.tooltip = formatExecutionTooltip(status);
      executionStatus.show();
      return undefined;
    },
    dispose() {
      stopExecution.dispose();
      executionStatus.dispose();
    },
  };
}

function buildArgs(projectKind, projectRoot, spec, option, pathModule) {
  const relativeSpec = Array.isArray(spec)
    ? spec.map((target) => pathModule.relative(projectRoot, target))
    : (spec ? pathModule.relative(projectRoot, spec) : null);
  if (projectKind === "gradle") {
    return buildRunArgs.forGradle(relativeSpec, option);
  }
  if (projectKind === "maven") {
    return buildRunArgs.forMaven(relativeSpec, option);
  }
  return buildRunArgs.forGauge(spec, option);
}

function mergeRunOptions(launchOptions, flags = {}) {
  const option = { ...launchOptions };
  for (const key of COMMAND_FLAG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(flags, key)) {
      option[key] = Boolean(flags[key]);
    }
  }
  return option;
}

function executionRunOptions(launchOptions, flags = {}) {
  const option = mergeRunOptions(launchOptions, flags);
  if (flags.debug) {
    delete option.parallel;
    delete option.n;
  }
  return option;
}

function isExecutionTestEvent(event) {
  return Boolean(event && EXECUTION_TEST_EVENT_TYPES.has(event.type));
}

function unexpectedEndEvents(passed) {
  const name = passed ? "Ignored" : "Failed";
  const resultEvent = passed
    ? {
      type: "testIgnored",
      id: name,
      parentId: "suite",
      name,
      message: " ",
    }
    : {
      type: "testFailed",
      id: name,
      parentId: "suite",
      name,
      message: " ",
    };
  return [
    {
      type: "testStarted",
      id: name,
      parentId: "suite",
      name,
    },
    resultEvent,
    {
      type: "testFinished",
      id: name,
      parentId: "suite",
      name,
    },
  ];
}

function getScenarioSpecPath(executionIdentifier) {
  if (!/:\d+$/.test(executionIdentifier)) {
    return executionIdentifier;
  }
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
  const allowWorkspaceProjectFallback = !options.projectFactory;
  const projectFactory = options.projectFactory || createProjectFactory({
    exec: options.exec,
    execSync: options.execSync,
    fileSystem,
    pathModule,
    vscode,
  });
  const scenariosProvider = options.scenariosProvider || (async () => []);
  const debuggerFactory = options.debuggerFactory || createGaugeDebugger;
  const opener = options.opener || defaultOpener(vscode);
  const reportState = options.state || memoryReportState(options.reportPath);
  const executionStatusBar = createExecutionStatusBar(vscode, options.executionStatusProvider);
  const executionEnv = envWithGaugeHome(options.env || process.env, {
    vscode,
    gaugeHome: options.gaugeHome,
  });
  let executing = false;
  let activeRun;
  let activeDebugger;
  let activeRunUserAborted = false;
  let sawExecutionTestEvent = false;
  let cachedCli;
  const executionEnvCache = new Map();
  let buildFileWatcher;
  if (
    vscode.workspace
    && typeof vscode.workspace.createFileSystemWatcher === "function"
  ) {
    try {
      buildFileWatcher = vscode.workspace.createFileSystemWatcher(BUILD_FILE_GLOB);
      const clearExecutionEnvCache = () => executionEnvCache.clear();
      if (typeof buildFileWatcher.onDidCreate === "function") {
        buildFileWatcher.onDidCreate(clearExecutionEnvCache);
      }
      if (typeof buildFileWatcher.onDidChange === "function") {
        buildFileWatcher.onDidChange(clearExecutionEnvCache);
      }
      if (typeof buildFileWatcher.onDidDelete === "function") {
        buildFileWatcher.onDidDelete(clearExecutionEnvCache);
      }
    } catch (_error) {
      buildFileWatcher = undefined;
    }
  }

  async function resolveBuildToolExecutionEnvironment(project, cli, projectRoot) {
    const cached = executionEnvCache.get(projectRoot);
    const env = await project.executionEnvsAsync(cli, cached);
    if (env) {
      executionEnvCache.set(projectRoot, env);
    } else {
      executionEnvCache.delete(projectRoot);
    }
    return env;
  }

  function setReportPath(nextReportPath) {
    return reportState.setReportPath(nextReportPath && nextReportPath.trim());
  }

  function getReportPath() {
    return reportState.getReportPath();
  }

  function getCli() {
    if (options.cli) {
      return options.cli;
    }
    if (cachedCli !== undefined) {
      return cachedCli;
    }
    const cliFactory = options.createCli || ((cliOptions) => CLI.instance(cliOptions));
    cachedCli = cliFactory({ vscode });
    return cachedCli;
  }

  let lineProcessors;

  function emitExecutionEvent(event) {
    if (isExecutionTestEvent(event)) {
      sawExecutionTestEvent = true;
    }
    if (typeof options.executionEventSink === "function") {
      options.executionEventSink(event);
    }
  }

  function emitUnexpectedEndEvents(passed) {
    for (const event of unexpectedEndEvents(passed)) {
      emitExecutionEvent(event);
    }
  }

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
    env: executionEnv,
  });

  async function executeInProject(projectRoot, spec, flags = {}) {
    if (executing) {
      if (vscode.window && typeof vscode.window.showErrorMessage === "function") {
        await vscode.window.showErrorMessage("A Specification or Scenario is still running!");
      }
      return undefined;
    }

    executing = true;
    activeRunUserAborted = false;
    sawExecutionTestEvent = false;
    let result;
    try {
      setExecutingContext(vscode, true);
      const savePromise = saveWorkspaceDocuments(vscode);
      if (savePromise) {
        await savePromise;
      }

      const project = getProjectForExecution(projectFactory, projectRoot);
      const projectKind = projectKindFromProject(project)
        || detectProjectKind(projectRoot, fileSystem, pathModule);
      const cli = getCli();
      const executionTool = project ? commandFromProject(project, cli) : undefined;
      const runningStatus = flags.status || spec || pathModule.join(projectRoot, "All specs");
      executionStatusBar.beforeExecute(
        { env: flags.debug ? { DEBUGGING: true } : undefined, status: runningStatus },
        formatRunningStatus(projectRoot, runningStatus, pathModule),
      );
      const usesBuildTool = Boolean(project && typeof project.executionEnvsAsync === "function");
      const projectEnv = usesBuildTool
        ? await resolveBuildToolExecutionEnvironment(project, cli, projectRoot)
        : projectExecutionEnvironment(project, cli);
      if (
        project
        && (usesBuildTool || typeof project.executionEnvs === "function")
        && !projectEnv
      ) {
        return undefined;
      }
      const launchConfigurations = getLaunchConfigurations(vscode, projectRoot);
      const launchExecutionOption = extractGaugeExecutionOption(launchConfigurations);
      const option = executionRunOptions(
        extractGaugeRunOption(launchConfigurations),
        flags,
      );
      if (launchExecutionOption.args) {
        option.args = launchExecutionOption.args;
      }
      if (typeof spec === "string" && /:\d+$/.test(spec)) {
        option.tags = null;
        option.scenario = null;
        option["retry-only"] = null;
      }
      const command = {
        command: executionTool ? executionTool.command : commandForProjectKind(projectKind, options),
        args: buildArgs(projectKind, projectRoot, spec, option, pathModule),
        cwd: executionCwd(projectRoot, launchExecutionOption.cwd, pathModule),
        status: runningStatus,
      };
      if (executionTool) {
        command.tool = executionTool;
      }
      const processEnv = launchExecutionOption.processEnv || {};
      if (hasEnvironment(projectEnv) || hasEnvironment(processEnv)) {
        command.env = {
          ...executionEnv,
          ...projectEnv,
          ...processEnv,
        };
      }

      if (flags.debug) {
        activeDebugger = debuggerFactory({
          vscode,
          projectRoot,
          language: options.language || projectRunnerLanguage(project, "kotlin"),
          baseEnv: command.env || executionEnv,
          debugPortProvider: options.debugPortProvider,
        });
        if (typeof activeDebugger.registerStopDebugger === "function") {
          activeDebugger.registerStopDebugger(() => {
            stopExecution(false);
          });
        }
        command.env = await activeDebugger.addDebugEnv(command.env || executionEnv);
      }

      activeRun = runner(command);
      result = await activeRun;
      if (option["machine-readable"] && !sawExecutionTestEvent && !activeRunUserAborted) {
        emitUnexpectedEndEvents(result === true);
      }
      return result;
    } finally {
      await executionStatusBar.afterExecute(projectRoot, activeRunUserAborted);
      await setExecutingContext(vscode, false);
      executing = false;
      activeRun = undefined;
      activeDebugger = undefined;
      activeRunUserAborted = false;
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

    const projectRoot = getProjectRootForSpec(
      vscode,
      spec,
      pathModule,
      projectFactory,
      allowWorkspaceProjectFallback,
    );
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

  async function executeActiveSpecification(flags = {}) {
    const context = getActiveSpecificationContext("specification");
    if (context.error) {
      return vscode.window.showErrorMessage(context.error);
    }
    return executeInProject(context.projectRoot, context.spec, {
      ...flags,
      status: context.spec,
    });
  }

  function specificationTargetsFromSelection(argument, selectedResources) {
    const resources = Array.isArray(selectedResources) && selectedResources.length > 0
      ? selectedResources
      : [argument];
    const targets = resources
      .map(resourcePath)
      .filter((target) => (
        isSpecPath(target, pathModule)
        || isRunnableDirectory(target, fileSystem, pathModule)
      ));
    return uniqueTargets(targets);
  }

  function projectRootFromSingleDirectorySelection(argument, selectedResources) {
    const resources = Array.isArray(selectedResources) && selectedResources.length > 0
      ? selectedResources
      : [argument];
    const targets = uniqueTargets(resources.map(resourcePath));
    if (targets.length !== 1 || !isDirectory(targets[0], fileSystem)) {
      return undefined;
    }
    const projectRoot = getProjectRootForSpec(
      vscode,
      targets[0],
      pathModule,
      projectFactory,
      allowWorkspaceProjectFallback,
    );
    if (
      projectRoot
      && pathModule.normalize(targets[0]) === pathModule.normalize(projectRoot)
    ) {
      return projectRoot;
    }
    return undefined;
  }

  function targetGroupsByProjectRoot(targets) {
    const groups = [];
    const groupIndexes = new Map();
    for (const target of targets) {
      const projectRoot = getProjectRootForSpec(
        vscode,
        target,
        pathModule,
        projectFactory,
        allowWorkspaceProjectFallback,
      );
      if (!projectRoot) {
        continue;
      }
      let groupIndex = groupIndexes.get(projectRoot);
      if (groupIndex === undefined) {
        groupIndex = groups.length;
        groupIndexes.set(projectRoot, groupIndex);
        groups.push({ projectRoot, targets: [] });
      }
      groups[groupIndex].targets.push(target);
    }
    return groups;
  }

  async function executeTargetGroups(targetGroups, flags = {}) {
    let result = true;
    for (const group of targetGroups) {
      const groupResult = await executeInProject(group.projectRoot, group.targets, {
        ...flags,
        status: pathModule.join(group.projectRoot, "Specifications"),
      });
      if (groupResult === false) {
        result = false;
      } else if (groupResult === undefined && result !== false) {
        result = undefined;
      }
    }
    return result;
  }

  async function executeSpecificationTargets(argument, selectedResources, flags = {}) {
    const selectedProjectRoot = projectRootFromSingleDirectorySelection(argument, selectedResources);
    if (selectedProjectRoot) {
      return executeAllSpecifications(selectedProjectRoot, flags);
    }
    const targets = specificationTargetsFromSelection(argument, selectedResources);
    if (targets.length === 0) {
      return undefined;
    }
    const targetGroups = targetGroupsByProjectRoot(targets);
    if (targetGroups.length === 0) {
      return vscode.window.showErrorMessage("No workspace folder is open.");
    }
    const targetGroup = targetGroups[0];
    const projectRoot = targetGroup.projectRoot;
    if (
      targets.length === 1
      && isDirectory(targets[0], fileSystem)
      && pathModule.normalize(targets[0]) === pathModule.normalize(projectRoot)
    ) {
      return executeAllSpecifications(projectRoot, flags);
    }
    if (targetGroups.length > 1) {
      return executeTargetGroups(targetGroups, flags);
    }
    return executeInProject(projectRoot, targetGroup.targets, {
      ...flags,
      status: pathModule.join(projectRoot, "Specifications"),
    });
  }

  async function executeAllSpecifications(projectRoot, flags = {}) {
    const selectedProjectRoot = projectRoot || (await selectProjectRoot(
      vscode,
      pathModule,
      projectFactory,
    ));
    if (!selectedProjectRoot) {
      return undefined;
    }
    return executeInProject(selectedProjectRoot, null, {
      ...flags,
      status: pathModule.join(selectedProjectRoot, "All specs"),
    });
  }

  async function executeFailed(projectRoot, flags = {}) {
    const selectedProjectRoot = projectRoot || (await selectProjectRoot(
      vscode,
      pathModule,
      projectFactory,
    ));
    if (!selectedProjectRoot) {
      return undefined;
    }
    return executeInProject(selectedProjectRoot, null, {
      ...flags,
      failed: true,
      status: pathModule.join(selectedProjectRoot, "failed scenarios"),
    });
  }

  async function repeatExecution(projectRoot, flags = {}) {
    const selectedProjectRoot = projectRoot || (await selectProjectRoot(
      vscode,
      pathModule,
      projectFactory,
    ));
    if (!selectedProjectRoot) {
      return undefined;
    }
    return executeInProject(selectedProjectRoot, null, {
      ...flags,
      repeat: true,
      status: pathModule.join(selectedProjectRoot, "previous run"),
    });
  }

  function getScenarioQuickPickItems(scenarios) {
    return scenarios.map((scenario) => ({
      label: scenario.heading,
      detail: "Scenario",
    }));
  }

  async function executeScenarioIdentifier(executionIdentifier, flags = {}) {
    const specPath = getScenarioSpecPath(executionIdentifier);
    const projectRoot = getProjectRootForSpec(
      vscode,
      specPath,
      pathModule,
      projectFactory,
      allowWorkspaceProjectFallback,
    );
    if (!projectRoot) {
      return vscode.window.showErrorMessage("No workspace folder is open.");
    }
    return executeInProject(projectRoot, executionIdentifier, {
      ...flags,
      status: executionIdentifier,
    });
  }

  async function chooseAndExecuteScenario(scenarios, flags = {}) {
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
    return executeScenarioIdentifier(scenario.executionIdentifier, flags);
  }

  async function executeScenario(atCursor, flags = {}) {
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
      return executeScenarioIdentifier(scenarios.executionIdentifier, flags);
    }
    return chooseAndExecuteScenario(scenarios, flags);
  }

  async function stopExecution(aborted = true) {
    if (activeRun && typeof activeRun.cancel === "function") {
      try {
        activeRunUserAborted = Boolean(aborted);
        if (activeDebugger && typeof activeDebugger.stopDebugger === "function") {
          activeDebugger.stopDebugger();
        }
        return activeRun.cancel(aborted);
      } catch (error) {
        if (vscode.window && typeof vscode.window.showErrorMessage === "function") {
          return vscode.window.showErrorMessage(`Failed to Stop Run: ${error.message}`);
        }
      }
    }
    return undefined;
  }

  lineProcessors = [
    new MachineReadableEventProcessor(emitExecutionEvent),
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

  async function executeNode(node, debug, flags = {}) {
    const spec = getNodeSpec(node);
    if (!spec) {
      return undefined;
    }
    const projectRoot = getProjectRootForSpec(
      vscode,
      getScenarioSpecPath(spec),
      pathModule,
      projectFactory,
      allowWorkspaceProjectFallback,
    );
    if (!projectRoot) {
      return vscode.window.showErrorMessage("No workspace folder is open.");
    }
    return executeInProject(projectRoot, spec, {
      ...flags,
      debug,
      status: getNodeStatus(node, spec),
    });
  }

  function getActiveEditorPath() {
    const editor = vscode.window && vscode.window.activeTextEditor;
    const document = editor && editor.document;
    if (!document) {
      return undefined;
    }
    return document.fileName || (document.uri && document.uri.fsPath);
  }

  async function executeCodeLensTarget(spec, flags = {}) {
    const target = spec || null;
    const rootTarget = spec || getActiveEditorPath();
    if (!rootTarget) {
      return vscode.window.showErrorMessage("A Gauge project file should be open to run this command.");
    }
    const projectRoot = getProjectRootForSpec(
      vscode,
      getScenarioSpecPath(rootTarget),
      pathModule,
      projectFactory,
      allowWorkspaceProjectFallback,
    );
    if (!projectRoot) {
      return vscode.window.showErrorMessage("No workspace folder is open.");
    }
    return executeInProject(projectRoot, target, {
      ...flags,
      status: spec || pathModule.join(projectRoot, "All specs"),
    });
  }

  function handleCommand(command, argument, flagsOrSelectedResources = {}, maybeFlags = {}) {
    const hasSelectedResources = Array.isArray(flagsOrSelectedResources);
    const selectedResources = hasSelectedResources ? flagsOrSelectedResources : undefined;
    const flags = hasSelectedResources ? maybeFlags : flagsOrSelectedResources;
    switch (command) {
      case "gauge.execute":
        return executeCodeLensTarget(argument, flags);
      case "gauge.debug":
        return executeCodeLensTarget(argument, { ...flags, debug: true });
      case "gauge.execute.inParallel":
        return executeCodeLensTarget(argument, { ...flags, parallel: true });
      case "gauge.execute.specification":
        if (selectedResources || resourcePath(argument)) {
          return executeSpecificationTargets(argument, selectedResources, flags);
        }
        if (argument) {
          return executeNode(argument, false, flags);
        }
        return executeActiveSpecification(flags);
      case "gauge.execute.specification.all":
        return executeAllSpecifications(undefined, flags);
      case "gauge.specexplorer.runAllActiveProjectSpecs":
        return executeAllSpecifications(argument && argument.projectRoot, flags);
      case "gauge.execute.failed":
        return executeFailed(argument && argument.projectRoot, flags);
      case "gauge.execute.repeat":
        return repeatExecution(argument && argument.projectRoot, flags);
      case "gauge.execute.scenario":
        if (argument) {
          return executeNode(argument, false, flags);
        }
        return executeScenario(true, flags);
      case "gauge.execute.scenarios":
        return executeScenario(false, flags);
      case "gauge.specexplorer.runNode":
        return executeNode(argument, false, flags);
      case "gauge.specexplorer.debugNode":
        return executeNode(argument, true, flags);
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
    dispose() {
      executionStatusBar.dispose();
      if (buildFileWatcher && typeof buildFileWatcher.dispose === "function") {
        buildFileWatcher.dispose();
      }
    },
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
  createGaugeExecutionStatusProvider,
  createGaugeExecutionController,
};
