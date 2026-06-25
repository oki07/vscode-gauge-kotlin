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
  const openIndex = line.lastIndexOf("<", Math.max(position.character - 1, 0));
  if (openIndex === -1 || position.character <= openIndex) {
    return undefined;
  }

  const previousCloseIndex = line.lastIndexOf(">", position.character - 1);
  if (previousCloseIndex > openIndex) {
    return undefined;
  }

  const closeIndex = line.indexOf(">", openIndex + 1);
  if (closeIndex !== -1 && position.character > closeIndex) {
    return undefined;
  }

  return {
    end: closeIndex === -1 ? position.character : closeIndex,
    start: openIndex + 1,
  };
}

function isScenarioHeading(line) {
  return line.trimStart().startsWith("##");
}

function isTableLine(line) {
  return line.trimStart().startsWith("|");
}

function isTableHeaderSeparator(line) {
  return /^(?:\|\s*-+\s*)+\|?$/.test(line.trim());
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
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
    if (isTableLine(line) && isTableHeaderSeparator(lines[index + 1])) {
      return unique(tableCells(line));
    }
  }
  return [];
}

function conceptDynamicArguments(text) {
  const values = [];
  const pattern = /<([^>\r\n]+)>/g;
  let match = pattern.exec(text);
  while (match) {
    const value = match[1].trim();
    if (value) {
      values.push(value);
    }
    match = pattern.exec(text);
  }
  return unique(values);
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
    if (!argumentRange) {
      return [];
    }

    const labels = isConceptDocument(document)
      ? conceptDynamicArguments(document.getText())
      : specDataTableHeaders(document.getText());
    const range = createRange(this.vscode, position.line, argumentRange.start, argumentRange.end);
    return labels.map((label) => completionItem(this.vscode, label, range));
  }
}

module.exports = {
  GaugeDynamicArgumentCompletionProvider,
  conceptDynamicArguments,
  specDataTableHeaders,
};
