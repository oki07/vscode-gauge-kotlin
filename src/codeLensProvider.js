"use strict";

const RUN_COMMAND = "gauge.execute";
const DEBUG_COMMAND = "gauge.debug";

function getVscode(vscode) {
  return vscode || {};
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function isConceptDocument(document) {
  return documentPath(document).toLowerCase().endsWith(".cpt");
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

function hasHeadingText(line) {
  return Boolean(line && line.trim());
}

function hashHeadingKind(line) {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("#")) {
    return undefined;
  }
  return trimmed.startsWith("##") ? "scenario" : "specification";
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
    : ["Run Specification", "Debug Specification"];
}

class GaugeCodeLensProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
  }

  provideCodeLenses(document) {
    if (!document || document.languageId !== "gauge" || isConceptDocument(document)) {
      return [];
    }
    const file = documentPath(document);
    if (!file) {
      return [];
    }

    const lenses = [];
    for (const marker of headingMarkers(document)) {
      const range = createRange(this.vscode, marker.line, marker.start, marker.end);
      const target = targetForMarker(file, marker);
      const [runTitle, debugTitle] = titlesForMarker(marker);
      lenses.push(createCodeLens(this.vscode, range, {
        command: RUN_COMMAND,
        title: runTitle,
        arguments: [target],
      }));
      lenses.push(createCodeLens(this.vscode, range, {
        command: DEBUG_COMMAND,
        title: debugTitle,
        arguments: [target],
      }));
    }
    return lenses;
  }
}

module.exports = {
  DEBUG_COMMAND,
  GaugeCodeLensProvider,
  RUN_COMMAND,
  headingMarkers,
};
