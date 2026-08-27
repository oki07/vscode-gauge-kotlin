"use strict";

// references/gauge/parser/lex.go isDataTable matches
// /^\s*[tT][aA][bB][lL][eE]\s*:/, so any run of whitespace may sit between the
// keyword and the colon. Verified against the real parser.
const DATA_TABLE_KEYWORD_PATTERN = /^\s*table\s*:/i;

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { allowMultilineStep } = require("./stepDefinitionProvider");

const EXTRACT_CONCEPT_COMMAND = "gauge.extract.concept";
const GET_CONCEPT_FILES_REQUEST = "gauge/getImplFiles";
const INVALID_SELECTION_ERROR = "Cannot Extract to Concept, selected text contains invalid elements";
const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const SPEC_FILE_PATTERN = /\.spec$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const NEW_FILE = "New File";
const DISPOSED_OPERATION = Symbol("disposed extract concept operation");

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createExtractOperation() {
  let rejectPublic;
  let resolveCancellation;
  let resolvePublic;
  const cancellation = new Promise((resolve) => {
    resolveCancellation = resolve;
  });
  const promise = new Promise((resolve, reject) => {
    resolvePublic = resolve;
    rejectPublic = reject;
  });
  return {
    cancellation,
    cancellationSources: new Set(),
    cancelled: false,
    completed: false,
    promise,
    publicSettled: false,
    cancel() {
      if (this.cancelled || this.completed) {
        return;
      }
      this.cancelled = true;
      resolveCancellation(DISPOSED_OPERATION);
      const sources = [...this.cancellationSources];
      this.cancellationSources.clear();
      for (const source of sources) {
        if (source && typeof source.cancel === "function") {
          source.cancel();
        }
        if (source && typeof source.dispose === "function") {
          source.dispose();
        }
      }
      if (!this.publicSettled) {
        this.publicSettled = true;
        resolvePublic(undefined);
      }
    },
    reject(error) {
      if (this.publicSettled) {
        return;
      }
      this.publicSettled = true;
      rejectPublic(error);
    },
    resolve(value) {
      if (this.publicSettled) {
        return;
      }
      this.publicSettled = true;
      resolvePublic(value);
    },
  };
}

function createPosition(vscode, line, character) {
  if (typeof vscode.Position === "function") {
    return new vscode.Position(line, character);
  }
  return { line, character };
}

function createRange(vscode, startLine, startCharacter, endLine, endCharacter) {
  const start = createPosition(vscode, startLine, startCharacter);
  const end = createPosition(vscode, endLine, endCharacter);
  if (typeof vscode.Range === "function") {
    return new vscode.Range(start, end);
  }
  return { start, end };
}

function createUri(vscode, fsPath) {
  if (vscode.Uri && typeof vscode.Uri.file === "function") {
    return vscode.Uri.file(fsPath);
  }
  return { fsPath };
}

function createWorkspaceEdit(vscode) {
  if (typeof vscode.WorkspaceEdit === "function") {
    return new vscode.WorkspaceEdit();
  }
  return {
    createdFiles: [],
    replacements: [],
    createFile(uri, options) {
      this.createdFiles.push({ uri, options });
    },
    replace(uri, range, newText) {
      this.replacements.push({ uri, range, newText });
    },
  };
}

function defaultWorkspaceEditorFactory(vscode, edit) {
  return {
    applyChanges() {
      if (vscode.workspace && typeof vscode.workspace.applyEdit === "function") {
        return vscode.workspace.applyEdit(edit);
      }
      return Promise.resolve(false);
    },
  };
}

function lineText(document, line) {
  const entry = document.lineAt(line);
  return entry && typeof entry.text === "string" ? entry.text : "";
}

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function comparePositions(left, right) {
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return left.character - right.character;
}

function normalizedSelection(selection) {
  if (!selection || !selection.start || !selection.end) {
    return undefined;
  }
  if (comparePositions(selection.start, selection.end) <= 0) {
    return { start: selection.start, end: selection.end };
  }
  return { start: selection.end, end: selection.start };
}

function isStepLine(text) {
  return /^\s*\*\s*\S.*$/.test(text);
}

function isTableLine(text) {
  return /^\s*\|.*$/.test(text);
}

function isTableStartLine(text) {
  return isTableLine(text);
}

function tableBlockBounds(document, line) {
  if (line < 0 || line >= document.lineCount || !isTableLine(lineText(document, line))) {
    return undefined;
  }

  let startLine = line;
  while (startLine > 0 && isTableLine(lineText(document, startLine - 1))) {
    startLine -= 1;
  }

  let endLine = line;
  while (endLine + 1 < document.lineCount && isTableLine(lineText(document, endLine + 1))) {
    endLine += 1;
  }

  return { endLine, startLine };
}

function owningStepTableBlock(document, line) {
  const tableBlock = tableBlockBounds(document, line);
  if (!tableBlock) {
    return undefined;
  }

  const stepLine = tableBlock.startLine - 1;
  if (stepLine < 0 || !isStepLine(lineText(document, stepLine))) {
    return undefined;
  }

  return {
    ...tableBlock,
    stepLine,
  };
}

function isDocStringFenceLine(text) {
  return String(text || "").trim() === "\"\"\"";
}

function isGaugeSyntaxBoundary(text) {
  const line = String(text || "").trim();
  return !line
    || line.startsWith("*")
    || line.startsWith("#")
    || line.toLowerCase().startsWith("tags:")
    || line.toLowerCase().startsWith("tags :")
    || DATA_TABLE_KEYWORD_PATTERN.test(line)
    || isTableLine(line)
    || isDocStringFenceLine(line)
    || /^={3,}\s*$/.test(line)
    || /^-{3,}\s*$/.test(line);
}

function multilineStepLineAt(document, lineNumber) {
  for (let currentLine = lineNumber; currentLine >= 0; currentLine -= 1) {
    const text = lineText(document, currentLine);
    if (isStepLine(text)) {
      return currentLine;
    }
    if (isGaugeSyntaxBoundary(text)) {
      return undefined;
    }
  }
  return undefined;
}

function collectDocStringLines(document, startLine) {
  if (startLine >= document.lineCount || !isDocStringFenceLine(lineText(document, startLine))) {
    return undefined;
  }

  const lines = [lineText(document, startLine).trim()];
  for (let line = startLine + 1; line < document.lineCount; line += 1) {
    const text = lineText(document, line);
    if (isDocStringFenceLine(text)) {
      lines.push(text.trim());
      return {
        endLine: line,
        lines,
      };
    }
    lines.push(text);
  }
  return undefined;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectedEndLine(document, selection) {
  let endLine = selection.end.line;
  if (selection.end.character === 0 && endLine > selection.start.line) {
    endLine -= 1;
  }
  return Math.min(endLine, document.lineCount - 1);
}

function hasExtractableGaugeSyntax(document) {
  const path = documentPath(document);
  return document
    && (
      document.languageId === GAUGE_LANGUAGE
      || document.languageId === GAUGE_CONCEPT_LANGUAGE
      || SPEC_FILE_PATTERN.test(path)
      || CONCEPT_FILE_PATTERN.test(path)
      || (
        document.languageId === MARKDOWN_LANGUAGE
        && MARKDOWN_SPEC_FILE_PATTERN.test(path)
      )
    );
}

function buildExtractSelection(document, selection, options = {}) {
  const normalized = normalizedSelection(selection);
  if (!normalized || !hasExtractableGaugeSyntax(document) || document.lineCount < 1) {
    return undefined;
  }

  let startLine = Math.max(0, Math.min(normalized.start.line, document.lineCount - 1));
  let endLine = selectedEndLine(document, normalized);
  if (endLine < startLine) {
    return undefined;
  }

  if (options.allowMultilineStep) {
    const multilineStepLine = multilineStepLineAt(document, startLine);
    if (multilineStepLine !== undefined) {
      startLine = multilineStepLine;
    }
  }

  const owningTable = owningStepTableBlock(document, startLine);
  if (owningTable) {
    if (endLine < owningTable.startLine || endLine > owningTable.endLine) {
      return undefined;
    }
    startLine = owningTable.stepLine;
    endLine = owningTable.endLine;
  }

  const blocks = [];
  const steps = [];
  let line = startLine;
  let expandedEndLine = endLine;
  while (line <= endLine) {
    const text = lineText(document, line);
    if (text.trim() === "") {
      line += 1;
      continue;
    }
    if (!isStepLine(text)) {
      return undefined;
    }

    const stepLines = [text.trim()];
    let stepEndLine = line;
    if (options.allowMultilineStep) {
      for (let nextStepLine = line + 1; nextStepLine < document.lineCount; nextStepLine += 1) {
        const nextText = lineText(document, nextStepLine);
        if (isGaugeSyntaxBoundary(nextText)) {
          break;
        }
        stepLines.push(nextText.trim());
        stepEndLine = nextStepLine;
      }
    }
    const stepText = stepLines.join(" ").trim();
    const docString = collectDocStringLines(document, stepEndLine + 1);
    const tableLines = [];
    const block = [stepText];
    let nextLine = docString ? docString.endLine + 1 : stepEndLine + 1;
    if (docString) {
      block.push(...docString.lines);
    } else if (nextLine < document.lineCount && isTableStartLine(lineText(document, nextLine))) {
      while (nextLine < document.lineCount && isTableLine(lineText(document, nextLine))) {
        const tableLine = lineText(document, nextLine).trim();
        tableLines.push(tableLine);
        block.push(tableLine);
        nextLine += 1;
      }
    }

    blocks.push(block);
    const step = { tableLines, text: stepText };
    if (docString) {
      step.docStringLines = docString.lines;
    }
    steps.push(step);
    expandedEndLine = Math.max(expandedEndLine, nextLine - 1);
    line = nextLine;
  }

  if (blocks.length === 0) {
    return undefined;
  }

  return {
    endLine: expandedEndLine,
    lines: blocks.flat(),
    startLine,
    steps,
  };
}

function normalizeConceptName(input) {
  if (!input) {
    return "";
  }
  return input.trim().replace(/^[#*]\s*/, "").trim();
}

function normalizeConceptHeading(input) {
  return normalizeConceptName(input).replace(/\s+/g, " ");
}

function isConceptLegacyUnderlineHeadingText(line) {
  return line.trim().length > 0 && !/[#*|]/.test(line);
}

function isConceptLegacyUnderline(lines, lineNumber) {
  return lineNumber + 1 < lines.length && /^[=]+$/.test(lines[lineNumber]);
}

function extractConceptHeadings(text) {
  const headings = [];
  const lines = (text || "").split(/\r\n|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const hashHeading = /^[ \t]*#+\s*(.+?)\s*$/.exec(lines[index]);
    if (hashHeading) {
      headings.push(normalizeConceptHeading(hashHeading[1]));
      continue;
    }
    if (
      index + 1 < lines.length
      && isConceptLegacyUnderlineHeadingText(lines[index])
      && isConceptLegacyUnderline(lines, index + 1)
    ) {
      headings.push(normalizeConceptHeading(lines[index]));
      index += 1;
    }
  }
  return headings;
}

function buildConceptDefinition(conceptName, lines, eol) {
  return [`# ${conceptName}`, ...lines].join(eol) + eol;
}

function tableKey(tableLines) {
  return tableLines.join("\n");
}

function tableCells(line) {
  const trimmed = (line || "").trim();
  if (!trimmed.startsWith("|")) {
    return undefined;
  }
  const cells = [];
  let cell = "";
  const body = trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed.slice(1);
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
  return cells;
}

function isEscapedPipe(line, index) {
  return isEscaped(line, index);
}

function isTableSeparator(cells) {
  return cells && cells.length > 0 && cells.every((cell) => /^-+$/.test(cell));
}

function formatGaugeTableLines(tableLines) {
  if (!Array.isArray(tableLines) || tableLines.length < 2) {
    return tableLines;
  }

  const rows = tableLines.map(tableCells);
  if (
    rows.some((row) => !row)
    || !isTableSeparator(rows[1])
    || rows.some((row) => row.length !== rows[0].length)
  ) {
    return tableLines;
  }

  const headers = rows[0];
  const dataRows = rows.slice(2);
  const widths = headers.map((header, index) => {
    const cellWidths = dataRows.map((row) => Array.from(row[index]).length);
    return Math.max(Array.from(header).length, ...cellWidths);
  });
  const formatRow = (cells) => `   |${cells.map((cell, index) => {
    const padding = widths[index] - Array.from(cell).length;
    return `${cell}${" ".repeat(Math.max(0, padding))}`;
  }).join("|")}|`;

  return [
    "",
    formatRow(headers),
    formatRow(widths.map((width) => "-".repeat(width))),
    ...dataRows.map(formatRow),
  ];
}

function tableParameterMap(steps) {
  const tables = new Map();
  let count = 0;
  for (const step of steps || []) {
    if (!step.tableLines || step.tableLines.length === 0) {
      continue;
    }
    const key = tableKey(step.tableLines);
    if (!tables.has(key)) {
      count += 1;
      tables.set(key, `table${count}`);
    }
  }
  return tables;
}

function unescapedDynamicParameterRanges(text, parameter) {
  const ranges = [];
  let openIndex = nextUnescapedDynamicStart(text, 0);
  while (openIndex !== -1) {
    const closeIndex = dynamicParameterEnd(text, openIndex);
    if (closeIndex === -1) {
      break;
    }
    const value = text.slice(openIndex, closeIndex + 1);
    if (value === parameter) {
      ranges.push({ end: closeIndex + 1, start: openIndex });
    }
    openIndex = nextUnescapedDynamicStart(text, closeIndex + 1);
  }
  return ranges;
}

function hasUnescapedDynamicParameter(text, parameter) {
  return unescapedDynamicParameterRanges(text, parameter).length > 0;
}

function conceptHasTableParameter(conceptName, tableName) {
  return hasUnescapedDynamicParameter(conceptName, `<${tableName}>`);
}

function removeTableParameters(conceptName, tableNames) {
  let usageName = conceptName;
  for (const tableName of tableNames) {
    const ranges = unescapedDynamicParameterRanges(usageName, `<${tableName}>`);
    for (const range of ranges.reverse()) {
      let start = range.start;
      while (start > 0 && /\s/.test(usageName[start - 1])) {
        start -= 1;
      }
      usageName = `${usageName.slice(0, start)}${usageName.slice(range.end)}`;
    }
  }
  return usageName.trim().replace(/\s+/g, " ");
}

function toDynamicParameterName(value) {
  return value.replace(/</g, "{").replace(/>/g, "}");
}

function staticArgumentParameters(conceptName) {
  const parameters = [];
  let index = 0;
  while (index < conceptName.length) {
    if (conceptName[index] !== "\"") {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    let escaped = false;
    while (index < conceptName.length) {
      const character = conceptName[index];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        break;
      }
      index += 1;
    }
    if (index >= conceptName.length) {
      break;
    }
    const original = conceptName.slice(start, index + 1);
    const value = conceptName.slice(start + 1, index);
    parameters.push({
      dynamic: `<${toDynamicParameterName(value)}>`,
      original,
    });
    index += 1;
  }
  return parameters;
}

function applyStaticArgumentParameters(text, parameters) {
  let parameterized = text;
  for (const parameter of parameters) {
    parameterized = parameterized.replace(
      new RegExp(escapeRegExp(parameter.original), "g"),
      parameter.dynamic,
    );
  }
  return parameterized;
}

function parameterizedConceptName(conceptName) {
  return applyStaticArgumentParameters(
    conceptName,
    staticArgumentParameters(conceptName),
  );
}

function staticArgumentEnd(line, openIndex) {
  let escaped = false;
  for (let index = openIndex + 1; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "\"") {
      return index;
    }
  }
  return -1;
}

function conceptNameParameterSuggestionsInLine(line) {
  const suggestions = [];
  let index = 0;
  while (index < line.length) {
    const character = line[index];
    if (character === "\"" && !isEscaped(line, index)) {
      const closeIndex = staticArgumentEnd(line, index);
      if (closeIndex === -1) {
        break;
      }
      suggestions.push(line.slice(index, closeIndex + 1));
      index = closeIndex + 1;
      continue;
    }
    if (character === "<" && !isEscaped(line, index)) {
      const closeIndex = dynamicParameterEnd(line, index);
      if (closeIndex === -1) {
        break;
      }
      suggestions.push(line.slice(index, closeIndex + 1));
      index = closeIndex + 1;
      continue;
    }
    index += 1;
  }
  return suggestions;
}

function conceptNameParameterSuggestions(extraction) {
  const suggestions = [];
  const seen = new Set();
  const tables = tableParameterMap(extraction && extraction.steps);
  function add(value) {
    if (!seen.has(value)) {
      seen.add(value);
      suggestions.push(value);
    }
  }
  for (const step of (extraction && extraction.steps) || []) {
    const key = tableKey(step.tableLines || []);
    const tableName = tables.get(key);
    const line = tableName ? `${step.text} <${tableName}>` : step.text;
    for (const suggestion of conceptNameParameterSuggestionsInLine(line)) {
      add(suggestion);
    }
  }
  return suggestions;
}

function conceptNameInputOptions(extraction) {
  const options = {
    placeHolder: "Enter the concept name",
  };
  const suggestions = conceptNameParameterSuggestions(extraction);
  if (suggestions.length > 0) {
    options.prompt = `Available parameters: ${suggestions.join(", ")}`;
  }
  return options;
}

function dynamicParametersInLines(lines) {
  const parameters = [];
  const seen = new Set();
  for (const line of lines || []) {
    let openIndex = nextUnescapedDynamicStart(line, 0);
    while (openIndex !== -1) {
      const closeIndex = dynamicParameterEnd(line, openIndex);
      if (closeIndex === -1) {
        break;
      }
      const parameter = line.slice(openIndex, closeIndex + 1);
      if (!seen.has(parameter)) {
        seen.add(parameter);
        parameters.push(parameter);
      }
      openIndex = nextUnescapedDynamicStart(line, closeIndex + 1);
    }
  }
  return parameters;
}

function nextUnescapedDynamicStart(line, startIndex) {
  for (let index = startIndex; index < line.length; index += 1) {
    if (line[index] === "<" && !isEscaped(line, index)) {
      return index;
    }
  }
  return -1;
}

function dynamicParameterEnd(line, openIndex) {
  let escaped = false;
  for (let index = openIndex + 1; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function isEscaped(line, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function appendMissingParameters(name, parameters) {
  let result = name.trim();
  for (const parameter of parameters) {
    if (hasUnescapedDynamicParameter(result, parameter)) {
      continue;
    }
    result = `${result} ${parameter}`.trim();
  }
  return result.replace(/\s+/g, " ");
}

function appendUniqueParameters(target, parameters) {
  for (const parameter of parameters) {
    if (!target.includes(parameter)) {
      target.push(parameter);
    }
  }
}

function buildParameterizedExtraction(extraction, conceptName, eol) {
  const tables = tableParameterMap(extraction.steps);
  const sourceTables = [];
  const sourceTableKeys = new Set();
  const conceptLines = [];
  const parameterizedNames = new Set();
  const staticParameters = staticArgumentParameters(conceptName);
  const stepDynamicParameters = [];
  const tableDynamicParameters = [];

  for (const step of extraction.steps || []) {
    const conceptStep = applyStaticArgumentParameters(step.text, staticParameters);
    const conceptStepBlock = step.docStringLines && step.docStringLines.length > 0
      ? [conceptStep, ...step.docStringLines]
      : [conceptStep];
    appendUniqueParameters(stepDynamicParameters, dynamicParametersInLines([step.text]));
    if (!step.tableLines || step.tableLines.length === 0) {
      conceptLines.push(...conceptStepBlock);
      continue;
    }

    const key = tableKey(step.tableLines);
    const tableName = tables.get(key);
    if (tableName && conceptHasTableParameter(conceptName, tableName)) {
      conceptLines.push(`${conceptStep} <${tableName}>`);
      parameterizedNames.add(tableName);
      if (!sourceTableKeys.has(key)) {
        sourceTables.push(...formatGaugeTableLines(step.tableLines));
        sourceTableKeys.add(key);
      }
    } else {
      conceptLines.push(
        applyStaticArgumentParameters(step.text, staticParameters),
        ...formatGaugeTableLines(step.tableLines),
      );
      appendUniqueParameters(tableDynamicParameters, dynamicParametersInLines(step.tableLines));
    }
  }

  const missingParameters = [...stepDynamicParameters, ...tableDynamicParameters];
  const usageName = removeTableParameters(conceptName, parameterizedNames);
  return {
    conceptName: appendMissingParameters(
      parameterizedConceptName(conceptName),
      missingParameters,
    ),
    conceptLines: conceptLines.length > 0 ? conceptLines : extraction.lines,
    sourceText: [
      `* ${appendMissingParameters(usageName, missingParameters)}`,
      ...sourceTables,
    ].join(eol),
  };
}

function appendConcept(existingText, conceptDefinition, eol) {
  if (!existingText || existingText.trim() === "") {
    return conceptDefinition;
  }
  return `${existingText.trimEnd()}${eol}${eol}${conceptDefinition}`;
}

function documentEndRange(vscode, document) {
  if (!document || document.lineCount < 1) {
    return createRange(vscode, 0, 0, 0, 0);
  }
  const lastLine = document.lineCount - 1;
  return createRange(vscode, 0, 0, lastLine, lineText(document, lastLine).length);
}

function replacementEnd(document, endLine) {
  const nextLine = endLine + 1;
  if (nextLine < document.lineCount) {
    return {
      character: 0,
      line: nextLine,
      needsTrailingEol: true,
    };
  }
  return {
    character: lineText(document, endLine).length,
    line: endLine,
    needsTrailingEol: false,
  };
}

function conceptFileItems(files, projectRoot, pathModule) {
  const items = [
    { label: NEW_FILE, description: "Create a new concept file", value: NEW_FILE },
  ];
  return items.concat((files || []).map((file) => ({
    label: pathModule.basename(file),
    description: pathModule.relative(projectRoot, pathModule.dirname(file)),
    value: file,
  })));
}

function normalizeConceptFilePath(file, projectRoot, pathModule) {
  const trimmed = (file || "").trim();
  if (!trimmed) {
    return undefined;
  }
  const extension = pathModule.extname(trimmed);
  if (extension && extension.toLowerCase() !== ".cpt") {
    return undefined;
  }
  const withExtension = extension ? trimmed : `${trimmed}.cpt`;
  const parsed = pathModule.parse(withExtension);
  const projectRelative = parsed.root ? withExtension.slice(parsed.root.length) : withExtension;
  return pathModule.join(projectRoot, projectRelative);
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function canExtractConceptFromDocument(document, projectClient) {
  if (!document) {
    return false;
  }
  const hasProjectClient = Boolean(projectClient && projectClient.client && projectClient.project);
  if (document.languageId === GAUGE_LANGUAGE || document.languageId === GAUGE_CONCEPT_LANGUAGE) {
    return hasProjectClient;
  }
  if (SPEC_FILE_PATTERN.test(documentPath(document))) {
    return hasProjectClient;
  }
  if (CONCEPT_FILE_PATTERN.test(documentPath(document))) {
    return hasProjectClient;
  }
  return document.languageId === MARKDOWN_LANGUAGE
    && MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document))
    && hasProjectClient;
}

class ExtractConceptCommandProvider {
  constructor(clients, options = {}) {
    this.clients = clients;
    this.fileSystem = options.fileSystem || nodeFs;
    this.vscode = getVscode(options.vscode);
    this.pathModule = options.pathModule || nodePath;
    this.workspaceEditorFactory = options.workspaceEditorFactory
      || ((edit) => defaultWorkspaceEditorFactory(this.vscode, edit));
    this.activeOperations = new Set();
    this.disposed = false;
    this.disposables = [];
    this.registerCommands();
  }

  registerCommands() {
    if (this.disposed) {
      return;
    }
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return;
    }
    const disposable = this.vscode.commands.registerCommand(
      EXTRACT_CONCEPT_COMMAND,
      () => this.extractConcept(),
    );
    if (this.disposed) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
      return;
    }
    this.disposables.push(disposable);
  }

  extractConcept() {
    if (this.disposed) {
      return Promise.resolve(undefined);
    }
    const operation = createExtractOperation();
    this.activeOperations.add(operation);
    let work;
    try {
      work = this.extractConceptForOperation(operation);
    } catch (error) {
      this.finishOperation(operation, "reject", error);
      return operation.promise;
    }
    Promise.resolve(work).then(
      (value) => {
        const result = this.operationStopped(operation) || value === DISPOSED_OPERATION
          ? undefined
          : value;
        this.finishOperation(operation, "resolve", result);
      },
      (error) => {
        if (this.operationStopped(operation)) {
          this.finishOperation(operation, "resolve", undefined);
          return;
        }
        this.finishOperation(operation, "reject", error);
      },
    );
    return operation.promise;
  }

  async extractConceptForOperation(operation) {
    try {
      const editor = this.callSyncForOperation(
        operation,
        () => this.vscode.window && this.vscode.window.activeTextEditor,
      );
      if (editor === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const activePath = this.callSyncForOperation(
        operation,
        () => documentPath(editor && editor.document),
      );
      if (activePath === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const projectClient = this.callSyncForOperation(
        operation,
        () => (activePath && this.clients && typeof this.clients.get === "function"
          ? this.clients.get(activePath)
          : undefined),
      );
      if (projectClient === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      if (!editor || !canExtractConceptFromDocument(editor.document, projectClient)) {
        return this.showErrorForOperation(
          operation,
          "Cannot find Gauge document for extract to concept.",
        );
      }

      const extraction = this.callSyncForOperation(
        operation,
        () => buildExtractSelection(editor.document, editor.selection, {
          allowMultilineStep: this.allowsMultilineStep(projectClient),
        }),
      );
      if (extraction === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      if (!extraction) {
        return this.showErrorForOperation(operation, INVALID_SELECTION_ERROR);
      }

      const conceptNameInput = await this.callForOperation(
        operation,
        () => this.vscode.window.showInputBox(conceptNameInputOptions(extraction)),
      );
      if (conceptNameInput === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const conceptName = this.callSyncForOperation(
        operation,
        () => normalizeConceptName(conceptNameInput),
      );
      if (conceptName === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      if (!conceptName) {
        return undefined;
      }

      if (!projectClient || !projectClient.client || !projectClient.project) {
        return this.showErrorForOperation(
          operation,
          "Cannot find Gauge project for extract to concept.",
        );
      }

      const conceptFile = await this.selectConceptFile(operation, projectClient, activePath);
      if (conceptFile === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      if (!conceptFile) {
        return undefined;
      }

      const available = await this.ensureConceptNameAvailable(
        operation,
        conceptName,
        conceptFile.knownFiles || [],
      );
      if (available === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const edit = await this.createWorkspaceEdit(
        operation,
        editor.document,
        extraction,
        conceptName,
        conceptFile,
      );
      if (edit === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const workspaceEditor = this.callSyncForOperation(
        operation,
        () => this.workspaceEditorFactory(edit),
      );
      if (workspaceEditor === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const applied = await this.callForOperation(
        operation,
        () => workspaceEditor.applyChanges(),
      );
      if (applied === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      if (applied === false) {
        return this.showErrorForOperation(
          operation,
          "Unable to apply extract concept changes.",
        );
      }
      return this.showInformationForOperation(operation, "Concept extracted.");
    } catch (error) {
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      return this.showErrorForOperation(
        operation,
        error && error.message ? error.message : String(error),
      );
    }
  }

  allowsMultilineStep(projectClient) {
    const projectRoot = projectClient
      && projectClient.project
      && typeof projectClient.project.root === "function"
        ? projectClient.project.root()
        : undefined;
    return allowMultilineStep({
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectRoot,
    });
  }

  async selectConceptFile(operation, projectClient, activePath) {
    const projectRoot = this.callSyncForOperation(
      operation,
      () => projectClient.project.root(),
    );
    if (projectRoot === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    const files = await this.requestForOperation(
      operation,
      (token) => projectClient.client.sendRequest(
        GET_CONCEPT_FILES_REQUEST,
        { concept: true },
        token,
      ),
    );
    if (files === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    const selected = await this.callForOperation(
      operation,
      () => this.vscode.window.showQuickPick(
        conceptFileItems(files, projectRoot, this.pathModule),
        {
          canPickMany: false,
          placeHolder: "Choose the concept file",
        },
      ),
    );
    if (selected === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (!selected) {
      return undefined;
    }
    if (selected.value !== NEW_FILE) {
      return {
        isNew: false,
        knownFiles: files || [],
        path: selected.value,
      };
    }

    const input = await this.callForOperation(
      operation,
      () => this.vscode.window.showInputBox({
        placeHolder: "Enter the concept file path",
        value: this.pathModule.join(
          this.pathModule.relative(projectRoot, this.pathModule.dirname(activePath)),
          "concept.cpt",
        ),
      }),
    );
    if (input === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    const conceptPath = this.callSyncForOperation(
      operation,
      () => normalizeConceptFilePath(input, projectRoot, this.pathModule),
    );
    if (conceptPath === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    if (!conceptPath) {
      if (input && input.trim()) {
        const shown = await this.showErrorForOperation(
          operation,
          "Concept file path must end with .cpt.",
        );
        if (shown === DISPOSED_OPERATION) {
          return DISPOSED_OPERATION;
        }
      }
      return undefined;
    }
    return {
      isNew: true,
      knownFiles: files || [],
      path: conceptPath,
    };
  }

  async ensureConceptNameAvailable(operation, conceptName, conceptFiles) {
    const wanted = this.callSyncForOperation(
      operation,
      () => normalizeConceptHeading(parameterizedConceptName(conceptName)),
    );
    if (wanted === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    for (const file of conceptFiles) {
      const document = await this.callForOperation(
        operation,
        () => this.vscode.workspace.openTextDocument(createUri(this.vscode, file)),
      );
      if (document === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      const text = this.callSyncForOperation(
        operation,
        () => (typeof document.getText === "function" ? document.getText() : ""),
      );
      if (text === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      if (extractConceptHeadings(text).includes(wanted)) {
        throw new Error(`Concept \`${conceptName}\` already present`);
      }
    }
    return undefined;
  }

  async createWorkspaceEdit(operation, document, extraction, conceptName, conceptFile) {
    const prepared = this.callSyncForOperation(
      operation,
      () => {
        const sourceText = typeof document.getText === "function" ? document.getText() : "";
        const eol = detectEol(sourceText);
        const parameterizedExtraction = buildParameterizedExtraction(extraction, conceptName, eol);
        return {
          conceptDefinition: buildConceptDefinition(
            parameterizedExtraction.conceptName,
            parameterizedExtraction.conceptLines,
            eol,
          ),
          edit: createWorkspaceEdit(this.vscode),
          eol,
          parameterizedExtraction,
          sourceText,
        };
      },
    );
    if (prepared === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    const {
      conceptDefinition,
      edit,
      eol,
      parameterizedExtraction,
      sourceText,
    } = prepared;
    const sourceUri = document.uri;
    const conceptUri = createUri(this.vscode, conceptFile.path);

    const sourcePrepared = this.callSyncForOperation(
      operation,
      () => {
        const sourceEnd = replacementEnd(document, extraction.endLine);
        edit.replace(
          sourceUri,
          createRange(this.vscode, extraction.startLine, 0, sourceEnd.line, sourceEnd.character),
          `${parameterizedExtraction.sourceText}${sourceEnd.needsTrailingEol ? eol : ""}`,
        );
      },
    );
    if (sourcePrepared === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }

    if (conceptFile.isNew) {
      const newFilePrepared = this.callSyncForOperation(
        operation,
        () => {
          if (typeof edit.createFile === "function") {
            edit.createFile(conceptUri, { ignoreIfExists: true });
          }
          edit.replace(
            conceptUri,
            createRange(this.vscode, 0, 0, 0, 0),
            conceptDefinition,
          );
        },
      );
      if (newFilePrepared === DISPOSED_OPERATION) {
        return DISPOSED_OPERATION;
      }
      return edit;
    }

    const conceptDocument = await this.callForOperation(
      operation,
      () => this.vscode.workspace.openTextDocument(conceptUri),
    );
    if (conceptDocument === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    const conceptPrepared = this.callSyncForOperation(
      operation,
      () => {
        const existingText = typeof conceptDocument.getText === "function"
          ? conceptDocument.getText()
          : "";
        edit.replace(
          conceptUri,
          documentEndRange(this.vscode, conceptDocument),
          appendConcept(existingText, conceptDefinition, detectEol(existingText || sourceText)),
        );
      },
    );
    if (conceptPrepared === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    return edit;
  }

  createRequestSource(operation) {
    if (this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    if (typeof this.vscode.CancellationTokenSource !== "function") {
      return { release() {}, token: undefined };
    }
    let source;
    try {
      source = new this.vscode.CancellationTokenSource();
    } catch (error) {
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      throw error;
    }
    if (this.operationStopped(operation)) {
      if (source && typeof source.cancel === "function") {
        source.cancel();
      }
      if (source && typeof source.dispose === "function") {
        source.dispose();
      }
      return DISPOSED_OPERATION;
    }
    operation.cancellationSources.add(source);
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        if (!operation.cancellationSources.delete(source)) {
          return;
        }
        if (source && typeof source.dispose === "function") {
          source.dispose();
        }
      },
      token: source && source.token,
    };
  }

  async requestForOperation(operation, callback) {
    const source = this.createRequestSource(operation);
    if (source === DISPOSED_OPERATION) {
      return DISPOSED_OPERATION;
    }
    try {
      return await this.callForOperation(operation, () => callback(source.token));
    } finally {
      source.release();
    }
  }

  callSyncForOperation(operation, callback) {
    if (this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    let value;
    try {
      value = callback();
    } catch (error) {
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      throw error;
    }
    return this.operationStopped(operation) ? DISPOSED_OPERATION : value;
  }

  callForOperation(operation, callback) {
    if (this.operationStopped(operation)) {
      return Promise.resolve(DISPOSED_OPERATION);
    }
    let value;
    try {
      value = callback();
    } catch (error) {
      if (this.operationStopped(operation)) {
        return Promise.resolve(DISPOSED_OPERATION);
      }
      return Promise.reject(error);
    }
    if (this.operationStopped(operation)) {
      Promise.resolve(value).catch(() => undefined);
      return Promise.resolve(DISPOSED_OPERATION);
    }
    return this.awaitOperation(operation, value);
  }

  async awaitOperation(operation, value) {
    if (this.operationStopped(operation)) {
      return DISPOSED_OPERATION;
    }
    try {
      const result = await Promise.race([
        Promise.resolve(value),
        operation.cancellation,
      ]);
      if (result === DISPOSED_OPERATION || this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      return result;
    } catch (error) {
      if (this.operationStopped(operation)) {
        return DISPOSED_OPERATION;
      }
      throw error;
    }
  }

  operationStopped(operation) {
    return this.disposed || !operation || operation.cancelled;
  }

  finishOperation(operation, outcome, value) {
    if (operation.completed) {
      return;
    }
    operation.completed = true;
    this.activeOperations.delete(operation);
    const sources = [...operation.cancellationSources];
    operation.cancellationSources.clear();
    for (const source of sources) {
      if (source && typeof source.dispose === "function") {
        source.dispose();
      }
    }
    if (outcome === "reject") {
      operation.reject(value);
      return;
    }
    operation.resolve(value);
  }

  showErrorForOperation(operation, message) {
    return this.callForOperation(operation, () => this.showError(message));
  }

  showInformationForOperation(operation, message) {
    return this.callForOperation(operation, () => this.showInformation(message));
  }

  showError(message) {
    if (this.disposed) {
      return undefined;
    }
    if (this.vscode.window && typeof this.vscode.window.showErrorMessage === "function") {
      return this.vscode.window.showErrorMessage(message);
    }
    return undefined;
  }

  showInformation(message) {
    if (this.disposed) {
      return undefined;
    }
    if (this.vscode.window && typeof this.vscode.window.showInformationMessage === "function") {
      return this.vscode.window.showInformationMessage(message);
    }
    return undefined;
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const operations = [...this.activeOperations];
    this.activeOperations.clear();
    for (const operation of operations) {
      operation.cancel();
    }
    const disposables = this.disposables;
    this.disposables = [];
    for (const disposable of disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
  }
}

module.exports = {
  EXTRACT_CONCEPT_COMMAND,
  ExtractConceptCommandProvider,
  INVALID_SELECTION_ERROR,
  buildExtractSelection,
};
