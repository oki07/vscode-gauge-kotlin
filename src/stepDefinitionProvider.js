"use strict";

const {
  GaugeStepDiagnosticsProvider,
  findConceptHeadings,
  findStepFunctionsForDocument,
  isConceptDocument,
  isStepImplementationDocument,
  positionAt,
} = require("./stepDiagnostics");

const GAUGE_LANGUAGE = "gauge";
const MARKDOWN_LANGUAGE = "markdown";
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const STEP_IMPLEMENTATION_WORKSPACE_PATTERNS = ["**/*.kt", "**/*.java"];

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
  // Normalize to NFC so a spec and a Kotlin @Step that render identically but
  // were saved in different unicode forms (common on macOS, where text is often
  // stored decomposed/NFD) compare equal. Steps without combining marks are
  // unaffected, which is why only steps containing combining marks (such as a
  // Japanese dakuten) appeared broken.
  return result.trim().normalize("NFC");
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

function isDocStringFenceLine(line) {
  return line.trim() === "\"\"\"";
}

function isStepLine(line) {
  return line.startsWith("*");
}

function isGaugeStepSourceDocument(document) {
  if (!document) {
    return false;
  }
  if (document.languageId === GAUGE_LANGUAGE) {
    return true;
  }
  return document.languageId === MARKDOWN_LANGUAGE
    && MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document));
}

function docStringStepLineAt(document, line) {
  for (let openLine = line; openLine >= 0; openLine -= 1) {
    if (!isDocStringFenceLine(documentLine(document, openLine))) {
      continue;
    }

    const stepLine = openLine - 1;
    if (!isStepLine(documentLine(document, stepLine))) {
      continue;
    }

    for (let closeLine = openLine + 1; closeLine <= line; closeLine += 1) {
      if (isDocStringFenceLine(documentLine(document, closeLine))) {
        return closeLine === line ? stepLine : undefined;
      }
    }
    return stepLine;
  }
  return undefined;
}

function stepTextCandidatesAt(document, position) {
  if (!isGaugeStepSourceDocument(document) || !position) {
    return [];
  }
  let lineNumber = position.line;
  let line = documentLine(document, lineNumber);
  if (!isStepLine(line)) {
    const docStringStepLine = docStringStepLineAt(document, lineNumber);
    if (docStringStepLine === undefined) {
      return [];
    }
    lineNumber = docStringStepLine;
    line = documentLine(document, lineNumber);
  }
  if (!isStepLine(line)) {
    return [];
  }
  let stepText = line.slice(1).trim();
  if (!stepText) {
    return [];
  }
  const nextLine = documentLine(document, lineNumber + 1);
  if (isInlineTableLine(nextLine)) {
    stepText = `${stepText} <table>`;
  }
  return [normalizeStepTemplate(stepText)];
}

function stepTextAt(document, position) {
  return stepTextCandidatesAt(document, position)[0];
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

  async findWorkspaceStepImplementationDocuments() {
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    const documents = [];
    for (const pattern of STEP_IMPLEMENTATION_WORKSPACE_PATTERNS) {
      let uris;
      try {
        uris = await workspace.findFiles(pattern);
      } catch (error) {
        continue;
      }
      for (const uri of uris || []) {
        try {
          const document = await workspace.openTextDocument(uri);
          documents.push(document);
        } catch (error) {
          // Ignore unreadable files so one stale workspace URI does not block navigation.
        }
      }
    }
    return documents;
  }

  async findWorkspaceConceptDocuments() {
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    const documents = [];
    let uris;
    try {
      uris = await workspace.findFiles("**/*.cpt");
    } catch (error) {
      return documents;
    }
    for (const uri of uris || []) {
      try {
        const document = await workspace.openTextDocument(uri);
        documents.push(document);
      } catch (error) {
        // Ignore unreadable files so one stale workspace URI does not block navigation.
      }
    }
    return documents;
  }

  async stepImplementationDocumentGroups(sourceDocument) {
    const workspace = this.vscode.workspace || {};
    const projectDocuments = [];
    const externalDocuments = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (!candidate) {
        return;
      }
      if (sameDocument(candidate, sourceDocument)) {
        return;
      }
      if (!isStepImplementationDocument(candidate)) {
        return;
      }
      if (typeof candidate.getText !== "function") {
        return;
      }
      const file = documentPath(candidate);
      if (file) {
        if (seenPaths.has(file)) {
          return;
        }
        seenPaths.add(file);
      } else if (projectDocuments.includes(candidate) || externalDocuments.includes(candidate)) {
        return;
      }
      if (this.isGaugeProjectDocument(candidate)) {
        projectDocuments.push(candidate);
      } else {
        externalDocuments.push(candidate);
      }
    };

    const openDocuments = workspace.textDocuments || [];
    for (const candidate of openDocuments) {
      addDocument(candidate);
    }
    for (const candidate of await this.findWorkspaceStepImplementationDocuments()) {
      addDocument(candidate);
    }
    return { externalDocuments, projectDocuments };
  }

  async conceptDocuments(sourceDocument) {
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || !isConceptDocument(candidate)
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

    const openDocuments = workspace.textDocuments || [];
    for (const candidate of openDocuments) {
      addDocument(candidate);
    }
    for (const candidate of await this.findWorkspaceConceptDocuments()) {
      addDocument(candidate);
    }
    addDocument(sourceDocument);
    return documents;
  }

  collectWorkspaceConstants(document, kotlinDocuments, options = {}) {
    // Pass the Kotlin documents directly as the workspace document list. Do NOT
    // spread `this.vscode` or `vscode.workspace`: object spread enumerates every
    // own getter, and VS Code / Cursor expose proposed-API getters (e.g.
    // workspace.tunnels) that throw for extensions that did not declare the
    // proposal, which would abort the entire definition lookup.
    const diagnosticsProvider = new GaugeStepDiagnosticsProvider({
      projectFactory: options.includeExternalWorkspace ? undefined : this.projectFactory,
      vscode: this.vscode,
    });
    return diagnosticsProvider.collectWorkspaceConstants(document, kotlinDocuments);
  }

  definitionsForDocuments(wantedStep, documents, constantDocuments, options = {}) {
    const wantedSteps = Array.isArray(wantedStep) ? wantedStep : [wantedStep];
    const wantedStepSet = new Set(wantedSteps);
    const definitions = [];
    for (const candidate of documents) {
      const text = candidate.getText();
      let externalConstants;
      if (isStepImplementationDocument(candidate)) {
        try {
          externalConstants = this.collectWorkspaceConstants(candidate, constantDocuments, options);
        } catch (error) {
          // Never let workspace-constant collection abort navigation: plain
          // @Step("literal") matching still works without resolved constants.
          externalConstants = undefined;
        }
      }
      const stepFunctions = findStepFunctionsForDocument(candidate, externalConstants);
      for (const entry of stepFunctions) {
        const normalizedAliases = entry.aliases.map((alias) => normalizeStepTemplate(alias));
        if (!normalizedAliases.some((alias) => wantedStepSet.has(alias))) {
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

  conceptDefinitionsForDocuments(wantedStep, documents) {
    const wantedSteps = Array.isArray(wantedStep) ? wantedStep : [wantedStep];
    const wantedStepSet = new Set(wantedSteps);
    const definitions = [];
    for (const candidate of documents) {
      const text = candidate.getText();
      for (const heading of findConceptHeadings(text)) {
        if (!wantedStepSet.has(heading.normalized)) {
          continue;
        }
        definitions.push(createLocation(
          this.vscode,
          candidate.uri,
          createRange(this.vscode, heading.start, heading.end),
        ));
      }
    }
    return definitions;
  }

  async provideDefinition(document, position) {
    const wantedSteps = stepTextCandidatesAt(document, position);
    if (wantedSteps.length === 0 || !this.isGaugeProjectDocument(document)) {
      return [];
    }

    const {
      externalDocuments,
      projectDocuments,
    } = await this.stepImplementationDocumentGroups(document);
    const projectDefinitions = this.definitionsForDocuments(
      wantedSteps,
      projectDocuments,
      projectDocuments,
    );
    if (projectDefinitions.length > 0) {
      return projectDefinitions;
    }
    const conceptDefinitions = this.conceptDefinitionsForDocuments(
      wantedSteps,
      await this.conceptDocuments(document),
    );
    if (conceptDefinitions.length > 0) {
      return conceptDefinitions;
    }
    return this.definitionsForDocuments(
      wantedSteps,
      externalDocuments,
      [...projectDocuments, ...externalDocuments],
      { includeExternalWorkspace: true },
    );
  }

  register() {
    if (!this.vscode.languages || typeof this.vscode.languages.registerDefinitionProvider !== "function") {
      return { dispose() {} };
    }
    const disposable = this.vscode.languages.registerDefinitionProvider(
      [
        { language: GAUGE_LANGUAGE },
        { language: MARKDOWN_LANGUAGE, scheme: "file", pattern: "**/*.md" },
      ],
      this,
    );
    return disposable;
  }
}

module.exports = {
  GaugeStepDefinitionProvider,
  normalizeStepTemplate,
  stepTextAt,
};
