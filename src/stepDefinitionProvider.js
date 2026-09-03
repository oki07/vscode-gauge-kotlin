"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { isMarkdownGaugeSpecFile, propertiesValueFor } = require("./gaugeSpecScope");
const { annotationStepTemplate } = require("./gaugeStepValue");
const {
  isGaugeDataTableKeywordLine,
  isGaugeTableRowLine,
  isGaugeTagKeywordLine,
  inlineTableLineAfterStep: sharedInlineTableLineAfterStep,
  isGaugeTeardownLine,
} = require("./gaugeHeadings");

const {
  GaugeStepDiagnosticsProvider,
  findConceptHeadings,
  findStepFunctionsForDocument,
  isConceptDocument,
  isStepImplementationDocument,
  positionAt,
} = require("./stepDiagnostics");

const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_PATTERN = /\.spec$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const STEP_IMPLEMENTATION_WORKSPACE_PATTERNS = ["**/*.kt", "**/*.java"];
const STEP_IMPLEMENTATION_FILE_PATTERN = /\.(kt|java)$/i;
const PROJECT_ROOT_GAUGE = "gauge";
const PROJECT_ROOT_NON_GAUGE = "nonGauge";
const PROJECT_ROOT_UNKNOWN = "unknown";
const ALLOW_MULTILINE_STEP_PROPERTY = "allow_multiline_step";
const CANCELLED_DEFINITION_OPERATION = Symbol("cancelled definition operation");

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createPosition(vscode, line, character) {
  if (typeof vscode.Position === "function") {
    return new vscode.Position(line, character);
  }
  return { line, character };
}

function createRange(vscode, start, end) {
  const startPosition = createPosition(vscode, start.line, start.character);
  const endPosition = createPosition(vscode, end.line, end.character);
  if (typeof vscode.Range === "function") {
    return new vscode.Range(startPosition, endPosition);
  }
  return { start: startPosition, end: endPosition };
}

function createLocation(vscode, uri, range) {
  if (typeof vscode.Location === "function") {
    return new vscode.Location(uri, range);
  }
  return { uri, range };
}

function isEscapedAt(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findParameterEnd(text, startIndex, closeCharacter) {
  let index = startIndex + 1;
  while (index < text.length) {
    if (text[index] === "\\" && closeCharacter === "\"") {
      index += 2;
      continue;
    }
    if (text[index] === closeCharacter && !isEscapedAt(text, index)) {
      return index;
    }
    index += 1;
  }
  return -1;
}

function nextParameter(text, startIndex) {
  let dynamicIndex = text.indexOf("<", startIndex);
  while (dynamicIndex !== -1 && isEscapedAt(text, dynamicIndex)) {
    dynamicIndex = text.indexOf("<", dynamicIndex + 1);
  }

  let staticIndex = text.indexOf("\"", startIndex);
  while (staticIndex !== -1 && isEscapedAt(text, staticIndex)) {
    staticIndex = text.indexOf("\"", staticIndex + 1);
  }

  if (dynamicIndex === -1 && staticIndex === -1) {
    return undefined;
  }
  if (staticIndex === -1 || (dynamicIndex !== -1 && dynamicIndex < staticIndex)) {
    return { closeCharacter: ">", start: dynamicIndex };
  }
  return { closeCharacter: "\"", start: staticIndex };
}

function normalizeLiteralStepText(text) {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      if (index + 1 >= text.length) {
        continue;
      }
      const nextCharacter = text[index + 1];
      result += nextCharacter === "{" || nextCharacter === "}"
        ? nextCharacter
        : `${character}${nextCharacter}`;
      index += 1;
      continue;
    }
    if (character === "{" || character === "}") {
      return undefined;
    }
    result += character;
  }
  return result;
}

function normalizeStepTemplate(text) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const parameter = nextParameter(text, index);
    if (!parameter) {
      const literal = normalizeLiteralStepText(text.slice(index));
      if (literal === undefined) {
        return undefined;
      }
      result += literal;
      break;
    }
    const end = findParameterEnd(text, parameter.start, parameter.closeCharacter);
    if (end === -1) {
      return undefined;
    }
    const literal = normalizeLiteralStepText(text.slice(index, parameter.start));
    if (literal === undefined) {
      return undefined;
    }
    result += `${literal}{}`;
    index = end + 1;
  }
  // Normalize to NFC so a spec and a Kotlin @Step that render identically but
  // were saved in different unicode forms (common on macOS, where text is often
  // stored decomposed/NFD) compare equal. Steps without combining marks are
  // unaffected, which is why only steps containing combining marks (such as a
  // Japanese dakuten) appeared broken.
  return result.trim().normalize("NFC");
}

function documentLine(document, line) {
  if (line < 0) {
    return "";
  }
  if (typeof document.lineCount === "number" && line >= document.lineCount) {
    return "";
  }
  if (typeof document.lineAt === "function") {
    try {
      return document.lineAt(line).text;
    } catch (_error) {
      return "";
    }
  }
  if (typeof document.getText !== "function") {
    return "";
  }
  return document.getText().split(/\r?\n/)[line] || "";
}

function documentLineCount(document) {
  if (typeof document.lineCount === "number") {
    return document.lineCount;
  }
  if (typeof document.getText === "function") {
    return document.getText().split(/\r?\n/).length;
  }
  return 0;
}

// references/gauge/parser/lex.go isTableRow requires a closing "|" as well as an
// opening one, so "|name" is a comment and attaches no table to the step.
function isInlineTableLine(line) {
  const text = String(line || "").trim();
  return isGaugeTableRowLine(text);
}

// Gauge's lexer emits no token for a blank line following a step
// (references/gauge/parser/lex.go sets the step token's Suffix and continues),
// so a table separated from its step by blank lines still attaches to it.
// Verified against parser.SpecParser.Parse.
function hasInlineTableAfterStep(document, endLineNumber) {
  const lines = Array.from(
    { length: documentLineCount(document) },
    (_value, line) => documentLine(document, line),
  );
  return sharedInlineTableLineAfterStep(lines, endLineNumber, isInlineTableLine) !== undefined;
}


function isDocStringFenceLine(line) {
  return line.trim() === "\"\"\"";
}

function isGaugeSyntaxBoundary(line) {
  const text = String(line || "").trim();
  return !text
    || text.startsWith("*")
    || text.startsWith("#")
    || isGaugeTagKeywordLine(text)
    || isGaugeDataTableKeywordLine(text)
    || isInlineTableLine(text)
    || isDocStringFenceLine(text)
    // A heading underline is one or more characters
    // (references/gauge/parser/helper.go isUnderline), and Gauge terminates the
    // step at it either way.
    || /^=+$/.test(text)
    || /^-+$/.test(text)
    // The teardown marker: references/gauge/parser/lex.go isTearDown ->
    // parser/helper.go isUnderline recognises a line of underscores.
    || isGaugeTeardownLine(text);
}

function isStepLine(line) {
  const text = String(line || "");
  const marker = text.search(/\S/);
  return marker !== -1 && text[marker] === "*" && text[marker + 1] !== "*";
}

function stepMarkerIndex(line) {
  const text = String(line || "");
  const marker = text.search(/\S/);
  return marker !== -1 && text[marker] === "*" && text[marker + 1] !== "*" ? marker : -1;
}

function isGaugeStepSourceDocument(document) {
  if (!document) {
    return false;
  }
  if (document.languageId === GAUGE_LANGUAGE || document.languageId === GAUGE_CONCEPT_LANGUAGE) {
    return true;
  }
  if (SPEC_FILE_PATTERN.test(documentPath(document)) || CONCEPT_FILE_PATTERN.test(documentPath(document))) {
    return true;
  }
  return document.languageId === MARKDOWN_LANGUAGE
    && MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document));
}

function docStringStepLineAt(document, lineNumber) {
  const lineCount = documentLineCount(document);
  for (let openLine = 0; openLine <= lineNumber && openLine < lineCount; openLine += 1) {
    if (!isDocStringFenceLine(documentLine(document, openLine))) {
      continue;
    }

    const stepLine = openLine - 1;
    if (!isStepLine(documentLine(document, stepLine))) {
      continue;
    }

    let closeLine;
    for (let candidateLine = openLine + 1; candidateLine < lineCount; candidateLine += 1) {
      if (isDocStringFenceLine(documentLine(document, candidateLine))) {
        closeLine = candidateLine;
        break;
      }
    }
    if (closeLine === undefined) {
      continue;
    }
    if (lineNumber >= openLine && lineNumber <= closeLine) {
      return stepLine;
    }
    openLine = closeLine;
  }
  return undefined;
}

function multilineStepLineAt(document, lineNumber) {
  for (let currentLine = lineNumber; currentLine >= 0; currentLine -= 1) {
    const line = documentLine(document, currentLine);
    if (isStepLine(line)) {
      return currentLine;
    }
    if (isGaugeSyntaxBoundary(line)) {
      return undefined;
    }
  }
  return undefined;
}

function multilineStepEndLine(document, lineNumber) {
  let endLine = lineNumber;
  for (let nextLine = lineNumber + 1; nextLine < documentLineCount(document); nextLine += 1) {
    if (isGaugeSyntaxBoundary(documentLine(document, nextLine))) {
      break;
    }
    endLine = nextLine;
  }
  return endLine;
}

function multilineStepText(document, lineNumber) {
  const line = documentLine(document, lineNumber);
  const marker = stepMarkerIndex(line);
  if (marker === -1) {
    return "";
  }
  const lines = [line.slice(marker + 1).trim()];
  const endLine = multilineStepEndLine(document, lineNumber);
  for (let nextLine = lineNumber + 1; nextLine <= endLine; nextLine += 1) {
    lines.push(documentLine(document, nextLine).trim());
  }
  return lines.join(" ").trim();
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

// Gauge merges every *.properties file in the environment directory and the
// directory itself is not fixed (references/gauge/env/env.go loadEnvDir,
// getEnvDir). The rule lives in src/gaugeSpecScope.js so every reader gives the
// same answer for the same project.
function projectDefaultProperty(options = {}, key) {
  return propertiesValueFor(options, key);
}

function allowMultilineStep(options = {}) {
  const envValue = boolProperty(process.env.allow_multiline_step);
  if (envValue !== undefined) {
    return envValue;
  }
  const projectValue = boolProperty(projectDefaultProperty(options, ALLOW_MULTILINE_STEP_PROPERTY));
  return projectValue === true;
}

function stepTextCandidatesAt(document, position, options = {}) {
  if (!isGaugeStepSourceDocument(document) || !position) {
    return [];
  }
  let lineNumber = position.line;
  let line = documentLine(document, lineNumber);
  const docStringStepLine = docStringStepLineAt(document, lineNumber);
  if (docStringStepLine !== undefined) {
    lineNumber = docStringStepLine;
    line = documentLine(document, lineNumber);
  } else if (!isStepLine(line)) {
    const multilineStepLine = options.allowMultilineStep
      ? multilineStepLineAt(document, lineNumber)
      : undefined;
    if (multilineStepLine === undefined) {
      return [];
    }
    lineNumber = multilineStepLine;
    line = documentLine(document, lineNumber);
  }
  if (!isStepLine(line)) {
    return [];
  }
  const marker = stepMarkerIndex(line);
  let stepText = marker === -1
    ? ""
    : (options.allowMultilineStep ? multilineStepText(document, lineNumber) : line.slice(marker + 1).trim());
  if (!stepText) {
    return [];
  }
  // The table follows the step's LAST line. Asking from the first line found a
  // continuation line instead, so a multi-line step with a table never got the
  // <table> suffix and Go to Definition answered nothing while every other
  // surface reported the step implemented.
  const stepEndLine = options.allowMultilineStep
    ? multilineStepEndLine(document, lineNumber)
    : lineNumber;
  if (hasInlineTableAfterStep(document, stepEndLine)) {
    stepText = `${stepText} <table>`;
  }
  const normalized = normalizeStepTemplate(stepText);
  return normalized ? [normalized] : [];
}

function stepTextAt(document, position, options = {}) {
  return stepTextCandidatesAt(document, position, options)[0];
}

function sameDocument(left, right) {
  if (left === right) {
    return true;
  }
  const leftPath = left && left.uri && left.uri.fsPath;
  const rightPath = right && right.uri && right.uri.fsPath;
  return Boolean(leftPath && rightPath && leftPath === rightPath);
}

function documentPath(document) {
  return document && document.uri && document.uri.fsPath;
}

function uriPath(uri) {
  return uri && uri.fsPath;
}

function targetRange(vscode, document, text, entry) {
  const startOffset = entry.declarationStart !== undefined
    ? entry.declarationStart
    : entry.parameterStart;
  const endOffset = entry.declarationEnd !== undefined
    ? entry.declarationEnd
    : entry.parameterEnd;
  return createRange(
    vscode,
    positionAt(text, startOffset, document),
    positionAt(text, endOffset, document),
  );
}

class GaugeStepDefinitionProvider {
  constructor(options = {}) {
    this.dependencyStepIndex = options.dependencyStepIndex;
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
    this.documentStore = options.documentStore;
    this.workspaceStepIndex = options.workspaceStepIndex;
    this.externalConstantsProvider = undefined;
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
    this.registrationDisposable = undefined;
    this.registrationAttempted = false;
  }

  // A Markdown file is a Gauge specification only inside the project's
  // configured gauge_specs_dir. The rule lives in src/gaugeSpecScope.js so every
  // provider gives the same answer for the same file.
  isMarkdownDocumentInScope(document) {
    const file = (document && document.uri && (document.uri.fsPath || document.uri.path))
      || (document && document.fileName)
      || "";
    if (!/\.md$/i.test(String(file))) {
      return true;
    }
    return isMarkdownGaugeSpecFile(file, {
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectFactory: this.projectFactory,
    });
  }

  disposeOwnedProvider(provider) {
    if (provider && typeof provider.dispose === "function") {
      try {
        provider.dispose();
      } catch (_error) {
        // Provider cleanup cannot reactivate a terminal definition request.
      }
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
        // Continue releasing provider-owned caches after host cleanup fails.
      }
    }
    const externalConstantsProvider = this.externalConstantsProvider;
    this.externalConstantsProvider = undefined;
    this.disposeOwnedProvider(externalConstantsProvider);
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
        // Listener cleanup cannot reactivate a completed definition request.
      }
    }
  }

  cancelOperation(operation) {
    if (!operation || !operation.active) {
      return;
    }
    operation.active = false;
    this.activeOperations.delete(operation);
    operation.resolveCancellation(CANCELLED_DEFINITION_OPERATION);
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
        // The operation completed while the host registered the listener.
      }
    }
    if (token.isCancellationRequested && this.isOperationActive(operation)) {
      this.cancelOperation(operation);
    }
    return this.isOperationActive(operation);
  }

  runOperation(token, callback) {
    if (this.disposed || (token && token.isCancellationRequested)) {
      return Promise.resolve([]);
    }
    const operation = this.createOperation();
    if (!operation) {
      return Promise.resolve([]);
    }
    let workflow;
    try {
      workflow = this.linkOperationCancellation(operation, token)
        ? Promise.resolve(callback(operation))
        : Promise.resolve(CANCELLED_DEFINITION_OPERATION);
    } catch (error) {
      workflow = Promise.reject(error);
    }
    return Promise.race([workflow, operation.cancellation])
      .then(
        (value) => value === CANCELLED_DEFINITION_OPERATION ? [] : value,
        (error) => {
          if (!this.isOperationActive(operation)) {
            return [];
          }
          throw error;
        },
      )
      .finally(() => this.finishOperation(operation));
  }

  callSyncForOperation(operation, callback) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    try {
      const value = callback();
      return this.isOperationActive(operation) ? value : CANCELLED_DEFINITION_OPERATION;
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      throw error;
    }
  }

  async callForOperation(operation, callback) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    let result;
    try {
      result = callback();
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      throw error;
    }
    const observed = Promise.resolve(result);
    if (!this.isOperationActive(operation)) {
      observed.catch(() => {});
      return CANCELLED_DEFINITION_OPERATION;
    }
    try {
      const value = await Promise.race([observed, operation.cancellation]);
      return this.isOperationActive(operation) ? value : CANCELLED_DEFINITION_OPERATION;
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      throw error;
    }
  }

  isGaugeProjectDocument(document) {
    return this.diagnosticsProvider.isGaugeProjectDocument(document);
  }

  projectRootInfoForFile(file) {
    if (!this.projectFactory || typeof this.projectFactory.getGaugeRootFromFilePath !== "function") {
      return { root: undefined, type: PROJECT_ROOT_UNKNOWN };
    }
    if (!file) {
      return { root: undefined, type: PROJECT_ROOT_UNKNOWN };
    }
    try {
      const root = this.projectFactory.getGaugeRootFromFilePath(file);
      if (!this.diagnosticsProvider.isGaugeProjectRoot(root)) {
        return { root: undefined, type: PROJECT_ROOT_NON_GAUGE };
      }
      return { root, type: PROJECT_ROOT_GAUGE };
    } catch (_error) {
      return { root: undefined, type: PROJECT_ROOT_UNKNOWN };
    }
  }

  gaugeProjectRoot(document) {
    const projectRootInfo = this.projectRootInfoForFile(documentPath(document));
    return projectRootInfo.type === PROJECT_ROOT_GAUGE ? projectRootInfo.root : undefined;
  }

  allowsMultilineStep(document) {
    return allowMultilineStep({
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectRoot: this.gaugeProjectRoot(document),
    });
  }

  belongsToSourceGaugeProject(candidate, sourceRoot) {
    if (sourceRoot === undefined) {
      return this.isGaugeProjectDocument(candidate);
    }
    const file = documentPath(candidate);
    if (!file) {
      return true;
    }
    const projectRootInfo = this.projectRootInfoForFile(file);
    return projectRootInfo.type === PROJECT_ROOT_GAUGE && projectRootInfo.root === sourceRoot;
  }

  isDifferentGaugeProject(candidate, sourceRoot) {
    if (sourceRoot === undefined) {
      return false;
    }
    const projectRootInfo = this.projectRootInfoForFile(documentPath(candidate));
    return projectRootInfo.type === PROJECT_ROOT_NON_GAUGE
      || (projectRootInfo.type === PROJECT_ROOT_GAUGE && projectRootInfo.root !== sourceRoot);
  }

  shouldOpenWorkspaceDocument(file, sourceRoot) {
    const projectRootInfo = this.projectRootInfoForFile(file);
    if (projectRootInfo.type === PROJECT_ROOT_NON_GAUGE) {
      return false;
    }
    if (sourceRoot !== undefined && projectRootInfo.type === PROJECT_ROOT_GAUGE) {
      return projectRootInfo.root === sourceRoot;
    }
    return true;
  }

  async storeWorkspaceDocuments(filePattern, sourceRoot, operation) {
    const ready = await this.callForOperation(operation, () => this.documentStore.whenReady());
    if (ready === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    const storedDocuments = this.callSyncForOperation(
      operation,
      () => this.documentStore.documents(),
    );
    if (storedDocuments === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    const documents = [];
    for (const candidate of storedDocuments) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      const file = this.callSyncForOperation(operation, () => documentPath(candidate));
      if (file === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      if (!file || !filePattern.test(file)) {
        continue;
      }
      const shouldOpen = this.callSyncForOperation(
        operation,
        () => this.shouldOpenWorkspaceDocument(file, sourceRoot),
      );
      if (shouldOpen === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      if (!shouldOpen) {
        continue;
      }
      documents.push(candidate);
    }
    return this.isOperationActive(operation) ? documents : CANCELLED_DEFINITION_OPERATION;
  }

  async findWorkspaceStepImplementationDocuments(sourceRoot, operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    if (this.documentStore) {
      return this.storeWorkspaceDocuments(
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
        return CANCELLED_DEFINITION_OPERATION;
      }
      let uris;
      try {
        uris = await this.callForOperation(operation, () => workspace.findFiles(pattern));
      } catch (_error) {
        continue;
      }
      if (uris === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      for (const uri of uris || []) {
        if (!this.isOperationActive(operation)) {
          return CANCELLED_DEFINITION_OPERATION;
        }
        const shouldOpen = this.callSyncForOperation(
          operation,
          () => this.shouldOpenWorkspaceDocument(uriPath(uri), sourceRoot),
        );
        if (shouldOpen === CANCELLED_DEFINITION_OPERATION) {
          return CANCELLED_DEFINITION_OPERATION;
        }
        if (!shouldOpen) {
          continue;
        }
        try {
          const document = await this.callForOperation(
            operation,
            () => workspace.openTextDocument(uri),
          );
          if (document === CANCELLED_DEFINITION_OPERATION) {
            return CANCELLED_DEFINITION_OPERATION;
          }
          documents.push(document);
        } catch (_error) {
          // Ignore unreadable files so one stale workspace URI does not block navigation.
        }
      }
    }
    return this.isOperationActive(operation) ? documents : CANCELLED_DEFINITION_OPERATION;
  }

  async findWorkspaceConceptDocuments(sourceRoot, operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    if (this.documentStore) {
      return this.storeWorkspaceDocuments(CONCEPT_FILE_PATTERN, sourceRoot, operation);
    }
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    const documents = [];
    let uris;
    try {
      uris = await this.callForOperation(operation, () => workspace.findFiles("**/*.cpt"));
    } catch (_error) {
      return documents;
    }
    if (uris === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    for (const uri of uris || []) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      const shouldOpen = this.callSyncForOperation(
        operation,
        () => this.shouldOpenWorkspaceDocument(uriPath(uri), sourceRoot),
      );
      if (shouldOpen === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      if (!shouldOpen) {
        continue;
      }
      try {
        const document = await this.callForOperation(
          operation,
          () => workspace.openTextDocument(uri),
        );
        if (document === CANCELLED_DEFINITION_OPERATION) {
          return CANCELLED_DEFINITION_OPERATION;
        }
        documents.push(document);
      } catch (_error) {
        // Ignore unreadable files so one stale workspace URI does not block navigation.
      }
    }
    return this.isOperationActive(operation) ? documents : CANCELLED_DEFINITION_OPERATION;
  }

  async stepImplementationDocumentGroups(sourceDocument, operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    const workspace = this.vscode.workspace || {};
    const sourceRoot = this.callSyncForOperation(
      operation,
      () => this.gaugeProjectRoot(sourceDocument),
    );
    if (sourceRoot === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    const projectDocuments = [];
    const externalDocuments = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (!candidate) {
        return;
      }
      if (sameDocument(candidate, sourceDocument)) {
        return;
      }
      if (!isStepImplementationDocument(candidate)) {
        return;
      }
      if (typeof candidate.getText !== "function") {
        return;
      }
      const file = documentPath(candidate);
      if (file) {
        if (seenPaths.has(file)) {
          return;
        }
        seenPaths.add(file);
      } else if (projectDocuments.includes(candidate) || externalDocuments.includes(candidate)) {
        return;
      }
      if (this.belongsToSourceGaugeProject(candidate, sourceRoot)) {
        projectDocuments.push(candidate);
      } else if (this.isDifferentGaugeProject(candidate, sourceRoot)) {
        return;
      } else {
        externalDocuments.push(candidate);
      }
    };

    const openDocuments = this.callSyncForOperation(
      operation,
      () => workspace.textDocuments || [],
    );
    if (openDocuments === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    for (const candidate of openDocuments) {
      const added = this.callSyncForOperation(operation, () => addDocument(candidate));
      if (added === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
    }
    const workspaceDocuments = await this.findWorkspaceStepImplementationDocuments(
      sourceRoot,
      operation,
    );
    if (workspaceDocuments === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    for (const candidate of workspaceDocuments) {
      const added = this.callSyncForOperation(operation, () => addDocument(candidate));
      if (added === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
    }
    return this.isOperationActive(operation)
      ? { externalDocuments, projectDocuments }
      : CANCELLED_DEFINITION_OPERATION;
  }

  async conceptDocuments(sourceDocument, operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    const workspace = this.vscode.workspace || {};
    const sourceRoot = this.callSyncForOperation(
      operation,
      () => this.gaugeProjectRoot(sourceDocument),
    );
    if (sourceRoot === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || !isConceptDocument(candidate)
        || typeof candidate.getText !== "function"
        || !this.belongsToSourceGaugeProject(candidate, sourceRoot)
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
    if (openDocuments === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    for (const candidate of openDocuments) {
      const added = this.callSyncForOperation(operation, () => addDocument(candidate));
      if (added === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
    }
    const workspaceDocuments = await this.findWorkspaceConceptDocuments(sourceRoot, operation);
    if (workspaceDocuments === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    for (const candidate of workspaceDocuments) {
      const added = this.callSyncForOperation(operation, () => addDocument(candidate));
      if (added === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
    }
    const addedSource = this.callSyncForOperation(operation, () => addDocument(sourceDocument));
    if (addedSource === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    return this.isOperationActive(operation) ? documents : CANCELLED_DEFINITION_OPERATION;
  }

  externalWorkspaceConstantsProvider(operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    // The external fallback intentionally omits the project factory so that
    // constants from workspace documents outside the source Gauge project are
    // still resolved. Construct it once and reuse it so repeated definition
    // lookups keep its per-document caches instead of re-parsing every file.
    if (!this.externalConstantsProvider) {
      this.externalConstantsProvider = new GaugeStepDiagnosticsProvider({
        documentStore: this.documentStore,
        vscode: this.vscode,
      });
    }
    return this.isOperationActive(operation)
      ? this.externalConstantsProvider
      : CANCELLED_DEFINITION_OPERATION;
  }

  collectWorkspaceConstants(document, kotlinDocuments, options = {}, operation) {
    // Pass the Kotlin documents directly as the workspace document list. Do NOT
    // spread `this.vscode` or `vscode.workspace`: object spread enumerates every
    // own getter, and VS Code / Cursor expose proposed-API getters (e.g.
    // workspace.tunnels) that throw for extensions that did not declare the
    // proposal, which would abort the entire definition lookup.
    const diagnosticsProvider = options.includeExternalWorkspace
      ? this.externalWorkspaceConstantsProvider(operation)
      : this.diagnosticsProvider;
    if (diagnosticsProvider === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    return diagnosticsProvider.collectWorkspaceConstants(document, kotlinDocuments);
  }

  definitionsForDocuments(wantedStep, documents, constantDocuments, options = {}, operation) {
    const wantedSteps = Array.isArray(wantedStep) ? wantedStep : [wantedStep];
    const wantedStepSet = new Set(wantedSteps);
    const definitions = [];
    for (const candidate of documents) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      const text = this.callSyncForOperation(operation, () => candidate.getText());
      if (text === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      let externalConstants;
      if (isStepImplementationDocument(candidate)) {
        try {
          externalConstants = this.callSyncForOperation(
            operation,
            () => this.collectWorkspaceConstants(
              candidate,
              constantDocuments,
              options,
              operation,
            ),
          );
          if (externalConstants === CANCELLED_DEFINITION_OPERATION) {
            return CANCELLED_DEFINITION_OPERATION;
          }
        } catch (_error) {
          // Never let workspace-constant collection abort navigation: plain
          // @Step("literal") matching still works without resolved constants.
          externalConstants = undefined;
        }
      }
      const stepFunctions = this.callSyncForOperation(
        operation,
        () => findStepFunctionsForDocument(candidate, externalConstants),
      );
      if (stepFunctions === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      for (const entry of stepFunctions) {
        if (!this.isOperationActive(operation)) {
          return CANCELLED_DEFINITION_OPERATION;
        }
        const normalizedAliases = entry.aliases
          .map((alias) => annotationStepTemplate(alias))
          .filter(Boolean);
        if (!normalizedAliases.some((alias) => wantedStepSet.has(alias))) {
          continue;
        }
        const location = this.callSyncForOperation(
          operation,
          () => createLocation(
            this.vscode,
            candidate.uri,
            targetRange(this.vscode, candidate, text, entry),
          ),
        );
        if (location === CANCELLED_DEFINITION_OPERATION) {
          return CANCELLED_DEFINITION_OPERATION;
        }
        definitions.push(location);
      }
    }
    return this.isOperationActive(operation) ? definitions : CANCELLED_DEFINITION_OPERATION;
  }

  conceptDefinitionsForDocuments(wantedStep, documents, operation) {
    const wantedSteps = Array.isArray(wantedStep) ? wantedStep : [wantedStep];
    const wantedStepSet = new Set(wantedSteps);
    const definitions = [];
    for (const candidate of documents) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      const text = this.callSyncForOperation(operation, () => candidate.getText());
      if (text === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      const headings = this.callSyncForOperation(
        operation,
        () => findConceptHeadings(text),
      );
      if (headings === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      for (const heading of headings) {
        if (!this.isOperationActive(operation)) {
          return CANCELLED_DEFINITION_OPERATION;
        }
        if (!heading.normalized) {
          continue;
        }
        if (!wantedStepSet.has(heading.normalized)) {
          continue;
        }
        const location = this.callSyncForOperation(
          operation,
          () => createLocation(
            this.vscode,
            candidate.uri,
            createRange(this.vscode, heading.start, heading.end),
          ),
        );
        if (location === CANCELLED_DEFINITION_OPERATION) {
          return CANCELLED_DEFINITION_OPERATION;
        }
        definitions.push(location);
      }
    }
    return this.isOperationActive(operation) ? definitions : CANCELLED_DEFINITION_OPERATION;
  }

  async provideDefinitionForOperation(document, position, operation) {
    const allowMultilineStep = this.callSyncForOperation(
      operation,
      () => this.allowsMultilineStep(document),
    );
    if (allowMultilineStep === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    const wantedSteps = this.callSyncForOperation(
      operation,
      () => stepTextCandidatesAt(document, position, { allowMultilineStep }),
    );
    if (wantedSteps === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    if (wantedSteps.length === 0) {
      return [];
    }
    const isGaugeDocument = this.callSyncForOperation(
      operation,
      () => this.isGaugeProjectDocument(document),
    );
    if (isGaugeDocument === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    if (!isGaugeDocument) {
      return [];
    }
    const sourceRoot = this.callSyncForOperation(
      operation,
      () => this.gaugeProjectRoot(document),
    );
    if (sourceRoot === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }

    if (
      this.workspaceStepIndex
      && typeof this.workspaceStepIndex.definitionEntries === "function"
    ) {
      const indexedEntries = await this.callForOperation(
        operation,
        () => this.workspaceStepIndex.definitionEntries(document, wantedSteps),
      );
      if (indexedEntries === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      const indexedDefinitions = [];
      for (const indexedEntry of indexedEntries) {
        if (!this.isOperationActive(operation)) {
          return CANCELLED_DEFINITION_OPERATION;
        }
        let location;
        if (indexedEntry.kind === "concept") {
          location = this.callSyncForOperation(
            operation,
            () => createLocation(
              this.vscode,
              indexedEntry.document.uri,
              createRange(
                this.vscode,
                indexedEntry.heading.start,
                indexedEntry.heading.end,
              ),
            ),
          );
        } else {
          location = this.callSyncForOperation(
            operation,
            () => createLocation(
              this.vscode,
              indexedEntry.document.uri,
              targetRange(
                this.vscode,
                indexedEntry.document,
                indexedEntry.document.getText(),
                indexedEntry.entry,
              ),
            ),
          );
        }
        if (location === CANCELLED_DEFINITION_OPERATION) {
          return CANCELLED_DEFINITION_OPERATION;
        }
        indexedDefinitions.push(location);
      }
      if (indexedDefinitions.length > 0) {
        return indexedDefinitions;
      }
      if (
        this.dependencyStepIndex
        && typeof this.dependencyStepIndex.findDefinitions === "function"
        && sourceRoot !== undefined
      ) {
        const dependencyDefinitions = await this.callForOperation(
          operation,
          () => this.dependencyStepIndex.findDefinitions(sourceRoot, wantedSteps),
        );
        return dependencyDefinitions === CANCELLED_DEFINITION_OPERATION
          ? CANCELLED_DEFINITION_OPERATION
          : dependencyDefinitions || [];
      }
      return [];
    }

    const documentGroups = await this.stepImplementationDocumentGroups(document, operation);
    if (documentGroups === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    const { externalDocuments, projectDocuments } = documentGroups;
    const projectDefinitions = this.definitionsForDocuments(
      wantedSteps,
      projectDocuments,
      projectDocuments,
      {},
      operation,
    );
    if (projectDefinitions === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    if (projectDefinitions.length > 0) {
      return projectDefinitions;
    }
    const concepts = await this.conceptDocuments(document, operation);
    if (concepts === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    const conceptDefinitions = this.conceptDefinitionsForDocuments(
      wantedSteps,
      concepts,
      operation,
    );
    if (conceptDefinitions === CANCELLED_DEFINITION_OPERATION) {
      return CANCELLED_DEFINITION_OPERATION;
    }
    if (conceptDefinitions.length > 0) {
      return conceptDefinitions;
    }
    if (
      this.dependencyStepIndex
      && typeof this.dependencyStepIndex.findDefinitions === "function"
      && sourceRoot !== undefined
    ) {
      const dependencyDefinitions = await this.callForOperation(
        operation,
        () => this.dependencyStepIndex.findDefinitions(sourceRoot, wantedSteps),
      );
      if (dependencyDefinitions === CANCELLED_DEFINITION_OPERATION) {
        return CANCELLED_DEFINITION_OPERATION;
      }
      if (
        Array.isArray(dependencyDefinitions)
          ? dependencyDefinitions.length > 0
          : Boolean(dependencyDefinitions)
      ) {
        return dependencyDefinitions;
      }
    }
    return this.definitionsForDocuments(
      wantedSteps,
      externalDocuments,
      [...projectDocuments, ...externalDocuments],
      { includeExternalWorkspace: true },
      operation,
    );
  }

  provideDefinition(document, position, token) {
    if (!this.isMarkdownDocumentInScope(document)) {
      return [];
    }
    return this.runOperation(
      token,
      (operation) => this.provideDefinitionForOperation(document, position, operation),
    );
  }

  register() {
    if (this.disposed || this.registrationAttempted) {
      return this;
    }
    this.registrationAttempted = true;
    if (!this.vscode.languages || typeof this.vscode.languages.registerDefinitionProvider !== "function") {
      return this;
    }
    let registration;
    try {
      registration = this.vscode.languages.registerDefinitionProvider(
        [
          { language: GAUGE_LANGUAGE },
          { language: GAUGE_CONCEPT_LANGUAGE },
          { scheme: "file", pattern: "**/*.spec" },
          { scheme: "file", pattern: "**/*.cpt" },
          { language: MARKDOWN_LANGUAGE, scheme: "file", pattern: "**/*.md" },
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
  GaugeStepDefinitionProvider,
  allowMultilineStep,
  normalizeStepTemplate,
  stepTextAt,
};
