"use strict";

const tokenTypes = [
  "specification",
  "scenario",
  "stepMarker",
  "step",
  "argument",
  "table",
  "tableHeaderSeparator",
  "tableBorder",
  "tableKeyword",
  "tableFileValue",
  "tagKeyword",
  "tagValue",
  "disabledStep",
  "gaugeComment",
];
const tokenModifiers = [];

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createLegend(vscode) {
  const api = getVscode(vscode);
  return new api.SemanticTokensLegend(tokenTypes, tokenModifiers);
}

function fallbackLegend() {
  return { tokenTypes, tokenModifiers };
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || document.fileName || "";
}

function isConceptDocument(document) {
  return documentPath(document).toLowerCase().endsWith(".cpt");
}

function pushToken(builder, line, start, length, tokenType) {
  if (length <= 0) {
    return;
  }
  builder.push(line, start, length, tokenTypes.indexOf(tokenType), 0);
}

function pushTableSegment(builder, lineNumber, line, start, end) {
  let tokenStart = start;
  let currentType;

  for (let charIndex = start; charIndex < end; charIndex += 1) {
    const tokenType = line[charIndex] === "|" && !isEscapedPipe(line, charIndex) ? "tableBorder" : "table";
    if (!currentType) {
      currentType = tokenType;
      tokenStart = charIndex;
    } else if (currentType !== tokenType) {
      pushToken(builder, lineNumber, tokenStart, charIndex - tokenStart, currentType);
      currentType = tokenType;
      tokenStart = charIndex;
    }
  }

  if (currentType) {
    pushToken(builder, lineNumber, tokenStart, end - tokenStart, currentType);
  }
}

function isEscapedPipe(line, index) {
  return index > 0 && line[index - 1] === "\\";
}

class GaugeSemanticTokensProvider {
  constructor(options = {}) {
    this.vscode = options.vscode;
    this.SemanticTokensBuilder = options.SemanticTokensBuilder
      || getVscode(this.vscode).SemanticTokensBuilder;
    this.legend = options.legend || (this.vscode ? createLegend(this.vscode) : fallbackLegend());
  }

  provideDocumentSemanticTokens(document) {
    const builder = new this.SemanticTokensBuilder(this.legend);
    const lines = document.getText().split(/\r?\n/);
    const argumentRegex = /(?:"(?:\\"|[^"\r\n])*"|<(?:\\[<>]|[^>\r\n])*>)/g;
    const tableDynamicArgumentRegex = /<(?:\\[<>]|[^>\r\n])*>/g;
    const tableHeaderSeparatorRegex = /^\|\s*-+\s*(\|\s*-+\s*)+\|?$/;

    for (let index = 0; index < lines.length;) {
      const line = lines[index];
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith("//")) {
        builder.push(index, 0, line.length, tokenTypes.indexOf("disabledStep"), 0);
        index += 1;
        continue;
      }

      if (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        const trimmedNextLine = nextLine.trim();
        if (trimmedNextLine.length > 0 && /^[=]+$/.test(trimmedNextLine)) {
          const leadingSpaces = line.length - line.trimStart().length;
          builder.push(index, leadingSpaces, line.length - leadingSpaces, tokenTypes.indexOf("specification"), 0);
          builder.push(index + 1, 0, nextLine.length, tokenTypes.indexOf("specification"), 0);
          index += 2;
          continue;
        }
        if (trimmedNextLine.length > 0 && /^[-]+$/.test(trimmedNextLine)) {
          const leadingSpaces = line.length - line.trimStart().length;
          builder.push(index, leadingSpaces, line.length - leadingSpaces, tokenTypes.indexOf("scenario"), 0);
          builder.push(index + 1, 0, nextLine.length, tokenTypes.indexOf("scenario"), 0);
          index += 2;
          continue;
        }
      }

      if (trimmedLine.startsWith("#")) {
        let lastIndex = line.search(/\S/);
        const isScenarioHeading = trimmedLine.startsWith("##");
        const headingToken = isScenarioHeading ? "scenario" : "specification";
        if (isScenarioHeading || !isConceptDocument(document)) {
          builder.push(index, lastIndex, line.length - lastIndex, tokenTypes.indexOf(headingToken), 0);
          index += 1;
          continue;
        }

        argumentRegex.lastIndex = 0;
        let match = argumentRegex.exec(line);
        while (match !== null) {
          const matchStart = match.index;
          if (matchStart > lastIndex) {
            builder.push(index, lastIndex, matchStart - lastIndex, tokenTypes.indexOf(headingToken), 0);
          }
          builder.push(index, matchStart, match[0].length, tokenTypes.indexOf("argument"), 0);
          lastIndex = argumentRegex.lastIndex;
          match = argumentRegex.exec(line);
        }
        if (lastIndex < line.length) {
          builder.push(index, lastIndex, line.length - lastIndex, tokenTypes.indexOf(headingToken), 0);
        }
        index += 1;
      } else if (trimmedLine.toLowerCase().startsWith("table:")) {
        const leadingSpaces = line.length - line.trimStart().length;
        const keyword = "table:";
        builder.push(index, leadingSpaces, keyword.length, tokenTypes.indexOf("tableKeyword"), 0);
        const valueStart = leadingSpaces + keyword.length;
        if (valueStart < line.length) {
          builder.push(index, valueStart, line.length - valueStart, tokenTypes.indexOf("tableFileValue"), 0);
        }
        index += 1;
      } else if (trimmedLine.toLowerCase().startsWith("tags:")) {
        const leadingSpaces = line.length - line.trimStart().length;
        const keyword = "tags:";
        builder.push(index, leadingSpaces, keyword.length, tokenTypes.indexOf("tagKeyword"), 0);
        const valueStart = leadingSpaces + keyword.length;
        if (valueStart < line.length) {
          builder.push(index, valueStart, line.length - valueStart, tokenTypes.indexOf("tagValue"), 0);
        }
        index += 1;
      } else if (trimmedLine.startsWith("*")) {
        const markerStart = line.indexOf("*");
        if (markerStart !== -1) {
          builder.push(index, markerStart, 1, tokenTypes.indexOf("stepMarker"), 0);
          let lastIndex = markerStart + 1;
          argumentRegex.lastIndex = 0;
          let match = argumentRegex.exec(line);
          while (match !== null) {
            const matchStart = match.index;
            if (matchStart > lastIndex) {
              builder.push(index, lastIndex, matchStart - lastIndex, tokenTypes.indexOf("step"), 0);
            }
            builder.push(index, matchStart, match[0].length, tokenTypes.indexOf("argument"), 0);
            lastIndex = argumentRegex.lastIndex;
            match = argumentRegex.exec(line);
          }
          if (lastIndex < line.length) {
            builder.push(index, lastIndex, line.length - lastIndex, tokenTypes.indexOf("step"), 0);
          }
        }
        index += 1;
      } else if (trimmedLine.startsWith("|")) {
        if (tableHeaderSeparatorRegex.test(trimmedLine)) {
          for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
            const char = line[charIndex];
            if (char === "|") {
              builder.push(index, charIndex, 1, tokenTypes.indexOf("tableBorder"), 0);
            } else if (char === "-") {
              const start = charIndex;
              while (charIndex < line.length && line[charIndex] === "-") {
                charIndex += 1;
              }
              builder.push(index, start, charIndex - start, tokenTypes.indexOf("tableHeaderSeparator"), 0);
              charIndex -= 1;
            } else {
              builder.push(index, charIndex, 1, tokenTypes.indexOf("table"), 0);
            }
          }
        } else {
          let lastIndex = 0;
          tableDynamicArgumentRegex.lastIndex = 0;
          let match = tableDynamicArgumentRegex.exec(line);
          while (match !== null) {
            pushTableSegment(builder, index, line, lastIndex, match.index);
            pushToken(builder, index, match.index, match[0].length, "argument");
            lastIndex = tableDynamicArgumentRegex.lastIndex;
            match = tableDynamicArgumentRegex.exec(line);
          }
          pushTableSegment(builder, index, line, lastIndex, line.length);
        }
        index += 1;
      } else {
        if (trimmedLine.length > 0) {
          builder.push(index, 0, line.length, tokenTypes.indexOf("gaugeComment"), 0);
        }
        index += 1;
      }
    }

    return builder.build();
  }
}

module.exports = {
  GaugeSemanticTokensProvider,
  createLegend,
  tokenModifiers,
  tokenTypes,
};
