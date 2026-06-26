"use strict";

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
  return documentPath(document).toLowerCase().endsWith(".cpt");
}

function isSingleHashHeading(line) {
  return /^\s*#(?!#).*$/.test(line);
}

function isDoubleHashHeading(line) {
  return /^\s*##.*$/.test(line);
}

function isHashHeading(line, conceptDocument) {
  return conceptDocument ? line.startsWith("#") : isSingleHashHeading(line) || isDoubleHashHeading(line);
}

function isLegacySpecUnderline(line) {
  return /^=+$/.test(line);
}

function isLegacyScenarioUnderline(line) {
  return /^-+$/.test(line);
}

function isTeardown(line) {
  return /^___+\s*$/.test(line);
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

    if (isHashHeading(text, conceptDocument) || (!conceptDocument && isTeardown(text))) {
      markers.push({ startLine: line, boundaryLine: line });
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
  provideFoldingRanges(document) {
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
