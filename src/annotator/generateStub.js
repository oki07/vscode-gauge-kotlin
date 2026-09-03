"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { WorkspaceEditor } = require("../refactor/workspaceEditor");
const { isFileSchemeDocument } = require("../workspaceDocumentStore");
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
const DISPOSED_OPERATION = Symbol("disposed generate stub operation");
const NO_PROJECT_CLIENT = Symbol("no gauge project client");
const NO_PROJECT_CLIENT_MESSAGE = "No Gauge project is running for this file.";

const KOTLIN_FILE_PATTERN = /\.kts?$/i;
const KOTLIN_WORKSPACE_PATTERN = "**/*.kt";
const GAUGE_STEP_IMPORT = "import com.thoughtworks.gauge.Step";

function mergeImplementationFiles(runnerFiles, kotlinFiles) {
  const merged = Array.isArray(runnerFiles) ? [...runnerFiles] : [];
  const seen = new Set(merged);
  for (const file of kotlinFiles || []) {
    if (!seen.has(file)) {
      seen.add(file);
      merged.push(file);
    }
  }
  return merged;
}

function getVscode(vscode) {
  return vscode || require("vscode");
}

function forwardSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isKotlinImplementationFile(implementationFilePath) {
  return KOTLIN_FILE_PATTERN.test(String(implementationFilePath || ""));
}

function classNameForFile(pathModule, implementationFilePath) {
  const base = pathModule.basename(String(implementationFilePath || ""));
  const name = base.replace(KOTLIN_FILE_PATTERN, "");
  return name || "StepImplementation";
}

// gauge-java answers gauge/putStubImpl by parsing the target with JavaParser
// (getgauge/gauge-java .../connection/StubImplementationCodeProcessor.java).
// Kotlin source is not valid Java, so an existing .kt file yields an empty
// ParseResult and the processor throws on orElseThrow, and a new file gets Java
// class scaffolding. This mirrors the same two branches for Kotlin: fill an
// empty file with a class, otherwise insert before the closing brace of the
// last top-level declaration, which is where gauge-java puts it for Java.
// Kotlin allows top-level functions and properties after the class, so "the last
// line that is exactly } at column 0" is often a function's closing brace and
// the stub lands inside its body, where the annotation is not a class member.
// Track brace depth instead and keep the closing brace of the last top-level
// class, interface or object - the member container gauge-java inserts into.
const KOTLIN_TYPE_DECLARATION = /(^|\s)(class|interface|object)\s/;

// A brace inside a string, a char literal or a comment is not a brace. Counting
// them closed the class early and put the stub back inside a function body.
// Kotlin's own escapes and raw strings are handled; string templates are not,
// but a "${...}" nests balanced braces either way.
function stripKotlinNonCode(line, state) {
  let result = "";
  let index = 0;
  while (index < line.length) {
    const character = line[index];
    if (state.blockComment) {
      if (character === "*" && line[index + 1] === "/") {
        state.blockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (state.rawString) {
      if (line.startsWith("\"\"\"", index)) {
        state.rawString = false;
        index += 3;
        continue;
      }
      index += 1;
      continue;
    }
    if (state.string) {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === state.string) {
        state.string = undefined;
      }
      index += 1;
      continue;
    }
    if (line.startsWith("//", index)) {
      break;
    }
    if (line.startsWith("/*", index)) {
      state.blockComment = true;
      index += 2;
      continue;
    }
    if (line.startsWith("\"\"\"", index)) {
      state.rawString = true;
      index += 3;
      continue;
    }
    if (character === "\"" || character === "'") {
      state.string = character;
      index += 1;
      continue;
    }
    result += character;
    index += 1;
  }
  return result;
}

function lastTopLevelTypeClosingLine(lines) {
  let depth = 0;
  let openedType = false;
  let closingLine;
  const state = { blockComment: false, rawString: false, string: undefined };
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripKotlinNonCode(lines[index], state);
    if (depth === 0 && KOTLIN_TYPE_DECLARATION.test(line)) {
      openedType = true;
    }
    for (const character of line) {
      if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          if (openedType) {
            closingLine = index;
          }
          openedType = false;
        }
      }
    }
    // A declaration with no body at all, such as "object Empty", closes on its
    // own line without ever raising the depth.
    if (depth === 0) {
      openedType = false;
    }
  }
  return closingLine;
}

function kotlinStubInsertion(existingText, stubCode, className) {
  const text = String(existingText || "");
  if (text.trim() === "") {
    return {
      line: 0,
      character: 0,
      newText: `${GAUGE_STEP_IMPORT}\n\nclass ${className} {\n${stubCode}\n}\n`,
    };
  }
  const lines = text.split(/\r?\n/);
  const closingLine = lastTopLevelTypeClosingLine(lines);
  if (closingLine !== undefined) {
    return { line: closingLine, character: 0, newText: `\n${stubCode}\n` };
  }
  const trailingNewline = text.endsWith("\n") ? "" : "\n";
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
    newText: `${trailingNewline}\n${stubCode}\n`,
  };
}

function createStubWorkspaceEdit(vscode, implementationFilePath, insertion) {
  const start = typeof vscode.Position === "function"
    ? new vscode.Position(insertion.line, insertion.character)
    : { line: insertion.line, character: insertion.character };
  const range = typeof vscode.Range === "function"
    ? new vscode.Range(start, start)
    : { start, end: start };
  const uri = vscode.Uri && typeof vscode.Uri.file === "function"
    ? vscode.Uri.file(implementationFilePath)
    : { fsPath: implementationFilePath };
  const textEdit = vscode.TextEdit && typeof vscode.TextEdit.insert === "function"
    ? vscode.TextEdit.insert(start, insertion.newText)
    : { range, newText: insertion.newText };
  if (typeof vscode.WorkspaceEdit !== "function") {
    return { replacements: [{ uri, range, newText: insertion.newText }] };
  }
  const edit = new vscode.WorkspaceEdit();
  edit.set(uri, [textEdit]);
  return edit;
}

function createGenerateStubOperation() {
  let rejectPublic;
  let resolveCancellation;
  let resolvePublic;
  const cancellation = new Promise((resolve) => {
    resolveCancellation = resolve;
  });
  const promise = new Promise((resolve, reject) => {
    rejectPublic = reject;
    resolvePublic = resolve;
  });
  return {
    cancellation,
    cancellationSources: new Set(),
    cancelled: false,
    completed: false,
    promise,
    publicSettled: false,
    cancel() {
      if (this.cancelled || this.completed) {
        return;
      }
      this.cancelled = true;
      resolveCancellation(DISPOSED_OPERATION);
      const sources = [...this.cancellationSources];
      this.cancellationSources.clear();
      for (const source of sources) {
        if (source && typeof source.cancel === "function") {
          source.cancel();
        }
        if (source && typeof source.dispose === "function") {
          source.dispose();
        }
      }
      if (!this.publicSettled) {
        this.publicSettled = true;
        resolvePublic(undefined);
      }
    },
    reject(error) {
      if (this.publicSettled) {
        return;
      }
      this.publicSettled = true;
      rejectPublic(error);
    },
    resolve(value) {
      if (this.publicSettled) {
        return;
      }
      this.publicSettled = true;
      resolvePublic(value);
    },
  };
}

function defaultWorkspaceEditorFactory(vscode, edit, options = {}) {
  return new WorkspaceEditor(edit, {
    fileSystem: options.fileSystem,
    isActive: options.isActive,
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
      || ((edit, operation) => defaultWorkspaceEditorFactory(this.vscode, edit, {
        fileSystem: this.fileSystem,
        isActive: () => !this.operationStopped(operation),
        pathModule: this.pathModule,
      }));
    this.activeOperations = new Set();
    this.disposed = false;
    this.disposables = [];
    this.registerCommands();
  }

  registerCommands() {
    if (this.disposed) {
      return;
    }
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return;
    }
    const registrations = [
      [GENERATE_STEP_STUB, (code) => this.generateStepStub(code)],
      [GENERATE_CONCEPT_STUB, (conceptInfo) => this.generateConceptStub(conceptInfo)],
    ];
    for (const [command, handler] of registrations) {
      if (this.disposed) {
        break;
      }
      const disposable = this.vscode.commands.registerCommand(command, handler);
      if (this.disposed) {
        if (disposable && typeof disposable.dispose === "function") {
          disposable.dispose();
        }
        break;
      }
      this.disposables.push(disposable);
    }
  }

  generateStepStub(code) {
    return this.startOperation((operation) => this.generateStepStubForOperation(operation, code));
  }

  generateConceptStub(conceptInfo) {
    return this.startOperation(
      (operation) => this.generateConceptStubForOperation(operation, conceptInfo),
    );
  }

  startOperation(callback) {
    if (this.disposed) {
      return Promise.resolve(undefined);
    }
    const operation = createGenerateStubOperation();
    this.activeOperations.add(operation);
    let work;
    try {
      work = callback(operation);
    } catch (error) {
      this.finishOperation(operation, "reject", error);
      return operation.promise;
    }
    Promise.resolve(work).then(
      (value) => {
        const result = this.operationStopped(operation) || value === DISPOSED_OPERATION
          ? undefined
          : value;
        this.finishOperation(operation, "resolve", result);
      },
      (error) => {
        if (this.operationStopped(operation)) {
          this.finishOperation(operation, "resolve", undefined);
          return;
        }
        this.finishOperation(operation, "reject", error);
      },
    );
    return operation.promise;
  }

  async generateStepStubForOperation(operation, code) {
    const context = this.stepContext(operation);
    if (context === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (context === NO_PROJECT_CLIENT) {
      return this.handleErrorForOperation(operation, NO_PROJECT_CLIENT_MESSAGE);
    }
    const { projectClient } = context;
    let files;
    let selected;
    try {
      files = await this.requestForOperation(
        operation,
        (token) => projectClient.client.sendRequest(FILES_REQUEST, token),
      );
      if (files === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const projectRoot = this.callSyncForOperation(
        operation,
        () => projectClient.project.root(),
      );
      if (projectRoot === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const kotlinFiles = await this.kotlinImplementationFiles(operation, projectRoot);
      if (kotlinFiles === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const items = this.callSyncForOperation(
        operation,
        () => this.getFileLists(mergeImplementationFiles(files, kotlinFiles), projectRoot),
      );
      if (items === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      selected = await this.callForOperation(
        operation,
        () => this.vscode.window.showQuickPick(items),
      );
    } catch (reason) {
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      return this.handleErrorForOperation(operation, reason);
    }
    if (selected === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (!selected) {
      return undefined;
    }
    if (selected.value === COPY_TO_CLIPBOARD) {
      try {
        const copied = await this.callForOperation(
          operation,
          () => this.vscode.env.clipboard.writeText(code),
        );
        if (copied === DISPOSED_OPERATION) {
          return DISPOSED_OPERATION;
        }
        return this.showInformationForOperation(
          operation,
          "Step Implementation copied to clipboard",
        );
      } catch (reason) {
        if (this.operationStopped(operation)) {
          return DISPOSED_OPERATION;
        }
        return this.handleErrorForOperation(operation, reason);
      }
    }

    const projectRoot = this.callSyncForOperation(
      operation,
      () => projectClient.project.root(),
    );
    if (projectRoot === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    const defaults = this.callSyncForOperation(
      operation,
      () => implementationDefaults(projectClient.project, code),
    );
    if (defaults === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    const implementationFilePath = await this.resolveImplementationFilePath(
      operation,
      selected,
      projectRoot,
      defaults,
    );
    if (implementationFilePath === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (!implementationFilePath) {
      return undefined;
    }
    if (selected.value === NEW_FILE) {
      const created = this.ensureNewImplementationFile(operation, implementationFilePath);
      if (created === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
    }
    const selectedCode = this.callSyncForOperation(
      operation,
      () => this.stepCodeForImplementationFile(code, implementationFilePath),
    );
    if (selectedCode === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (isKotlinImplementationFile(implementationFilePath)) {
      return this.writeKotlinStub(operation, implementationFilePath, selectedCode);
    }
    return this.generateInFile(
      operation,
      ADD_STUB_REQUEST,
      { implementationFilePath, codes: [selectedCode] },
      projectClient.client,
    );
  }

  async writeKotlinStub(operation, implementationFilePath, stubCode) {
    const existingText = this.callSyncForOperation(
      operation,
      () => this.readImplementationFile(implementationFilePath),
    );
    if (existingText === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    const insertion = this.callSyncForOperation(
      operation,
      () => kotlinStubInsertion(
        existingText,
        stubCode,
        classNameForFile(this.pathModule, implementationFilePath),
      ),
    );
    if (insertion === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    try {
      const workspaceEdit = this.callSyncForOperation(
        operation,
        () => createStubWorkspaceEdit(this.vscode, implementationFilePath, insertion),
      );
      if (workspaceEdit === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const workspaceEditor = this.callSyncForOperation(
        operation,
        () => this.workspaceEditorFactory(workspaceEdit, operation),
      );
      if (workspaceEditor === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const applied = await this.callForOperation(operation, () => workspaceEditor.applyChanges());
      if (applied === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      return this.reportRefusedEdit(operation, applied);
    } catch (reason) {
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      return this.handleErrorForOperation(operation, reason);
    }
  }

  // The edit is applied to the OPEN document and this command never saves it, so
  // reading from disk computed the insertion point and the non-colliding
  // function name against a stale copy: a second stub landed at the brace the
  // first one had already moved, and reused the name it had already taken.
  openDocumentText(implementationFilePath) {
    const documents = (this.vscode && this.vscode.workspace
      && this.vscode.workspace.textDocuments) || [];
    for (const document of documents) {
      // A git: diff of the same file has the SAME fsPath, and textDocuments is
      // ordered by open time, so the HEAD side could win this lookup and hand
      // back content the edit is not applied to.
      if (!isFileSchemeDocument(document)) {
        continue;
      }
      const file = (document && document.uri && (document.uri.fsPath || document.uri.path))
        || (document && document.fileName);
      if (file === implementationFilePath && typeof document.getText === "function") {
        return String(document.getText());
      }
    }
    return undefined;
  }

  readImplementationFile(implementationFilePath) {
    const open = this.openDocumentText(implementationFilePath);
    if (open !== undefined) {
      return open;
    }
    if (!this.fileSystem || typeof this.fileSystem.readFileSync !== "function") {
      return "";
    }
    try {
      return String(this.fileSystem.readFileSync(implementationFilePath, "utf8") || "");
    } catch (_error) {
      return "";
    }
  }

  async generateConceptStubForOperation(operation, conceptInfo) {
    const context = this.stepContext(operation);
    if (context === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (context === NO_PROJECT_CLIENT) {
      return this.handleErrorForOperation(operation, NO_PROJECT_CLIENT_MESSAGE);
    }
    const { activePath, projectClient } = context;
    let files;
    let selected;
    try {
      files = await this.requestForOperation(
        operation,
        (token) => projectClient.client.sendRequest(FILES_REQUEST, { concept: true }, token),
      );
      if (files === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const projectRoot = this.callSyncForOperation(
        operation,
        () => projectClient.project.root(),
      );
      if (projectRoot === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const items = this.callSyncForOperation(
        operation,
        () => this.getFileLists(files, projectRoot, false),
      );
      if (items === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      selected = await this.callForOperation(
        operation,
        () => this.vscode.window.showQuickPick(items),
      );
    } catch (reason) {
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      return this.handleErrorForOperation(operation, reason);
    }
    if (selected === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (!selected) {
      return undefined;
    }
    const params = this.callSyncForOperation(
      operation,
      () => ({
        ...conceptInfo,
        conceptFile: selected.value,
        dir: this.pathModule.dirname(activePath),
      }),
    );
    if (params === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    return this.generateInFile(
      operation,
      GENERATE_CONCEPT_REQUEST,
      params,
      projectClient.client,
    );
  }

  stepContext(operation) {
    const activePath = this.callSyncForOperation(
      operation,
      () => this.vscode.window.activeTextEditor.document.uri.fsPath,
    );
    if (activePath === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    const projectClient = this.callSyncForOperation(
      operation,
      () => this.clients.get(activePath),
    );
    if (projectClient === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    // clients.get() answers undefined when no Gauge language client is running
    // for the active file: the daemon has not started yet, it died, or the file
    // is outside a Gauge project. Reading .client off that produced a raw
    // TypeError in the error toast. Upstream's identical unguarded access is
    // unreachable, because there the quick fix is produced by the Gauge server
    // itself and so only exists when a client does.
    if (!projectClient || !projectClient.client) {
      return NO_PROJECT_CLIENT;
    }
    return { activePath, projectClient };
  }

  async generateInFile(operation, request, params, languageClient) {
    try {
      const edit = await this.requestForOperation(
        operation,
        (token) => languageClient.sendRequest(request, params, token),
      );
      if (edit === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const workspaceEdit = await this.callForOperation(
        operation,
        () => languageClient.protocol2CodeConverter.asWorkspaceEdit(edit),
      );
      if (workspaceEdit === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const workspaceEditor = this.callSyncForOperation(
        operation,
        () => this.workspaceEditorFactory(workspaceEdit, operation),
      );
      if (workspaceEditor === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const applied = await this.callForOperation(
        operation,
        () => workspaceEditor.applyChanges(),
      );
      if (applied === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      return this.reportRefusedEdit(operation, applied);
    } catch (reason) {
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      return this.handleErrorForOperation(operation, reason);
    }
  }

  async resolveImplementationFilePath(
    operation,
    selected,
    projectRoot,
    defaults = implementationDefaults(),
  ) {
    if (selected.value !== NEW_FILE) {
      return selected.value;
    }
    if (!this.vscode.window || typeof this.vscode.window.showInputBox !== "function") {
      return undefined;
    }
    const input = await this.callForOperation(
      operation,
      () => this.vscode.window.showInputBox({
        prompt: `Enter the new ${defaults.label} implementation file path.`,
        placeHolder: defaults.defaultFile,
        value: defaults.defaultFile,
      }),
    );
    if (input === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    const trimmed = this.callSyncForOperation(
      operation,
      () => (typeof input === "string" ? input.trim() : ""),
    );
    if (trimmed === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (!trimmed) {
      return undefined;
    }
    return this.callSyncForOperation(operation, () => {
      if (!projectRoot || this.pathModule.isAbsolute(trimmed)) {
        return this.pathModule.normalize(trimmed);
      }
      return this.pathModule.join(projectRoot, trimmed);
    });
  }

  ensureNewImplementationFile(operation, implementationFilePath) {
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
    const fileExists = this.callSyncForOperation(
      operation,
      () => this.fileSystem.existsSync(implementationFilePath),
    );
    if (fileExists === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (fileExists) {
      return;
    }
    const directory = this.callSyncForOperation(
      operation,
      () => this.pathModule.dirname(implementationFilePath),
    );
    if (directory === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (
      directory
      && typeof this.fileSystem.mkdirSync === "function"
    ) {
      const directoryExists = this.callSyncForOperation(
        operation,
        () => this.fileSystem.existsSync(directory),
      );
      if (directoryExists === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      if (!directoryExists) {
        const created = this.callSyncForOperation(
          operation,
          () => this.fileSystem.mkdirSync(directory, { recursive: true }),
        );
        if (created === DISPOSED_OPERATION) {
          return DISPOSED_OPERATION;
        }
      }
    }
    return this.callSyncForOperation(
      operation,
      () => this.fileSystem.writeFileSync(implementationFilePath, "", { encoding: "utf8" }),
    );
  }

  implementationFileText(implementationFilePath) {
    const open = this.openDocumentText(implementationFilePath);
    if (open !== undefined) {
      return open;
    }
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

  createRequestSource(operation) {
    if (this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    if (typeof this.vscode.CancellationTokenSource !== "function") {
      return { release() {}, token: undefined };
    }
    let source;
    try {
      source = new this.vscode.CancellationTokenSource();
    } catch (error) {
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      throw error;
    }
    if (this.operationStopped(operation)) {
      if (source && typeof source.cancel === "function") {
        source.cancel();
      }
      if (source && typeof source.dispose === "function") {
        source.dispose();
      }
      return DISPOSED_OPERATION;
    }
    operation.cancellationSources.add(source);
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        if (!operation.cancellationSources.delete(source)) {
          return;
        }
        if (source && typeof source.dispose === "function") {
          source.dispose();
        }
      },
      token: source && source.token,
    };
  }

  async requestForOperation(operation, callback) {
    const source = this.createRequestSource(operation);
    if (source === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    try {
      return await this.callForOperation(operation, () => callback(source.token));
    } finally {
      source.release();
    }
  }

  callSyncForOperation(operation, callback) {
    if (this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    let value;
    try {
      value = callback();
    } catch (error) {
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      throw error;
    }
    return this.operationStopped(operation) ? DISPOSED_OPERATION : value;
  }

  callForOperation(operation, callback) {
    if (this.operationStopped(operation)) {
      return Promise.resolve(DISPOSED_OPERATION);
    }
    let value;
    try {
      value = callback();
    } catch (error) {
      if (this.operationStopped(operation)) {
        return Promise.resolve(DISPOSED_OPERATION);
      }
      return Promise.reject(error);
    }
    if (this.operationStopped(operation)) {
      Promise.resolve(value).catch(() => undefined);
      return Promise.resolve(DISPOSED_OPERATION);
    }
    return this.awaitOperation(operation, value);
  }

  async awaitOperation(operation, value) {
    if (this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    try {
      const result = await Promise.race([
        Promise.resolve(value),
        operation.cancellation,
      ]);
      if (result === DISPOSED_OPERATION || this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      return result;
    } catch (error) {
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      throw error;
    }
  }

  operationStopped(operation) {
    return this.disposed || !operation || operation.cancelled;
  }

  finishOperation(operation, outcome, value) {
    if (operation.completed) {
      return;
    }
    operation.completed = true;
    this.activeOperations.delete(operation);
    const sources = [...operation.cancellationSources];
    operation.cancellationSources.clear();
    for (const source of sources) {
      if (source && typeof source.dispose === "function") {
        source.dispose();
      }
    }
    if (outcome === "reject") {
      operation.reject(value);
      return;
    }
    operation.resolve(value);
  }

  // applyChanges() answers false when VS Code refuses the edit: a read-only
  // file, a file changed underneath, a failed create. Dropping that answer left
  // the user with a quick fix that reported success and wrote nothing.
  reportRefusedEdit(operation, applied) {
    if (applied !== false) {
      return applied;
    }
    return this.handleErrorForOperation(operation, "The edit was not applied.");
  }

  handleErrorForOperation(operation, reason) {
    return this.callForOperation(operation, () => this.handleError(reason));
  }

  showInformationForOperation(operation, message) {
    return this.callForOperation(operation, () => {
      if (this.disposed) {
        return undefined;
      }
      return this.vscode.window.showInformationMessage(message);
    });
  }

  handleError(reason) {
    if (this.disposed) {
      return undefined;
    }
    return this.vscode.window.showErrorMessage(`Unable to generate implementation. ${reason}`);
  }

  // gauge/getImplFiles is delegated to the runner, and gauge-java's FileHelper
  // only scans files ending in .java, so a Kotlin project gets an empty list and
  // the picker can only offer "New File". Add the project's own Kotlin sources.
  async kotlinImplementationFiles(operation, projectRoot) {
    const workspace = this.vscode.workspace;
    if (!projectRoot || !workspace || typeof workspace.findFiles !== "function") {
      return [];
    }
    let uris;
    try {
      uris = await this.callForOperation(
        operation,
        () => workspace.findFiles(KOTLIN_WORKSPACE_PATTERN),
      );
    } catch (_error) {
      return this.operationStopped(operation) ? DISPOSED_OPERATION : [];
    }
    if (uris === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    // On Windows both the root and uri.fsPath use backslashes, so compare both
    // sides normalized: appending "/" to the raw root produced a prefix like
    // "C:\\ws\\gauge/" that no normalized path could ever start with.
    const prefix = `${forwardSlashes(projectRoot)}/`;
    return (uris || [])
      .map((uri) => (uri && (uri.fsPath || uri.path)) || "")
      .filter((file) => file && forwardSlashes(file).startsWith(prefix))
      .sort();
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
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const operations = [...this.activeOperations];
    this.activeOperations.clear();
    for (const operation of operations) {
      operation.cancel();
    }
    const disposables = this.disposables;
    this.disposables = [];
    for (const disposable of disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
  }
}

module.exports = {
  GenerateStubCommandProvider,
  kotlinStubInsertion,
};
