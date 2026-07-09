"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { WorkspaceEditor } = require("../refactor/workspaceEditor");
const {
  kotlinFunctionNames,
  stepImplementationName,
} = require("../stepCodeActions");

const ADD_STUB_REQUEST = "gauge/putStubImpl";
const COPY_TO_CLIPBOARD = "Copy To Clipboard";
const FILES_REQUEST = "gauge/getImplFiles";
const GENERATE_CONCEPT_REQUEST = "gauge/generateConcept";
const GENERATE_CONCEPT_STUB = "gauge.generate.concept";
const GENERATE_STEP_STUB = "gauge.generate.step";
const NEW_FILE = "New File";
const DEFAULT_KOTLIN_IMPLEMENTATION_FILE = "src/test/kotlin/Steps.kt";
const DEFAULT_JAVA_IMPLEMENTATION_FILE = "src/test/java/Steps.java";
const JAVA_LANGUAGE = "java";
const KOTLIN_LANGUAGE = "kotlin";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
}

function defaultWorkspaceEditorFactory(vscode, edit, options = {}) {
  return new WorkspaceEditor(edit, {
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    vscode,
  });
}

function generatedImplementationName(code) {
  const match = /\bfun\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(String(code || ""));
  return match ? match[1] : undefined;
}

function generatedJavaImplementationName(code) {
  const match = /\bpublic\s+void\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(String(code || ""));
  return match ? match[1] : undefined;
}

function replacementImplementationCode(code, currentName, nextName) {
  if (!currentName || !nextName || currentName === nextName) {
    return code;
  }
  return String(code || "").replace(
    new RegExp(`\\bfun\\s+${currentName}\\s*\\(`),
    `fun ${nextName}(`,
  );
}

function replacementJavaImplementationCode(code, currentName, nextName) {
  if (!currentName || !nextName || currentName === nextName) {
    return code;
  }
  return String(code || "").replace(
    new RegExp(`\\bpublic\\s+void\\s+${currentName}\\s*\\(`),
    `public void ${nextName}(`,
  );
}

function javaMethodNames(text) {
  const names = [];
  const pattern = /\b(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?[A-Za-z_$][A-Za-z0-9_$.<>\[\]?]*(?:\s*<[^;{}()]*>)?\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let match = pattern.exec(String(text || ""));
  while (match) {
    names.push(match[1]);
    match = pattern.exec(String(text || ""));
  }
  return names;
}

function projectLanguage(project) {
  if (!project || typeof project.language !== "function") {
    return undefined;
  }
  const language = project.language();
  return typeof language === "string" ? language.toLowerCase() : undefined;
}

function generatedCodeLanguage(code) {
  const text = String(code || "");
  if (/\bpublic\s+void\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(text)) {
    return JAVA_LANGUAGE;
  }
  if (/\bfun\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(text)) {
    return KOTLIN_LANGUAGE;
  }
  return undefined;
}

function implementationDefaults(project, code) {
  const language = projectLanguage(project) || generatedCodeLanguage(code);
  if (language === JAVA_LANGUAGE) {
    return {
      defaultFile: DEFAULT_JAVA_IMPLEMENTATION_FILE,
      label: "Java",
    };
  }
  return {
    defaultFile: DEFAULT_KOTLIN_IMPLEMENTATION_FILE,
    label: "Kotlin",
  };
}

class GenerateStubCommandProvider {
  constructor(clients, options = {}) {
    this.clients = clients;
    this.vscode = getVscode(options.vscode);
    this.pathModule = options.pathModule || nodePath;
    this.fileSystem = options.fileSystem || nodeFs;
    this.workspaceEditorFactory = options.workspaceEditorFactory
      || ((edit) => defaultWorkspaceEditorFactory(this.vscode, edit, {
        fileSystem: this.fileSystem,
        pathModule: this.pathModule,
      }));
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
      .then(async (selected) => {
        if (!selected) {
          return undefined;
        }
        if (selected.value === COPY_TO_CLIPBOARD) {
          return this.vscode.env.clipboard.writeText(code).then(
            () => this.vscode.window.showInformationMessage("Step Implementation copied to clipboard"),
            (reason) => this.handleError(reason),
          );
        }
        const implementationFilePath = await this.resolveImplementationFilePath(
          selected,
          projectClient.project.root(),
          implementationDefaults(projectClient.project, code),
        );
        if (!implementationFilePath) {
          return undefined;
        }
        if (selected.value === NEW_FILE) {
          this.ensureNewImplementationFile(implementationFilePath);
        }
        const selectedCode = this.stepCodeForImplementationFile(code, implementationFilePath);
        return this.generateInFile(
          ADD_STUB_REQUEST,
          { implementationFilePath, codes: [selectedCode] },
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

  async resolveImplementationFilePath(selected, projectRoot, defaults = implementationDefaults()) {
    if (selected.value !== NEW_FILE) {
      return selected.value;
    }
    if (!this.vscode.window || typeof this.vscode.window.showInputBox !== "function") {
      return undefined;
    }
    const input = await this.vscode.window.showInputBox({
      prompt: `Enter the new ${defaults.label} implementation file path.`,
      placeHolder: defaults.defaultFile,
      value: defaults.defaultFile,
    });
    const trimmed = typeof input === "string" ? input.trim() : "";
    if (!trimmed) {
      return undefined;
    }
    if (!projectRoot || this.pathModule.isAbsolute(trimmed)) {
      return this.pathModule.normalize(trimmed);
    }
    return this.pathModule.join(projectRoot, trimmed);
  }

  ensureNewImplementationFile(implementationFilePath) {
    const lowerPath = String(implementationFilePath || "").toLowerCase();
    if (
      !implementationFilePath
      || (!lowerPath.endsWith(".java") && !lowerPath.endsWith(".kt"))
      || !this.fileSystem
      || typeof this.fileSystem.existsSync !== "function"
      || typeof this.fileSystem.writeFileSync !== "function"
    ) {
      return;
    }
    if (this.fileSystem.existsSync(implementationFilePath)) {
      return;
    }
    const directory = this.pathModule.dirname(implementationFilePath);
    if (
      directory
      && typeof this.fileSystem.mkdirSync === "function"
      && !this.fileSystem.existsSync(directory)
    ) {
      this.fileSystem.mkdirSync(directory, { recursive: true });
    }
    this.fileSystem.writeFileSync(implementationFilePath, "", { encoding: "utf8" });
  }

  implementationFileText(implementationFilePath) {
    if (!this.fileSystem || typeof this.fileSystem.readFileSync !== "function") {
      return undefined;
    }
    try {
      return this.fileSystem.readFileSync(implementationFilePath, "utf8");
    } catch (_error) {
      return undefined;
    }
  }

  stepCodeForImplementationFile(code, implementationFilePath) {
    if (!implementationFilePath) {
      return code;
    }
    const lowerPath = String(implementationFilePath).toLowerCase();
    if (lowerPath.endsWith(".java")) {
      return this.javaStepCodeForImplementationFile(code, implementationFilePath);
    }
    if (!lowerPath.endsWith(".kt")) {
      return code;
    }
    return this.kotlinStepCodeForImplementationFile(code, implementationFilePath);
  }

  kotlinStepCodeForImplementationFile(code, implementationFilePath) {
    const currentName = generatedImplementationName(code);
    if (!currentName || !/^implementation\d*$/.test(currentName)) {
      return code;
    }
    const text = this.implementationFileText(implementationFilePath);
    if (typeof text !== "string") {
      return code;
    }
    const existingNames = kotlinFunctionNames(text);
    if (!existingNames.includes(currentName)) {
      return code;
    }
    return replacementImplementationCode(
      code,
      currentName,
      stepImplementationName(existingNames),
    );
  }

  javaStepCodeForImplementationFile(code, implementationFilePath) {
    const currentName = generatedJavaImplementationName(code);
    if (!currentName || !/^implementation\d*$/.test(currentName)) {
      return code;
    }
    const text = this.implementationFileText(implementationFilePath);
    if (typeof text !== "string") {
      return code;
    }
    const existingNames = javaMethodNames(text);
    if (!existingNames.includes(currentName)) {
      return code;
    }
    return replacementJavaImplementationCode(
      code,
      currentName,
      stepImplementationName(existingNames),
    );
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
