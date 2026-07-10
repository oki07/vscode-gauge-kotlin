"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const {
  isScenarioHashHeading,
  isSpecHashHeading,
} = require("./gaugeHeadings");
const {
  GaugeStepDiagnosticsProvider,
  findConceptHeadings,
  findStepFunctionsForDocument,
  isStepImplementationDocument,
  positionAt,
} = require("./stepDiagnostics");
const { superStepAliasesForEntry } = require("./gaugeReference");
const { normalizeStepTemplate } = require("./stepDefinitionProvider");

const RUN_COMMAND = "gauge.execute";
const DEBUG_COMMAND = "gauge.debug";
const IN_PARALLEL_COMMAND = "gauge.execute.inParallel";
const SHOW_REFERENCES_FOR_STEP = "gauge.showReferences";
const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_EXTENSION = ".spec";
const MARKDOWN_SPEC_EXTENSION = ".md";
const GAUGE_CODELENS_CONFIG = "gauge.codeLenses";
const REFERENCE_CONFIG = "reference";
const GAUGE_REFERENCE_WORKSPACE_PATTERNS = ["**/*.spec", "**/*.cpt", "**/*.md"];
const STEP_IMPLEMENTATION_WORKSPACE_PATTERNS = ["**/*.kt", "**/*.java"];
const ALLOW_MULTILINE_STEP_PROPERTY = "allow_multiline_step";
const DEFAULT_ENV_PROPERTIES = ["env", "default", "default.properties"];

function getVscode(vscode) {
  return vscode || {};
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function uriPath(uri) {
  return (uri && (uri.fsPath || uri.path)) || "";
}

function documentUri(document) {
  if (document && document.uri && typeof document.uri.toString === "function") {
    return document.uri.toString();
  }
  const file = documentPath(document);
  return file ? `file://${file}` : undefined;
}

function sameDocument(left, right) {
  if (left === right) {
    return true;
  }
  const leftPath = documentPath(left);
  const rightPath = documentPath(right);
  return Boolean(leftPath && rightPath && leftPath === rightPath);
}

function isConceptDocument(document) {
  return Boolean(document && document.languageId === GAUGE_CONCEPT_LANGUAGE)
    || documentPath(document).toLowerCase().endsWith(".cpt");
}

function isGaugeReferenceDocument(document) {
  if (!document || typeof document.getText !== "function") {
    return false;
  }
  const file = documentPath(document).toLowerCase();
  if (document.languageId === GAUGE_LANGUAGE || document.languageId === GAUGE_CONCEPT_LANGUAGE) {
    return true;
  }
  if (file.endsWith(SPEC_FILE_EXTENSION) || file.endsWith(".cpt")) {
    return true;
  }
  return document.languageId === MARKDOWN_LANGUAGE && file.endsWith(MARKDOWN_SPEC_EXTENSION);
}

function isMarkdownSpecDocument(document, file) {
  return Boolean(
    document
    && document.languageId === MARKDOWN_LANGUAGE
    && file.toLowerCase().endsWith(MARKDOWN_SPEC_EXTENSION)
  );
}

function isSpecDocument(document, file) {
  return Boolean(document && file.toLowerCase().endsWith(SPEC_FILE_EXTENSION));
}

function documentLine(document, line) {
  if (typeof document.lineAt === "function") {
    return document.lineAt(line).text;
  }
  return String(document.getText()).split(/\r?\n/)[line] || "";
}

function documentLineCount(document) {
  if (typeof document.lineCount === "number") {
    return document.lineCount;
  }
  if (typeof document.getText === "function") {
    return String(document.getText()).split(/\r?\n/).length;
  }
  return 0;
}

function firstNonWhitespace(line) {
  const index = line.search(/\S/);
  return index === -1 ? 0 : index;
}

function createPosition(vscode, line, character) {
  return typeof vscode.Position === "function"
    ? new vscode.Position(line, character)
    : { line, character };
}

function createRange(vscode, line, start, end) {
  const startPosition = createPosition(vscode, line, start);
  const endPosition = createPosition(vscode, line, end);
  return typeof vscode.Range === "function"
    ? new vscode.Range(startPosition, endPosition)
    : { start: startPosition, end: endPosition };
}

function createRangeFromPositions(vscode, start, end) {
  const startPosition = createPosition(vscode, start.line, start.character);
  const endPosition = createPosition(vscode, end.line, end.character);
  return typeof vscode.Range === "function"
    ? new vscode.Range(startPosition, endPosition)
    : { start: startPosition, end: endPosition };
}

function createCodeLens(vscode, range, command) {
  return typeof vscode.CodeLens === "function"
    ? new vscode.CodeLens(range, command)
    : { range, command };
}

function isLegacySpecificationUnderline(line) {
  return /^=+$/.test(line);
}

function isLegacyScenarioUnderline(line) {
  return /^-+$/.test(line);
}

function isTableLine(line) {
  const text = String(line || "").trim();
  return text.startsWith("|");
}

function isStepLine(line) {
  const marker = String(line || "").search(/\S/);
  return marker !== -1 && line[marker] === "*";
}

function gaugeStepText(line) {
  const marker = String(line || "").search(/\S/);
  if (marker === -1 || line[marker] !== "*") {
    return undefined;
  }
  const text = String(line).slice(marker + 1).trim();
  return text || undefined;
}

function isDocStringFenceLine(line) {
  return String(line || "").trim() === "\"\"\"";
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
    || isTableLine(text)
    || isDocStringFenceLine(text)
    || /^={3,}\s*$/.test(text)
    || /^-{3,}\s*$/.test(text);
}

function multilineGaugeStepText(lines, lineNumber) {
  const line = lines[lineNumber] || "";
  const stepText = gaugeStepText(line);
  if (!stepText) {
    return undefined;
  }
  const stepLines = [stepText];
  for (let nextLine = lineNumber + 1; nextLine < lines.length; nextLine += 1) {
    const nextText = lines[nextLine] || "";
    if (isGaugeSyntaxBoundary(nextText)) {
      break;
    }
    stepLines.push(nextText.trim());
  }
  return stepLines.join(" ").trim();
}

function countStepReferences(document, normalizedStep, options = {}) {
  if (!normalizedStep || !document || typeof document.getText !== "function") {
    return 0;
  }
  let count = 0;
  const lines = document.getText().split(/\r?\n/);
  const multiline = Boolean(options.allowMultilineStep);
  for (let line = 0; line < lines.length; line += 1) {
    let stepText = multiline
      ? multilineGaugeStepText(lines, line)
      : gaugeStepText(lines[line].replace(/\r$/, ""));
    let stepEndLine = line;
    if (multiline && stepText) {
      for (let nextLine = line + 1; nextLine < lines.length; nextLine += 1) {
        if (isGaugeSyntaxBoundary(lines[nextLine])) {
          break;
        }
        stepEndLine = nextLine;
      }
    }
    if (stepText && lines[stepEndLine + 1] !== undefined && isTableLine(lines[stepEndLine + 1])) {
      stepText = `${stepText} <table>`;
    }
    if (stepText && normalizeStepTemplate(stepText) === normalizedStep) {
      count += 1;
    }
    line = stepEndLine;
  }
  return count;
}

function isEscapedCharacter(line, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function firstUnescapedIndex(line, characters) {
  for (let index = 0; index < line.length; index += 1) {
    if (characters.has(line[index]) && !isEscapedCharacter(line, index)) {
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

function referenceTitle(count) {
  return `${count} reference(s)`;
}

function hasHeadingText(line) {
  return Boolean(line && line.trim());
}

function hashHeadingKind(line) {
  if (isScenarioHashHeading(line)) {
    return "scenario";
  }
  return isSpecHashHeading(line) ? "specification" : undefined;
}

function legacyHeadingKind(line, nextLine) {
  if (!hasHeadingText(line)) {
    return undefined;
  }
  if (isLegacySpecificationUnderline(nextLine || "")) {
    return "specification";
  }
  if (isLegacyScenarioUnderline(nextLine || "")) {
    return "scenario";
  }
  return undefined;
}

function headingMarkers(document) {
  const markers = [];
  const lineCount = documentLineCount(document);
  for (let line = 0; line < lineCount; line += 1) {
    const text = documentLine(document, line);
    const hashKind = hashHeadingKind(text);
    if (hashKind) {
      markers.push({ kind: hashKind, line, start: firstNonWhitespace(text), end: text.length });
      continue;
    }

    const legacyKind = legacyHeadingKind(text, documentLine(document, line + 1));
    if (legacyKind) {
      markers.push({ kind: legacyKind, line, start: firstNonWhitespace(text), end: text.length });
      line += 1;
    }
  }
  return markers;
}

function scenarioTarget(file, marker) {
  return `${file}:${marker.line + 1}`;
}

function targetForMarker(file, marker) {
  return marker.kind === "scenario" ? scenarioTarget(file, marker) : file;
}

function titlesForMarker(marker) {
  return marker.kind === "scenario"
    ? ["Run Scenario", "Debug Scenario"]
    : ["Run Spec", "Debug Spec"];
}

function codeLensHeadingMarkers(document) {
  const markers = headingMarkers(document);
  return [
    ...markers.filter((marker) => marker.kind === "scenario"),
    ...markers.filter((marker) => marker.kind !== "scenario"),
  ];
}

function runLinkRange(vscode, marker, title) {
  return createRange(vscode, marker.line, marker.start, marker.start + title.length);
}

function hasSpecificationDataTable(document, specificationLine) {
  const lineCount = documentLineCount(document);
  for (let line = specificationLine + 1; line < lineCount; line += 1) {
    const text = documentLine(document, line);
    if (hashHeadingKind(text) === "scenario") {
      return false;
    }
    if (legacyHeadingKind(text, documentLine(document, line + 1)) === "scenario") {
      return false;
    }
    if (isStepLine(text)) {
      return false;
    }
    if (isTableLine(text)) {
      return true;
    }
  }
  return false;
}

function normalizedStepValues(aliases) {
  const values = [];
  const seen = new Set();
  for (const alias of aliases || []) {
    const value = normalizeStepTemplate(alias);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    values.push(value);
  }
  return values;
}

class GaugeCodeLensProvider {
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

  isGaugeProjectFile(file) {
    if (!this.projectFactory) {
      return true;
    }
    if (!file || typeof this.projectFactory.getGaugeRootFromFilePath !== "function") {
      return true;
    }
    try {
      const root = this.projectFactory.getGaugeRootFromFilePath(file);
      if (!root) {
        return false;
      }
      if (typeof this.projectFactory.isGaugeProject === "function") {
        return this.projectFactory.isGaugeProject(root) !== false;
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  isGaugeProjectDocument(document) {
    return this.isGaugeProjectFile(documentPath(document));
  }

  belongsFileToSourceGaugeProject(file, sourceRoot) {
    if (
      !file
      || !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return true;
    }
    const root = this.diagnosticsProvider.rootForFile(file);
    if (sourceRoot === undefined) {
      return root !== undefined;
    }
    return root === sourceRoot;
  }

  referenceCodeLensesEnabled() {
    const workspace = this.vscode.workspace || {};
    if (typeof workspace.getConfiguration !== "function") {
      return true;
    }
    const config = workspace.getConfiguration(GAUGE_CODELENS_CONFIG);
    if (!config || typeof config.get !== "function") {
      return true;
    }
    if (typeof config.has === "function" && config.has(REFERENCE_CONFIG)) {
      return config.get(REFERENCE_CONFIG) !== false;
    }
    return config.get(REFERENCE_CONFIG) !== false;
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
      } catch (_error) {
        continue;
      }

      for (const uri of uris || []) {
        const file = uriPath(uri);
        if (!this.isGaugeProjectFile(file)) {
          continue;
        }

        try {
          documents.push(await workspace.openTextDocument(uri));
        } catch (_error) {
          // Ignore stale workspace files so CodeLens still works for the active document.
        }
      }
    }
    return documents;
  }

  async findWorkspaceGaugeReferenceDocuments(sourceRoot) {
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    const documents = [];
    for (const pattern of GAUGE_REFERENCE_WORKSPACE_PATTERNS) {
      let uris;
      try {
        uris = await workspace.findFiles(pattern);
      } catch (_error) {
        continue;
      }

      for (const uri of uris || []) {
        const file = uriPath(uri);
        if (!this.belongsFileToSourceGaugeProject(file, sourceRoot)) {
          continue;
        }

        try {
          documents.push(await workspace.openTextDocument(uri));
        } catch (_error) {
          // Ignore stale workspace files so CodeLens still works for the active document.
        }
      }
    }
    return documents;
  }

  async gaugeReferenceDocuments(sourceDocument) {
    const workspace = this.vscode.workspace || {};
    const sourceRoot = this.diagnosticsProvider.gaugeProjectRoot(sourceDocument);
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || !isGaugeReferenceDocument(candidate)
        || !this.diagnosticsProvider.belongsToSourceGaugeProject(candidate, sourceRoot)
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

    addDocument(sourceDocument);
    for (const candidate of workspace.textDocuments || []) {
      addDocument(candidate);
    }
    for (const candidate of await this.findWorkspaceGaugeReferenceDocuments(sourceRoot)) {
      addDocument(candidate);
    }
    return documents;
  }

  referenceCountInDocuments(referenceDocuments, normalizedStep) {
    let count = 0;
    for (const candidate of referenceDocuments) {
      count += countStepReferences(candidate, normalizedStep, {
        allowMultilineStep: allowMultilineStep({
          fileSystem: this.fileSystem,
          pathModule: this.pathModule,
          projectRoot: this.diagnosticsProvider.rootForFile(documentPath(candidate)),
        }),
      });
    }
    return count;
  }

  async provideConceptReferenceCodeLenses(document) {
    if (
      !this.referenceCodeLensesEnabled()
      || !this.isGaugeProjectDocument(document)
      || typeof document.getText !== "function"
    ) {
      return [];
    }

    const uri = documentUri(document);
    if (!uri) {
      return [];
    }

    const lenses = [];
    const lines = document.getText().split(/\r?\n/);
    const referenceDocuments = await this.gaugeReferenceDocuments(document);
    for (const heading of findConceptHeadings(document.getText())) {
      if (!heading.normalized) {
        continue;
      }
      const line = lines[heading.start.line] || "";
      const marker = firstNonWhitespace(line);
      const range = createRange(
        this.vscode,
        heading.start.line,
        marker,
        Math.max(marker, heading.end.character),
      );
      const position = createPosition(this.vscode, heading.start.line, marker);
      const count = this.referenceCountInDocuments(referenceDocuments, heading.normalized);
      lenses.push(createCodeLens(this.vscode, range, {
        command: SHOW_REFERENCES_FOR_STEP,
        title: referenceTitle(count),
        arguments: [uri, position, heading.normalized],
      }));
    }
    return lenses;
  }

  async stepImplementationDocuments(sourceDocument) {
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || sameDocument(candidate, sourceDocument)
        || !isStepImplementationDocument(candidate)
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
    for (const candidate of await this.findWorkspaceStepImplementationDocuments()) {
      addDocument(candidate);
    }
    return documents;
  }

  async provideStepReferenceCodeLenses(document) {
    if (
      !this.referenceCodeLensesEnabled()
      || !this.isGaugeProjectDocument(document)
      || typeof document.getText !== "function"
    ) {
      return [];
    }

    const uri = documentUri(document);
    if (!uri) {
      return [];
    }

    const text = document.getText();
    const implementationDocuments = await this.stepImplementationDocuments(document);
    const externalConstants = isStepImplementationDocument(document)
      ? this.diagnosticsProvider.collectWorkspaceConstants(
        document,
        implementationDocuments,
      )
      : undefined;
    const lenses = [];
    const referenceDocuments = await this.gaugeReferenceDocuments(document);
    for (const entry of findStepFunctionsForDocument(document, externalConstants)) {
      const start = positionAt(text, entry.declarationStart);
      const end = positionAt(text, entry.declarationEnd);
      const range = createRangeFromPositions(this.vscode, start, end);
      const aliases = [
        ...entry.aliases,
        ...superStepAliasesForEntry(
          document,
          entry,
          [document, ...implementationDocuments],
          this.diagnosticsProvider,
        ),
      ];
      for (const stepValue of normalizedStepValues(aliases)) {
        const count = this.referenceCountInDocuments(referenceDocuments, stepValue);
        lenses.push(createCodeLens(this.vscode, range, {
          command: SHOW_REFERENCES_FOR_STEP,
          title: referenceTitle(count),
          arguments: [uri, start, stepValue],
        }));
      }
    }
    return lenses;
  }

  provideCodeLenses(document) {
    if (!document) {
      return [];
    }
    const file = documentPath(document);
    if (!file) {
      return [];
    }
    if (isConceptDocument(document)) {
      return this.provideConceptReferenceCodeLenses(document);
    }
    if (isStepImplementationDocument(document)) {
      return this.provideStepReferenceCodeLenses(document);
    }
    const supportedDocument = document.languageId === GAUGE_LANGUAGE
      || isSpecDocument(document, file)
      || isMarkdownSpecDocument(document, file);
    if (!supportedDocument) {
      return [];
    }
    if (!this.isGaugeProjectDocument(document)) {
      return [];
    }

    const lenses = [];
    for (const marker of codeLensHeadingMarkers(document)) {
      const target = targetForMarker(file, marker);
      const [runTitle, debugTitle] = titlesForMarker(marker);
      lenses.push(createCodeLens(this.vscode, runLinkRange(this.vscode, marker, runTitle), {
        command: RUN_COMMAND,
        title: runTitle,
        arguments: [target],
      }));
      lenses.push(createCodeLens(this.vscode, runLinkRange(this.vscode, marker, debugTitle), {
        command: DEBUG_COMMAND,
        title: debugTitle,
        arguments: [target],
      }));
      if (marker.kind === "specification" && hasSpecificationDataTable(document, marker.line)) {
        const parallelTitle = "Run in parallel";
        lenses.push(createCodeLens(this.vscode, runLinkRange(this.vscode, marker, parallelTitle), {
          command: IN_PARALLEL_COMMAND,
          title: parallelTitle,
          arguments: [target],
        }));
      }
    }
    return lenses;
  }
}

module.exports = {
  DEBUG_COMMAND,
  GaugeCodeLensProvider,
  IN_PARALLEL_COMMAND,
  RUN_COMMAND,
  headingMarkers,
};
