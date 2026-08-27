"use strict";

const {
  isLegacyHeadingText,
  isConceptHashHeading,
  isDocStringFenceLine,
  isGaugeHashHeading,
} = require("./gaugeHeadings");
const { isMarkdownGaugeSpecFile } = require("./gaugeSpecScope");

const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_PATTERN = /\.spec$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const SYMBOL_KIND_NAMESPACE = 3;
const CONCEPT_WORKSPACE_PATTERN = "**/*.cpt";
const CANCELLED_WORKSPACE_SYMBOL_OPERATION = Symbol("cancelled workspace symbol operation");

function getVscode(vscode) {
  return vscode || require("vscode");
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function isSpecDocument(document) {
  return SPEC_FILE_PATTERN.test(documentPath(document));
}

function isWorkspaceSymbolPath(file) {
  return CONCEPT_FILE_PATTERN.test(file);
}

function isWorkspaceSymbolProjectFile(file, projectFactory) {
  if (!isWorkspaceSymbolPath(file)) {
    return false;
  }
  if (
    !projectFactory
    || typeof projectFactory.getGaugeRootFromFilePath !== "function"
  ) {
    return true;
  }
  try {
    const root = projectFactory.getGaugeRootFromFilePath(file);
    if (!root) {
      return false;
    }
    if (typeof projectFactory.isGaugeProject === "function") {
      return projectFactory.isGaugeProject(root) !== false;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function isConceptDocument(document) {
  return Boolean(document && document.languageId === GAUGE_CONCEPT_LANGUAGE)
    || CONCEPT_FILE_PATTERN.test(documentPath(document));
}

function isMarkdownDocument(document) {
  return document
    && document.languageId === MARKDOWN_LANGUAGE
    && MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document));
}

function isGaugeProjectDocument(document, projectFactory, fallback) {
  if (
    !document
    || document.languageId === GAUGE_LANGUAGE
    || document.languageId === GAUGE_CONCEPT_LANGUAGE
  ) {
    return Boolean(document);
  }
  if (
    !projectFactory
    || typeof projectFactory.getGaugeRootFromFilePath !== "function"
  ) {
    return fallback;
  }
  try {
    const root = projectFactory.getGaugeRootFromFilePath(documentPath(document));
    if (!root) {
      return false;
    }
    if (typeof projectFactory.isGaugeProject === "function") {
      return projectFactory.isGaugeProject(root) !== false;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function supportedDocument(document, projectFactory) {
  if (isMarkdownDocument(document)) {
    return isGaugeProjectDocument(document, projectFactory, false);
  }
  if (isSpecDocument(document) || isConceptDocument(document)) {
    return isGaugeProjectDocument(document, projectFactory, true);
  }
  return document && document.languageId === GAUGE_LANGUAGE;
}

function documentLines(document) {
  if (!document) {
    return [];
  }
  if (typeof document.lineCount === "number" && typeof document.lineAt === "function") {
    const lines = [];
    for (let line = 0; line < document.lineCount; line += 1) {
      lines.push(document.lineAt(line).text);
    }
    return lines;
  }
  if (typeof document.getText === "function") {
    return document.getText().split(/\r?\n/);
  }
  return [];
}

function createPosition(vscode, line, character) {
  if (typeof vscode.Position === "function") {
    return new vscode.Position(line, character);
  }
  return { line, character };
}

function createRange(vscode, line, start, end) {
  const startPosition = createPosition(vscode, line, start);
  const endPosition = createPosition(vscode, line, end);
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

function symbolKindNamespace(vscode) {
  return (vscode.SymbolKind && vscode.SymbolKind.Namespace) || SYMBOL_KIND_NAMESPACE;
}

function createSymbol(vscode, document, lineNumber, start, end, name) {
  const range = createRange(vscode, lineNumber, start, end);
  return {
    name,
    kind: symbolKindNamespace(vscode),
    location: createLocation(vscode, document.uri, range),
  };
}

function headingStart(line) {
  const start = line.search(/\S/);
  return start === -1 ? 0 : start;
}

function hasLegacyHeadingText(line) {
  return isLegacyHeadingText(line);
}

function isConceptLegacyUnderlineHeadingText(line) {
  return hasLegacyHeadingText(line) && !/[#*|]/.test(line);
}

function isSpecUnderline(line) {
  return /^=+$/.test(String(line || "").trim());
}

function isScenarioUnderline(line) {
  return /^-+$/.test(String(line || "").trim());
}

function legacyHeadingAt(lines, line, conceptDocument) {
  const text = lines[line];
  const nextText = lines[line + 1];
  if (
    hasLegacyHeadingText(text)
    && isSpecUnderline(nextText)
    && (!conceptDocument || isConceptLegacyUnderlineHeadingText(text))
  ) {
    return {
      name: `# ${text.trim()}`,
      text,
    };
  }
  if (!conceptDocument && hasLegacyHeadingText(text) && isScenarioUnderline(nextText)) {
    return {
      name: `## ${text.trim()}`,
      text,
    };
  }
  return undefined;
}

function hashHeadingAt(line, conceptDocument) {
  if (conceptDocument) {
    return isConceptHashHeading(line) ? line : undefined;
  }
  return isGaugeHashHeading(line) ? line : undefined;
}

function isDocStringOwningStep(line) {
  const text = String(line || "").trimStart();
  return text.startsWith("*") && !text.startsWith("**");
}

function closedDocStringEndAfterStep(lines, stepLine) {
  if (!isDocStringOwningStep(lines[stepLine])) {
    return undefined;
  }
  const openLine = stepLine + 1;
  if (!isDocStringFenceLine(lines[openLine])) {
    return undefined;
  }
  for (let line = openLine + 1; line < lines.length; line += 1) {
    if (isDocStringFenceLine(lines[line])) {
      return line;
    }
  }
  return undefined;
}

function workspaceSymbolQuery(query) {
  return String(query || "");
}

function workspaceSymbolHeadingValue(name) {
  const text = String(name || "");
  if (!text.startsWith("#")) {
    return text;
  }
  return text.slice(1).replace(/^[ \t\f]*/, "");
}

function symbolNameCompare(left, right) {
  return left.name.localeCompare(right.name);
}

function uriKey(uri) {
  if (!uri) {
    return "";
  }
  if (uri.fsPath || uri.path) {
    return uri.fsPath || uri.path;
  }
  if (typeof uri.toString === "function") {
    return uri.toString();
  }
  return String(uri);
}

class GaugeDocumentSymbolProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
    this.documentStore = options.documentStore;
    this.workspaceSymbolRecords = new Map();
    this.workspaceSymbolEntries = [];
    this.workspaceSymbolDirtyFiles = new Set();
    this.workspaceSymbolFullDirty = true;
    this.workspaceSymbolReady = false;
    this.workspaceSymbolPending = undefined;
    this.documentStoreSubscription = undefined;
    this.disposed = false;
    this.activeWorkspaceSymbolOperations = new Set();
    if (
      this.documentStore
      && typeof this.documentStore.onDidChangeDocuments === "function"
    ) {
      this.documentStoreSubscription = this.documentStore.onDidChangeDocuments((change) => {
        if (this.disposed) {
          return;
        }
        const file = change && change.file;
        if (file && isWorkspaceSymbolPath(file)) {
          this.workspaceSymbolDirtyFiles.add(file);
        } else if (!file) {
          this.workspaceSymbolFullDirty = true;
        }
      });
    }
  }

  // A Markdown file is a Gauge specification only inside the project's
  // configured gauge_specs_dir. Without this a README or CHANGELOG in a Gauge
  // project is decorated as a specification. The rule lives in
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

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const operations = [...this.activeWorkspaceSymbolOperations];
    this.activeWorkspaceSymbolOperations.clear();
    for (const operation of operations) {
      this.cancelWorkspaceSymbolOperation(operation);
    }
    const documentStoreSubscription = this.documentStoreSubscription;
    this.documentStoreSubscription = undefined;
    if (
      documentStoreSubscription
      && typeof documentStoreSubscription.dispose === "function"
    ) {
      try {
        documentStoreSubscription.dispose();
      } catch (_error) {
        // Continue clearing provider-owned cache state after listener cleanup fails.
      }
    }
    this.workspaceSymbolRecords.clear();
    this.workspaceSymbolEntries = [];
    this.workspaceSymbolDirtyFiles.clear();
    this.workspaceSymbolFullDirty = false;
    this.workspaceSymbolReady = false;
  }

  createWorkspaceSymbolOperation(token) {
    if (this.disposed) {
      return undefined;
    }
    let resolveCancellation;
    const operation = {
      active: true,
      cancellation: new Promise((resolve) => {
        resolveCancellation = resolve;
      }),
      cancellationDisposable: undefined,
      resolveCancellation,
    };
    this.activeWorkspaceSymbolOperations.add(operation);
    if (!token || typeof token.onCancellationRequested !== "function") {
      return operation;
    }
    let disposable;
    try {
      disposable = token.onCancellationRequested(
        () => this.cancelWorkspaceSymbolOperation(operation),
      );
    } catch (error) {
      if (!operation.active) {
        return operation;
      }
      this.finishWorkspaceSymbolOperation(operation);
      throw error;
    }
    if (operation.active) {
      operation.cancellationDisposable = disposable;
    } else if (disposable && typeof disposable.dispose === "function") {
      try {
        disposable.dispose();
      } catch (_error) {
        // Synchronous cancellation already completed the request.
      }
    }
    if (token.isCancellationRequested && operation.active) {
      this.cancelWorkspaceSymbolOperation(operation);
    }
    return operation;
  }

  workspaceSymbolOperationActive(operation) {
    return !this.disposed && (!operation || operation.active);
  }

  disposeWorkspaceSymbolCancellation(operation) {
    const disposable = operation && operation.cancellationDisposable;
    if (!disposable) {
      return;
    }
    operation.cancellationDisposable = undefined;
    if (typeof disposable.dispose === "function") {
      try {
        disposable.dispose();
      } catch (_error) {
        // Listener cleanup cannot reactivate a completed workspace symbol request.
      }
    }
  }

  cancelWorkspaceSymbolOperation(operation) {
    if (!operation || !operation.active) {
      return;
    }
    operation.active = false;
    this.activeWorkspaceSymbolOperations.delete(operation);
    operation.resolveCancellation(CANCELLED_WORKSPACE_SYMBOL_OPERATION);
    this.disposeWorkspaceSymbolCancellation(operation);
  }

  finishWorkspaceSymbolOperation(operation) {
    if (!operation || !operation.active) {
      return;
    }
    operation.active = false;
    this.activeWorkspaceSymbolOperations.delete(operation);
    this.disposeWorkspaceSymbolCancellation(operation);
  }

  runWorkspaceSymbolOperation(token, callback) {
    const operation = this.createWorkspaceSymbolOperation(token);
    if (!operation || !operation.active) {
      return [];
    }
    let value;
    try {
      value = callback(operation);
    } catch (error) {
      this.finishWorkspaceSymbolOperation(operation);
      throw error;
    }
    if (!operation.active) {
      Promise.resolve(value).catch(() => undefined);
      return [];
    }
    const observed = Promise.resolve(value);
    return Promise.race([observed, operation.cancellation])
      .then(
        (result) => (
          result === CANCELLED_WORKSPACE_SYMBOL_OPERATION
          || !this.workspaceSymbolOperationActive(operation)
            ? []
            : result
        ),
        (error) => {
          if (!this.workspaceSymbolOperationActive(operation)) {
            return [];
          }
          throw error;
        },
      )
      .finally(() => this.finishWorkspaceSymbolOperation(operation));
  }

  provideDocumentSymbols(document) {
    if (
      !supportedDocument(document, this.projectFactory)
      || !this.isMarkdownDocumentInScope(document)
    ) {
      return [];
    }
    const lines = documentLines(document);
    const conceptDocument = isConceptDocument(document);
    const symbols = [];

    for (let line = 0; line < lines.length; line += 1) {
      // A `"""` block on the line after a step is that step's multi-line
      // argument and its payload is data, not Gauge syntax. A payload that
      // happens to contain "## Login" must not become a scenario symbol. This
      // held for concepts only.
      const closeLine = closedDocStringEndAfterStep(lines, line);
      if (closeLine !== undefined) {
        line = closeLine;
        continue;
      }
      const text = lines[line];
      const hashHeading = hashHeadingAt(text, conceptDocument);
      if (hashHeading) {
        symbols.push(createSymbol(
          this.vscode,
          document,
          line,
          headingStart(text),
          text.length,
          hashHeading.trimStart(),
        ));
        continue;
      }

      const legacyHeading = legacyHeadingAt(lines, line, conceptDocument);
      if (legacyHeading) {
        symbols.push(createSymbol(
          this.vscode,
          document,
          line,
          headingStart(legacyHeading.text),
          legacyHeading.text.length,
          legacyHeading.name,
        ));
        line += 1;
      }
    }

    return symbols;
  }

  async workspaceDocuments(operation) {
    if (!this.workspaceSymbolOperationActive(operation)) {
      return [];
    }
    if (this.documentStore) {
      try {
        await this.documentStore.whenReady();
      } catch (error) {
        if (!this.workspaceSymbolOperationActive(operation)) {
          return [];
        }
        throw error;
      }
      if (!this.workspaceSymbolOperationActive(operation)) {
        return [];
      }
      let documents;
      try {
        documents = this.documentStore.documents();
      } catch (error) {
        if (!this.workspaceSymbolOperationActive(operation)) {
          return [];
        }
        throw error;
      }
      if (!this.workspaceSymbolOperationActive(operation)) {
        return [];
      }
      const scopedDocuments = [];
      for (const document of documents) {
        if (!this.workspaceSymbolOperationActive(operation)) {
          return [];
        }
        const included = isWorkspaceSymbolProjectFile(
          documentPath(document),
          this.projectFactory,
        );
        if (!this.workspaceSymbolOperationActive(operation)) {
          return [];
        }
        if (included) {
          scopedDocuments.push(document);
        }
      }
      return scopedDocuments;
    }
    const workspace = this.vscode && this.vscode.workspace;
    if (
      !workspace
      || typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    const urisByKey = new Map();
    for (const pattern of [CONCEPT_WORKSPACE_PATTERN]) {
      let uris;
      try {
        uris = await workspace.findFiles(pattern);
      } catch (error) {
        if (!this.workspaceSymbolOperationActive(operation)) {
          return [];
        }
        throw error;
      }
      if (!this.workspaceSymbolOperationActive(operation)) {
        return [];
      }
      for (const uri of uris || []) {
        if (!this.workspaceSymbolOperationActive(operation)) {
          return [];
        }
        const included = isWorkspaceSymbolProjectFile(uriKey(uri), this.projectFactory);
        if (!this.workspaceSymbolOperationActive(operation)) {
          return [];
        }
        if (!included) {
          continue;
        }
        urisByKey.set(uriKey(uri), uri);
      }
    }

    const documents = [];
    for (const uri of urisByKey.values()) {
      if (!this.workspaceSymbolOperationActive(operation)) {
        return [];
      }
      try {
        const document = await workspace.openTextDocument(uri);
        if (!this.workspaceSymbolOperationActive(operation)) {
          return [];
        }
        const included = document && isWorkspaceSymbolProjectFile(
          documentPath(document),
          this.projectFactory,
        );
        if (!this.workspaceSymbolOperationActive(operation)) {
          return [];
        }
        if (included) {
          documents.push(document);
        }
      } catch (_error) {
        if (!this.workspaceSymbolOperationActive(operation)) {
          return [];
        }
        // Ignore unreadable files so one stale workspace entry does not hide
        // symbols from the rest of the Gauge project.
      }
    }
    return documents;
  }

  async refreshWorkspaceSymbolCache() {
    const refreshAll = this.workspaceSymbolFullDirty;
    this.workspaceSymbolFullDirty = false;
    const dirtyFiles = new Set(this.workspaceSymbolDirtyFiles);
    for (const file of dirtyFiles) {
      this.workspaceSymbolDirtyFiles.delete(file);
    }

    try {
      const documents = await this.workspaceDocuments();
      if (this.disposed) {
        return [];
      }
      const currentByPath = new Map(
        documents.map((document) => [documentPath(document), document]),
      );
      for (const file of [...this.workspaceSymbolRecords.keys()]) {
        if (!currentByPath.has(file)) {
          this.workspaceSymbolRecords.delete(file);
        }
      }
      for (const document of documents) {
        if (this.disposed) {
          return [];
        }
        const file = documentPath(document);
        if (
          refreshAll
          || dirtyFiles.has(file)
          || !this.workspaceSymbolRecords.has(file)
        ) {
          const symbols = this.provideDocumentSymbols(document);
          if (this.disposed) {
            return [];
          }
          this.workspaceSymbolRecords.set(file, {
            document,
            symbols,
          });
        }
      }
      const workspaceSymbolEntries = documents.flatMap((document) => {
        const record = this.workspaceSymbolRecords.get(documentPath(document));
        return record ? record.symbols : [];
      });
      if (this.disposed) {
        return [];
      }
      this.workspaceSymbolEntries = workspaceSymbolEntries;
      this.workspaceSymbolReady = true;
      return this.workspaceSymbolEntries;
    } catch (error) {
      if (this.disposed) {
        return [];
      }
      if (refreshAll) {
        this.workspaceSymbolFullDirty = true;
      }
      for (const file of dirtyFiles) {
        this.workspaceSymbolDirtyFiles.add(file);
      }
      throw error;
    }
  }

  async cachedWorkspaceSymbols() {
    if (this.disposed) {
      return [];
    }
    if (!this.documentStore) {
      return undefined;
    }
    if (
      this.workspaceSymbolReady
      && !this.workspaceSymbolPending
      && !this.workspaceSymbolFullDirty
      && this.workspaceSymbolDirtyFiles.size === 0
    ) {
      return this.workspaceSymbolEntries;
    }
    if (!this.workspaceSymbolPending) {
      this.workspaceSymbolPending = this.refreshWorkspaceSymbolCache().finally(() => {
        this.workspaceSymbolPending = undefined;
      });
    }
    try {
      await this.workspaceSymbolPending;
    } catch (error) {
      if (this.disposed) {
        return [];
      }
      throw error;
    }
    if (this.disposed) {
      return [];
    }
    if (
      this.workspaceSymbolPending
      || this.workspaceSymbolFullDirty
      || this.workspaceSymbolDirtyFiles.size > 0
    ) {
      return this.cachedWorkspaceSymbols();
    }
    return this.workspaceSymbolEntries;
  }

  async provideWorkspaceSymbolsForOperation(normalizedQuery, operation) {
    const queryText = normalizedQuery.toLowerCase();
    const specSymbols = [];
    const scenarioSymbols = [];
    let symbols = await this.cachedWorkspaceSymbols();
    if (!this.workspaceSymbolOperationActive(operation)) {
      return [];
    }
    if (!symbols) {
      let documents;
      try {
        documents = await this.workspaceDocuments(operation);
      } catch (error) {
        if (!this.workspaceSymbolOperationActive(operation)) {
          return [];
        }
        throw error;
      }
      symbols = [];
      for (const document of documents) {
        if (!this.workspaceSymbolOperationActive(operation)) {
          return [];
        }
        symbols.push(...this.provideDocumentSymbols(document));
      }
    }
    if (!this.workspaceSymbolOperationActive(operation)) {
      return [];
    }
    for (const symbol of symbols) {
      if (!this.workspaceSymbolOperationActive(operation)) {
        return [];
      }
      if (!workspaceSymbolHeadingValue(symbol.name).toLowerCase().includes(queryText)) {
        continue;
      }
      if (symbol.name.startsWith("##")) {
        scenarioSymbols.push(symbol);
      } else if (symbol.name.startsWith("#")) {
        specSymbols.push(symbol);
      }
    }

    specSymbols.sort(symbolNameCompare);
    scenarioSymbols.sort(symbolNameCompare);
    return [...specSymbols, ...scenarioSymbols];
  }

  provideWorkspaceSymbols(query, token) {
    if (this.disposed || (token && token.isCancellationRequested)) {
      return [];
    }
    const normalizedQuery = workspaceSymbolQuery(query);
    if (normalizedQuery.length < 2) {
      return [];
    }
    return this.runWorkspaceSymbolOperation(
      token,
      (operation) => this.provideWorkspaceSymbolsForOperation(normalizedQuery, operation),
    );
  }
}

module.exports = {
  GaugeDocumentSymbolProvider,
};
