"use strict";

const nodeFs = require("node:fs");
const nodeOs = require("node:os");
const nodePath = require("node:path");

const { configuredSpecDirs } = require("./gaugeSpecScope");

const SPEC_DIRS_REQUEST = "gauge/specDirs";
const CREATE_SPECIFICATION_COMMAND = "gauge.create.specification";
const CREATE_CONCEPT_COMMAND = "gauge.create.concept";
const DISPOSED_CREATION = Symbol("disposed Gauge file creation");

function cleanupOwnedSource(source, cancel) {
  if (!source) {
    return;
  }
  if (cancel && typeof source.cancel === "function") {
    try {
      source.cancel();
    } catch (error) {
      // Best-effort cancellation must not interrupt terminal cleanup.
    }
  }
  if (typeof source.dispose === "function") {
    try {
      source.dispose();
    } catch (error) {
      // Owned listener cleanup must not replace the operation result.
    }
  }
}

function cleanupDisposable(disposable) {
  if (!disposable || typeof disposable.dispose !== "function") {
    return;
  }
  try {
    disposable.dispose();
  } catch (error) {
    // Continue releasing the remaining provider-owned registrations.
  }
}

function createFileCreationOperation() {
  let rejectPublic;
  let resolveCancellation;
  let resolvePublic;
  const cancellation = new Promise((resolve) => {
    resolveCancellation = resolve;
  });
  const promise = new Promise((resolve, reject) => {
    resolvePublic = resolve;
    rejectPublic = reject;
  });
  return {
    cancellation,
    cancellationSources: new Set(),
    cancelled: false,
    completed: false,
    promise,
    publicSettled: false,
    cancel() {
      if (this.cancelled || this.completed) {
        return;
      }
      this.cancelled = true;
      resolveCancellation(DISPOSED_CREATION);
      if (!this.publicSettled) {
        this.publicSettled = true;
        resolvePublic(undefined);
      }
      const sources = [...this.cancellationSources];
      this.cancellationSources.clear();
      for (const source of sources) {
        cleanupOwnedSource(source, true);
      }
    },
    reject(error) {
      if (this.publicSettled) {
        return;
      }
      this.publicSettled = true;
      rejectPublic(error);
    },
    resolve(value) {
      if (this.publicSettled) {
        return;
      }
      this.publicSettled = true;
      resolvePublic(value);
    },
  };
}

function operationStopped(operation) {
  return Boolean(operation && operation.cancelled);
}

function observePromise(value) {
  if (value && typeof value.then === "function") {
    Promise.resolve(value).catch(() => undefined);
  }
}

async function callForOperation(operation, callback) {
  if (operationStopped(operation)) {
    return DISPOSED_CREATION;
  }

  let value;
  try {
    value = callback();
  } catch (error) {
    if (operationStopped(operation)) {
      return DISPOSED_CREATION;
    }
    throw error;
  }

  const pending = Promise.resolve(value);
  if (operationStopped(operation)) {
    observePromise(pending);
    return DISPOSED_CREATION;
  }

  try {
    const result = operation
      ? await Promise.race([pending, operation.cancellation])
      : await pending;
    return operationStopped(operation) || result === DISPOSED_CREATION
      ? DISPOSED_CREATION
      : result;
  } catch (error) {
    if (operationStopped(operation)) {
      return DISPOSED_CREATION;
    }
    throw error;
  }
}

function callSyncForOperation(operation, callback) {
  if (operationStopped(operation)) {
    return DISPOSED_CREATION;
  }
  try {
    const value = callback();
    if (operationStopped(operation)) {
      observePromise(value);
      return DISPOSED_CREATION;
    }
    return value;
  } catch (error) {
    if (operationStopped(operation)) {
      return DISPOSED_CREATION;
    }
    throw error;
  }
}

function createRequestSource(vscode, operation) {
  if (operationStopped(operation)) {
    return DISPOSED_CREATION;
  }
  if (typeof vscode.CancellationTokenSource !== "function") {
    return undefined;
  }
  const source = new vscode.CancellationTokenSource();
  if (operation) {
    if (operationStopped(operation)) {
      cleanupOwnedSource(source, true);
      return DISPOSED_CREATION;
    }
    operation.cancellationSources.add(source);
  }
  return source;
}

function releaseRequestSource(operation, source) {
  if (!source || source === DISPOSED_CREATION) {
    return;
  }
  if (operation && !operation.cancellationSources.delete(source)) {
    return;
  }
  cleanupOwnedSource(source, false);
}

function projectSpecDirs(projectRoot, options, pathModule) {
  return configuredSpecDirs({
    fileSystem: options.fileSystem,
    pathModule,
    projectRoot,
  }).map((segments) => segments.join(pathModule.sep || "/"));
}

function createGaugeSpecDirsProvider(getClientsMap, options = {}) {
  const vscode = options.vscode || {};
  return async function specDirsProvider(projectRoot, operation) {
    const clientsMap = callSyncForOperation(operation, () => (
      typeof getClientsMap === "function" ? getClientsMap() : getClientsMap
    ));
    if (clientsMap === DISPOSED_CREATION) {
      return DISPOSED_CREATION;
    }
    const projectClient = callSyncForOperation(operation, () => (
      clientsMap && typeof clientsMap.get === "function"
        ? clientsMap.get(projectRoot)
        : undefined
    ));
    if (projectClient === DISPOSED_CREATION) {
      return DISPOSED_CREATION;
    }
    if (!projectClient || !projectClient.client || typeof projectClient.client.sendRequest !== "function") {
      return undefined;
    }
    const source = createRequestSource(vscode, operation);
    if (source === DISPOSED_CREATION) {
      return DISPOSED_CREATION;
    }
    try {
      return await callForOperation(
        operation,
        () => projectClient.client.sendRequest(SPEC_DIRS_REQUEST, source && source.token),
      );
    } finally {
      releaseRequestSource(operation, source);
    }
  };
}

function buildSpecificationDocument(options = {}) {
  const eol = options.eol || nodeOs.EOL;
  const withHelp = options.withHelp !== false;
  const lines = [
    "# SPECIFICATION HEADING",
  ];

  if (withHelp) {
    lines.push(
      "",
      "This is an executable specification file. This file follows markdown syntax.",
      "Every heading in this file denotes a scenario. Every bulleted point denotes a step.",
      "",
      "> To turn off these comments, set the configuration`gauge.create.specification.withHelp` to false.",
    );
  }

  lines.push("", "## SCENARIO HEADING", "", "* step");

  return {
    text: `${lines.join(eol)}${eol}`,
    selection: {
      start: { line: lines.length - 1, character: 2 },
      end: { line: lines.length - 1, character: 6 },
    },
  };
}

function defaultUser() {
  try {
    return nodeOs.userInfo().username || "";
  } catch (error) {
    return process.env.USER || process.env.USERNAME || "";
  }
}

function defaultDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildConceptDocument(options = {}) {
  const eol = options.eol || nodeOs.EOL;
  const user = options.user || defaultUser();
  const date = options.date || defaultDate();
  const heading = "Concept Heading";
  const text = [
    `Created by ${user} on ${date}`,
    "",
    "This is a concept file with following syntax for each concept.",
    `# ${heading}`,
    "* step1",
    "* step2",
  ].join(eol);

  return {
    text,
    selection: {
      start: { line: 3, character: 2 },
      end: { line: 3, character: 2 + heading.length },
    },
  };
}

function getWorkspaceRoots(vscode) {
  const folders = vscode.workspace && vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return [];
  }

  return folders
    .map((folder) => {
      const uri = folder.uri || {};
      return uri.fsPath || uri.path;
    })
    .filter(Boolean);
}

async function selectProjectRoot(vscode, pathModule, options = {}, operation) {
  if (options.projectRoot) {
    return options.projectRoot;
  }

  const configuredProjects = typeof options.getProjects === "function"
    ? callSyncForOperation(operation, options.getProjects)
    : options.projects;
  if (configuredProjects === DISPOSED_CREATION) {
    return DISPOSED_CREATION;
  }
  const projectRoots = configuredProjects || getWorkspaceRoots(vscode);
  if (projectRoots.length === 0) {
    return undefined;
  }
  if (projectRoots.length === 1 || !vscode.window.showQuickPick) {
    return projectRoots[0];
  }

  const projectItems = projectRoots.map((projectRoot) => ({
    label: pathModule.basename(projectRoot),
    description: projectRoot,
  }));
  const selected = await callForOperation(
    operation,
    () => vscode.window.showQuickPick(projectItems, {
      canPickMany: false,
      placeHolder: "Choose a project",
    }),
  );

  if (!selected || selected === DISPOSED_CREATION) {
    return undefined;
  }
  return selected.description || selected;
}

function getWithHelpSetting(vscode) {
  if (!vscode.workspace || typeof vscode.workspace.getConfiguration !== "function") {
    return true;
  }

  const configuration = vscode.workspace.getConfiguration("gauge");
  if (!configuration || typeof configuration.get !== "function") {
    return true;
  }

  const value = configuration.get("create.specification.withHelp");
  return value !== false;
}

function toRange(vscode, selection) {
  if (typeof vscode.Range === "function" && typeof vscode.Position === "function") {
    return new vscode.Range(
      new vscode.Position(selection.start.line, selection.start.character),
      new vscode.Position(selection.end.line, selection.end.character),
    );
  }
  return selection;
}

function showError(vscode, message) {
  return showGenerationError(vscode, "specification", message);
}

function showGenerationError(vscode, kind, message) {
  if (vscode.window && typeof vscode.window.showErrorMessage === "function") {
    return vscode.window.showErrorMessage(`Unable to generate ${kind}. ${message}`);
  }
  return undefined;
}

const SPECIFICATION_DESCRIPTOR = {
  buildDocument(options) {
    return buildSpecificationDocument({
      date: options.date,
      eol: options.eol,
      user: options.user,
      withHelp: getWithHelpSetting(options.vscode),
    });
  },
  directoryPlaceholder: "Choose the folder in which the specification should be created",
  extension: ".spec",
  inputPlaceholder: "Enter the file name",
  kind: "specification",
};

const CONCEPT_DESCRIPTOR = {
  buildDocument(options) {
    return buildConceptDocument({
      date: options.date,
      eol: options.eol,
      user: options.user,
    });
  },
  directoryPlaceholder: "Choose the folder in which the concept should be created",
  extension: ".cpt",
  inputPlaceholder: "Enter the concept file name",
  kind: "concept",
};

async function createGaugeFile(options, descriptor) {
  const vscode = options.vscode || require("vscode");
  const operation = options.operation;
  try {
    const fileSystem = options.fileSystem || nodeFs;
    const promises = fileSystem.promises || fileSystem;
    const pathModule = options.pathModule || nodePath;
    const eol = options.eol || nodeOs.EOL;
    const projectRoot = await selectProjectRoot(vscode, pathModule, options, operation);

    if (projectRoot === DISPOSED_CREATION || operationStopped(operation)) {
      return DISPOSED_CREATION;
    }

    if (!projectRoot) {
      return callForOperation(
        operation,
        () => showGenerationError(vscode, descriptor.kind, "No workspace folder is open."),
      );
    }

    const targetDir = await selectSpecDirectory(vscode, pathModule, projectRoot, {
      ...options,
      specDirPlaceHolder: descriptor.directoryPlaceholder,
    }, operation);
    if (targetDir === DISPOSED_CREATION || operationStopped(operation)) {
      return DISPOSED_CREATION;
    }
    if (!targetDir) {
      return undefined;
    }

    const file = await callForOperation(
      operation,
      () => vscode.window.showInputBox({ placeHolder: descriptor.inputPlaceholder }),
    );
    if (file === DISPOSED_CREATION || operationStopped(operation)) {
      return DISPOSED_CREATION;
    }
    if (!file) {
      return undefined;
    }

    const filename = callSyncForOperation(
      operation,
      () => pathModule.join(targetDir, `${file}${descriptor.extension}`),
    );
    if (filename === DISPOSED_CREATION) {
      return DISPOSED_CREATION;
    }

    const exists = typeof fileSystem.existsSync === "function"
      ? callSyncForOperation(operation, () => fileSystem.existsSync(filename))
      : false;
    if (exists === DISPOSED_CREATION) {
      return DISPOSED_CREATION;
    }
    if (exists) {
      return callForOperation(
        operation,
        () => showGenerationError(
          vscode,
          descriptor.kind,
          `File${filename} already exists.`,
        ),
      );
    }

    const document = callSyncForOperation(operation, () => descriptor.buildDocument({
      eol,
      ...options,
      vscode,
    }));
    if (document === DISPOSED_CREATION) {
      return DISPOSED_CREATION;
    }

    const createdDirectory = await callForOperation(
      operation,
      () => promises.mkdir(targetDir, { recursive: true }),
    );
    if (createdDirectory === DISPOSED_CREATION || operationStopped(operation)) {
      return DISPOSED_CREATION;
    }

    const wroteFile = await callForOperation(
      operation,
      () => promises.writeFile(filename, document.text, "utf8"),
    );
    if (wroteFile === DISPOSED_CREATION || operationStopped(operation)) {
      return DISPOSED_CREATION;
    }

    const textDocument = await callForOperation(
      operation,
      () => vscode.workspace.openTextDocument(filename),
    );
    if (textDocument === DISPOSED_CREATION || operationStopped(operation)) {
      return DISPOSED_CREATION;
    }

    const selection = callSyncForOperation(
      operation,
      () => toRange(vscode, document.selection),
    );
    if (selection === DISPOSED_CREATION) {
      return DISPOSED_CREATION;
    }
    return callForOperation(
      operation,
      () => vscode.window.showTextDocument(textDocument, { selection }),
    );
  } catch (error) {
    if (operationStopped(operation)) {
      return DISPOSED_CREATION;
    }
    return callForOperation(
      operation,
      () => showGenerationError(vscode, descriptor.kind, error),
    );
  }
}

async function createSpecification(options = {}) {
  return createGaugeFile(options, SPECIFICATION_DESCRIPTOR);
}

async function createConcept(options = {}) {
  return createGaugeFile(options, CONCEPT_DESCRIPTOR);
}

async function selectSpecDirectory(vscode, pathModule, projectRoot, options = {}, operation) {
  if (options.specDir) {
    return callSyncForOperation(operation, () => (
      pathModule.isAbsolute(options.specDir)
        ? options.specDir
        : pathModule.join(projectRoot, options.specDir)
    ));
  }

  const relativeSpecDirs = options.specDirsProvider
    ? await callForOperation(
      operation,
      () => options.specDirsProvider(projectRoot, operation),
    )
    : undefined;
  if (relativeSpecDirs === DISPOSED_CREATION || operationStopped(operation)) {
    return DISPOSED_CREATION;
  }
  // gauge/specDirs only answers while a language client is running. Falling back
  // to a hard coded "specs" wrote new specifications into a directory Gauge does
  // not read whenever gauge_specs_dir moved them
  // (references/gauge/util/util.go GetSpecDirs).
  const specDirs = relativeSpecDirs && relativeSpecDirs.length > 0
    ? relativeSpecDirs
    : projectSpecDirs(projectRoot, options, pathModule);

  let selected = specDirs[0];
  if (specDirs.length > 1 && vscode.window.showQuickPick) {
    selected = await callForOperation(
      operation,
      () => vscode.window.showQuickPick(specDirs, {
        canPickMany: false,
        placeHolder: options.specDirPlaceHolder
          || "Choose the folder in which the specification should be created",
      }),
    );
  }

  if (!selected || selected === DISPOSED_CREATION) {
    return undefined;
  }
  return callSyncForOperation(operation, () => (
    pathModule.isAbsolute(selected) ? selected : pathModule.join(projectRoot, selected)
  ));
}

function folderPathFromUri(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value.fsPath || value.path;
}

class SpecificationProvider {
  constructor(getClientsMap, options = {}) {
    this.getClientsMap = getClientsMap;
    this.options = options;
    this.vscode = options.vscode || require("vscode");
    this.activeOperations = new Set();
    this.disposed = false;
    this.registrations = [];
    this.specDirsProvider = options.specDirsProvider || createGaugeSpecDirsProvider(
      getClientsMap,
      { vscode: this.vscode },
    );
    this.registerCommands();
  }

  registerCommands() {
    if (
      this.disposed
      || !this.vscode.commands
      || typeof this.vscode.commands.registerCommand !== "function"
    ) {
      return;
    }
    const registrations = [
      this.vscode.commands.registerCommand(
        CREATE_SPECIFICATION_COMMAND,
        (folder) => this.createSpecification(folderPathFromUri(folder)),
      ),
      this.vscode.commands.registerCommand(
        CREATE_CONCEPT_COMMAND,
        (folder) => this.createConcept(folderPathFromUri(folder)),
      ),
    ];
    if (this.disposed) {
      for (const registration of registrations) {
        cleanupDisposable(registration);
      }
      return;
    }
    this.registrations.push(...registrations.filter(Boolean));
  }

  projectRoots() {
    if (typeof this.options.getProjects === "function") {
      return this.options.getProjects();
    }
    const clientsMap = typeof this.getClientsMap === "function"
      ? this.getClientsMap()
      : this.getClientsMap;
    if (!clientsMap || typeof clientsMap.keys !== "function") {
      return undefined;
    }
    const projects = Array.from(clientsMap.keys()).filter(Boolean);
    return projects.length > 0 ? projects : undefined;
  }

  creationOptions(operation, specDir) {
    const projects = this.projectRoots();
    return {
      date: this.options.date,
      eol: this.options.eol,
      fileSystem: this.options.fileSystem,
      getProjects: () => projects,
      operation,
      pathModule: this.options.pathModule,
      projects,
      specDir,
      specDirsProvider: (projectRoot) => this.specDirsProvider(projectRoot, operation),
      user: this.options.user,
      vscode: this.vscode,
    };
  }

  runCreation(creator, specDir) {
    if (this.disposed) {
      return Promise.resolve(undefined);
    }
    const operation = createFileCreationOperation();
    this.activeOperations.add(operation);

    let workflow;
    try {
      const options = callSyncForOperation(
        operation,
        () => this.creationOptions(operation, specDir),
      );
      workflow = options === DISPOSED_CREATION
        ? DISPOSED_CREATION
        : callForOperation(operation, () => creator(options));
    } catch (error) {
      workflow = Promise.reject(error);
    }
    Promise.resolve(workflow).then(
      (value) => this.finishOperation(operation, "resolve", value),
      (error) => this.finishOperation(operation, "reject", error),
    );
    return operation.promise;
  }

  finishOperation(operation, outcome, value) {
    this.activeOperations.delete(operation);
    operation.completed = true;
    const sources = [...operation.cancellationSources];
    operation.cancellationSources.clear();
    for (const source of sources) {
      cleanupOwnedSource(source, false);
    }
    if (outcome === "reject") {
      operation.reject(value);
      return;
    }
    operation.resolve(value === DISPOSED_CREATION ? undefined : value);
  }

  createSpecification(specDir) {
    const creator = this.options.createSpecification || createSpecification;
    return this.runCreation(creator, specDir);
  }

  createConcept(specDir) {
    const creator = this.options.createConcept || createConcept;
    return this.runCreation(creator, specDir);
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const operations = [...this.activeOperations];
    this.activeOperations.clear();
    for (const operation of operations) {
      operation.cancel();
    }
    const registrations = this.registrations;
    this.registrations = [];
    for (const registration of registrations) {
      cleanupDisposable(registration);
    }
  }
}

module.exports = {
  SpecificationProvider,
  buildConceptDocument,
  buildSpecificationDocument,
  createConcept,
  createGaugeSpecDirsProvider,
  createSpecification,
};
