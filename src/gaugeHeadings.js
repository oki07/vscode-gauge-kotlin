"use strict";

function trimmedHashText(line) {
  return String(line || "").trimStart();
}

function isSpecHashHeading(line) {
  const text = trimmedHashText(line);
  return text.startsWith("#") && !text.startsWith("##");
}

function isScenarioHashHeading(line) {
  const text = trimmedHashText(line);
  return text.startsWith("##");
}

function isGaugeHashHeading(line) {
  return isSpecHashHeading(line) || isScenarioHashHeading(line);
}

function isConceptHashHeading(line) {
  return trimmedHashText(line).startsWith("#");
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
  const index = String(line || "").search(/\S/);
  return index === -1 ? 0 : index;
}

function isStepLine(line) {
  const marker = String(line || "").search(/\S/);
  return marker !== -1 && line[marker] === "*";
}

function isDocStringFenceLine(line) {
  return String(line || "").trim() === "\"\"\"";
}

function closedDocStringLines(lines) {
  const result = new Set();
  for (let stepLine = 0; stepLine < lines.length; stepLine += 1) {
    if (!isStepLine(lines[stepLine])) {
      continue;
    }
    const openLine = stepLine + 1;
    if (!isDocStringFenceLine(lines[openLine])) {
      continue;
    }
    let closeLine;
    for (let candidateLine = openLine + 1; candidateLine < lines.length; candidateLine += 1) {
      if (isDocStringFenceLine(lines[candidateLine])) {
        closeLine = candidateLine;
        break;
      }
    }
    if (closeLine === undefined) {
      continue;
    }
    for (let line = openLine; line <= closeLine; line += 1) {
      result.add(line);
    }
    stepLine = closeLine;
  }
  return result;
}

function headingKind(line) {
  if (isScenarioHashHeading(line)) {
    return "scenario";
  }
  return isSpecHashHeading(line) ? "specification" : undefined;
}

function legacyHeadingKind(line, nextLine) {
  if (!String(line || "").trim()) {
    return undefined;
  }
  if (/^=+$/.test(nextLine || "")) {
    return "specification";
  }
  if (/^-+$/.test(nextLine || "")) {
    return "scenario";
  }
  return undefined;
}

function headingMarkers(document) {
  const markers = [];
  const lineCount = documentLineCount(document);
  const lines = Array.from({ length: lineCount }, (_value, line) => documentLine(document, line));
  const docStringLines = closedDocStringLines(lines);
  for (let line = 0; line < lineCount; line += 1) {
    if (docStringLines.has(line)) {
      continue;
    }
    const text = lines[line];
    const hashKind = headingKind(text);
    if (hashKind) {
      markers.push({ kind: hashKind, line, start: firstNonWhitespace(text), end: text.length });
      continue;
    }

    const legacyKind = legacyHeadingKind(text, lines[line + 1]);
    if (legacyKind) {
      markers.push({ kind: legacyKind, line, start: firstNonWhitespace(text), end: text.length });
      line += 1;
    }
  }
  return markers;
}

module.exports = {
  closedDocStringLines,
  headingMarkers,
  isConceptHashHeading,
  isDocStringFenceLine,
  isGaugeHashHeading,
  isScenarioHashHeading,
  isSpecHashHeading,
  isStepLine,
};
