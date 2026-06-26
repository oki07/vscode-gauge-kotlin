"use strict";

function documentLines(document) {
  const lines = [];
  for (let line = 0; line < document.lineCount; line += 1) {
    lines.push(document.lineAt(line).text);
  }
  return lines;
}

function isSingleHashHeading(line) {
  return /^\s*#(?!#).*$/.test(line);
}

function isDoubleHashHeading(line) {
  return /^\s*##.*$/.test(line);
}

function isLegacySpecUnderline(line) {
  return /^\s*=+\s*$/.test(line);
}

function isLegacyScenarioUnderline(line) {
  return /^\s*-+\s*$/.test(line);
}

function isTeardown(line) {
  return /^\s*___+\s*$/.test(line);
}

function hasLegacyHeadingText(line) {
  return Boolean(line && line.trim());
}

function foldingMarkers(lines) {
  const markers = [];
  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line];
    const nextText = lines[line + 1];

    if (hasLegacyHeadingText(text)
      && (isLegacySpecUnderline(nextText) || isLegacyScenarioUnderline(nextText))) {
      markers.push({ startLine: line + 1, boundaryLine: line });
      line += 1;
      continue;
    }

    if (isSingleHashHeading(text) || isDoubleHashHeading(text) || isTeardown(text)) {
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
    const markers = foldingMarkers(lines);
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
