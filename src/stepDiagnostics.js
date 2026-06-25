"use strict";

const COLLECTION_NAME = "gauge-kotlin";
const GAUGE_LANGUAGE = "gauge";
const KOTLIN_LANGUAGE = "kotlin";
const BLANK_STEP_MESSAGE = "Step should not be blank";
const PARAMETER_MISMATCH_PREFIX = "Parameter count mismatch";
const GAUGE_STEP_ANNOTATION = "com.thoughtworks.gauge.Step";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createPosition(vscode, line, character) {
  if (typeof vscode.Position === "function") {
    return new vscode.Position(line, character);
  }
  return { line, character };
}

function createRange(vscode, start, end) {
  const startPosition = createPosition(vscode, start.line, start.character);
  const endPosition = createPosition(vscode, end.line, end.character);
  if (typeof vscode.Range === "function") {
    return new vscode.Range(startPosition, endPosition);
  }
  return { start: startPosition, end: endPosition };
}

function createDiagnostic(vscode, range, message) {
  const severity = vscode.DiagnosticSeverity && vscode.DiagnosticSeverity.Error;
  if (typeof vscode.Diagnostic === "function") {
    return new vscode.Diagnostic(range, message, severity);
  }
  return { range, message, severity };
}

function positionAt(text, offset) {
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, character: offset - lineStart };
}

function findMatchingParen(text, openIndex) {
  let depth = 0;
  let quote;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function extractStringLiterals(text) {
  const values = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith("\"\"\"", index)) {
      const end = text.indexOf("\"\"\"", index + 3);
      if (end === -1) {
        return values;
      }
      values.push(text.slice(index + 3, end));
      index = end + 2;
      continue;
    }

    if (text[index] !== "\"") {
      continue;
    }

    let value = "";
    index += 1;
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") {
        if (index + 1 < text.length) {
          value += text[index + 1];
          index += 2;
          continue;
        }
        break;
      }
      if (char === "\"") {
        break;
      }
      value += char;
      index += 1;
    }
    values.push(value);
  }
  return values;
}

function countStepParameters(stepText) {
  const matches = stepText.match(/<[^>\r\n]+>/g);
  return matches ? matches.length : 0;
}

function findBlankGaugeSteps(text) {
  const entries = [];
  let line = 0;
  let lineStart = 0;

  while (lineStart <= text.length) {
    let lineEnd = text.indexOf("\n", lineStart);
    if (lineEnd === -1) {
      lineEnd = text.length;
    }

    const rawLine = text.slice(lineStart, lineEnd).replace(/\r$/, "");
    const marker = rawLine.search(/\S/);
    if (
      marker !== -1
      && rawLine[marker] === "*"
      && rawLine.slice(marker + 1).trim() === ""
    ) {
      entries.push({
        end: { line, character: rawLine.length },
        start: { line, character: marker },
      });
    }

    if (lineEnd === text.length) {
      break;
    }
    line += 1;
    lineStart = lineEnd + 1;
  }

  return entries;
}

function splitTopLevelParameters(text) {
  const parts = [];
  let start = 0;
  let angleDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let quote;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0) {
      angleDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    } else if (
      char === ","
      && angleDepth === 0
      && bracketDepth === 0
      && braceDepth === 0
      && parenDepth === 0
    ) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

function countKotlinParameters(parameterText) {
  const trimmed = parameterText.trim();
  if (!trimmed) {
    return 0;
  }
  return splitTopLevelParameters(trimmed)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

function findNextFunction(text, startIndex) {
  const funPattern = /\bfun\b/g;
  funPattern.lastIndex = startIndex;
  let match = funPattern.exec(text);
  while (match) {
    const openParen = text.indexOf("(", funPattern.lastIndex);
    if (openParen === -1) {
      return undefined;
    }
    const header = text.slice(funPattern.lastIndex, openParen);
    if (/^\s+(?:[A-Za-z_][\w<>]*\.)?[A-Za-z_]\w*\s*$/.test(header)) {
      const closeParen = findMatchingParen(text, openParen);
      if (closeParen !== -1) {
        return {
          parameterEnd: closeParen,
          parameterStart: openParen + 1,
          parameterText: text.slice(openParen + 1, closeParen),
        };
      }
    }
    match = funPattern.exec(text);
  }
  return undefined;
}

function unqualifiedStepImport(text) {
  const importPattern = /^\s*import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/gm;
  let match = importPattern.exec(text);
  while (match) {
    const importedName = match[1];
    const alias = match[2];
    const importedParts = importedName.split(".");
    const exposedName = alias || importedParts[importedParts.length - 1];
    if (exposedName !== "Step") {
      match = importPattern.exec(text);
      continue;
    }
    return importedName;
  }
  return undefined;
}

function isStepAnnotationAllowed(annotationName, importedStep) {
  if (annotationName === GAUGE_STEP_ANNOTATION) {
    return true;
  }
  if (annotationName.includes(".")) {
    return false;
  }
  return !importedStep || importedStep === GAUGE_STEP_ANNOTATION;
}

function findStepFunctions(text) {
  const entries = [];
  const annotationPattern = /@(?:[A-Za-z_]\w*\.)*Step\b/g;
  const importedStep = unqualifiedStepImport(text);
  let annotationMatch = annotationPattern.exec(text);
  while (annotationMatch) {
    const annotationName = annotationMatch[0].slice(1);
    const openParen = text.indexOf("(", annotationPattern.lastIndex);
    if (openParen === -1) {
      break;
    }
    const closeParen = findMatchingParen(text, openParen);
    if (closeParen === -1) {
      annotationPattern.lastIndex = openParen + 1;
      annotationMatch = annotationPattern.exec(text);
      continue;
    }
    if (!isStepAnnotationAllowed(annotationName, importedStep)) {
      annotationPattern.lastIndex = closeParen + 1;
      annotationMatch = annotationPattern.exec(text);
      continue;
    }
    const aliases = extractStringLiterals(text.slice(openParen + 1, closeParen));
    const method = findNextFunction(text, closeParen + 1);
    if (aliases.length > 0 && method) {
      entries.push({ aliases, ...method });
    }
    annotationPattern.lastIndex = closeParen + 1;
    annotationMatch = annotationPattern.exec(text);
  }
  return entries;
}

function mismatchMessage(actual, expected, alias) {
  return `${PARAMETER_MISMATCH_PREFIX}(found [${actual}] expected [${expected}]) with step annotation : "${alias}". `;
}

class GaugeStepDiagnosticsProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
  }

  isGaugeProjectDocument(document) {
    if (!this.projectFactory || typeof this.projectFactory.getGaugeRootFromFilePath !== "function") {
      return true;
    }
    const file = document.uri && document.uri.fsPath;
    if (!file) {
      return true;
    }
    try {
      this.projectFactory.getGaugeRootFromFilePath(file);
      return true;
    } catch (_error) {
      return false;
    }
  }

  shouldDiagnose(document) {
    return Boolean(
      document
      && (document.languageId === KOTLIN_LANGUAGE || document.languageId === GAUGE_LANGUAGE)
      && typeof document.getText === "function"
      && this.isGaugeProjectDocument(document),
    );
  }

  provideDiagnostics(document) {
    if (!this.shouldDiagnose(document)) {
      return [];
    }

    const text = document.getText();
    const diagnostics = [];
    if (document.languageId === GAUGE_LANGUAGE) {
      for (const entry of findBlankGaugeSteps(text)) {
        diagnostics.push(createDiagnostic(
          this.vscode,
          createRange(this.vscode, entry.start, entry.end),
          BLANK_STEP_MESSAGE,
        ));
      }
      return diagnostics;
    }

    for (const entry of findStepFunctions(text)) {
      const actual = countKotlinParameters(entry.parameterText);
      const start = positionAt(text, entry.parameterStart);
      const end = positionAt(text, entry.parameterEnd);
      const range = createRange(this.vscode, start, end);
      for (const alias of entry.aliases) {
        const expected = countStepParameters(alias);
        if (actual !== expected) {
          diagnostics.push(createDiagnostic(
            this.vscode,
            range,
            mismatchMessage(actual, expected, alias),
          ));
        }
      }
    }
    return diagnostics;
  }

  updateDocument(collection, document) {
    if (!document || !document.uri) {
      return;
    }
    if (!this.shouldDiagnose(document)) {
      if (typeof collection.delete === "function") {
        collection.delete(document.uri);
      }
      return;
    }
    collection.set(document.uri, this.provideDiagnostics(document));
  }

  register() {
    if (!this.vscode.languages || typeof this.vscode.languages.createDiagnosticCollection !== "function") {
      return { dispose() {} };
    }

    const collection = this.vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
    const workspace = this.vscode.workspace || {};
    const disposables = [collection];
    const registerListener = (name, listener) => {
      if (typeof workspace[name] === "function") {
        const disposable = workspace[name](listener);
        if (disposable) {
          disposables.push(disposable);
        }
      }
    };

    for (const document of workspace.textDocuments || []) {
      this.updateDocument(collection, document);
    }
    registerListener("onDidOpenTextDocument", (document) => this.updateDocument(collection, document));
    registerListener("onDidChangeTextDocument", (event) => this.updateDocument(collection, event.document));
    registerListener("onDidCloseTextDocument", (document) => {
      if (document && document.uri && typeof collection.delete === "function") {
        collection.delete(document.uri);
      }
    });

    return {
      dispose() {
        for (const disposable of disposables) {
          if (disposable && typeof disposable.dispose === "function") {
            disposable.dispose();
          }
        }
      },
    };
  }
}

module.exports = {
  COLLECTION_NAME,
  GaugeStepDiagnosticsProvider,
  countKotlinParameters,
  countStepParameters,
};
