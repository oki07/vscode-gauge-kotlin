"use strict";

function getVscode(vscode) {
  return vscode || require("vscode");
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

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || document.fileName || "";
}

function isConceptDocument(document) {
  return documentPath(document).toLowerCase().endsWith(".cpt");
}

function dynamicArgumentRange(line, position) {
  let openIndex = line.indexOf("<");
  const stopAtUnescapedPipe = isTableLine(line);
  while (openIndex !== -1) {
    const closeIndex = closingAngleIndex(line, openIndex, stopAtUnescapedPipe);
    if (position.character > openIndex && (closeIndex === -1 || position.character <= closeIndex)) {
      return {
        end: closeIndex === -1 ? position.character : closeIndex,
        start: openIndex + 1,
      };
    }
    if (closeIndex === -1) {
      return undefined;
    }
    openIndex = line.indexOf("<", closeIndex + 1);
  }

  return undefined;
}

function staticArgumentRange(line, position) {
  let openIndex = line.indexOf("\"");
  while (openIndex !== -1) {
    const closeIndex = closingQuoteIndex(line, openIndex);
    if (position.character > openIndex && (closeIndex === -1 || position.character <= closeIndex)) {
      return {
        end: closeIndex === -1 ? position.character : closeIndex,
        start: openIndex + 1,
      };
    }
    if (closeIndex === -1) {
      return undefined;
    }
    openIndex = line.indexOf("\"", closeIndex + 1);
  }

  return undefined;
}

function closingQuoteIndex(line, openIndex) {
  return closingEscapedArgumentIndex(line, openIndex, "\"");
}

function closingAngleIndex(line, openIndex, stopAtUnescapedPipe = false) {
  return closingEscapedArgumentIndex(line, openIndex, ">", stopAtUnescapedPipe);
}

function closingEscapedArgumentIndex(line, openIndex, closeCharacter, stopAtUnescapedPipe = false) {
  let index = openIndex + 1;
  let escaped = false;
  while (index < line.length) {
    const character = line[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === closeCharacter) {
      return index;
    } else if (stopAtUnescapedPipe && character === "|") {
      return index;
    }
    index += 1;
  }
  return -1;
}

function isScenarioHeading(line) {
  return line.trimStart().startsWith("##");
}

function isStepLine(line) {
  return line.trimStart().startsWith("*");
}

function isConceptHeading(line) {
  return line.trimStart().startsWith("#");
}

function isTableLine(line) {
  return line.trimStart().startsWith("|");
}

function isTableHeaderSeparator(line) {
  return /^(?:\|\s*-+\s*)+\|?$/.test(line.trim());
}

function isTableHeaderLine(document, lineNumber) {
  const lines = document.getText().split(/\r?\n/);
  return isTableLine(lines[lineNumber] || "") && isTableHeaderSeparator(lines[lineNumber + 1] || "");
}

function tableCells(line) {
  const body = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "");
  const cells = [];
  let cell = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "|" && !isEscapedPipe(body, index)) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells.filter(Boolean);
}

function isEscapedPipe(line, index) {
  return index > 0 && line[index - 1] === "\\";
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function specDataTableHeaders(text) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (isScenarioHeading(line)) {
      return [];
    }
    if (isStepLine(line)) {
      return [];
    }
    if (isTableLine(line) && isTableHeaderSeparator(lines[index + 1])) {
      return unique(tableCells(line));
    }
  }
  return [];
}

function conceptDynamicArguments(text) {
  const values = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!isConceptHeading(line) && !isStepLine(line)) {
      continue;
    }
    let openIndex = line.indexOf("<");
    while (openIndex !== -1) {
      const closeIndex = closingAngleIndex(line, openIndex);
      if (closeIndex === -1) {
        break;
      }
      const value = line.slice(openIndex + 1, closeIndex).trim();
      if (value) {
        values.push(value);
      }
      openIndex = line.indexOf("<", closeIndex + 1);
    }
  }
  return unique(values);
}

function staticArguments(text) {
  const values = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trimStart().startsWith("*")) {
      continue;
    }
    let openIndex = line.indexOf("\"");
    while (openIndex !== -1) {
      const closeIndex = closingQuoteIndex(line, openIndex);
      if (closeIndex === -1) {
        break;
      }
      const value = line.slice(openIndex + 1, closeIndex);
      if (value) {
        values.push(value);
      }
      openIndex = line.indexOf("\"", closeIndex + 1);
    }
  }
  return unique(values);
}

function allowsDynamicArgumentCompletion(line, document) {
  if (isConceptDocument(document) && isConceptHeading(line)) {
    return true;
  }
  return isStepLine(line) || isTableLine(line);
}

function allowsStaticArgumentCompletion(line) {
  return isStepLine(line);
}

function completionItem(vscode, label, range) {
  const kind = vscode.CompletionItemKind && vscode.CompletionItemKind.Variable;
  const item = typeof vscode.CompletionItem === "function"
    ? new vscode.CompletionItem(label, kind)
    : { label, kind };
  item.range = range;
  return item;
}

class GaugeDynamicArgumentCompletionProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
  }

  provideCompletionItems(document, position) {
    const line = document.lineAt(position.line).text;
    const argumentRange = dynamicArgumentRange(line, position);
    const quotedArgumentRange = staticArgumentRange(line, position);
    if (!argumentRange && !quotedArgumentRange) {
      return [];
    }
    if (argumentRange && isTableHeaderLine(document, position.line)) {
      return [];
    }
    if (argumentRange && !allowsDynamicArgumentCompletion(line, document)) {
      return [];
    }
    if (quotedArgumentRange && !allowsStaticArgumentCompletion(line)) {
      return [];
    }

    const labels = argumentRange
      ? (
        isConceptDocument(document)
          ? conceptDynamicArguments(document.getText())
          : specDataTableHeaders(document.getText())
      )
      : staticArguments(document.getText());
    const targetRange = argumentRange || quotedArgumentRange;
    const range = createRange(this.vscode, position.line, targetRange.start, targetRange.end);
    return labels.map((label) => completionItem(this.vscode, label, range));
  }
}

module.exports = {
  GaugeDynamicArgumentCompletionProvider,
  conceptDynamicArguments,
  specDataTableHeaders,
  staticArguments,
};
