"use strict";

const CONVERT_TO_DYNAMIC_TITLE = "Convert to Dynamic Parameter";
const CONVERT_TO_STATIC_TITLE = "Convert to Static Parameter";
const ARGUMENT_PATTERN = /"[^"\r\n]*"|<[^>\r\n]*>/g;

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

function createCodeAction(vscode, title, edit) {
  const kind = vscode.CodeActionKind && vscode.CodeActionKind.QuickFix;
  const action = typeof vscode.CodeAction === "function"
    ? new vscode.CodeAction(title, kind)
    : { title, kind };
  action.edit = edit;
  return action;
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || document.fileName || "";
}

function isConceptDocument(document) {
  return documentPath(document).toLowerCase().endsWith(".cpt");
}

function isGaugeStepOrConceptHeading(line, document) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("*")) {
    return true;
  }
  return isConceptDocument(document)
    && trimmed.startsWith("#")
    && !trimmed.startsWith("##");
}

function rangeIntersectsArgument(range, start, end) {
  const selectionStart = range.start.character;
  const selectionEnd = range.end.character;
  if (selectionStart === selectionEnd) {
    return selectionStart >= start && selectionStart < end;
  }
  return selectionStart < end && selectionEnd > start;
}

function findArgumentAt(line, range) {
  ARGUMENT_PATTERN.lastIndex = 0;
  let match = ARGUMENT_PATTERN.exec(line);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (rangeIntersectsArgument(range, start, end)) {
      return { start, end, text: match[0] };
    }
    match = ARGUMENT_PATTERN.exec(line);
  }
  return undefined;
}

class GaugeArgumentCodeActionProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
  }

  provideCodeActions(document, range) {
    const line = document.lineAt(range.start.line).text;
    if (!isGaugeStepOrConceptHeading(line, document)) {
      return [];
    }

    const argument = findArgumentAt(line, range);
    if (!argument) {
      return [];
    }

    const paramText = argument.text.substring(1, argument.text.length - 1);
    const isStatic = argument.text.startsWith("\"");
    const title = isStatic ? CONVERT_TO_DYNAMIC_TITLE : CONVERT_TO_STATIC_TITLE;
    const newText = isStatic ? `<${paramText}>` : `"${paramText}"`;
    const editRange = createRange(this.vscode, range.start.line, argument.start, argument.end);
    const edit = createWorkspaceEdit(this.vscode, document.uri, editRange, newText);
    return [createCodeAction(this.vscode, title, edit)];
  }
}

module.exports = {
  CONVERT_TO_DYNAMIC_TITLE,
  CONVERT_TO_STATIC_TITLE,
  GaugeArgumentCodeActionProvider,
};
