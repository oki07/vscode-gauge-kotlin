"use strict";

const SHOW_REFERENCES = "editor.action.showReferences";
const SHOW_REFERENCES_AT_CURSOR = "gauge.showReferences.atCursor";
const SHOW_REFERENCES_FOR_STEP = "gauge.showReferences";
const STEP_REFERENCES_REQUEST = "gauge/stepReferences";
const STEP_VALUE_AT_REQUEST = "gauge/stepValueAt";
const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_PATTERN = /\.spec$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const GAUGE_REFERENCE_PATTERNS = ["**/*.spec", "**/*.cpt", "**/*.md"];
const STEP_IMPLEMENTATION_REFERENCE_PATTERNS = ["**/*.kt", "**/*.java"];
const PROJECT_ROOT_GAUGE = "gauge";
const PROJECT_ROOT_NON_GAUGE = "nonGauge";
const PROJECT_ROOT_UNKNOWN = "unknown";

const {
  GaugeStepDiagnosticsProvider,
  findConceptHeadings,
  findStepFunctionsForDocument,
  isStepImplementationDocument,
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

function isGaugeReferenceDocument(document) {
  if (!document || typeof document.getText !== "function") {
    return false;
  }
  if (document.languageId === GAUGE_LANGUAGE || document.languageId === GAUGE_CONCEPT_LANGUAGE) {
    return true;
  }
  const file = documentPath(document);
  if (SPEC_FILE_PATTERN.test(file) || CONCEPT_FILE_PATTERN.test(file)) {
    return true;
  }
  return document.languageId === MARKDOWN_LANGUAGE
    && MARKDOWN_SPEC_FILE_PATTERN.test(file);
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

function normalizeIdentifier(value) {
  const text = String(value || "").trim();
  return text.startsWith("`") && text.endsWith("`") ? text.slice(1, -1) : text;
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const nextCommentEnd = commentEnd(text, index);
    if (nextCommentEnd !== undefined) {
      index = nextCommentEnd - 1;
      continue;
    }
    if (text[index] === "\"") {
      const literalEnd = stringLiteralEnd(text, index, text.length);
      if (literalEnd !== -1) {
        index = literalEnd - 1;
        continue;
      }
    }
    if (text[index] === "{") {
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function splitTopLevel(value, separator) {
  const parts = [];
  let start = 0;
  let angleDepth = 0;
  let parenDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0) {
      angleDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    } else if (char === separator && angleDepth === 0 && parenDepth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function stripTopLevelGenericAndCall(value) {
  let result = "";
  let angleDepth = 0;
  let parenDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "<") {
      angleDepth += 1;
      continue;
    }
    if (char === ">" && angleDepth > 0) {
      angleDepth -= 1;
      continue;
    }
    if (char === "(" && angleDepth === 0) {
      parenDepth += 1;
      continue;
    }
    if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (angleDepth === 0 && parenDepth === 0) {
      result += char;
    }
  }
  return result.trim();
}

function simpleTypeName(value) {
  const stripped = stripTopLevelGenericAndCall(String(value || "").split(/\s+by\s+/u)[0]);
  const match = /(?:`[^`\r\n]+`|[A-Za-z_$][A-Za-z0-9_$]*)\s*$/u.exec(stripped);
  return match ? normalizeIdentifier(match[0]) : undefined;
}

function topLevelColon(value) {
  let angleDepth = 0;
  let parenDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0) {
      angleDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    } else if (char === ":" && angleDepth === 0 && parenDepth === 0) {
      return index;
    }
  }
  return -1;
}

function kotlinSuperTypes(header) {
  const colonIndex = topLevelColon(header);
  if (colonIndex === -1) {
    return [];
  }
  return splitTopLevel(header.slice(colonIndex + 1), ",")
    .map(simpleTypeName)
    .filter(Boolean);
}

function javaTypeList(header, keyword) {
  const match = new RegExp(`\\b${keyword}\\b([\\s\\S]*?)(?=\\b(?:extends|implements|permits)\\b|$)`).exec(header);
  if (!match) {
    return [];
  }
  return splitTopLevel(match[1], ",")
    .map(simpleTypeName)
    .filter(Boolean);
}

function javaSuperTypes(header) {
  return [
    ...javaTypeList(header, "extends"),
    ...javaTypeList(header, "implements"),
  ];
}

function collectTypeDeclarations(document) {
  if (!document || typeof document.getText !== "function") {
    return [];
  }
  const text = document.getText();
  const file = documentPath(document) || "";
  const isJava = file.toLowerCase().endsWith(".java") || document.languageId === "java";
  const pattern = isJava
    ? /\b(?:class|interface|enum|record)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
    : /\b(?:class|interface|object)\s+(`[^`\r\n]+`|[A-Za-z_][A-Za-z0-9_]*)/gu;
  const declarations = [];
  let match = pattern.exec(text);
  while (match) {
    const bodyStart = text.indexOf("{", pattern.lastIndex);
    if (bodyStart === -1) {
      match = pattern.exec(text);
      continue;
    }
    const bodyEnd = findMatchingBrace(text, bodyStart);
    if (bodyEnd === -1) {
      match = pattern.exec(text);
      continue;
    }
    const header = text.slice(pattern.lastIndex, bodyStart);
    declarations.push({
      document,
      end: bodyEnd,
      name: normalizeIdentifier(match[1]),
      start: match.index,
      superTypes: isJava ? javaSuperTypes(header) : kotlinSuperTypes(header),
    });
    pattern.lastIndex = bodyStart + 1;
    match = pattern.exec(text);
  }
  return declarations;
}

function containingType(declarations, offset) {
  return declarations
    .filter((declaration) => offset >= declaration.start && offset <= declaration.end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
}

function kotlinFunctionName(header) {
  let name = String(header || "").replace(/^fun\b/u, "").trim();
  if (name.startsWith("<")) {
    const closeIndex = name.indexOf(">");
    if (closeIndex !== -1) {
      name = name.slice(closeIndex + 1).trim();
    }
  }
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex !== -1) {
    name = name.slice(dotIndex + 1).trim();
  }
  const match = /^(?:`[^`\r\n]+`|[A-Za-z_][A-Za-z0-9_]*)/u.exec(name);
  return match ? normalizeIdentifier(match[0]) : undefined;
}

function stepEntryMethodName(document, text, entry) {
  const file = documentPath(document) || "";
  const isJava = file.toLowerCase().endsWith(".java") || document.languageId === "java";
  const header = text.slice(entry.declarationStart, Math.max(entry.declarationStart, entry.parameterStart - 1));
  if (isJava) {
    const match = /(?:[A-Za-z_$][A-Za-z0-9_$]*)\s*$/u.exec(header.trim());
    return match ? normalizeIdentifier(match[0]) : undefined;
  }
  return kotlinFunctionName(header);
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
  const marker = String(line || "").search(/\S/);
  if (marker === -1 || line[marker] !== "*") {
    return undefined;
  }
  const stepText = line.slice(marker + 1).trim();
  return stepText || undefined;
}

function gaugeStepMarker(line) {
  const marker = String(line || "").search(/\S/);
  return marker !== -1 && line[marker] === "*" ? marker : -1;
}

function isInlineTableLine(line) {
  return line.trimStart().startsWith("|");
}

function isConceptReferenceDocument(document) {
  const file = documentPath(document);
  return typeof file === "string" && file.toLowerCase().endsWith(".cpt");
}

function positionInRange(position, range) {
  if (!position || !range || !range.start || !range.end) {
    return false;
  }
  if (position.line < range.start.line || position.line > range.end.line) {
    return false;
  }
  if (position.line === range.start.line && position.character < range.start.character) {
    return false;
  }
  if (position.line === range.end.line && position.character > range.end.character) {
    return false;
  }
  return true;
}

function conceptHeadingTextAt(document, position) {
  if (!isConceptReferenceDocument(document) || typeof document.getText !== "function") {
    return undefined;
  }
  const heading = findConceptHeadings(document.getText()).find((entry) => (
    positionInRange(position, entry)
  ));
  return heading && heading.text;
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
    const marker = gaugeStepMarker(lines[lineIndex]);
    locations.push({
      uri,
      range: {
        start: { line: lineIndex, character: marker === -1 ? 0 : marker },
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
    const sourceUri = this.vscode.Uri.parse(uri);
    const languageClient = this.languageClientForUri(sourceUri);
    return this.referenceLocationsForStepValues(languageClient, stepValue, {
      requestEmpty: true,
      sourcePath: uriPath(sourceUri),
    })
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
    return hasLocations(locations) ? locations : this.localStepReferences(stepValue, options);
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
    if (isStepImplementationDocument(document)) {
      return this.stepImplementationValuesAt(document, position);
    }
    if (!isGaugeReferenceDocument(document)) {
      return [];
    }
    if (!languageClient || typeof languageClient.sendRequest !== "function") {
      return valuesForStep(stepTextAt(document, position) || conceptHeadingTextAt(document, position));
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
    return valuesForStep(stepValue || stepTextAt(document, position) || conceptHeadingTextAt(document, position));
  }

  async localStepValueAt(document, position) {
    const stepValues = await this.localStepValuesAt(document, position);
    return stepValues[0];
  }

  async localStepValuesAt(document, position) {
    if (!document || !position) {
      return [];
    }
    if (isStepImplementationDocument(document)) {
      return this.stepImplementationValuesAt(document, position);
    }
    if (isGaugeReferenceDocument(document)) {
      return valuesForStep(stepTextAt(document, position) || conceptHeadingTextAt(document, position));
    }
    return [];
  }

  async provideReferences(document, position) {
    const languageClient = this.languageClientForUri(document && document.uri);
    const stepValues = await this.stepValuesAt(document, position, languageClient);
    const locations = await this.referenceLocationsForStepValues(languageClient, stepValues, {
      sourceDocument: document,
    });
    return this.convertLocations(locations, languageClient);
  }

  sourceGaugeProjectRoot(options = {}) {
    if (options.sourceDocument) {
      return this.diagnosticsProvider.gaugeProjectRoot(options.sourceDocument);
    }
    const projectRootInfo = this.projectRootInfoForFile(options.sourcePath);
    return projectRootInfo.type === PROJECT_ROOT_GAUGE ? projectRootInfo.root : undefined;
  }

  projectRootInfoForFile(file) {
    if (
      !file
      || !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return { root: undefined, type: PROJECT_ROOT_UNKNOWN };
    }
    try {
      const root = this.projectFactory.getGaugeRootFromFilePath(file);
      if (!this.diagnosticsProvider.isGaugeProjectRoot(root)) {
        return { root: undefined, type: PROJECT_ROOT_NON_GAUGE };
      }
      return { root, type: PROJECT_ROOT_GAUGE };
    } catch (_error) {
      return { root: undefined, type: PROJECT_ROOT_NON_GAUGE };
    }
  }

  belongsPathToSourceGaugeProject(file, sourceRoot) {
    const projectRootInfo = this.projectRootInfoForFile(file);
    if (projectRootInfo.type === PROJECT_ROOT_UNKNOWN) {
      return true;
    }
    if (projectRootInfo.type === PROJECT_ROOT_NON_GAUGE) {
      return false;
    }
    return sourceRoot === undefined || projectRootInfo.root === sourceRoot;
  }

  shouldOpenWorkspaceStepImplementation(file, sourceRoot) {
    const projectRootInfo = this.projectRootInfoForFile(file);
    if (projectRootInfo.type === PROJECT_ROOT_UNKNOWN) {
      return true;
    }
    if (projectRootInfo.type === PROJECT_ROOT_NON_GAUGE) {
      return false;
    }
    return sourceRoot === undefined || projectRootInfo.root === sourceRoot;
  }

  async findWorkspaceStepImplementationDocuments(sourceRoot) {
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    const documents = [];
    for (const pattern of STEP_IMPLEMENTATION_REFERENCE_PATTERNS) {
      let uris;
      try {
        uris = await workspace.findFiles(pattern);
      } catch (_error) {
        continue;
      }

      for (const uri of uris || []) {
        const file = uriPath(uri);
        if (!this.shouldOpenWorkspaceStepImplementation(file, sourceRoot)) {
          continue;
        }

        try {
          documents.push(await workspace.openTextDocument(uri));
        } catch (_error) {
          // Ignore unreadable files so one stale workspace URI does not block references.
        }
      }
    }
    return documents;
  }

  async findWorkspaceGaugeDocuments(sourceRoot) {
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
        if (!this.belongsPathToSourceGaugeProject(file, sourceRoot)) {
          continue;
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

  async stepImplementationDocuments(sourceDocument) {
    const workspace = this.vscode.workspace || {};
    const sourceRoot = this.diagnosticsProvider.gaugeProjectRoot(sourceDocument);
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || sameDocument(candidate, sourceDocument)
        || !isStepImplementationDocument(candidate)
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
    for (const candidate of await this.findWorkspaceStepImplementationDocuments(sourceRoot)) {
      addDocument(candidate);
    }
    return documents;
  }

  async kotlinStepValueAt(document, position) {
    const stepValues = await this.stepImplementationValuesAt(document, position);
    return stepValues[0];
  }

  async stepImplementationValuesAt(document, position) {
    if (
      !document
      || !isStepImplementationDocument(document)
      || typeof document.getText !== "function"
      || !position
    ) {
      return [];
    }

    const text = document.getText();
    const offset = offsetAt(text, position);
    const implementationDocuments = await this.stepImplementationDocuments(document);
    const externalConstants = isStepImplementationDocument(document)
      ? this.diagnosticsProvider.collectWorkspaceConstants(
        document,
        implementationDocuments,
      )
      : undefined;
    for (const entry of findStepFunctionsForDocument(document, externalConstants)) {
      const start = entry.annotationStart !== undefined ? entry.annotationStart : entry.parameterStart;
      const end = entry.declarationEnd !== undefined ? entry.declarationEnd : entry.parameterEnd;
      if (offset >= start && offset <= end) {
        return uniqueValues([
          ...aliasValuesAtOffset(entry, text, offset),
          ...this.superStepAliasesForEntry(document, entry, [document, ...implementationDocuments]),
        ]);
      }
    }
    return [];
  }

  superStepAliasesForEntry(document, entry, implementationDocuments) {
    const text = document.getText();
    const methodName = stepEntryMethodName(document, text, entry);
    if (!methodName) {
      return [];
    }
    const declarationsByDocument = new Map();
    const typesByName = new Map();
    for (const candidate of implementationDocuments || []) {
      if (!candidate || typeof candidate.getText !== "function") {
        continue;
      }
      const declarations = collectTypeDeclarations(candidate);
      declarationsByDocument.set(candidate, declarations);
      for (const declaration of declarations) {
        if (!typesByName.has(declaration.name)) {
          typesByName.set(declaration.name, []);
        }
        typesByName.get(declaration.name).push(declaration);
      }
    }

    const currentType = containingType(
      declarationsByDocument.get(document) || [],
      entry.declarationStart,
    );
    if (!currentType || currentType.superTypes.length === 0) {
      return [];
    }

    const aliases = [];
    const queued = currentType.superTypes.slice();
    const visited = new Set();
    while (queued.length > 0) {
      const typeName = queued.shift();
      if (!typeName || visited.has(typeName)) {
        continue;
      }
      visited.add(typeName);
      for (const superType of typesByName.get(typeName) || []) {
        queued.push(...superType.superTypes);
        const superText = superType.document.getText();
        const externalConstants = isStepImplementationDocument(superType.document)
          ? this.diagnosticsProvider.collectWorkspaceConstants(
            superType.document,
            implementationDocuments.filter((candidate) => candidate !== superType.document),
          )
          : undefined;
        for (const superEntry of findStepFunctionsForDocument(superType.document, externalConstants)) {
          if (
            containingType(declarationsByDocument.get(superType.document) || [], superEntry.declarationStart) !== superType
            || stepEntryMethodName(superType.document, superText, superEntry) !== methodName
          ) {
            continue;
          }
          aliases.push(...superEntry.aliases);
        }
      }
    }
    return aliases;
  }

  async gaugeDocuments(sourceRoot) {
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || !isGaugeReferenceDocument(candidate)
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

    for (const candidate of workspace.textDocuments || []) {
      addDocument(candidate);
    }
    for (const candidate of await this.findWorkspaceGaugeDocuments(sourceRoot)) {
      addDocument(candidate);
    }
    return documents;
  }

  async localStepReferences(stepValue, options = {}) {
    if (!stepValue) {
      return undefined;
    }
    const targetTemplate = normalizeStepTemplate(stepValue);
    const sourceRoot = this.sourceGaugeProjectRoot(options);
    const locations = [];
    for (const document of await this.gaugeDocuments(sourceRoot)) {
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
