"use strict";

const nodeFs = require("node:fs");
const nodeOs = require("node:os");
const nodePath = require("node:path");
const { CLI } = require("./cli");
const { createProjectFactory } = require("./project/projectFactory");

const GAUGE_DOCS_ARGS = ["docs", "spectacle"];
const NO_ACTIVE_GAUGE_DOCUMENT_MESSAGE = "Open a Gauge specification or concept to preview.";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function showError(vscode, message) {
  if (vscode.window && typeof vscode.window.showErrorMessage === "function") {
    return vscode.window.showErrorMessage(message);
  }
  return undefined;
}

function activeGaugeFile(vscode) {
  const editor = vscode.window && vscode.window.activeTextEditor;
  const document = editor && editor.document;
  if (!document || document.languageId !== "gauge") {
    return undefined;
  }
  return (document.uri && document.uri.fsPath) || document.fileName;
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
  return projectFactory.getGaugeRootFromFilePath(filePath);
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
      settle({ code: 1, error: new Error("Gauge preview process did not start.") });
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

async function previewGaugeDocument(options = {}) {
  const vscode = getVscode(options.vscode);
  const filePath = activeGaugeFile(vscode);
  if (!filePath) {
    return showError(vscode, NO_ACTIVE_GAUGE_DOCUMENT_MESSAGE);
  }

  const fileSystem = options.fileSystem || nodeFs;
  const pathModule = options.pathModule || nodePath;
  const osModule = options.osModule || nodeOs;
  let projectRoot;
  try {
    projectRoot = getProjectRoot(vscode, fileSystem, pathModule, filePath, options);
  } catch (error) {
    return showError(vscode, previewFailureMessage(pathModule, filePath, { error }));
  }

  const cli = getCli(vscode, options);
  const command = cli && typeof cli.gaugeCommand === "function" && cli.gaugeCommand();
  if (!command || typeof command.spawn !== "function") {
    return showError(vscode, previewFailureMessage(pathModule, filePath, {
      error: new Error("Gauge is not installed."),
    }));
  }

  const previewRoot = options.tempDirProvider
    ? options.tempDirProvider(projectRoot, filePath)
    : defaultTempDir(pathModule, osModule, projectRoot);
  const docsDir = pathModule.join(previewRoot, "docs");
  ensureDirectory(fileSystem, previewRoot);
  ensureDirectory(fileSystem, docsDir);

  const result = await waitForProcess(
    command,
    [...GAUGE_DOCS_ARGS, filePath],
    {
      cwd: projectRoot,
      env: {
        ...(options.env || process.env),
        spectacle_out_dir: docsDir,
      },
    },
  );
  if (result.code !== 0) {
    return showError(vscode, previewFailureMessage(pathModule, filePath, result));
  }

  return openHtml(vscode, htmlPathFor(pathModule, projectRoot, docsDir, filePath));
}

module.exports = {
  GAUGE_DOCS_ARGS,
  NO_ACTIVE_GAUGE_DOCUMENT_MESSAGE,
  previewGaugeDocument,
};
