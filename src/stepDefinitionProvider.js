"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const {
  GaugeStepDiagnosticsProvider,
  findConceptHeadings,
  findStepFunctionsForDocument,
  isConceptDocument,
  isStepImplementationDocument,
  positionAt,
} = require("./stepDiagnostics");

const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_PATTERN = /\.spec$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const STEP_IMPLEMENTATION_WORKSPACE_PATTERNS = ["**/*.kt", "**/*.java"];
const PROJECT_ROOT_GAUGE = "gauge";
const PROJECT_ROOT_NON_GAUGE = "nonGauge";
const PROJECT_ROOT_UNKNOWN = "unknown";
const ALLOW_MULTILINE_STEP_PROPERTY = "allow_multiline_step";
const DEFAULT_ENV_PROPERTIES = ["env", "default", "default.properties"];

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
  const text = String(line || "").trim();
  return text.startsWith("|");
}

function isDocStringFenceLine(line) {
  return line.trim() === "\"\"\"";
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
    || isInlineTableLine(text)
    || isDocStringFenceLine(text)
    || /^={3,}\s*$/.test(text)
    || /^-{3,}\s*$/.test(text);
}

function isStepLine(line) {
  const marker = String(line || "").search(/\S/);
  return marker !== -1 && line[marker] === "*";
}

function stepMarkerIndex(line) {
  const marker = String(line || "").search(/\S/);
  return marker !== -1 && line[marker] === "*" ? marker : -1;
}

function isGaugeStepSourceDocument(document) {
  if (!document) {
    return false;
  }
  if (document.languageId === GAUGE_LANGUAGE || document.languageId === GAUGE_CONCEPT_LANGUAGE) {
    return true;
  }
  if (SPEC_FILE_PATTERN.test(documentPath(document)) || CONCEPT_FILE_PATTERN.test(documentPath(document))) {
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

function multilineStepLineAt(document, lineNumber) {
  for (let currentLine = lineNumber; currentLine >= 0; currentLine -= 1) {
    const line = documentLine(document, currentLine);
    if (isStepLine(line)) {
      return currentLine;
    }
    if (isGaugeSyntaxBoundary(line)) {
      return undefined;
    }
  }
  return undefined;
}

function multilineStepText(document, lineNumber) {
  const line = documentLine(document, lineNumber);
  const marker = stepMarkerIndex(line);
  if (marker === -1) {
    return "";
  }
  const lines = [line.slice(marker + 1).trim()];
  for (let nextLine = lineNumber + 1; nextLine < document.lineCount; nextLine += 1) {
    const nextText = documentLine(document, nextLine);
    if (isGaugeSyntaxBoundary(nextText)) {
      break;
    }
    lines.push(nextText.trim());
  }
  return lines.join(" ").trim();
}

function firstUnescapedIndex(line, characters) {
  for (let index = 0; index < line.length; index += 1) {
    if (characters.has(line[index]) && !isEscapedAt(line, index)) {
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

function allowMultilineStep(options = {}) {
  const envValue = boolProperty(process.env.allow_multiline_step);
  if (envValue !== undefined) {
    return envValue;
  }
  const projectValue = boolProperty(projectDefaultProperty(options, ALLOW_MULTILINE_STEP_PROPERTY));
  return projectValue === true;
}

function stepTextCandidatesAt(document, position, options = {}) {
  if (!isGaugeStepSourceDocument(document) || !position) {
    return [];
  }
  let lineNumber = position.line;
  let line = documentLine(document, lineNumber);
  if (!isStepLine(line)) {
    const docStringStepLine = docStringStepLineAt(document, lineNumber);
    const multilineStepLine = options.allowMultilineStep
      ? multilineStepLineAt(document, lineNumber)
      : undefined;
    if (docStringStepLine === undefined && multilineStepLine === undefined) {
      return [];
    }
    lineNumber = docStringStepLine === undefined ? multilineStepLine : docStringStepLine;
    line = documentLine(document, lineNumber);
  }
  if (!isStepLine(line)) {
    return [];
  }
  const marker = stepMarkerIndex(line);
  let stepText = marker === -1
    ? ""
    : (options.allowMultilineStep ? multilineStepText(document, lineNumber) : line.slice(marker + 1).trim());
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
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
    this.diagnosticsProvider = new GaugeStepDiagnosticsProvider({
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectFactory: this.projectFactory,
      vscode: this.vscode,
    });
  }

  isGaugeProjectDocument(document) {
    return this.diagnosticsProvider.isGaugeProjectDocument(document);
  }

  projectRootInfoForFile(file) {
    if (!this.projectFactory || typeof this.projectFactory.getGaugeRootFromFilePath !== "function") {
      return { root: undefined, type: PROJECT_ROOT_UNKNOWN };
    }
    if (!file) {
      return { root: undefined, type: PROJECT_ROOT_UNKNOWN };
    }
    try {
      const root = this.projectFactory.getGaugeRootFromFilePath(file);
      if (!this.diagnosticsProvider.isGaugeProjectRoot(root)) {
        return { root: undefined, type: PROJECT_ROOT_NON_GAUGE };
      }
      return { root, type: PROJECT_ROOT_GAUGE };
    } catch (_error) {
      return { root: undefined, type: PROJECT_ROOT_UNKNOWN };
    }
  }

  gaugeProjectRoot(document) {
    const projectRootInfo = this.projectRootInfoForFile(documentPath(document));
    return projectRootInfo.type === PROJECT_ROOT_GAUGE ? projectRootInfo.root : undefined;
  }

  allowsMultilineStep(document) {
    return allowMultilineStep({
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectRoot: this.gaugeProjectRoot(document),
    });
  }

  belongsToSourceGaugeProject(candidate, sourceRoot) {
    if (sourceRoot === undefined) {
      return this.isGaugeProjectDocument(candidate);
    }
    const file = documentPath(candidate);
    if (!file) {
      return true;
    }
    const projectRootInfo = this.projectRootInfoForFile(file);
    return projectRootInfo.type === PROJECT_ROOT_GAUGE && projectRootInfo.root === sourceRoot;
  }

  isDifferentGaugeProject(candidate, sourceRoot) {
    if (sourceRoot === undefined) {
      return false;
    }
    const projectRootInfo = this.projectRootInfoForFile(documentPath(candidate));
    return projectRootInfo.type === PROJECT_ROOT_NON_GAUGE
      || (projectRootInfo.type === PROJECT_ROOT_GAUGE && projectRootInfo.root !== sourceRoot);
  }

  shouldOpenWorkspaceDocument(file, sourceRoot) {
    const projectRootInfo = this.projectRootInfoForFile(file);
    if (projectRootInfo.type === PROJECT_ROOT_NON_GAUGE) {
      return false;
    }
    if (sourceRoot !== undefined && projectRootInfo.type === PROJECT_ROOT_GAUGE) {
      return projectRootInfo.root === sourceRoot;
    }
    return true;
  }

  async findWorkspaceStepImplementationDocuments(sourceRoot) {
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
        if (!this.shouldOpenWorkspaceDocument(uriPath(uri), sourceRoot)) {
          continue;
        }
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

  async findWorkspaceConceptDocuments(sourceRoot) {
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
      if (!this.shouldOpenWorkspaceDocument(uriPath(uri), sourceRoot)) {
        continue;
      }
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
    const sourceRoot = this.gaugeProjectRoot(sourceDocument);
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
      if (this.belongsToSourceGaugeProject(candidate, sourceRoot)) {
        projectDocuments.push(candidate);
      } else if (this.isDifferentGaugeProject(candidate, sourceRoot)) {
        return;
      } else {
        externalDocuments.push(candidate);
      }
    };

    const openDocuments = workspace.textDocuments || [];
    for (const candidate of openDocuments) {
      addDocument(candidate);
    }
    for (const candidate of await this.findWorkspaceStepImplementationDocuments(sourceRoot)) {
      addDocument(candidate);
    }
    return { externalDocuments, projectDocuments };
  }

  async conceptDocuments(sourceDocument) {
    const workspace = this.vscode.workspace || {};
    const sourceRoot = this.gaugeProjectRoot(sourceDocument);
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || !isConceptDocument(candidate)
        || typeof candidate.getText !== "function"
        || !this.belongsToSourceGaugeProject(candidate, sourceRoot)
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
    for (const candidate of await this.findWorkspaceConceptDocuments(sourceRoot)) {
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
    const wantedSteps = stepTextCandidatesAt(document, position, {
      allowMultilineStep: this.allowsMultilineStep(document),
    });
    if (wantedSteps.length === 0 || !this.isGaugeProjectDocument(document)) {
      return [];
    }

    const conceptDefinitions = this.conceptDefinitionsForDocuments(
      wantedSteps,
      await this.conceptDocuments(document),
    );
    if (conceptDefinitions.length > 0) {
      return conceptDefinitions;
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
        { language: GAUGE_CONCEPT_LANGUAGE },
        { scheme: "file", pattern: "**/*.spec" },
        { scheme: "file", pattern: "**/*.cpt" },
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
