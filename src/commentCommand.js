"use strict";

const { isMarkdownGaugeSpecFile } = require("./gaugeSpecScope");

const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const GAUGE_FILE_EXTENSIONS = new Set([".spec", ".cpt"]);
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const DEFAULT_COMMENT_COMMAND = "editor.action.commentLine";
const REFUSED_EDIT_MESSAGE = "The edit was not applied.";

function documentPath(document) {
  return document && document.uri && document.uri.fsPath;
}

function createPosition(vscode, line, character) {
  return typeof vscode.Position === "function"
    ? new vscode.Position(line, character)
    : { line, character };
}

function createRange(vscode, startLine, startCharacter, endLine, endCharacter) {
  const start = createPosition(vscode, startLine, startCharacter);
  const end = createPosition(vscode, endLine, endCharacter);
  return typeof vscode.Range === "function"
    ? new vscode.Range(start, end)
    : { start, end };
}

function isGaugeDocument(document) {
  return document
    && (document.languageId === GAUGE_LANGUAGE || document.languageId === GAUGE_CONCEPT_LANGUAGE);
}

// A Markdown file is a Gauge specification only inside the project's configured
// gauge_specs_dir (references/gauge/util/util.go GetSpecDirs). The rule lives in
// src/gaugeSpecScope.js so every surface gives the same answer for the same file.
function isMarkdownGaugeSpec(document, options = {}) {
  return Boolean(
    document
    && document.languageId === MARKDOWN_LANGUAGE
    && isMarkdownGaugeSpecFile(documentPath(document) || "", options),
  );
}

function isGaugeFileByExtension(document) {
  const file = documentPath(document) || "";
  const lowerFile = file.toLowerCase();
  return [...GAUGE_FILE_EXTENSIONS].some((extension) => lowerFile.endsWith(extension));
}

function isGaugeProjectDocument(document, projectFactory, options = {}) {
  if (
    !isMarkdownGaugeSpec(document, { ...options, projectFactory })
    && !isGaugeDocument(document)
    && !isGaugeFileByExtension(document)
  ) {
    return false;
  }
  if (!projectFactory || typeof projectFactory.getGaugeRootFromFilePath !== "function") {
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

function selectedLineRange(selection, lineCount) {
  const startLine = Math.max(0, Math.min(selection.start.line, selection.end.line));
  let endLine = Math.max(selection.start.line, selection.end.line);
  if (selection.end.character === 0 && endLine > startLine) {
    endLine -= 1;
  }
  return {
    startLine,
    endLine: Math.min(endLine, Math.max(0, lineCount - 1)),
  };
}

function lineText(document, line) {
  if (typeof document.lineAt === "function") {
    return document.lineAt(line).text;
  }
  return String(document.getText ? document.getText() : "").split(/\r?\n/)[line] || "";
}

function leadingWhitespace(value) {
  const match = /^(\s*)/.exec(value);
  return match ? match[1] : "";
}

function isCommentedLine(value) {
  return /^\s*\/\//.test(value);
}

function commentLine(value) {
  if (!value.trim()) {
    return `${leadingWhitespace(value)}//`;
  }
  const indent = leadingWhitespace(value);
  return `${indent}// ${value.slice(indent.length)}`;
}

function uncommentLine(value) {
  return value.replace(/^(\s*)\/\/ ?/, "$1");
}

function replacementForLine(value, uncomment) {
  return uncomment ? uncommentLine(value) : commentLine(value);
}

function selectedLines(editor) {
  const document = editor.document;
  const selections = Array.isArray(editor.selections) && editor.selections.length > 0
    ? editor.selections
    : [editor.selection];
  const lines = new Set();
  for (const selection of selections) {
    if (!selection || !selection.start || !selection.end) {
      continue;
    }
    const range = selectedLineRange(selection, document.lineCount || 1);
    for (let line = range.startLine; line <= range.endLine; line += 1) {
      lines.add(line);
    }
  }
  return [...lines].sort((left, right) => left - right);
}

function delegateToDefaultComment(vscode) {
  if (vscode.commands && typeof vscode.commands.executeCommand === "function") {
    return vscode.commands.executeCommand(DEFAULT_COMMENT_COMMAND);
  }
  return undefined;
}

async function toggleGaugeLineComment(vscode, options = {}) {
  const editor = vscode.window && vscode.window.activeTextEditor;
  const document = editor && editor.document;
  if (!document || !isGaugeProjectDocument(document, options.projectFactory, {
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
  })) {
    return delegateToDefaultComment(vscode);
  }
  if (!vscode.workspace || typeof vscode.workspace.applyEdit !== "function") {
    return undefined;
  }

  const lines = selectedLines(editor);
  if (lines.length === 0) {
    return undefined;
  }
  const lineValues = lines.map((line) => ({ line, text: lineText(document, line) }));
  const nonBlankLines = lineValues.filter((entry) => entry.text.trim());
  const uncomment = nonBlankLines.length > 0
    && nonBlankLines.every((entry) => isCommentedLine(entry.text));
  const edit = new vscode.WorkspaceEdit();
  for (const entry of lineValues) {
    edit.replace(
      document.uri,
      createRange(vscode, entry.line, 0, entry.line, entry.text.length),
      replacementForLine(entry.text, uncomment),
    );
  }
  const applied = await vscode.workspace.applyEdit(edit);
  // VS Code refuses an edit whose document moved on under it and reports that by
  // resolving to false. Toggling silently would leave the user staring at
  // unchanged text, so say so, matching reportRefusedEdit in
  // src/annotator/generateStub.js.
  if (applied === false && typeof vscode.window.showErrorMessage === "function") {
    vscode.window.showErrorMessage(REFUSED_EDIT_MESSAGE);
  }
  return applied;
}

module.exports = {
  DEFAULT_COMMENT_COMMAND,
  REFUSED_EDIT_MESSAGE,
  toggleGaugeLineComment,
};
