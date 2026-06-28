"use strict";

const {
  GaugeStepDiagnosticsProvider,
  findConceptHeadings,
  findStepFunctions,
  isKotlinDocument,
} = require("./stepDiagnostics");

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

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || document.fileName || "";
}

function isConceptDocument(document) {
  return documentPath(document).toLowerCase().endsWith(".cpt");
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
  return line.trimStart().startsWith("##");
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

function conceptDynamicArguments(text) {
  const values = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!isConceptHeading(line) && !isStepLine(line)) {
      continue;
    }
    let openIndex = line.indexOf("<");
    while (openIndex !== -1) {
      if (isEscapedCharacter(line, openIndex)) {
        openIndex = line.indexOf("<", openIndex + 1);
        continue;
      }
      const closeIndex = closingAngleIndex(line, openIndex);
      if (closeIndex === -1) {
        break;
      }
      const value = line.slice(openIndex + 1, closeIndex).trim();
      if (value) {
        values.push(value);
      }
      openIndex = line.indexOf("<", closeIndex + 1);
    }
  }
  return unique(values);
}

function staticArguments(text, options = {}) {
  const values = [];
  const lines = text.split(/\r?\n/);
  const excludeTeardown = Boolean(options.excludeTeardown);
  for (const line of lines) {
    if (excludeTeardown && isTeardownLine(line)) {
      break;
    }
    if (!isStepLine(line)) {
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

function allowsStaticArgumentCompletion(line) {
  return isStepLine(line);
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

class GaugeDynamicArgumentCompletionProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
    this.diagnosticsProvider = new GaugeStepDiagnosticsProvider({
      projectFactory: this.projectFactory,
      vscode: this.vscode,
    });
  }

  isGaugeProjectDocument(document) {
    return this.diagnosticsProvider.isGaugeProjectDocument(document);
  }

  workspaceDocuments() {
    return this.diagnosticsProvider.workspaceDocuments();
  }

  stepCompletionEntries(workspaceDocuments) {
    const entries = [];
    const seen = new Set();
    const addEntry = (label, detail) => {
      if (!label || seen.has(label)) {
        return;
      }
      seen.add(label);
      entries.push({ detail, label });
    };
    for (const candidate of workspaceDocuments || []) {
      if (
        !candidate
        || typeof candidate.getText !== "function"
        || !this.isGaugeProjectDocument(candidate)
      ) {
        continue;
      }
      if (!isKotlinDocument(candidate)) {
        continue;
      }
      const text = candidate.getText();
      const externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(
        candidate,
        workspaceDocuments,
      );
      for (const entry of findStepFunctions(text, externalConstants)) {
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
        || !this.isGaugeProjectDocument(candidate)
      ) {
        continue;
      }
      for (const heading of findConceptHeadings(candidate.getText())) {
        addEntry(heading.text, "concept");
      }
    }
    return entries;
  }

  stepCompletionItems(document, position, targetRange, workspaceDocuments) {
    if (!document || document.languageId !== "gauge" || !this.isGaugeProjectDocument(document)) {
      return [];
    }
    const line = document.lineAt(position.line).text;
    const prefix = line.slice(targetRange.start, position.character);
    const range = createRange(this.vscode, position.line, targetRange.start, targetRange.end);
    const kind = this.vscode.CompletionItemKind && this.vscode.CompletionItemKind.Function;
    return this.stepCompletionEntries(workspaceDocuments).map((entry) => completionItem(
      this.vscode,
      entry.label,
      range,
      {
        detail: entry.detail,
        filterText: entry.label,
        insertText: snippetString(this.vscode, stepSnippetText(entry.label, prefix)),
        kind,
      },
    ));
  }

  provideCompletionItems(document, position) {
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
    if (quotedArgumentRange && !allowsStaticArgumentCompletion(line)) {
      return [];
    }
    if (argumentRange || quotedArgumentRange) {
      const labels = argumentRange
        ? (
          isConceptDocument(document)
            ? conceptDynamicArguments(document.getText())
            : specDataTableHeaders(document.getText())
        )
        : staticArguments(document.getText(), { excludeTeardown: !isConceptDocument(document) });
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
  specDataTableHeaders,
  staticArguments,
};
