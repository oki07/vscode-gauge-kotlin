"use strict";

const nodeFs = require("node:fs");
const { envWithGaugeHome } = require("./config/gaugeConfig");

const FORMAT_COMMAND = "format";
const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_EXTENSION = ".spec";
const CONCEPT_FILE_EXTENSION = ".cpt";
const MARKDOWN_SPEC_EXTENSION = ".md";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function isMarkdownSpecDocument(document, filePath) {
  return Boolean(
    document
    && document.languageId === MARKDOWN_LANGUAGE
    && filePath.toLowerCase().endsWith(MARKDOWN_SPEC_EXTENSION)
  );
}

function isSpecDocument(filePath) {
  return filePath.toLowerCase().endsWith(SPEC_FILE_EXTENSION);
}

function isConceptDocument(document, filePath) {
  return Boolean(document && document.languageId === GAUGE_CONCEPT_LANGUAGE)
    || filePath.toLowerCase().endsWith(CONCEPT_FILE_EXTENSION);
}

function collectOutput(stream, chunks, cleanup) {
  if (stream && typeof stream.on === "function") {
    const listener = (chunk) => chunks.push(chunk.toString());
    stream.on("data", listener);
    cleanup.push(() => removeEventListener(stream, "data", listener));
  }
}

function removeEventListener(emitter, event, listener) {
  if (emitter && typeof emitter.removeListener === "function") {
    emitter.removeListener(event, listener);
  } else if (emitter && typeof emitter.off === "function") {
    emitter.off(event, listener);
  }
}

function cancellationRequested(token) {
  return Boolean(token && token.isCancellationRequested);
}

function protectCancelledChild(child) {
  if (!child || typeof child.on !== "function") {
    return;
  }
  const onError = () => {};
  const onClose = () => {
    removeEventListener(child, "error", onError);
    removeEventListener(child, "close", onClose);
  };
  child.on("error", onError);
  child.on("close", onClose);
}

function waitForProcess(command, args, options, token) {
  return new Promise((resolve) => {
    let settled = false;
    let cancellationDisposable;
    const cleanup = [];
    const stdout = [];
    const stderr = [];

    function removeListeners() {
      for (const remove of cleanup.splice(0)) {
        remove();
      }
      if (cancellationDisposable && typeof cancellationDisposable.dispose === "function") {
        cancellationDisposable.dispose();
        cancellationDisposable = undefined;
      }
    }

    let child;
    function settle(result, beforeCleanup) {
      if (settled) {
        return;
      }
      settled = true;
      if (typeof beforeCleanup === "function") {
        try {
          beforeCleanup();
        } catch (_error) {
          // Cancellation remains neutral even when process termination fails.
        }
      }
      removeListeners();
      resolve({
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        ...result,
      });
    }

    function cancel() {
      settle({ cancelled: true }, () => {
        if (child) {
          protectCancelledChild(child);
        }
        if (child && typeof child.kill === "function") {
          child.kill();
        }
      });
    }

    if (cancellationRequested(token)) {
      cancel();
      return;
    }
    try {
      child = command.spawn(args, options);
    } catch (error) {
      if (cancellationRequested(token)) {
        cancel();
      } else {
        settle({ code: 1, error });
      }
      return;
    }
    if (cancellationRequested(token)) {
      cancel();
      return;
    }
    if (!child) {
      settle({ code: 1, error: new Error("Gauge format process did not start.") });
      return;
    }

    collectOutput(child.stdout, stdout, cleanup);
    collectOutput(child.stderr, stderr, cleanup);
    if (typeof child.on === "function") {
      const onError = (error) => settle({ code: 1, error });
      const onExit = (code) => settle({ code });
      const onClose = (code) => settle({ code });
      child.on("error", onError);
      child.on("exit", onExit);
      child.on("close", onClose);
      cleanup.push(
        () => removeEventListener(child, "error", onError),
        () => removeEventListener(child, "exit", onExit),
        () => removeEventListener(child, "close", onClose),
      );
    } else {
      settle({ code: 0 });
      return;
    }
    if (token && typeof token.onCancellationRequested === "function") {
      const disposable = token.onCancellationRequested(cancel);
      if (settled) {
        if (disposable && typeof disposable.dispose === "function") {
          disposable.dispose();
        }
      } else {
        cancellationDisposable = disposable;
      }
    }
    if (cancellationRequested(token)) {
      cancel();
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

function formatFailureMessage(result) {
  const reason = failureReason(result);
  return reason ? `Error on formatting spec. ${reason}` : "Error on formatting spec.";
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

function hasEnvironment(env) {
  return Boolean(env && Object.keys(env).length > 0);
}

function skipEmptyLineInsertions(vscode) {
  if (!vscode.workspace || typeof vscode.workspace.getConfiguration !== "function") {
    return false;
  }
  const configuration = vscode.workspace.getConfiguration("gauge");
  if (!configuration || typeof configuration.get !== "function") {
    return false;
  }
  return Boolean(configuration.get("formatting.skipEmptyLineInsertions"));
}

function showError(vscode, message) {
  if (vscode.window && typeof vscode.window.showErrorMessage === "function") {
    return vscode.window.showErrorMessage(message);
  }
  return undefined;
}

function createPosition(vscode, line, character) {
  return typeof vscode.Position === "function"
    ? new vscode.Position(line, character)
    : { line, character };
}

function createRange(vscode, start, end) {
  const startPosition = createPosition(vscode, start.line, start.character);
  const endPosition = createPosition(vscode, end.line, end.character);
  return typeof vscode.Range === "function"
    ? new vscode.Range(startPosition, endPosition)
    : { start: startPosition, end: endPosition };
}

function createTextEdit(vscode, range, newText) {
  if (vscode.TextEdit && typeof vscode.TextEdit.replace === "function") {
    return vscode.TextEdit.replace(range, newText);
  }
  return { range, newText };
}

function lineText(document, line) {
  if (typeof document.lineAt === "function") {
    return document.lineAt(line).text;
  }
  if (typeof document.getText === "function") {
    return String(document.getText()).split(/\r?\n/)[line] || "";
  }
  return "";
}

function fullDocumentRange(vscode, document) {
  const lineCount = Number.isInteger(document.lineCount)
    ? document.lineCount
    : String(document.getText ? document.getText() : "").split(/\r?\n/).length;
  const lastLine = Math.max(0, lineCount - 1);
  return createRange(
    vscode,
    { line: 0, character: 0 },
    { line: lastLine, character: lineText(document, lastLine).length },
  );
}

class GaugeFormatProvider {
  constructor(options = {}) {
    this.cli = options.cli;
    this.createCli = options.createCli;
    this.env = options.env;
    this.fileSystem = options.fileSystem || nodeFs;
    this.projectFactory = options.projectFactory;
    this.projectEnvironmentService = options.projectEnvironmentService;
    this.vscode = getVscode(options.vscode);
    this.projectEnvironments = new Map();
  }

  async cachedProjectEnvironment(project, cli, token) {
    if (
      this.projectEnvironmentService
      && typeof this.projectEnvironmentService.environmentFor === "function"
    ) {
      return this.projectEnvironmentService.environmentFor(project, cli);
    }
    const root = projectRoot(project);
    if (root && this.projectEnvironments.has(root)) {
      return this.projectEnvironments.get(root);
    }
    const env = projectEnvironment(project, cli);
    if (cancellationRequested(token)) {
      return {};
    }
    if (root && hasEnvironment(env)) {
      this.projectEnvironments.set(root, env);
    }
    return env;
  }

  createCliIfNeeded() {
    if (this.cli) {
      return this.cli;
    }
    if (typeof this.createCli === "function") {
      return this.createCli({ vscode: this.vscode });
    }
    return undefined;
  }

  shouldFormat(document) {
    const filePath = documentPath(document);
    return Boolean(
      document
      && typeof document.getText === "function"
      && filePath
      && (
        document.languageId === GAUGE_LANGUAGE
        || isSpecDocument(filePath)
        || isConceptDocument(document, filePath)
        || isMarkdownSpecDocument(document, filePath)
      ),
    );
  }

  isGaugeProjectRoot(root) {
    if (!root) {
      return false;
    }
    if (
      this.projectFactory
      && typeof this.projectFactory.isGaugeProject === "function"
    ) {
      return this.projectFactory.isGaugeProject(root) !== false;
    }
    return true;
  }

  projectForFile(filePath) {
    if (!this.projectFactory) {
      return undefined;
    }
    if (typeof this.projectFactory.getProjectByFilepath === "function") {
      const project = this.projectFactory.getProjectByFilepath(filePath);
      return this.isGaugeProjectRoot(projectRoot(project)) ? project : undefined;
    }
    if (typeof this.projectFactory.getGaugeRootFromFilePath !== "function") {
      return undefined;
    }
    const root = this.projectFactory.getGaugeRootFromFilePath(filePath);
    if (!this.isGaugeProjectRoot(root)) {
      return undefined;
    }
    if (typeof this.projectFactory.get === "function") {
      return this.projectFactory.get(root);
    }
    return {
      root() {
        return root;
      },
      envs() {
        return {};
      },
    };
  }

  async provideDocumentFormattingEdits(document, _formattingOptions, token) {
    if (cancellationRequested(token) || !this.shouldFormat(document)) {
      return [];
    }

    const filePath = documentPath(document);
    const markdownSpecDocument = isMarkdownSpecDocument(document, filePath);
    let project;
    let root;
    try {
      project = this.projectForFile(filePath);
      root = projectRoot(project);
    } catch (error) {
      if (cancellationRequested(token)) {
        return [];
      }
      if (markdownSpecDocument) {
        return [];
      }
      showError(this.vscode, formatFailureMessage({ error }));
      return [];
    }
    if (cancellationRequested(token)) {
      return [];
    }
    if (!root) {
      if (markdownSpecDocument) {
        return [];
      }
      showError(this.vscode, formatFailureMessage({
        error: new Error("Gauge project root is not available."),
      }));
      return [];
    }

    if (typeof document.save === "function") {
      try {
        await document.save();
      } catch (error) {
        if (cancellationRequested(token)) {
          return [];
        }
        throw error;
      }
    }
    if (cancellationRequested(token)) {
      return [];
    }

    const cli = this.createCliIfNeeded();
    const command = cli && typeof cli.gaugeCommand === "function" && cli.gaugeCommand();
    if (cancellationRequested(token)) {
      return [];
    }
    if (!command || typeof command.spawn !== "function") {
      showError(this.vscode, formatFailureMessage({
        error: new Error("Gauge is not installed."),
      }));
      return [];
    }

    const processOptions = { cwd: root };
    const baseEnv = envWithGaugeHome(this.env || process.env, { vscode: this.vscode });
    if (cancellationRequested(token)) {
      return [];
    }
    let projectEnv;
    try {
      projectEnv = await this.cachedProjectEnvironment(project, cli, token);
    } catch (error) {
      if (cancellationRequested(token)) {
        return [];
      }
      throw error;
    }
    if (cancellationRequested(token)) {
      return [];
    }
    if (this.env || baseEnv !== process.env || hasEnvironment(projectEnv)) {
      processOptions.env = {
        ...baseEnv,
        ...projectEnv,
      };
    }

    const formatArgs = [FORMAT_COMMAND];
    if (skipEmptyLineInsertions(this.vscode)) {
      formatArgs.push("--skip-empty-line-insertions");
    }
    formatArgs.push(filePath);

    const result = await waitForProcess(command, formatArgs, processOptions, token);
    if (result.cancelled || cancellationRequested(token)) {
      return [];
    }
    if (result.code !== 0) {
      showError(this.vscode, formatFailureMessage(result));
      return [];
    }

    let formatted;
    try {
      formatted = this.fileSystem.readFileSync(filePath).toString();
    } catch (error) {
      if (cancellationRequested(token)) {
        return [];
      }
      throw error;
    }
    if (cancellationRequested(token)) {
      return [];
    }
    if (formatted === document.getText()) {
      return [];
    }
    const edit = createTextEdit(
      this.vscode,
      fullDocumentRange(this.vscode, document),
      formatted,
    );
    return cancellationRequested(token) ? [] : [edit];
  }
}

module.exports = {
  GaugeFormatProvider,
};
