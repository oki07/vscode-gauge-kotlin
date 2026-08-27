"use strict";

const { isLegacyHeadingText } = require("./gaugeHeadings");

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const {
  GaugeStepDiagnosticsProvider,
  findConceptHeadings,
  findStepFunctionsForDocument,
  isStepImplementationDocument,
} = require("./stepDiagnostics");
const { normalizeStepTemplate } = require("./stepDefinitionProvider");
const { isMarkdownGaugeSpecFile } = require("./gaugeSpecScope");
const {
  isScenarioHashHeading,
} = require("./gaugeHeadings");

const TEXT_DOCUMENT_COMPLETION_REQUEST = "textDocument/completion";
const LSP_SNIPPET_INSERT_TEXT_FORMAT = 2;
const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_PATTERN = /\.spec$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const ALLOW_MULTILINE_STEP_PROPERTY = "allow_multiline_step";
const CSV_DELIMITER_PROPERTY = "csv_delimiter";
const GAUGE_DATA_DIR_PROPERTY = "gauge_data_dir";
const DEFAULT_ENV_PROPERTIES = ["env", "default", "default.properties"];
const CANCELLED_COMPLETION = Symbol("cancelledCompletion");

function getVscode(vscode) {
  return vscode || require("vscode");
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

function createRangeFromPositions(vscode, start, end) {
  const startPosition = createPosition(vscode, start.line, start.character);
  const endPosition = createPosition(vscode, end.line, end.character);
  if (typeof vscode.Range === "function") {
    return new vscode.Range(startPosition, endPosition);
  }
  return { start: startPosition, end: endPosition };
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || document.fileName || "";
}

function documentUri(document) {
  const uri = document && document.uri;
  if (!uri) {
    return undefined;
  }
  if (typeof uri.toString === "function") {
    return uri.toString();
  }
  const file = uri.fsPath || uri.path;
  return file ? `file://${file}` : undefined;
}

function documentLineText(document, lineNumber) {
  if (!document || lineNumber < 0 || typeof document.lineAt !== "function") {
    return "";
  }
  try {
    const line = document.lineAt(lineNumber);
    return line && typeof line.text === "string" ? line.text : "";
  } catch (_error) {
    return "";
  }
}

function isConceptDocument(document) {
  return Boolean(document && document.languageId === GAUGE_CONCEPT_LANGUAGE)
    || CONCEPT_FILE_PATTERN.test(documentPath(document));
}

function isSpecDocument(document) {
  return SPEC_FILE_PATTERN.test(documentPath(document));
}

function isGaugeFileDocument(document) {
  return isSpecDocument(document) || isConceptDocument(document);
}

function isMarkdownSpecDocument(document) {
  return document
    && document.languageId === MARKDOWN_LANGUAGE
    && MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document));
}

function isTagSourceDocument(document) {
  return isSpecDocument(document) || isMarkdownSpecDocument(document);
}

function dynamicArgumentRange(line, position) {
  let openIndex = line.indexOf("<");
  const stopAtUnescapedPipe = isTableLine(line);
  while (openIndex !== -1) {
    if (isEscapedCharacter(line, openIndex)) {
      openIndex = line.indexOf("<", openIndex + 1);
      continue;
    }
    const closeIndex = closingAngleIndex(line, openIndex, stopAtUnescapedPipe);
    if (position.character > openIndex && (closeIndex === -1 || position.character <= closeIndex)) {
      return {
        end: closeIndex === -1 ? position.character : closeIndex,
        start: openIndex + 1,
      };
    }
    if (closeIndex === -1) {
      return undefined;
    }
    openIndex = line.indexOf("<", closeIndex + 1);
  }

  return undefined;
}

function staticArgumentRange(line, position) {
  let openIndex = nextUnescapedCharacterIndex(line, "\"");
  while (openIndex !== -1) {
    const closeIndex = closingQuoteIndex(line, openIndex);
    if (position.character > openIndex && (closeIndex === -1 || position.character <= closeIndex)) {
      return {
        end: closeIndex === -1 ? position.character : closeIndex,
        start: openIndex + 1,
      };
    }
    if (closeIndex === -1) {
      return undefined;
    }
    openIndex = nextUnescapedCharacterIndex(line, "\"", closeIndex + 1);
  }

  return undefined;
}

function argumentCompletionOptions(label, argumentType, line, targetRange) {
  const closeCharacter = argumentType === "dynamic" ? ">" : "\"";
  const suffix = line[targetRange.end] === closeCharacter ? "" : closeCharacter;
  const text = `${label}${suffix}`;
  return {
    detail: argumentType,
    filterText: text,
    insertText: suffix ? text : undefined,
  };
}

function closingQuoteIndex(line, openIndex) {
  return closingEscapedArgumentIndex(line, openIndex, "\"");
}

function closingAngleIndex(line, openIndex, stopAtUnescapedPipe = false) {
  return closingEscapedArgumentIndex(line, openIndex, ">", stopAtUnescapedPipe);
}

function closingEscapedArgumentIndex(line, openIndex, closeCharacter, stopAtUnescapedPipe = false) {
  let index = openIndex + 1;
  let escaped = false;
  while (index < line.length) {
    const character = line[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === closeCharacter) {
      return index;
    } else if (stopAtUnescapedPipe && character === "|") {
      return index;
    }
    index += 1;
  }
  return -1;
}

function isScenarioHeading(line) {
  return isScenarioHashHeading(line);
}

function hasLegacyHeadingText(line) {
  return isLegacyHeadingText(line);
}

function isConceptLegacyHeadingText(line) {
  return hasLegacyHeadingText(line) && !/[#*|]/.test(line);
}

function hasFollowingLine(lines, lineNumber) {
  return lineNumber + 1 < lines.length;
}

function isLegacyScenarioHeadingAt(lines, lineNumber) {
  return hasLegacyHeadingText(lines[lineNumber])
    && /^-+$/.test(String(lines[lineNumber + 1] || "").trim());
}

function isLegacySpecHeadingAt(lines, lineNumber) {
  return hasLegacyHeadingText(lines[lineNumber])
    && /^[=]+$/.test(lines[lineNumber + 1] || "");
}

function isLegacyHeadingAt(lines, lineNumber) {
  return isLegacySpecHeadingAt(lines, lineNumber)
    || isLegacyScenarioHeadingAt(lines, lineNumber);
}

function isLegacyConceptHeadingAt(lines, lineNumber) {
  return isConceptLegacyHeadingText(lines[lineNumber])
    && /^[=]+$/.test(lines[lineNumber + 1] || "")
    && hasFollowingLine(lines, lineNumber + 1);
}

function isScenarioHeadingAt(lines, lineNumber) {
  return isScenarioHeading(lines[lineNumber] || "") || isLegacyScenarioHeadingAt(lines, lineNumber);
}

function isConceptHeadingAt(lines, lineNumber) {
  return isConceptHeading(lines[lineNumber] || "") || isLegacyConceptHeadingAt(lines, lineNumber);
}

function isStepLine(line) {
  const text = String(line || "");
  const marker = text.search(/\S/);
  return marker !== -1 && text[marker] === "*" && text[marker + 1] !== "*";
}

function isConceptHeading(line) {
  return String(line || "").trimStart().startsWith("#");
}

function isTableLine(line) {
  const text = String(line || "").trim();
  return text.startsWith("|");
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


function isTableBlockStartLine(line, options = {}) {
  return options.allowIndented ? isTableLine(line) : String(line || "").startsWith("|") && isTableLine(line);
}

function isTeardownLine(line) {
  return /^___+\s*$/.test(String(line || "").trimStart());
}

function tableBlockStartLine(lines, lineNumber, options = {}) {
  if (!isTableLine(lines[lineNumber] || "")) {
    return -1;
  }

  let startLine = lineNumber;
  while (startLine > 0 && isTableLine(lines[startLine - 1] || "")) {
    startLine -= 1;
  }
  return isTableBlockStartLine(lines[startLine] || "", options) ? startLine : -1;
}

function isFirstTableLine(lines, lineNumber, options = {}) {
  return tableBlockStartLine(lines, lineNumber, options) === lineNumber;
}

function isTableBlockLine(lines, lineNumber, options = {}) {
  return tableBlockStartLine(lines, lineNumber, options) !== -1;
}

function isCompletionTableBlockLine(lines, lineNumber) {
  return isTableBlockLine(lines, lineNumber, { allowIndented: true });
}

function isTableHeaderLine(document, lineNumber, options = {}) {
  if (document && typeof document.lineAt === "function") {
    return isTableBlockStartLine(documentLineText(document, lineNumber), options)
      && !isTableLine(documentLineText(document, lineNumber - 1));
  }
  const lines = document.getText().split(/\r?\n/);
  return isFirstTableLine(lines, lineNumber, options);
}

function tableCells(line) {
  const body = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "");
  const cells = [];
  let cell = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "|" && !isEscapedPipe(body, index)) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells.filter(Boolean);
}

function isEscapedPipe(line, index) {
  return isEscapedCharacter(line, index);
}

function isEscapedCharacter(line, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function nextUnescapedCharacterIndex(line, character, startIndex = 0) {
  let index = line.indexOf(character, startIndex);
  while (index !== -1 && isEscapedCharacter(line, index)) {
    index = line.indexOf(character, index + 1);
  }
  return index;
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function isThenable(value) {
  return value && typeof value.then === "function";
}

function stepCompletionRange(line, position) {
  const markerStart = String(line || "").search(/\S/);
  if (
    markerStart === -1
    || line[markerStart] !== "*"
    || position.character <= markerStart
  ) {
    return undefined;
  }
  const marker = /^[ \t]*\*[ \t]*/.exec(line);
  if (!marker) {
    return undefined;
  }
  return {
    start: Math.min(marker[0].length, position.character),
    end: Math.max(line.length, position.character),
  };
}

function stepCompletionInsertPrefix(line, targetRange) {
  return /[ \t]$/.test(line.slice(0, targetRange.start)) ? "" : " ";
}

function isInsideEscapedArgument(line, position) {
  const character = position.character;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "<" && isEscapedCharacter(line, index)) {
      const closeIndex = line.indexOf(">", index + 1);
      const end = closeIndex === -1 ? line.length : closeIndex;
      if (character > index && character <= end) {
        return true;
      }
    }
    if (line[index] === "\"" && isEscapedCharacter(line, index)) {
      let closeIndex = line.indexOf("\"", index + 1);
      while (closeIndex !== -1 && !isEscapedCharacter(line, closeIndex)) {
        closeIndex = line.indexOf("\"", closeIndex + 1);
      }
      const end = closeIndex === -1 ? line.length : closeIndex;
      if (character > index && character < end) {
        return true;
      }
      if (closeIndex !== -1) {
        index = closeIndex;
      }
    }
  }
  return false;
}

function isTagLine(line) {
  return /^\s*tags[ \t\f]?:/i.test(String(line || ""));
}

function isTagLineEndingWithComma(line) {
  return String(line || "").trim().endsWith(",");
}

function isTagContinuationBoundary(line) {
  const text = String(line || "").trim();
  return text.startsWith("*")
    || text.startsWith("#")
    || text.startsWith("//")
    || text.toLowerCase().startsWith("tags:")
    || text.toLowerCase().startsWith("tags :")
    || text.toLowerCase().startsWith("table:")
    || text.toLowerCase().startsWith("table :")
    || isTableLine(text)
    || isDocStringFenceLine(text)
    || isTeardownLine(text)
    // A heading underline is one or more characters
    // (references/gauge/parser/helper.go isUnderline), and Gauge terminates the
    // step at it either way.
    || /^=+$/.test(text)
    || /^-+$/.test(text);
}

function isTagsContext(lines, lineNumber) {
  if (lineNumber < 0 || lineNumber >= lines.length) {
    return false;
  }
  let tagsContinuation = false;
  for (let index = 0; index <= lineNumber; index += 1) {
    const line = lines[index] || "";
    if (isTagLine(line)) {
      if (index === lineNumber) {
        return true;
      }
      tagsContinuation = isTagLineEndingWithComma(line);
    } else if (
      tagsContinuation
      && !isTagContinuationBoundary(line)
      && !isLegacyHeadingAt(lines, index)
    ) {
      if (index === lineNumber) {
        return true;
      }
      tagsContinuation = isTagLineEndingWithComma(line);
    } else {
      tagsContinuation = false;
    }
  }
  return false;
}

function isDocumentTagsContext(document, lineNumber) {
  for (let currentLine = lineNumber; currentLine >= 0; currentLine -= 1) {
    const line = documentLineText(document, currentLine);
    if (isTagLine(line)) {
      return true;
    }
    if (
      isTagContinuationBoundary(line)
      || isLegacyHeadingAt([
        line,
        documentLineText(document, currentLine + 1),
      ], 0)
    ) {
      return false;
    }
    if (
      currentLine === 0
      || !isTagLineEndingWithComma(documentLineText(document, currentLine - 1))
    ) {
      return false;
    }
  }
  return false;
}

function tagCompletionRange(line, position) {
  const prefix = line.slice(0, position.character);
  const commaIndex = prefix.lastIndexOf(",");
  const colonIndex = prefix.lastIndexOf(":");
  const separatorIndex = commaIndex > colonIndex ? commaIndex : colonIndex;
  const start = separatorIndex === -1
    ? Math.max(0, line.search(/\S/))
    : separatorIndex + 1;
  const textAfterCursor = line.slice(position.character);
  const nextCommaIndex = textAfterCursor.indexOf(",");
  const end = nextCommaIndex === -1
    ? line.length
    : position.character + nextCommaIndex + 1;
  const suffix = nextCommaIndex === -1 ? "" : ",";
  const insertPrefix = separatorIndex === -1 ? "" : " ";
  return { end, insertPrefix, start, suffix };
}

function tagValues(text) {
  const values = [];
  const lines = String(text || "").split(/\r?\n/);
  let tagsContinuation = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const tagLine = isTagLine(line);
    const continuationLine = tagsContinuation
      && !isTagContinuationBoundary(line)
      && !isLegacyHeadingAt(lines, index);
    if (!tagLine && !continuationLine) {
      tagsContinuation = false;
      continue;
    }
    tagsContinuation = isTagLineEndingWithComma(line);
    const valueStart = tagLine ? line.indexOf(":") + 1 : 0;
    for (const rawValue of line.slice(valueStart).split(",")) {
      const value = rawValue.trim();
      if (value) {
        values.push(value);
      }
    }
  }
  return values;
}

function stepParameterRanges(stepText) {
  const ranges = [];
  let openIndex = stepText.indexOf("<");
  while (openIndex !== -1) {
    if (isEscapedCharacter(stepText, openIndex)) {
      openIndex = stepText.indexOf("<", openIndex + 1);
      continue;
    }
    const closeIndex = closingAngleIndex(stepText, openIndex);
    if (closeIndex === -1) {
      break;
    }
    ranges.push({
      end: closeIndex,
      name: stepText.slice(openIndex + 1, closeIndex),
      start: openIndex,
    });
    openIndex = stepText.indexOf("<", closeIndex + 1);
  }
  return ranges;
}

function escapeSnippetPlaceholder(value) {
  return value.replace(/[\\$}]/g, "\\$&");
}

function filledStaticArguments(prefix) {
  const values = [];
  let openIndex = nextUnescapedCharacterIndex(prefix, "\"");
  while (openIndex !== -1) {
    const closeIndex = closingQuoteIndex(prefix, openIndex);
    if (closeIndex === -1) {
      break;
    }
    values.push(prefix.slice(openIndex + 1, closeIndex));
    openIndex = nextUnescapedCharacterIndex(prefix, "\"", closeIndex + 1);
  }
  return values;
}

function nextStepArgumentStart(prefix, startIndex) {
  const dynamicStart = nextUnescapedCharacterIndex(prefix, "<", startIndex);
  const staticStart = nextUnescapedCharacterIndex(prefix, "\"", startIndex);
  if (dynamicStart === -1 && staticStart === -1) {
    return undefined;
  }
  if (staticStart === -1 || (dynamicStart !== -1 && dynamicStart < staticStart)) {
    return { start: dynamicStart, type: "dynamic" };
  }
  return { start: staticStart, type: "static" };
}

function filledStepArguments(prefix) {
  const values = [];
  let index = 0;
  while (index < prefix.length) {
    const argument = nextStepArgumentStart(prefix, index);
    if (!argument) {
      break;
    }
    const closeIndex = argument.type === "dynamic"
      ? closingAngleIndex(prefix, argument.start)
      : closingQuoteIndex(prefix, argument.start);
    if (closeIndex === -1) {
      break;
    }
    values.push({
      type: argument.type,
      value: prefix.slice(argument.start + 1, closeIndex),
    });
    index = closeIndex + 1;
  }
  return values;
}

function stepFilterArgumentText(argument) {
  return argument.type === "static" ? `"${argument.value}"` : `<${argument.value}>`;
}

function stepSnippetText(stepText, prefix = "") {
  const ranges = stepParameterRanges(stepText);
  if (ranges.length === 0) {
    return stepText;
  }

  const filledArgs = filledStaticArguments(prefix);
  let result = "";
  let offset = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    const tabstop = index === ranges.length - 1 ? 0 : index + 1;
    const placeholder = filledArgs[index] !== undefined ? filledArgs[index] : range.name;
    result += stepText.slice(offset, range.start);
    result += `"${"${"}${tabstop}:${escapeSnippetPlaceholder(placeholder)}}"`;
    offset = range.end + 1;
  }
  return result + stepText.slice(offset);
}

function stepFilterText(stepText, prefix = "") {
  const ranges = stepParameterRanges(stepText);
  if (ranges.length === 0) {
    return stepText;
  }

  const filledArgs = filledStepArguments(prefix);
  if (filledArgs.length === 0) {
    return stepText;
  }

  let result = "";
  let offset = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    result += stepText.slice(offset, range.start);
    result += filledArgs[index] !== undefined
      ? stepFilterArgumentText(filledArgs[index])
      : stepText.slice(range.start, range.end + 1);
    offset = range.end + 1;
  }
  return result + stepText.slice(offset);
}

function snippetString(vscode, value) {
  if (typeof vscode.SnippetString === "function") {
    return new vscode.SnippetString(value);
  }
  return value;
}

function externalDataTablePath(line) {
  const match = /^\s*table[ \t\f]?:\s*(.+?)\s*$/i.exec(String(line || ""));
  return match ? match[1].trim() : undefined;
}

function parseCsvRecord(line, delimiter) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === "\"" && line[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === "\"" && cell.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells.filter(Boolean);
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

function projectCsvDelimiter(options = {}) {
  return projectDefaultProperty(options, CSV_DELIMITER_PROPERTY);
}

function csvDelimiter(options = {}) {
  const delimiter = process.env.csv_delimiter || projectCsvDelimiter(options);
  return delimiter ? delimiter[0] : ",";
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

function allowMultilineStep(options = {}) {
  const envValue = boolProperty(process.env.allow_multiline_step);
  if (envValue !== undefined) {
    return envValue;
  }
  const projectValue = boolProperty(projectDefaultProperty(options, ALLOW_MULTILINE_STEP_PROPERTY));
  return projectValue === true;
}

function gaugeDataDir(options = {}) {
  return process.env[GAUGE_DATA_DIR_PROPERTY]
    || projectDefaultProperty(options, GAUGE_DATA_DIR_PROPERTY)
    || ".";
}

function csvHeaderCells(content, options = {}) {
  const delimiter = csvDelimiter(options);
  const lines = String(content || "").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    return unique(parseCsvRecord(line, delimiter));
  }
  return [];
}

function resolveExternalDataTablePath(dataTablePath, options = {}) {
  const pathModule = options.pathModule || nodePath;
  if (!dataTablePath) {
    return undefined;
  }
  if (pathModule.isAbsolute(dataTablePath)) {
    return dataTablePath;
  }
  if (options.projectRoot) {
    return pathModule.join(options.projectRoot, gaugeDataDir(options), dataTablePath);
  }
  if (!options.filePath) {
    return undefined;
  }
  return pathModule.resolve(pathModule.dirname(options.filePath), dataTablePath);
}

function externalDataTableHeaders(dataTablePath, options = {}) {
  const fileSystem = options.fileSystem;
  if (!fileSystem || typeof fileSystem.readFileSync !== "function") {
    return [];
  }
  const filename = resolveExternalDataTablePath(dataTablePath, options);
  if (!filename) {
    return [];
  }
  try {
    return csvHeaderCells(fileSystem.readFileSync(filename, "utf8"), options);
  } catch (_error) {
    return [];
  }
}

function specDataTableHeaders(text, options = {}) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (isScenarioHeadingAt(lines, index)) {
      return [];
    }
    if (isStepLine(line)) {
      return [];
    }
    const dataTablePath = externalDataTablePath(line);
    if (dataTablePath) {
      return externalDataTableHeaders(dataTablePath, options);
    }
    if (isFirstTableLine(lines, index, { allowIndented: true })) {
      return unique(tableCells(line));
    }
  }
  return [];
}

function scenarioDataTableHeaders(text, lineNumber) {
  const lines = text.split(/\r?\n/);
  let scenarioLine = -1;
  for (let index = Math.min(lineNumber, lines.length - 1); index >= 0; index -= 1) {
    if (isScenarioHeadingAt(lines, index)) {
      scenarioLine = index;
      break;
    }
  }
  if (scenarioLine === -1) {
    return [];
  }

  for (let index = scenarioLine + 1; index <= Math.min(lineNumber, lines.length - 1); index += 1) {
    const line = lines[index] || "";
    if (isScenarioHeadingAt(lines, index) || isStepLine(line)) {
      return [];
    }
    if (isFirstTableLine(lines, index, { allowIndented: true })) {
      return unique(tableCells(line));
    }
  }
  return [];
}

function isTableSeparatorLine(line) {
  if (!isTableLine(line)) {
    return false;
  }
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function isDocStringFenceLine(line) {
  return String(line || "").trim() === "\"\"\"";
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
    || /^-{3,}\s*$/.test(text);
}

function dynamicArgumentsInLine(line, options = {}) {
  const values = [];
  let openIndex = line.indexOf("<");
  while (openIndex !== -1) {
    if (isEscapedCharacter(line, openIndex)) {
      openIndex = line.indexOf("<", openIndex + 1);
      continue;
    }
    const closeIndex = closingAngleIndex(
      line,
      openIndex,
      Boolean(options.stopAtUnescapedPipe),
    );
    if (closeIndex === -1) {
      break;
    }
    if (line[closeIndex] !== ">") {
      openIndex = line.indexOf("<", closeIndex + 1);
      continue;
    }
    const value = line.slice(openIndex + 1, closeIndex).trim();
    if (value) {
      values.push(value);
    }
    openIndex = line.indexOf("<", closeIndex + 1);
  }
  return values;
}

function isConceptDynamicArgumentSourceLine(lines, lineNumber) {
  const line = lines[lineNumber] || "";
  if (isConceptHeadingAt(lines, lineNumber) || isStepLine(line)) {
    return true;
  }
  if (!isCompletionTableBlockLine(lines, lineNumber)) {
    return false;
  }
  if (isFirstTableLine(lines, lineNumber, { allowIndented: true })) {
    return false;
  }
  return !isTableSeparatorLine(line);
}

function conceptDynamicArguments(text) {
  const values = [];
  const lines = text.split(/\r?\n/);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    if (!isConceptDynamicArgumentSourceLine(lines, lineNumber)) {
      continue;
    }
    values.push(...dynamicArgumentsInLine(line, {
      stopAtUnescapedPipe: isTableLine(line),
    }));
  }
  return unique(values);
}

function multilineStepText(lines, lineNumber) {
  const line = lines[lineNumber] || "";
  const marker = String(line).search(/\S/);
  if (marker === -1 || line[marker] !== "*") {
    return line;
  }
  const stepLines = [line.slice(marker + 1).trim()];
  for (let nextLine = lineNumber + 1; nextLine < lines.length; nextLine += 1) {
    const nextText = lines[nextLine] || "";
    if (isGaugeSyntaxBoundary(nextText)) {
      break;
    }
    stepLines.push(nextText.trim());
  }
  return stepLines.join(" ");
}

function multilineStepEndLine(lines, lineNumber) {
  let endLine = lineNumber;
  for (let nextLine = lineNumber + 1; nextLine < lines.length; nextLine += 1) {
    const nextText = lines[nextLine] || "";
    if (isGaugeSyntaxBoundary(nextText)) {
      break;
    }
    endLine = nextLine;
  }
  return endLine;
}

function specDynamicArguments(text, currentLineNumber, options = {}) {
  const values = [];
  const lines = text.split(/\r?\n/);
  const multiline = Boolean(options.allowMultilineStep);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    if (lineNumber === currentLineNumber) {
      continue;
    }
    const line = lines[lineNumber];
    if (!isStepLine(line)) {
      continue;
    }
    values.push(...dynamicArgumentsInLine(multiline ? multilineStepText(lines, lineNumber) : line));
  }
  return unique(values);
}

function isStaticArgumentSourceLine(line) {
  return isStepLine(line);
}

function staticArguments(text, options = {}) {
  const values = [];
  const lines = text.split(/\r?\n/);
  const excludeTeardown = Boolean(options.excludeTeardown);
  for (const line of lines) {
    if (excludeTeardown && isTeardownLine(line)) {
      break;
    }
    if (!isStaticArgumentSourceLine(line, options)) {
      continue;
    }
    let openIndex = nextUnescapedCharacterIndex(line, "\"");
    while (openIndex !== -1) {
      const closeIndex = closingQuoteIndex(line, openIndex);
      if (closeIndex === -1) {
        break;
      }
      const value = line.slice(openIndex + 1, closeIndex);
      if (value) {
        values.push(value);
      }
      openIndex = nextUnescapedCharacterIndex(line, "\"", closeIndex + 1);
    }
  }
  return unique(values);
}

function scenarioDataTableHeadersByLine(lines) {
  const headersByLine = new Map();
  let inScenario = false;
  let headerSearchBlocked = false;
  let headers = [];
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber] || "";
    if (isScenarioHeadingAt(lines, lineNumber)) {
      inScenario = true;
      headerSearchBlocked = false;
      headers = [];
    } else if (
      inScenario
      && !headerSearchBlocked
      && headers.length === 0
      && isTableLine(line)
      && !isTableLine(lines[lineNumber - 1] || "")
    ) {
      headers = unique(tableCells(line));
    } else if (inScenario && headers.length === 0 && isStepLine(line)) {
      headerSearchBlocked = true;
    }
    headersByLine.set(lineNumber, inScenario ? headers : []);
  }
  return headersByLine;
}

function parameterEntriesFromDocument(document, options = {}) {
  if (!document || typeof document.getText !== "function") {
    return undefined;
  }
  const text = document.getText();
  if (isConceptDocument(document)) {
    return {
      dynamicOccurrences: [],
      dynamicValues: conceptDynamicArguments(text),
      scenarioHeadersByLine: new Map(),
      specHeaders: [],
      staticValues: staticArguments(text, { includeConceptHeadings: true }),
    };
  }
  if (!isSpecDocument(document) && !isMarkdownSpecDocument(document)) {
    return undefined;
  }
  const lines = text.split(/\r?\n/);
  const dynamicOccurrences = [];
  const multiline = Boolean(options.allowMultilineStep);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber] || "";
    if (!isStepLine(line)) {
      continue;
    }
    const stepText = multiline ? multilineStepText(lines, lineNumber) : line;
    for (const value of dynamicArgumentsInLine(stepText)) {
      dynamicOccurrences.push({ line: lineNumber, value });
    }
  }
  return {
    dynamicOccurrences,
    dynamicValues: [],
    scenarioHeadersByLine: scenarioDataTableHeadersByLine(lines),
    specHeaders: specDataTableHeaders(text, options),
    staticValues: staticArguments(text, { excludeTeardown: true }),
  };
}

function allowsDynamicArgumentCompletion(line, document, lineNumber) {
  if (
    isConceptDocument(document)
    && isConceptHeadingAt([
      line,
      documentLineText(document, lineNumber + 1),
      documentLineText(document, lineNumber + 2),
    ], 0)
  ) {
    return true;
  }
  return isStepLine(line) || isTableLine(line);
}

function allowsStaticArgumentCompletion(line) {
  return isStepLine(line);
}

function completionItem(vscode, label, range, options = {}) {
  const kind = Object.prototype.hasOwnProperty.call(options, "kind")
    ? options.kind
    : vscode.CompletionItemKind && vscode.CompletionItemKind.Variable;
  const item = typeof vscode.CompletionItem === "function"
    ? new vscode.CompletionItem(label, kind)
    : { label, kind };
  item.range = range;
  if (options.detail !== undefined) {
    item.detail = options.detail;
  }
  if (options.documentation !== undefined) {
    item.documentation = options.documentation;
  }
  if (options.insertText !== undefined) {
    item.insertText = options.insertText;
  }
  if (options.filterText !== undefined) {
    item.filterText = options.filterText;
  }
  if (options.sortText !== undefined) {
    item.sortText = options.sortText;
  }
  return item;
}

function lspCompletionItemKind(vscode, kind) {
  const completionItemKind = vscode.CompletionItemKind;
  if (!completionItemKind) {
    return undefined;
  }
  if (!Number.isInteger(kind)) {
    return undefined;
  }
  if (kind >= 1 && kind <= 25) {
    return kind - 1;
  }
  return completionItemKind.Text;
}

function lspCompletionItems(response) {
  if (Array.isArray(response)) {
    return response;
  }
  if (response && Array.isArray(response.items)) {
    return response.items;
  }
  return [];
}

function lspCompletionRange(vscode, item, fallbackRange) {
  const range = item && item.textEdit && item.textEdit.range;
  if (!range || !range.start || !range.end) {
    return fallbackRange;
  }
  return createRangeFromPositions(vscode, range.start, range.end);
}

function lspCompletionInsertText(vscode, item) {
  const text = item && item.textEdit && item.textEdit.newText !== undefined
    ? item.textEdit.newText
    : item && item.insertText;
  if (text === undefined) {
    return undefined;
  }
  return item.insertTextFormat === LSP_SNIPPET_INSERT_TEXT_FORMAT
    ? snippetString(vscode, text)
    : text;
}

function lspCompletionItem(vscode, item, fallbackRange) {
  if (!item || !item.label) {
    return undefined;
  }
  const options = {
    detail: item.detail,
    documentation: item.documentation,
    filterText: item.filterText,
    insertText: lspCompletionInsertText(vscode, item),
    kind: lspCompletionItemKind(vscode, item.kind),
    sortText: item.sortText,
  };
  return completionItem(
    vscode,
    item.label,
    lspCompletionRange(vscode, item, fallbackRange),
    options,
  );
}

function mergeCompletionItems(localItems, serverItems) {
  const seen = new Set(localItems.map((item) => stepCompletionKey(item)));
  const merged = localItems.slice();
  for (const item of serverItems) {
    if (!item) {
      continue;
    }
    const key = stepCompletionKey(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function mergeCompletionItemsByLabel(localItems, serverItems) {
  const seen = new Set(localItems.map((item) => item && item.label).filter(Boolean));
  const merged = localItems.slice();
  for (const item of serverItems) {
    if (!item || !item.label || seen.has(item.label)) {
      continue;
    }
    seen.add(item.label);
    merged.push(item);
  }
  return merged;
}

function stepCompletionKey(item) {
  const label = typeof item === "string"
    ? item
    : item && (item.filterText || item.label);
  return label ? (normalizeStepTemplate(String(label)) || "") : "";
}

function nextStepCompletionParameter(text, startIndex) {
  const dynamicStart = nextUnescapedCharacterIndex(text, "<", startIndex);
  const staticStart = nextUnescapedCharacterIndex(text, "\"", startIndex);
  if (dynamicStart === -1 && staticStart === -1) {
    return undefined;
  }
  if (staticStart === -1 || (dynamicStart !== -1 && dynamicStart < staticStart)) {
    return {
      closeIndex: closingAngleIndex(text, dynamicStart),
      start: dynamicStart,
      type: "dynamic",
    };
  }
  return {
    closeIndex: closingQuoteIndex(text, staticStart),
    start: staticStart,
    type: "static",
  };
}

function usedStepCompletionText(stepText) {
  let result = "";
  let index = 0;
  while (index < stepText.length) {
    const parameter = nextStepCompletionParameter(stepText, index);
    if (!parameter || parameter.closeIndex === -1) {
      result += stepText.slice(index);
      break;
    }
    result += stepText.slice(index, parameter.start);
    const value = stepText.slice(parameter.start + 1, parameter.closeIndex);
    result += parameter.type === "static" ? `<${value}>` : `<${value}>`;
    index = parameter.closeIndex + 1;
  }
  return result.trim();
}

function isUsedStepSourceDocument(document) {
  return isSpecDocument(document) || isMarkdownSpecDocument(document) || isConceptDocument(document);
}

function usedStepRecordsFromDocument(document, options = {}) {
  if (!document || typeof document.getText !== "function" || !isUsedStepSourceDocument(document)) {
    return [];
  }
  const lines = document.getText().split(/\r?\n/);
  const entries = [];
  const multiline = Boolean(options.allowMultilineStep);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber] || "";
    if (!isStepLine(line)) {
      continue;
    }
    if (lineNumber === options.currentLine && !options.includeCurrentLine) {
      continue;
    }
    const marker = String(line || "").search(/\S/);
    const text = marker === -1 ? "" : line.slice(marker + 1).trim();
    const stepText = multiline ? multilineStepText(lines, lineNumber).trim() : text;
    if (!stepText) {
      continue;
    }
    const endLine = multiline ? multilineStepEndLine(lines, lineNumber) : lineNumber;
    entries.push({
      label: inlineTableLineAfterStep(lines, endLine) !== undefined
        ? `${usedStepCompletionText(stepText)} <table>`
        : usedStepCompletionText(stepText),
      line: lineNumber,
    });
  }
  return entries;
}

function usedStepEntriesFromDocument(document, options = {}) {
  return usedStepRecordsFromDocument(document, options).map((entry) => entry.label);
}

function resolveClientsMap(clientsMap) {
  return typeof clientsMap === "function" ? clientsMap() : clientsMap;
}

class GaugeDynamicArgumentCompletionProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.clientsMap = options.clientsMap;
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.projectFactory = options.projectFactory;
    this.documentStore = options.documentStore;
    this.workspaceStepIndex = options.workspaceStepIndex;
    this.ownedDiagnosticsProvider = undefined;
    this.diagnosticsProvider = options.diagnosticsProvider
      || (this.workspaceStepIndex && this.workspaceStepIndex.diagnosticsProvider);
    if (!this.diagnosticsProvider) {
      this.ownedDiagnosticsProvider = new GaugeStepDiagnosticsProvider({
        documentStore: this.documentStore,
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

  isCompletionOperationActive(operation) {
    return !this.disposed && (!operation || operation.active);
  }

  disposeCompletionListener(operation) {
    const disposable = operation && operation.cancellationDisposable;
    if (!disposable) {
      return;
    }
    operation.cancellationDisposable = undefined;
    if (typeof disposable.dispose === "function") {
      try {
        disposable.dispose();
      } catch (_error) {
        // Listener cleanup cannot reactivate a completed request.
      }
    }
  }

  cancelCompletionOperation(operation) {
    if (!operation || !operation.active) {
      return;
    }
    operation.active = false;
    this.activeOperations.delete(operation);
    operation.resolveCancellation(CANCELLED_COMPLETION);
    this.disposeCompletionListener(operation);
  }

  finishCompletionOperation(operation) {
    if (!operation || !operation.active) {
      return;
    }
    operation.active = false;
    this.activeOperations.delete(operation);
    this.disposeCompletionListener(operation);
  }

  createCompletionOperation(token) {
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
      token,
    };
    this.activeOperations.add(operation);
    if (!token || typeof token.onCancellationRequested !== "function") {
      return operation;
    }
    let disposable;
    try {
      disposable = token.onCancellationRequested(() => this.cancelCompletionOperation(operation));
    } catch (error) {
      if (!operation.active) {
        return operation;
      }
      this.finishCompletionOperation(operation);
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
      this.cancelCompletionOperation(operation);
    }
    return operation;
  }

  observeCompletionValue(value) {
    Promise.resolve(value).catch(() => {});
  }

  completeForOperation(operation, callback, onFulfilled = (value) => value, onRejected) {
    if (!this.isCompletionOperationActive(operation)) {
      return CANCELLED_COMPLETION;
    }
    let value;
    try {
      value = callback();
    } catch (error) {
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      throw error;
    }
    if (!this.isCompletionOperationActive(operation)) {
      this.observeCompletionValue(value);
      return CANCELLED_COMPLETION;
    }
    if (!isThenable(value)) {
      if (value === CANCELLED_COMPLETION) {
        return value;
      }
      let completed;
      try {
        completed = onFulfilled(value);
      } catch (error) {
        if (!this.isCompletionOperationActive(operation)) {
          return CANCELLED_COMPLETION;
        }
        throw error;
      }
      if (!this.isCompletionOperationActive(operation)) {
        this.observeCompletionValue(completed);
        return CANCELLED_COMPLETION;
      }
      return completed;
    }
    const completion = Promise.resolve(value);
    const guarded = operation
      ? Promise.race([completion, operation.cancellation])
      : completion;
    return guarded.then(
      (resolved) => {
        if (
          resolved === CANCELLED_COMPLETION
          || !this.isCompletionOperationActive(operation)
        ) {
          return CANCELLED_COMPLETION;
        }
        let completed;
        try {
          completed = onFulfilled(resolved);
        } catch (error) {
          if (!this.isCompletionOperationActive(operation)) {
            return CANCELLED_COMPLETION;
          }
          throw error;
        }
        if (!this.isCompletionOperationActive(operation)) {
          this.observeCompletionValue(completed);
          return CANCELLED_COMPLETION;
        }
        return completed;
      },
      (error) => {
        if (!this.isCompletionOperationActive(operation)) {
          return CANCELLED_COMPLETION;
        }
        if (onRejected) {
          const completed = onRejected(error);
          if (!this.isCompletionOperationActive(operation)) {
            this.observeCompletionValue(completed);
            return CANCELLED_COMPLETION;
          }
          return completed;
        }
        throw error;
      },
    );
  }

  runCompletionOperation(token, callback) {
    if (this.disposed || (token && token.isCancellationRequested)) {
      return [];
    }
    const operation = this.createCompletionOperation(token);
    if (!operation || !operation.active) {
      return [];
    }
    let result;
    try {
      result = this.completeForOperation(operation, () => callback(operation));
    } catch (error) {
      this.finishCompletionOperation(operation);
      throw error;
    }
    if (!isThenable(result)) {
      const completed = result === CANCELLED_COMPLETION ? [] : result;
      this.finishCompletionOperation(operation);
      return completed;
    }
    return Promise.resolve(result)
      .then(
        (value) => value === CANCELLED_COMPLETION ? [] : value,
        (error) => {
          if (!operation.active) {
            return [];
          }
          throw error;
        },
      )
      .finally(() => this.finishCompletionOperation(operation));
  }

  isGaugeProjectDocument(document) {
    return this.diagnosticsProvider.isGaugeProjectDocument(document);
  }

  gaugeProjectRoot(document) {
    return this.diagnosticsProvider.gaugeProjectRoot(document);
  }

  belongsToSourceGaugeProject(candidate, sourceRoot) {
    return this.diagnosticsProvider.belongsToSourceGaugeProject(candidate, sourceRoot);
  }

  isCompletionDocument(document) {
    if (!document) {
      return false;
    }
    if (document.languageId === GAUGE_LANGUAGE) {
      return this.isGaugeProjectDocument(document);
    }
    if (isGaugeFileDocument(document)) {
      return this.isGaugeProjectDocument(document);
    }
    if (
      document.languageId !== MARKDOWN_LANGUAGE
      || !MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document))
      || !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return false;
    }
    return this.isGaugeProjectDocument(document);
  }

  workspaceDocuments(operation) {
    if (!this.isCompletionOperationActive(operation)) {
      return CANCELLED_COMPLETION;
    }
    const store = this.documentStore;
    if (store && typeof store.whenReady === "function" && !store.isScanComplete()) {
      // Wait for the store's one-time scan instead of falling back to a fresh
      // findFiles/openTextDocument sweep of the whole workspace.
      return this.completeForOperation(
        operation,
        () => store.whenReady(),
        () => this.completeForOperation(
          operation,
          () => this.diagnosticsProvider.workspaceDocuments(),
        ),
      );
    }
    return this.completeForOperation(
      operation,
      () => this.diagnosticsProvider.workspaceDocuments(),
    );
  }

  stepCompletionEntries(document, workspaceDocuments, position, operation) {
    if (!this.isCompletionOperationActive(operation)) {
      return CANCELLED_COMPLETION;
    }
    const entries = [];
    const seen = new Set();
    const sourceRoot = this.gaugeProjectRoot(document);
    if (!this.isCompletionOperationActive(operation)) {
      return CANCELLED_COMPLETION;
    }
    const addEntry = (label, detail) => {
      const key = stepCompletionKey(label);
      if (!label || seen.has(key)) {
        return;
      }
      seen.add(key);
      entries.push({ detail, label });
    };
    for (const candidate of workspaceDocuments || []) {
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      if (!candidate || !isConceptDocument(candidate) || typeof candidate.getText !== "function") {
        continue;
      }
      const belongsToProject = this.belongsToSourceGaugeProject(candidate, sourceRoot);
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      if (!belongsToProject) {
        continue;
      }
      const candidateText = candidate.getText();
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      for (const heading of findConceptHeadings(candidateText)) {
        addEntry(heading.text, "concept");
      }
    }
    for (const candidate of workspaceDocuments || []) {
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      if (!candidate || typeof candidate.getText !== "function") {
        continue;
      }
      const belongsToProject = this.belongsToSourceGaugeProject(candidate, sourceRoot);
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      if (!belongsToProject) {
        continue;
      }
      if (!isStepImplementationDocument(candidate)) {
        continue;
      }
      const externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(
        candidate,
        workspaceDocuments,
      );
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      for (const entry of findStepFunctionsForDocument(candidate, externalConstants)) {
        if (!this.isCompletionOperationActive(operation)) {
          return CANCELLED_COMPLETION;
        }
        for (const alias of entry.aliases) {
          addEntry(alias, "step");
        }
      }
    }
    const documents = [];
    const seenDocuments = new Set();
    const addDocument = (candidate) => {
      if (!candidate || typeof candidate.getText !== "function") {
        return;
      }
      const key = documentPath(candidate);
      if (key) {
        if (seenDocuments.has(key)) {
          return;
        }
        seenDocuments.add(key);
      } else if (documents.includes(candidate)) {
        return;
      }
      documents.push(candidate);
    };
    addDocument(document);
    for (const candidate of workspaceDocuments || []) {
      addDocument(candidate);
    }
    const currentLine = position && position.line;
    const currentLineText = currentLine !== undefined && document && typeof document.lineAt === "function"
      ? document.lineAt(currentLine).text
      : "";
    const includeCurrentLine = currentLine !== undefined
      && String(currentLineText || "").slice(position.character).trim().length > 0;
    const sourcePath = documentPath(document);
    const allowMultiline = allowMultilineStep({
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectRoot: sourceRoot,
    });
    if (!this.isCompletionOperationActive(operation)) {
      return CANCELLED_COMPLETION;
    }
    for (const candidate of documents) {
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      const belongsToProject = this.belongsToSourceGaugeProject(candidate, sourceRoot);
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      if (!belongsToProject) {
        continue;
      }
      const isCurrentDocument = documentPath(candidate) === sourcePath;
      const usedEntries = usedStepEntriesFromDocument(candidate, {
        allowMultilineStep: allowMultiline,
        currentLine: isCurrentDocument ? currentLine : undefined,
        includeCurrentLine,
      });
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      for (const label of usedEntries) {
        addEntry(label, "step");
      }
    }
    return entries;
  }

  tagCompletionEntries(document, workspaceDocuments, operation) {
    if (!this.isCompletionOperationActive(operation)) {
      return CANCELLED_COMPLETION;
    }
    const documents = [];
    const seenDocuments = new Set();
    const addDocument = (candidate) => {
      if (!candidate || typeof candidate.getText !== "function") {
        return;
      }
      const key = documentPath(candidate);
      if (key) {
        if (seenDocuments.has(key)) {
          return;
        }
        seenDocuments.add(key);
      } else if (documents.includes(candidate)) {
        return;
      }
      documents.push(candidate);
    };
    addDocument(document);
    for (const candidate of workspaceDocuments || []) {
      addDocument(candidate);
    }

    const sourceRoot = this.gaugeProjectRoot(document);
    if (!this.isCompletionOperationActive(operation)) {
      return CANCELLED_COMPLETION;
    }
    const values = [];
    for (const candidate of documents) {
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      if (!isTagSourceDocument(candidate)) {
        continue;
      }
      const belongsToProject = this.belongsToSourceGaugeProject(candidate, sourceRoot);
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      if (!belongsToProject) {
        continue;
      }
      const candidateText = candidate.getText();
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      values.push(...tagValues(candidateText));
    }
    return unique(values);
  }

  projectClientFor(document) {
    const clientsMap = resolveClientsMap(this.clientsMap);
    if (!clientsMap || typeof clientsMap.get !== "function") {
      return undefined;
    }
    return clientsMap.get(documentPath(document));
  }

  serverCompletionItems(document, position, fallbackRange, operation) {
    if (!this.isCompletionOperationActive(operation)) {
      return CANCELLED_COMPLETION;
    }
    const projectClient = this.projectClientFor(document);
    if (!this.isCompletionOperationActive(operation)) {
      return CANCELLED_COMPLETION;
    }
    const client = projectClient && projectClient.client;
    const uri = documentUri(document);
    if (!client || typeof client.sendRequest !== "function" || !uri) {
      return [];
    }
    const params = {
      position: {
        line: position.line,
        character: position.character,
      },
      textDocument: { uri },
    };
    return this.completeForOperation(
      operation,
      () => operation && operation.token
        ? client.sendRequest(TEXT_DOCUMENT_COMPLETION_REQUEST, params, operation.token)
        : client.sendRequest(TEXT_DOCUMENT_COMPLETION_REQUEST, params),
      (response) => {
        const items = [];
        for (const item of lspCompletionItems(response)) {
          if (!this.isCompletionOperationActive(operation)) {
            return CANCELLED_COMPLETION;
          }
          const converted = lspCompletionItem(this.vscode, item, fallbackRange);
          if (!this.isCompletionOperationActive(operation)) {
            return CANCELLED_COMPLETION;
          }
          if (converted) {
            items.push(converted);
          }
        }
        return items;
      },
      () => [],
    );
  }

  serverStepCompletionItems(document, position, fallbackRange, operation) {
    return this.serverCompletionItems(document, position, fallbackRange, operation);
  }

  stepCompletionItems(
    document,
    position,
    targetRange,
    workspaceDocuments,
    indexedEntries,
    operation,
  ) {
    if (
      !this.isCompletionOperationActive(operation)
      || !this.isCompletionDocument(document)
      || !this.isCompletionOperationActive(operation)
    ) {
      return [];
    }
    // Reached after an await, by which point the document may have shrunk
    // past this position and lineAt would throw.
    const line = documentLineText(document, position.line);
    const prefix = line.slice(targetRange.start, position.character);
    const range = createRange(this.vscode, position.line, targetRange.start, targetRange.end);
    const kind = this.vscode.CompletionItemKind && this.vscode.CompletionItemKind.Function;
    const insertPrefix = stepCompletionInsertPrefix(line, targetRange);
    const completionEntries = indexedEntries
      || this.stepCompletionEntries(document, workspaceDocuments, position, operation);
    if (completionEntries === CANCELLED_COMPLETION) {
      return CANCELLED_COMPLETION;
    }
    const localItems = [];
    for (const entry of completionEntries) {
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      const item = completionItem(this.vscode, entry.label, range, {
        detail: entry.detail,
        documentation: entry.label,
        filterText: `${insertPrefix}${stepFilterText(entry.label, prefix)}`,
        insertText: snippetString(this.vscode, `${insertPrefix}${stepSnippetText(entry.label, prefix)}`),
        kind,
      });
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      localItems.push(item);
    }
    return this.completeForOperation(
      operation,
      () => this.serverStepCompletionItems(document, position, range, operation),
      (items) => mergeCompletionItems(localItems, items),
    );
  }

  tagCompletionItems(
    document,
    position,
    targetRange,
    workspaceDocuments,
    indexedEntries,
    operation,
  ) {
    if (
      !this.isCompletionOperationActive(operation)
      || !this.isCompletionDocument(document)
      || !this.isCompletionOperationActive(operation)
    ) {
      return [];
    }
    const range = createRange(this.vscode, position.line, targetRange.start, targetRange.end);
    const kind = this.vscode.CompletionItemKind && this.vscode.CompletionItemKind.Variable;
    const entries = indexedEntries === undefined
      ? this.tagCompletionEntries(document, workspaceDocuments, operation)
      : indexedEntries;
    if (entries === CANCELLED_COMPLETION) {
      return CANCELLED_COMPLETION;
    }
    const localItems = [];
    for (const label of entries) {
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      const item = completionItem(this.vscode, label, range, {
        detail: "Tag",
        filterText: `${label}${targetRange.suffix}`,
        insertText: `${targetRange.insertPrefix}${label}${targetRange.suffix}`,
        kind,
        sortText: `a${label}`,
      });
      if (!this.isCompletionOperationActive(operation)) {
        return CANCELLED_COMPLETION;
      }
      localItems.push(item);
    }
    return this.completeForOperation(
      operation,
      () => this.serverCompletionItems(document, position, range, operation),
      (items) => mergeCompletionItemsByLabel(localItems, items),
    );
  }

  provideCompletionItemsForOperation(document, position, operation) {
    if (
      !this.isCompletionOperationActive(operation)
      || !this.isCompletionDocument(document)
      || !this.isCompletionOperationActive(operation)
    ) {
      return [];
    }
    const line = document.lineAt(position.line).text;
    if (!this.isCompletionOperationActive(operation)) {
      return CANCELLED_COMPLETION;
    }
    const tagRange = isDocumentTagsContext(document, position.line)
      ? tagCompletionRange(line, position)
      : undefined;
    const argumentRange = dynamicArgumentRange(line, position);
    const quotedArgumentRange = staticArgumentRange(line, position);
    const stepRange = stepCompletionRange(line, position);
    if (!argumentRange && !quotedArgumentRange && isInsideEscapedArgument(line, position)) {
      return [];
    }
    if (!tagRange && !argumentRange && !quotedArgumentRange && !stepRange) {
      return [];
    }
    if (tagRange) {
      if (
        this.workspaceStepIndex
        && typeof this.workspaceStepIndex.tagEntries === "function"
      ) {
        return this.completeForOperation(
          operation,
          () => this.workspaceStepIndex.tagEntries(document),
          (entries) => this.tagCompletionItems(
            document,
            position,
            tagRange,
            [],
            entries,
            operation,
          ),
        );
      }
      return this.completeForOperation(
        operation,
        () => this.workspaceDocuments(operation),
        (documents) => this.tagCompletionItems(
          document,
          position,
          tagRange,
          documents,
          undefined,
          operation,
        ),
      );
    }
    if (argumentRange && isTableHeaderLine(document, position.line, { allowIndented: true })) {
      return [];
    }
    if (argumentRange && !allowsDynamicArgumentCompletion(line, document, position.line)) {
      return [];
    }
    if (quotedArgumentRange && !allowsStaticArgumentCompletion(line, document)) {
      return [];
    }
    if (argumentRange || quotedArgumentRange) {
      const targetRange = argumentRange || quotedArgumentRange;
      const range = createRange(this.vscode, position.line, targetRange.start, targetRange.end);
      const argumentType = argumentRange ? "dynamic" : "static";
      const completionItemsForLabels = (labels) => {
        if (!this.isCompletionOperationActive(operation)) {
          return CANCELLED_COMPLETION;
        }
        const localItems = [];
        for (const label of labels) {
          if (!this.isCompletionOperationActive(operation)) {
            return CANCELLED_COMPLETION;
          }
          const item = completionItem(
            this.vscode,
            label,
            range,
            argumentCompletionOptions(label, argumentType, line, targetRange),
          );
          if (!this.isCompletionOperationActive(operation)) {
            return CANCELLED_COMPLETION;
          }
          localItems.push(item);
        }
        return this.completeForOperation(
          operation,
          () => this.serverCompletionItems(document, position, range, operation),
          (items) => mergeCompletionItemsByLabel(localItems, items),
        );
      };
      if (
        this.workspaceStepIndex
        && typeof this.workspaceStepIndex.parameterEntries === "function"
      ) {
        return this.completeForOperation(
          operation,
          () => this.workspaceStepIndex.parameterEntries(
            document,
            position,
            argumentType,
          ),
          completionItemsForLabels,
        );
      }
      const labels = argumentRange
        ? (
          isConceptDocument(document)
            ? conceptDynamicArguments(document.getText())
            : unique([
              ...specDataTableHeaders(document.getText(), {
                filePath: documentPath(document),
                fileSystem: this.fileSystem,
                pathModule: this.pathModule,
                projectRoot: this.gaugeProjectRoot(document),
              }),
              ...scenarioDataTableHeaders(document.getText(), position.line),
              ...specDynamicArguments(document.getText(), position.line, {
                allowMultilineStep: allowMultilineStep({
                  fileSystem: this.fileSystem,
                  pathModule: this.pathModule,
                  projectRoot: this.gaugeProjectRoot(document),
                }),
              }),
            ])
        )
        : staticArguments(document.getText(), {
          excludeTeardown: !isConceptDocument(document),
          includeConceptHeadings: isConceptDocument(document),
        });
      return completionItemsForLabels(labels);
    }

    if (!stepRange) {
      return [];
    }

    if (
      this.workspaceStepIndex
      && typeof this.workspaceStepIndex.completionEntries === "function"
    ) {
      return this.completeForOperation(
        operation,
        () => this.workspaceStepIndex.completionEntries(document, position),
        (entries) => this.stepCompletionItems(
          document,
          position,
          stepRange,
          [],
          entries,
          operation,
        ),
      );
    }

    return this.completeForOperation(
      operation,
      () => this.workspaceDocuments(operation),
      (documents) => this.stepCompletionItems(
        document,
        position,
        stepRange,
        documents,
        undefined,
        operation,
      ),
    );
  }

  provideCompletionItems(document, position, token) {
    if (!this.isMarkdownDocumentInScope(document)) {
      return [];
    }
    return this.runCompletionOperation(
      token,
      (operation) => this.provideCompletionItemsForOperation(document, position, operation),
    );
  }

  disposeOwnedProvider(provider) {
    if (!provider || typeof provider.dispose !== "function") {
      return;
    }
    try {
      provider.dispose();
    } catch (_error) {
      // Provider cleanup cannot reactivate a terminal completion request.
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
      this.cancelCompletionOperation(operation);
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

  register() {
    if (this.disposed || this.registrationAttempted) {
      return this;
    }
    this.registrationAttempted = true;
    if (
      !this.vscode.languages
      || typeof this.vscode.languages.registerCompletionItemProvider !== "function"
    ) {
      return this;
    }
    let registration;
    try {
      registration = this.vscode.languages.registerCompletionItemProvider(
        [
          { language: GAUGE_LANGUAGE },
          { language: GAUGE_CONCEPT_LANGUAGE },
          { scheme: "file", pattern: "**/*.spec" },
          { language: MARKDOWN_LANGUAGE, scheme: "file", pattern: "**/*.md" },
          { scheme: "file", pattern: "**/*.cpt" },
        ],
        this,
        "*",
        " ",
        "<",
        "\"",
        ":",
        ",",
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
  GaugeDynamicArgumentCompletionProvider,
  conceptDynamicArguments,
  scenarioDataTableHeaders,
  specDataTableHeaders,
  staticArguments,
  isTagSourceDocument,
  parameterEntriesFromDocument,
  tagValues,
  usedStepEntriesFromDocument,
  usedStepRecordsFromDocument,
};
