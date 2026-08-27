"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const {
  closedDocStringLines,
  headingMarkers,
  isDocStringFenceLine,
  isStepLine,
} = require("./gaugeHeadings");
const {
  GaugeStepDiagnosticsProvider,
  findConceptHeadings,
  findStepFunctionsForDocument,
  isStepImplementationDocument,
  positionAt,
} = require("./stepDiagnostics");
const { superStepAliasesForEntry } = require("./gaugeReference");
const { normalizeStepTemplate } = require("./stepDefinitionProvider");
const { isMarkdownGaugeSpecFile } = require("./gaugeSpecScope");

const RUN_COMMAND = "gauge.execute";
const DEBUG_COMMAND = "gauge.debug";
const IN_PARALLEL_COMMAND = "gauge.execute.inParallel";
const SHOW_REFERENCES_FOR_STEP = "gauge.showReferences";
const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_EXTENSION = ".spec";
const MARKDOWN_SPEC_EXTENSION = ".md";
const GAUGE_CODELENS_CONFIG = "gauge.codeLenses";
const EXECUTION_CONFIG = "execution";
const REFERENCE_CONFIG = "reference";
const GAUGE_REFERENCE_WORKSPACE_PATTERNS = ["**/*.spec", "**/*.cpt", "**/*.md"];
const STEP_IMPLEMENTATION_WORKSPACE_PATTERNS = ["**/*.kt", "**/*.java"];
const GAUGE_REFERENCE_FILE_PATTERN = /\.(spec|cpt|md)$/i;
const STEP_IMPLEMENTATION_FILE_PATTERN = /\.(kt|java)$/i;
const ALLOW_MULTILINE_STEP_PROPERTY = "allow_multiline_step";
const DEFAULT_ENV_PROPERTIES = ["env", "default", "default.properties"];
const CANCELLED_CODE_LENS_OPERATION = Symbol("cancelledCodeLensOperation");

function getVscode(vscode) {
  return vscode || {};
}

function isThenable(value) {
  return Boolean(value && typeof value.then === "function");
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function uriPath(uri) {
  return (uri && (uri.fsPath || uri.path)) || "";
}

function documentUri(document) {
  if (document && document.uri && typeof document.uri.toString === "function") {
    return document.uri.toString();
  }
  const file = documentPath(document);
  return file ? `file://${file}` : undefined;
}

function sameDocument(left, right) {
  if (left === right) {
    return true;
  }
  const leftPath = documentPath(left);
  const rightPath = documentPath(right);
  return Boolean(leftPath && rightPath && leftPath === rightPath);
}

function isConceptDocument(document) {
  return Boolean(document && document.languageId === GAUGE_CONCEPT_LANGUAGE)
    || documentPath(document).toLowerCase().endsWith(".cpt");
}

function isGaugeReferenceDocument(document) {
  if (!document || typeof document.getText !== "function") {
    return false;
  }
  const file = documentPath(document).toLowerCase();
  if (document.languageId === GAUGE_LANGUAGE || document.languageId === GAUGE_CONCEPT_LANGUAGE) {
    return true;
  }
  if (file.endsWith(SPEC_FILE_EXTENSION) || file.endsWith(".cpt")) {
    return true;
  }
  return document.languageId === MARKDOWN_LANGUAGE && file.endsWith(MARKDOWN_SPEC_EXTENSION);
}

function isMarkdownSpecDocument(document, file) {
  return Boolean(
    document
    && document.languageId === MARKDOWN_LANGUAGE
    && file.toLowerCase().endsWith(MARKDOWN_SPEC_EXTENSION)
  );
}

function isSpecDocument(document, file) {
  return Boolean(document && file.toLowerCase().endsWith(SPEC_FILE_EXTENSION));
}

function firstNonWhitespace(line) {
  const index = line.search(/\S/);
  return index === -1 ? 0 : index;
}

function createPosition(vscode, line, character) {
  return typeof vscode.Position === "function"
    ? new vscode.Position(line, character)
    : { line, character };
}

function createRange(vscode, line, start, end) {
  const startPosition = createPosition(vscode, line, start);
  const endPosition = createPosition(vscode, line, end);
  return typeof vscode.Range === "function"
    ? new vscode.Range(startPosition, endPosition)
    : { start: startPosition, end: endPosition };
}

function createRangeFromPositions(vscode, start, end) {
  const startPosition = createPosition(vscode, start.line, start.character);
  const endPosition = createPosition(vscode, end.line, end.character);
  return typeof vscode.Range === "function"
    ? new vscode.Range(startPosition, endPosition)
    : { start: startPosition, end: endPosition };
}

function createCodeLens(vscode, range, command) {
  return typeof vscode.CodeLens === "function"
    ? new vscode.CodeLens(range, command)
    : { range, command };
}

function isTableLine(line) {
  const text = String(line || "").trim();
  return text.startsWith("|");
}

function gaugeStepText(line) {
  const marker = String(line || "").search(/\S/);
  if (marker === -1 || line[marker] !== "*") {
    return undefined;
  }
  const text = String(line).slice(marker + 1).trim();
  return text || undefined;
}

function isGaugeSyntaxBoundary(line) {
  const text = String(line || "").trim();
  return !text
    || text.startsWith("*")
    || text.startsWith("#")
    || text.toLowerCase().startsWith("tags:")
    || text.toLowerCase().startsWith("tags :")
    || text.toLowerCase().startsWith("table:")
    || text.toLowerCase().startsWith("table :")
    || isTableLine(text)
    || isDocStringFenceLine(text)
    || /^={3,}\s*$/.test(text)
    || /^-{3,}\s*$/.test(text)
    // The teardown marker: references/gauge/parser/lex.go isTearDown ->
    // parser/helper.go isUnderline recognises a line of underscores.
    || /^_{3,}\s*$/.test(text);
}

function multilineGaugeStepText(lines, lineNumber) {
  const line = lines[lineNumber] || "";
  const stepText = gaugeStepText(line);
  if (!stepText) {
    return undefined;
  }
  const stepLines = [stepText];
  for (let nextLine = lineNumber + 1; nextLine < lines.length; nextLine += 1) {
    const nextText = lines[nextLine] || "";
    if (isGaugeSyntaxBoundary(nextText)) {
      break;
    }
    stepLines.push(nextText.trim());
  }
  return stepLines.join(" ").trim();
}

function countStepReferences(document, normalizedStep, options = {}) {
  if (!normalizedStep || !document || typeof document.getText !== "function") {
    return 0;
  }
  let count = 0;
  const lines = document.getText().split(/\r?\n/);
  const docStringLines = closedDocStringLines(lines);
  const multiline = Boolean(options.allowMultilineStep);
  for (let line = 0; line < lines.length; line += 1) {
    if (docStringLines.has(line)) {
      continue;
    }
    let stepText = multiline
      ? multilineGaugeStepText(lines, line)
      : gaugeStepText(lines[line].replace(/\r$/, ""));
    let stepEndLine = line;
    if (multiline && stepText) {
      for (let nextLine = line + 1; nextLine < lines.length; nextLine += 1) {
        if (isGaugeSyntaxBoundary(lines[nextLine])) {
          break;
        }
        stepEndLine = nextLine;
      }
    }
    if (stepText && inlineTableLineAfterStep(lines, stepEndLine) !== undefined) {
      stepText = `${stepText} <table>`;
    }
    if (stepText && normalizeStepTemplate(stepText) === normalizedStep) {
      count += 1;
    }
    line = stepEndLine;
  }
  return count;
}

function isEscapedCharacter(line, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function firstUnescapedIndex(line, characters) {
  for (let index = 0; index < line.length; index += 1) {
    if (characters.has(line[index]) && !isEscapedCharacter(line, index)) {
      return index;
    }
  }
  return -1;
}

function firstWhitespaceIndex(line) {
  for (let index = 0; index < line.length; index += 1) {
    if (/\s/.test(line[index])) {
      return index;
    }
  }
  return -1;
}

function unescapePropertyValue(value) {
  return String(value || "")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\([tnrf\\:= ])/g, (_match, character) => {
      if (character === "t") {
        return "\t";
      }
      if (character === "n") {
        return "\n";
      }
      if (character === "r") {
        return "\r";
      }
      if (character === "f") {
        return "\f";
      }
      return character;
    });
}

function propertiesValue(content, key) {
  const separators = new Set(["=", ":"]);
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }
    const explicitSeparator = firstUnescapedIndex(line, separators);
    const separator = explicitSeparator === -1 ? firstWhitespaceIndex(line) : explicitSeparator;
    if (separator === -1) {
      continue;
    }
    if (line.slice(0, separator).trim() !== key) {
      continue;
    }
    return unescapePropertyValue(line.slice(separator + 1).trim());
  }
  return undefined;
}

function boolProperty(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

function projectDefaultProperty(options = {}, key) {
  const fileSystem = options.fileSystem;
  if (!fileSystem || typeof fileSystem.readFileSync !== "function" || !options.projectRoot) {
    return undefined;
  }
  const pathModule = options.pathModule || nodePath;
  try {
    const filename = pathModule.join(options.projectRoot, ...DEFAULT_ENV_PROPERTIES);
    return propertiesValue(fileSystem.readFileSync(filename, "utf8"), key);
  } catch (_error) {
    return undefined;
  }
}

function allowMultilineStep(options = {}) {
  const envValue = boolProperty(process.env.allow_multiline_step);
  if (envValue !== undefined) {
    return envValue;
  }
  const projectValue = boolProperty(projectDefaultProperty(options, ALLOW_MULTILINE_STEP_PROPERTY));
  return projectValue === true;
}

function referenceTitle(count) {
  return `${count} reference(s)`;
}

function targetForMarker(file, marker) {
  return marker.kind === "scenario" ? `${file}:${marker.line + 1}` : file;
}

function titlesForMarker(marker) {
  return marker.kind === "scenario"
    ? ["Run Scenario", "Debug Scenario"]
    : ["Run Spec", "Debug Spec"];
}

function orderedExecutionMarkers(document) {
  const markers = headingMarkers(document);
  return [
    ...markers.filter((marker) => marker.kind === "scenario"),
    ...markers.filter((marker) => marker.kind !== "scenario"),
  ];
}

function runLinkRange(vscode, marker, title) {
  return createRange(vscode, marker.line, marker.start, marker.start + title.length);
}

function hasSpecificationDataTable(document, specificationLine) {
  if (!document || typeof document.getText !== "function") {
    return false;
  }
  const lines = String(document.getText()).split(/\r?\n/);
  const nextHeading = headingMarkers(document).find((marker) => marker.line > specificationLine);
  const endLine = nextHeading ? nextHeading.line : lines.length;
  for (let line = specificationLine + 1; line < endLine; line += 1) {
    if (isStepLine(lines[line])) {
      return false;
    }
    // Gauge emits the parallel lens whenever spec.DataTable.IsInitialized()
    // (references/gauge/api/lang/codeLens.go). An external `table: file.csv`
    // initializes it through AddExternalDataTable
    // (references/gauge/parser/convert.go) exactly like an inline table.
    if (isTableLine(lines[line]) || isExternalDataTableLine(lines[line])) {
      return true;
    }
  }
  return false;
}

function isExternalDataTableLine(line) {
  const text = String(line || "").trim().toLowerCase();
  return text.startsWith("table:") || text.startsWith("table :");
}

// Gauge's lexer emits no token for a blank line following a step
// (references/gauge/parser/lex.go sets the step token's Suffix and continues),
// so a table separated from its step by blank lines still attaches to it.
// Verified against parser.SpecParser.Parse.
function inlineTableLineAfterStep(lines, endLine) {
  for (let index = endLine + 1; index < lines.length; index += 1) {
    const text = String(lines[index] || "").trim();
    if (text === "") {
      continue;
    }
    return isTableLine(text) ? index : undefined;
  }
  return undefined;
}


function normalizedStepValues(aliases) {
  const values = [];
  const seen = new Set();
  for (const alias of aliases || []) {
    const value = normalizeStepTemplate(alias);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    values.push(value);
  }
  return values;
}

class GaugeCodeLensProvider {
  constructor(options = {}) {
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
    this.documentStore = options.documentStore;
    this.workspaceStepIndex = options.workspaceStepIndex;
    this.ownedDiagnosticsProvider = undefined;
    this.diagnosticsProvider = options.diagnosticsProvider
      || (this.workspaceStepIndex && this.workspaceStepIndex.diagnosticsProvider);
    if (!this.diagnosticsProvider) {
      this.ownedDiagnosticsProvider = new GaugeStepDiagnosticsProvider({
        documentStore: this.documentStore,
        fileSystem: this.fileSystem,
        pathModule: this.pathModule,
        projectFactory: this.projectFactory,
        vscode: this.vscode,
      });
      this.diagnosticsProvider = this.ownedDiagnosticsProvider;
    }
    this.disposed = false;
    this.activeOperations = new Set();
    this.registrationAttempted = false;
    this.registrationDisposable = undefined;
  }

  // A Markdown file is a Gauge specification only inside the project's
  // configured gauge_specs_dir. Without this a README in a Gauge project gets
  // Run and Debug code lenses that would run Gauge against it. The rule lives in
  // src/gaugeSpecScope.js so every provider gives the same answer.
  isMarkdownDocumentInScope(document) {
    const file = documentPath(document);
    if (!/\.md$/i.test(String(file || ""))) {
      return true;
    }
    return isMarkdownGaugeSpecFile(file, {
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectFactory: this.projectFactory,
    });
  }

  disposeOwnedProvider(provider) {
    if (!provider || typeof provider.dispose !== "function") {
      return;
    }
    try {
      provider.dispose();
    } catch (_error) {
      // Provider cleanup cannot reactivate a terminal CodeLens request.
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const operations = [...this.activeOperations];
    this.activeOperations.clear();
    for (const operation of operations) {
      this.cancelOperation(operation);
    }
    const registration = this.registrationDisposable;
    this.registrationDisposable = undefined;
    if (registration && typeof registration.dispose === "function") {
      try {
        registration.dispose();
      } catch (_error) {
        // Continue releasing provider-owned diagnostics after unregistering fails.
      }
    }
    const ownedDiagnosticsProvider = this.ownedDiagnosticsProvider;
    this.ownedDiagnosticsProvider = undefined;
    this.disposeOwnedProvider(ownedDiagnosticsProvider);
  }

  createOperation() {
    if (this.disposed) {
      return undefined;
    }
    let resolveCancellation;
    const operation = {
      active: true,
      cancellation: new Promise((resolve) => {
        resolveCancellation = resolve;
      }),
      hostCancellationDisposable: undefined,
      resolveCancellation,
    };
    this.activeOperations.add(operation);
    return operation;
  }

  isOperationActive(operation) {
    return !this.disposed && (!operation || operation.active);
  }

  disposeHostCancellation(operation) {
    const disposable = operation && operation.hostCancellationDisposable;
    if (!disposable) {
      return;
    }
    operation.hostCancellationDisposable = undefined;
    if (typeof disposable.dispose === "function") {
      try {
        disposable.dispose();
      } catch (_error) {
        // Listener cleanup cannot reactivate a completed CodeLens request.
      }
    }
  }

  cancelOperation(operation) {
    if (!operation || !operation.active) {
      return;
    }
    operation.active = false;
    this.activeOperations.delete(operation);
    operation.resolveCancellation(CANCELLED_CODE_LENS_OPERATION);
    this.disposeHostCancellation(operation);
  }

  finishOperation(operation) {
    if (!operation || !operation.active) {
      return;
    }
    operation.active = false;
    this.activeOperations.delete(operation);
    this.disposeHostCancellation(operation);
  }

  linkOperationCancellation(operation, token) {
    if (!token) {
      return true;
    }
    if (token.isCancellationRequested) {
      this.cancelOperation(operation);
      return false;
    }
    if (typeof token.onCancellationRequested !== "function") {
      return true;
    }
    let disposable;
    try {
      disposable = token.onCancellationRequested(() => this.cancelOperation(operation));
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return false;
      }
      throw error;
    }
    if (this.isOperationActive(operation)) {
      operation.hostCancellationDisposable = disposable;
    } else if (disposable && typeof disposable.dispose === "function") {
      try {
        disposable.dispose();
      } catch (_error) {
        // Synchronous cancellation already completed the request.
      }
    }
    if (token.isCancellationRequested && this.isOperationActive(operation)) {
      this.cancelOperation(operation);
    }
    return this.isOperationActive(operation);
  }

  observeValue(value) {
    Promise.resolve(value).catch(() => undefined);
  }

  callSyncForOperation(operation, callback) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    let value;
    try {
      value = callback();
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      throw error;
    }
    if (!this.isOperationActive(operation)) {
      this.observeValue(value);
      return CANCELLED_CODE_LENS_OPERATION;
    }
    return value;
  }

  async callForOperation(operation, callback) {
    const value = this.callSyncForOperation(operation, callback);
    if (value === CANCELLED_CODE_LENS_OPERATION) {
      return value;
    }
    if (!isThenable(value)) {
      return value;
    }
    const observed = Promise.resolve(value);
    try {
      const result = operation
        ? await Promise.race([observed, operation.cancellation])
        : await observed;
      return this.isOperationActive(operation)
        ? result
        : CANCELLED_CODE_LENS_OPERATION;
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      throw error;
    }
  }

  completeForOperation(operation, callback) {
    const value = this.callSyncForOperation(operation, callback);
    if (value === CANCELLED_CODE_LENS_OPERATION || !isThenable(value)) {
      return value;
    }
    const observed = Promise.resolve(value);
    const guarded = operation
      ? Promise.race([observed, operation.cancellation])
      : observed;
    return guarded.then(
      (result) => this.isOperationActive(operation)
        ? result
        : CANCELLED_CODE_LENS_OPERATION,
      (error) => {
        if (!this.isOperationActive(operation)) {
          return CANCELLED_CODE_LENS_OPERATION;
        }
        throw error;
      },
    );
  }

  runOperation(token, callback) {
    if (this.disposed || (token && token.isCancellationRequested)) {
      return [];
    }
    const operation = this.createOperation();
    if (!operation) {
      return [];
    }
    let result;
    try {
      result = this.linkOperationCancellation(operation, token)
        ? this.completeForOperation(operation, () => callback(operation))
        : CANCELLED_CODE_LENS_OPERATION;
    } catch (error) {
      this.finishOperation(operation);
      throw error;
    }
    if (!isThenable(result)) {
      const completed = result === CANCELLED_CODE_LENS_OPERATION ? [] : result;
      this.finishOperation(operation);
      return completed;
    }
    return Promise.resolve(result)
      .then(
        (value) => value === CANCELLED_CODE_LENS_OPERATION ? [] : value,
        (error) => {
          if (!this.isOperationActive(operation)) {
            return [];
          }
          throw error;
        },
      )
      .finally(() => this.finishOperation(operation));
  }

  isGaugeProjectFile(file) {
    if (!this.projectFactory) {
      return true;
    }
    if (!file || typeof this.projectFactory.getGaugeRootFromFilePath !== "function") {
      return true;
    }
    try {
      const root = this.projectFactory.getGaugeRootFromFilePath(file);
      if (!root) {
        return false;
      }
      if (typeof this.projectFactory.isGaugeProject === "function") {
        return this.projectFactory.isGaugeProject(root) !== false;
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  isGaugeProjectDocument(document) {
    return this.isGaugeProjectFile(documentPath(document));
  }

  belongsFileToSourceGaugeProject(file, sourceRoot) {
    if (
      !file
      || !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return true;
    }
    const root = this.diagnosticsProvider.rootForFile(file);
    if (sourceRoot === undefined) {
      return root !== undefined;
    }
    return root === sourceRoot;
  }

  referenceCodeLensesEnabled() {
    const workspace = this.vscode.workspace || {};
    if (typeof workspace.getConfiguration !== "function") {
      return true;
    }
    const config = workspace.getConfiguration(GAUGE_CODELENS_CONFIG);
    if (!config || typeof config.get !== "function") {
      return true;
    }
    if (typeof config.has === "function" && config.has(REFERENCE_CONFIG)) {
      return config.get(REFERENCE_CONFIG) !== false;
    }
    return config.get(REFERENCE_CONFIG) !== false;
  }

  executionCodeLensesEnabled() {
    const workspace = this.vscode.workspace || {};
    if (typeof workspace.getConfiguration !== "function") {
      return true;
    }
    const config = workspace.getConfiguration(GAUGE_CODELENS_CONFIG);
    if (!config || typeof config.get !== "function") {
      return true;
    }
    return config.get(EXECUTION_CONFIG) !== false;
  }

  async storeDocumentsMatching(filePattern, sourceRoot, operation) {
    const ready = await this.callForOperation(operation, () => this.documentStore.whenReady());
    if (ready === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const storedDocuments = this.callSyncForOperation(
      operation,
      () => this.documentStore.documents(),
    );
    if (storedDocuments === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const documents = [];
    for (const candidate of storedDocuments) {
      const included = this.callSyncForOperation(operation, () => {
        const file = documentPath(candidate);
        return Boolean(
          file
          && filePattern.test(file)
          && this.belongsFileToSourceGaugeProject(file, sourceRoot)
        );
      });
      if (included === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      if (!included) {
        continue;
      }
      documents.push(candidate);
    }
    return this.isOperationActive(operation) ? documents : CANCELLED_CODE_LENS_OPERATION;
  }

  async findWorkspaceStepImplementationDocuments(sourceRoot, operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    if (this.documentStore) {
      return this.storeDocumentsMatching(
        STEP_IMPLEMENTATION_FILE_PATTERN,
        sourceRoot,
        operation,
      );
    }
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    const documents = [];
    for (const pattern of STEP_IMPLEMENTATION_WORKSPACE_PATTERNS) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      let uris;
      try {
        uris = await this.callForOperation(operation, () => workspace.findFiles(pattern));
      } catch (_error) {
        continue;
      }
      if (uris === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }

      for (const uri of uris || []) {
        const belongs = this.callSyncForOperation(
          operation,
          () => this.belongsFileToSourceGaugeProject(uriPath(uri), sourceRoot),
        );
        if (belongs === CANCELLED_CODE_LENS_OPERATION) {
          return CANCELLED_CODE_LENS_OPERATION;
        }
        if (!belongs) {
          continue;
        }

        try {
          const document = await this.callForOperation(
            operation,
            () => workspace.openTextDocument(uri),
          );
          if (document === CANCELLED_CODE_LENS_OPERATION) {
            return CANCELLED_CODE_LENS_OPERATION;
          }
          documents.push(document);
        } catch (_error) {
          // Ignore stale workspace files so CodeLens still works for the active document.
        }
      }
    }
    return this.isOperationActive(operation) ? documents : CANCELLED_CODE_LENS_OPERATION;
  }

  async findWorkspaceGaugeReferenceDocuments(sourceRoot, operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    if (this.documentStore) {
      return this.storeDocumentsMatching(GAUGE_REFERENCE_FILE_PATTERN, sourceRoot, operation);
    }
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    const documents = [];
    for (const pattern of GAUGE_REFERENCE_WORKSPACE_PATTERNS) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      let uris;
      try {
        uris = await this.callForOperation(operation, () => workspace.findFiles(pattern));
      } catch (_error) {
        continue;
      }
      if (uris === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }

      for (const uri of uris || []) {
        const belongs = this.callSyncForOperation(
          operation,
          () => this.belongsFileToSourceGaugeProject(uriPath(uri), sourceRoot),
        );
        if (belongs === CANCELLED_CODE_LENS_OPERATION) {
          return CANCELLED_CODE_LENS_OPERATION;
        }
        if (!belongs) {
          continue;
        }

        try {
          const document = await this.callForOperation(
            operation,
            () => workspace.openTextDocument(uri),
          );
          if (document === CANCELLED_CODE_LENS_OPERATION) {
            return CANCELLED_CODE_LENS_OPERATION;
          }
          documents.push(document);
        } catch (_error) {
          // Ignore stale workspace files so CodeLens still works for the active document.
        }
      }
    }
    return this.isOperationActive(operation) ? documents : CANCELLED_CODE_LENS_OPERATION;
  }

  async gaugeReferenceDocuments(sourceDocument, operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const workspace = this.vscode.workspace || {};
    const sourceRoot = this.callSyncForOperation(
      operation,
      () => this.diagnosticsProvider.gaugeProjectRoot(sourceDocument),
    );
    if (sourceRoot === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || !isGaugeReferenceDocument(candidate)
        || !this.diagnosticsProvider.belongsToSourceGaugeProject(candidate, sourceRoot)
      ) {
        return;
      }
      const file = documentPath(candidate);
      if (file) {
        if (seenPaths.has(file)) {
          return;
        }
        seenPaths.add(file);
      } else if (documents.includes(candidate)) {
        return;
      }
      documents.push(candidate);
    };

    let added = this.callSyncForOperation(operation, () => addDocument(sourceDocument));
    if (added === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const openDocuments = this.callSyncForOperation(
      operation,
      () => workspace.textDocuments || [],
    );
    if (openDocuments === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    for (const candidate of openDocuments) {
      added = this.callSyncForOperation(operation, () => addDocument(candidate));
      if (added === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
    }
    const workspaceDocuments = await this.findWorkspaceGaugeReferenceDocuments(
      sourceRoot,
      operation,
    );
    if (workspaceDocuments === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    for (const candidate of workspaceDocuments) {
      added = this.callSyncForOperation(operation, () => addDocument(candidate));
      if (added === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
    }
    return this.isOperationActive(operation) ? documents : CANCELLED_CODE_LENS_OPERATION;
  }

  referenceCountInDocuments(referenceDocuments, normalizedStep, operation) {
    let count = 0;
    for (const candidate of referenceDocuments) {
      const candidateCount = this.callSyncForOperation(
        operation,
        () => countStepReferences(candidate, normalizedStep, {
          allowMultilineStep: allowMultilineStep({
            fileSystem: this.fileSystem,
            pathModule: this.pathModule,
            projectRoot: this.diagnosticsProvider.rootForFile(documentPath(candidate)),
          }),
        }),
      );
      if (candidateCount === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      count += candidateCount;
    }
    return this.isOperationActive(operation) ? count : CANCELLED_CODE_LENS_OPERATION;
  }

  async provideConceptReferenceCodeLenses(document, operation) {
    const eligible = this.callSyncForOperation(operation, () => (
      this.referenceCodeLensesEnabled()
      && this.isGaugeProjectDocument(document)
      && typeof document.getText === "function"
    ));
    if (eligible === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    if (!eligible) {
      return [];
    }

    const uri = this.callSyncForOperation(operation, () => documentUri(document));
    if (uri === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    if (!uri) {
      return [];
    }

    const lenses = [];
    const text = this.callSyncForOperation(operation, () => document.getText());
    if (text === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const lines = text.split(/\r?\n/);
    const referenceDocuments = this.workspaceStepIndex
      ? undefined
      : await this.gaugeReferenceDocuments(document, operation);
    if (referenceDocuments === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const headings = this.callSyncForOperation(operation, () => findConceptHeadings(text));
    if (headings === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    for (const heading of headings) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      if (!heading.normalized) {
        continue;
      }
      const location = this.callSyncForOperation(operation, () => {
        const line = lines[heading.start.line] || "";
        const marker = firstNonWhitespace(line);
        return {
          position: createPosition(this.vscode, heading.start.line, marker),
          range: createRange(
            this.vscode,
            heading.start.line,
            marker,
            Math.max(marker, heading.end.character),
          ),
        };
      });
      if (location === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      const count = this.workspaceStepIndex
        && typeof this.workspaceStepIndex.referenceCount === "function"
        ? await this.callForOperation(
          operation,
          () => this.workspaceStepIndex.referenceCount(document, heading.normalized),
        )
        : this.referenceCountInDocuments(
          referenceDocuments,
          heading.normalized,
          operation,
        );
      if (count === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      const lens = this.callSyncForOperation(
        operation,
        () => createCodeLens(this.vscode, location.range, {
          command: SHOW_REFERENCES_FOR_STEP,
          title: referenceTitle(count),
          arguments: [uri, location.position, heading.normalized],
        }),
      );
      if (lens === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      lenses.push(lens);
    }
    return this.isOperationActive(operation) ? lenses : CANCELLED_CODE_LENS_OPERATION;
  }

  async stepImplementationDocuments(sourceDocument, operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const workspace = this.vscode.workspace || {};
    const sourceRoot = this.callSyncForOperation(
      operation,
      () => this.diagnosticsProvider.gaugeProjectRoot(sourceDocument),
    );
    if (sourceRoot === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || sameDocument(candidate, sourceDocument)
        || !isStepImplementationDocument(candidate)
        || typeof candidate.getText !== "function"
        || !this.diagnosticsProvider.belongsToSourceGaugeProject(candidate, sourceRoot)
      ) {
        return;
      }
      const file = documentPath(candidate);
      if (file) {
        if (seenPaths.has(file)) {
          return;
        }
        seenPaths.add(file);
      } else if (documents.includes(candidate)) {
        return;
      }
      documents.push(candidate);
    };

    const openDocuments = this.callSyncForOperation(
      operation,
      () => workspace.textDocuments || [],
    );
    if (openDocuments === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    for (const candidate of openDocuments) {
      const added = this.callSyncForOperation(operation, () => addDocument(candidate));
      if (added === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
    }
    const workspaceDocuments = await this.findWorkspaceStepImplementationDocuments(
      sourceRoot,
      operation,
    );
    if (workspaceDocuments === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    for (const candidate of workspaceDocuments) {
      const added = this.callSyncForOperation(operation, () => addDocument(candidate));
      if (added === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
    }
    return this.isOperationActive(operation) ? documents : CANCELLED_CODE_LENS_OPERATION;
  }

  async provideStepReferenceCodeLenses(document, operation) {
    const eligible = this.callSyncForOperation(operation, () => (
      this.referenceCodeLensesEnabled()
      && this.isGaugeProjectDocument(document)
      && typeof document.getText === "function"
    ));
    if (eligible === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    if (!eligible) {
      return [];
    }

    const uri = this.callSyncForOperation(operation, () => documentUri(document));
    if (uri === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    if (!uri) {
      return [];
    }

    const text = this.callSyncForOperation(operation, () => document.getText());
    if (text === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const indexed = this.workspaceStepIndex
      && typeof this.workspaceStepIndex.stepEntriesForDocument === "function";
    const implementationDocuments = indexed
      ? []
      : await this.stepImplementationDocuments(document, operation);
    if (implementationDocuments === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const externalConstants = !indexed && isStepImplementationDocument(document)
      ? this.callSyncForOperation(
        operation,
        () => this.diagnosticsProvider.collectWorkspaceConstants(
          document,
          implementationDocuments,
        ),
      )
      : undefined;
    if (externalConstants === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const lenses = [];
    const referenceDocuments = indexed
      ? undefined
      : await this.gaugeReferenceDocuments(document, operation);
    if (referenceDocuments === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    const entries = indexed
      ? await this.callForOperation(
        operation,
        () => this.workspaceStepIndex.stepEntriesForDocument(document, document),
      )
      : this.callSyncForOperation(
        operation,
        () => findStepFunctionsForDocument(document, externalConstants),
      );
    if (entries === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    for (const entry of entries) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      const location = this.callSyncForOperation(operation, () => {
        const start = positionAt(text, entry.declarationStart, document);
        const end = positionAt(text, entry.declarationEnd, document);
        return {
          range: createRangeFromPositions(this.vscode, start, end),
          start,
        };
      });
      if (location === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      const aliases = indexed
        && typeof this.workspaceStepIndex.stepAliasesForEntry === "function"
        ? await this.callForOperation(
        operation,
        () => this.workspaceStepIndex.stepAliasesForEntry(document, document, entry),
      )
      : this.callSyncForOperation(operation, () => [
          ...entry.aliases,
          ...superStepAliasesForEntry(
            document,
            entry,
            [document, ...implementationDocuments],
            this.diagnosticsProvider,
          ),
        ]);
      if (aliases === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      const stepValues = this.callSyncForOperation(
        operation,
        () => normalizedStepValues(aliases),
      );
      if (stepValues === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      for (const stepValue of stepValues) {
        if (!this.isOperationActive(operation)) {
          return CANCELLED_CODE_LENS_OPERATION;
        }
        const count = indexed
          && typeof this.workspaceStepIndex.referenceCount === "function"
          ? await this.callForOperation(
            operation,
            () => this.workspaceStepIndex.referenceCount(document, stepValue),
          )
          : this.referenceCountInDocuments(referenceDocuments, stepValue, operation);
        if (count === CANCELLED_CODE_LENS_OPERATION) {
          return CANCELLED_CODE_LENS_OPERATION;
        }
        const lens = this.callSyncForOperation(
          operation,
          () => createCodeLens(this.vscode, location.range, {
            command: SHOW_REFERENCES_FOR_STEP,
            title: referenceTitle(count),
            arguments: [uri, location.start, stepValue],
          }),
        );
        if (lens === CANCELLED_CODE_LENS_OPERATION) {
          return CANCELLED_CODE_LENS_OPERATION;
        }
        lenses.push(lens);
      }
    }
    return this.isOperationActive(operation) ? lenses : CANCELLED_CODE_LENS_OPERATION;
  }

  provideCodeLensesForOperation(document, operation) {
    const file = this.callSyncForOperation(operation, () => documentPath(document));
    if (file === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    if (!file) {
      return [];
    }
    const conceptDocument = this.callSyncForOperation(
      operation,
      () => isConceptDocument(document),
    );
    if (conceptDocument === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    if (conceptDocument) {
      return this.provideConceptReferenceCodeLenses(document, operation);
    }
    const stepDocument = this.callSyncForOperation(
      operation,
      () => isStepImplementationDocument(document),
    );
    if (stepDocument === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    if (stepDocument) {
      return this.provideStepReferenceCodeLenses(document, operation);
    }
    const supportedDocument = this.callSyncForOperation(operation, () => (
      (
        document.languageId === GAUGE_LANGUAGE
        || isSpecDocument(document, file)
        || isMarkdownSpecDocument(document, file)
      )
      && this.isMarkdownDocumentInScope(document)
    ));
    if (supportedDocument === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    if (!supportedDocument) {
      return [];
    }
    const executionEnabled = this.callSyncForOperation(operation, () => (
      this.executionCodeLensesEnabled() && this.isGaugeProjectDocument(document)
    ));
    if (executionEnabled === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    if (
      !executionEnabled
    ) {
      return [];
    }

    const lenses = [];
    const markers = this.callSyncForOperation(
      operation,
      () => orderedExecutionMarkers(document),
    );
    if (markers === CANCELLED_CODE_LENS_OPERATION) {
      return CANCELLED_CODE_LENS_OPERATION;
    }
    for (const marker of markers) {
      const markerLenses = this.callSyncForOperation(operation, () => {
        const target = targetForMarker(file, marker);
        const [runTitle, debugTitle] = titlesForMarker(marker);
        const result = [
          createCodeLens(this.vscode, runLinkRange(this.vscode, marker, runTitle), {
            command: RUN_COMMAND,
            title: runTitle,
            arguments: [target],
          }),
          createCodeLens(this.vscode, runLinkRange(this.vscode, marker, debugTitle), {
            command: DEBUG_COMMAND,
            title: debugTitle,
            arguments: [target],
          }),
        ];
        if (marker.kind === "specification" && hasSpecificationDataTable(document, marker.line)) {
          const parallelTitle = "Run in parallel";
          result.push(createCodeLens(
            this.vscode,
            runLinkRange(this.vscode, marker, parallelTitle),
            {
              command: IN_PARALLEL_COMMAND,
              title: parallelTitle,
              arguments: [target],
            },
          ));
        }
        return result;
      });
      if (markerLenses === CANCELLED_CODE_LENS_OPERATION) {
        return CANCELLED_CODE_LENS_OPERATION;
      }
      lenses.push(...markerLenses);
    }
    return this.isOperationActive(operation) ? lenses : CANCELLED_CODE_LENS_OPERATION;
  }

  provideCodeLenses(document, token) {
    if (!document) {
      return [];
    }
    return this.runOperation(
      token,
      (operation) => this.provideCodeLensesForOperation(document, operation),
    );
  }

  register() {
    if (this.disposed || this.registrationAttempted) {
      return this;
    }
    this.registrationAttempted = true;
    if (!this.vscode.languages || typeof this.vscode.languages.registerCodeLensProvider !== "function") {
      return this;
    }
    let registration;
    try {
      registration = this.vscode.languages.registerCodeLensProvider(
        [
          { language: GAUGE_LANGUAGE },
          { language: GAUGE_CONCEPT_LANGUAGE },
          { scheme: "file", pattern: "**/*.spec" },
          { scheme: "file", pattern: "**/*.cpt" },
          { language: MARKDOWN_LANGUAGE, scheme: "file", pattern: "**/*.md" },
          { language: "kotlin" },
          { scheme: "file", pattern: "**/*.kt" },
          { language: "java" },
          { scheme: "file", pattern: "**/*.java" },
        ],
        this,
      );
    } catch (error) {
      if (!this.disposed) {
        this.registrationAttempted = false;
      }
      throw error;
    }
    if (this.disposed) {
      if (registration && typeof registration.dispose === "function") {
        try {
          registration.dispose();
        } catch (_error) {
          // Synchronous disposal already terminalized the provider.
        }
      }
    } else {
      this.registrationDisposable = registration;
    }
    return this;
  }
}

module.exports = {
  DEBUG_COMMAND,
  GaugeCodeLensProvider,
  IN_PARALLEL_COMMAND,
  RUN_COMMAND,
};
