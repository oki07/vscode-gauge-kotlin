"use strict";

const {
  GaugeStepDiagnosticsProvider,
  findStepFunctions,
  isKotlinDocument,
  positionAt,
} = require("./stepDiagnostics");
const { createDefinitionTrace, NULL_TRACE } = require("./definitionTrace");

function describeDocument(candidate) {
  const file = candidate && candidate.uri && candidate.uri.fsPath;
  const languageId = candidate && candidate.languageId;
  return `${file || "<no-path>"} (languageId=${languageId})`;
}

const GAUGE_LANGUAGE = "gauge";

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

function isDocStringFenceLine(line) {
  return line.trim() === "\"\"\"";
}

function isStepLine(line) {
  return line.startsWith("*");
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

function stepTextAt(document, position) {
  if (!document || document.languageId !== GAUGE_LANGUAGE || !position) {
    return undefined;
  }
  let lineNumber = position.line;
  let line = documentLine(document, lineNumber);
  if (!isStepLine(line)) {
    const docStringStepLine = docStringStepLineAt(document, lineNumber);
    if (docStringStepLine === undefined) {
      return undefined;
    }
    lineNumber = docStringStepLine;
    line = documentLine(document, lineNumber);
  }
  if (!isStepLine(line)) {
    return undefined;
  }
  let stepText = line.slice(1).trim();
  if (!stepText) {
    return undefined;
  }
  const nextLine = documentLine(document, lineNumber + 1);
  if (isInlineTableLine(nextLine)) {
    stepText = `${stepText} <table>`;
  } else if (isDocStringFenceLine(nextLine)) {
    stepText = `${stepText} <text>`;
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

  async findWorkspaceKotlinDocuments(trace = NULL_TRACE) {
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      trace.log(`findWorkspaceKotlinDocuments: workspace.findFiles=${typeof workspace.findFiles} openTextDocument=${typeof workspace.openTextDocument}`);
      return [];
    }

    const documents = [];
    let uris;
    try {
      uris = await workspace.findFiles("**/*.kt");
    } catch (error) {
      trace.log(`findFiles("**/*.kt") threw: ${error && error.message ? error.message : error}`);
      return documents;
    }
    trace.log(`findFiles("**/*.kt") returned ${(uris || []).length} uri(s)`);
    for (const uri of uris || []) {
      try {
        const document = await workspace.openTextDocument(uri);
        documents.push(document);
      } catch (error) {
        // Ignore unreadable files so one stale workspace URI does not block navigation.
        trace.log(`openTextDocument failed for ${uri && uri.fsPath}: ${error && error.message ? error.message : error}`);
      }
    }
    return documents;
  }

  async kotlinDocumentGroups(sourceDocument, trace = NULL_TRACE) {
    const workspace = this.vscode.workspace || {};
    const projectDocuments = [];
    const externalDocuments = [];
    const seenPaths = new Set();
    let rejected = 0;
    const reject = (reason, candidate) => {
      rejected += 1;
      if (trace.enabled && reason !== "duplicate") {
        trace.log(`  reject [${reason}] ${describeDocument(candidate)}`);
      }
    };
    const addDocument = (candidate) => {
      if (!candidate) {
        reject("null", candidate);
        return;
      }
      if (sameDocument(candidate, sourceDocument)) {
        reject("source-document", candidate);
        return;
      }
      if (!isKotlinDocument(candidate)) {
        reject("not-kotlin", candidate);
        return;
      }
      if (typeof candidate.getText !== "function") {
        reject("no-getText", candidate);
        return;
      }
      const file = documentPath(candidate);
      if (file) {
        if (seenPaths.has(file)) {
          reject("duplicate", candidate);
          return;
        }
        seenPaths.add(file);
      } else if (projectDocuments.includes(candidate) || externalDocuments.includes(candidate)) {
        reject("duplicate", candidate);
        return;
      }
      if (this.isGaugeProjectDocument(candidate)) {
        projectDocuments.push(candidate);
        if (trace.enabled) {
          trace.log(`  accept [project]  ${describeDocument(candidate)}`);
        }
      } else {
        externalDocuments.push(candidate);
        if (trace.enabled) {
          trace.log(`  accept [external] ${describeDocument(candidate)}`);
        }
      }
    };

    const openDocuments = workspace.textDocuments || [];
    trace.log(`open textDocuments: ${openDocuments.length}`);
    for (const candidate of openDocuments) {
      addDocument(candidate);
    }
    for (const candidate of await this.findWorkspaceKotlinDocuments(trace)) {
      addDocument(candidate);
    }
    trace.log(`kotlin groups: project=${projectDocuments.length} external=${externalDocuments.length} rejected=${rejected}`);
    return { externalDocuments, projectDocuments };
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

  definitionsForDocuments(wantedStep, documents, constantDocuments, options = {}, trace = NULL_TRACE) {
    const definitions = [];
    for (const candidate of documents) {
      const text = candidate.getText();
      let externalConstants;
      try {
        externalConstants = this.collectWorkspaceConstants(candidate, constantDocuments, options);
      } catch (error) {
        // Never let workspace-constant collection abort navigation: plain
        // @Step("literal") matching still works without resolved constants.
        if (trace.enabled) {
          trace.log(`  collectWorkspaceConstants threw for ${documentPath(candidate)}: ${error && error.message ? error.message : error}`);
        }
        externalConstants = undefined;
      }
      const stepFunctions = findStepFunctions(text, externalConstants);
      let matched = 0;
      const aliasesSeen = [];
      for (const entry of stepFunctions) {
        const normalizedAliases = entry.aliases.map((alias) => normalizeStepTemplate(alias));
        if (trace.enabled) {
          aliasesSeen.push(...normalizedAliases);
        }
        if (!normalizedAliases.some((alias) => alias === wantedStep)) {
          continue;
        }
        matched += 1;
        definitions.push(createLocation(
          this.vscode,
          candidate.uri,
          targetRange(this.vscode, text, entry),
        ));
      }
      if (trace.enabled) {
        trace.log(`  ${documentPath(candidate)}: @Step functions=${stepFunctions.length} matched=${matched}`);
        if (matched === 0 && aliasesSeen.length > 0) {
          trace.log(`     available aliases: ${JSON.stringify(aliasesSeen.slice(0, 12))}`);
        }
      }
    }
    return definitions;
  }

  async provideDefinition(document, position) {
    const trace = createDefinitionTrace(this.vscode);
    try {
      const wantedStep = stepTextAt(document, position);
      const gaugeProject = this.isGaugeProjectDocument(document);
      if (trace.enabled) {
        trace.log("provideDefinition called");
        trace.log(`  file=${document && document.uri && document.uri.fsPath}`);
        trace.log(`  languageId=${document && document.languageId} position=${position && position.line}:${position && position.character}`);
        trace.log(`  line=${JSON.stringify(documentLine(document, position && position.line))}`);
        trace.log(`  wantedStep=${JSON.stringify(wantedStep)}`);
        trace.log(`  isGaugeProjectDocument=${gaugeProject}`);
      }
      if (!wantedStep || !gaugeProject) {
        trace.log("  -> returning [] (no step text or not a Gauge project)");
        return [];
      }

      const {
        externalDocuments,
        projectDocuments,
      } = await this.kotlinDocumentGroups(document, trace);
      trace.log("project group matches:");
      const projectDefinitions = this.definitionsForDocuments(
        wantedStep,
        projectDocuments,
        projectDocuments,
        {},
        trace,
      );
      if (projectDefinitions.length > 0) {
        trace.log(`  -> ${projectDefinitions.length} definition(s) from project group`);
        return projectDefinitions;
      }
      trace.log("external group matches:");
      const externalDefinitions = this.definitionsForDocuments(
        wantedStep,
        externalDocuments,
        [...projectDocuments, ...externalDocuments],
        { includeExternalWorkspace: true },
        trace,
      );
      trace.log(`  -> ${externalDefinitions.length} definition(s) from external group`);
      return externalDefinitions;
    } catch (error) {
      trace.log(`  !! threw: ${error && error.stack ? error.stack : error}`);
      throw error;
    } finally {
      trace.flush();
    }
  }

  register() {
    if (!this.vscode.languages || typeof this.vscode.languages.registerDefinitionProvider !== "function") {
      return { dispose() {} };
    }
    const disposable = this.vscode.languages.registerDefinitionProvider(
      { language: GAUGE_LANGUAGE },
      this,
    );
    const trace = createDefinitionTrace(this.vscode);
    trace.log(`definition provider registered for language "${GAUGE_LANGUAGE}"`);
    trace.flush({ reveal: false });
    return disposable;
  }
}

module.exports = {
  GaugeStepDefinitionProvider,
  normalizeStepTemplate,
  stepTextAt,
};
