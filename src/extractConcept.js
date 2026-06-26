"use strict";

const nodePath = require("node:path");

const EXTRACT_CONCEPT_COMMAND = "gauge.extract.concept";
const GET_CONCEPT_FILES_REQUEST = "gauge/getImplFiles";
const INVALID_SELECTION_ERROR = "Cannot Extract to Concept, selected text contains invalid elements";
const NEW_FILE = "New File";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
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
  return /^\s*\|.*\|\s*$/.test(text);
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

function buildExtractSelection(document, selection) {
  const normalized = normalizedSelection(selection);
  if (!normalized || !document || document.languageId !== "gauge" || document.lineCount < 1) {
    return undefined;
  }

  const startLine = Math.max(0, Math.min(normalized.start.line, document.lineCount - 1));
  const endLine = selectedEndLine(document, normalized);
  if (endLine < startLine) {
    return undefined;
  }

  const blocks = [];
  const steps = [];
  let line = startLine;
  let expandedEndLine = endLine;
  while (line <= endLine) {
    const text = lineText(document, line);
    if (!isStepLine(text)) {
      return undefined;
    }

    const stepText = text.trim();
    const tableLines = [];
    const block = [stepText];
    let nextLine = line + 1;
    while (nextLine < document.lineCount && isTableLine(lineText(document, nextLine))) {
      const tableLine = lineText(document, nextLine).trim();
      tableLines.push(tableLine);
      block.push(tableLine);
      nextLine += 1;
    }

    blocks.push(block);
    steps.push({ tableLines, text: stepText });
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

function extractConceptHeadings(text) {
  return (text || "")
    .split(/\r\n|\n/)
    .map((line) => /^\s*#(?!#)\s+(.+?)\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => normalizeConceptHeading(match[1]));
}

function buildConceptDefinition(conceptName, lines, eol) {
  return [`# ${conceptName}`, ...lines].join(eol) + eol;
}

function tableKey(tableLines) {
  return tableLines.join("\n");
}

function tableCells(line) {
  const trimmed = (line || "").trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return undefined;
  }
  const cells = [];
  let cell = "";
  const body = trimmed.slice(1, -1);
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
  return index > 0 && line[index - 1] === "\\";
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

function conceptHasTableParameter(conceptName, tableName) {
  return new RegExp(`<${escapeRegExp(tableName)}>`).test(conceptName);
}

function removeTableParameters(conceptName, tableNames) {
  let usageName = conceptName;
  for (const tableName of tableNames) {
    usageName = usageName.replace(new RegExp(`\\s*<${escapeRegExp(tableName)}>`, "g"), "");
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
    if (new RegExp(escapeRegExp(parameter)).test(result)) {
      continue;
    }
    result = `${result} ${parameter}`.trim();
  }
  return result.replace(/\s+/g, " ");
}

function buildParameterizedExtraction(extraction, conceptName, eol) {
  const tables = tableParameterMap(extraction.steps);
  const sourceTables = [];
  const sourceTableKeys = new Set();
  const conceptLines = [];
  const parameterizedNames = new Set();
  const staticParameters = staticArgumentParameters(conceptName);
  const tableDynamicParameters = [];

  for (const step of extraction.steps || []) {
    if (!step.tableLines || step.tableLines.length === 0) {
      conceptLines.push(applyStaticArgumentParameters(step.text, staticParameters));
      continue;
    }

    const key = tableKey(step.tableLines);
    const tableName = tables.get(key);
    if (tableName && conceptHasTableParameter(conceptName, tableName)) {
      const conceptStep = applyStaticArgumentParameters(step.text, staticParameters);
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
      tableDynamicParameters.push(...dynamicParametersInLines(step.tableLines));
    }
  }

  const usageName = removeTableParameters(conceptName, parameterizedNames);
  return {
    conceptName: appendMissingParameters(
      parameterizedConceptName(conceptName),
      tableDynamicParameters,
    ),
    conceptLines: conceptLines.length > 0 ? conceptLines : extraction.lines,
    sourceText: [
      `* ${appendMissingParameters(usageName, tableDynamicParameters)}`,
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
  const withExtension = pathModule.extname(trimmed) ? trimmed : `${trimmed}.cpt`;
  const parsed = pathModule.parse(withExtension);
  const projectRelative = parsed.root ? withExtension.slice(parsed.root.length) : withExtension;
  return pathModule.join(projectRoot, projectRelative);
}

class ExtractConceptCommandProvider {
  constructor(clients, options = {}) {
    this.clients = clients;
    this.vscode = getVscode(options.vscode);
    this.pathModule = options.pathModule || nodePath;
    this.workspaceEditorFactory = options.workspaceEditorFactory
      || ((edit) => defaultWorkspaceEditorFactory(this.vscode, edit));
    this.disposables = [];
    this.registerCommands();
  }

  registerCommands() {
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return;
    }
    this.disposables.push(
      this.vscode.commands.registerCommand(
        EXTRACT_CONCEPT_COMMAND,
        () => this.extractConcept(),
      ),
    );
  }

  async extractConcept() {
    try {
      const editor = this.vscode.window && this.vscode.window.activeTextEditor;
      if (!editor || !editor.document || editor.document.languageId !== "gauge") {
        return this.showError("Cannot find Gauge document for extract to concept.");
      }

      const extraction = buildExtractSelection(editor.document, editor.selection);
      if (!extraction) {
        return this.showError(INVALID_SELECTION_ERROR);
      }

      const conceptNameInput = await this.vscode.window.showInputBox({
        placeHolder: "Enter the concept name",
      });
      const conceptName = normalizeConceptName(conceptNameInput);
      if (!conceptName) {
        return undefined;
      }

      const activePath = editor.document.uri.fsPath;
      const projectClient = this.clients && typeof this.clients.get === "function"
        ? this.clients.get(activePath)
        : undefined;
      if (!projectClient || !projectClient.client || !projectClient.project) {
        return this.showError("Cannot find Gauge project for extract to concept.");
      }

      const conceptFile = await this.selectConceptFile(projectClient, activePath);
      if (!conceptFile) {
        return undefined;
      }

      await this.ensureConceptNameAvailable(conceptName, conceptFile.knownFiles || []);
      const edit = await this.createWorkspaceEdit(editor.document, extraction, conceptName, conceptFile);
      const applied = await this.workspaceEditorFactory(edit).applyChanges();
      if (applied === false) {
        return this.showError("Unable to apply extract concept changes.");
      }
      return this.showInformation("Concept extracted.");
    } catch (error) {
      return this.showError(error && error.message ? error.message : String(error));
    }
  }

  async selectConceptFile(projectClient, activePath) {
    const projectRoot = projectClient.project.root();
    const files = await projectClient.client.sendRequest(
      GET_CONCEPT_FILES_REQUEST,
      { concept: true },
      createToken(this.vscode),
    );
    const selected = await this.vscode.window.showQuickPick(
      conceptFileItems(files, projectRoot, this.pathModule),
      {
        canPickMany: false,
        placeHolder: "Choose the concept file",
      },
    );
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

    const input = await this.vscode.window.showInputBox({
      placeHolder: "Enter the concept file path",
      value: this.pathModule.join(
        this.pathModule.relative(projectRoot, this.pathModule.dirname(activePath)),
        "concept.cpt",
      ),
    });
    const conceptPath = normalizeConceptFilePath(input, projectRoot, this.pathModule);
    if (!conceptPath) {
      return undefined;
    }
    return {
      isNew: true,
      knownFiles: files || [],
      path: conceptPath,
    };
  }

  async ensureConceptNameAvailable(conceptName, conceptFiles) {
    const wanted = normalizeConceptHeading(parameterizedConceptName(conceptName));
    for (const file of conceptFiles) {
      const document = await this.vscode.workspace.openTextDocument(createUri(this.vscode, file));
      const text = typeof document.getText === "function" ? document.getText() : "";
      if (extractConceptHeadings(text).includes(wanted)) {
        throw new Error(`Concept \`${conceptName}\` already present`);
      }
    }
  }

  async createWorkspaceEdit(document, extraction, conceptName, conceptFile) {
    const sourceText = typeof document.getText === "function" ? document.getText() : "";
    const eol = detectEol(sourceText);
    const parameterizedExtraction = buildParameterizedExtraction(extraction, conceptName, eol);
    const conceptDefinition = buildConceptDefinition(
      parameterizedExtraction.conceptName,
      parameterizedExtraction.conceptLines,
      eol,
    );
    const sourceUri = document.uri;
    const conceptUri = createUri(this.vscode, conceptFile.path);
    const edit = createWorkspaceEdit(this.vscode);

    const sourceEnd = replacementEnd(document, extraction.endLine);
    edit.replace(
      sourceUri,
      createRange(this.vscode, extraction.startLine, 0, sourceEnd.line, sourceEnd.character),
      `${parameterizedExtraction.sourceText}${sourceEnd.needsTrailingEol ? eol : ""}`,
    );

    if (conceptFile.isNew) {
      if (typeof edit.createFile === "function") {
        edit.createFile(conceptUri, { ignoreIfExists: true });
      }
      edit.replace(
        conceptUri,
        createRange(this.vscode, 0, 0, 0, 0),
        conceptDefinition,
      );
      return edit;
    }

    const conceptDocument = await this.vscode.workspace.openTextDocument(conceptUri);
    const existingText = typeof conceptDocument.getText === "function"
      ? conceptDocument.getText()
      : "";
    edit.replace(
      conceptUri,
      documentEndRange(this.vscode, conceptDocument),
      appendConcept(existingText, conceptDefinition, detectEol(existingText || sourceText)),
    );
    return edit;
  }

  showError(message) {
    if (this.vscode.window && typeof this.vscode.window.showErrorMessage === "function") {
      return this.vscode.window.showErrorMessage(message);
    }
    return undefined;
  }

  showInformation(message) {
    if (this.vscode.window && typeof this.vscode.window.showInformationMessage === "function") {
      return this.vscode.window.showInformationMessage(message);
    }
    return undefined;
  }

  dispose() {
    for (const disposable of this.disposables) {
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
