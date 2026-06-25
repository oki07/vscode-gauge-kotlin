"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createPosition(vscode, line, character) {
  if (typeof vscode.Position === "function") {
    return new vscode.Position(line, character);
  }
  return { line, character };
}

function createRange(vscode, line) {
  const start = createPosition(vscode, line, 0);
  const end = createPosition(vscode, line, 0);
  if (typeof vscode.Range === "function") {
    return new vscode.Range(start, end);
  }
  return { start, end };
}

function createWorkspaceEdit(vscode, uri, edits) {
  if (typeof vscode.WorkspaceEdit === "function") {
    const edit = new vscode.WorkspaceEdit();
    edit.set(uri, edits);
    return edit;
  }
  return {
    entries() {
      return [[uri, edits]];
    },
  };
}

function uriFsPath(uri) {
  return uri && (uri.fsPath || uri.path);
}

class WorkspaceEditor {
  constructor(edit, options = {}) {
    this.edit = edit;
    this.vscode = getVscode(options.vscode);
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
  }

  applyChanges() {
    if (!this.edit || typeof this.edit.entries !== "function") {
      if (this.vscode.workspace && typeof this.vscode.workspace.applyEdit === "function") {
        return this.vscode.workspace.applyEdit(this.edit);
      }
      return Promise.resolve(undefined);
    }

    return Promise.all(this.edit.entries().map(([uri, edits]) => (
      this.applyTextEdit(uri, edits)
    ))).then((results) => results.every((result) => result !== false));
  }

  ensureDirectoryExists(filename) {
    const directory = this.pathModule.dirname(filename);
    if (!this.fileSystem.existsSync(directory)) {
      this.fileSystem.mkdirSync(directory, { recursive: true });
    }
  }

  ensureFileExists(filename) {
    if (this.fileSystem.existsSync(filename)) {
      return;
    }
    this.ensureDirectoryExists(filename);
    this.fileSystem.writeFileSync(filename, "", { encoding: "utf8" });
  }

  async applyTextEdit(uri, edits) {
    const filename = uriFsPath(uri);
    if (!filename) {
      return false;
    }

    this.ensureFileExists(filename);
    const document = await this.vscode.workspace.openTextDocument(filename);
    const firstEdit = edits && edits[0];
    const lineNumber = firstEdit && firstEdit.range && firstEdit.range.start
      ? firstEdit.range.start.line
      : 0;
    await this.vscode.window.showTextDocument(document, {
      selection: createRange(this.vscode, lineNumber),
    });
    const documentUri = document.uri || uri;
    const documentEdit = createWorkspaceEdit(this.vscode, documentUri, edits || []);
    return this.vscode.workspace.applyEdit(documentEdit);
  }
}

module.exports = {
  WorkspaceEditor,
};
