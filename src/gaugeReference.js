"use strict";

const SHOW_REFERENCES = "editor.action.showReferences";
const SHOW_REFERENCES_AT_CURSOR = "gauge.showReferences.atCursor";
const SHOW_REFERENCES_FOR_STEP = "gauge.showReferences";
const STEP_REFERENCES_REQUEST = "gauge/stepReferences";
const STEP_VALUE_AT_REQUEST = "gauge/stepValueAt";
const GAUGE_LANGUAGE = "gauge";
const KOTLIN_LANGUAGE = "kotlin";
const GAUGE_REFERENCE_PATTERNS = ["**/*.spec", "**/*.cpt"];

const {
  GaugeStepDiagnosticsProvider,
  findStepFunctions,
} = require("./stepDiagnostics");
const { normalizeStepTemplate } = require("./stepDefinitionProvider");

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createCancellationToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
}

function textDocumentIdentifier(uri) {
  return { uri };
}

function documentPath(document) {
  return document && document.uri && document.uri.fsPath;
}

function uriPath(uri) {
  return uri && uri.fsPath;
}

function sameDocument(left, right) {
  if (left === right) {
    return true;
  }
  const leftPath = documentPath(left);
  const rightPath = documentPath(right);
  return Boolean(leftPath && rightPath && leftPath === rightPath);
}

function documentUri(document) {
  if (document && document.uri && typeof document.uri.toString === "function") {
    return document.uri.toString();
  }
  const file = documentPath(document);
  return file ? `file://${file}` : undefined;
}

function offsetAt(text, position) {
  let offset = 0;
  let line = 0;
  while (line < position.line && offset < text.length) {
    const nextLine = text.indexOf("\n", offset);
    if (nextLine === -1) {
      return text.length;
    }
    offset = nextLine + 1;
    line += 1;
  }
  return Math.min(offset + position.character, text.length);
}

function commentEnd(text, index) {
  if (text.startsWith("//", index)) {
    const lineEnd = text.indexOf("\n", index + 2);
    return lineEnd === -1 ? text.length : lineEnd;
  }
  if (text.startsWith("/*", index)) {
    const blockEnd = text.indexOf("*/", index + 2);
    return blockEnd === -1 ? text.length : blockEnd + 2;
  }
  return undefined;
}

function stringLiteralEnd(text, start, limit) {
  if (text.startsWith("\"\"\"", start)) {
    const end = text.indexOf("\"\"\"", start + 3);
    return end === -1 || end + 3 > limit ? -1 : end + 3;
  }

  for (let index = start + 1; index < limit; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === "\"") {
      return index + 1;
    }
  }
  return -1;
}

function stringLiteralRanges(text, start, end) {
  const ranges = [];
  for (let index = start; index < end; index += 1) {
    const nextCommentEnd = commentEnd(text, index);
    if (nextCommentEnd !== undefined) {
      index = nextCommentEnd - 1;
      continue;
    }
    if (text[index] !== "\"") {
      continue;
    }
    const literalEnd = stringLiteralEnd(text, index, end);
    if (literalEnd === -1) {
      continue;
    }
    ranges.push({ start: index, end: literalEnd });
    index = literalEnd - 1;
  }
  return ranges;
}

function aliasAtOffset(entry, text, offset) {
  if (
    entry.annotationStart !== undefined
    && entry.annotationEnd !== undefined
    && offset >= entry.annotationStart
    && offset <= entry.annotationEnd
  ) {
    const ranges = stringLiteralRanges(text, entry.annotationStart, entry.annotationEnd);
    const rangeIndex = ranges.findIndex((range) => offset >= range.start && offset <= range.end);
    if (rangeIndex !== -1) {
      if (entry.aliases.length === 1) {
        return entry.aliases[0];
      }
      if (ranges.length === entry.aliases.length && entry.aliases[rangeIndex] !== undefined) {
        return entry.aliases[rangeIndex];
      }
    }
  }
  return entry.aliases[0];
}

function hasLocations(locations) {
  return Array.isArray(locations) ? locations.length > 0 : Boolean(locations);
}

function gaugeStepText(line) {
  if (!line.startsWith("*")) {
    return undefined;
  }
  const stepText = line.slice(1).trim();
  return stepText || undefined;
}

function isInlineTableLine(line) {
  return line.trimStart().startsWith("|");
}

function localGaugeStepReferences(document, targetTemplate) {
  const uri = documentUri(document);
  if (!uri || typeof document.getText !== "function") {
    return [];
  }

  const locations = [];
  const lines = document.getText().split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    let stepText = gaugeStepText(lines[lineIndex]);
    if (stepText && lines[lineIndex + 1] && isInlineTableLine(lines[lineIndex + 1])) {
      stepText = `${stepText} <table>`;
    }
    if (!stepText || normalizeStepTemplate(stepText) !== targetTemplate) {
      continue;
    }
    locations.push({
      uri,
      range: {
        start: { line: lineIndex, character: 0 },
        end: { line: lineIndex, character: lines[lineIndex].length },
      },
    });
  }
  return locations;
}

class ReferenceProvider {
  constructor(clients, options = {}) {
    this.clients = clients;
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
    this.diagnosticsProvider = new GaugeStepDiagnosticsProvider({
      projectFactory: this.projectFactory,
      vscode: this.vscode,
    });
    this.disposables = [];
    this.registerCommands();
  }

  registerCommands() {
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return;
    }

    this.disposables.push(
      this.vscode.commands.registerCommand(
        SHOW_REFERENCES_AT_CURSOR,
        () => this.showStepReferencesAtCursor(),
      ),
    );
    this.disposables.push(
      this.vscode.commands.registerCommand(
        SHOW_REFERENCES_FOR_STEP,
        (uri, position, stepValue) => this.showStepReferences(uri, position, stepValue),
      ),
    );
  }

  dispose() {
    for (const disposable of this.disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
  }

  showStepReferences(uri, position, stepValue) {
    const languageClient = this.clients.get(this.vscode.Uri.parse(uri).fsPath).client;
    return languageClient
      .sendRequest(STEP_REFERENCES_REQUEST, stepValue, createCancellationToken(this.vscode))
      .then(async (locations) => {
        const resolvedLocations = hasLocations(locations)
          ? locations
          : await this.localStepReferences(stepValue);
        return this.showReferences(resolvedLocations, uri, languageClient, position);
      });
  }

  showStepReferencesAtCursor() {
    const editor = this.vscode.window.activeTextEditor;
    const position = editor.selection.active;
    const activeUri = editor.document.uri;
    const documentId = textDocumentIdentifier(activeUri.toString());
    const languageClient = this.clients.get(activeUri.fsPath).client;
    const params = { textDocument: documentId, position };

    return languageClient
      .sendRequest(STEP_VALUE_AT_REQUEST, params, createCancellationToken(this.vscode))
      .then(async (stepValue) => {
        const localStepValue = stepValue
          ? undefined
          : await this.kotlinStepValueAt(editor.document, position);
        return this.showStepReferences(
          documentId.uri,
          position,
          stepValue || localStepValue || stepValue,
        );
      });
  }

  async findWorkspaceKotlinDocuments() {
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    let uris;
    try {
      uris = await workspace.findFiles("**/*.kt");
    } catch (_error) {
      return [];
    }

    const documents = [];
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
        documents.push(await workspace.openTextDocument(uri));
      } catch (_error) {
        // Ignore unreadable files so one stale workspace URI does not block references.
      }
    }
    return documents;
  }

  async findWorkspaceGaugeDocuments() {
    const workspace = this.vscode.workspace || {};
    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return [];
    }

    const documents = [];
    for (const pattern of GAUGE_REFERENCE_PATTERNS) {
      let uris;
      try {
        uris = await workspace.findFiles(pattern);
      } catch (_error) {
        continue;
      }

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
          documents.push(await workspace.openTextDocument(uri));
        } catch (_error) {
          // Ignore unreadable files so one stale workspace URI does not block local references.
        }
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
        || !this.diagnosticsProvider.isGaugeProjectDocument(candidate)
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

  async kotlinStepValueAt(document, position) {
    if (
      !document
      || document.languageId !== KOTLIN_LANGUAGE
      || typeof document.getText !== "function"
      || !position
    ) {
      return undefined;
    }

    const text = document.getText();
    const offset = offsetAt(text, position);
    const externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(
      document,
      await this.kotlinDocuments(document),
    );
    for (const entry of findStepFunctions(text, externalConstants)) {
      const start = entry.annotationStart !== undefined ? entry.annotationStart : entry.parameterStart;
      const end = entry.declarationEnd !== undefined ? entry.declarationEnd : entry.parameterEnd;
      if (offset >= start && offset <= end) {
        return aliasAtOffset(entry, text, offset);
      }
    }
    return undefined;
  }

  async gaugeDocuments() {
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || candidate.languageId !== GAUGE_LANGUAGE
        || typeof candidate.getText !== "function"
        || !this.diagnosticsProvider.isGaugeProjectDocument(candidate)
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
    for (const candidate of await this.findWorkspaceGaugeDocuments()) {
      addDocument(candidate);
    }
    return documents;
  }

  async localStepReferences(stepValue) {
    if (!stepValue) {
      return undefined;
    }
    const targetTemplate = normalizeStepTemplate(stepValue);
    const locations = [];
    for (const document of await this.gaugeDocuments()) {
      locations.push(...localGaugeStepReferences(document, targetTemplate));
    }
    return locations.length > 0 ? locations : undefined;
  }

  showReferences(locations, uri, languageClient, position) {
    if (locations) {
      return this.vscode.commands.executeCommand(
        SHOW_REFERENCES,
        this.vscode.Uri.parse(uri),
        languageClient.protocol2CodeConverter.asPosition(position),
        locations.map((location) => languageClient.protocol2CodeConverter.asLocation(location)),
      );
    }
    this.vscode.window.showInformationMessage("Action NA: Try this on an implementation.");
    return Promise.resolve(false);
  }
}

module.exports = {
  ReferenceProvider,
};
