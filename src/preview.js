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
let spectacleInstallPromise;

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
    await showInformation(vscode, SPECTACLE_INSTALL_IN_PROGRESS_MESSAGE);
    return spectacleInstallPromise;
  }
  spectacleInstallPromise = Promise.resolve().then(() => cli.installGaugeRunner(SPECTACLE_PLUGIN_NAME));
  try {
    return await spectacleInstallPromise;
  } finally {
    spectacleInstallPromise = undefined;
  }
}

async function promptToInstallSpectacle(vscode, cli) {
  const selection = await showInformation(
    vscode,
    MISSING_SPECTACLE_MESSAGE,
    INSTALL_SPECTACLE_ACTION,
  );
  if (
    selection === INSTALL_SPECTACLE_ACTION
    && cli
    && typeof cli.installGaugeRunner === "function"
  ) {
    return installSpectacle(vscode, cli);
  }
  return undefined;
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

function writeFallbackPreview(vscode, fileSystem, pathModule, projectRoot, docsDir, filePath) {
  const htmlPath = htmlPathFor(pathModule, projectRoot, docsDir, filePath);
  ensureDirectory(fileSystem, pathModule.dirname(htmlPath));
  const text = readGaugeText(vscode, fileSystem, filePath);
  fileSystem.writeFileSync(htmlPath, fallbackHtml(pathModule, filePath, text), "utf8");
  return openHtml(vscode, htmlPath);
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
  let project;
  let projectRoot;
  try {
    const previewProject = getPreviewProject(vscode, fileSystem, pathModule, filePath, options);
    project = previewProject.project;
    projectRoot = previewProject.root;
  } catch (error) {
    return showError(vscode, previewFailureMessage(pathModule, filePath, { error }));
  }
  if (!projectRoot) {
    return showError(vscode, NO_ACTIVE_GAUGE_DOCUMENT_MESSAGE);
  }

  const cli = getCli(vscode, options);
  const previewRoot = options.tempDirProvider
    ? options.tempDirProvider(projectRoot, filePath)
    : defaultTempDir(pathModule, osModule, projectRoot);
  const docsDir = pathModule.join(previewRoot, "docs");
  if (!isSpectacleInstalled(cli)) {
    try {
      await promptToInstallSpectacle(vscode, cli);
      ensureDirectory(fileSystem, previewRoot);
      ensureDirectory(fileSystem, docsDir);
      return writeFallbackPreview(vscode, fileSystem, pathModule, projectRoot, docsDir, filePath);
    } catch (error) {
      return showError(vscode, previewFailureMessage(pathModule, filePath, { error }));
    }
  }

  const command = cli && typeof cli.gaugeCommand === "function" && cli.gaugeCommand();
  if (!command || typeof command.spawn !== "function") {
    return showError(vscode, previewFailureMessage(pathModule, filePath, {
      error: new Error("Gauge is not installed."),
    }));
  }
  ensureDirectory(fileSystem, previewRoot);
  ensureDirectory(fileSystem, docsDir);
  const env = envWithGaugeHome(options.env || process.env, { vscode });
  const projectEnv = projectEnvironment(project, cli);

  const result = await waitForProcess(
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
