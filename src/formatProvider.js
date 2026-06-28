"use strict";

const nodeFs = require("node:fs");

const FORMAT_COMMAND = "format";
const GAUGE_LANGUAGE = "gauge";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
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

function failureReason(result) {
  return (result.stderr || result.stdout || (result.error && result.error.message) || "")
    .trim();
}

function formatFailureMessage(result) {
  const reason = failureReason(result);
  return reason ? `Error on formatting spec. ${reason}` : "Error on formatting spec.";
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
    return Boolean(
      document
      && document.languageId === GAUGE_LANGUAGE
      && typeof document.getText === "function"
      && documentPath(document),
    );
  }

  async provideDocumentFormattingEdits(document) {
    if (!this.shouldFormat(document)) {
      return [];
    }
    if (typeof document.save === "function") {
      await document.save();
    }

    const filePath = documentPath(document);
    let projectRoot;
    try {
      projectRoot = this.projectFactory.getGaugeRootFromFilePath(filePath);
    } catch (error) {
      showError(this.vscode, formatFailureMessage({ error }));
      return [];
    }

    const cli = this.createCliIfNeeded();
    const command = cli && typeof cli.gaugeCommand === "function" && cli.gaugeCommand();
    if (!command || typeof command.spawn !== "function") {
      showError(this.vscode, formatFailureMessage({
        error: new Error("Gauge is not installed."),
      }));
      return [];
    }

    const result = await waitForProcess(command, [FORMAT_COMMAND, filePath], { cwd: projectRoot });
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
