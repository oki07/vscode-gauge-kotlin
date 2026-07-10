"use strict";

const {
  isConceptHashHeading,
  isGaugeHashHeading,
} = require("./gaugeHeadings");

const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const SPEC_FILE_EXTENSION = ".spec";
const CONCEPT_FILE_EXTENSION = ".cpt";
const MARKDOWN_SPEC_EXTENSION = ".md";

function documentLines(document) {
  const lines = [];
  for (let line = 0; line < document.lineCount; line += 1) {
    lines.push(document.lineAt(line).text);
  }
  return lines;
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || document.fileName || "";
}

function isConceptDocument(document) {
  return Boolean(document && document.languageId === GAUGE_CONCEPT_LANGUAGE)
    || documentPath(document).toLowerCase().endsWith(CONCEPT_FILE_EXTENSION);
}

function isSpecDocument(document) {
  return documentPath(document).toLowerCase().endsWith(SPEC_FILE_EXTENSION);
}

function isMarkdownSpecDocument(document, filePath) {
  return Boolean(
    document
    && document.languageId === MARKDOWN_LANGUAGE
    && filePath.toLowerCase().endsWith(MARKDOWN_SPEC_EXTENSION)
  );
}

function isHashHeading(line, conceptDocument) {
  return conceptDocument ? isConceptHashHeading(line) : isGaugeHashHeading(line);
}

function isLegacySpecUnderline(line) {
  return /^=+$/.test(line);
}

function isLegacyScenarioUnderline(line) {
  return /^-+$/.test(line);
}

function isTeardown(line) {
  return /^___+\s*$/.test(String(line || "").trimStart());
}

function hasLegacyHeadingText(line) {
  return Boolean(line && line.trim());
}

function isConceptLegacyUnderlineHeadingText(line) {
  return hasLegacyHeadingText(line) && !/[#*|]/.test(line);
}

function foldingMarkers(lines, options = {}) {
  const markers = [];
  const conceptDocument = Boolean(options.conceptDocument);
  let seenTeardown = false;
  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line];
    const nextText = lines[line + 1];

    if (
      hasLegacyHeadingText(text)
      && isLegacySpecUnderline(nextText)
      && (!conceptDocument || isConceptLegacyUnderlineHeadingText(text))
    ) {
      markers.push({ startLine: line + 1, boundaryLine: line });
      line += 1;
      continue;
    }

    if (!conceptDocument && hasLegacyHeadingText(text) && isLegacyScenarioUnderline(nextText)) {
      markers.push({ startLine: line + 1, boundaryLine: line });
      line += 1;
      continue;
    }

    if (isHashHeading(text, conceptDocument)) {
      markers.push({ startLine: line, boundaryLine: line });
      continue;
    }

    if (!conceptDocument && isTeardown(text)) {
      if (!seenTeardown) {
        markers.push({ startLine: line, boundaryLine: line });
        seenTeardown = true;
      }
    }
  }
  return markers;
}

function trimEndLine(lines, startLine, endLine) {
  let line = endLine;
  while (line > startLine && !lines[line].trim()) {
    line -= 1;
  }
  return line;
}

class GaugeFoldingRangeProvider {
  constructor(options = {}) {
    this.projectFactory = options.projectFactory;
  }

  isGaugeProjectDocument(document) {
    const file = documentPath(document);
    if (!file) {
      return false;
    }
    if (!this.projectFactory) {
      return document && (
        document.languageId === GAUGE_LANGUAGE
        || isSpecDocument(document)
        || isConceptDocument(document)
      );
    }
    if (typeof this.projectFactory.getGaugeRootFromFilePath !== "function") {
      return document && (
        document.languageId === GAUGE_LANGUAGE
        || isSpecDocument(document)
        || isConceptDocument(document)
      );
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

  provideFoldingRanges(document) {
    const file = documentPath(document);
    const supportedDocument = document && (
      document.languageId === GAUGE_LANGUAGE
      || isSpecDocument(document)
      || isConceptDocument(document)
      || isMarkdownSpecDocument(document, file)
    );
    if (!supportedDocument || !this.isGaugeProjectDocument(document)) {
      return [];
    }

    const lines = documentLines(document);
    const markers = foldingMarkers(lines, { conceptDocument: isConceptDocument(document) });
    const ranges = [];

    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      const nextMarker = markers[index + 1];
      const rawEndLine = nextMarker ? nextMarker.boundaryLine - 1 : lines.length - 1;
      const endLine = trimEndLine(lines, marker.startLine, rawEndLine);
      if (endLine > marker.startLine) {
        ranges.push({ start: marker.startLine, end: endLine });
      }
    }

    return ranges;
  }
}

module.exports = {
  GaugeFoldingRangeProvider,
};
