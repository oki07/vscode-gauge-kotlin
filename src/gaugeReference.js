"use strict";

const SHOW_REFERENCES = "editor.action.showReferences";
const SHOW_REFERENCES_AT_CURSOR = "gauge.showReferences.atCursor";
const SHOW_REFERENCES_FOR_STEP = "gauge.showReferences";
const STEP_REFERENCES_REQUEST = "gauge/stepReferences";
const STEP_VALUE_AT_REQUEST = "gauge/stepValueAt";
const GAUGE_LANGUAGE = "gauge";
const GAUGE_REFERENCE_PATTERNS = ["**/*.spec", "**/*.cpt", "**/*.md"];

const {
  GaugeStepDiagnosticsProvider,
  findConceptHeadings,
  findStepFunctions,
  isKotlinDocument,
} = require("./stepDiagnostics");
const { normalizeStepTemplate, stepTextAt } = require("./stepDefinitionProvider");

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createCancellationToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
}

function textDocumentIdentifier(uri) {
  return { uri };
}

function documentPath(document) {
  return document && document.uri && document.uri.fsPath;
}

function uriPath(uri) {
  return uri && uri.fsPath;
}

function sameDocument(left, right) {
  if (left === right) {
    return true;
  }
  const leftPath = documentPath(left);
  const rightPath = documentPath(right);
  return Boolean(leftPath && rightPath && leftPath === rightPath);
}

function documentUri(document) {
  if (document && document.uri && typeof document.uri.toString === "function") {
    return document.uri.toString();
  }
  const file = documentPath(document);
  return file ? `file://${file}` : undefined;
}

function offsetAt(text, position) {
  let offset = 0;
  let line = 0;
  while (line < position.line && offset < text.length) {
    const nextLine = text.indexOf("\n", offset);
    if (nextLine === -1) {
      return text.length;
    }
    offset = nextLine + 1;
    line += 1;
  }
  return Math.min(offset + position.character, text.length);
}

function commentEnd(text, index) {
  if (text.startsWith("//", index)) {
    const lineEnd = text.indexOf("\n", index + 2);
    return lineEnd === -1 ? text.length : lineEnd;
  }
  if (text.startsWith("/*", index)) {
    const blockEnd = text.indexOf("*/", index + 2);
    return blockEnd === -1 ? text.length : blockEnd + 2;
  }
  return undefined;
}

function stringLiteralEnd(text, start, limit) {
  if (text.startsWith("\"\"\"", start)) {
    const end = text.indexOf("\"\"\"", start + 3);
    return end === -1 || end + 3 > limit ? -1 : end + 3;
  }

  for (let index = start + 1; index < limit; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === "\"") {
      return index + 1;
    }
  }
  return -1;
}

function stringLiteralRanges(text, start, end) {
  const ranges = [];
  for (let index = start; index < end; index += 1) {
    const nextCommentEnd = commentEnd(text, index);
    if (nextCommentEnd !== undefined) {
      index = nextCommentEnd - 1;
      continue;
    }
    if (text[index] !== "\"") {
      continue;
    }
    const literalEnd = stringLiteralEnd(text, index, end);
    if (literalEnd === -1) {
      continue;
    }
    ranges.push({ start: index, end: literalEnd });
    index = literalEnd - 1;
  }
  return ranges;
}

function aliasValuesAtOffset(entry, text, offset) {
  if (
    entry.annotationStart !== undefined
    && entry.annotationEnd !== undefined
    && offset >= entry.annotationStart
    && offset <= entry.annotationEnd
  ) {
    const ranges = stringLiteralRanges(text, entry.annotationStart, entry.annotationEnd);
    const rangeIndex = ranges.findIndex((range) => offset >= range.start && offset <= range.end);
    if (rangeIndex !== -1) {
      if (entry.aliases.length === 1) {
        return [entry.aliases[0]];
      }
      if (ranges.length === entry.aliases.length && entry.aliases[rangeIndex] !== undefined) {
        return [entry.aliases[rangeIndex]];
      }
    }
  }
  return entry.aliases;
}

function uniqueValues(values) {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function valuesForStep(stepValue) {
  return Array.isArray(stepValue) ? uniqueValues(stepValue) : uniqueValues([stepValue]);
}

function locationKey(location) {
  const uri = location && location.uri;
  const uriText = typeof uri === "string"
    ? uri
    : uri && typeof uri.toString === "function"
      ? uri.toString()
      : uri && uri.fsPath;
  const range = (location && location.range) || {};
  const start = range.start || {};
  const end = range.end || {};
  return [
    uriText || "",
    start.line,
    start.character,
    end.line,
    end.character,
  ].join(":");
}

function uniqueLocations(locations) {
  const result = [];
  const seen = new Set();
  for (const location of locations || []) {
    const key = locationKey(location);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(location);
  }
  return result;
}

function hasLocations(locations) {
  return Array.isArray(locations) ? locations.length > 0 : Boolean(locations);
}

function gaugeStepText(line) {
  if (!line.startsWith("*")) {
    return undefined;
  }
  const stepText = line.slice(1).trim();
  return stepText || undefined;
}

function isInlineTableLine(line) {
  return line.trimStart().startsWith("|");
}

function isConceptReferenceDocument(document) {
  const file = documentPath(document);
  return typeof file === "string" && file.toLowerCase().endsWith(".cpt");
}

function localGaugeStepReferences(document, targetTemplate) {
  const uri = documentUri(document);
  if (!uri || typeof document.getText !== "function") {
    return [];
  }

  const locations = [];
  const lines = document.getText().split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    let stepText = gaugeStepText(lines[lineIndex]);
    if (stepText && lines[lineIndex + 1] && isInlineTableLine(lines[lineIndex + 1])) {
      stepText = `${stepText} <table>`;
    }
    if (!stepText || normalizeStepTemplate(stepText) !== targetTemplate) {
      continue;
    }
    locations.push({
      uri,
      range: {
        start: { line: lineIndex, character: 0 },
        end: { line: lineIndex, character: lines[lineIndex].length },
      },
    });
  }
  if (isConceptReferenceDocument(document)) {
    for (const heading of findConceptHeadings(document.getText())) {
      if (heading.normalized !== targetTemplate) {
        continue;
      }
      locations.push({
        uri,
        range: {
          start: heading.start,
          end: heading.end,
        },
      });
    }
  }
  return locations;
}

class ReferenceProvider {
  constructor(clients, options = {}) {
    this.clients = clients;
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
    this.diagnosticsProvider = new GaugeStepDiagnosticsProvider({
      projectFactory: this.projectFactory,
      vscode: this.vscode,
    });
    this.disposables = [];
    this.registerCommands();
    const provider = this.registerReferenceProvider();
    if (provider) {
      this.disposables.push(provider);
    }
  }

  registerCommands() {
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return;
    }

    this.disposables.push(
      this.vscode.commands.registerCommand(
        SHOW_REFERENCES_AT_CURSOR,
        () => this.showStepReferencesAtCursor(),
      ),
    );
    this.disposables.push(
      this.vscode.commands.registerCommand(
        SHOW_REFERENCES_FOR_STEP,
        (uri, position, stepValue) => this.showStepReferences(uri, position, stepValue),
      ),
    );
  }

  dispose() {
    for (const disposable of this.disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
  }

  showStepReferences(uri, position, stepValue) {
    const languageClient = this.languageClientForUri(this.vscode.Uri.parse(uri));
    return this.referenceLocationsForStepValues(languageClient, stepValue, { requestEmpty: true })
      .then((locations) => this.showReferences(locations, uri, languageClient, position));
  }

  showStepReferencesAtCursor() {
    const editor = this.vscode.window.activeTextEditor;
    const position = editor.selection.active;
    const activeUri = editor.document.uri;
    const documentId = textDocumentIdentifier(activeUri.toString());
    const languageClient = this.languageClientForUri(activeUri);
    const params = { textDocument: documentId, position };

    if (!languageClient || typeof languageClient.sendRequest !== "function") {
      return this.localStepValuesAt(editor.document, position)
        .then((stepValues) => this.showStepReferences(documentId.uri, position, stepValues));
    }

    return languageClient
      .sendRequest(STEP_VALUE_AT_REQUEST, params, createCancellationToken(this.vscode))
      .then(async (stepValue) => {
        const localStepValues = stepValue
          ? undefined
          : await this.localStepValuesAt(editor.document, position);
        return this.showStepReferences(
          documentId.uri,
          position,
          stepValue || (localStepValues && localStepValues.length > 0 ? localStepValues : stepValue),
        );
      });
  }

  registerReferenceProvider() {
    if (!this.vscode.languages || typeof this.vscode.languages.registerReferenceProvider !== "function") {
      return undefined;
    }
    return this.vscode.languages.registerReferenceProvider(
      [
        { language: GAUGE_LANGUAGE },
        { language: "kotlin" },
        { scheme: "file", pattern: "**/*.kt" },
      ],
      this,
    );
  }

  languageClientForUri(uri) {
    const entry = this.clients && typeof this.clients.get === "function"
      ? this.clients.get(uri && uri.fsPath)
      : undefined;
    return entry && entry.client;
  }

  async referenceLocationsForStep(languageClient, stepValue, options = {}) {
    if (!stepValue && !options.requestEmpty) {
      return undefined;
    }
    let locations;
    if (languageClient && typeof languageClient.sendRequest === "function") {
      locations = await languageClient.sendRequest(
        STEP_REFERENCES_REQUEST,
        stepValue,
        createCancellationToken(this.vscode),
      );
    }
    return hasLocations(locations) ? locations : this.localStepReferences(stepValue);
  }

  async referenceLocationsForStepValues(languageClient, stepValue, options = {}) {
    const stepValues = valuesForStep(stepValue);
    if (stepValues.length === 0) {
      if (Array.isArray(stepValue)) {
        return options.requestEmpty
          ? this.referenceLocationsForStep(languageClient, undefined, options)
          : undefined;
      }
      return this.referenceLocationsForStep(languageClient, stepValue, options);
    }

    const locations = [];
    for (const value of stepValues) {
      const valueLocations = await this.referenceLocationsForStep(languageClient, value, options);
      if (hasLocations(valueLocations)) {
        locations.push(...valueLocations);
      }
    }
    return locations.length > 0 ? uniqueLocations(locations) : undefined;
  }

  convertLocations(locations, languageClient) {
    if (!hasLocations(locations)) {
      return [];
    }
    if (
      languageClient
      && languageClient.protocol2CodeConverter
      && typeof languageClient.protocol2CodeConverter.asLocation === "function"
    ) {
      return locations.map((location) => languageClient.protocol2CodeConverter.asLocation(location));
    }
    return locations;
  }

  async stepValueAt(document, position, languageClient) {
    const stepValues = await this.stepValuesAt(document, position, languageClient);
    return stepValues[0];
  }

  async stepValuesAt(document, position, languageClient) {
    if (!document || !position) {
      return [];
    }
    if (isKotlinDocument(document)) {
      return this.kotlinStepValuesAt(document, position);
    }
    if (document.languageId !== GAUGE_LANGUAGE) {
      return [];
    }
    if (!languageClient || typeof languageClient.sendRequest !== "function") {
      return valuesForStep(stepTextAt(document, position));
    }
    const params = {
      textDocument: textDocumentIdentifier(documentUri(document)),
      position,
    };
    const stepValue = await languageClient.sendRequest(
      STEP_VALUE_AT_REQUEST,
      params,
      createCancellationToken(this.vscode),
    );
    return valuesForStep(stepValue || stepTextAt(document, position));
  }

  async localStepValueAt(document, position) {
    const stepValues = await this.localStepValuesAt(document, position);
    return stepValues[0];
  }

  async localStepValuesAt(document, position) {
    if (!document || !position) {
      return [];
    }
    if (isKotlinDocument(document)) {
      return this.kotlinStepValuesAt(document, position);
    }
    if (document.languageId === GAUGE_LANGUAGE) {
      return valuesForStep(stepTextAt(document, position));
    }
    return [];
  }

  async provideReferences(document, position) {
    const languageClient = this.languageClientForUri(document && document.uri);
    const stepValues = await this.stepValuesAt(document, position, languageClient);
    const locations = await this.referenceLocationsForStepValues(languageClient, stepValues);
    return this.convertLocations(locations, languageClient);
  }

  async findWorkspaceKotlinDocuments() {
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    let uris;
    try {
      uris = await workspace.findFiles("**/*.kt");
    } catch (_error) {
      return [];
    }

    const documents = [];
    for (const uri of uris || []) {
      const file = uriPath(uri);
      if (file && this.projectFactory && typeof this.projectFactory.getGaugeRootFromFilePath === "function") {
        try {
          this.projectFactory.getGaugeRootFromFilePath(file);
        } catch (_error) {
          continue;
        }
      }

      try {
        documents.push(await workspace.openTextDocument(uri));
      } catch (_error) {
        // Ignore unreadable files so one stale workspace URI does not block references.
      }
    }
    return documents;
  }

  async findWorkspaceGaugeDocuments() {
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    const documents = [];
    for (const pattern of GAUGE_REFERENCE_PATTERNS) {
      let uris;
      try {
        uris = await workspace.findFiles(pattern);
      } catch (_error) {
        continue;
      }

      for (const uri of uris || []) {
        const file = uriPath(uri);
        if (file && this.projectFactory && typeof this.projectFactory.getGaugeRootFromFilePath === "function") {
          try {
            this.projectFactory.getGaugeRootFromFilePath(file);
          } catch (_error) {
            continue;
          }
        }

        try {
          documents.push(await workspace.openTextDocument(uri));
        } catch (_error) {
          // Ignore unreadable files so one stale workspace URI does not block local references.
        }
      }
    }
    return documents;
  }

  async kotlinDocuments(sourceDocument) {
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || sameDocument(candidate, sourceDocument)
        || !isKotlinDocument(candidate)
        || typeof candidate.getText !== "function"
        || !this.diagnosticsProvider.isGaugeProjectDocument(candidate)
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

    for (const candidate of workspace.textDocuments || []) {
      addDocument(candidate);
    }
    for (const candidate of await this.findWorkspaceKotlinDocuments()) {
      addDocument(candidate);
    }
    return documents;
  }

  async kotlinStepValueAt(document, position) {
    const stepValues = await this.kotlinStepValuesAt(document, position);
    return stepValues[0];
  }

  async kotlinStepValuesAt(document, position) {
    if (
      !document
      || !isKotlinDocument(document)
      || typeof document.getText !== "function"
      || !position
    ) {
      return [];
    }

    const text = document.getText();
    const offset = offsetAt(text, position);
    const externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(
      document,
      await this.kotlinDocuments(document),
    );
    for (const entry of findStepFunctions(text, externalConstants)) {
      const start = entry.annotationStart !== undefined ? entry.annotationStart : entry.parameterStart;
      const end = entry.declarationEnd !== undefined ? entry.declarationEnd : entry.parameterEnd;
      if (offset >= start && offset <= end) {
        return uniqueValues(aliasValuesAtOffset(entry, text, offset));
      }
    }
    return [];
  }

  async gaugeDocuments() {
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || candidate.languageId !== GAUGE_LANGUAGE
        || typeof candidate.getText !== "function"
        || !this.diagnosticsProvider.isGaugeProjectDocument(candidate)
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

    for (const candidate of workspace.textDocuments || []) {
      addDocument(candidate);
    }
    for (const candidate of await this.findWorkspaceGaugeDocuments()) {
      addDocument(candidate);
    }
    return documents;
  }

  async localStepReferences(stepValue) {
    if (!stepValue) {
      return undefined;
    }
    const targetTemplate = normalizeStepTemplate(stepValue);
    const locations = [];
    for (const document of await this.gaugeDocuments()) {
      locations.push(...localGaugeStepReferences(document, targetTemplate));
    }
    return locations.length > 0 ? locations : undefined;
  }

  showReferences(locations, uri, languageClient, position) {
    if (locations) {
      return this.vscode.commands.executeCommand(
        SHOW_REFERENCES,
        this.vscode.Uri.parse(uri),
        (
          languageClient
          && languageClient.protocol2CodeConverter
          && typeof languageClient.protocol2CodeConverter.asPosition === "function"
            ? languageClient.protocol2CodeConverter.asPosition(position)
            : position
        ),
        this.convertLocations(locations, languageClient),
      );
    }
    this.vscode.window.showInformationMessage("Action NA: Try this on an implementation.");
    return Promise.resolve(false);
  }
}

module.exports = {
  ReferenceProvider,
};
