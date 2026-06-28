"use strict";

const nodeFs = require("node:fs");
const nodeOs = require("node:os");
const nodePath = require("node:path");

const SPEC_DIRS_REQUEST = "gauge/specDirs";

function createToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
}

function createGaugeSpecDirsProvider(getClientsMap, options = {}) {
  const vscode = options.vscode || {};
  return function specDirsProvider(projectRoot) {
    const clientsMap = typeof getClientsMap === "function" ? getClientsMap() : getClientsMap;
    const projectClient = clientsMap && typeof clientsMap.get === "function"
      ? clientsMap.get(projectRoot)
      : undefined;
    if (!projectClient || !projectClient.client || typeof projectClient.client.sendRequest !== "function") {
      return undefined;
    }
    return projectClient.client.sendRequest(SPEC_DIRS_REQUEST, createToken(vscode));
  };
}

function buildSpecificationDocument(options = {}) {
  const eol = options.eol || nodeOs.EOL;
  const withHelp = options.withHelp !== false;
  const user = options.user || defaultUser();
  const date = options.date || defaultDate();
  const heading = "Specification Heading";
  const lines = [
    heading,
    "=====================",
    `Created by ${user} on ${date}`,
  ];

  if (withHelp) {
    lines.push(
      "",
      "This is an executable specification file which follows markdown syntax.",
      "Every heading in this file denotes a scenario. Every bulleted point denotes a step.",
    );
  }

  lines.push("", "Scenario Heading", "----------------");

  return {
    text: lines.join(eol),
    selection: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: heading.length },
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

async function selectProjectRoot(vscode, pathModule, options = {}) {
  if (options.projectRoot) {
    return options.projectRoot;
  }

  const projectRoots = options.projects || getWorkspaceRoots(vscode);
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
  const selected = await vscode.window.showQuickPick(projectItems, {
    canPickMany: false,
    placeHolder: "Choose a project",
  });

  if (!selected) {
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

async function createSpecification(options = {}) {
  const vscode = options.vscode || require("vscode");
  try {
    const fileSystem = options.fileSystem || nodeFs;
    const promises = fileSystem.promises || fileSystem;
    const pathModule = options.pathModule || nodePath;
    const eol = options.eol || nodeOs.EOL;
    const projectRoot = await selectProjectRoot(vscode, pathModule, options);

    if (!projectRoot) {
      return showError(vscode, "No workspace folder is open.");
    }

    const specDir = await selectSpecDirectory(vscode, pathModule, projectRoot, options);
    if (!specDir) {
      return undefined;
    }

    const file = await vscode.window.showInputBox({ placeHolder: "Enter the file name" });
    if (!file) {
      return undefined;
    }

    const filename = pathModule.join(specDir, `${file}.spec`);

    if (typeof fileSystem.existsSync === "function" && fileSystem.existsSync(filename)) {
      return showError(vscode, `File${filename} already exists.`);
    }

    const document = buildSpecificationDocument({
      withHelp: getWithHelpSetting(vscode),
      eol,
      user: options.user,
      date: options.date,
    });

    await promises.mkdir(specDir, { recursive: true });
    await promises.writeFile(filename, document.text, "utf8");

    const textDocument = await vscode.workspace.openTextDocument(filename);
    return vscode.window.showTextDocument(textDocument, {
      selection: toRange(vscode, document.selection),
    });
  } catch (error) {
    return showError(vscode, error);
  }
}

async function createConcept(options = {}) {
  const vscode = options.vscode || require("vscode");
  try {
    const fileSystem = options.fileSystem || nodeFs;
    const promises = fileSystem.promises || fileSystem;
    const pathModule = options.pathModule || nodePath;
    const eol = options.eol || nodeOs.EOL;
    const projectRoot = await selectProjectRoot(vscode, pathModule, options);

    if (!projectRoot) {
      return showGenerationError(vscode, "concept", "No workspace folder is open.");
    }

    const conceptDir = await selectSpecDirectory(vscode, pathModule, projectRoot, {
      ...options,
      specDirPlaceHolder: "Choose the folder in which the concept should be created",
    });
    if (!conceptDir) {
      return undefined;
    }

    const file = await vscode.window.showInputBox({ placeHolder: "Enter the concept file name" });
    if (!file) {
      return undefined;
    }

    const filename = pathModule.join(conceptDir, `${file}.cpt`);

    if (typeof fileSystem.existsSync === "function" && fileSystem.existsSync(filename)) {
      return showGenerationError(vscode, "concept", `File${filename} already exists.`);
    }

    const document = buildConceptDocument({
      date: options.date,
      eol,
      user: options.user,
    });

    await promises.mkdir(conceptDir, { recursive: true });
    await promises.writeFile(filename, document.text, "utf8");

    const textDocument = await vscode.workspace.openTextDocument(filename);
    return vscode.window.showTextDocument(textDocument, {
      selection: toRange(vscode, document.selection),
    });
  } catch (error) {
    return showGenerationError(vscode, "concept", error);
  }
}

async function selectSpecDirectory(vscode, pathModule, projectRoot, options = {}) {
  if (options.specDir) {
    return pathModule.isAbsolute(options.specDir)
      ? options.specDir
      : pathModule.join(projectRoot, options.specDir);
  }

  const relativeSpecDirs = options.specDirsProvider
    ? await options.specDirsProvider(projectRoot)
    : ["specs"];
  const specDirs = relativeSpecDirs && relativeSpecDirs.length > 0
    ? relativeSpecDirs
    : ["specs"];

  let selected = specDirs[0];
  if (specDirs.length > 1 && vscode.window.showQuickPick) {
    selected = await vscode.window.showQuickPick(specDirs, {
      canPickMany: false,
      placeHolder: options.specDirPlaceHolder
        || "Choose the folder in which the specification should be created",
    });
  }

  if (!selected) {
    return undefined;
  }
  return pathModule.isAbsolute(selected) ? selected : pathModule.join(projectRoot, selected);
}

module.exports = {
  buildConceptDocument,
  buildSpecificationDocument,
  createConcept,
  createGaugeSpecDirsProvider,
  createSpecification,
};
