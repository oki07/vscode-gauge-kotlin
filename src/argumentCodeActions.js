"use strict";

const { GaugeStepCodeActionProvider } = require("./stepCodeActions");

const CONVERT_TO_DYNAMIC_TITLE = "Convert to Dynamic Parameter";
const CONVERT_TO_STATIC_TITLE = "Convert to Static Parameter";
const SELECT_ARGUMENT_RANGE_COMMAND = "gauge.selectArgumentRange";
const SELECT_ARGUMENT_RANGE_TITLE = "Select Gauge Argument";
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

function createWorkspaceEdit(vscode, uri, range, newText) {
  if (typeof vscode.WorkspaceEdit === "function") {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, newText);
    return edit;
  }
  return {
    replacements: [{ uri, range, newText }],
  };
}

function createCodeAction(vscode, title, edit, command) {
  const kind = vscode.CodeActionKind && vscode.CodeActionKind.QuickFix;
  const action = typeof vscode.CodeAction === "function"
    ? new vscode.CodeAction(title, kind)
    : { title, kind };
  action.edit = edit;
  action.command = command;
  return action;
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || document.fileName || "";
}

function isConceptDocument(document) {
  return CONCEPT_FILE_PATTERN.test(documentPath(document));
}

function isSpecDocument(document) {
  return SPEC_FILE_PATTERN.test(documentPath(document));
}

function isMarkdownDocument(document) {
  return document
    && document.languageId === "markdown"
    && MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document));
}

function isGaugeFileDocument(document) {
  return isSpecDocument(document) || isConceptDocument(document) || isMarkdownDocument(document);
}

function isGaugeProjectDocument(document, projectFactory) {
  if (!isGaugeFileDocument(document) || !projectFactory) {
    return true;
  }
  if (typeof projectFactory.getGaugeRootFromFilePath !== "function") {
    return true;
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

function isConceptHeadingLine(line, document) {
  return isConceptDocument(document) && line.startsWith("#");
}

function uriPath(uri) {
  return (uri && (uri.fsPath || uri.path)) || "";
}

function isGaugeStepOrConceptHeading(line, document) {
  const marker = String(line || "").search(/\S/);
  if (marker !== -1 && line[marker] === "*") {
    return true;
  }
  return isConceptHeadingLine(line, document);
}

function rangeIntersectsArgument(range, start, end) {
  const selectionStart = range.start.character;
  const selectionEnd = range.end.character;
  if (selectionStart === selectionEnd) {
    return selectionStart >= start && selectionStart < end;
  }
  return selectionStart < end && selectionEnd > start;
}

function closingQuoteIndex(line, openIndex) {
  return closingEscapedArgumentIndex(line, openIndex, "\"");
}

function closingAngleIndex(line, openIndex) {
  return closingEscapedArgumentIndex(line, openIndex, ">");
}

function closingEscapedArgumentIndex(line, openIndex, closeCharacter) {
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
    }
    index += 1;
  }
  return -1;
}

function isEscapedCharacter(line, index) {
  let backslashCount = 0;
  let cursor = index - 1;
  while (cursor >= 0 && line[cursor] === "\\") {
    backslashCount += 1;
    cursor -= 1;
  }
  return backslashCount % 2 === 1;
}

function findArgumentAt(line, range) {
  let index = 0;
  while (index < line.length) {
    const character = line[index];
    if ((character === "\"" || character === "<") && isEscapedCharacter(line, index)) {
      index += 1;
      continue;
    }
    const closeIndex = character === "\""
      ? closingQuoteIndex(line, index)
      : (character === "<" ? closingAngleIndex(line, index) : -1);
    if (closeIndex === -1) {
      index += 1;
      continue;
    }
    const start = index;
    const end = closeIndex + 1;
    if (rangeIntersectsArgument(range, start, end)) {
      return { start, end, text: line.slice(start, end) };
    }
    index = end;
  }
  return undefined;
}

class GaugeArgumentCodeActionProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
    this.stepCodeActionProvider = options.stepCodeActionProvider
      || new GaugeStepCodeActionProvider({
        projectFactory: this.projectFactory,
        vscode: this.vscode,
      });
  }

  provideCodeActions(document, range, context) {
    if (!isGaugeProjectDocument(document, this.projectFactory)) {
      return [];
    }
    const stepActions = this.stepCodeActionProvider.provideCodeActions(document, range, context);
    const line = document.lineAt(range.start.line).text;
    if (!isGaugeStepOrConceptHeading(line, document)) {
      return stepActions;
    }

    const argument = findArgumentAt(line, range);
    if (!argument) {
      return stepActions;
    }

    const paramText = argument.text.substring(1, argument.text.length - 1);
    const isStatic = argument.text.startsWith("\"");
    const title = isStatic ? CONVERT_TO_DYNAMIC_TITLE : CONVERT_TO_STATIC_TITLE;
    const newText = isStatic ? `<${paramText}>` : `"${paramText}"`;
    const editRange = createRange(this.vscode, range.start.line, argument.start, argument.end);
    const edit = createWorkspaceEdit(this.vscode, document.uri, editRange, newText);
    const selectionRange = createRange(
      this.vscode,
      range.start.line,
      argument.start + 1,
      argument.start + newText.length - 1,
    );
    const command = {
      command: SELECT_ARGUMENT_RANGE_COMMAND,
      title: SELECT_ARGUMENT_RANGE_TITLE,
      arguments: [document.uri, selectionRange],
    };
    return stepActions.concat([createCodeAction(this.vscode, title, edit, command)]);
  }
}

function selectArgumentRange(vscode, uri, range) {
  const editor = vscode.window && vscode.window.activeTextEditor;
  if (!editor || uriPath(editor.document && editor.document.uri) !== uriPath(uri)) {
    return undefined;
  }
  const selection = typeof vscode.Selection === "function"
    ? new vscode.Selection(range.start, range.end)
    : { start: range.start, end: range.end };
  editor.selection = selection;
  return selection;
}

function registerArgumentSelectionCommand(vscode) {
  if (!vscode.commands || typeof vscode.commands.registerCommand !== "function") {
    return undefined;
  }
  return vscode.commands.registerCommand(
    SELECT_ARGUMENT_RANGE_COMMAND,
    (uri, range) => selectArgumentRange(vscode, uri, range),
  );
}

module.exports = {
  CONVERT_TO_DYNAMIC_TITLE,
  CONVERT_TO_STATIC_TITLE,
  GaugeArgumentCodeActionProvider,
  SELECT_ARGUMENT_RANGE_COMMAND,
  registerArgumentSelectionCommand,
  selectArgumentRange,
};
