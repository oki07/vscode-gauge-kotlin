"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { offsetAt: indexedOffsetAt } = require("./documentPosition");

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
const KOTLIN_FILE_PATTERN = /\.kt$/i;
const JAVA_FILE_PATTERN = /\.java$/i;
const GAUGE_REFERENCE_FILE_PATTERNS = [
  SPEC_FILE_PATTERN,
  CONCEPT_FILE_PATTERN,
  MARKDOWN_SPEC_FILE_PATTERN,
];
const STEP_IMPLEMENTATION_FILE_PATTERNS = [KOTLIN_FILE_PATTERN, JAVA_FILE_PATTERN];
const PROJECT_ROOT_GAUGE = "gauge";
const PROJECT_ROOT_NON_GAUGE = "nonGauge";
const PROJECT_ROOT_UNKNOWN = "unknown";
const ALLOW_MULTILINE_STEP_PROPERTY = "allow_multiline_step";
const DEFAULT_ENV_PROPERTIES = ["env", "default", "default.properties"];
const CANCELLED_REFERENCE_OPERATION = Symbol("cancelledReferenceOperation");

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
    const value = document.uri.toString();
    if (value && value !== "[object Object]") {
      return value;
    }
  }
  const file = documentPath(document);
  return file ? `file://${file}` : undefined;
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

function isGaugeStepValueTemplate(value) {
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{" && text[index] !== "}") {
      continue;
    }
    if (text[index] === "{" && text[index + 1] === "}") {
      index += 1;
      continue;
    }
    return false;
  }
  return text.includes("{}");
}

function normalizeReferenceStepValue(stepValue) {
  const normalized = normalizeStepTemplate(stepValue);
  if (normalized) {
    return normalized;
  }
  if (isGaugeStepValueTemplate(stepValue)) {
    return String(stepValue).trim().normalize("NFC");
  }
  return undefined;
}

function superStepAliasesForEntry(document, entry, implementationDocuments, diagnosticsProvider) {
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
      const externalConstants = (
        isStepImplementationDocument(superType.document)
        && diagnosticsProvider
        && typeof diagnosticsProvider.collectWorkspaceConstants === "function"
      )
        ? diagnosticsProvider.collectWorkspaceConstants(
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

function gaugeStepMarker(line) {
  const marker = String(line || "").search(/\S/);
  return marker !== -1 && line[marker] === "*" ? marker : -1;
}

function isInlineTableLine(line) {
  const text = String(line || "").trim();
  return text.startsWith("|");
}

function isDocStringFenceLine(line) {
  return String(line || "").trim() === "\"\"\"";
}

function closedDocStringLines(lines) {
  const result = new Set();
  for (let stepLine = 0; stepLine < lines.length; stepLine += 1) {
    if (gaugeStepMarker(lines[stepLine]) === -1) {
      continue;
    }
    const openLine = stepLine + 1;
    if (!isDocStringFenceLine(lines[openLine])) {
      continue;
    }
    let closeLine;
    for (let candidateLine = openLine + 1; candidateLine < lines.length; candidateLine += 1) {
      if (isDocStringFenceLine(lines[candidateLine])) {
        closeLine = candidateLine;
        break;
      }
    }
    if (closeLine === undefined) {
      continue;
    }
    for (let line = openLine; line <= closeLine; line += 1) {
      result.add(line);
    }
    stepLine = closeLine;
  }
  return result;
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
    || isInlineTableLine(text)
    || isDocStringFenceLine(text)
    || /^={3,}\s*$/.test(text)
    || /^-{3,}\s*$/.test(text);
}

function gaugeStepReferenceEntry(lines, lineIndex, options = {}) {
  const line = lines[lineIndex] || "";
  const marker = gaugeStepMarker(line);
  if (marker === -1) {
    return undefined;
  }

  const textLines = [line.slice(marker + 1).trim()];
  let endLine = lineIndex;
  let endCharacter = line.length;
  if (options.allowMultilineStep) {
    for (let nextLine = lineIndex + 1; nextLine < lines.length; nextLine += 1) {
      const nextText = lines[nextLine] || "";
      if (isGaugeSyntaxBoundary(nextText)) {
        break;
      }
      textLines.push(nextText.trim());
      endLine = nextLine;
      endCharacter = nextText.length;
    }
  }

  let stepText = textLines.join(" ").trim();
  if (stepText && lines[endLine + 1] && isInlineTableLine(lines[endLine + 1])) {
    stepText = `${stepText} <table>`;
  }
  return {
    endCharacter,
    endLine,
    marker,
    stepText,
  };
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

function isConceptReferenceDocument(document) {
  const file = documentPath(document);
  return Boolean(document && document.languageId === GAUGE_CONCEPT_LANGUAGE)
    || (typeof file === "string" && file.toLowerCase().endsWith(".cpt"));
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

function localGaugeStepReferenceEntries(document, options = {}) {
  const uri = documentUri(document);
  if (!uri || typeof document.getText !== "function") {
    return [];
  }

  const entries = [];
  const lines = document.getText().split(/\r?\n/);
  const docStringLines = closedDocStringLines(lines);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (docStringLines.has(lineIndex)) {
      continue;
    }
    const startLine = lineIndex;
    const entry = gaugeStepReferenceEntry(lines, lineIndex, options);
    if (!entry) {
      continue;
    }
    lineIndex = entry.endLine;
    const normalized = entry.stepText ? normalizeStepTemplate(entry.stepText) : undefined;
    if (!normalized) {
      continue;
    }
    entries.push({
      kind: "step",
      location: {
        uri,
        range: {
          start: { line: startLine, character: entry.marker },
          end: { line: entry.endLine, character: entry.endCharacter },
        },
      },
      template: normalized,
    });
  }
  if (isConceptReferenceDocument(document)) {
    for (const heading of findConceptHeadings(document.getText())) {
      if (docStringLines.has(heading.start.line)) {
        continue;
      }
      if (!heading.normalized) {
        continue;
      }
      entries.push({
        kind: "concept",
        location: {
          uri,
          range: {
            start: heading.start,
            end: heading.end,
          },
        },
        template: heading.normalized,
      });
    }
  }
  return entries;
}

function localGaugeStepReferences(document, targetTemplate, options = {}) {
  if (!targetTemplate) {
    return [];
  }
  return localGaugeStepReferenceEntries(document, options)
    .filter((entry) => entry.template === targetTemplate)
    .map((entry) => entry.location);
}

class ReferenceProvider {
  constructor(clients, options = {}) {
    this.clients = clients;
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
    this.documentStore = options.documentStore;
    this.workspaceStepIndex = options.workspaceStepIndex;
    this.diagnosticsProvider = options.diagnosticsProvider
      || (this.workspaceStepIndex && this.workspaceStepIndex.diagnosticsProvider)
      || new GaugeStepDiagnosticsProvider({
        documentStore: this.documentStore,
        fileSystem: this.fileSystem,
        pathModule: this.pathModule,
        projectFactory: this.projectFactory,
        vscode: this.vscode,
      });
    this.disposed = false;
    this.activeOperations = new Set();
    this.disposables = [];
    this.registerCommands();
    const provider = this.registerReferenceProvider();
    if (provider) {
      this.registerDisposable(provider);
    }
  }

  registerDisposable(disposable) {
    if (!disposable) {
      return;
    }
    if (this.disposed) {
      if (typeof disposable.dispose === "function") {
        disposable.dispose();
      }
      return;
    }
    this.disposables.push(disposable);
  }

  registerCommands() {
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return;
    }

    this.registerDisposable(
      this.vscode.commands.registerCommand(
        SHOW_REFERENCES_AT_CURSOR,
        () => this.showStepReferencesAtCursor(),
      ),
    );
    this.registerDisposable(
      this.vscode.commands.registerCommand(
        SHOW_REFERENCES_FOR_STEP,
        (uri, position, stepValue) => this.showStepReferences(uri, position, stepValue),
      ),
    );
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
    const disposables = this.disposables;
    this.disposables = [];
    for (const disposable of disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
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
      resolveCancellation,
      sources: new Set(),
    };
    this.activeOperations.add(operation);
    return operation;
  }

  isOperationActive(operation) {
    return !this.disposed && operation && operation.active;
  }

  disposeRequestSource(source, cancel) {
    if (!source) {
      return;
    }
    if (cancel && typeof source.cancel === "function") {
      try {
        source.cancel();
      } catch (_error) {
        // Cancellation is advisory; owned source disposal must still complete.
      }
    }
    if (typeof source.dispose === "function") {
      try {
        source.dispose();
      } catch (_error) {
        // A host cleanup failure must not reopen a terminal command operation.
      }
    }
  }

  cancelOperation(operation) {
    if (!operation || !operation.active) {
      return;
    }
    operation.active = false;
    this.activeOperations.delete(operation);
    const sources = [...operation.sources];
    operation.sources.clear();
    operation.resolveCancellation(CANCELLED_REFERENCE_OPERATION);
    for (const source of sources) {
      this.disposeRequestSource(source, true);
    }
  }

  finishOperation(operation) {
    if (!operation || !operation.active) {
      return;
    }
    operation.active = false;
    this.activeOperations.delete(operation);
    const sources = [...operation.sources];
    operation.sources.clear();
    for (const source of sources) {
      this.disposeRequestSource(source, false);
    }
  }

  runCommandOperation(callback) {
    const operation = this.createOperation();
    if (!operation) {
      return Promise.resolve(undefined);
    }
    let workflow;
    try {
      workflow = Promise.resolve(callback(operation));
    } catch (error) {
      workflow = Promise.reject(error);
    }
    return Promise.race([workflow, operation.cancellation])
      .then((value) => value === CANCELLED_REFERENCE_OPERATION ? undefined : value)
      .finally(() => this.finishOperation(operation));
  }

  callSyncForOperation(operation, callback) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    try {
      const value = callback();
      return this.isOperationActive(operation) ? value : CANCELLED_REFERENCE_OPERATION;
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      throw error;
    }
  }

  async callForOperation(operation, callback) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    let result;
    try {
      result = callback();
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      throw error;
    }
    const observed = Promise.resolve(result);
    if (!this.isOperationActive(operation)) {
      observed.catch(() => {});
      return CANCELLED_REFERENCE_OPERATION;
    }
    try {
      const value = await Promise.race([observed, operation.cancellation]);
      return this.isOperationActive(operation) ? value : CANCELLED_REFERENCE_OPERATION;
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      throw error;
    }
  }

  callDetachedForOperation(operation, callback) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    let result;
    try {
      result = callback();
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      throw error;
    }
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(() => {});
    }
    return this.isOperationActive(operation) ? result : CANCELLED_REFERENCE_OPERATION;
  }

  createRequestSource(operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    if (typeof this.vscode.CancellationTokenSource !== "function") {
      return undefined;
    }
    let source;
    try {
      source = new this.vscode.CancellationTokenSource();
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      throw error;
    }
    if (!this.isOperationActive(operation)) {
      this.disposeRequestSource(source, true);
      return CANCELLED_REFERENCE_OPERATION;
    }
    operation.sources.add(source);
    return source;
  }

  releaseRequestSource(operation, source) {
    if (source && operation.sources.delete(source)) {
      this.disposeRequestSource(source, false);
    }
  }

  async requestForOperation(operation, languageClient, method, params) {
    const source = this.createRequestSource(operation);
    if (source === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    try {
      return await this.callForOperation(
        operation,
        () => languageClient.sendRequest(method, params, source && source.token),
      );
    } finally {
      this.releaseRequestSource(operation, source);
    }
  }

  showStepReferences(uri, position, stepValue) {
    return this.runCommandOperation(
      (operation) => this.showStepReferencesForOperation(operation, uri, position, stepValue),
    );
  }

  async showStepReferencesForOperation(operation, uri, position, stepValue) {
    const sourceUri = this.callSyncForOperation(operation, () => this.vscode.Uri.parse(uri));
    if (sourceUri === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    const languageClient = this.callSyncForOperation(
      operation,
      () => this.languageClientForUri(sourceUri),
    );
    if (languageClient === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    const locations = await this.referenceLocationsForStepValues(languageClient, stepValue, {
      requestEmpty: true,
      sourcePath: uriPath(sourceUri),
    }, operation);
    if (locations === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    return this.showReferencesForOperation(operation, locations, uri, languageClient, position);
  }

  showStepReferencesAtCursor() {
    return this.runCommandOperation(
      (operation) => this.showStepReferencesAtCursorForOperation(operation),
    );
  }

  async showStepReferencesAtCursorForOperation(operation) {
    const editor = this.callSyncForOperation(
      operation,
      () => this.vscode.window.activeTextEditor,
    );
    if (editor === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    const commandState = this.callSyncForOperation(operation, () => {
      const position = editor.selection.active;
      const activeUri = editor.document.uri;
      return {
        documentId: textDocumentIdentifier(activeUri.toString()),
        languageClient: this.languageClientForUri(activeUri),
        position,
      };
    });
    if (commandState === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    const { documentId, languageClient, position } = commandState;
    const params = { textDocument: documentId, position };

    if (!languageClient || typeof languageClient.sendRequest !== "function") {
      const stepValues = await this.callForOperation(
        operation,
        () => this.localStepValuesAt(editor.document, position, operation),
      );
      if (stepValues === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      return this.showStepReferencesForOperation(operation, documentId.uri, position, stepValues);
    }

    const stepValue = await this.requestForOperation(
      operation,
      languageClient,
      STEP_VALUE_AT_REQUEST,
      params,
    );
    if (stepValue === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    const localStepValues = stepValue
      ? undefined
      : await this.callForOperation(
        operation,
        () => this.localStepValuesAt(editor.document, position, operation),
      );
    if (localStepValues === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    return this.showStepReferencesForOperation(
      operation,
      documentId.uri,
      position,
      stepValue || (localStepValues && localStepValues.length > 0 ? localStepValues : stepValue),
    );
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

  async referenceLocationsForStep(languageClient, stepValue, options = {}, operation) {
    if (operation && !this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    if (!stepValue && !options.requestEmpty) {
      return undefined;
    }
    let locations;
    if (languageClient && typeof languageClient.sendRequest === "function") {
      locations = operation
        ? await this.requestForOperation(
          operation,
          languageClient,
          STEP_REFERENCES_REQUEST,
          stepValue,
        )
        : await languageClient.sendRequest(
          STEP_REFERENCES_REQUEST,
          stepValue,
          createCancellationToken(this.vscode),
        );
      if (locations === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }
    }
    if (Array.isArray(locations)) {
      if (locations.length > 0) {
        return locations;
      }
      const localLocations = operation
        ? await this.callForOperation(
          operation,
          () => this.localStepReferences(stepValue, options, operation),
        )
        : await this.localStepReferences(stepValue, options);
      if (localLocations === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      return hasLocations(localLocations) ? localLocations : locations;
    }
    if (hasLocations(locations)) {
      return locations;
    }
    return operation
      ? this.callForOperation(
        operation,
        () => this.localStepReferences(stepValue, options, operation),
      )
      : this.localStepReferences(stepValue, options);
  }

  async referenceLocationsForStepValues(languageClient, stepValue, options = {}, operation) {
    if (operation && !this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    const stepValues = valuesForStep(stepValue);
    if (stepValues.length === 0) {
      if (Array.isArray(stepValue)) {
        return options.requestEmpty
          ? this.referenceLocationsForStep(languageClient, undefined, options, operation)
          : undefined;
      }
      return this.referenceLocationsForStep(languageClient, stepValue, options, operation);
    }

    const locations = [];
    let hasEmptyLocationList = false;
    for (const value of stepValues) {
      if (operation && !this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      const valueLocations = await this.referenceLocationsForStep(
        languageClient,
        value,
        options,
        operation,
      );
      if (valueLocations === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      if (hasLocations(valueLocations)) {
        locations.push(...valueLocations);
      } else if (Array.isArray(valueLocations)) {
        hasEmptyLocationList = true;
      }
    }
    return locations.length > 0 ? uniqueLocations(locations) : hasEmptyLocationList ? [] : undefined;
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
    // Without a client the locations are still in the LSP wire shape, whose
    // uri is a string. VS Code revives that field as a Uri and throws on a
    // plain string, discarding the whole result, so build real API objects.
    return locations.map((location) => this.toVscodeLocation(location));
  }

  convertLocationsForOperation(operation, locations, languageClient) {
    if (!hasLocations(locations)) {
      return [];
    }
    const convertedLocations = [];
    const converter = languageClient
      && languageClient.protocol2CodeConverter
      && typeof languageClient.protocol2CodeConverter.asLocation === "function"
      ? languageClient.protocol2CodeConverter.asLocation.bind(languageClient.protocol2CodeConverter)
      : (location) => this.toVscodeLocation(location);
    for (const location of locations) {
      const converted = this.callSyncForOperation(operation, () => converter(location));
      if (converted === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      convertedLocations.push(converted);
    }
    return convertedLocations;
  }

  toVscodeLocation(location) {
    const vscode = this.vscode;
    if (!vscode || typeof vscode.Location !== "function" || typeof vscode.Range !== "function") {
      return location;
    }
    const uri = typeof location.uri === "string" && vscode.Uri && typeof vscode.Uri.parse === "function"
      ? vscode.Uri.parse(location.uri)
      : location.uri;
    const range = location.range && typeof vscode.Position === "function"
      ? new vscode.Range(
        new vscode.Position(location.range.start.line, location.range.start.character),
        new vscode.Position(location.range.end.line, location.range.end.character),
      )
      : location.range;
    return new vscode.Location(uri, range);
  }

  async stepValueAt(document, position, languageClient) {
    const stepValues = await this.stepValuesAt(document, position, languageClient);
    return stepValues[0];
  }

  async stepValuesAt(document, position, languageClient, operation) {
    if (operation && !this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    if (!document || !position) {
      return [];
    }
    if (isStepImplementationDocument(document)) {
      return operation
        ? this.callForOperation(
          operation,
          () => this.stepImplementationValuesAt(document, position, operation),
        )
        : this.stepImplementationValuesAt(document, position);
    }
    if (!isGaugeReferenceDocument(document)) {
      return [];
    }
    if (!languageClient || typeof languageClient.sendRequest !== "function") {
      return valuesForStep(this.stepTextAt(document, position) || conceptHeadingTextAt(document, position));
    }
    const params = {
      textDocument: textDocumentIdentifier(documentUri(document)),
      position,
    };
    const stepValue = operation
      ? await this.requestForOperation(
        operation,
        languageClient,
        STEP_VALUE_AT_REQUEST,
        params,
      )
      : await languageClient.sendRequest(
        STEP_VALUE_AT_REQUEST,
        params,
        createCancellationToken(this.vscode),
      );
    if (stepValue === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    return valuesForStep(stepValue || this.stepTextAt(document, position) || conceptHeadingTextAt(document, position));
  }

  async localStepValueAt(document, position) {
    const stepValues = await this.localStepValuesAt(document, position);
    return stepValues[0];
  }

  async localStepValuesAt(document, position, operation) {
    if (operation && !this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    if (!document || !position) {
      return [];
    }
    if (isStepImplementationDocument(document)) {
      return this.stepImplementationValuesAt(document, position, operation);
    }
    if (isGaugeReferenceDocument(document)) {
      return valuesForStep(this.stepTextAt(document, position) || conceptHeadingTextAt(document, position));
    }
    return [];
  }

  stepTextAt(document, position) {
    return stepTextAt(document, position, {
      allowMultilineStep: this.allowsMultilineStep(document),
    });
  }

  allowsMultilineStep(document) {
    return allowMultilineStep({
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectRoot: this.diagnosticsProvider.gaugeProjectRoot(document),
    });
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

  async storeDocumentsMatching(filePatterns, includeFile, operation) {
    if (operation) {
      const ready = await this.callForOperation(
        operation,
        () => this.documentStore.whenReady(),
      );
      if (ready === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }
    } else {
      await this.documentStore.whenReady();
    }
    if (operation && !this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    const documents = [];
    for (const document of this.documentStore.documents()) {
      if (operation && !this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      const file = documentPath(document);
      if (
        !file
        || !filePatterns.some((pattern) => pattern.test(file))
        || !includeFile(file)
      ) {
        continue;
      }
      documents.push(document);
    }
    return documents;
  }

  async findWorkspaceStepImplementationDocuments(sourceRoot, operation) {
    if (this.documentStore) {
      return this.storeDocumentsMatching(
        STEP_IMPLEMENTATION_FILE_PATTERNS,
        (file) => this.shouldOpenWorkspaceStepImplementation(file, sourceRoot),
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
    for (const pattern of STEP_IMPLEMENTATION_REFERENCE_PATTERNS) {
      if (operation && !this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      let uris;
      try {
        uris = operation
          ? await this.callForOperation(operation, () => workspace.findFiles(pattern))
          : await workspace.findFiles(pattern);
      } catch (_error) {
        if (operation && !this.isOperationActive(operation)) {
          return CANCELLED_REFERENCE_OPERATION;
        }
        continue;
      }
      if (uris === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }

      for (const uri of uris || []) {
        if (operation && !this.isOperationActive(operation)) {
          return CANCELLED_REFERENCE_OPERATION;
        }
        const file = uriPath(uri);
        if (!this.shouldOpenWorkspaceStepImplementation(file, sourceRoot)) {
          continue;
        }

        try {
          const document = operation
            ? await this.callForOperation(operation, () => workspace.openTextDocument(uri))
            : await workspace.openTextDocument(uri);
          if (document === CANCELLED_REFERENCE_OPERATION) {
            return CANCELLED_REFERENCE_OPERATION;
          }
          documents.push(document);
        } catch (_error) {
          if (operation && !this.isOperationActive(operation)) {
            return CANCELLED_REFERENCE_OPERATION;
          }
          // Ignore unreadable files so one stale workspace URI does not block references.
        }
      }
    }
    return documents;
  }

  async findWorkspaceGaugeDocuments(sourceRoot, operation) {
    if (this.documentStore) {
      return this.storeDocumentsMatching(
        GAUGE_REFERENCE_FILE_PATTERNS,
        (file) => this.belongsPathToSourceGaugeProject(file, sourceRoot),
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
    for (const pattern of GAUGE_REFERENCE_PATTERNS) {
      if (operation && !this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      let uris;
      try {
        uris = operation
          ? await this.callForOperation(operation, () => workspace.findFiles(pattern))
          : await workspace.findFiles(pattern);
      } catch (_error) {
        if (operation && !this.isOperationActive(operation)) {
          return CANCELLED_REFERENCE_OPERATION;
        }
        continue;
      }
      if (uris === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }

      for (const uri of uris || []) {
        if (operation && !this.isOperationActive(operation)) {
          return CANCELLED_REFERENCE_OPERATION;
        }
        const file = uriPath(uri);
        if (!this.belongsPathToSourceGaugeProject(file, sourceRoot)) {
          continue;
        }

        try {
          const document = operation
            ? await this.callForOperation(operation, () => workspace.openTextDocument(uri))
            : await workspace.openTextDocument(uri);
          if (document === CANCELLED_REFERENCE_OPERATION) {
            return CANCELLED_REFERENCE_OPERATION;
          }
          documents.push(document);
        } catch (_error) {
          if (operation && !this.isOperationActive(operation)) {
            return CANCELLED_REFERENCE_OPERATION;
          }
          // Ignore unreadable files so one stale workspace URI does not block local references.
        }
      }
    }
    return documents;
  }

  async stepImplementationDocuments(sourceDocument, operation) {
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
    const workspaceDocuments = await this.findWorkspaceStepImplementationDocuments(
      sourceRoot,
      operation,
    );
    if (workspaceDocuments === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    for (const candidate of workspaceDocuments) {
      if (operation && !this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      addDocument(candidate);
    }
    return documents;
  }

  async kotlinStepValueAt(document, position) {
    const stepValues = await this.stepImplementationValuesAt(document, position);
    return stepValues[0];
  }

  async stepImplementationValuesAt(document, position, operation) {
    if (operation && !this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    if (
      !document
      || !isStepImplementationDocument(document)
      || typeof document.getText !== "function"
      || !position
    ) {
      return [];
    }

    const text = document.getText();
    const offset = indexedOffsetAt(document, text, position);
    const indexed = this.workspaceStepIndex
      && typeof this.workspaceStepIndex.stepEntriesForDocument === "function";
    const implementationDocuments = indexed
      ? []
      : await this.stepImplementationDocuments(document, operation);
    if (implementationDocuments === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    const externalConstants = !indexed && isStepImplementationDocument(document)
      ? this.diagnosticsProvider.collectWorkspaceConstants(document, implementationDocuments)
      : undefined;
    const entries = indexed
      ? operation
        ? await this.callForOperation(
          operation,
          () => this.workspaceStepIndex.stepEntriesForDocument(document, document),
        )
        : await this.workspaceStepIndex.stepEntriesForDocument(document, document)
      : findStepFunctionsForDocument(document, externalConstants);
    if (entries === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    for (const entry of entries) {
      const start = entry.annotationStart !== undefined ? entry.annotationStart : entry.parameterStart;
      const end = entry.declarationEnd !== undefined ? entry.declarationEnd : entry.parameterEnd;
      if (offset >= start && offset <= end) {
        if (indexed && typeof this.workspaceStepIndex.stepAliasesForEntry === "function") {
          const indexedAliases = operation
            ? await this.callForOperation(
              operation,
              () => this.workspaceStepIndex.stepAliasesForEntry(document, document, entry),
            )
            : await this.workspaceStepIndex.stepAliasesForEntry(document, document, entry);
          if (indexedAliases === CANCELLED_REFERENCE_OPERATION) {
            return CANCELLED_REFERENCE_OPERATION;
          }
          const declaredAliases = new Set(entry.aliases || []);
          return uniqueValues([
            ...aliasValuesAtOffset(entry, text, offset),
            ...indexedAliases.filter((alias) => !declaredAliases.has(alias)),
          ]);
        }
        return uniqueValues([
          ...aliasValuesAtOffset(entry, text, offset),
          ...this.superStepAliasesForEntry(document, entry, [document, ...implementationDocuments]),
        ]);
      }
    }
    return [];
  }

  superStepAliasesForEntry(document, entry, implementationDocuments) {
    return superStepAliasesForEntry(
      document,
      entry,
      implementationDocuments,
      this.diagnosticsProvider,
    );
  }

  async gaugeDocuments(sourceRoot, operation) {
    if (operation && !this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
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
    const workspaceDocuments = await this.findWorkspaceGaugeDocuments(sourceRoot, operation);
    if (workspaceDocuments === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    for (const candidate of workspaceDocuments) {
      if (operation && !this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      addDocument(candidate);
    }
    return documents;
  }

  async localStepReferences(stepValue, options = {}, operation) {
    if (operation && !this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    if (!stepValue) {
      return undefined;
    }
    const targetTemplate = normalizeReferenceStepValue(stepValue);
    if (!targetTemplate) {
      return undefined;
    }
    if (
      options.sourceDocument
      && this.workspaceStepIndex
      && typeof this.workspaceStepIndex.referenceLocations === "function"
    ) {
      const indexedLocations = operation
        ? await this.callForOperation(
          operation,
          () => this.workspaceStepIndex.referenceLocations(options.sourceDocument, targetTemplate),
        )
        : await this.workspaceStepIndex.referenceLocations(options.sourceDocument, targetTemplate);
      if (indexedLocations === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      return indexedLocations.length > 0 ? indexedLocations : undefined;
    }
    if (
      options.sourcePath
      && this.workspaceStepIndex
      && typeof this.workspaceStepIndex.referenceLocationsForPath === "function"
    ) {
      const indexedLocations = operation
        ? await this.callForOperation(
          operation,
          () => this.workspaceStepIndex.referenceLocationsForPath(options.sourcePath, targetTemplate),
        )
        : await this.workspaceStepIndex.referenceLocationsForPath(options.sourcePath, targetTemplate);
      if (indexedLocations === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      return indexedLocations.length > 0 ? indexedLocations : undefined;
    }
    const sourceRoot = this.sourceGaugeProjectRoot(options);
    const locations = [];
    const documents = await this.gaugeDocuments(sourceRoot, operation);
    if (documents === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    for (const document of documents) {
      if (operation && !this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      locations.push(...localGaugeStepReferences(document, targetTemplate, {
        allowMultilineStep: this.allowsMultilineStep(document),
      }));
    }
    return locations.length > 0 ? locations : undefined;
  }

  showReferences(locations, uri, languageClient, position) {
    return this.showReferencesForOperation(undefined, locations, uri, languageClient, position);
  }

  showReferencesForOperation(operation, locations, uri, languageClient, position) {
    if (locations) {
      if (operation && !this.isOperationActive(operation)) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      if (!operation) {
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
      const sourceUri = this.callSyncForOperation(operation, () => this.vscode.Uri.parse(uri));
      if (sourceUri === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      const convertedPosition = this.callSyncForOperation(
        operation,
        () => (
          languageClient
          && languageClient.protocol2CodeConverter
          && typeof languageClient.protocol2CodeConverter.asPosition === "function"
            ? languageClient.protocol2CodeConverter.asPosition(position)
            : position
        ),
      );
      if (convertedPosition === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      const convertedLocations = this.convertLocationsForOperation(
        operation,
        locations,
        languageClient,
      );
      if (convertedLocations === CANCELLED_REFERENCE_OPERATION) {
        return CANCELLED_REFERENCE_OPERATION;
      }
      return this.callForOperation(
        operation,
        () => this.vscode.commands.executeCommand(
          SHOW_REFERENCES,
          sourceUri,
          convertedPosition,
          convertedLocations,
        ),
      );
    }
    if (operation && !this.isOperationActive(operation)) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    if (!operation) {
      this.vscode.window.showInformationMessage("Action NA: Try this on an implementation.");
      return Promise.resolve(false);
    }
    const notification = this.callDetachedForOperation(
      operation,
      () => this.vscode.window.showInformationMessage("Action NA: Try this on an implementation."),
    );
    if (notification === CANCELLED_REFERENCE_OPERATION) {
      return CANCELLED_REFERENCE_OPERATION;
    }
    return false;
  }
}

module.exports = {
  ReferenceProvider,
  localGaugeStepReferenceEntries,
  superStepAliasesForEntry,
};
