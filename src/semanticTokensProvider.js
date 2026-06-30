"use strict";

const {
  isConceptHashHeading,
  isGaugeHashHeading,
  isScenarioHashHeading,
} = require("./gaugeHeadings");

const MARKDOWN_LANGUAGE = "markdown";
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;

const tokenTypes = [
  "specification",
  "scenario",
  "stepMarker",
  "step",
  "argument",
  "dynamicArgument",
  "table",
  "tableHeader",
  "tableHeaderSeparator",
  "tableBorder",
  "tableKeyword",
  "tableFileValue",
  "tagKeyword",
  "tagValue",
  "disabledStep",
  "gaugeComment",
  "teardownIdentifier",
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

function isMarkdownDocument(document) {
  return document
    && document.languageId === MARKDOWN_LANGUAGE
    && MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document));
}

function pushToken(builder, line, start, length, tokenType) {
  if (length <= 0) {
    return;
  }
  builder.push(line, start, length, tokenTypes.indexOf(tokenType), 0);
}

function pushArgumentToken(builder, line, start, text) {
  pushToken(
    builder,
    line,
    start,
    text.length,
    text.startsWith("<") ? "dynamicArgument" : "argument",
  );
}

function pushTableSegment(builder, lineNumber, line, start, end, textTokenType = "table") {
  let tokenStart = start;
  let currentType;

  for (let charIndex = start; charIndex < end; charIndex += 1) {
    const tokenType = line[charIndex] === "|" && !isEscapedPipe(line, charIndex)
      ? "tableBorder"
      : textTokenType;
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
  return isEscapedCharacter(line, index);
}

function isEscapedCharacter(line, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function keywordLinePrefix(line, keyword) {
  const keywordRegex = new RegExp(`^(\\s*)${keyword}[ \\t\\f]?:`, "i");
  const match = keywordRegex.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    leadingSpaces: match[1].length,
    length: match[0].length - match[1].length,
  };
}

function pushKeywordLine(builder, lineNumber, line, keyword, keywordTokenType, valueTokenType) {
  const prefix = keywordLinePrefix(line, keyword);
  if (!prefix) {
    return false;
  }
  pushToken(builder, lineNumber, prefix.leadingSpaces, prefix.length, keywordTokenType);
  const valueStart = prefix.leadingSpaces + prefix.length;
  if (valueStart < line.length) {
    pushToken(builder, lineNumber, valueStart, line.length - valueStart, valueTokenType);
  }
  return true;
}

function isTableLine(line) {
  return line.trimStart().startsWith("|");
}

function isTableBlockStartLine(line) {
  return line.startsWith("|");
}

function isStepLine(line) {
  return line.startsWith("*");
}

function isTeardownIdentifierLine(line) {
  return /^_{3,}[ \t\f]*$/.test(line);
}

function isConceptLegacyUnderlineHeadingText(line) {
  return line.trim().length > 0 && !/[#*|]/.test(line);
}

function hasFollowingLine(lines, lineNumber) {
  return lineNumber + 1 < lines.length;
}

function isHashHeadingLine(line, conceptDocument) {
  return conceptDocument ? isConceptHashHeading(line) : isGaugeHashHeading(line);
}

function tableBlockStartLine(lines, lineNumber) {
  if (!isTableLine(lines[lineNumber] || "")) {
    return -1;
  }

  let startLine = lineNumber;
  while (startLine > 0 && isTableLine(lines[startLine - 1] || "")) {
    startLine -= 1;
  }
  return isTableBlockStartLine(lines[startLine] || "") ? startLine : -1;
}

function isFirstTableLine(lines, lineNumber) {
  return tableBlockStartLine(lines, lineNumber) === lineNumber;
}

function isTableBlockLine(lines, lineNumber) {
  return tableBlockStartLine(lines, lineNumber) !== -1;
}

class GaugeSemanticTokensProvider {
  constructor(options = {}) {
    this.vscode = options.vscode;
    this.projectFactory = options.projectFactory;
    this.SemanticTokensBuilder = options.SemanticTokensBuilder
      || getVscode(this.vscode).SemanticTokensBuilder;
    this.legend = options.legend || (this.vscode ? createLegend(this.vscode) : fallbackLegend());
  }

  shouldTokenize(document) {
    if (!isMarkdownDocument(document)) {
      return true;
    }
    if (
      !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return false;
    }
    try {
      this.projectFactory.getGaugeRootFromFilePath(documentPath(document));
      return true;
    } catch (_error) {
      return false;
    }
  }

  provideDocumentSemanticTokens(document) {
    const builder = new this.SemanticTokensBuilder(this.legend);
    if (!this.shouldTokenize(document)) {
      return builder.build();
    }
    const lines = document.getText().split(/\r?\n/);
    const conceptDocument = isConceptDocument(document);
    const argumentRegex = /(?:"(?:\\"|[^"\r\n])*"|<(?:\\[<>]|[^>\r\n])*>)/g;
    const dynamicArgumentRegex = /<(?:\\[<>]|[^>\r\n])*>/g;
    const tableDynamicArgumentRegex = /<(?:\\[<>|]|[^>|\r\n])*>/g;
    const tableHeaderSeparatorRegex = /^(?:\|\s*-+\s*)+\|?$/;

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
        if (
          /^[=]+$/.test(nextLine)
          && (
            !conceptDocument
            || (isConceptLegacyUnderlineHeadingText(line) && hasFollowingLine(lines, index + 1))
          )
        ) {
          const leadingSpaces = line.length - line.trimStart().length;
          builder.push(index, leadingSpaces, line.length - leadingSpaces, tokenTypes.indexOf("specification"), 0);
          builder.push(index + 1, 0, nextLine.length, tokenTypes.indexOf("specification"), 0);
          index += 2;
          continue;
        }
        if (!conceptDocument && /^[-]+$/.test(nextLine)) {
          const leadingSpaces = line.length - line.trimStart().length;
          builder.push(index, leadingSpaces, line.length - leadingSpaces, tokenTypes.indexOf("scenario"), 0);
          builder.push(index + 1, 0, nextLine.length, tokenTypes.indexOf("scenario"), 0);
          index += 2;
          continue;
        }
      }

      if (isHashHeadingLine(line, conceptDocument)) {
        let lastIndex = line.search(/\S/);
        const isScenarioHeading = !conceptDocument && isScenarioHashHeading(line);
        const headingToken = isScenarioHeading ? "scenario" : "specification";

        argumentRegex.lastIndex = 0;
        let match = argumentRegex.exec(line);
        while (match !== null) {
          const matchStart = match.index;
          if (isEscapedCharacter(line, matchStart)) {
            match = argumentRegex.exec(line);
            continue;
          }
          if (matchStart > lastIndex) {
            builder.push(index, lastIndex, matchStart - lastIndex, tokenTypes.indexOf(headingToken), 0);
          }
          pushArgumentToken(builder, index, matchStart, match[0]);
          lastIndex = argumentRegex.lastIndex;
          match = argumentRegex.exec(line);
        }
        if (lastIndex < line.length) {
          builder.push(index, lastIndex, line.length - lastIndex, tokenTypes.indexOf(headingToken), 0);
        }
        index += 1;
      } else if (!conceptDocument && pushKeywordLine(builder, index, line, "table", "tableKeyword", "tableFileValue")) {
        index += 1;
      } else if (!conceptDocument && pushKeywordLine(builder, index, line, "tags", "tagKeyword", "tagValue")) {
        index += 1;
      } else if (!conceptDocument && isTeardownIdentifierLine(line)) {
        pushToken(builder, index, 0, line.length, "teardownIdentifier");
        index += 1;
      } else if (isStepLine(line)) {
        const markerStart = line.indexOf("*");
        if (markerStart !== -1) {
          builder.push(index, markerStart, 1, tokenTypes.indexOf("stepMarker"), 0);
          let lastIndex = markerStart + 1;
          argumentRegex.lastIndex = 0;
          let match = argumentRegex.exec(line);
          while (match !== null) {
            const matchStart = match.index;
            if (isEscapedCharacter(line, matchStart)) {
              match = argumentRegex.exec(line);
              continue;
            }
            if (matchStart > lastIndex) {
              builder.push(index, lastIndex, matchStart - lastIndex, tokenTypes.indexOf("step"), 0);
            }
            pushArgumentToken(builder, index, matchStart, match[0]);
            lastIndex = argumentRegex.lastIndex;
            match = argumentRegex.exec(line);
          }
          if (lastIndex < line.length) {
            builder.push(index, lastIndex, line.length - lastIndex, tokenTypes.indexOf("step"), 0);
          }
        }
        index += 1;
      } else if (isTableBlockLine(lines, index)) {
        const tableStartLine = tableBlockStartLine(lines, index);
        if (index === tableStartLine + 1 && tableHeaderSeparatorRegex.test(trimmedLine)) {
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
        } else if (index === tableStartLine) {
          pushTableSegment(builder, index, line, 0, line.length, "tableHeader");
        } else {
          let lastIndex = 0;
          tableDynamicArgumentRegex.lastIndex = 0;
          let match = tableDynamicArgumentRegex.exec(line);
          while (match !== null) {
            if (isEscapedCharacter(line, match.index)) {
              match = tableDynamicArgumentRegex.exec(line);
              continue;
            }
            pushTableSegment(builder, index, line, lastIndex, match.index);
            pushToken(builder, index, match.index, match[0].length, "dynamicArgument");
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
