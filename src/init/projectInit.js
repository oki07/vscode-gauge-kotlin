"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { envWithGaugeHome } = require("../config/gaugeConfig");
const {
  isGaugeProjectRoot,
  manifestLanguage,
  readProjectManifest,
} = require("../project/manifest");

const CREATE_PROJECT_COMMAND = "gauge.createProject";
const GAUGE_INIT_ARG = "init";
const OPEN_FOLDER_COMMAND = "vscode.openFolder";
const TEMPLATE_LIST_ARGS = ["template", "--list", "--machine-readable"];
const INSTALL_INSTRUCTION_URI = "https://docs.gauge.org/getting_started/installing-gauge.html";
const KOTLIN_TEMPLATE_CONFIGURATION = "gauge.kotlin";
const TEMPLATE_CONFIGURATION_KEY = "template";
const MINIMUM_SUPPORTED_GAUGE_VERSION = "0.9.6";
const EXISTING_GAUGE_PROJECT_MESSAGE =
  "Given location is already a Gauge Project. Please try to initialize a Gauge project in a different location.";
const NO_KOTLIN_TEMPLATES_MESSAGE = "No Kotlin Gauge project templates are available.";
const NON_KOTLIN_PROJECT_MESSAGE = "Selected template did not create a Kotlin Gauge project.";
const DISPOSED_OPERATION = Symbol("disposed project initialization");

function getVscode(vscode) {
  return vscode || require("vscode");
}

function removeDirectory(fileSystem, dirname) {
  if (typeof fileSystem.removeSync === "function") {
    fileSystem.removeSync(dirname);
    return;
  }
  if (typeof fileSystem.rmSync === "function") {
    fileSystem.rmSync(dirname, { recursive: true, force: true });
  }
}

function templateText(template) {
  return [
    template.label,
    template.description,
    template.value,
  ].filter(Boolean).join(" ").toLowerCase();
}

function templateScore(template, preferredBuildTool) {
  const text = templateText(template);
  if (!text.includes("kotlin")) {
    return 0;
  }
  if (preferredBuildTool && text.includes(preferredBuildTool)) {
    return 2;
  }
  return 1;
}

function isKotlinTemplate(template) {
  return templateText(template).includes("kotlin");
}

function isGaugeProjectDir(fileSystem, pathModule, dirname) {
  return isGaugeProjectRoot(fileSystem, pathModule, dirname);
}

function isKotlinGaugeProjectDir(fileSystem, pathModule, dirname) {
  try {
    const manifest = readProjectManifest(fileSystem, pathModule, dirname);
    return String(manifestLanguage(manifest) || "").trim().toLowerCase() === "kotlin";
  } catch (_error) {
    return false;
  }
}

class ProgressHandler {
  constructor(vscode, progress, resolve, reject) {
    this.vscode = vscode;
    this.progress = progress;
    this.resolve = resolve;
    this.reject = reject;
    this.settled = false;
  }

  report(message) {
    this.progress.report({ message });
  }

  end(uri) {
    if (this.settled) {
      return undefined;
    }
    this.settled = true;
    this.resolve();
    return this.vscode.commands.executeCommand(
      OPEN_FOLDER_COMMAND,
      uri,
      Boolean(this.vscode.workspace && this.vscode.workspace.workspaceFolders),
    );
  }

  cancel(message) {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.reject(String(message));
  }

  fail(error) {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.reject(error);
  }

  neutral() {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolve();
  }
}

function createInitializationOperation() {
  let resolveCancellation;
  const cancellation = new Promise((resolve) => {
    resolveCancellation = resolve;
  });
  const cancellationListeners = new Set();
  return {
    cancellation,
    cancellationListeners,
    cancelled: false,
    childStarted: false,
    completed: false,
    directoryCleaned: false,
    directoryOwned: false,
    projectFolder: undefined,
    spawnStarted: false,
    cancel() {
      if (this.cancelled || this.completed) {
        return;
      }
      this.cancelled = true;
      resolveCancellation(DISPOSED_OPERATION);
      for (const listener of [...cancellationListeners]) {
        listener();
      }
      cancellationListeners.clear();
    },
    onCancellation(listener) {
      if (this.cancelled) {
        listener();
        return { dispose() {} };
      }
      cancellationListeners.add(listener);
      let disposed = false;
      return {
        dispose() {
          if (disposed) {
            return;
          }
          disposed = true;
          cancellationListeners.delete(listener);
        },
      };
    },
  };
}

class ProjectInitializer {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.pathModule = options.pathModule || nodePath;
    this.fileSystem = options.fileSystem || nodeFs;
    this.env = envWithGaugeHome(options.env || process.env, {
      vscode: this.vscode,
      gaugeHome: options.gaugeHome,
    });
    this.cli = options.cli;
    this.createCli = options.createCli;
    this.activeOperations = new Set();
    this.disposed = false;
    this.disposables = [];
    this.registerCommand();
  }

  registerCommand() {
    if (this.disposed) {
      return;
    }
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return;
    }
    const disposable = this.vscode.commands.registerCommand(
      CREATE_PROJECT_COMMAND,
      () => this.createProject(),
    );
    if (this.disposed) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
      return;
    }
    this.disposables.push(disposable);
  }

  getCli() {
    if (this.disposed) {
      return undefined;
    }
    if (!this.cli && this.createCli) {
      this.cli = this.createCli({ vscode: this.vscode });
    }
    return this.cli;
  }

  isGaugeVersionSupported(cli) {
    if (this.disposed) {
      return false;
    }
    if (!cli || typeof cli.isGaugeVersionGreaterOrEqual !== "function") {
      return true;
    }
    return cli.isGaugeVersionGreaterOrEqual(MINIMUM_SUPPORTED_GAUGE_VERSION);
  }

  async createProject() {
    if (this.disposed) {
      return undefined;
    }
    const operation = createInitializationOperation();
    this.activeOperations.add(operation);
    try {
      const result = await this.createProjectForOperation(operation);
      if (this.operationStopped(operation)) {
        return undefined;
      }
      return result === DISPOSED_OPERATION ? undefined : result;
    } catch (error) {
      if (this.operationStopped(operation)) {
        return undefined;
      }
      throw error;
    } finally {
      this.completeOperation(operation);
    }
  }

  async createProjectForOperation(operation) {
    if (this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    const cli = this.getCli();
    if (this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    if (!cli || !cli.isGaugeInstalled()) {
      return this.callForOperation(
        operation,
        () => this.vscode.window.showErrorMessage(
          `Please install gauge to create a new Gauge project.For more info please refer the [install intructions](${INSTALL_INSTRUCTION_URI}).`,
        ),
      );
    }
    if (this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    if (!this.isGaugeVersionSupported(cli)) {
      return this.callForOperation(
        operation,
        () => this.vscode.window.showErrorMessage(
          `This version of Gauge Kotlin only works with Gauge version >= ${MINIMUM_SUPPORTED_GAUGE_VERSION}`,
        ),
      );
    }

    const templates = await this.getTemplatesList(cli, operation);
    if (this.operationStopped(operation) || templates === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (templates.length === 0) {
      return undefined;
    }
    const template = await this.callForOperation(
      operation,
      () => this.vscode.window.showQuickPick(templates),
    );
    if (template === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (!template) {
      return undefined;
    }
    const folders = await this.getTargetFolder(operation);
    if (folders === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (!folders) {
      return undefined;
    }
    const name = await this.callForOperation(
      operation,
      () => this.vscode.window.showInputBox({
        prompt: "Enter a name for your new project",
        placeHolder: "gauge-tests",
      }),
    );
    if (name === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (!name) {
      return undefined;
    }

    const projectFolderUri = this.vscode.Uri.file(this.pathModule.join(folders[0].fsPath, name));
    if (this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    const directoryExists = this.fileSystem.existsSync(projectFolderUri.fsPath);
    if (this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    if (directoryExists) {
      const gaugeProjectExists = isGaugeProjectDir(
        this.fileSystem,
        this.pathModule,
        projectFolderUri.fsPath,
      );
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      return this.callForOperation(
        operation,
        () => this.handleError(
          null,
          gaugeProjectExists
            ? EXISTING_GAUGE_PROJECT_MESSAGE
            : `A folder named ${name} already exists in ${folders[0].fsPath}`,
          projectFolderUri.fsPath,
          false,
        ),
      );
    }
    this.fileSystem.mkdirSync(projectFolderUri.fsPath);
    operation.directoryOwned = true;
    operation.projectFolder = projectFolderUri;
    if (this.operationStopped(operation)) {
      this.cleanupOperationDirectory(operation);
      return DISPOSED_OPERATION;
    }
    return this.createProjectInDir(cli, template, projectFolderUri, operation);
  }

  getTargetFolder(operation) {
    if (operation && this.operationStopped(operation)) {
      return Promise.resolve(DISPOSED_OPERATION);
    }
    if (!operation && this.disposed) {
      return Promise.resolve(undefined);
    }
    return this.callForOperation(
      operation,
      () => this.vscode.window.showOpenDialog({
        canSelectFolders: true,
        openLabel: "Select a folder to create the project in",
        canSelectMany: false,
      }),
    );
  }

  getPreferredKotlinTemplate() {
    if (this.disposed) {
      return undefined;
    }
    if (!this.vscode.workspace || typeof this.vscode.workspace.getConfiguration !== "function") {
      return undefined;
    }
    const configuration = this.vscode.workspace.getConfiguration(KOTLIN_TEMPLATE_CONFIGURATION);
    if (this.disposed) {
      return undefined;
    }
    if (!configuration || typeof configuration.get !== "function") {
      return undefined;
    }
    const value = configuration.get(TEMPLATE_CONFIGURATION_KEY);
    if (this.disposed) {
      return undefined;
    }
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim().toLowerCase();
    return normalized || undefined;
  }

  sortTemplatesByPreference(templates) {
    const preferredBuildTool = this.getPreferredKotlinTemplate();
    if (!preferredBuildTool) {
      return templates;
    }
    return templates.slice().sort((left, right) => (
      templateScore(right, preferredBuildTool) - templateScore(left, preferredBuildTool)
    ));
  }

  async createProjectInDir(cli, template, projectFolder, operation) {
    const runner = (progress) => new Promise((resolve, reject) => {
      if (this.operationStopped(operation)) {
        this.cleanupOperationDirectory(operation);
        resolve(undefined);
        return;
      }
      const progressHandler = new ProgressHandler(this.vscode, progress, resolve, reject);
      this.createFromCommandLine(cli, template, projectFolder, progressHandler, operation);
    });
    let pending;
    try {
      if (this.vscode.window && typeof this.vscode.window.withProgress === "function") {
        pending = this.vscode.window.withProgress({ location: 10 }, runner);
      } else {
        pending = runner({ report() {} });
      }
    } catch (error) {
      if (this.operationStopped(operation)) {
        if (!operation.spawnStarted) {
          this.cleanupOperationDirectory(operation);
        }
        return DISPOSED_OPERATION;
      }
      throw error;
    }
    return this.awaitOperation(operation, pending);
  }

  createFromCommandLine(cli, template, projectFolder, progressHandler, operation) {
    let child;
    let childOutcomeHandled = false;
    let listenersCleaned = false;
    let lateErrorListener;
    let cancellationDisposable;
    const onStdout = () => {};
    const cleanupListeners = () => {
      if (listenersCleaned) {
        return;
      }
      listenersCleaned = true;
      if (child) {
        child.removeListener("error", onError);
        child.removeListener("close", onClose);
        if (lateErrorListener) {
          child.removeListener("error", lateErrorListener);
        }
        if (child.stdout && typeof child.stdout.removeListener === "function") {
          child.stdout.removeListener("data", onStdout);
        }
      }
      if (cancellationDisposable) {
        cancellationDisposable.dispose();
      }
    };
    const detachAfterError = () => {
      child.removeListener("error", onError);
      lateErrorListener = () => {};
      child.on("error", lateErrorListener);
      if (child.stdout && typeof child.stdout.removeListener === "function") {
        child.stdout.removeListener("data", onStdout);
      }
      if (cancellationDisposable) {
        cancellationDisposable.dispose();
      }
    };
    const settleFailure = (message, fromErrorEvent = false) => {
      if (childOutcomeHandled) {
        return;
      }
      childOutcomeHandled = true;
      if (fromErrorEvent) {
        detachAfterError();
      } else {
        cleanupListeners();
      }
      this.cleanupOperationDirectory(operation);
      if (this.operationStopped(operation)) {
        progressHandler.neutral();
        return;
      }
      this.completeOperation(operation);
      const notification = this.handleError(
        progressHandler,
        message,
        projectFolder.fsPath,
        false,
      );
      this.observeHostPromise(notification, operation);
    };
    const onError = (error) => {
      settleFailure(`Failed to create template. ${error.message}`, true);
    };
    const onClose = (code) => {
      cleanupListeners();
      if (childOutcomeHandled) {
        return;
      }
      childOutcomeHandled = true;
      if (this.operationStopped(operation)) {
        if (code !== 0) {
          this.cleanupOperationDirectory(operation);
        }
        progressHandler.neutral();
        return;
      }
      if (code !== 0) {
        this.cleanupOperationDirectory(operation);
        if (this.operationStopped(operation)) {
          progressHandler.neutral();
          return;
        }
        this.completeOperation(operation);
        const notification = this.handleError(
          progressHandler,
          "Failed to initialize project.",
          projectFolder.fsPath,
          false,
        );
        this.observeHostPromise(notification, operation);
        return;
      }
      const kotlinProject = isKotlinGaugeProjectDir(
        this.fileSystem,
        this.pathModule,
        projectFolder.fsPath,
      );
      if (this.operationStopped(operation)) {
        progressHandler.neutral();
        return;
      }
      if (!kotlinProject) {
        this.cleanupOperationDirectory(operation);
        if (this.operationStopped(operation)) {
          progressHandler.neutral();
          return;
        }
        this.completeOperation(operation);
        const notification = this.handleError(
          progressHandler,
          NON_KOTLIN_PROJECT_MESSAGE,
          projectFolder.fsPath,
          false,
        );
        this.observeHostPromise(notification, operation);
        return;
      }
      this.completeOperation(operation);
      let opening;
      try {
        opening = progressHandler.end(projectFolder);
      } catch (error) {
        if (!this.disposed) {
          throw error;
        }
        return;
      }
      this.observeHostPromise(opening, operation);
    };

    cancellationDisposable = operation.onCancellation(() => progressHandler.neutral());
    try {
      const command = cli.gaugeCommand();
      if (this.operationStopped(operation)) {
        this.cleanupOperationDirectory(operation);
        progressHandler.neutral();
        cancellationDisposable.dispose();
        return;
      }
      progressHandler.report("Initializing project...");
      if (this.operationStopped(operation)) {
        this.cleanupOperationDirectory(operation);
        progressHandler.neutral();
        cancellationDisposable.dispose();
        return;
      }
      operation.spawnStarted = true;
      child = command.spawn([GAUGE_INIT_ARG, template.label], {
        cwd: projectFolder.fsPath,
        env: this.env,
      });
      operation.childStarted = true;
    } catch (error) {
      cancellationDisposable.dispose();
      if (this.operationStopped(operation)) {
        this.cleanupOperationDirectory(operation);
        progressHandler.neutral();
        return;
      }
      this.completeOperation(operation);
      progressHandler.fail(error);
      return;
    }
    child.addListener("error", onError);
    child.on("close", onClose);
    if (child.stdout && typeof child.stdout.on === "function") {
      child.stdout.on("data", onStdout);
    }
    if (this.operationStopped(operation)) {
      progressHandler.neutral();
    }
  }

  async getTemplatesList(cli, operation) {
    if (!operation && this.disposed) {
      return [];
    }
    if (operation && this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    const command = cli.gaugeCommand();
    if (operation && this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    const result = command.spawnSync(TEMPLATE_LIST_ARGS, { env: this.env });
    if (operation && this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    try {
      const templates = JSON.parse(result.stdout.toString()).map((template) => ({
        label: template.key,
        description: template.Description,
        value: template.value,
      }));
      const kotlinTemplates = templates.filter(isKotlinTemplate);
      if (kotlinTemplates.length === 0) {
        const resultValue = await this.callForOperation(
          operation,
          () => this.vscode.window.showErrorMessage(NO_KOTLIN_TEMPLATES_MESSAGE),
        );
        if (resultValue === DISPOSED_OPERATION) {
          return DISPOSED_OPERATION;
        }
        return [];
      }
      const sorted = this.sortTemplatesByPreference(kotlinTemplates);
      return operation && this.operationStopped(operation) ? DISPOSED_OPERATION : sorted;
    } catch (_error) {
      // The suggestion belongs in the message: a second argument renders as a
      // button that does nothing. The official extension spells the flag with
      // four dashes, which Gauge does not accept (cmd/cmd.go machineReadableName).
      const resultValue = await this.callForOperation(
        operation,
        () => this.vscode.window.showErrorMessage(
          "Failed to get list of templates."
          + " Try running 'gauge template --list --machine-readable' from the command line.",
        ),
      );
      if (resultValue === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      return [];
    }
  }

  operationStopped(operation) {
    return this.disposed || !operation || operation.cancelled;
  }

  async awaitOperation(operation, value) {
    if (this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    try {
      const result = await Promise.race([
        Promise.resolve(value),
        operation.cancellation,
      ]);
      if (result === DISPOSED_OPERATION || this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      return result;
    } catch (error) {
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      throw error;
    }
  }

  callForOperation(operation, callback) {
    if (operation && this.operationStopped(operation)) {
      return Promise.resolve(DISPOSED_OPERATION);
    }
    if (!operation && this.disposed) {
      return Promise.resolve(undefined);
    }
    let value;
    try {
      value = callback();
    } catch (error) {
      if ((operation && this.operationStopped(operation)) || this.disposed) {
        return Promise.resolve(operation ? DISPOSED_OPERATION : undefined);
      }
      return Promise.reject(error);
    }
    return operation ? this.awaitOperation(operation, value) : Promise.resolve(value);
  }

  completeOperation(operation) {
    if (!operation || operation.completed) {
      return;
    }
    operation.completed = true;
    this.activeOperations.delete(operation);
  }

  cleanupOperationDirectory(operation) {
    if (!operation
      || !operation.directoryOwned
      || operation.directoryCleaned
      || !operation.projectFolder) {
      return;
    }
    operation.directoryCleaned = true;
    removeDirectory(this.fileSystem, operation.projectFolder.fsPath);
  }

  observeHostPromise(value, operation) {
    if (!value || typeof value.then !== "function") {
      return;
    }
    Promise.resolve(value).catch((error) => {
      if (this.disposed || operation.cancelled) {
        return undefined;
      }
      throw error;
    });
  }

  handleError(progressHandler, error, dirname, removeDir = true) {
    if (this.disposed) {
      return undefined;
    }
    if (removeDir) {
      removeDirectory(this.fileSystem, dirname);
    }
    if (progressHandler) {
      progressHandler.cancel(error);
    }
    return this.vscode.window.showErrorMessage(error);
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
      if (!operation.spawnStarted) {
        this.cleanupOperationDirectory(operation);
      }
    }
    const disposables = this.disposables;
    this.disposables = [];
    for (const disposable of disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
  }
}

module.exports = {
  ProjectInitializer,
};
