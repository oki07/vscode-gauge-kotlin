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
  lastRunResultStamp,
  readNewLastRunResultEvents,
} = require("./lastRunResult");
const {
  buildRunArgs,
  extractGaugeExecutionOption,
  extractGaugeRunOption,
} = require("./runArgs");
const { CLI } = require("../cli");
const { GradleProject } = require("../project/gradleProject");
const { MavenProject } = require("../project/mavenProject");
const { createProjectFactory } = require("../project/projectFactory");
const { isMarkdownGaugeSpecFile } = require("../gaugeSpecScope");
const { ProjectEnvironmentService } = require("../projectEnvironmentService");
const { createLspRequestOwner } = require("./lspRequestOwner");

const EXECUTION_STATUS_REQUEST = "gauge/executionStatus";
// references/gauge/execution/execute.go executionStatusFile, common.DotGauge.
const EXECUTION_STATUS_DIRECTORY = ".gauge";
const EXECUTION_STATUS_FILE = "executionStatus.json";
const SHOW_REPORT_COMMAND = "gauge.report.html";
const STOP_EXECUTION_COMMAND = "gauge.stopExecution";
const EXECUTING_CONTEXT = "gauge:executing";
const NO_REPORT_MESSAGE = "No Gauge run has produced a report in this workspace yet.";
const EXECUTION_METADATA = Symbol("executionMetadata");
const EXECUTION_SEQUENCE = Symbol("executionSequence");
const COMMAND_FLAG_KEYS = [
  "failed",
  "hide-suggestion",
  "machine-readable",
  "parallel",
  "repeat",
  "simple-console",
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

function resolveClientsMap(getClientsMap) {
  return typeof getClientsMap === "function" ? getClientsMap() : getClientsMap;
}

// gauge/executionStatus is answered by execution.ReadLastExecutionResult
// (references/gauge/api/lang/server.go), which calls logger.Fatalf when the
// status file cannot be read, and logger.Fatal ends with os.Exit(1)
// (references/gauge/logger/gaugeLogger.go). Asking before any run has written
// .gauge/executionStatus.json therefore kills the daemon and every language
// feature with it.
function hasExecutionStatusFile(projectRoot, options) {
  const fileSystem = options.fileSystem;
  const pathModule = options.pathModule;
  if (
    !projectRoot
    || !fileSystem
    || typeof fileSystem.existsSync !== "function"
    || !pathModule
    || typeof pathModule.join !== "function"
  ) {
    return true;
  }
  try {
    return fileSystem.existsSync(
      pathModule.join(projectRoot, EXECUTION_STATUS_DIRECTORY, EXECUTION_STATUS_FILE),
    );
  } catch (_error) {
    return false;
  }
}

function createGaugeExecutionStatusProvider(getClientsMap, options = {}) {
  const vscode = options.vscode || {};
  const owner = createLspRequestOwner(undefined);
  const executionStatusProvider = (projectRoot) => owner.run((operation) => {
    if (!hasExecutionStatusFile(projectRoot, options)) {
      return undefined;
    }
    const clientsMap = resolveClientsMap(getClientsMap);
    if (owner.operationStopped(operation)) {
      return undefined;
    }
    const projectClient = clientsMap && typeof clientsMap.get === "function"
      ? clientsMap.get(projectRoot)
      : undefined;
    if (owner.operationStopped(operation)) {
      return undefined;
    }
    if (!projectClient || !projectClient.client || typeof projectClient.client.sendRequest !== "function") {
      return undefined;
    }
    const source = owner.createSource(operation, vscode.CancellationTokenSource);
    if (owner.operationStopped(operation)) {
      return undefined;
    }
    return projectClient.client.sendRequest(
      EXECUTION_STATUS_REQUEST,
      {},
      source && source.token,
    );
  });
  executionStatusProvider.dispose = owner.dispose;
  return executionStatusProvider;
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

async function selectProjectRoot(vscode, pathModule, projectFactory, waitForSelection) {
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
  const selection = vscode.window.showQuickPick(items, {
    canPickMany: false,
    placeHolder: "Choose a project",
  });
  const selected = typeof waitForSelection === "function"
    ? await waitForSelection(selection)
    : await selection;
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

// `.spec` is unambiguous anywhere. `.md` is a specification only inside the
// directories named by gauge_specs_dir (references/gauge/util/util.go
// GetSpecDirs), which is the rule src/gaugeSpecScope.js owns for the other
// fourteen surfaces. Gauge takes a bare path verbatim
// (references/gauge/util/fileUtils.go GetSpecFiles accepts any file whose
// extension is in gauge_spec_file_extensions, which defaults to ".spec, .md"),
// so running a README parses the prose as a specification and reports every
// bullet as a missing step.
function isSpecPath(filename, pathModule, scopeOptions) {
  if (!filename) {
    return false;
  }
  const extension = pathModule.extname(filename).toLowerCase();
  if (extension === ".spec") {
    return true;
  }
  if (extension !== ".md") {
    return false;
  }
  return isMarkdownGaugeSpecFile(filename, scopeOptions || {});
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

// Gauge takes a directory as a run target and walks it recursively
// (references/gauge/util/util.go GetSpecFiles). Looking only at the directory's
// own entries meant Run Specification on a folder whose specs live one level
// down did nothing: the target was filtered out and no run started.
const MAX_SPEC_DIRECTORY_DEPTH = 8;

function directoryContainsSpec(filename, fileSystem, pathModule, scopeOptions, depth = MAX_SPEC_DIRECTORY_DEPTH) {
  if (!fileSystem || typeof fileSystem.readdirSync !== "function" || depth < 0) {
    return false;
  }
  let entries;
  try {
    entries = fileSystem.readdirSync(filename);
  } catch (_error) {
    return false;
  }
  const directories = [];
  for (const entry of entries) {
    const entryName = typeof entry === "string" ? entry : entry.name;
    if (!entryName || entryName.startsWith(".")) {
      continue;
    }
    const child = pathModule.join(filename, entryName);
    if (isSpecPath(child, pathModule, scopeOptions)) {
      return true;
    }
    if (isDirectory(child, fileSystem)) {
      directories.push(child);
    }
  }
  return directories.some((child) => (
    directoryContainsSpec(child, fileSystem, pathModule, scopeOptions, depth - 1)
  ));
}

function isRunnableDirectory(filename, fileSystem, pathModule, scopeOptions) {
  return isDirectory(filename, fileSystem)
    && directoryContainsSpec(filename, fileSystem, pathModule, scopeOptions);
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
  let disposed = false;

  return {
    beforeExecute(command, runningStatus) {
      if (disposed) {
        return;
      }
      executionStatus.hide();
      if (command.env && command.env.DEBUGGING) {
        return;
      }
      stopExecution.text = `$(primitive-square) Running ${runningStatus || command.status}`;
      stopExecution.show();
    },
    async afterExecute(projectRoot, aborted) {
      if (disposed) {
        return undefined;
      }
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
      if (disposed || !status) {
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
      if (disposed) {
        return;
      }
      disposed = true;
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

function unexpectedEndEvents(passed, projectRoot) {
  const name = passed ? "Ignored" : "Failed";
  const id = projectRoot
    ? `${projectRoot}::result:${name.toLowerCase()}`
    : name;
  const resultEvent = passed
    ? {
      type: "testIgnored",
      id,
      parentId: "suite",
      name,
      message: " ",
      resultOnly: true,
    }
    : {
      type: "testFailed",
      id,
      parentId: "suite",
      name,
      message: " ",
      resultOnly: true,
    };
  return [
    {
      type: "testStarted",
      id,
      parentId: "suite",
      name,
      resultOnly: true,
    },
    resultEvent,
    {
      type: "testFinished",
      id,
      parentId: "suite",
      name,
      resultOnly: true,
    },
  ];
}

function isScenarioTarget(target) {
  return typeof target === "string" && /:\d+$/.test(target);
}

function namesScenarioLines(spec) {
  if (Array.isArray(spec)) {
    return spec.length > 0 && spec.every(isScenarioTarget);
  }
  return isScenarioTarget(spec);
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
  const executionStatusProvider = options.executionStatusProvider;
  const ownedRequestProviders = new Set();
  if (options.ownsScenariosProvider && scenariosProvider && typeof scenariosProvider.dispose === "function") {
    ownedRequestProviders.add(scenariosProvider);
  }
  if (
    options.ownsExecutionStatusProvider
    && executionStatusProvider
    && typeof executionStatusProvider.dispose === "function"
  ) {
    ownedRequestProviders.add(executionStatusProvider);
  }
  const debuggerFactory = options.debuggerFactory || createGaugeDebugger;
  const opener = options.opener || defaultOpener(vscode);
  const reportState = options.state || memoryReportState(options.reportPath);
  const executionStatusBar = createExecutionStatusBar(vscode, executionStatusProvider);
  const executionEnv = envWithGaugeHome(options.env || process.env, {
    vscode,
    gaugeHome: options.gaugeHome,
  });
  let activeExecutionRequest;
  let activeRun;
  let activeExecutionProjectRoot;
  let activeDebugger;
  let activeDebuggerSessionSubscription;
  let activeDebuggerStopRequested = false;
  let activeRunUserAborted = false;
  let executionLoop;
  let latestScheduledExecutionSequence = 0;
  let nextExecutionSequence = 0;
  let pendingExecutionRequest;
  let sawExecutionTestEvent = false;
  let cachedCli;
  let disposed = false;
  const disposedPreparation = Symbol("disposed preparation");
  let resolveDisposalSignal;
  const disposalSignal = new Promise((resolve) => {
    resolveDisposalSignal = resolve;
  });
  const ownsProjectEnvironmentService = !options.projectEnvironmentService;
  const projectEnvironmentService = options.projectEnvironmentService
    || new ProjectEnvironmentService({ projectFactory, vscode });

  async function resolveBuildToolExecutionEnvironment(project, cli) {
    return projectEnvironmentService.executionEnvironmentFor(project, cli);
  }

  function setReportPath(nextReportPath) {
    if (disposed) {
      return undefined;
    }
    return reportState.setReportPath(nextReportPath && nextReportPath.trim());
  }

  function ignoreRejection(value) {
    if (value && typeof value.then === "function") {
      Promise.resolve(value).catch(() => undefined);
    }
  }

  function observeStopFailure(error) {
    if (
      disposed
      || !vscode.window
      || typeof vscode.window.showErrorMessage !== "function"
    ) {
      return;
    }
    try {
      ignoreRejection(vscode.window.showErrorMessage(`Failed to Stop Run: ${error.message}`));
    } catch (_error) {
      // Advisory stop notifications cannot block process cancellation.
    }
  }

  function disposeActiveDebuggerSessionSubscription() {
    const subscription = activeDebuggerSessionSubscription;
    activeDebuggerSessionSubscription = undefined;
    if (!subscription || typeof subscription.dispose !== "function") {
      return;
    }
    try {
      subscription.dispose();
    } catch (_error) {
      // Continue releasing the debugger and execution state.
    }
  }

  function stopActiveDebugger() {
    if (
      activeDebuggerStopRequested
      || !activeDebugger
      || typeof activeDebugger.stopDebugger !== "function"
    ) {
      return undefined;
    }
    activeDebuggerStopRequested = true;
    try {
      ignoreRejection(activeDebugger.stopDebugger());
      return undefined;
    } catch (error) {
      return error;
    }
  }

  function cancelOwnedActiveRun(request, aborted) {
    if (
      request.activeRunCancellationIssued
      || !activeRun
      || typeof activeRun.cancel !== "function"
    ) {
      return undefined;
    }
    request.activeRunCancellationIssued = true;
    return activeRun.cancel(aborted);
  }

  async function waitForPreparation(value) {
    try {
      const result = await Promise.race([Promise.resolve(value), disposalSignal]);
      return disposed ? disposedPreparation : result;
    } catch (error) {
      if (disposed) {
        return disposedPreparation;
      }
      throw error;
    }
  }

  function cancelUnstartedExecution(flags) {
    notifyExecutionRequest({ metadata: flags[EXECUTION_METADATA] }, "onCancelled");
    return undefined;
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
    if (disposed) {
      return;
    }
    if (isExecutionTestEvent(event)) {
      sawExecutionTestEvent = true;
    }
    if (typeof options.executionEventSink === "function") {
      options.executionEventSink(event);
    }
  }

  function emitUnexpectedEndEvents(passed, projectRoot) {
    for (const event of unexpectedEndEvents(passed, projectRoot)) {
      emitExecutionEvent(event);
    }
  }

  function processOutputLine(lineText) {
    if (disposed) {
      return;
    }
    for (const processor of lineProcessors) {
      processor.process(lineText, activeDebugger);
    }
  }

  function processOutputChunk(chunk) {
    if (disposed) {
      return;
    }
    emitExecutionEvent({ type: "output", message: String(chunk || "") });
  }

  const getLastRunResultStamp = options.lastRunResultStamp || ((projectRoot) => (
    lastRunResultStamp(projectRoot, { fs: fileSystem, pathModule })
  ));
  const getNewLastRunResultEvents = options.readNewLastRunResultEvents
    || ((projectRoot, previousStamp) => readNewLastRunResultEvents(
      projectRoot,
      previousStamp,
      { fs: fileSystem, pathModule },
    ));

  const runner = options.runner || createGaugeProcessRunner({
    vscode,
    pathModule,
    outputChannel: options.outputChannel,
    processStarted: (command) => {
      if (command && command.forwardOutput) {
        emitExecutionEvent({ type: "processStarted" });
      }
    },
    processOutputChunk,
    processOutputLine,
    spawn: options.spawn,
    env: executionEnv,
  });

  async function runExecution(request) {
    const { flags, projectRoot, spec } = request;
    activeExecutionProjectRoot = projectRoot;
    activeRunUserAborted = false;
    sawExecutionTestEvent = false;
    let result;
    try {
      setExecutingContext(vscode, true);
      const runningStatus = flags.status || spec || pathModule.join(projectRoot, "All specs");
      executionStatusBar.beforeExecute(
        { env: flags.debug ? { DEBUGGING: true } : undefined, status: runningStatus },
        formatRunningStatus(projectRoot, runningStatus, pathModule),
      );
      const savePromise = saveWorkspaceDocuments(vscode);
      if (savePromise) {
        await savePromise;
      }
      if (request.cancelRequested) {
        return undefined;
      }

      const project = getProjectForExecution(projectFactory, projectRoot);
      const projectKind = projectKindFromProject(project)
        || detectProjectKind(projectRoot, fileSystem, pathModule);
      const cli = getCli();
      const executionTool = project ? commandFromProject(project, cli) : undefined;
      const usesBuildTool = Boolean(project && typeof project.executionEnvsAsync === "function");
      const projectEnv = usesBuildTool
        ? await resolveBuildToolExecutionEnvironment(project, cli)
        : projectExecutionEnvironment(project, cli);
      if (request.cancelRequested) {
        return undefined;
      }
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
      // A scenario target names an explicit line, so a tags, scenario or
      // retry-only filter from the launch configuration must not narrow it
      // further. The Test UI batches a multi-selection into an array, and
      // leaving the filters on made Gauge discard the very scenarios the user
      // picked.
      if (namesScenarioLines(spec)) {
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
      const testUi = Boolean(flags.testUi);
      const previousResultStamp = testUi
        ? getLastRunResultStamp(projectRoot)
        : undefined;
      if (testUi) {
        command.forwardOutput = true;
        command.saveExecutionResult = true;
      }
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
        activeDebuggerStopRequested = false;
        activeDebugger = debuggerFactory({
          vscode,
          projectRoot,
          language: options.language || projectRunnerLanguage(project, "kotlin"),
          baseEnv: command.env || executionEnv,
          debugPortProvider: options.debugPortProvider,
        });
        if (request.cancelRequested) {
          const debuggerStopError = stopActiveDebugger();
          if (debuggerStopError) {
            observeStopFailure(debuggerStopError);
          }
          return undefined;
        }
        if (typeof activeDebugger.registerStopDebugger === "function") {
          activeDebuggerSessionSubscription = activeDebugger.registerStopDebugger(() => {
            cancelExecutionRequest(request, false);
          });
          if (request.cancelRequested) {
            disposeActiveDebuggerSessionSubscription();
            return undefined;
          }
        }
        command.env = await activeDebugger.addDebugEnv(command.env || executionEnv);
        if (request.cancelRequested) {
          return undefined;
        }
      }

      if (request.cancelRequested) {
        return undefined;
      }
      request.phase = "startingRun";
      activeRun = runner(command);
      request.phase = "activeRun";
      if (request.cancelRequested) {
        try {
          ignoreRejection(cancelOwnedActiveRun(request, activeRunUserAborted));
        } catch (error) {
          observeStopFailure(error);
        }
      }
      result = await activeRun;
      activeRun = undefined;
      // A Test UI run does not ask for --machine-readable, but the user's
      // launch.json may. When it does, the event stream has already published a
      // result for every scenario, and replaying last_run_result on top of that
      // publishes each of them a second time.
      if (testUi && !activeRunUserAborted && !sawExecutionTestEvent) {
        let resultEvents = [];
        try {
          resultEvents = getNewLastRunResultEvents(projectRoot, previousResultStamp) || [];
        } catch (_error) {
          resultEvents = [];
        }
        for (const event of resultEvents) {
          emitExecutionEvent(event);
        }
        if (resultEvents.length === 0) {
          emitUnexpectedEndEvents(result === true, projectRoot);
        }
      } else if (option["machine-readable"] && !sawExecutionTestEvent && !activeRunUserAborted) {
        emitUnexpectedEndEvents(result === true, projectRoot);
      }
      return result;
    } finally {
      disposeActiveDebuggerSessionSubscription();
      stopActiveDebugger();
      if (!disposed) {
        await executionStatusBar.afterExecute(projectRoot, activeRunUserAborted);
        await setExecutingContext(vscode, false);
      }
      activeExecutionProjectRoot = undefined;
      activeRun = undefined;
      activeDebugger = undefined;
      activeDebuggerStopRequested = false;
      activeRunUserAborted = false;
    }
  }

  function settleExecutionRequest(request, method, value) {
    if (!request || request.settled) {
      return;
    }
    request.settled = true;
    request[method](value);
  }

  function notifyExecutionRequest(request, event) {
    const callback = request && request.metadata && request.metadata[event];
    if (typeof callback === "function") {
      callback();
    }
  }

  function executionRequestCancelled(metadata) {
    if (!metadata || typeof metadata.isCancellationRequested !== "function") {
      return false;
    }
    try {
      return Boolean(metadata.isCancellationRequested());
    } catch (_error) {
      return true;
    }
  }

  function replacePendingExecution(request) {
    if (pendingExecutionRequest) {
      notifyExecutionRequest(pendingExecutionRequest, "onSuperseded");
      settleExecutionRequest(pendingExecutionRequest, "resolve", undefined);
    }
    pendingExecutionRequest = request;
  }

  async function drainExecutionRequests() {
    while (pendingExecutionRequest) {
      const request = pendingExecutionRequest;
      pendingExecutionRequest = undefined;
      if (executionRequestCancelled(request.metadata)) {
        notifyExecutionRequest(request, "onCancelled");
        settleExecutionRequest(request, "resolve", undefined);
        await Promise.resolve();
        continue;
      }
      activeExecutionRequest = request;
      request.phase = "preparing";
      try {
        notifyExecutionRequest(request, "onStart");
        if (!disposed && !request.cancelRequested) {
          const result = await runExecution(request);
          settleExecutionRequest(request, "resolve", result);
        } else {
          settleExecutionRequest(request, "resolve", undefined);
        }
      } catch (error) {
        settleExecutionRequest(request, "reject", error);
      } finally {
        if (activeExecutionRequest === request) {
          activeExecutionRequest = undefined;
        }
      }
      await Promise.resolve();
    }
    executionLoop = undefined;
  }

  function executeInProject(projectRoot, spec, flags = {}) {
    const metadata = flags[EXECUTION_METADATA];
    if (executionRequestCancelled(metadata)) {
      notifyExecutionRequest({ metadata }, "onCancelled");
      return Promise.resolve(undefined);
    }
    if (disposed) {
      notifyExecutionRequest({ metadata }, "onCancelled");
      return Promise.resolve(undefined);
    }
    const sequence = Number.isSafeInteger(flags[EXECUTION_SEQUENCE])
      ? flags[EXECUTION_SEQUENCE]
      : ++nextExecutionSequence;
    if (sequence < latestScheduledExecutionSequence) {
      notifyExecutionRequest({ metadata: flags[EXECUTION_METADATA] }, "onSuperseded");
      return Promise.resolve(undefined);
    }
    latestScheduledExecutionSequence = sequence;
    const execution = new Promise((resolve, reject) => {
      const request = {
        activeRunCancellationIssued: false,
        cancelRequested: false,
        flags,
        metadata: flags[EXECUTION_METADATA],
        phase: "queued",
        projectRoot,
        reject,
        resolve,
        sequence,
        settled: false,
        spec,
      };
      replacePendingExecution(request);
      if (activeExecutionRequest) {
        cancelActiveExecution(true, "onSuperseded");
      }
      if (!executionLoop) {
        executionLoop = true;
        const loop = drainExecutionRequests();
        if (executionLoop === true) {
          executionLoop = loop;
        }
      }
    });
    return execution;
  }

  function getActiveSpecificationContext(kind) {
    const editor = vscode.window && vscode.window.activeTextEditor;
    if (!editor || !editor.document) {
      return {
        error: "A gauge specification file should be open to run this command.",
      };
    }

    const spec = editor.document.fileName || (editor.document.uri && editor.document.uri.fsPath);
    if (!isSpecPath(spec, pathModule, markdownScopeOptions())) {
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
    if (disposed) {
      return cancelUnstartedExecution(flags);
    }
    const context = getActiveSpecificationContext("specification");
    if (context.error) {
      return vscode.window.showErrorMessage(context.error);
    }
    return executeInProject(context.projectRoot, context.spec, {
      ...flags,
      status: context.spec,
    });
  }

  function markdownScopeOptions() {
    return { fileSystem, pathModule, projectFactory };
  }

  function specificationTargetsFromSelection(argument, selectedResources) {
    const resources = Array.isArray(selectedResources) && selectedResources.length > 0
      ? selectedResources
      : [argument];
    // A scenario identifier is a specification path with a ":<line>" suffix.
    // Gauge takes it as a run target exactly like the specification itself, so
    // keep the identifier while testing the specification path behind it.
    const targets = resources
      .map(resourcePath)
      .filter((target) => (
        isSpecPath(getScenarioSpecPath(target), pathModule, markdownScopeOptions())
        || isRunnableDirectory(target, fileSystem, pathModule, markdownScopeOptions())
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
        getScenarioSpecPath(target),
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
      if (disposed) {
        return undefined;
      }
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
    if (disposed) {
      return cancelUnstartedExecution(flags);
    }
    const selectedProjectRoot = projectRoot || (await selectProjectRoot(
      vscode,
      pathModule,
      projectFactory,
      waitForPreparation,
    ));
    if (selectedProjectRoot === disposedPreparation) {
      return cancelUnstartedExecution(flags);
    }
    if (!selectedProjectRoot) {
      return undefined;
    }
    return executeInProject(selectedProjectRoot, null, {
      ...flags,
      status: pathModule.join(selectedProjectRoot, "All specs"),
    });
  }

  async function executeFailed(projectRoot, flags = {}) {
    if (disposed) {
      return cancelUnstartedExecution(flags);
    }
    const selectedProjectRoot = projectRoot || (await selectProjectRoot(
      vscode,
      pathModule,
      projectFactory,
      waitForPreparation,
    ));
    if (selectedProjectRoot === disposedPreparation) {
      return cancelUnstartedExecution(flags);
    }
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
    if (disposed) {
      return cancelUnstartedExecution(flags);
    }
    const selectedProjectRoot = projectRoot || (await selectProjectRoot(
      vscode,
      pathModule,
      projectFactory,
      waitForPreparation,
    ));
    if (selectedProjectRoot === disposedPreparation) {
      return cancelUnstartedExecution(flags);
    }
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
    const selected = await waitForPreparation(
      vscode.window.showQuickPick(getScenarioQuickPickItems(scenarios)),
    );
    if (selected === disposedPreparation) {
      return cancelUnstartedExecution(flags);
    }
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
    if (disposed) {
      return cancelUnstartedExecution(flags);
    }
    const context = getActiveSpecificationContext("scenario(s)");
    if (context.error) {
      return vscode.window.showErrorMessage(context.error);
    }

    const position = atCursor
      ? (context.editor.selection && context.editor.selection.active)
      : { line: 1, character: 1 };
    let scenarios;
    try {
      scenarios = await waitForPreparation(
        scenariosProvider({
          projectRoot: context.projectRoot,
          spec: context.spec,
          position,
          atCursor,
        }),
      );
    } catch (_error) {
      if (disposed || executionRequestCancelled(flags[EXECUTION_METADATA])) {
        return cancelUnstartedExecution(flags);
      }
      return vscode.window.showErrorMessage(
        `found some problems in ${context.spec}. Fix all problems before running scenarios.`,
      );
    }

    if (scenarios === disposedPreparation || disposed) {
      return cancelUnstartedExecution(flags);
    }

    if (atCursor && !Array.isArray(scenarios)) {
      return executeScenarioIdentifier(scenarios.executionIdentifier, flags);
    }
    return chooseAndExecuteScenario(scenarios, flags);
  }

  function cancelExecutionRequest(request, aborted = true, notification = "onCancelled") {
    if (
      !request
      || activeExecutionRequest !== request
      || request.cancelRequested
    ) {
      return undefined;
    }
    request.cancelRequested = true;
    notifyExecutionRequest(request, notification);
    if (request.phase === "preparing") {
      settleExecutionRequest(request, "resolve", undefined);
      disposeActiveDebuggerSessionSubscription();
    }
    activeRunUserAborted = Boolean(aborted);
    const debuggerStopError = stopActiveDebugger();
    try {
      if (activeRun && typeof activeRun.cancel === "function") {
        const cancellation = cancelOwnedActiveRun(request, aborted);
        if (debuggerStopError) {
          observeStopFailure(debuggerStopError);
        }
        return cancellation;
      }
    } catch (error) {
      if (!disposed && vscode.window && typeof vscode.window.showErrorMessage === "function") {
        return vscode.window.showErrorMessage(`Failed to Stop Run: ${error.message}`);
      }
    }
    if (debuggerStopError) {
      observeStopFailure(debuggerStopError);
    }
    return undefined;
  }

  function cancelActiveExecution(aborted = true, notification = "onCancelled") {
    return cancelExecutionRequest(activeExecutionRequest, aborted, notification);
  }

  async function stopExecution(aborted = true) {
    latestScheduledExecutionSequence = ++nextExecutionSequence;
    if (pendingExecutionRequest) {
      notifyExecutionRequest(pendingExecutionRequest, "onCancelled");
      settleExecutionRequest(pendingExecutionRequest, "resolve", undefined);
      pendingExecutionRequest = undefined;
    }
    return cancelActiveExecution(aborted);
  }

  lineProcessors = [
    new MachineReadableEventProcessor(emitExecutionEvent, () => activeExecutionProjectRoot),
    new ReportEventProcessor({ setReportPath }),
    new DebuggerAttachedEventProcessor({ cancel: cancelActiveExecution }, vscode),
    new DebuggerNotAttachedEventProcessor({ cancel: cancelActiveExecution }, vscode),
  ];

  async function openReport() {
    if (disposed) {
      return undefined;
    }
    // The command is in the palette whenever Gauge is active, with no guard on
    // having run anything. references/gauge-vscode hands its unset report path
    // straight to Uri.file, which turns "you have not run anything yet" into a
    // raw TypeError in the error toast.
    const reportPath = getReportPath();
    if (!reportPath) {
      return vscode.window.showErrorMessage(
        `Can't open html report. ${NO_REPORT_MESSAGE}`,
      );
    }
    // The path is remembered in workspaceState across sessions, and Gauge
    // replaces reports/ on the next run or the user cleans the project. Handing
    // a vanished path to env.openExternal opens nothing and reports nothing.
    if (fileSystem && typeof fileSystem.existsSync === "function" && !fileSystem.existsSync(reportPath)) {
      return vscode.window.showErrorMessage(
        `Can't open html report. ${reportPath} no longer exists.`,
      );
    }
    try {
      const result = await waitForPreparation(opener(reportPath));
      return result === disposedPreparation ? undefined : result;
    } catch (error) {
      if (disposed) {
        return undefined;
      }
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
    const suppliedFlags = hasSelectedResources ? maybeFlags : flagsOrSelectedResources;
    if (disposed) {
      notifyExecutionRequest({ metadata: suppliedFlags[EXECUTION_METADATA] }, "onCancelled");
      return Promise.resolve(undefined);
    }
    const startsExecution = EXECUTION_COMMANDS.has(command)
      && command !== SHOW_REPORT_COMMAND
      && command !== STOP_EXECUTION_COMMAND;
    const flags = startsExecution
      ? { ...suppliedFlags, [EXECUTION_SEQUENCE]: ++nextExecutionSequence }
      : suppliedFlags;
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

  function handleCommandWithMetadata(
    command,
    metadata,
    argument,
    flagsOrSelectedResources = {},
    maybeFlags = {},
  ) {
    if (Array.isArray(flagsOrSelectedResources)) {
      return handleCommand(
        command,
        argument,
        flagsOrSelectedResources,
        { ...maybeFlags, [EXECUTION_METADATA]: metadata },
      );
    }
    return handleCommand(command, argument, {
      ...flagsOrSelectedResources,
      [EXECUTION_METADATA]: metadata,
    });
  }

  return {
    executeActiveSpecification,
    executeAllSpecifications,
    executeFailed,
    executeScenario,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      resolveDisposalSignal(disposedPreparation);
      for (const provider of ownedRequestProviders) {
        try {
          provider.dispose();
        } catch (_error) {
          // Continue terminal cleanup for the remaining controller resources.
        }
      }
      ownedRequestProviders.clear();
      latestScheduledExecutionSequence = ++nextExecutionSequence;
      if (pendingExecutionRequest) {
        notifyExecutionRequest(pendingExecutionRequest, "onCancelled");
        settleExecutionRequest(pendingExecutionRequest, "resolve", undefined);
        pendingExecutionRequest = undefined;
      }
      disposeActiveDebuggerSessionSubscription();
      if (activeExecutionRequest) {
        const cancellation = activeExecutionRequest.cancelRequested
          ? undefined
          : cancelActiveExecution(true, "onCancelled");
        activeRunUserAborted = true;
        settleExecutionRequest(activeExecutionRequest, "resolve", undefined);
        ignoreRejection(cancellation);
      }
      ignoreRejection(setExecutingContext(vscode, false));
      executionStatusBar.dispose();
      if (
        ownsProjectEnvironmentService
        && projectEnvironmentService
        && typeof projectEnvironmentService.dispose === "function"
      ) {
        projectEnvironmentService.dispose();
      }
    },
    getReportPath,
    handleCommand,
    handleCommandWithMetadata,
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
