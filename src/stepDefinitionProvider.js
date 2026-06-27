"use strict";

const {
  GaugeStepDiagnosticsProvider,
  findStepFunctions,
  positionAt,
} = require("./stepDiagnostics");

const GAUGE_LANGUAGE = "gauge";
const KOTLIN_LANGUAGE = "kotlin";

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

function createLocation(vscode, uri, range) {
  if (typeof vscode.Location === "function") {
    return new vscode.Location(uri, range);
  }
  return { uri, range };
}

function isEscapedAt(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findParameterEnd(text, startIndex, closeCharacter) {
  let index = startIndex + 1;
  while (index < text.length) {
    if (text[index] === "\\" && closeCharacter === "\"") {
      index += 2;
      continue;
    }
    if (text[index] === closeCharacter && !isEscapedAt(text, index)) {
      return index;
    }
    index += 1;
  }
  return -1;
}

function nextParameter(text, startIndex) {
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
    return { closeCharacter: ">", start: dynamicIndex };
  }
  return { closeCharacter: "\"", start: staticIndex };
}

function normalizeStepTemplate(text) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const parameter = nextParameter(text, index);
    if (!parameter) {
      result += text.slice(index);
      break;
    }
    const end = findParameterEnd(text, parameter.start, parameter.closeCharacter);
    if (end === -1) {
      result += text.slice(index);
      break;
    }
    result += `${text.slice(index, parameter.start)}{}`;
    index = end + 1;
  }
  return result.trim();
}

function documentLine(document, line) {
  if (line < 0) {
    return "";
  }
  if (typeof document.lineCount === "number" && line >= document.lineCount) {
    return "";
  }
  if (typeof document.lineAt === "function") {
    try {
      return document.lineAt(line).text;
    } catch (_error) {
      return "";
    }
  }
  if (typeof document.getText !== "function") {
    return "";
  }
  return document.getText().split(/\r?\n/)[line] || "";
}

function isInlineTableLine(line) {
  return line.trimStart().startsWith("|");
}

function stepTextAt(document, position) {
  if (!document || document.languageId !== GAUGE_LANGUAGE || !position) {
    return undefined;
  }
  const line = documentLine(document, position.line);
  if (!line.startsWith("*")) {
    return undefined;
  }
  let stepText = line.slice(1).trim();
  if (!stepText) {
    return undefined;
  }
  const nextLine = documentLine(document, position.line + 1);
  if (isInlineTableLine(nextLine)) {
    stepText = `${stepText} <table>`;
  }
  return normalizeStepTemplate(stepText);
}

function sameDocument(left, right) {
  if (left === right) {
    return true;
  }
  const leftPath = left && left.uri && left.uri.fsPath;
  const rightPath = right && right.uri && right.uri.fsPath;
  return Boolean(leftPath && rightPath && leftPath === rightPath);
}

function documentPath(document) {
  return document && document.uri && document.uri.fsPath;
}

function uriPath(uri) {
  return uri && uri.fsPath;
}

function targetRange(vscode, text, entry) {
  const startOffset = entry.declarationStart !== undefined
    ? entry.declarationStart
    : entry.parameterStart;
  const endOffset = entry.declarationEnd !== undefined
    ? entry.declarationEnd
    : entry.parameterEnd;
  return createRange(
    vscode,
    positionAt(text, startOffset),
    positionAt(text, endOffset),
  );
}

class GaugeStepDefinitionProvider {
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

  async findWorkspaceKotlinDocuments() {
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    const documents = [];
    const uris = await workspace.findFiles("**/*.kt");
    for (const uri of uris || []) {
      const file = uriPath(uri);
      if (file && this.projectFactory && typeof this.projectFactory.getGaugeRootFromFilePath === "function") {
        try {
          this.projectFactory.getGaugeRootFromFilePath(file);
        } catch (_error) {
          continue;
        }
      }

      try {
        const document = await workspace.openTextDocument(uri);
        documents.push(document);
      } catch (_error) {
        // Ignore unreadable files so one stale workspace URI does not block navigation.
      }
    }
    return documents;
  }

  async kotlinDocuments(sourceDocument) {
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || sameDocument(candidate, sourceDocument)
        || candidate.languageId !== KOTLIN_LANGUAGE
        || typeof candidate.getText !== "function"
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
    for (const candidate of await this.findWorkspaceKotlinDocuments()) {
      addDocument(candidate);
    }
    return documents;
  }

  collectWorkspaceConstants(document, kotlinDocuments) {
    const workspace = this.vscode.workspace || {};
    const diagnosticVscode = {
      ...this.vscode,
      workspace: {
        ...workspace,
        textDocuments: kotlinDocuments,
      },
    };
    const diagnosticsProvider = new GaugeStepDiagnosticsProvider({
      projectFactory: this.projectFactory,
      vscode: diagnosticVscode,
    });
    return diagnosticsProvider.collectWorkspaceConstants(document);
  }

  async provideDefinition(document, position) {
    const wantedStep = stepTextAt(document, position);
    if (!wantedStep || !this.isGaugeProjectDocument(document)) {
      return [];
    }

    const definitions = [];
    const kotlinDocuments = await this.kotlinDocuments(document);
    for (const candidate of kotlinDocuments) {
      const text = candidate.getText();
      const externalConstants = this.collectWorkspaceConstants(candidate, kotlinDocuments);
      for (const entry of findStepFunctions(text, externalConstants)) {
        if (!entry.aliases.some((alias) => normalizeStepTemplate(alias) === wantedStep)) {
          continue;
        }
        definitions.push(createLocation(
          this.vscode,
          candidate.uri,
          targetRange(this.vscode, text, entry),
        ));
      }
    }
    return definitions;
  }

  register() {
    if (!this.vscode.languages || typeof this.vscode.languages.registerDefinitionProvider !== "function") {
      return { dispose() {} };
    }
    return this.vscode.languages.registerDefinitionProvider(
      { language: GAUGE_LANGUAGE },
      this,
    );
  }
}

module.exports = {
  GaugeStepDefinitionProvider,
  normalizeStepTemplate,
  stepTextAt,
};
