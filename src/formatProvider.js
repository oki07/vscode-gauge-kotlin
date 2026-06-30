"use strict";

const nodeFs = require("node:fs");
const { envWithGaugeHome } = require("./config/gaugeConfig");

const FORMAT_COMMAND = "format";
const GAUGE_LANGUAGE = "gauge";
const MARKDOWN_LANGUAGE = "markdown";
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

function isConceptDocument(filePath) {
  return filePath.toLowerCase().endsWith(CONCEPT_FILE_EXTENSION);
}

function collectOutput(stream, chunks) {
  if (stream && typeof stream.on === "function") {
    stream.on("data", (chunk) => chunks.push(chunk.toString()));
  }
}

function waitForProcess(command, args, options) {
  return new Promise((resolve) => {
    let settled = false;
    const stdout = [];
    const stderr = [];

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

    let child;
    try {
      child = command.spawn(args, options);
    } catch (error) {
      settle({ code: 1, error });
      return;
    }
    if (!child) {
      settle({ code: 1, error: new Error("Gauge format process did not start.") });
      return;
    }

    collectOutput(child.stdout, stdout);
    collectOutput(child.stderr, stderr);
    if (typeof child.on === "function") {
      child.on("error", (error) => settle({ code: 1, error }));
      child.on("exit", (code) => settle({ code }));
      child.on("close", (code) => settle({ code }));
    } else {
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
    this.vscode = getVscode(options.vscode);
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
        || isConceptDocument(filePath)
        || isMarkdownSpecDocument(document, filePath)
      ),
    );
  }

  projectForFile(filePath) {
    if (!this.projectFactory) {
      return undefined;
    }
    if (typeof this.projectFactory.getProjectByFilepath === "function") {
      return this.projectFactory.getProjectByFilepath(filePath);
    }
    if (typeof this.projectFactory.getGaugeRootFromFilePath !== "function") {
      return undefined;
    }
    const root = this.projectFactory.getGaugeRootFromFilePath(filePath);
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

  async provideDocumentFormattingEdits(document) {
    if (!this.shouldFormat(document)) {
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
      if (markdownSpecDocument) {
        return [];
      }
      showError(this.vscode, formatFailureMessage({ error }));
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
      await document.save();
    }

    const cli = this.createCliIfNeeded();
    const command = cli && typeof cli.gaugeCommand === "function" && cli.gaugeCommand();
    if (!command || typeof command.spawn !== "function") {
      showError(this.vscode, formatFailureMessage({
        error: new Error("Gauge is not installed."),
      }));
      return [];
    }

    const processOptions = { cwd: root };
    const baseEnv = envWithGaugeHome(this.env || process.env, { vscode: this.vscode });
    const projectEnv = projectEnvironment(project, cli);
    if (this.env || baseEnv !== process.env || hasEnvironment(projectEnv)) {
      processOptions.env = {
        ...baseEnv,
        ...projectEnv,
      };
    }

    const result = await waitForProcess(command, [FORMAT_COMMAND, filePath], processOptions);
    if (result.code !== 0) {
      showError(this.vscode, formatFailureMessage(result));
      return [];
    }

    const formatted = this.fileSystem.readFileSync(filePath).toString();
    if (formatted === document.getText()) {
      return [];
    }
    return [
      createTextEdit(
        this.vscode,
        fullDocumentRange(this.vscode, document),
        formatted,
      ),
    ];
  }
}

module.exports = {
  GaugeFormatProvider,
};
