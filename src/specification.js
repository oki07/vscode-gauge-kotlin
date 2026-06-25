"use strict";

const nodeFs = require("node:fs");
const nodeOs = require("node:os");
const nodePath = require("node:path");

function buildSpecificationDocument(options = {}) {
  const eol = options.eol || nodeOs.EOL;
  const withHelp = options.withHelp !== false;
  let text = `# SPECIFICATION HEADING${eol}`;

  if (withHelp) {
    text += [
      "",
      "This is an executable specification file. This file follows markdown syntax.",
      "Every heading in this file denotes a scenario. Every bulleted point denotes a step.",
      "",
      "> To turn off these comments, set the configuration`gauge.create.specification.withHelp` to false.",
    ].join(eol);
    text += eol;
  }

  text += ["", "## SCENARIO HEADING", "", "* step", ""].join(eol);

  const line = text.split(eol).length - 2;
  return {
    text,
    selection: {
      start: { line, character: 2 },
      end: { line, character: 6 },
    },
  };
}

function getWorkspaceRoot(vscode) {
  const folders = vscode.workspace && vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }

  const uri = folders[0].uri || {};
  return uri.fsPath || uri.path;
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
  if (vscode.window && typeof vscode.window.showErrorMessage === "function") {
    return vscode.window.showErrorMessage(`Unable to generate specification. ${message}`);
  }
  return undefined;
}

async function createSpecification(options = {}) {
  const vscode = options.vscode || require("vscode");
  const fileSystem = options.fileSystem || nodeFs;
  const promises = fileSystem.promises || fileSystem;
  const pathModule = options.pathModule || nodePath;
  const eol = options.eol || nodeOs.EOL;
  const projectRoot = options.projectRoot || getWorkspaceRoot(vscode);

  if (!projectRoot) {
    return showError(vscode, "No workspace folder is open.");
  }

  const file = await vscode.window.showInputBox({ placeHolder: "Enter the file name" });
  if (!file) {
    return undefined;
  }

  const specDir = options.specDir || pathModule.join(projectRoot, "specs");
  const filename = pathModule.join(specDir, `${file}.spec`);

  if (typeof fileSystem.existsSync === "function" && fileSystem.existsSync(filename)) {
    return showError(vscode, `File${filename} already exists.`);
  }

  const document = buildSpecificationDocument({
    withHelp: getWithHelpSetting(vscode),
    eol,
  });

  await promises.mkdir(specDir, { recursive: true });
  await promises.writeFile(filename, document.text, "utf8");

  const textDocument = await vscode.workspace.openTextDocument(filename);
  return vscode.window.showTextDocument(textDocument, {
    selection: toRange(vscode, document.selection),
  });
}

module.exports = {
  buildSpecificationDocument,
  createSpecification,
};
