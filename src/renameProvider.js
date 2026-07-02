"use strict";

const {
  findConceptHeadings,
  GaugeStepDiagnosticsProvider,
  findStepFunctionsForDocument,
  isConceptDocument,
  isJavaDocument,
  isKotlinDocument,
  isStepImplementationDocument,
  positionAt,
} = require("./stepDiagnostics");
const { normalizeStepTemplate } = require("./stepDefinitionProvider");
const { GaugeValidateDiagnosticsProvider } = require("./validateDiagnostics");

const GAUGE_LANGUAGE = "gauge";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_PATTERN = /\.spec$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const GAUGE_FILE_PATTERNS = ["**/*.spec", "**/*.cpt", "**/*.md"];
const JAVA_FILE_PATTERN = "**/*.java";
const KOTLIN_FILE_PATTERN = "**/*.kt";
const IMPLEMENTATION_DIAGNOSTIC_FILE_PATTERN = /\.(?:java|kts?)$/i;
const ALIASED_STEP_RENAME_ERROR = "Refactoring for steps having aliases are not supported.";
const LSP_RENAME_REQUEST = "textDocument/rename";

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

function createRangeFromOffsets(vscode, text, startOffset, endOffset) {
  return createRange(vscode, positionAt(text, startOffset), positionAt(text, endOffset));
}

function createToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
}

function createWorkspaceEdit(vscode) {
  if (typeof vscode.WorkspaceEdit === "function") {
    return new vscode.WorkspaceEdit();
  }
  const replacements = [];
  return {
    replacements,
    replace(uri, range, newText) {
      replacements.push({ uri, range, newText });
    },
  };
}

function documentPath(document) {
  return document && document.uri && document.uri.fsPath;
}

function documentUriString(vscode, document) {
  if (!document || !document.uri) {
    return undefined;
  }
  if (typeof document.uri.toString === "function") {
    const value = document.uri.toString();
    if (value && value !== "[object Object]") {
      return value;
    }
  }
  const filename = documentPath(document);
  if (!filename) {
    return undefined;
  }
  if (vscode.Uri && typeof vscode.Uri.file === "function") {
    return vscode.Uri.file(filename).toString();
  }
  return `file://${filename}`;
}

function uriFromString(vscode, value) {
  if (vscode.Uri && typeof vscode.Uri.parse === "function") {
    return vscode.Uri.parse(value);
  }
  return {
    fsPath: value && value.startsWith("file://") ? value.slice("file://".length) : value,
    toString() {
      return value;
    },
  };
}

function uriPath(uri) {
  if (!uri) {
    return undefined;
  }
  if (uri.fsPath) {
    return uri.fsPath;
  }
  if (uri.path) {
    return uri.path;
  }
  if (typeof uri === "string" && uri.startsWith("file://")) {
    return uri.slice("file://".length);
  }
  return typeof uri === "string" ? uri : undefined;
}

function documentLine(document, line) {
  if (typeof document.lineAt === "function") {
    try {
      return document.lineAt(line).text;
    } catch (_error) {
      return "";
    }
  }
  if (typeof document.getText === "function") {
    return document.getText().split(/\r?\n/)[line] || "";
  }
  return "";
}

function documentLines(document) {
  if (typeof document.getText !== "function") {
    return [];
  }
  return document.getText().split(/\r?\n/);
}

function isInlineTableLine(line) {
  return String(line || "").trimStart().startsWith("|");
}

function removeInlineTableSuffix(value) {
  return String(value || "").replace(/\s+<table>\s*$/, "").trim();
}

function withInlineTableSuffix(value) {
  return `${removeInlineTableSuffix(value)} <table>`;
}

function isEscapedAt(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findStepParameterEnd(text, start, closeCharacter) {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\" && closeCharacter === "\"") {
      index += 1;
      continue;
    }
    if (text[index] === closeCharacter && !isEscapedAt(text, index)) {
      return index;
    }
  }
  return -1;
}

function nextStepParameter(text, startIndex) {
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
    return {
      closeCharacter: ">",
      openCharacter: "<",
      start: dynamicIndex,
    };
  }
  return {
    closeCharacter: "\"",
    openCharacter: "\"",
    start: staticIndex,
  };
}

function unescapeQuotedStepParameter(value) {
  return String(value).replace(/\\(["\\])/g, "$1");
}

function specialTableParameterName(value, index) {
  return /^\s*table\s*:/.test(String(value || "")) ? `table${index + 1}` : undefined;
}

function stepParameters(text) {
  const parameters = [];
  let tableParameterCount = 0;
  let index = 0;
  while (index < text.length) {
    const parameter = nextStepParameter(text, index);
    if (!parameter) {
      break;
    }
    const end = findStepParameterEnd(text, parameter.start, parameter.closeCharacter);
    if (end === -1) {
      break;
    }
    const rawValue = text.slice(parameter.start + 1, end);
    const value = parameter.openCharacter === "\"" ? unescapeQuotedStepParameter(rawValue) : rawValue;
    const tableName = parameter.openCharacter === "<"
      ? specialTableParameterName(value, tableParameterCount)
      : undefined;
    if (tableName) {
      tableParameterCount += 1;
    }
    parameters.push({
      type: parameter.openCharacter === "\"" ? "static" : "dynamic",
      value: tableName || value,
    });
    index = end + 1;
  }
  return parameters;
}

function implementationStepName(value, hasInlineTable) {
  const text = hasInlineTable ? withInlineTableSuffix(value) : value;
  let result = "";
  let tableParameterCount = 0;
  let index = 0;
  while (index < text.length) {
    const parameter = nextStepParameter(text, index);
    if (!parameter) {
      result += text.slice(index);
      break;
    }
    const end = findStepParameterEnd(text, parameter.start, parameter.closeCharacter);
    if (end === -1) {
      result += text.slice(index);
      break;
    }
    const rawValue = text.slice(parameter.start + 1, end);
    const valueText = parameter.openCharacter === "\""
      ? unescapeQuotedStepParameter(rawValue)
      : rawValue;
    const tableName = parameter.openCharacter === "<"
      ? specialTableParameterName(valueText, tableParameterCount)
      : undefined;
    if (tableName) {
      tableParameterCount += 1;
    }
    result += `${text.slice(index, parameter.start)}<${tableName || valueText}>`;
    index = end + 1;
  }
  return result;
}

function gaugeReplacementName(value, hasInlineTable) {
  return hasInlineTable ? removeInlineTableSuffix(value) : value;
}

function kotlinReplacementName(value, hasInlineTable) {
  return implementationStepName(value, hasInlineTable);
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

function gaugeStepOnLine(vscode, document, lineNumber, lines) {
  const sourceLines = lines || documentLines(document);
  const line = (sourceLines[lineNumber] !== undefined
    ? sourceLines[lineNumber]
    : documentLine(document, lineNumber)).replace(/\r$/, "");
  const marker = line.search(/\S/);
  if (marker !== 0 || line[marker] !== "*") {
    return undefined;
  }

  let textStart = marker + 1;
  while (textStart < line.length && /\s/.test(line[textStart])) {
    textStart += 1;
  }
  const text = line.slice(textStart).trimEnd();
  if (!text) {
    return undefined;
  }
  const textEnd = textStart + text.length;
  const hasInlineTable = isInlineTableLine(sourceLines[lineNumber + 1]);
  return {
    hasInlineTable,
    engineRename: true,
    range: createRange(
      vscode,
      { line: lineNumber, character: textStart },
      { line: lineNumber, character: textEnd },
    ),
    template: normalizeStepTemplate(hasInlineTable ? `${text} <table>` : text),
    text,
  };
}

function conceptHeadingOnLine(vscode, document, lineNumber) {
  if (!isConceptDocument(document)) {
    return undefined;
  }
  for (const heading of findConceptHeadings(document.getText())) {
    if (heading.start.line !== lineNumber) {
      continue;
    }
    return {
      hasInlineTable: false,
      engineRename: false,
      range: createRange(vscode, heading.start, heading.end),
      template: heading.normalized,
      text: heading.text,
    };
  }
  return undefined;
}

function isGaugeDocument(document) {
  if (!document || typeof document.getText !== "function") {
    return false;
  }
  if (document.languageId === GAUGE_LANGUAGE) {
    return true;
  }
  if (SPEC_FILE_PATTERN.test(documentPath(document))) {
    return true;
  }
  if (CONCEPT_FILE_PATTERN.test(documentPath(document))) {
    return true;
  }
  return document.languageId === MARKDOWN_LANGUAGE
    && MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document));
}

function isImplementationDiagnosticFile(file) {
  return typeof file === "string" && IMPLEMENTATION_DIAGNOSTIC_FILE_PATTERN.test(file);
}

function diagnosticSeverityIsError(vscode, diagnostic) {
  const severity = vscode.DiagnosticSeverity && vscode.DiagnosticSeverity.Error !== undefined
    ? vscode.DiagnosticSeverity.Error
    : 0;
  return diagnostic && diagnostic.severity === severity;
}

function diagnosticEntries(vscode) {
  const getDiagnostics = vscode.languages && vscode.languages.getDiagnostics;
  if (typeof getDiagnostics !== "function") {
    return [];
  }

  const entries = [];
  const seen = new Set();
  const addEntry = (uri, diagnostics) => {
    const file = uriPath(uri);
    if (!file || seen.has(file)) {
      return;
    }
    seen.add(file);
    entries.push([uri, Array.isArray(diagnostics) ? diagnostics : []]);
  };

  const allDiagnostics = getDiagnostics();
  if (Array.isArray(allDiagnostics)) {
    for (const entry of allDiagnostics) {
      if (Array.isArray(entry)) {
        addEntry(entry[0], entry[1]);
      }
    }
  }

  const documents = (vscode.workspace && vscode.workspace.textDocuments) || [];
  for (const document of documents) {
    if (document && document.uri) {
      addEntry(document.uri, getDiagnostics(document.uri));
    }
  }
  return entries;
}

function readQuotedLiteral(text, start, limit) {
  if (text.startsWith("\"\"\"", start)) {
    const end = text.indexOf("\"\"\"", start + 3);
    if (end === -1 || end + 3 > limit) {
      return undefined;
    }
    return {
      contentEnd: end,
      contentStart: start + 3,
      raw: true,
      value: text.slice(start + 3, end),
    };
  }

  let value = "";
  for (let index = start + 1; index < limit; index += 1) {
    const character = text[index];
    if (character === "\\") {
      if (index + 1 >= limit) {
        return undefined;
      }
      value += text[index + 1];
      index += 1;
      continue;
    }
    if (character === "\"") {
      return {
        contentEnd: index,
        contentStart: start + 1,
        raw: false,
        value,
      };
    }
    value += character;
  }
  return undefined;
}

function literalAliasRange(text, entry, alias) {
  if (entry.annotationStart === undefined || entry.annotationEnd === undefined) {
    return undefined;
  }
  for (let index = entry.annotationStart; index < entry.annotationEnd; index += 1) {
    if (text[index] !== "\"") {
      continue;
    }
    const literal = readQuotedLiteral(text, index, entry.annotationEnd);
    if (!literal) {
      continue;
    }
    if (literal.value === alias) {
      return literal;
    }
    index = literal.raw ? literal.contentEnd + 2 : literal.contentEnd;
  }
  return undefined;
}

function normalizeKotlinReferenceText(value) {
  return String(value || "")
    .trim()
    .replace(/\s*\.\s*/g, ".")
    .replace(/`([^`\r\n]+)`/g, "$1");
}

function annotationConstantReferenceRanges(text, entry) {
  if (entry.annotationStart === undefined || entry.annotationEnd === undefined) {
    return [];
  }
  const references = [];
  const seen = new Set();
  const annotationText = text.slice(entry.annotationStart, entry.annotationEnd);
  const pattern = /`[^`\r\n]+`|[A-Za-z_][A-Za-z0-9_]*(?:\s*\.\s*(?:`[^`\r\n]+`|[A-Za-z_][A-Za-z0-9_]*))*/g;
  let match = pattern.exec(annotationText);
  while (match) {
    const reference = normalizeKotlinReferenceText(match[0]);
    if (reference !== "Step" && !seen.has(reference)) {
      references.push({
        end: entry.annotationStart + match.index + match[0].length,
        reference,
        start: entry.annotationStart + match.index,
      });
      seen.add(reference);
    }
    match = pattern.exec(annotationText);
  }
  return references;
}

function annotationConstantReferences(text, entry) {
  return annotationConstantReferenceRanges(text, entry).map((match) => match.reference);
}

function collectJavaPackageName(text) {
  const match = /^\s*package\s+([^;]+);/m.exec(text);
  if (!match) {
    return undefined;
  }
  const packageName = normalizeKotlinReferenceText(match[1]);
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(packageName)
    ? packageName
    : undefined;
}

function collectJavaReferenceImports(text) {
  const imports = {
    classImports: new Map(),
    staticImports: new Map(),
    staticWildcards: [],
  };
  const pattern = /^\s*import\s+(static\s+)?([^;]+);/gm;
  let match = pattern.exec(text);
  while (match) {
    const imported = normalizeKotlinReferenceText(match[2]);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\.\*)*$/.test(imported)) {
      match = pattern.exec(text);
      continue;
    }
    if (match[1]) {
      if (imported.endsWith(".*")) {
        imports.staticWildcards.push(imported.slice(0, -2));
      } else {
        const parts = imported.split(".");
        imports.staticImports.set(parts[parts.length - 1], imported);
      }
    } else if (!imported.endsWith(".*")) {
      const parts = imported.split(".");
      imports.classImports.set(parts[parts.length - 1], imported);
    }
    match = pattern.exec(text);
  }
  return imports;
}

function javaConstantReferenceTargets(sourceText, reference) {
  const normalized = normalizeKotlinReferenceText(reference);
  const parts = normalized.split(".");
  const imports = collectJavaReferenceImports(sourceText);
  if (parts.length === 1) {
    const staticImport = imports.staticImports.get(normalized);
    if (staticImport) {
      return [staticImport];
    }
    if (imports.staticWildcards.length === 1) {
      return [`${imports.staticWildcards[0]}.${normalized}`];
    }
    return [normalized];
  }
  const classImport = imports.classImports.get(parts[0]);
  if (classImport) {
    return [`${classImport}.${parts.slice(1).join(".")}`];
  }
  return [normalized];
}

function constantReferenceTargets(sourceText, reference) {
  return javaConstantReferenceTargets(sourceText, reference);
}

function findConstInitializerLiteral(text, declarationStart) {
  const equalsIndex = text.indexOf("=", declarationStart);
  if (equalsIndex === -1) {
    return undefined;
  }
  for (let index = equalsIndex + 1; index < text.length; index += 1) {
    if (text[index] === "\n" || text[index] === "\r" || text[index] === ";") {
      return undefined;
    }
    if (text[index] !== "\"") {
      continue;
    }
    return readQuotedLiteral(text, index, text.length);
  }
  return undefined;
}

function collectKotlinNamedScopes(text) {
  const scopes = [];
  const pattern = /\b(object|class|interface)\s+(`[^`\r\n]+`|[A-Za-z_][A-Za-z0-9_]*)/g;
  let match = pattern.exec(text);
  while (match) {
    const open = text.indexOf("{", pattern.lastIndex);
    if (open === -1) {
      match = pattern.exec(text);
      continue;
    }
    let depth = 0;
    let end = -1;
    for (let index = open; index < text.length; index += 1) {
      if (text[index] === "{") {
        depth += 1;
      } else if (text[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end !== -1) {
      scopes.push({
        end,
        name: normalizeKotlinReferenceText(match[2]),
        start: open + 1,
      });
      pattern.lastIndex = open + 1;
    }
    match = pattern.exec(text);
  }
  return scopes;
}

function enclosingKotlinScopePath(scopes, offset) {
  return scopes
    .filter((scope) => offset >= scope.start && offset < scope.end)
    .sort((left, right) => left.start - right.start)
    .map((scope) => scope.name);
}

function referenceMatchesConstScope(reference, scopePath, constName) {
  const parts = normalizeKotlinReferenceText(reference).split(".");
  if (parts[parts.length - 1] !== constName) {
    return false;
  }
  const containerParts = parts.slice(0, -1);
  if (containerParts.length === 0) {
    return true;
  }
  const scopedName = [...scopePath, constName].join(".");
  return scopedName === parts.slice(-scopePath.length - 1).join(".");
}

function findKotlinConstLiteralRange(vscode, document, reference, alias) {
  if (!isKotlinDocument(document) || typeof document.getText !== "function") {
    return undefined;
  }
  const text = document.getText();
  const parts = normalizeKotlinReferenceText(reference).split(".");
  const constName = parts[parts.length - 1];
  if (!constName) {
    return undefined;
  }
  const scopes = collectKotlinNamedScopes(text);
  const escapedName = constName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\bconst\\b[\\s\\S]{0,160}\\bval\\s+\`?${escapedName}\`?\\b`, "g");
  let match = pattern.exec(text);
  while (match) {
    const literal = findConstInitializerLiteral(text, pattern.lastIndex);
    if (!literal || literal.value !== alias) {
      match = pattern.exec(text);
      continue;
    }
    const scopePath = enclosingKotlinScopePath(scopes, match.index);
    if (referenceMatchesConstScope(reference, scopePath, constName)) {
      return {
        literal,
        range: createRangeFromOffsets(vscode, text, literal.contentStart, literal.contentEnd),
      };
    }
    match = pattern.exec(text);
  }
  return undefined;
}

function collectJavaNamedScopes(text) {
  const scopes = [];
  const pattern = /\b(class|interface|enum|record)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let match = pattern.exec(text);
  while (match) {
    const open = text.indexOf("{", pattern.lastIndex);
    if (open === -1) {
      match = pattern.exec(text);
      continue;
    }
    let depth = 0;
    let end = -1;
    for (let index = open; index < text.length; index += 1) {
      if (text[index] === "{") {
        depth += 1;
      } else if (text[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end !== -1) {
      scopes.push({
        end,
        name: match[2],
        start: open + 1,
      });
      pattern.lastIndex = open + 1;
    }
    match = pattern.exec(text);
  }
  return scopes;
}

function enclosingJavaScopePath(scopes, offset) {
  return scopes
    .filter((scope) => offset >= scope.start && offset < scope.end)
    .sort((left, right) => left.start - right.start)
    .map((scope) => scope.name);
}

function referenceMatchesJavaConstScope(reference, packageName, scopePath, constName) {
  const parts = normalizeKotlinReferenceText(reference).split(".");
  if (parts[parts.length - 1] !== constName) {
    return false;
  }
  const containerParts = parts.slice(0, -1);
  if (containerParts.length === 0) {
    return true;
  }
  const scopeMatches = scopePath.length > 0
    && containerParts.slice(-scopePath.length).join(".") === scopePath.join(".");
  if (!scopeMatches) {
    return false;
  }
  if (containerParts.length === scopePath.length) {
    return true;
  }
  if (!packageName) {
    return false;
  }
  return containerParts.join(".") === `${packageName}.${scopePath.join(".")}`;
}

function findJavaConstLiteralRange(vscode, document, reference, alias) {
  if (!isJavaDocument(document) || typeof document.getText !== "function") {
    return undefined;
  }
  const text = document.getText();
  const parts = normalizeKotlinReferenceText(reference).split(".");
  const constName = parts[parts.length - 1];
  if (!constName) {
    return undefined;
  }
  const scopes = collectJavaNamedScopes(text);
  const packageName = collectJavaPackageName(text);
  const escapedName = constName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\b((?:(?:public|protected|private|static|final|transient|volatile)\\s+)*)String\\s+${escapedName}\\b`,
    "g",
  );
  let match = pattern.exec(text);
  while (match) {
    const literal = findConstInitializerLiteral(text, pattern.lastIndex);
    if (!literal || literal.value !== alias) {
      match = pattern.exec(text);
      continue;
    }
    const scopePath = enclosingJavaScopePath(scopes, match.index);
    if (referenceMatchesJavaConstScope(reference, packageName, scopePath, constName)) {
      return {
        literal,
        range: createRangeFromOffsets(vscode, text, literal.contentStart, literal.contentEnd),
      };
    }
    match = pattern.exec(text);
  }
  return undefined;
}

function findConstLiteralRange(vscode, document, reference, alias) {
  return findKotlinConstLiteralRange(vscode, document, reference, alias)
    || findJavaConstLiteralRange(vscode, document, reference, alias);
}

function escapeStringContent(value) {
  return JSON.stringify(value).slice(1, -1);
}

function escapeKotlinStringContent(value) {
  return escapeStringContent(value).replace(/\$/g, () => "\\$");
}

function escapeKotlinRawStringContent(value) {
  return String(value).replace(/\$/g, () => "${'$'}");
}

function replacementForLiteral(value, literal, options = {}) {
  if (literal.raw) {
    return options.kotlin ? escapeKotlinRawStringContent(value) : value;
  }
  return options.kotlin ? escapeKotlinStringContent(value) : escapeStringContent(value);
}

function skipKotlinLineComment(text, index) {
  if (!text.startsWith("//", index)) {
    return index;
  }
  const end = text.indexOf("\n", index + 2);
  return end === -1 ? text.length : end;
}

function skipKotlinBlockComment(text, index) {
  if (!text.startsWith("/*", index)) {
    return index;
  }
  let depth = 1;
  let cursor = index + 2;
  while (cursor < text.length && depth > 0) {
    if (text.startsWith("/*", cursor)) {
      depth += 1;
      cursor += 2;
    } else if (text.startsWith("*/", cursor)) {
      depth -= 1;
      cursor += 2;
    } else {
      cursor += 1;
    }
  }
  return cursor;
}

function skipKotlinString(text, index) {
  if (text.startsWith("\"\"\"", index)) {
    const end = text.indexOf("\"\"\"", index + 3);
    return end === -1 ? text.length : end + 3;
  }
  if (text[index] !== "\"") {
    return index;
  }
  let cursor = index + 1;
  while (cursor < text.length) {
    if (text[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (text[cursor] === "\"") {
      return cursor + 1;
    }
    cursor += 1;
  }
  return text.length;
}

function splitKotlinParameterText(text) {
  const parameters = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let inBacktickIdentifier = false;
  for (let index = 0; index < text.length; index += 1) {
    if (!inBacktickIdentifier) {
      const lineCommentEnd = skipKotlinLineComment(text, index);
      if (lineCommentEnd !== index) {
        index = lineCommentEnd - 1;
        continue;
      }
      const blockCommentEnd = skipKotlinBlockComment(text, index);
      if (blockCommentEnd !== index) {
        index = blockCommentEnd - 1;
        continue;
      }
      const stringEnd = skipKotlinString(text, index);
      if (stringEnd !== index) {
        index = stringEnd - 1;
        continue;
      }
    }

    const character = text[index];
    if (character === "`") {
      inBacktickIdentifier = !inBacktickIdentifier;
      continue;
    }
    if (inBacktickIdentifier) {
      continue;
    }
    if (
      character === ","
      && parenDepth === 0
      && bracketDepth === 0
      && braceDepth === 0
      && angleDepth === 0
    ) {
      parameters.push(text.slice(start, index).trim());
      start = index + 1;
      continue;
    }
    if (character === "(") {
      parenDepth += 1;
    } else if (character === ")" && parenDepth > 0) {
      parenDepth -= 1;
    } else if (character === "[") {
      bracketDepth += 1;
    } else if (character === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (character === "{") {
      braceDepth += 1;
    } else if (character === "}" && braceDepth > 0) {
      braceDepth -= 1;
    } else if (character === "<") {
      angleDepth += 1;
    } else if (character === ">" && angleDepth > 0) {
      angleDepth -= 1;
    }
  }
  const last = text.slice(start).trim();
  if (last || parameters.length > 0) {
    parameters.push(last);
  }
  return parameters.filter((parameter) => parameter.length > 0);
}

function kotlinParameterName(parameter) {
  const cleaned = String(parameter || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\r\n]*/g, " ")
    .replace(/@\s*(?:`[^`\r\n]+`|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\([^)]*\))?/g, " ")
    .trim();
  const match = /^(?:(?:vararg|noinline|crossinline|val|var)\s+)*(`[^`\r\n]+`|[A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(cleaned);
  if (!match) {
    return undefined;
  }
  return match[1].startsWith("`") ? match[1].slice(1, -1) : match[1];
}

function upperFirst(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function generatedKotlinParameterName(value, index, usedNames) {
  const words = String(value || "").match(/[A-Za-z0-9]+/g) || [];
  let name = `arg${words.map((word) => upperFirst(word.toLowerCase())).join("")}`;
  if (name === "arg") {
    name = `arg${index}`;
  }
  let candidate = name;
  let suffix = index;
  while (usedNames.has(candidate)) {
    candidate = `${name}${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function parameterPositionMap(oldParameters, newParameters) {
  const usedOld = new Set();
  return newParameters.map((parameter) => {
    const oldIndex = oldParameters.findIndex((oldParameter, index) => (
      !usedOld.has(index) && oldParameter.value === parameter.value
    ));
    if (oldIndex !== -1) {
      usedOld.add(oldIndex);
    }
    return oldIndex;
  });
}

function hasStructuralParameterChange(oldParameters, newParameters, positions) {
  if (oldParameters.length === 0 && newParameters.length > 0) {
    return true;
  }
  if (!positions.some((oldIndex) => oldIndex !== -1)) {
    return false;
  }
  if (oldParameters.length !== newParameters.length) {
    return true;
  }
  return positions.some((oldIndex, newIndex) => oldIndex !== -1 && oldIndex !== newIndex);
}

function isKotlinFunctionStepEntry(text, entry) {
  if (entry.declarationStart === undefined || !text.startsWith("fun", entry.declarationStart)) {
    return false;
  }
  const before = text[entry.declarationStart - 1] || "";
  const after = text[entry.declarationStart + "fun".length] || "";
  return !/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after);
}

function kotlinFunctionParameterReplacement(text, entry, newName, hasInlineTable) {
  if (!isKotlinFunctionStepEntry(text, entry)) {
    return undefined;
  }
  const oldParameters = stepParameters(entry.aliases[0]);
  const newParameters = stepParameters(kotlinReplacementName(newName, hasInlineTable));
  const positions = parameterPositionMap(oldParameters, newParameters);
  if (!hasStructuralParameterChange(oldParameters, newParameters, positions)) {
    return undefined;
  }
  const currentParameters = splitKotlinParameterText(entry.parameterText || "");
  const usedNames = new Set(currentParameters.map(kotlinParameterName).filter(Boolean));
  const replacementParameters = newParameters.map((parameter, newIndex) => {
    const oldIndex = positions[newIndex];
    if (oldIndex !== -1 && currentParameters[oldIndex] !== undefined) {
      const existing = currentParameters[oldIndex].trim();
      const existingName = kotlinParameterName(existing);
      if (existingName) {
        usedNames.add(existingName);
      }
      return existing;
    }
    const generatedName = generatedKotlinParameterName(parameter.value, newIndex, usedNames);
    return `${generatedName}: Any`;
  });
  const replacement = replacementParameters.join(", ");
  return replacement === String(entry.parameterText || "").trim() ? undefined : replacement;
}

function stepEntryHasTemplate(entry, template) {
  return (entry.aliases || []).some((alias) => normalizeStepTemplate(alias) === template);
}

function uriKey(uri) {
  if (!uri) {
    return undefined;
  }
  if (uri.fsPath) {
    return uri.fsPath;
  }
  if (typeof uri.toString === "function") {
    return uri.toString();
  }
  return undefined;
}

function sameUri(left, right) {
  const leftKey = uriKey(left);
  const rightKey = uriKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function sameRange(left, right) {
  if (!left || !right || !left.start || !left.end || !right.start || !right.end) {
    return false;
  }
  return left.start.line === right.start.line
    && left.start.character === right.start.character
    && left.end.line === right.end.line
    && left.end.character === right.end.character;
}

function editHasReplacement(edit, uri, range) {
  if (!edit || !uri || !range) {
    return false;
  }
  for (const replacement of edit.replacements || []) {
    if (sameUri(replacement.uri, uri) && sameRange(replacement.range, range)) {
      return true;
    }
  }
  if (typeof edit.entries === "function") {
    for (const [entryUri, textEdits] of edit.entries()) {
      if (!sameUri(entryUri, uri)) {
        continue;
      }
      for (const textEdit of textEdits || []) {
        if (sameRange(textEdit.range, range)) {
          return true;
        }
      }
    }
  }
  return false;
}

class GaugeRenameProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.clientsMap = options.clientsMap;
    this.projectFactory = options.projectFactory;
    this.diagnosticsProvider = new GaugeStepDiagnosticsProvider({
      projectFactory: this.projectFactory,
      vscode: this.vscode,
    });
    this.validateDiagnosticsProvider = options.validateDiagnosticsProvider
      || new GaugeValidateDiagnosticsProvider({
        cli: options.cli,
        env: options.env,
        pathModule: options.pathModule,
        projectFactory: this.projectFactory,
        vscode: this.vscode,
      });
  }

  isGaugeProjectDocument(document) {
    return this.diagnosticsProvider.isGaugeProjectDocument(document);
  }

  shouldOpenWorkspaceFile(file) {
    if (
      !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return true;
    }
    return this.diagnosticsProvider.rootForFile(file) !== undefined;
  }

  async workspaceDocuments(sourceDocument) {
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || typeof candidate.getText !== "function"
        || (!isGaugeDocument(candidate) && !isStepImplementationDocument(candidate))
        || !this.isGaugeProjectDocument(candidate)
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

    if (
      typeof workspace.findFiles === "function"
      && typeof workspace.openTextDocument === "function"
    ) {
      for (const pattern of [...GAUGE_FILE_PATTERNS, KOTLIN_FILE_PATTERN, JAVA_FILE_PATTERN]) {
        let uris;
        try {
          uris = await workspace.findFiles(pattern);
        } catch (_error) {
          continue;
        }
        for (const uri of uris || []) {
          const file = uriPath(uri);
          if (file && seenPaths.has(file)) {
            continue;
          }
          if (file && !this.shouldOpenWorkspaceFile(file)) {
            continue;
          }
          try {
            addDocument(await workspace.openTextDocument(uri));
          } catch (_error) {
            // Ignore unreadable files so one stale URI does not block rename.
          }
        }
      }
    }

    addDocument(sourceDocument);
    return documents;
  }

  kotlinDocuments(documents) {
    return documents.filter((document) => isKotlinDocument(document));
  }

  stepImplementationDocuments(documents) {
    return documents.filter((document) => isStepImplementationDocument(document));
  }

  stepAtGaugePosition(document, position) {
    if (!isGaugeDocument(document) || !position) {
      return undefined;
    }
    return gaugeStepOnLine(this.vscode, document, position.line)
      || conceptHeadingOnLine(this.vscode, document, position.line);
  }

  stepAtImplementationPosition(document, position, implementationDocuments) {
    if (!isStepImplementationDocument(document) || !position || typeof document.getText !== "function") {
      return undefined;
    }
    const text = document.getText();
    const offset = offsetAt(text, position);
    let externalConstants;
    if (isStepImplementationDocument(document)) {
      try {
        externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(document, implementationDocuments);
      } catch (_error) {
        externalConstants = undefined;
      }
    }
    for (const entry of findStepFunctionsForDocument(document, externalConstants)) {
      const start = entry.annotationStart !== undefined ? entry.annotationStart : entry.parameterStart;
      const end = entry.declarationEnd !== undefined ? entry.declarationEnd : entry.parameterEnd;
      if (offset < start || offset > end) {
        continue;
      }
      if (entry.aliases.length > 1) {
        throw new Error(ALIASED_STEP_RENAME_ERROR);
      }
      if (entry.aliases.length !== 1) {
        continue;
      }
      const alias = entry.aliases[0];
      const literal = literalAliasRange(text, entry, alias);
      if (literal) {
        return {
          hasInlineTable: /\s+<table>\s*$/.test(alias),
          engineRename: false,
          range: createRangeFromOffsets(this.vscode, text, literal.contentStart, literal.contentEnd),
          template: normalizeStepTemplate(alias),
          text: alias,
        };
      }
      if (isStepImplementationDocument(document)) {
        for (const reference of annotationConstantReferenceRanges(text, entry)) {
          const targetReferences = constantReferenceTargets(text, reference.reference);
          if (implementationDocuments.some((candidate) => targetReferences.some((targetReference) => (
            findConstLiteralRange(this.vscode, candidate, targetReference, alias)
          )))) {
            return {
              hasInlineTable: /\s+<table>\s*$/.test(alias),
              engineRename: false,
              range: createRangeFromOffsets(this.vscode, text, reference.start, reference.end),
              template: normalizeStepTemplate(alias),
              text: alias,
            };
          }
        }
      }
    }
    return undefined;
  }

  async stepAt(document, position) {
    const documents = await this.workspaceDocuments(document);
    const implementationDocuments = this.stepImplementationDocuments(documents);
    return {
      documents,
      step: this.stepAtGaugePosition(document, position)
        || this.stepAtImplementationPosition(document, position, implementationDocuments),
    };
  }

  async prepareRename(document, position) {
    const { documents, step } = await this.stepAt(document, position);
    this.validateRenameTarget(documents, step);
    return step ? { range: step.range, placeholder: step.text } : undefined;
  }

  validateRenameTarget(documents, step) {
    if (!step) {
      return;
    }
    const implementationDocuments = this.stepImplementationDocuments(documents);
    for (const document of this.stepImplementationDocuments(documents)) {
      let externalConstants;
      if (isStepImplementationDocument(document)) {
        try {
          externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(document, implementationDocuments);
        } catch (_error) {
          externalConstants = undefined;
        }
      }
      for (const entry of findStepFunctionsForDocument(document, externalConstants)) {
        if (entry.aliases.length > 1 && stepEntryHasTemplate(entry, step.template)) {
          throw new Error(ALIASED_STEP_RENAME_ERROR);
        }
      }
    }
  }

  projectClientFor(document) {
    const filename = documentPath(document);
    if (!filename || !this.clientsMap || typeof this.clientsMap.get !== "function") {
      return undefined;
    }
    return this.clientsMap.get(filename);
  }

  lspWorkspaceEditToVscodeEdit(lspEdit) {
    if (!lspEdit || typeof lspEdit !== "object") {
      return undefined;
    }

    const edit = createWorkspaceEdit(this.vscode);
    const addTextEdit = (uri, textEdit) => {
      if (!uri || !textEdit || !textEdit.range) {
        return;
      }
      edit.replace(
        uriFromString(this.vscode, uri),
        createRange(this.vscode, textEdit.range.start, textEdit.range.end),
        textEdit.newText || "",
      );
    };

    for (const [uri, edits] of Object.entries(lspEdit.changes || {})) {
      for (const textEdit of edits || []) {
        addTextEdit(uri, textEdit);
      }
    }

    for (const change of lspEdit.documentChanges || []) {
      const uri = change && change.textDocument && change.textDocument.uri;
      for (const textEdit of (change && change.edits) || []) {
        addTextEdit(uri, textEdit);
      }
    }

    return edit;
  }

  async provideLanguageServerRenameEdits(document, position, newName) {
    const projectClient = this.projectClientFor(document);
    const client = projectClient && projectClient.client;
    const uri = documentUriString(this.vscode, document);
    if (!client || typeof client.sendRequest !== "function" || !uri) {
      return undefined;
    }

    const params = {
      textDocument: { uri },
      position: {
        line: position.line,
        character: position.character,
      },
      newName,
    };
    const lspEdit = await client.sendRequest(LSP_RENAME_REQUEST, params, createToken(this.vscode));
    return this.lspWorkspaceEditToVscodeEdit(lspEdit);
  }

  async preflightRename(document) {
    if (this.vscode.workspace && typeof this.vscode.workspace.saveAll === "function") {
      await this.vscode.workspace.saveAll();
    }
    if (this.hasImplementationDiagnosticErrors(document)) {
      throw new Error("Please fix all errors before refactoring.");
    }
    if (
      !this.validateDiagnosticsProvider
      || typeof this.validateDiagnosticsProvider.validateErrorsForDocument !== "function"
    ) {
      return;
    }
    const { errors } = this.validateDiagnosticsProvider.validateErrorsForDocument(document, new Map());
    if (Array.isArray(errors) && errors.length > 0) {
      throw new Error("Please fix all errors before refactoring.");
    }
  }

  hasImplementationDiagnosticErrors(document) {
    const sourceRoot = this.diagnosticsProvider.gaugeProjectRoot(document);
    for (const [uri, diagnostics] of diagnosticEntries(this.vscode)) {
      const file = uriPath(uri);
      if (!isImplementationDiagnosticFile(file)) {
        continue;
      }
      if (sourceRoot !== undefined && this.diagnosticsProvider.rootForFile(file) !== sourceRoot) {
        continue;
      }
      if (sourceRoot === undefined && this.projectFactory && !this.diagnosticsProvider.rootForFile(file)) {
        continue;
      }
      if ((diagnostics || []).some((diagnostic) => diagnosticSeverityIsError(this.vscode, diagnostic))) {
        return true;
      }
    }
    return false;
  }

  addGaugeRenames(edit, document, template, newName) {
    const lines = documentLines(document);
    for (let line = 0; line < lines.length; line += 1) {
      const step = gaugeStepOnLine(this.vscode, document, line, lines);
      if (step && step.template === template) {
        edit.replace(document.uri, step.range, gaugeReplacementName(newName, step.hasInlineTable));
      }
    }
    if (isConceptDocument(document)) {
      for (const heading of findConceptHeadings(document.getText())) {
        if (heading.normalized === template) {
          edit.replace(
            document.uri,
            createRange(this.vscode, heading.start, heading.end),
            gaugeReplacementName(newName, false),
          );
        }
      }
    }
  }

  addConstantBackedStepRenames(edit, implementationDocuments, sourceText, entry, alias, newName, hasInlineTable) {
    for (const reference of annotationConstantReferences(sourceText, entry)) {
      const targetReferences = constantReferenceTargets(sourceText, reference);
      for (const document of implementationDocuments) {
        for (const targetReference of targetReferences) {
          const constantRange = findConstLiteralRange(this.vscode, document, targetReference, alias);
          if (!constantRange || editHasReplacement(edit, document.uri, constantRange.range)) {
            continue;
          }
          edit.replace(
            document.uri,
            constantRange.range,
            replacementForLiteral(kotlinReplacementName(newName, hasInlineTable), constantRange.literal, {
              kotlin: isKotlinDocument(document),
            }),
          );
        }
      }
    }
  }

  addKotlinFunctionParameterRename(edit, document, text, entry, newName, hasInlineTable) {
    if (!isKotlinDocument(document) || entry.parameterStart === undefined || entry.parameterEnd === undefined) {
      return;
    }
    const replacement = kotlinFunctionParameterReplacement(text, entry, newName, hasInlineTable);
    if (replacement === undefined) {
      return;
    }
    const range = createRangeFromOffsets(this.vscode, text, entry.parameterStart, entry.parameterEnd);
    if (editHasReplacement(edit, document.uri, range)) {
      return;
    }
    edit.replace(document.uri, range, replacement);
  }

  addStepImplementationRenames(edit, document, implementationDocuments, template, newName, hasInlineTable) {
    const text = document.getText();
    let externalConstants;
    const kotlinDocument = isKotlinDocument(document);
    if (isStepImplementationDocument(document)) {
      try {
        externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(document, implementationDocuments);
      } catch (_error) {
        externalConstants = undefined;
      }
    }
    for (const entry of findStepFunctionsForDocument(document, externalConstants)) {
      if (entry.aliases.length !== 1 || normalizeStepTemplate(entry.aliases[0]) !== template) {
        continue;
      }
      const literal = literalAliasRange(text, entry, entry.aliases[0]);
      if (!literal) {
        if (isStepImplementationDocument(document)) {
          this.addConstantBackedStepRenames(
            edit,
            implementationDocuments,
            text,
            entry,
            entry.aliases[0],
            newName,
            hasInlineTable,
          );
        }
        this.addKotlinFunctionParameterRename(edit, document, text, entry, newName, hasInlineTable);
        continue;
      }
      const range = createRangeFromOffsets(this.vscode, text, literal.contentStart, literal.contentEnd);
      if (editHasReplacement(edit, document.uri, range)) {
        this.addKotlinFunctionParameterRename(edit, document, text, entry, newName, hasInlineTable);
        continue;
      }
      edit.replace(
        document.uri,
        range,
        replacementForLiteral(kotlinReplacementName(newName, hasInlineTable), literal, {
          kotlin: kotlinDocument,
        }),
      );
      this.addKotlinFunctionParameterRename(edit, document, text, entry, newName, hasInlineTable);
    }
  }

  async provideRenameEdits(document, position, newName) {
    const { documents, step } = await this.stepAt(document, position);
    if (!step) {
      return undefined;
    }
    this.validateRenameTarget(documents, step);
    await this.preflightRename(document);
    if (step.engineRename) {
      const languageServerEdit = await this.provideLanguageServerRenameEdits(document, position, newName);
      if (languageServerEdit) {
        const implementationDocuments = this.stepImplementationDocuments(documents);
        for (const candidate of this.stepImplementationDocuments(documents)) {
          this.addStepImplementationRenames(
            languageServerEdit,
            candidate,
            implementationDocuments,
            step.template,
            newName,
            step.hasInlineTable,
          );
        }
        return languageServerEdit;
      }
    }

    const edit = createWorkspaceEdit(this.vscode);
    const implementationDocuments = this.stepImplementationDocuments(documents);
    for (const candidate of documents) {
      if (isGaugeDocument(candidate)) {
        this.addGaugeRenames(edit, candidate, step.template, newName);
      } else if (isStepImplementationDocument(candidate)) {
        this.addStepImplementationRenames(
          edit,
          candidate,
          implementationDocuments,
          step.template,
          newName,
          step.hasInlineTable,
        );
      }
    }
    return edit;
  }

  register() {
    if (!this.vscode.languages || typeof this.vscode.languages.registerRenameProvider !== "function") {
      return { dispose() {} };
    }
    return this.vscode.languages.registerRenameProvider(
      [
        { language: GAUGE_LANGUAGE },
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
}

module.exports = {
  GaugeRenameProvider,
};
