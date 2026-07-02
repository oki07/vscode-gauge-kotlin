"use strict";

const {
  GaugeStepDiagnosticsProvider,
  findConceptHeadings,
  findStepFunctionsForDocument,
  isStepImplementationDocument,
} = require("./stepDiagnostics");
const { normalizeStepTemplate } = require("./stepDefinitionProvider");
const { isScenarioHashHeading } = require("./gaugeHeadings");

const TEXT_DOCUMENT_COMPLETION_REQUEST = "textDocument/completion";
const LSP_SNIPPET_INSERT_TEXT_FORMAT = 2;
const GAUGE_LANGUAGE = "gauge";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_PATTERN = /\.spec$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;

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

function isConceptDocument(document) {
  return CONCEPT_FILE_PATTERN.test(documentPath(document));
}

function isSpecDocument(document) {
  return SPEC_FILE_PATTERN.test(documentPath(document));
}

function isGaugeFileDocument(document) {
  return isSpecDocument(document) || isConceptDocument(document);
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

function isStepLine(line) {
  return line.startsWith("*");
}

function isConceptHeading(line) {
  return line.startsWith("#");
}

function isTableLine(line) {
  return line.trimStart().startsWith("|");
}

function isTableBlockStartLine(line, options = {}) {
  return options.allowIndented ? isTableLine(line) : line.startsWith("|");
}

function isTeardownLine(line) {
  return /^___+\s*$/.test(line);
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

function isIndentedInlineTableBlockLine(lines, lineNumber) {
  const startLine = tableBlockStartLine(lines, lineNumber, { allowIndented: true });
  if (startLine <= 0) {
    return false;
  }
  const startText = lines[startLine] || "";
  return isTableLine(startText) && !startText.startsWith("|") && isStepLine(lines[startLine - 1] || "");
}

function isCompletionTableBlockLine(lines, lineNumber) {
  return isTableBlockLine(lines, lineNumber) || isIndentedInlineTableBlockLine(lines, lineNumber);
}

function isTableHeaderLine(document, lineNumber, options = {}) {
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
  if (!line.startsWith("*") || position.character === 0) {
    return undefined;
  }
  const marker = /^\*[ \t]*/.exec(line);
  if (!marker) {
    return undefined;
  }
  return {
    start: Math.min(marker[0].length, position.character),
    end: Math.max(line.length, position.character),
  };
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

  const filledArgs = filledStaticArguments(prefix);
  if (filledArgs.length === 0) {
    return stepText;
  }

  let result = "";
  let offset = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    result += stepText.slice(offset, range.start);
    result += filledArgs[index] !== undefined
      ? `"${filledArgs[index]}"`
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

function specDataTableHeaders(text) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (isScenarioHeading(line)) {
      return [];
    }
    if (isStepLine(line)) {
      return [];
    }
    if (isFirstTableLine(lines, index)) {
      return unique(tableCells(line));
    }
  }
  return [];
}

function scenarioDataTableHeaders(text, lineNumber) {
  const lines = text.split(/\r?\n/);
  let scenarioLine = -1;
  for (let index = Math.min(lineNumber, lines.length - 1); index >= 0; index -= 1) {
    if (isScenarioHeading(lines[index] || "")) {
      scenarioLine = index;
      break;
    }
  }
  if (scenarioLine === -1) {
    return [];
  }

  for (let index = scenarioLine + 1; index <= Math.min(lineNumber, lines.length - 1); index += 1) {
    const line = lines[index] || "";
    if (isScenarioHeading(line) || isStepLine(line)) {
      return [];
    }
    if (isFirstTableLine(lines, index)) {
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
  if (isConceptHeading(line) || isStepLine(line)) {
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

function staticArguments(text, options = {}) {
  const values = [];
  const lines = text.split(/\r?\n/);
  const excludeTeardown = Boolean(options.excludeTeardown);
  const includeConceptHeadings = Boolean(options.includeConceptHeadings);
  for (const line of lines) {
    if (excludeTeardown && isTeardownLine(line)) {
      break;
    }
    if (!isStepLine(line) && !(includeConceptHeadings && isConceptHeading(line))) {
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

function allowsDynamicArgumentCompletion(line, document, lineNumber) {
  if (isConceptDocument(document) && isConceptHeading(line)) {
    return true;
  }
  const lines = document.getText().split(/\r?\n/);
  return isStepLine(line) || isCompletionTableBlockLine(lines, lineNumber);
}

function allowsStaticArgumentCompletion(line, document) {
  return isStepLine(line) || (isConceptDocument(document) && isConceptHeading(line));
}

function completionItem(vscode, label, range, options = {}) {
  const kind = options.kind || (vscode.CompletionItemKind && vscode.CompletionItemKind.Variable);
  const item = typeof vscode.CompletionItem === "function"
    ? new vscode.CompletionItem(label, kind)
    : { label, kind };
  item.range = range;
  if (options.detail !== undefined) {
    item.detail = options.detail;
  }
  if (options.insertText !== undefined) {
    item.insertText = options.insertText;
  }
  if (options.filterText !== undefined) {
    item.filterText = options.filterText;
  }
  return item;
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
    filterText: item.filterText,
    insertText: lspCompletionInsertText(vscode, item),
    kind: item.kind || (vscode.CompletionItemKind && vscode.CompletionItemKind.Function),
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

function stepCompletionKey(item) {
  const label = typeof item === "string"
    ? item
    : item && (item.filterText || item.label);
  return label ? normalizeStepTemplate(String(label)) : "";
}

function resolveClientsMap(clientsMap) {
  return typeof clientsMap === "function" ? clientsMap() : clientsMap;
}

class GaugeDynamicArgumentCompletionProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.clientsMap = options.clientsMap;
    this.projectFactory = options.projectFactory;
    this.diagnosticsProvider = new GaugeStepDiagnosticsProvider({
      projectFactory: this.projectFactory,
      vscode: this.vscode,
    });
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

  workspaceDocuments() {
    return this.diagnosticsProvider.workspaceDocuments();
  }

  stepCompletionEntries(document, workspaceDocuments) {
    const entries = [];
    const seen = new Set();
    const sourceRoot = this.gaugeProjectRoot(document);
    const addEntry = (label, detail) => {
      const key = stepCompletionKey(label);
      if (!label || seen.has(key)) {
        return;
      }
      seen.add(key);
      entries.push({ detail, label });
    };
    for (const candidate of workspaceDocuments || []) {
      if (
        !candidate
        || typeof candidate.getText !== "function"
        || !this.belongsToSourceGaugeProject(candidate, sourceRoot)
      ) {
        continue;
      }
      if (!isStepImplementationDocument(candidate)) {
        continue;
      }
      const externalConstants = isStepImplementationDocument(candidate)
        ? this.diagnosticsProvider.collectWorkspaceConstants(
          candidate,
          workspaceDocuments,
        )
        : undefined;
      for (const entry of findStepFunctionsForDocument(candidate, externalConstants)) {
        for (const alias of entry.aliases) {
          addEntry(alias, "step");
        }
      }
    }
    for (const candidate of workspaceDocuments || []) {
      if (
        !candidate
        || !isConceptDocument(candidate)
        || typeof candidate.getText !== "function"
        || !this.belongsToSourceGaugeProject(candidate, sourceRoot)
      ) {
        continue;
      }
      for (const heading of findConceptHeadings(candidate.getText())) {
        addEntry(heading.text, "concept");
      }
    }
    return entries;
  }

  projectClientFor(document) {
    const clientsMap = resolveClientsMap(this.clientsMap);
    if (!clientsMap || typeof clientsMap.get !== "function") {
      return undefined;
    }
    return clientsMap.get(documentPath(document));
  }

  serverStepCompletionItems(document, position, fallbackRange) {
    const projectClient = this.projectClientFor(document);
    const client = projectClient && projectClient.client;
    const uri = documentUri(document);
    if (!client || typeof client.sendRequest !== "function" || !uri) {
      return [];
    }
    return client.sendRequest(TEXT_DOCUMENT_COMPLETION_REQUEST, {
      position: {
        line: position.line,
        character: position.character,
      },
      textDocument: { uri },
    }).then(
      (response) => lspCompletionItems(response)
        .map((item) => lspCompletionItem(this.vscode, item, fallbackRange))
        .filter(Boolean),
      () => [],
    );
  }

  stepCompletionItems(document, position, targetRange, workspaceDocuments) {
    if (!this.isCompletionDocument(document)) {
      return [];
    }
    const line = document.lineAt(position.line).text;
    const prefix = line.slice(targetRange.start, position.character);
    const range = createRange(this.vscode, position.line, targetRange.start, targetRange.end);
    const kind = this.vscode.CompletionItemKind && this.vscode.CompletionItemKind.Function;
    const localItems = this.stepCompletionEntries(document, workspaceDocuments).map((entry) => completionItem(
      this.vscode,
      entry.label,
      range,
      {
        detail: entry.detail,
        filterText: stepFilterText(entry.label, prefix),
        insertText: snippetString(this.vscode, stepSnippetText(entry.label, prefix)),
        kind,
      },
    ));
    const serverItems = this.serverStepCompletionItems(document, position, range);
    if (isThenable(serverItems)) {
      return serverItems.then((items) => mergeCompletionItems(localItems, items));
    }
    return mergeCompletionItems(localItems, serverItems);
  }

  provideCompletionItems(document, position) {
    if (!this.isCompletionDocument(document)) {
      return [];
    }
    const line = document.lineAt(position.line).text;
    const argumentRange = dynamicArgumentRange(line, position);
    const quotedArgumentRange = staticArgumentRange(line, position);
    const stepRange = stepCompletionRange(line, position);
    if (!argumentRange && !quotedArgumentRange && !stepRange) {
      return [];
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
      const labels = argumentRange
        ? (
          isConceptDocument(document)
            ? conceptDynamicArguments(document.getText())
            : unique([
              ...specDataTableHeaders(document.getText()),
              ...scenarioDataTableHeaders(document.getText(), position.line),
            ])
        )
        : staticArguments(document.getText(), {
          excludeTeardown: !isConceptDocument(document),
          includeConceptHeadings: isConceptDocument(document),
        });
      const targetRange = argumentRange || quotedArgumentRange;
      const range = createRange(this.vscode, position.line, targetRange.start, targetRange.end);
      return labels.map((label) => completionItem(this.vscode, label, range));
    }

    if (!stepRange) {
      return [];
    }

    const workspaceDocuments = this.workspaceDocuments();
    if (isThenable(workspaceDocuments)) {
      return workspaceDocuments.then((documents) => (
        this.stepCompletionItems(document, position, stepRange, documents)
      ));
    }
    return this.stepCompletionItems(document, position, stepRange, workspaceDocuments);
  }
}

module.exports = {
  GaugeDynamicArgumentCompletionProvider,
  conceptDynamicArguments,
  scenarioDataTableHeaders,
  specDataTableHeaders,
  staticArguments,
};
