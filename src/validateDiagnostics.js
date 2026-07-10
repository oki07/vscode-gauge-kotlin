"use strict";

const nodePath = require("node:path");
const { envWithGaugeHome } = require("./config/gaugeConfig");

const COLLECTION_NAME = "gauge-validate";
const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const SPEC_FILE_PATTERN = /\.(?:spec|md|cpt)$/i;
const WORKSPACE_GAUGE_FILE_GLOB = "**/*.{spec,md,cpt}";
const VALIDATE_ARG = "validate";
const VALIDATE_DIAGNOSTIC_CODE = "gauge.validate";
const VALIDATE_DIAGNOSTIC_SOURCE = "gauge";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function uriPath(uri) {
  return (uri && (uri.fsPath || uri.path)) || "";
}

function isGaugeSpecDocument(document) {
  if (!document) {
    return false;
  }
  if (document.languageId === GAUGE_LANGUAGE) {
    return true;
  }
  if (document.languageId === GAUGE_CONCEPT_LANGUAGE) {
    return true;
  }
  return SPEC_FILE_PATTERN.test(documentPath(document));
}

function bufferToString(value) {
  if (value == null) {
    return "";
  }
  return Buffer.isBuffer(value) ? value.toString() : String(value);
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

function diagnosticSeverity(vscode, error) {
  const severities = vscode.DiagnosticSeverity || {};
  const type = String((error && error.type) || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (type === "parsewarning" && severities.Warning !== undefined) {
    return severities.Warning;
  }
  return severities.Error;
}

function createDiagnostic(vscode, range, message, error) {
  const severity = diagnosticSeverity(vscode, error);
  const diagnostic = typeof vscode.Diagnostic === "function"
    ? new vscode.Diagnostic(range, message, severity)
    : { range, message, severity };
  diagnostic.code = VALIDATE_DIAGNOSTIC_CODE;
  diagnostic.source = VALIDATE_DIAGNOSTIC_SOURCE;
  return diagnostic;
}

function parseGaugeValidateError(line) {
  const match = /^(\S+)\s+(.+):(\d+):?\s+(.*)$/.exec(String(line || "").trim());
  if (!match) {
    return undefined;
  }
  const lineNumber = Number.parseInt(match[3], 10);
  if (!Number.isFinite(lineNumber)) {
    return undefined;
  }
  return {
    type: match[1],
    fileName: match[2],
    lineNumber,
    message: match[4],
  };
}

function parseGaugeValidateErrors(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map(parseGaugeValidateError)
    .filter(Boolean);
}

function validationMessage(error) {
  return `${error.type} line number: ${error.lineNumber}, ${error.message}`;
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

function normalizeFile(pathModule, root, filename) {
  if (!filename) {
    return "";
  }
  if (pathModule.isAbsolute(filename)) {
    return pathModule.normalize(filename);
  }
  return pathModule.normalize(pathModule.resolve(root || "", filename));
}

function sameFile(pathModule, root, left, right) {
  const normalizedLeft = normalizeFile(pathModule, root, left);
  const normalizedRight = normalizeFile(pathModule, root, right);
  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

function documentLineText(document, line) {
  if (typeof document.lineAt === "function") {
    try {
      return document.lineAt(line).text;
    } catch (_error) {
      return "";
    }
  }
  if (typeof document.getText === "function") {
    return String(document.getText()).split(/\r?\n/)[line] || "";
  }
  return "";
}

function diagnosticRange(vscode, document, lineNumber) {
  const line = Math.max(0, lineNumber - 1);
  const text = documentLineText(document, line);
  const startCharacter = text.search(/\S/);
  if (startCharacter === -1) {
    return createRange(
      vscode,
      { line, character: 0 },
      { line, character: text.length },
    );
  }
  let endCharacter = text.length;
  while (endCharacter > startCharacter && /\s/.test(text[endCharacter - 1])) {
    endCharacter -= 1;
  }
  return createRange(
    vscode,
    { line, character: startCharacter },
    { line, character: endCharacter },
  );
}

class GaugeValidateDiagnosticsProvider {
  constructor(options = {}) {
    this.cli = options.cli;
    this.env = options.env || process.env;
    this.path = options.pathModule || nodePath;
    this.projectFactory = options.projectFactory;
    this.vscode = getVscode(options.vscode);
  }

  shouldDiagnose(document) {
    return Boolean(
      document
      && isGaugeSpecDocument(document)
      && typeof document.getText === "function"
      && documentPath(document),
    );
  }

  isGaugeProjectRoot(root) {
    if (!root) {
      return false;
    }
    if (
      this.projectFactory
      && typeof this.projectFactory.isGaugeProject === "function"
    ) {
      return this.projectFactory.isGaugeProject(root) !== false;
    }
    return true;
  }

  rootForFile(file) {
    if (
      !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
      || !file
    ) {
      return undefined;
    }
    try {
      const root = this.projectFactory.getGaugeRootFromFilePath(file);
      return this.isGaugeProjectRoot(root) ? root : undefined;
    } catch (_error) {
      return undefined;
    }
  }

  shouldOpenWorkspaceFile(file) {
    if (
      !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return true;
    }
    return this.rootForFile(file) !== undefined;
  }

  projectForDocument(document) {
    if (!this.projectFactory) {
      return undefined;
    }
    const file = documentPath(document);
    try {
      if (typeof this.projectFactory.getProjectByFilepath === "function") {
        const project = this.projectFactory.getProjectByFilepath(file);
        return this.isGaugeProjectRoot(projectRoot(project)) ? project : undefined;
      }
      if (typeof this.projectFactory.getGaugeRootFromFilePath !== "function") {
        return undefined;
      }
      const root = this.projectFactory.getGaugeRootFromFilePath(file);
      if (!this.isGaugeProjectRoot(root)) {
        return undefined;
      }
      if (typeof this.projectFactory.get === "function") {
        return this.projectFactory.get(root);
      }
      return {
        root() {
          return root;
        },
        envs() {
          return {};
        },
      };
    } catch (_error) {
      return undefined;
    }
  }

  runValidate(project) {
    if (!this.cli || typeof this.cli.gaugeCommand !== "function") {
      return [];
    }
    const command = this.cli.gaugeCommand();
    if (!command || typeof command.spawnSync !== "function") {
      return [];
    }
    const root = projectRoot(project);
    if (!root) {
      return [];
    }

    let result;
    const baseEnv = envWithGaugeHome(this.env, { vscode: this.vscode });
    try {
      result = command.spawnSync([VALIDATE_ARG], {
        cwd: root,
        env: {
          ...baseEnv,
          ...projectEnvironment(project, this.cli),
        },
      });
    } catch (_error) {
      return [];
    }
    const output = [
      bufferToString(result && result.stdout),
      bufferToString(result && result.stderr),
    ].filter(Boolean).join("\n");
    return parseGaugeValidateErrors(output);
  }

  validateErrorsForDocument(document, cache) {
    const project = this.projectForDocument(document);
    const root = projectRoot(project);
    if (!project || !root) {
      return { errors: [], root: "" };
    }
    if (cache && cache.has(root)) {
      return { errors: cache.get(root), root };
    }
    const errors = this.runValidate(project);
    if (cache) {
      cache.set(root, errors);
    }
    return { errors, root };
  }

  provideDiagnostics(document, cache) {
    if (!this.shouldDiagnose(document)) {
      return [];
    }
    const currentFile = documentPath(document);
    const { errors, root } = this.validateErrorsForDocument(document, cache);
    return errors
      .filter((error) => sameFile(this.path, root, error.fileName, currentFile))
      .map((error) => createDiagnostic(
        this.vscode,
        diagnosticRange(this.vscode, document, error.lineNumber),
        validationMessage(error),
        error,
      ));
  }

  updateDocument(collection, document, cache) {
    if (!document || !document.uri) {
      return;
    }
    if (!this.shouldDiagnose(document)) {
      if (typeof collection.delete === "function") {
        collection.delete(document.uri);
      }
      return;
    }
    collection.set(document.uri, this.provideDiagnostics(document, cache));
  }

  async workspaceGaugeDocuments() {
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seen = new Set();
    const addDocument = (document) => {
      const filename = documentPath(document);
      if (!filename || seen.has(filename)) {
        return;
      }
      seen.add(filename);
      documents.push(document);
    };

    for (const document of workspace.textDocuments || []) {
      addDocument(document);
    }
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return documents;
    }

    let uris = [];
    try {
      uris = await workspace.findFiles(WORKSPACE_GAUGE_FILE_GLOB);
    } catch (_error) {
      return documents;
    }
    for (const uri of uris || []) {
      const filename = uriPath(uri);
      if (!filename || seen.has(filename)) {
        continue;
      }
      if (!this.shouldOpenWorkspaceFile(filename)) {
        continue;
      }
      try {
        addDocument(await workspace.openTextDocument(uri));
      } catch (_error) {
        // Ignore files that disappear or cannot be read during refresh.
      }
    }
    return documents;
  }

  async refreshDocuments(collection) {
    const cache = new Map();
    const documents = await this.workspaceGaugeDocuments();
    for (const document of documents) {
      this.updateDocument(collection, document, cache);
    }
  }

  register() {
    if (!this.vscode.languages || typeof this.vscode.languages.createDiagnosticCollection !== "function") {
      return { dispose() {} };
    }

    const collection = this.vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
    const workspace = this.vscode.workspace || {};
    const disposables = [collection];
    const registerListener = (name, listener) => {
      if (typeof workspace[name] === "function") {
        const disposable = workspace[name](listener);
        if (disposable) {
          disposables.push(disposable);
        }
      }
    };

    this.refreshDocuments(collection);
    registerListener("onDidOpenTextDocument", () => this.refreshDocuments(collection));
    registerListener("onDidSaveTextDocument", () => this.refreshDocuments(collection));
    registerListener("onDidCloseTextDocument", (document) => {
      if (document && document.uri && typeof collection.delete === "function") {
        collection.delete(document.uri);
      }
      this.refreshDocuments(collection);
    });

    return {
      dispose() {
        for (const disposable of disposables) {
          if (disposable && typeof disposable.dispose === "function") {
            disposable.dispose();
          }
        }
      },
    };
  }
}

module.exports = {
  COLLECTION_NAME,
  GaugeValidateDiagnosticsProvider,
  parseGaugeValidateErrors,
};
