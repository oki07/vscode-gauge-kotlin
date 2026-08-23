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
    this.isActive = typeof options.isActive === "function" ? options.isActive : () => true;
    this.pathModule = options.pathModule || nodePath;
  }

  applyChanges() {
    if (!this.isActive()) {
      return Promise.resolve(undefined);
    }
    if (!this.edit || typeof this.edit.entries !== "function") {
      if (this.vscode.workspace && typeof this.vscode.workspace.applyEdit === "function") {
        return this.vscode.workspace.applyEdit(this.edit);
      }
      return Promise.resolve(undefined);
    }

    return Promise.all(this.edit.entries().map(([uri, edits]) => (
      this.applyTextEdit(uri, edits)
    ))).then((results) => (
      this.isActive() ? results.every((result) => result !== false) : undefined
    ));
  }

  ensureDirectoryExists(filename) {
    if (!this.isActive()) {
      return false;
    }
    const directory = this.pathModule.dirname(filename);
    const exists = this.fileSystem.existsSync(directory);
    if (!this.isActive()) {
      return false;
    }
    if (!exists) {
      this.fileSystem.mkdirSync(directory, { recursive: true });
    }
    return this.isActive();
  }

  ensureFileExists(filename) {
    if (!this.isActive()) {
      return false;
    }
    const exists = this.fileSystem.existsSync(filename);
    if (!this.isActive()) {
      return false;
    }
    if (exists) {
      return true;
    }
    if (!this.ensureDirectoryExists(filename)) {
      return false;
    }
    this.fileSystem.writeFileSync(filename, "", { encoding: "utf8" });
    return this.isActive();
  }

  async applyTextEdit(uri, edits) {
    if (!this.isActive()) {
      return undefined;
    }
    const filename = uriFsPath(uri);
    if (!filename) {
      return false;
    }

    if (!this.ensureFileExists(filename)) {
      return undefined;
    }
    const document = await this.vscode.workspace.openTextDocument(filename);
    if (!this.isActive()) {
      return undefined;
    }
    const firstEdit = edits && edits[0];
    const lineNumber = firstEdit && firstEdit.range && firstEdit.range.start
      ? firstEdit.range.start.line
      : 0;
    await this.vscode.window.showTextDocument(document, {
      selection: createRange(this.vscode, lineNumber),
    });
    if (!this.isActive()) {
      return undefined;
    }
    const documentUri = document.uri || uri;
    const documentEdit = createWorkspaceEdit(this.vscode, documentUri, edits || []);
    if (!this.isActive()) {
      return undefined;
    }
    return this.vscode.workspace.applyEdit(documentEdit);
  }
}

module.exports = {
  WorkspaceEditor,
};
