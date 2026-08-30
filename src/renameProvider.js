"use strict";

const { offsetAt: indexedOffsetAt } = require("./documentPosition");
const {
  isGaugeDataTableKeywordLine,
  isGaugeTableRowLine,
  isGaugeTagKeywordLine,
} = require("./gaugeHeadings");
const { annotationStepTemplate } = require("./gaugeStepValue");

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
const {
  allowMultilineStep,
  normalizeStepTemplate,
} = require("./stepDefinitionProvider");
const { GaugeValidateDiagnosticsProvider } = require("./validateDiagnostics");
const { isMarkdownGaugeSpecFile } = require("./gaugeSpecScope");

const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_PATTERN = /\.spec$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const GAUGE_FILE_PATTERNS = ["**/*.spec", "**/*.cpt", "**/*.md"];
const JAVA_FILE_PATTERN = "**/*.java";
const KOTLIN_FILE_PATTERN = "**/*.kt";
const WORKSPACE_SCAN_FILE_PATTERNS = [
  SPEC_FILE_PATTERN,
  CONCEPT_FILE_PATTERN,
  MARKDOWN_SPEC_FILE_PATTERN,
  /\.kt$/i,
  /\.java$/i,
];
const ALIASED_STEP_RENAME_ERROR = "Refactoring for steps having aliases are not supported.";
// references/gauge-java .../refactor/JavaRefactoring.java.
const DUPLICATE_STEP_RENAME_ERROR = "Duplicate step implementation found.";
const PRE_REFACTOR_ERRORS_MESSAGE = "Please fix all errors before refactoring.";
const LSP_RENAME_REQUEST = "textDocument/rename";
const CANCELLED_RENAME_OPERATION = Symbol("cancelled rename operation");

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

function createRangeFromOffsets(vscode, text, startOffset, endOffset, document) {
  return createRange(
    vscode,
    positionAt(text, startOffset, document),
    positionAt(text, endOffset, document),
  );
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

function validateErrors(result) {
  if (Array.isArray(result)) {
    return result;
  }
  return (result && result.errors) || [];
}

function isBlockingValidateError(error) {
  const type = String((error && error.type) || "").replace(/^\[|\]$/g, "").toLowerCase();
  return type !== "parsewarning";
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
  const text = String(line || "").trim();
  return isGaugeTableRowLine(text);
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
    return isInlineTableLine(text) ? index : undefined;
  }
  return undefined;
}


function isDocStringFenceLine(line) {
  return String(line || "").trim() === "\"\"\"";
}

function isStepLine(line) {
  const text = String(line || "");
  const marker = text.search(/\S/);
  return marker !== -1 && text[marker] === "*" && text[marker + 1] !== "*";
}

function closedDocStringLines(lines) {
  const result = new Set();
  for (let stepLine = 0; stepLine < lines.length; stepLine += 1) {
    if (!isStepLine(lines[stepLine])) {
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
    || /^_{3,}\s*$/.test(text);
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

function implementationStepName(value, hasInlineTable, options = {}) {
  const text = hasInlineTable ? withInlineTableSuffix(value) : value;
  const oldParameters = stepParameters(options.oldName || "");
  const implementationParameters = stepParameters(options.implementationAlias || "");
  const usedOldParameterIndexes = new Set();
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
    let replacementValue = tableName || valueText;
    if (!tableName && parameter.openCharacter === "\"") {
      const oldIndex = oldParameters.findIndex((oldParameter, candidateIndex) => (
        !usedOldParameterIndexes.has(candidateIndex) && oldParameter.value === valueText
      ));
      if (oldIndex !== -1 && implementationParameters[oldIndex]) {
        usedOldParameterIndexes.add(oldIndex);
        replacementValue = implementationParameters[oldIndex].value;
      }
    }
    result += `${text.slice(index, parameter.start)}<${replacementValue}>`;
    index = end + 1;
  }
  return result;
}

// The verbatim source of every parameter slot, delimiters and escaping intact,
// so a usage's own argument can be spliced into the new text unchanged.
function stepParameterSlots(text) {
  const slots = [];
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
    slots.push({
      start: parameter.start,
      end,
      raw: text.slice(parameter.start, end + 1),
    });
    index = end + 1;
  }
  return slots;
}

// references/gauge/refactor/refactor.go createOrderOfArgs: for each parameter of
// the NEW step, the index of the identical parameter in the OLD step, or -1.
// Matching is by the parameter's own text, and each old parameter is claimed
// once so a repeated name does not map twice.
function createOrderOfArgs(oldName, newName) {
  const oldSlots = stepParameterSlots(oldName);
  const claimed = new Set();
  return stepParameterSlots(newName).map((slot) => {
    const index = oldSlots.findIndex((candidate, candidateIndex) => (
      !claimed.has(candidateIndex) && candidate.raw === slot.raw
    ));
    if (index !== -1) {
      claimed.add(index);
    }
    return index;
  });
}

// references/gauge/gauge/step.go getArgsInOrder: each usage keeps the argument it
// already had, moved to wherever that parameter now sits. A parameter with no
// counterpart in the old step keeps whatever the user typed. Writing the typed
// text over every usage instead discarded each usage's arguments: a static
// "gauge" became the template's <word>, which the parser then cannot resolve,
// and a table-driven usage lost its binding to its own columns.
// A parameter with no counterpart in the old step gets a FRESH argument, and
// getArgsInOrder builds it in three steps: Static with the parameter's own name
// as the value; overridden to the special form when the parameter is a
// <file:...> or <table:...>; overridden to Dynamic when the step resolves to a
// concept, whose usage supplies its heading's parameters by name.
//
// Probed with the real refactorer plus formatter.FormatStep:
//   "... vowels." -> "... vowels in <language>."  over a static usage
//     orderMap {0:0, 1:1, 2:-1}  ->  * The word "gauge" has "3" vowels in "language".
//   "read" -> "read <file:nope.txt>"
//     orderMap {0:-1}            ->  * read "file:nope.txt"
// Leaving "<language>" behind made the specification stop parsing, because a
// dynamic parameter with nothing to resolve against is an error.
function freshArgumentFor(slotRaw, isConcept) {
  const name = slotRaw.slice(1, -1);
  if (isConcept || /^\s*(file|table)\s*:/i.test(name)) {
    return slotRaw;
  }
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

// DELIBERATE DIVERGENCE, and the only one here. Gauge matches parameters by
// exact text, so it cannot tell a RENAMED parameter from a NEW one: probed,
// renaming "Pay with <amount>" to "Pay with <value>" gives orderMap {0:-1} and
// rewrites `* Pay with <amount>` as `* Pay with "value"`, destroying the binding.
// This extension can tell them apart, and already does - it renames the Kotlin
// method parameter to match. So a slot that still sits within the old step's
// parameter count is a rename and keeps the dynamic form; only a slot BEYOND
// that count is genuinely new and gets Gauge's static argument.
function gaugeUsageReplacementName(newName, usageText, orderMap, isConcept, oldParameterCount) {
  if (!usageText || !orderMap || orderMap.length === 0) {
    return newName;
  }
  const usageSlots = stepParameterSlots(usageText);
  const newSlots = stepParameterSlots(newName);
  if (newSlots.length !== orderMap.length) {
    return newName;
  }
  let result = "";
  let index = 0;
  for (let slot = 0; slot < newSlots.length; slot += 1) {
    const source = orderMap[slot];
    let replacement;
    if (source !== -1 && usageSlots[source]) {
      replacement = usageSlots[source].raw;
    } else if (slot < oldParameterCount) {
      replacement = newSlots[slot].raw;
    } else {
      replacement = freshArgumentFor(newSlots[slot].raw, isConcept);
    }
    result += newName.slice(index, newSlots[slot].start) + replacement;
    index = newSlots[slot].end + 1;
  }
  return result + newName.slice(index);
}

// A concept heading's trailing parameter can be supplied by the usage's inline
// table, and Extract to Concept names it "<table1>" rather than "<table>". The
// usage carries no slot for it, so writing the heading's text over the usage
// left a dangling dynamic parameter that stops the specification parsing. Drop
// exactly as many trailing parameters as the usage does not have slots for -
// the mirror of removeTableParameters in src/extractConcept.js, and of Gauge's
// own LSP, which appends " <table>" from the other side
// (references/gauge/api/lang/rename.go getNewStepName).
function removeTableBackedParameters(value, usageText) {
  const slots = stepParameterSlots(value);
  const wanted = stepParameterSlots(usageText || "").length;
  if (slots.length <= wanted) {
    return value;
  }
  let text = value;
  for (let index = slots.length - 1; index >= wanted; index -= 1) {
    let start = slots[index].start;
    while (start > 0 && /\s/.test(text[start - 1])) {
      start -= 1;
    }
    text = `${text.slice(0, start)}${text.slice(slots[index].end + 1)}`;
  }
  return text.trim();
}

function gaugeReplacementName(value, hasInlineTable, options = {}) {
  let text = hasInlineTable ? removeInlineTableSuffix(value) : value;
  if (hasInlineTable && options.usageText !== undefined) {
    text = removeTableBackedParameters(text, options.usageText);
  }
  if (!options.orderMap || !options.usageText) {
    return text;
  }
  return gaugeUsageReplacementName(
    text,
    options.usageText,
    options.orderMap,
    options.isConcept,
    options.oldParameterCount,
  );
}

function kotlinReplacementName(value, hasInlineTable, options = {}) {
  return implementationStepName(value, hasInlineTable, options);
}

function multilineStepStartLine(lines, lineNumber) {
  for (let currentLine = lineNumber; currentLine >= 0; currentLine -= 1) {
    const line = String(lines[currentLine] || "").replace(/\r$/, "");
    if (isStepLine(line)) {
      return currentLine;
    }
    if (isGaugeSyntaxBoundary(line)) {
      return undefined;
    }
  }
  return undefined;
}

function logicalStepEndLine(lines, lineNumber, allowMultiline) {
  if (!allowMultiline) {
    return lineNumber;
  }
  let endLine = lineNumber;
  for (let nextLine = lineNumber + 1; nextLine < lines.length; nextLine += 1) {
    const nextText = String(lines[nextLine] || "").replace(/\r$/, "");
    if (isGaugeSyntaxBoundary(nextText)) {
      break;
    }
    endLine = nextLine;
  }
  return endLine;
}

function logicalStepText(lines, lineNumber, textStart, endLine) {
  const parts = [String(lines[lineNumber] || "").replace(/\r$/, "").slice(textStart).trim()];
  for (let currentLine = lineNumber + 1; currentLine <= endLine; currentLine += 1) {
    parts.push(String(lines[currentLine] || "").replace(/\r$/, "").trim());
  }
  return parts.join(" ").trim();
}

function lineTrimEndLength(line) {
  return String(line || "").replace(/\r$/, "").trimEnd().length;
}

function gaugeStepOnLine(vscode, document, lineNumber, lines, options = {}) {
  const sourceLines = lines || documentLines(document);
  const docStringLines = options.docStringLines || closedDocStringLines(sourceLines);
  if (docStringLines.has(lineNumber)) {
    return undefined;
  }
  const startLine = options.allowMultilineStep && !isStepLine(sourceLines[lineNumber])
    ? multilineStepStartLine(sourceLines, lineNumber)
    : lineNumber;
  if (startLine === undefined) {
    return undefined;
  }
  const line = (sourceLines[startLine] !== undefined
    ? sourceLines[startLine]
    : documentLine(document, startLine)).replace(/\r$/, "");
  const marker = line.search(/\S/);
  // references/gauge/parser/lex.go isStep requires text[1] != '*', so a Markdown
  // bold line is a comment. Without this F2 offered to rename it and rewrote the
  // comment into a step.
  if (marker === -1 || line[marker] !== "*" || line[marker + 1] === "*") {
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
  const endLine = logicalStepEndLine(sourceLines, startLine, options.allowMultilineStep);
  const stepText = endLine === startLine ? text : logicalStepText(sourceLines, startLine, textStart, endLine);
  const textEnd = endLine === startLine
    ? textStart + text.length
    : lineTrimEndLength(sourceLines[endLine]);
  const hasInlineTable = inlineTableLineAfterStep(sourceLines, endLine) !== undefined;
  const template = normalizeStepTemplate(hasInlineTable ? `${stepText} <table>` : stepText);
  if (!template) {
    return undefined;
  }
  return {
    hasInlineTable,
    engineRename: true,
    range: createRange(
      vscode,
      { line: startLine, character: textStart },
      { line: endLine, character: textEnd },
    ),
    template,
    text: stepText,
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
    if (!heading.normalized) {
      return undefined;
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
  if (document.languageId === GAUGE_LANGUAGE || document.languageId === GAUGE_CONCEPT_LANGUAGE) {
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
        range: createRangeFromOffsets(vscode, text, literal.contentStart, literal.contentEnd, document),
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
        range: createRangeFromOffsets(vscode, text, literal.contentStart, literal.contentEnd, document),
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

function javaParameterName(parameter) {
  const cleaned = String(parameter || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\r\n]*/g, " ")
    .replace(/@\s*(?:[A-Za-z_$][A-Za-z0-9_$]*\s*\.\s*)*[A-Za-z_$][A-Za-z0-9_$]*(?:\s*\([^)]*\))?/g, " ")
    .trim();
  const match = /([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\[\s*\])*\s*$/.exec(cleaned);
  return match ? match[1] : undefined;
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
  if (oldParameters.length > 0 && newParameters.length === 0) {
    return true;
  }
  if (positions.some((oldIndex) => oldIndex === -1)) {
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

function kotlinFunctionParameterReplacement(text, entry, newName, hasInlineTable, oldName) {
  if (!isKotlinFunctionStepEntry(text, entry)) {
    return undefined;
  }
  const oldParameters = stepParameters(entry.aliases[0]);
  const newParameters = stepParameters(kotlinReplacementName(newName, hasInlineTable, {
    implementationAlias: entry.aliases[0],
    oldName,
  }));
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

function javaFunctionParameterReplacement(entry, newName, hasInlineTable, oldName) {
  const oldParameters = stepParameters(entry.aliases[0]);
  const newParameters = stepParameters(implementationStepName(newName, hasInlineTable, {
    implementationAlias: entry.aliases[0],
    oldName,
  }));
  const positions = parameterPositionMap(oldParameters, newParameters);
  if (!hasStructuralParameterChange(oldParameters, newParameters, positions)) {
    return undefined;
  }
  const currentParameters = splitKotlinParameterText(entry.parameterText || "");
  const usedNames = new Set(currentParameters.map(javaParameterName).filter(Boolean));
  const replacementParameters = newParameters.map((parameter, newIndex) => {
    const oldIndex = positions[newIndex];
    if (oldIndex !== -1 && currentParameters[oldIndex] !== undefined) {
      const existing = currentParameters[oldIndex].trim();
      const existingName = javaParameterName(existing);
      if (existingName) {
        usedNames.add(existingName);
      }
      return existing;
    }
    const generatedName = generatedKotlinParameterName(parameter.value, newIndex, usedNames);
    return `Object ${generatedName}`;
  });
  const replacement = replacementParameters.join(", ");
  return replacement === String(entry.parameterText || "").trim() ? undefined : replacement;
}

function stepEntryHasTemplate(entry, template) {
  if (!template) {
    return false;
  }
  return (entry.aliases || []).some((alias) => {
    const normalized = annotationStepTemplate(alias);
    return normalized && normalized === template;
  });
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
    this.documentStore = options.documentStore;
    this.workspaceStepIndex = options.workspaceStepIndex;
    this.diagnosticsProvider = options.diagnosticsProvider
      || (this.workspaceStepIndex && this.workspaceStepIndex.diagnosticsProvider)
      || new GaugeStepDiagnosticsProvider({
        documentStore: this.documentStore,
        projectFactory: this.projectFactory,
        vscode: this.vscode,
      });
    this.validateDiagnosticsProvider = options.validateDiagnosticsProvider
      || new GaugeValidateDiagnosticsProvider({
        cli: options.cli,
        projectFactory: this.projectFactory,
        vscode: this.vscode,
      });
    this.disposed = false;
    this.activeOperations = new Set();
    this.registrationDisposable = undefined;
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
      fileSystem: undefined,
      pathModule: undefined,
      projectFactory: this.projectFactory,
    });
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
      registration.dispose();
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
      hostCancellationDisposable: undefined,
      resolveCancellation,
      sources: new Set(),
    };
    this.activeOperations.add(operation);
    return operation;
  }

  isOperationActive(operation) {
    return !this.disposed && (!operation || operation.active);
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
        // Host cleanup cannot reactivate a terminal rename operation.
      }
    }
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
        // Host listener cleanup cannot reactivate a completed operation.
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
    operation.resolveCancellation(CANCELLED_RENAME_OPERATION);
    this.disposeHostCancellation(operation);
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
    this.disposeHostCancellation(operation);
    for (const source of sources) {
      this.disposeRequestSource(source, false);
    }
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
        // The operation settled while the host registered the listener.
      }
    }
    if (token.isCancellationRequested && this.isOperationActive(operation)) {
      this.cancelOperation(operation);
    }
    return this.isOperationActive(operation);
  }

  runOperation(token, callback) {
    const operation = this.createOperation();
    if (!operation) {
      return Promise.resolve(undefined);
    }
    let workflow;
    try {
      workflow = this.linkOperationCancellation(operation, token)
        ? Promise.resolve(callback(operation))
        : Promise.resolve(CANCELLED_RENAME_OPERATION);
    } catch (error) {
      workflow = Promise.reject(error);
    }
    return Promise.race([workflow, operation.cancellation])
      .then((value) => value === CANCELLED_RENAME_OPERATION ? undefined : value)
      .finally(() => this.finishOperation(operation));
  }

  callSyncForOperation(operation, callback) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_RENAME_OPERATION;
    }
    try {
      const value = callback();
      return this.isOperationActive(operation) ? value : CANCELLED_RENAME_OPERATION;
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_RENAME_OPERATION;
      }
      throw error;
    }
  }

  async callForOperation(operation, callback) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_RENAME_OPERATION;
    }
    let result;
    try {
      result = callback();
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_RENAME_OPERATION;
      }
      throw error;
    }
    const observed = Promise.resolve(result);
    if (!this.isOperationActive(operation)) {
      observed.catch(() => {});
      return CANCELLED_RENAME_OPERATION;
    }
    try {
      const value = operation
        ? await Promise.race([observed, operation.cancellation])
        : await observed;
      return this.isOperationActive(operation) ? value : CANCELLED_RENAME_OPERATION;
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_RENAME_OPERATION;
      }
      throw error;
    }
  }

  createRequestSource(operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_RENAME_OPERATION;
    }
    if (typeof this.vscode.CancellationTokenSource !== "function") {
      return undefined;
    }
    let source;
    try {
      source = new this.vscode.CancellationTokenSource();
    } catch (error) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_RENAME_OPERATION;
      }
      throw error;
    }
    if (!this.isOperationActive(operation)) {
      this.disposeRequestSource(source, true);
      return CANCELLED_RENAME_OPERATION;
    }
    operation.sources.add(source);
    return source;
  }

  releaseRequestSource(operation, source) {
    if (source && operation.sources.delete(source)) {
      this.disposeRequestSource(source, false);
    }
  }

  isGaugeProjectDocument(document) {
    return this.diagnosticsProvider.isGaugeProjectDocument(document);
  }

  shouldOpenWorkspaceFile(file, sourceRoot) {
    if (
      !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return true;
    }
    const root = this.diagnosticsProvider.rootForFile(file);
    return sourceRoot === undefined ? root !== undefined : root === sourceRoot;
  }

  allowsMultilineStep(document) {
    return allowMultilineStep({
      fileSystem: this.diagnosticsProvider.fileSystem,
      pathModule: this.diagnosticsProvider.pathModule,
      projectRoot: this.diagnosticsProvider.gaugeProjectRoot(document),
    });
  }

  async workspaceDocuments(sourceDocument, operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_RENAME_OPERATION;
    }
    if (
      this.workspaceStepIndex
      && typeof this.workspaceStepIndex.documentsFor === "function"
    ) {
      return this.callForOperation(
        operation,
        () => this.workspaceStepIndex.documentsFor(sourceDocument),
      );
    }
    const workspace = this.vscode.workspace || {};
    const sourceRoot = this.diagnosticsProvider.gaugeProjectRoot(sourceDocument);
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !this.isOperationActive(operation)
        ||
        !candidate
        || typeof candidate.getText !== "function"
        || (!isGaugeDocument(candidate) && !isStepImplementationDocument(candidate))
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

    if (this.documentStore) {
      const ready = await this.callForOperation(
        operation,
        () => this.documentStore.whenReady(),
      );
      if (ready === CANCELLED_RENAME_OPERATION) {
        return CANCELLED_RENAME_OPERATION;
      }
      const storedDocuments = this.callSyncForOperation(
        operation,
        () => this.documentStore.documents(),
      );
      if (storedDocuments === CANCELLED_RENAME_OPERATION) {
        return CANCELLED_RENAME_OPERATION;
      }
      for (const candidate of storedDocuments) {
        if (!this.isOperationActive(operation)) {
          return CANCELLED_RENAME_OPERATION;
        }
        const file = documentPath(candidate);
        if (
          !file
          || seenPaths.has(file)
          || !WORKSPACE_SCAN_FILE_PATTERNS.some((pattern) => pattern.test(file))
          || !this.shouldOpenWorkspaceFile(file, sourceRoot)
        ) {
          continue;
        }
        addDocument(candidate);
      }
    } else if (
      typeof workspace.findFiles === "function"
      && typeof workspace.openTextDocument === "function"
    ) {
      for (const pattern of [...GAUGE_FILE_PATTERNS, KOTLIN_FILE_PATTERN, JAVA_FILE_PATTERN]) {
        let uris;
        try {
          uris = await this.callForOperation(operation, () => workspace.findFiles(pattern));
        } catch (_error) {
          if (!this.isOperationActive(operation)) {
            return CANCELLED_RENAME_OPERATION;
          }
          continue;
        }
        if (uris === CANCELLED_RENAME_OPERATION) {
          return CANCELLED_RENAME_OPERATION;
        }
        for (const uri of uris || []) {
          if (!this.isOperationActive(operation)) {
            return CANCELLED_RENAME_OPERATION;
          }
          const file = uriPath(uri);
          if (file && seenPaths.has(file)) {
            continue;
          }
          if (file && !this.shouldOpenWorkspaceFile(file, sourceRoot)) {
            continue;
          }
          try {
            const opened = await this.callForOperation(
              operation,
              () => workspace.openTextDocument(uri),
            );
            if (opened === CANCELLED_RENAME_OPERATION) {
              return CANCELLED_RENAME_OPERATION;
            }
            addDocument(opened);
          } catch (_error) {
            if (!this.isOperationActive(operation)) {
              return CANCELLED_RENAME_OPERATION;
            }
            // Ignore unreadable files so one stale URI does not block rename.
          }
        }
      }
    }

    addDocument(sourceDocument);
    return this.isOperationActive(operation) ? documents : CANCELLED_RENAME_OPERATION;
  }

  kotlinDocuments(documents) {
    return documents.filter((document) => isKotlinDocument(document));
  }

  stepImplementationDocuments(documents) {
    return documents.filter((document) => isStepImplementationDocument(document));
  }

  async stepEntriesFor(sourceDocument, document, implementationDocuments, operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_RENAME_OPERATION;
    }
    if (
      this.workspaceStepIndex
      && typeof this.workspaceStepIndex.stepEntriesForDocument === "function"
    ) {
      return this.callForOperation(
        operation,
        () => this.workspaceStepIndex.stepEntriesForDocument(sourceDocument, document),
      );
    }
    let externalConstants;
    if (isStepImplementationDocument(document)) {
      try {
        externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(
          document,
          implementationDocuments,
        );
      } catch (_error) {
        externalConstants = undefined;
      }
    }
    return this.callSyncForOperation(
      operation,
      () => findStepFunctionsForDocument(document, externalConstants),
    );
  }

  stepAtGaugePosition(document, position) {
    if (!isGaugeDocument(document) || !position) {
      return undefined;
    }
    return gaugeStepOnLine(this.vscode, document, position.line, undefined, {
      allowMultilineStep: this.allowsMultilineStep(document),
    })
      || conceptHeadingOnLine(this.vscode, document, position.line);
  }

  stepAtImplementationPosition(document, position, implementationDocuments, stepEntries) {
    if (!isStepImplementationDocument(document) || !position || typeof document.getText !== "function") {
      return undefined;
    }
    const text = document.getText();
    const offset = indexedOffsetAt(document, text, position);
    for (const entry of stepEntries || []) {
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
      const template = annotationStepTemplate(alias);
      if (!template) {
        continue;
      }
      const literal = literalAliasRange(text, entry, alias);
      if (literal) {
        return {
          hasInlineTable: /\s+<table>\s*$/.test(alias),
          engineRename: false,
          range: createRangeFromOffsets(
            this.vscode,
            text,
            literal.contentStart,
            literal.contentEnd,
            document,
          ),
          template,
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
              range: createRangeFromOffsets(
                this.vscode,
                text,
                reference.start,
                reference.end,
                document,
              ),
              template,
              text: alias,
            };
          }
        }
      }
    }
    return undefined;
  }

  async stepAt(document, position, operation) {
    const documents = await this.workspaceDocuments(document, operation);
    if (documents === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    const implementationDocuments = this.stepImplementationDocuments(documents);
    const stepEntries = isStepImplementationDocument(document)
      ? await this.stepEntriesFor(document, document, implementationDocuments, operation)
      : [];
    if (stepEntries === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    return this.callSyncForOperation(operation, () => ({
      documents,
      step: this.stepAtGaugePosition(document, position)
          || this.stepAtImplementationPosition(
            document,
            position,
            implementationDocuments,
            stepEntries,
          ),
    }));
  }

  prepareRename(document, position, token) {
    if (!this.isMarkdownDocumentInScope(document)) {
      return undefined;
    }
    return this.runOperation(
      token,
      (operation) => this.prepareRenameForOperation(operation, document, position),
    );
  }

  async prepareRenameForOperation(operation, document, position) {
    const target = await this.stepAt(document, position, operation);
    if (target === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    const validated = await this.validateRenameTarget(
      document,
      target.documents,
      target.step,
      operation,
    );
    if (validated === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    return this.callSyncForOperation(
      operation,
      () => target.step ? { range: target.step.range, placeholder: target.step.text } : undefined,
    );
  }

  // Reports whether the step is backed by a source implementation. Gauge renames
  // a concept itself, but it delegates a step implementation rename to the
  // runner, and gauge-java refactors Java sources with JavaParser against a
  // runtime step registry. It cannot rewrite a Kotlin `@Step` function, so a
  // source-backed step is renamed locally instead of through the engine.
  async validateRenameTarget(sourceDocument, documents, step, operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_RENAME_OPERATION;
    }
    if (!step) {
      return { sourceImplemented: false };
    }
    const implementationDocuments = this.stepImplementationDocuments(documents);
    let sourceImplemented = false;
    // gauge-java refuses to refactor a step with more than one implementation
    // (references/gauge-java .../refactor/JavaRefactoring.java answers
    // "Duplicate step implementation found." when
    // registry.hasMultipleImplementations is true), the same guard it applies to
    // aliases. Count distinct annotation sites so a document reaching the scan
    // twice stays single.
    const sites = new Set();
    for (const document of implementationDocuments) {
      const entries = await this.stepEntriesFor(
        sourceDocument,
        document,
        implementationDocuments,
        operation,
      );
      if (entries === CANCELLED_RENAME_OPERATION) {
        return CANCELLED_RENAME_OPERATION;
      }
      const file = documentPath(document) || "";
      for (const entry of entries) {
        if (!stepEntryHasTemplate(entry, step.template)) {
          continue;
        }
        if (entry.aliases.length > 1) {
          throw new Error(ALIASED_STEP_RENAME_ERROR);
        }
        sites.add(`${file}:${entry.annotationStart}`);
        if (sites.size > 1) {
          throw new Error(DUPLICATE_STEP_RENAME_ERROR);
        }
        sourceImplemented = true;
      }
    }
    return this.isOperationActive(operation)
      ? { sourceImplemented }
      : CANCELLED_RENAME_OPERATION;
  }

  projectClientFor(document) {
    const filename = documentPath(document);
    if (!filename || !this.clientsMap || typeof this.clientsMap.get !== "function") {
      return undefined;
    }
    return this.clientsMap.get(filename);
  }

  lspWorkspaceEditToVscodeEdit(lspEdit, operation) {
    if (!lspEdit || typeof lspEdit !== "object") {
      return undefined;
    }

    const edit = this.callSyncForOperation(operation, () => createWorkspaceEdit(this.vscode));
    if (edit === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    const addTextEdit = (uri, textEdit) => {
      if (!uri || !textEdit || !textEdit.range) {
        return true;
      }
      const replaced = this.callSyncForOperation(
        operation,
        () => edit.replace(
          uriFromString(this.vscode, uri),
          createRange(this.vscode, textEdit.range.start, textEdit.range.end),
          textEdit.newText || "",
        ),
      );
      return replaced !== CANCELLED_RENAME_OPERATION;
    };

    for (const [uri, edits] of Object.entries(lspEdit.changes || {})) {
      for (const textEdit of edits || []) {
        if (!addTextEdit(uri, textEdit)) {
          return CANCELLED_RENAME_OPERATION;
        }
      }
    }

    for (const change of lspEdit.documentChanges || []) {
      const uri = change && change.textDocument && change.textDocument.uri;
      for (const textEdit of (change && change.edits) || []) {
        if (!addTextEdit(uri, textEdit)) {
          return CANCELLED_RENAME_OPERATION;
        }
      }
    }

    return this.isOperationActive(operation) ? edit : CANCELLED_RENAME_OPERATION;
  }

  async provideLanguageServerRenameEdits(document, position, newName, operation) {
    const projectClient = this.callSyncForOperation(
      operation,
      () => this.projectClientFor(document),
    );
    if (projectClient === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    const client = projectClient && projectClient.client;
    const uri = this.callSyncForOperation(
      operation,
      () => documentUriString(this.vscode, document),
    );
    if (uri === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
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
    const source = this.createRequestSource(operation);
    if (source === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    let lspEdit;
    try {
      lspEdit = await this.callForOperation(
        operation,
        () => client.sendRequest(LSP_RENAME_REQUEST, params, source && source.token),
      );
    } finally {
      this.releaseRequestSource(operation, source);
    }
    if (lspEdit === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    return this.callSyncForOperation(
      operation,
      () => this.lspWorkspaceEditToVscodeEdit(lspEdit, operation),
    );
  }

  async preflightRename(document, operation) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_RENAME_OPERATION;
    }
    if (this.vscode.workspace && typeof this.vscode.workspace.saveAll === "function") {
      const saved = await this.callForOperation(
        operation,
        () => this.vscode.workspace.saveAll(),
      );
      if (saved === CANCELLED_RENAME_OPERATION) {
        return CANCELLED_RENAME_OPERATION;
      }
    }
    if (
      !this.validateDiagnosticsProvider
      || typeof this.validateDiagnosticsProvider.validateErrorsForDocument !== "function"
    ) {
      return;
    }
    const result = await this.callForOperation(
      operation,
      () => this.validateDiagnosticsProvider.validateErrorsForDocument(document, new Map()),
    );
    if (result === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    const errors = validateErrors(result).filter(isBlockingValidateError);
    if (errors.length > 0) {
      throw new Error(PRE_REFACTOR_ERRORS_MESSAGE);
    }
    return this.isOperationActive(operation) ? undefined : CANCELLED_RENAME_OPERATION;
  }

  addGaugeRenames(edit, document, template, newName, operation, oldName, isConcept) {
    // Built once from the two templates: each usage then keeps the argument it
    // already had, moved to wherever that parameter now sits.
    const oldTemplate = oldName ? removeInlineTableSuffix(oldName) : undefined;
    const orderMap = oldTemplate
      ? createOrderOfArgs(oldTemplate, removeInlineTableSuffix(newName))
      : undefined;
    const oldParameterCount = oldTemplate ? stepParameterSlots(oldTemplate).length : 0;
    const lines = documentLines(document);
    const allowMultiline = this.allowsMultilineStep(document);
    const docStringLines = closedDocStringLines(lines);
    for (let line = 0; line < lines.length; line += 1) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_RENAME_OPERATION;
      }
      const step = gaugeStepOnLine(this.vscode, document, line, lines, {
        allowMultilineStep: allowMultiline,
        docStringLines,
      });
      if (step && step.template === template) {
        const replaced = this.callSyncForOperation(
          operation,
          () => edit.replace(
            document.uri,
            step.range,
            gaugeReplacementName(newName, step.hasInlineTable, {
              isConcept,
              oldParameterCount,
              orderMap,
              usageText: step.text,
            }),
          ),
        );
        if (replaced === CANCELLED_RENAME_OPERATION) {
          return CANCELLED_RENAME_OPERATION;
        }
      }
      if (step) {
        line = Math.max(line, step.range.end.line);
      }
    }
    if (isConceptDocument(document)) {
      for (const heading of findConceptHeadings(document.getText())) {
        if (!this.isOperationActive(operation)) {
          return CANCELLED_RENAME_OPERATION;
        }
        if (heading.normalized && heading.normalized === template) {
          const replaced = this.callSyncForOperation(
            operation,
            () => edit.replace(
              document.uri,
              createRange(this.vscode, heading.start, heading.end),
              gaugeReplacementName(newName, false),
            ),
          );
          if (replaced === CANCELLED_RENAME_OPERATION) {
            return CANCELLED_RENAME_OPERATION;
          }
        }
      }
    }
    return this.isOperationActive(operation) ? undefined : CANCELLED_RENAME_OPERATION;
  }

  addConstantBackedStepRenames(
    edit,
    implementationDocuments,
    sourceText,
    entry,
    alias,
    newName,
    hasInlineTable,
    oldName,
    operation,
  ) {
    for (const reference of annotationConstantReferences(sourceText, entry)) {
      const targetReferences = constantReferenceTargets(sourceText, reference);
      for (const document of implementationDocuments) {
        for (const targetReference of targetReferences) {
          if (!this.isOperationActive(operation)) {
            return CANCELLED_RENAME_OPERATION;
          }
          const constantRange = findConstLiteralRange(this.vscode, document, targetReference, alias);
          if (!constantRange || editHasReplacement(edit, document.uri, constantRange.range)) {
            continue;
          }
          const replaced = this.callSyncForOperation(
            operation,
            () => edit.replace(
              document.uri,
              constantRange.range,
              replacementForLiteral(kotlinReplacementName(newName, hasInlineTable, {
                implementationAlias: alias,
                oldName,
              }), constantRange.literal, {
                kotlin: isKotlinDocument(document),
              }),
            ),
          );
          if (replaced === CANCELLED_RENAME_OPERATION) {
            return CANCELLED_RENAME_OPERATION;
          }
        }
      }
    }
    return this.isOperationActive(operation) ? undefined : CANCELLED_RENAME_OPERATION;
  }

  addKotlinFunctionParameterRename(
    edit,
    document,
    text,
    entry,
    newName,
    hasInlineTable,
    oldName,
    operation,
  ) {
    if (!isKotlinDocument(document) || entry.parameterStart === undefined || entry.parameterEnd === undefined) {
      return;
    }
    const replacement = kotlinFunctionParameterReplacement(text, entry, newName, hasInlineTable, oldName);
    if (replacement === undefined) {
      return;
    }
    const range = createRangeFromOffsets(
      this.vscode,
      text,
      entry.parameterStart,
      entry.parameterEnd,
      document,
    );
    if (editHasReplacement(edit, document.uri, range)) {
      return;
    }
    return this.callSyncForOperation(
      operation,
      () => edit.replace(document.uri, range, replacement),
    );
  }

  addJavaFunctionParameterRename(
    edit,
    document,
    text,
    entry,
    newName,
    hasInlineTable,
    oldName,
    operation,
  ) {
    if (!isJavaDocument(document) || entry.parameterStart === undefined || entry.parameterEnd === undefined) {
      return;
    }
    const replacement = javaFunctionParameterReplacement(entry, newName, hasInlineTable, oldName);
    if (replacement === undefined) {
      return;
    }
    const range = createRangeFromOffsets(
      this.vscode,
      text,
      entry.parameterStart,
      entry.parameterEnd,
      document,
    );
    if (editHasReplacement(edit, document.uri, range)) {
      return;
    }
    return this.callSyncForOperation(
      operation,
      () => edit.replace(document.uri, range, replacement),
    );
  }

  addFunctionParameterRename(
    edit,
    document,
    text,
    entry,
    newName,
    hasInlineTable,
    oldName,
    operation,
  ) {
    const kotlinResult = this.addKotlinFunctionParameterRename(
      edit,
      document,
      text,
      entry,
      newName,
      hasInlineTable,
      oldName,
      operation,
    );
    if (kotlinResult === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    return this.addJavaFunctionParameterRename(
      edit,
      document,
      text,
      entry,
      newName,
      hasInlineTable,
      oldName,
      operation,
    );
  }

  addStepImplementationRenames(
    edit,
    document,
    implementationDocuments,
    template,
    newName,
    hasInlineTable,
    oldName,
    stepEntries,
    operation,
  ) {
    if (!this.isOperationActive(operation)) {
      return CANCELLED_RENAME_OPERATION;
    }
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
    for (const entry of stepEntries || findStepFunctionsForDocument(document, externalConstants)) {
      if (!this.isOperationActive(operation)) {
        return CANCELLED_RENAME_OPERATION;
      }
      const entryTemplate = entry.aliases.length === 1
        ? annotationStepTemplate(entry.aliases[0])
        : undefined;
      if (!entryTemplate || entryTemplate !== template) {
        continue;
      }
      const literal = literalAliasRange(text, entry, entry.aliases[0]);
      if (!literal) {
        if (isStepImplementationDocument(document)) {
          const constantResult = this.addConstantBackedStepRenames(
            edit,
            implementationDocuments,
            text,
            entry,
            entry.aliases[0],
            newName,
            hasInlineTable,
            oldName,
            operation,
          );
          if (constantResult === CANCELLED_RENAME_OPERATION) {
            return CANCELLED_RENAME_OPERATION;
          }
        }
        const parameterResult = this.addFunctionParameterRename(
          edit,
          document,
          text,
          entry,
          newName,
          hasInlineTable,
          oldName,
          operation,
        );
        if (parameterResult === CANCELLED_RENAME_OPERATION) {
          return CANCELLED_RENAME_OPERATION;
        }
        continue;
      }
      const range = createRangeFromOffsets(
        this.vscode,
        text,
        literal.contentStart,
        literal.contentEnd,
        document,
      );
      if (editHasReplacement(edit, document.uri, range)) {
        const parameterResult = this.addFunctionParameterRename(
          edit,
          document,
          text,
          entry,
          newName,
          hasInlineTable,
          oldName,
          operation,
        );
        if (parameterResult === CANCELLED_RENAME_OPERATION) {
          return CANCELLED_RENAME_OPERATION;
        }
        continue;
      }
      const replaced = this.callSyncForOperation(
        operation,
        () => edit.replace(
          document.uri,
          range,
          replacementForLiteral(kotlinReplacementName(newName, hasInlineTable, {
            implementationAlias: entry.aliases[0],
            oldName,
          }), literal, {
            kotlin: kotlinDocument,
          }),
        ),
      );
      if (replaced === CANCELLED_RENAME_OPERATION) {
        return CANCELLED_RENAME_OPERATION;
      }
      const parameterResult = this.addFunctionParameterRename(
        edit,
        document,
        text,
        entry,
        newName,
        hasInlineTable,
        oldName,
        operation,
      );
      if (parameterResult === CANCELLED_RENAME_OPERATION) {
        return CANCELLED_RENAME_OPERATION;
      }
    }
    return this.isOperationActive(operation) ? undefined : CANCELLED_RENAME_OPERATION;
  }

  provideRenameEdits(document, position, newName, token) {
    if (!this.isMarkdownDocumentInScope(document)) {
      return undefined;
    }
    return this.runOperation(
      token,
      (operation) => this.provideRenameEditsForOperation(
        operation,
        document,
        position,
        newName,
      ),
    );
  }

  async provideRenameEditsForOperation(operation, document, position, newName) {
    const target = await this.stepAt(document, position, operation);
    if (target === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    const { documents, step } = target;
    if (!step) {
      return undefined;
    }
    const validated = await this.validateRenameTarget(
      document,
      documents,
      step,
      operation,
    );
    if (validated === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    const preflight = await this.preflightRename(document, operation);
    if (preflight === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    if (step.engineRename && !validated.sourceImplemented) {
      const languageServerEdit = await this.provideLanguageServerRenameEdits(
        document,
        position,
        newName,
        operation,
      );
      if (languageServerEdit === CANCELLED_RENAME_OPERATION) {
        return CANCELLED_RENAME_OPERATION;
      }
      if (languageServerEdit) {
        const implementationDocuments = this.stepImplementationDocuments(documents);
        for (const candidate of this.stepImplementationDocuments(documents)) {
          const stepEntries = await this.stepEntriesFor(
            document,
            candidate,
            implementationDocuments,
            operation,
          );
          if (stepEntries === CANCELLED_RENAME_OPERATION) {
            return CANCELLED_RENAME_OPERATION;
          }
          const augmented = this.callSyncForOperation(
            operation,
            () => this.addStepImplementationRenames(
              languageServerEdit,
              candidate,
              implementationDocuments,
              step.template,
              newName,
              step.hasInlineTable,
              step.text,
              stepEntries,
              operation,
            ),
          );
          if (augmented === CANCELLED_RENAME_OPERATION) {
            return CANCELLED_RENAME_OPERATION;
          }
        }
        return this.isOperationActive(operation)
          ? languageServerEdit
          : CANCELLED_RENAME_OPERATION;
      }
    }

    const edit = this.callSyncForOperation(operation, () => createWorkspaceEdit(this.vscode));
    if (edit === CANCELLED_RENAME_OPERATION) {
      return CANCELLED_RENAME_OPERATION;
    }
    const implementationDocuments = this.stepImplementationDocuments(documents);
    // A usage of a CONCEPT supplies its heading's parameters by name, so a newly
    // added parameter stays dynamic there - getArgsInOrder's `if step.IsConcept`
    // branch. Anywhere else the fresh argument is static.
    const templateIsConcept = documents.some((candidate) => (
      isConceptDocument(candidate)
      && findConceptHeadings(candidate.getText())
        .some((heading) => heading.normalized && heading.normalized === step.template)
    ));
    for (const candidate of documents) {
      if (isGaugeDocument(candidate)) {
        const renamed = this.callSyncForOperation(
          operation,
          () => this.addGaugeRenames(
            edit,
            candidate,
            step.template,
            newName,
            operation,
            step.text,
            templateIsConcept,
          ),
        );
        if (renamed === CANCELLED_RENAME_OPERATION) {
          return CANCELLED_RENAME_OPERATION;
        }
      } else if (isStepImplementationDocument(candidate)) {
        const stepEntries = await this.stepEntriesFor(
          document,
          candidate,
          implementationDocuments,
          operation,
        );
        if (stepEntries === CANCELLED_RENAME_OPERATION) {
          return CANCELLED_RENAME_OPERATION;
        }
        const renamed = this.callSyncForOperation(
          operation,
          () => this.addStepImplementationRenames(
            edit,
            candidate,
            implementationDocuments,
            step.template,
            newName,
            step.hasInlineTable,
            step.text,
            stepEntries,
            operation,
          ),
        );
        if (renamed === CANCELLED_RENAME_OPERATION) {
          return CANCELLED_RENAME_OPERATION;
        }
      }
    }
    return this.isOperationActive(operation) ? edit : CANCELLED_RENAME_OPERATION;
  }

  register() {
    if (this.disposed || this.registrationDisposable) {
      return this;
    }
    if (!this.vscode.languages || typeof this.vscode.languages.registerRenameProvider !== "function") {
      return this;
    }
    const registration = this.vscode.languages.registerRenameProvider(
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
    if (this.disposed) {
      if (registration && typeof registration.dispose === "function") {
        registration.dispose();
      }
    } else {
      this.registrationDisposable = registration;
    }
    return this;
  }
}

module.exports = {
  GaugeRenameProvider,
};
