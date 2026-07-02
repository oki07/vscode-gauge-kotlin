"use strict";

const {
  isConceptHashHeading,
  isGaugeHashHeading,
} = require("./gaugeHeadings");

const GAUGE_LANGUAGE = "gauge";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_PATTERN = /\.spec$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const SYMBOL_KIND_NAMESPACE = 3;

function getVscode(vscode) {
  return vscode || require("vscode");
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function isSpecDocument(document) {
  return SPEC_FILE_PATTERN.test(documentPath(document));
}

function isConceptDocument(document) {
  return CONCEPT_FILE_PATTERN.test(documentPath(document));
}

function isMarkdownDocument(document) {
  return document
    && document.languageId === MARKDOWN_LANGUAGE
    && MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document));
}

function isGaugeProjectDocument(document, projectFactory, fallback) {
  if (!document || document.languageId === GAUGE_LANGUAGE) {
    return Boolean(document);
  }
  if (
    !projectFactory
    || typeof projectFactory.getGaugeRootFromFilePath !== "function"
  ) {
    return fallback;
  }
  try {
    const root = projectFactory.getGaugeRootFromFilePath(documentPath(document));
    if (typeof projectFactory.isGaugeProject === "function") {
      return projectFactory.isGaugeProject(root) !== false;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function supportedDocument(document, projectFactory) {
  if (isMarkdownDocument(document)) {
    return isGaugeProjectDocument(document, projectFactory, false);
  }
  if (isSpecDocument(document) || isConceptDocument(document)) {
    return isGaugeProjectDocument(document, projectFactory, true);
  }
  return document && document.languageId === GAUGE_LANGUAGE;
}

function documentLines(document) {
  if (!document) {
    return [];
  }
  if (typeof document.lineCount === "number" && typeof document.lineAt === "function") {
    const lines = [];
    for (let line = 0; line < document.lineCount; line += 1) {
      lines.push(document.lineAt(line).text);
    }
    return lines;
  }
  if (typeof document.getText === "function") {
    return document.getText().split(/\r?\n/);
  }
  return [];
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

function createLocation(vscode, uri, range) {
  if (typeof vscode.Location === "function") {
    return new vscode.Location(uri, range);
  }
  return { uri, range };
}

function symbolKindNamespace(vscode) {
  return (vscode.SymbolKind && vscode.SymbolKind.Namespace) || SYMBOL_KIND_NAMESPACE;
}

function createSymbol(vscode, document, lineNumber, start, end, name) {
  const range = createRange(vscode, lineNumber, start, end);
  return {
    name,
    kind: symbolKindNamespace(vscode),
    location: createLocation(vscode, document.uri, range),
  };
}

function headingStart(line) {
  const start = line.search(/\S/);
  return start === -1 ? 0 : start;
}

function hasLegacyHeadingText(line) {
  return Boolean(line && line.trim());
}

function isConceptLegacyUnderlineHeadingText(line) {
  return hasLegacyHeadingText(line) && !/[#*|]/.test(line);
}

function isSpecUnderline(line) {
  return /^=+$/.test(line);
}

function isScenarioUnderline(line) {
  return /^-+$/.test(line);
}

function legacyHeadingAt(lines, line, conceptDocument) {
  const text = lines[line];
  const nextText = lines[line + 1];
  if (
    hasLegacyHeadingText(text)
    && isSpecUnderline(nextText)
    && (!conceptDocument || isConceptLegacyUnderlineHeadingText(text))
  ) {
    return text;
  }
  if (!conceptDocument && hasLegacyHeadingText(text) && isScenarioUnderline(nextText)) {
    return text;
  }
  return undefined;
}

function hashHeadingAt(line, conceptDocument) {
  if (conceptDocument) {
    return isConceptHashHeading(line) ? line : undefined;
  }
  return isGaugeHashHeading(line) ? line : undefined;
}

class GaugeDocumentSymbolProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
  }

  provideDocumentSymbols(document) {
    if (!supportedDocument(document, this.projectFactory)) {
      return [];
    }
    const lines = documentLines(document);
    const conceptDocument = isConceptDocument(document);
    const symbols = [];

    for (let line = 0; line < lines.length; line += 1) {
      const text = lines[line];
      const hashHeading = hashHeadingAt(text, conceptDocument);
      if (hashHeading) {
        symbols.push(createSymbol(
          this.vscode,
          document,
          line,
          headingStart(text),
          text.length,
          hashHeading.trimStart(),
        ));
        continue;
      }

      const legacyHeading = legacyHeadingAt(lines, line, conceptDocument);
      if (legacyHeading) {
        symbols.push(createSymbol(
          this.vscode,
          document,
          line,
          headingStart(legacyHeading),
          legacyHeading.length,
          legacyHeading.trim(),
        ));
        line += 1;
      }
    }

    return symbols;
  }
}

module.exports = {
  GaugeDocumentSymbolProvider,
};
