"use strict";

const nodePath = require("node:path");

const ADD_STUB_REQUEST = "gauge/putStubImpl";
const COPY_TO_CLIPBOARD = "Copy To Clipboard";
const FILES_REQUEST = "gauge/getImplFiles";
const GENERATE_CONCEPT_REQUEST = "gauge/generateConcept";
const GENERATE_CONCEPT_STUB = "gauge.generate.concept";
const GENERATE_STEP_STUB = "gauge.generate.step";
const NEW_FILE = "New File";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
}

function defaultWorkspaceEditorFactory(vscode, edit) {
  return {
    applyChanges() {
      if (vscode.workspace && typeof vscode.workspace.applyEdit === "function") {
        return vscode.workspace.applyEdit(edit);
      }
      return Promise.resolve(undefined);
    },
  };
}

class GenerateStubCommandProvider {
  constructor(clients, options = {}) {
    this.clients = clients;
    this.vscode = getVscode(options.vscode);
    this.pathModule = options.pathModule || nodePath;
    this.workspaceEditorFactory = options.workspaceEditorFactory
      || ((edit) => defaultWorkspaceEditorFactory(this.vscode, edit));
    this.disposables = [];
    this.registerCommands();
  }

  registerCommands() {
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return;
    }
    this.disposables.push(
      this.vscode.commands.registerCommand(GENERATE_STEP_STUB, (code) => this.generateStepStub(code)),
    );
    this.disposables.push(
      this.vscode.commands.registerCommand(
        GENERATE_CONCEPT_STUB,
        (conceptInfo) => this.generateConceptStub(conceptInfo),
      ),
    );
  }

  generateStepStub(code) {
    const activePath = this.vscode.window.activeTextEditor.document.uri.fsPath;
    const projectClient = this.clients.get(activePath);
    return projectClient.client
      .sendRequest(FILES_REQUEST, createToken(this.vscode))
      .then((files) => this.vscode.window.showQuickPick(
        this.getFileLists(files, projectClient.project.root()),
      ))
      .then((selected) => {
        if (!selected) {
          return undefined;
        }
        if (selected.value === COPY_TO_CLIPBOARD) {
          return this.vscode.env.clipboard.writeText(code).then(() => (
            this.vscode.window.showInformationMessage("Step Implementation copied to clipboard")
          ));
        }
        return this.generateInFile(
          ADD_STUB_REQUEST,
          { implementationFilePath: selected.value, codes: [code] },
          projectClient.client,
        );
      }, (reason) => this.handleError(reason));
  }

  generateConceptStub(conceptInfo) {
    const activePath = this.vscode.window.activeTextEditor.document.uri.fsPath;
    const projectClient = this.clients.get(activePath);
    return projectClient.client
      .sendRequest(FILES_REQUEST, { concept: true }, createToken(this.vscode))
      .then((files) => this.vscode.window.showQuickPick(
        this.getFileLists(files, projectClient.project.root(), false),
      ))
      .then((selected) => {
        if (!selected) {
          return undefined;
        }
        const params = {
          ...conceptInfo,
          conceptFile: selected.value,
          dir: this.pathModule.dirname(activePath),
        };
        return this.generateInFile(GENERATE_CONCEPT_REQUEST, params, projectClient.client);
      }, (reason) => this.handleError(reason));
  }

  generateInFile(request, params, languageClient) {
    return languageClient
      .sendRequest(request, params, createToken(this.vscode))
      .then((edit) => languageClient.protocol2CodeConverter.asWorkspaceEdit(edit))
      .then((workspaceEdit) => this.workspaceEditorFactory(workspaceEdit).applyChanges())
      .catch((reason) => this.handleError(reason));
  }

  handleError(reason) {
    return this.vscode.window.showErrorMessage(`Unable to generate implementation. ${reason}`);
  }

  getFileLists(files, cwd, copy = true) {
    const fileItems = files.map((file) => ({
      label: this.pathModule.basename(file),
      description: this.pathModule.relative(cwd, this.pathModule.dirname(file)),
      value: file,
    }));
    const items = [
      { label: NEW_FILE, description: "Create a new file", value: NEW_FILE },
    ];
    if (copy) {
      items.push({ label: COPY_TO_CLIPBOARD, description: "", value: COPY_TO_CLIPBOARD });
    }
    return items.concat(fileItems);
  }

  dispose() {
    for (const disposable of this.disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
  }
}

module.exports = {
  GenerateStubCommandProvider,
};
