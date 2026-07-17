"use strict";

const nodePath = require("node:path");
const { envWithGaugeHome } = require("./config/gaugeConfig");
const { GAUGE_CUSTOM_CLASSPATH } = require("./project/classpath");

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

function projectLanguage(project) {
  if (!project) {
    return "";
  }
  try {
    return String(typeof project.language === "function" ? project.language() : project.language || "")
      .toLowerCase();
  } catch (_error) {
    return "";
  }
}

function requiresProjectClasspath(project) {
  const language = projectLanguage(project);
  return language === "java" || language === "kotlin";
}

function hasProjectClasspath(environment) {
  return Boolean(
    environment
    && typeof environment[GAUGE_CUSTOM_CLASSPATH] === "string"
    && environment[GAUGE_CUSTOM_CLASSPATH].trim(),
  );
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

// Matches the Gauge daemon's sentinel range width for files that are not
// open in the editor, where the real line length is unknown.
const CLOSED_FILE_RANGE_END = 10000;

function fallbackDiagnosticRange(vscode, lineNumber) {
  const line = Math.max(0, lineNumber - 1);
  return createRange(
    vscode,
    { line, character: 0 },
    { line, character: CLOSED_FILE_RANGE_END },
  );
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
    this.projectEnvironmentService = options.projectEnvironmentService;
    this.vscode = getVscode(options.vscode);
    this.pendingRefresh = undefined;
    this.projectEnvironments = new Map();
    this.refreshDelayMs = options.refreshDelayMs === undefined ? 300 : options.refreshDelayMs;
    this.pendingRoots = new Set();
    this.refreshTimer = undefined;
    this.pendingRefreshPromise = undefined;
    this.activeRootRefreshes = new Map();
    this.lastClosedErrorFiles = new Map();
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

  projectEnvironment(project) {
    const root = projectRoot(project);
    if (
      root
      && this.projectEnvironmentService
      && typeof this.projectEnvironmentService.cachedEnvironment === "function"
    ) {
      return this.projectEnvironmentService.cachedEnvironment(root) || {};
    }
    if (root && this.projectEnvironments.has(root)) {
      return this.projectEnvironments.get(root);
    }
    let value = {};
    try {
      value = projectEnvironment(project, this.cli);
    } catch (_error) {
      value = {};
    }
    if (root && (!requiresProjectClasspath(project) || hasProjectClasspath(value))) {
      this.projectEnvironments.set(root, value);
    }
    return value;
  }

  async projectEnvironmentAsync(project) {
    if (
      this.projectEnvironmentService
      && typeof this.projectEnvironmentService.environmentFor === "function"
    ) {
      return this.projectEnvironmentService.environmentFor(project, this.cli);
    }
    return this.projectEnvironment(project);
  }

  validateOptions(project) {
    return {
      cwd: projectRoot(project),
      env: {
        ...envWithGaugeHome(this.env, { vscode: this.vscode }),
        ...this.projectEnvironment(project),
      },
    };
  }

  async validateOptionsAsync(project) {
    return {
      cwd: projectRoot(project),
      env: {
        ...envWithGaugeHome(this.env, { vscode: this.vscode }),
        ...await this.projectEnvironmentAsync(project),
      },
    };
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

    const options = this.validateOptions(project);
    if (requiresProjectClasspath(project) && !hasProjectClasspath(options.env)) {
      return [];
    }
    let result;
    try {
      result = command.spawnSync([VALIDATE_ARG], options);
    } catch (_error) {
      return [];
    }
    const output = [
      bufferToString(result && result.stdout),
      bufferToString(result && result.stderr),
    ].filter(Boolean).join("\n");
    return parseGaugeValidateErrors(output);
  }

  async runValidateAsync(project) {
    if (!this.cli || typeof this.cli.gaugeCommand !== "function") {
      return [];
    }
    const command = this.cli.gaugeCommand();
    if (!command || !projectRoot(project)) {
      return [];
    }
    const options = await this.validateOptionsAsync(project);
    if (requiresProjectClasspath(project) && !hasProjectClasspath(options.env)) {
      return [];
    }
    if (typeof command.spawn !== "function") {
      return this.runValidate(project);
    }

    return new Promise((resolve) => {
      let child;
      try {
        child = command.spawn([VALIDATE_ARG], options);
      } catch (_error) {
        resolve([]);
        return;
      }
      if (!child || typeof child.once !== "function") {
        resolve([]);
        return;
      }

      const output = [];
      const collect = (stream) => {
        if (stream && typeof stream.on === "function") {
          stream.on("data", (chunk) => output.push(bufferToString(chunk)));
        }
      };
      collect(child.stdout);
      collect(child.stderr);

      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        resolve(parseGaugeValidateErrors(output.join("\n")));
      };
      child.once("error", finish);
      child.once("close", finish);
    });
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
    const { errors, root } = this.validateErrorsForDocument(document, cache);
    return this.diagnosticsForDocument(document, errors, root);
  }

  diagnosticsForDocument(document, errors, root) {
    const currentFile = documentPath(document);
    return errors
      .filter((error) => sameFile(this.path, root, error.fileName, currentFile))
      .map((error) => createDiagnostic(
        this.vscode,
        diagnosticRange(this.vscode, document, error.lineNumber),
        validationMessage(error),
        error,
      ));
  }

  async validateErrorsForDocumentAsync(document, cache) {
    const project = this.projectForDocument(document);
    const root = projectRoot(project);
    if (!project || !root) {
      return { errors: [], root: "" };
    }
    if (!cache.has(root)) {
      cache.set(root, this.runValidateAsync(project));
    }
    return { errors: await cache.get(root), root };
  }

  async provideDiagnosticsAsync(document, cache) {
    if (!this.shouldDiagnose(document)) {
      return [];
    }
    const { errors, root } = await this.validateErrorsForDocumentAsync(document, cache);
    return this.diagnosticsForDocument(document, errors, root);
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

  async updateDocumentAsync(collection, document, cache) {
    if (!document || !document.uri) {
      return;
    }
    if (!this.shouldDiagnose(document)) {
      if (typeof collection.delete === "function") {
        collection.delete(document.uri);
      }
      return;
    }
    collection.set(document.uri, await this.provideDiagnosticsAsync(document, cache));
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

  async performRefreshDocuments(collection) {
    const cache = new Map();
    const documents = await this.workspaceGaugeDocuments();
    await Promise.all(documents.map((document) => (
      this.updateDocumentAsync(collection, document, cache)
    )));
  }

  refreshDocuments(collection) {
    if (this.pendingRefresh) {
      return this.pendingRefresh;
    }
    const refresh = this.performRefreshDocuments(collection).finally(() => {
      if (this.pendingRefresh === refresh) {
        this.pendingRefresh = undefined;
      }
    });
    this.pendingRefresh = refresh;
    return refresh;
  }

  rootForDocument(document) {
    const project = this.projectForDocument(document);
    const root = projectRoot(project);
    return root || undefined;
  }

  projectForRoot(root) {
    if (!root || !this.projectFactory) {
      return undefined;
    }
    try {
      if (typeof this.projectFactory.get === "function") {
        return this.projectFactory.get(root);
      }
    } catch (_error) {
      return undefined;
    }
    return {
      envs() {
        return {};
      },
      root() {
        return root;
      },
    };
  }

  scheduleRootRefresh(collection, root) {
    if (!root) {
      return this.pendingRefreshPromise || Promise.resolve();
    }
    this.pendingRoots.add(root);
    if (this.refreshTimer !== undefined) {
      return this.pendingRefreshPromise;
    }
    this.pendingRefreshPromise = new Promise((resolve) => {
      const run = () => {
        this.refreshTimer = undefined;
        const roots = [...this.pendingRoots];
        this.pendingRoots.clear();
        Promise.all(roots.map((pendingRoot) => this.refreshRoot(collection, pendingRoot)))
          .then(() => resolve(), () => resolve());
      };
      this.refreshTimer = setTimeout(run, this.refreshDelayMs);
      if (this.refreshTimer && typeof this.refreshTimer.unref === "function") {
        this.refreshTimer.unref();
      }
    });
    return this.pendingRefreshPromise;
  }

  waitForPendingRefresh() {
    return this.pendingRefreshPromise || Promise.resolve();
  }

  refreshRoot(collection, root) {
    if (this.activeRootRefreshes.has(root)) {
      return this.activeRootRefreshes.get(root);
    }
    const refresh = this.performRootRefresh(collection, root).finally(() => {
      if (this.activeRootRefreshes.get(root) === refresh) {
        this.activeRootRefreshes.delete(root);
      }
    });
    this.activeRootRefreshes.set(root, refresh);
    return refresh;
  }

  async performRootRefresh(collection, root) {
    const project = this.projectForRoot(root);
    if (!project) {
      return;
    }
    const errors = await this.runValidateAsync(project);
    this.applyRootDiagnostics(collection, root, errors);
  }

  applyRootDiagnostics(collection, root, errors) {
    const workspace = this.vscode.workspace || {};
    const openFiles = new Set();
    for (const document of workspace.textDocuments || []) {
      if (!this.shouldDiagnose(document) || this.rootForDocument(document) !== root) {
        continue;
      }
      openFiles.add(normalizeFile(this.path, root, documentPath(document)));
      if (typeof collection.set === "function") {
        collection.set(document.uri, this.diagnosticsForDocument(document, errors, root));
      }
    }

    const uriFactory = this.vscode.Uri;
    if (!uriFactory || typeof uriFactory.file !== "function") {
      return;
    }
    const closedFiles = new Map();
    for (const error of errors) {
      const file = normalizeFile(this.path, root, error.fileName);
      if (!file || openFiles.has(file)) {
        continue;
      }
      if (!closedFiles.has(file)) {
        closedFiles.set(file, []);
      }
      closedFiles.get(file).push(createDiagnostic(
        this.vscode,
        fallbackDiagnosticRange(this.vscode, error.lineNumber),
        validationMessage(error),
        error,
      ));
    }
    if (typeof collection.set === "function") {
      for (const [file, diagnostics] of closedFiles) {
        collection.set(uriFactory.file(file), diagnostics);
      }
    }
    const previousClosedFiles = this.lastClosedErrorFiles.get(root) || new Set();
    if (typeof collection.delete === "function") {
      for (const file of previousClosedFiles) {
        if (!closedFiles.has(file) && !openFiles.has(file)) {
          collection.delete(uriFactory.file(file));
        }
      }
    }
    this.lastClosedErrorFiles.set(root, new Set(closedFiles.keys()));
  }

  register() {
    if (!this.vscode.languages || typeof this.vscode.languages.createDiagnosticCollection !== "function") {
      return { dispose() {} };
    }

    const collection = this.vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
    const disposables = [collection];

    const provider = this;
    return {
      dispose() {
        if (provider.refreshTimer !== undefined) {
          clearTimeout(provider.refreshTimer);
          provider.refreshTimer = undefined;
          provider.pendingRoots.clear();
        }
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
