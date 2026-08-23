"use strict";

const nodeFs = require("node:fs");
const nodeOs = require("node:os");
const nodePath = require("node:path");
const { CLI } = require("./cli");
const { envWithGaugeHome } = require("./config/gaugeConfig");
const { createProjectFactory } = require("./project/projectFactory");

const GAUGE_DOCS_ARGS = ["docs", "spectacle"];
const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const MARKDOWN_SPEC_EXTENSION = ".md";
const GAUGE_FILE_EXTENSIONS = new Set([".spec", ".cpt"]);
const NO_ACTIVE_GAUGE_DOCUMENT_MESSAGE = "Open a Gauge specification or concept to preview.";
const SPECTACLE_PLUGIN_NAME = "spectacle";
const INSTALL_SPECTACLE_ACTION = "Install Spectacle";
const MISSING_SPECTACLE_MESSAGE = "Missing plugin: Spectacle. To install, run `gauge install spectacle` or click below.";
const SPECTACLE_INSTALL_IN_PROGRESS_MESSAGE = "Installation in progress...";
const DISPOSED_PREVIEW = Symbol("disposed Gauge preview");
let spectacleInstallPromise;

function createPreviewOperation() {
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
  const cancellationListeners = new Set();
  return {
    cancellation,
    cancellationListeners,
    cancelled: false,
    completed: false,
    promise,
    publicSettled: false,
    cancel() {
      if (this.cancelled || this.publicSettled) {
        return;
      }
      this.cancelled = true;
      resolveCancellation(DISPOSED_PREVIEW);
      for (const listener of [...cancellationListeners]) {
        listener();
      }
      cancellationListeners.clear();
      this.publicSettled = true;
      resolvePublic(undefined);
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

function getVscode(vscode) {
  return vscode || require("vscode");
}

function showError(vscode, message, ...actions) {
  if (vscode.window && typeof vscode.window.showErrorMessage === "function") {
    return vscode.window.showErrorMessage(message, ...actions);
  }
  return undefined;
}

function showInformation(vscode, message, ...actions) {
  if (vscode.window && typeof vscode.window.showInformationMessage === "function") {
    return vscode.window.showInformationMessage(message, ...actions);
  }
  return undefined;
}

function activeGaugeFile(vscode) {
  const editor = vscode.window && vscode.window.activeTextEditor;
  const document = editor && editor.document;
  const filePath = document && ((document.uri && document.uri.fsPath) || document.fileName);
  if (!document || !filePath) {
    return undefined;
  }
  if (document.languageId === GAUGE_LANGUAGE || document.languageId === GAUGE_CONCEPT_LANGUAGE) {
    return filePath;
  }
  if (GAUGE_FILE_EXTENSIONS.has(nodePath.extname(filePath).toLowerCase())) {
    return filePath;
  }
  if (
    document.languageId === MARKDOWN_LANGUAGE
    && filePath.toLowerCase().endsWith(MARKDOWN_SPEC_EXTENSION)
  ) {
    return filePath;
  }
  return undefined;
}

function getCli(vscode, options) {
  if (options.cli) {
    return options.cli;
  }
  const cliFactory = options.createCli || ((cliOptions) => CLI.instance(cliOptions));
  return cliFactory({ vscode });
}

function getProjectRoot(vscode, fileSystem, pathModule, filePath, options) {
  const projectFactory = options.projectFactory || createProjectFactory({
    fileSystem,
    pathModule,
    vscode,
  });
  const root = projectFactory.getGaugeRootFromFilePath(filePath);
  if (
    root
    && typeof projectFactory.isGaugeProject === "function"
    && projectFactory.isGaugeProject(root) === false
  ) {
    return undefined;
  }
  return root;
}

function projectRoot(project) {
  if (!project) {
    return "";
  }
  if (typeof project.root === "function") {
    return project.root();
  }
  return project.root || project.projectRoot || "";
}

function projectEnvironment(project, cli) {
  if (!project || typeof project.envs !== "function") {
    return {};
  }
  return project.envs(cli) || {};
}

function getPreviewProject(vscode, fileSystem, pathModule, filePath, options) {
  const projectFactory = options.projectFactory || createProjectFactory({
    fileSystem,
    pathModule,
    vscode,
  });
  if (typeof projectFactory.getProjectByFilepath === "function") {
    const project = projectFactory.getProjectByFilepath(filePath);
    const root = projectRoot(project);
    if (
      root
      && typeof projectFactory.isGaugeProject === "function"
      && projectFactory.isGaugeProject(root) === false
    ) {
      return {};
    }
    return { project, root };
  }
  const root = getProjectRoot(vscode, fileSystem, pathModule, filePath, {
    ...options,
    projectFactory,
  });
  if (!root) {
    return {};
  }
  const project = typeof projectFactory.get === "function"
    ? projectFactory.get(root)
    : undefined;
  return { project, root };
}

function defaultTempDir(pathModule, osModule, projectRoot) {
  const projectName = pathModule.basename(projectRoot) || "project";
  return pathModule.join(osModule.tmpdir(), "vscode-gauge-kotlin", "preview", projectName);
}

function ensureDirectory(fileSystem, directory) {
  if (typeof fileSystem.mkdirSync === "function") {
    fileSystem.mkdirSync(directory, { recursive: true });
  }
}

function waitForProcess(command, args, options, operation) {
  return new Promise((resolve) => {
    let cancellationDisposable = { dispose() {} };
    let cancelled = operation.cancelled;
    let child;
    let exitCode;
    let lateErrorListener;
    let listenersCleaned = false;
    let settled = false;
    const stdout = [];
    const stderr = [];
    const onStdout = (chunk) => stdout.push(chunk.toString());
    const onStderr = (chunk) => stderr.push(chunk.toString());

    function settle(result) {
      if (!settled) {
        settled = true;
        resolve({
          stdout: stdout.join(""),
          stderr: stderr.join(""),
          ...result,
        });
      }
    }

    function removeListener(emitter, event, listener) {
      if (emitter && typeof emitter.removeListener === "function") {
        emitter.removeListener(event, listener);
      }
    }

    function cleanupListeners() {
      if (listenersCleaned) {
        return;
      }
      listenersCleaned = true;
      removeListener(child, "error", onError);
      removeListener(child, "exit", onExit);
      removeListener(child, "close", onClose);
      if (lateErrorListener) {
        removeListener(child, "error", lateErrorListener);
      }
      removeListener(child && child.stdout, "data", onStdout);
      removeListener(child && child.stderr, "data", onStderr);
      cancellationDisposable.dispose();
    }

    function protectCancelledChild() {
      if (!child || typeof child.on !== "function") {
        return;
      }
      removeListener(child, "error", onError);
      removeListener(child, "exit", onExit);
      removeListener(child && child.stdout, "data", onStdout);
      removeListener(child && child.stderr, "data", onStderr);
      if (!lateErrorListener) {
        lateErrorListener = () => {};
        child.on("error", lateErrorListener);
      }
    }

    function cancelConsumption() {
      cancelled = true;
      protectCancelledChild();
    }

    function onError(error) {
      settle({ code: 1, error });
    }

    function onExit(code) {
      exitCode = code;
      settle({ code });
    }

    function onClose(code) {
      if (!settled) {
        settle({ code: code === null || code === undefined ? exitCode : code });
      }
      cleanupListeners();
    }

    cancellationDisposable = operation.onCancellation(cancelConsumption);
    try {
      child = command.spawn(args, options);
    } catch (error) {
      cancellationDisposable.dispose();
      if (operation.cancelled) {
        settle({ code: 1 });
        return;
      }
      settle({ code: 1, error });
      return;
    }
    if (!child) {
      cancellationDisposable.dispose();
      settle({ code: 1, error: new Error("Gauge preview process did not start.") });
      return;
    }

    if (typeof child.on === "function") {
      child.on("close", onClose);
      if (cancelled || operation.cancelled) {
        protectCancelledChild();
      } else {
        child.on("error", onError);
        child.on("exit", onExit);
        if (child.stdout && typeof child.stdout.on === "function") {
          child.stdout.on("data", onStdout);
        }
        if (child.stderr && typeof child.stderr.on === "function") {
          child.stderr.on("data", onStderr);
        }
      }
    } else {
      cancellationDisposable.dispose();
      settle({ code: 0 });
    }
  });
}

function withoutDeprecatedOutput(output) {
  return String(output || "")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("[DEPRECATED]"))
    .join("\n")
    .trim();
}

function failureReason(result) {
  return withoutDeprecatedOutput(result.stderr)
    || withoutDeprecatedOutput(result.stdout)
    || (result.error && result.error.message)
    || "";
}

function isSpectacleInstalled(cli) {
  if (!cli || typeof cli.isPluginInstalled !== "function") {
    return true;
  }
  return cli.isPluginInstalled(SPECTACLE_PLUGIN_NAME);
}

async function installSpectacle(vscode, cli) {
  if (spectacleInstallPromise) {
    const sharedInstall = spectacleInstallPromise;
    try {
      Promise.resolve(
        showInformation(vscode, SPECTACLE_INSTALL_IN_PROGRESS_MESSAGE),
      ).catch(() => undefined);
    } catch (_error) {
      // The advisory notification does not own the shared installation.
    }
    return sharedInstall;
  }
  spectacleInstallPromise = Promise.resolve().then(() => cli.installGaugeRunner(SPECTACLE_PLUGIN_NAME));
  try {
    return await spectacleInstallPromise;
  } finally {
    spectacleInstallPromise = undefined;
  }
}

function previewFailureMessage(pathModule, filePath, result) {
  const base = `Unable to create html file for ${pathModule.basename(filePath)}`;
  const reason = failureReason(result);
  return reason ? `${base}. ${reason}` : base;
}

function htmlPathFor(pathModule, projectRoot, docsDir, filePath) {
  const relativeParent = pathModule.relative(projectRoot, pathModule.dirname(filePath));
  const htmlDir = relativeParent && relativeParent !== "."
    ? pathModule.join(docsDir, "html", relativeParent)
    : pathModule.join(docsDir, "html");
  const htmlName = `${pathModule.basename(filePath, pathModule.extname(filePath))}.html`;
  return pathModule.join(htmlDir, htmlName);
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatGaugePreviewText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const formatted = [];
  let index = 0;
  while (index < lines.length) {
    if (/^\s*\|/.test(lines[index])) {
      while (formatted.length > 0 && formatted[formatted.length - 1] === "") {
        formatted.pop();
      }
      if (formatted.length > 0) {
        formatted.push("");
      }
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        formatted.push(`\t${lines[index].trimStart()}`);
        index += 1;
      }
      continue;
    }
    formatted.push(lines[index]);
    index += 1;
  }
  return escapeHtml(formatted.join("\n"));
}

function activeDocumentText(vscode, filePath) {
  const editor = vscode.window && vscode.window.activeTextEditor;
  const document = editor && editor.document;
  const activePath = document && ((document.uri && document.uri.fsPath) || document.fileName);
  if (activePath === filePath && typeof document.getText === "function") {
    return document.getText();
  }
  return undefined;
}

function readGaugeText(vscode, fileSystem, filePath) {
  const text = activeDocumentText(vscode, filePath);
  if (text !== undefined) {
    return text;
  }
  return fileSystem.readFileSync(filePath, "utf8");
}

function fallbackHtml(pathModule, filePath, text) {
  const title = escapeHtml(pathModule.basename(filePath));
  const body = formatGaugePreviewText(text);
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "<meta charset=\"utf-8\">",
    `<title>${title}</title>`,
    "<style>",
    "body { font-family: system-ui, sans-serif; margin: 24px; color: #1f2328; }",
    "pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; line-height: 1.5; }",
    "</style>",
    "</head>",
    "<body>",
    `<pre>${body}</pre>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function openHtml(vscode, filename) {
  const uri = vscode.Uri && typeof vscode.Uri.file === "function"
    ? vscode.Uri.file(filename)
    : { fsPath: filename };
  if (vscode.env && typeof vscode.env.openExternal === "function") {
    return vscode.env.openExternal(uri);
  }
  if (vscode.commands && typeof vscode.commands.executeCommand === "function") {
    return vscode.commands.executeCommand("vscode.open", uri);
  }
  return undefined;
}

class GaugePreviewController {
  constructor(options = {}) {
    this.options = options;
    this.vscode = getVscode(options.vscode);
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.osModule = options.osModule || nodeOs;
    this.activeOperations = new Set();
    this.disposed = false;
  }

  preview() {
    if (this.disposed) {
      return Promise.resolve(undefined);
    }
    const operation = createPreviewOperation();
    this.activeOperations.add(operation);
    let work;
    try {
      work = this.previewForOperation(operation);
    } catch (error) {
      this.finishOperation(operation, "reject", error);
      return operation.promise;
    }
    Promise.resolve(work).then(
      (value) => {
        const result = this.operationStopped(operation) || value === DISPOSED_PREVIEW
          ? undefined
          : value;
        this.finishOperation(operation, "resolve", result);
      },
      (error) => {
        if (this.operationStopped(operation)) {
          this.finishOperation(operation, "resolve", undefined);
          return;
        }
        this.finishOperation(operation, "reject", error);
      },
    );
    return operation.promise;
  }

  async previewForOperation(operation) {
    const filePath = this.callSyncForOperation(
      operation,
      () => activeGaugeFile(this.vscode),
    );
    if (filePath === DISPOSED_PREVIEW) {
      return DISPOSED_PREVIEW;
    }
    if (!filePath) {
      return this.showErrorForOperation(operation, NO_ACTIVE_GAUGE_DOCUMENT_MESSAGE);
    }

    let previewProject;
    try {
      previewProject = this.callSyncForOperation(
        operation,
        () => getPreviewProject(
          this.vscode,
          this.fileSystem,
          this.pathModule,
          filePath,
          this.options,
        ),
      );
    } catch (error) {
      return this.showErrorForOperation(
        operation,
        previewFailureMessage(this.pathModule, filePath, { error }),
      );
    }
    if (previewProject === DISPOSED_PREVIEW) {
      return DISPOSED_PREVIEW;
    }
    const { project, root: projectRoot } = previewProject;
    if (!projectRoot) {
      return this.showErrorForOperation(operation, NO_ACTIVE_GAUGE_DOCUMENT_MESSAGE);
    }

    const cli = this.callSyncForOperation(
      operation,
      () => getCli(this.vscode, this.options),
    );
    if (cli === DISPOSED_PREVIEW) {
      return DISPOSED_PREVIEW;
    }
    const previewRoot = this.callSyncForOperation(
      operation,
      () => (this.options.tempDirProvider
        ? this.options.tempDirProvider(projectRoot, filePath)
        : defaultTempDir(this.pathModule, this.osModule, projectRoot)),
    );
    if (previewRoot === DISPOSED_PREVIEW) {
      return DISPOSED_PREVIEW;
    }
    const docsDir = this.pathModule.join(previewRoot, "docs");
    const spectacleInstalled = this.callSyncForOperation(
      operation,
      () => isSpectacleInstalled(cli),
    );
    if (spectacleInstalled === DISPOSED_PREVIEW) {
      return DISPOSED_PREVIEW;
    }
    if (!spectacleInstalled) {
      return this.previewWithoutSpectacle(
        operation,
        cli,
        projectRoot,
        previewRoot,
        docsDir,
        filePath,
      );
    }

    const command = this.callSyncForOperation(
      operation,
      () => cli && typeof cli.gaugeCommand === "function" && cli.gaugeCommand(),
    );
    if (command === DISPOSED_PREVIEW) {
      return DISPOSED_PREVIEW;
    }
    if (!command || typeof command.spawn !== "function") {
      return this.showErrorForOperation(
        operation,
        previewFailureMessage(this.pathModule, filePath, {
          error: new Error("Gauge is not installed."),
        }),
      );
    }
    if (!this.ensureDirectoryForOperation(operation, previewRoot)
      || !this.ensureDirectoryForOperation(operation, docsDir)) {
      return DISPOSED_PREVIEW;
    }
    const env = this.callSyncForOperation(
      operation,
      () => envWithGaugeHome(this.options.env || process.env, { vscode: this.vscode }),
    );
    if (env === DISPOSED_PREVIEW) {
      return DISPOSED_PREVIEW;
    }

    let projectEnv;
    if (this.options.projectEnvironmentService
      && typeof this.options.projectEnvironmentService.environmentFor === "function") {
      projectEnv = await this.callForOperation(
        operation,
        () => this.options.projectEnvironmentService.environmentFor(project, cli),
      );
    } else {
      projectEnv = this.callSyncForOperation(
        operation,
        () => projectEnvironment(project, cli),
      );
    }
    if (projectEnv === DISPOSED_PREVIEW) {
      return DISPOSED_PREVIEW;
    }

    const result = await this.awaitOperation(
      operation,
      waitForProcess(
        command,
        [...GAUGE_DOCS_ARGS, filePath],
        {
          cwd: projectRoot,
          env: {
            ...env,
            ...projectEnv,
            spectacle_out_dir: docsDir,
          },
        },
        operation,
      ),
    );
    if (result === DISPOSED_PREVIEW) {
      return DISPOSED_PREVIEW;
    }
    if (result.code !== 0) {
      return this.showErrorForOperation(
        operation,
        previewFailureMessage(this.pathModule, filePath, result),
      );
    }

    return this.openHtmlForOperation(
      operation,
      htmlPathFor(this.pathModule, projectRoot, docsDir, filePath),
    );
  }

  async previewWithoutSpectacle(
    operation,
    cli,
    projectRoot,
    previewRoot,
    docsDir,
    filePath,
  ) {
    try {
      const selection = await this.showErrorForOperation(
        operation,
        MISSING_SPECTACLE_MESSAGE,
        INSTALL_SPECTACLE_ACTION,
      );
      if (selection === DISPOSED_PREVIEW) {
        return DISPOSED_PREVIEW;
      }
      if (selection === INSTALL_SPECTACLE_ACTION
        && cli
        && typeof cli.installGaugeRunner === "function") {
        const installed = await this.callForOperation(
          operation,
          () => installSpectacle(this.vscode, cli),
        );
        if (installed === DISPOSED_PREVIEW) {
          return DISPOSED_PREVIEW;
        }
      }
      if (!this.ensureDirectoryForOperation(operation, previewRoot)
        || !this.ensureDirectoryForOperation(operation, docsDir)) {
        return DISPOSED_PREVIEW;
      }
      return this.writeFallbackPreviewForOperation(
        operation,
        projectRoot,
        docsDir,
        filePath,
      );
    } catch (error) {
      if (this.operationStopped(operation)) {
        return DISPOSED_PREVIEW;
      }
      return this.showErrorForOperation(
        operation,
        previewFailureMessage(this.pathModule, filePath, { error }),
      );
    }
  }

  async writeFallbackPreviewForOperation(operation, projectRoot, docsDir, filePath) {
    const htmlPath = htmlPathFor(this.pathModule, projectRoot, docsDir, filePath);
    if (!this.ensureDirectoryForOperation(operation, this.pathModule.dirname(htmlPath))) {
      return DISPOSED_PREVIEW;
    }
    const text = this.callSyncForOperation(
      operation,
      () => readGaugeText(this.vscode, this.fileSystem, filePath),
    );
    if (text === DISPOSED_PREVIEW) {
      return DISPOSED_PREVIEW;
    }
    const html = fallbackHtml(this.pathModule, filePath, text);
    const written = this.callSyncForOperation(
      operation,
      () => this.fileSystem.writeFileSync(htmlPath, html, "utf8"),
    );
    if (written === DISPOSED_PREVIEW) {
      return DISPOSED_PREVIEW;
    }
    return this.openHtmlForOperation(operation, htmlPath);
  }

  ensureDirectoryForOperation(operation, directory) {
    return this.callSyncForOperation(
      operation,
      () => ensureDirectory(this.fileSystem, directory),
    ) !== DISPOSED_PREVIEW;
  }

  showErrorForOperation(operation, message, ...actions) {
    return this.callForOperation(
      operation,
      () => showError(this.vscode, message, ...actions),
    );
  }

  openHtmlForOperation(operation, filename) {
    return this.callForOperation(
      operation,
      () => openHtml(this.vscode, filename),
    );
  }

  callSyncForOperation(operation, callback) {
    if (this.operationStopped(operation)) {
      return DISPOSED_PREVIEW;
    }
    let value;
    try {
      value = callback();
    } catch (error) {
      if (this.operationStopped(operation)) {
        return DISPOSED_PREVIEW;
      }
      throw error;
    }
    return this.operationStopped(operation) ? DISPOSED_PREVIEW : value;
  }

  callForOperation(operation, callback) {
    if (this.operationStopped(operation)) {
      return Promise.resolve(DISPOSED_PREVIEW);
    }
    let value;
    try {
      value = callback();
    } catch (error) {
      if (this.operationStopped(operation)) {
        return Promise.resolve(DISPOSED_PREVIEW);
      }
      return Promise.reject(error);
    }
    if (this.operationStopped(operation)) {
      Promise.resolve(value).catch(() => undefined);
      return Promise.resolve(DISPOSED_PREVIEW);
    }
    return this.awaitOperation(operation, value);
  }

  async awaitOperation(operation, value) {
    if (this.operationStopped(operation)) {
      return DISPOSED_PREVIEW;
    }
    try {
      const result = await Promise.race([
        Promise.resolve(value),
        operation.cancellation,
      ]);
      if (result === DISPOSED_PREVIEW || this.operationStopped(operation)) {
        return DISPOSED_PREVIEW;
      }
      return result;
    } catch (error) {
      if (this.operationStopped(operation)) {
        return DISPOSED_PREVIEW;
      }
      throw error;
    }
  }

  operationStopped(operation) {
    return this.disposed || !operation || operation.cancelled;
  }

  finishOperation(operation, outcome, value) {
    this.activeOperations.delete(operation);
    operation.completed = true;
    operation.cancellationListeners.clear();
    if (outcome === "reject") {
      operation.reject(value);
      return;
    }
    operation.resolve(value);
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
  }
}

function previewGaugeDocument(options = {}) {
  const controller = new GaugePreviewController(options);
  return Promise.resolve(controller.preview()).finally(() => controller.dispose());
}

module.exports = {
  GAUGE_DOCS_ARGS,
  GaugePreviewController,
  NO_ACTIVE_GAUGE_DOCUMENT_MESSAGE,
  previewGaugeDocument,
};
