"use strict";

const {
  GaugeStepDiagnosticsProvider,
  findStepFunctions,
  isKotlinDocument,
  positionAt,
} = require("./stepDiagnostics");
const { normalizeStepTemplate } = require("./stepDefinitionProvider");

const GAUGE_LANGUAGE = "gauge";
const GAUGE_FILE_PATTERNS = ["**/*.spec", "**/*.cpt", "**/*.md"];
const KOTLIN_FILE_PATTERN = "**/*.kt";

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

function createRangeFromOffsets(vscode, text, startOffset, endOffset) {
  return createRange(vscode, positionAt(text, startOffset), positionAt(text, endOffset));
}

function createWorkspaceEdit(vscode) {
  if (typeof vscode.WorkspaceEdit === "function") {
    return new vscode.WorkspaceEdit();
  }
  const replacements = [];
  return {
    replacements,
    replace(uri, range, newText) {
      replacements.push({ uri, range, newText });
    },
  };
}

function documentPath(document) {
  return document && document.uri && document.uri.fsPath;
}

function uriPath(uri) {
  return uri && uri.fsPath;
}

function documentLine(document, line) {
  if (typeof document.lineAt === "function") {
    try {
      return document.lineAt(line).text;
    } catch (_error) {
      return "";
    }
  }
  if (typeof document.getText === "function") {
    return document.getText().split(/\r?\n/)[line] || "";
  }
  return "";
}

function documentLines(document) {
  if (typeof document.getText !== "function") {
    return [];
  }
  return document.getText().split(/\r?\n/);
}

function isInlineTableLine(line) {
  return String(line || "").trimStart().startsWith("|");
}

function removeInlineTableSuffix(value) {
  return String(value || "").replace(/\s+<table>\s*$/, "").trim();
}

function withInlineTableSuffix(value) {
  return `${removeInlineTableSuffix(value)} <table>`;
}

function gaugeReplacementName(value, hasInlineTable) {
  return hasInlineTable ? removeInlineTableSuffix(value) : value;
}

function kotlinReplacementName(value, hasInlineTable) {
  return hasInlineTable ? withInlineTableSuffix(value) : value;
}

function offsetAt(text, position) {
  let offset = 0;
  let line = 0;
  while (line < position.line && offset < text.length) {
    const nextLine = text.indexOf("\n", offset);
    if (nextLine === -1) {
      return text.length;
    }
    offset = nextLine + 1;
    line += 1;
  }
  return Math.min(offset + position.character, text.length);
}

function gaugeStepOnLine(vscode, document, lineNumber, lines) {
  const sourceLines = lines || documentLines(document);
  const line = (sourceLines[lineNumber] !== undefined
    ? sourceLines[lineNumber]
    : documentLine(document, lineNumber)).replace(/\r$/, "");
  const marker = line.search(/\S/);
  if (marker === -1 || line[marker] !== "*") {
    return undefined;
  }

  let textStart = marker + 1;
  while (textStart < line.length && /\s/.test(line[textStart])) {
    textStart += 1;
  }
  const text = line.slice(textStart).trimEnd();
  if (!text) {
    return undefined;
  }
  const textEnd = textStart + text.length;
  const hasInlineTable = isInlineTableLine(sourceLines[lineNumber + 1]);
  return {
    hasInlineTable,
    range: createRange(
      vscode,
      { line: lineNumber, character: textStart },
      { line: lineNumber, character: textEnd },
    ),
    template: normalizeStepTemplate(hasInlineTable ? `${text} <table>` : text),
    text,
  };
}

function isGaugeDocument(document) {
  return Boolean(document && document.languageId === GAUGE_LANGUAGE && typeof document.getText === "function");
}

function readQuotedLiteral(text, start, limit) {
  if (text.startsWith("\"\"\"", start)) {
    const end = text.indexOf("\"\"\"", start + 3);
    if (end === -1 || end + 3 > limit) {
      return undefined;
    }
    return {
      contentEnd: end,
      contentStart: start + 3,
      raw: true,
      value: text.slice(start + 3, end),
    };
  }

  let value = "";
  for (let index = start + 1; index < limit; index += 1) {
    const character = text[index];
    if (character === "\\") {
      if (index + 1 >= limit) {
        return undefined;
      }
      value += text[index + 1];
      index += 1;
      continue;
    }
    if (character === "\"") {
      return {
        contentEnd: index,
        contentStart: start + 1,
        raw: false,
        value,
      };
    }
    value += character;
  }
  return undefined;
}

function literalAliasRange(text, entry, alias) {
  if (entry.annotationStart === undefined || entry.annotationEnd === undefined) {
    return undefined;
  }
  for (let index = entry.annotationStart; index < entry.annotationEnd; index += 1) {
    if (text[index] !== "\"") {
      continue;
    }
    const literal = readQuotedLiteral(text, index, entry.annotationEnd);
    if (!literal) {
      continue;
    }
    if (literal.value === alias) {
      return literal;
    }
    index = literal.raw ? literal.contentEnd + 2 : literal.contentEnd;
  }
  return undefined;
}

function escapeKotlinStringContent(value) {
  return JSON.stringify(value).slice(1, -1);
}

function replacementForLiteral(value, literal) {
  return literal.raw ? value : escapeKotlinStringContent(value);
}

class GaugeRenameProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
    this.diagnosticsProvider = new GaugeStepDiagnosticsProvider({
      projectFactory: this.projectFactory,
      vscode: this.vscode,
    });
  }

  isGaugeProjectDocument(document) {
    return this.diagnosticsProvider.isGaugeProjectDocument(document);
  }

  async workspaceDocuments(sourceDocument) {
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || typeof candidate.getText !== "function"
        || (!isGaugeDocument(candidate) && !isKotlinDocument(candidate))
        || !this.isGaugeProjectDocument(candidate)
      ) {
        return;
      }
      const file = documentPath(candidate);
      if (file) {
        if (seenPaths.has(file)) {
          return;
        }
        seenPaths.add(file);
      } else if (documents.includes(candidate)) {
        return;
      }
      documents.push(candidate);
    };

    for (const candidate of workspace.textDocuments || []) {
      addDocument(candidate);
    }

    if (
      typeof workspace.findFiles === "function"
      && typeof workspace.openTextDocument === "function"
    ) {
      for (const pattern of [...GAUGE_FILE_PATTERNS, KOTLIN_FILE_PATTERN]) {
        let uris;
        try {
          uris = await workspace.findFiles(pattern);
        } catch (_error) {
          continue;
        }
        for (const uri of uris || []) {
          const file = uriPath(uri);
          if (file && seenPaths.has(file)) {
            continue;
          }
          try {
            addDocument(await workspace.openTextDocument(uri));
          } catch (_error) {
            // Ignore unreadable files so one stale URI does not block rename.
          }
        }
      }
    }

    addDocument(sourceDocument);
    return documents;
  }

  kotlinDocuments(documents) {
    return documents.filter((document) => isKotlinDocument(document));
  }

  stepAtGaugePosition(document, position) {
    if (!isGaugeDocument(document) || !position) {
      return undefined;
    }
    return gaugeStepOnLine(this.vscode, document, position.line);
  }

  stepAtKotlinPosition(document, position, kotlinDocuments) {
    if (!isKotlinDocument(document) || !position || typeof document.getText !== "function") {
      return undefined;
    }
    const text = document.getText();
    const offset = offsetAt(text, position);
    let externalConstants;
    try {
      externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(document, kotlinDocuments);
    } catch (_error) {
      externalConstants = undefined;
    }
    for (const entry of findStepFunctions(text, externalConstants)) {
      const start = entry.annotationStart !== undefined ? entry.annotationStart : entry.parameterStart;
      const end = entry.declarationEnd !== undefined ? entry.declarationEnd : entry.parameterEnd;
      if (offset < start || offset > end || entry.aliases.length !== 1) {
        continue;
      }
      const alias = entry.aliases[0];
      const literal = literalAliasRange(text, entry, alias);
      if (!literal) {
        continue;
      }
      return {
        hasInlineTable: /\s+<table>\s*$/.test(alias),
        range: createRangeFromOffsets(this.vscode, text, literal.contentStart, literal.contentEnd),
        template: normalizeStepTemplate(alias),
        text: alias,
      };
    }
    return undefined;
  }

  async stepAt(document, position) {
    const documents = await this.workspaceDocuments(document);
    return {
      documents,
      step: this.stepAtGaugePosition(document, position)
        || this.stepAtKotlinPosition(document, position, this.kotlinDocuments(documents)),
    };
  }

  async prepareRename(document, position) {
    const { step } = await this.stepAt(document, position);
    return step ? { range: step.range, placeholder: step.text } : undefined;
  }

  addGaugeRenames(edit, document, template, newName) {
    const lines = documentLines(document);
    for (let line = 0; line < lines.length; line += 1) {
      const step = gaugeStepOnLine(this.vscode, document, line, lines);
      if (step && step.template === template) {
        edit.replace(document.uri, step.range, gaugeReplacementName(newName, step.hasInlineTable));
      }
    }
  }

  addKotlinRenames(edit, document, kotlinDocuments, template, newName, hasInlineTable) {
    const text = document.getText();
    let externalConstants;
    try {
      externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(document, kotlinDocuments);
    } catch (_error) {
      externalConstants = undefined;
    }
    for (const entry of findStepFunctions(text, externalConstants)) {
      if (entry.aliases.length !== 1 || normalizeStepTemplate(entry.aliases[0]) !== template) {
        continue;
      }
      const literal = literalAliasRange(text, entry, entry.aliases[0]);
      if (!literal) {
        continue;
      }
      edit.replace(
        document.uri,
        createRangeFromOffsets(this.vscode, text, literal.contentStart, literal.contentEnd),
        replacementForLiteral(kotlinReplacementName(newName, hasInlineTable), literal),
      );
    }
  }

  async provideRenameEdits(document, position, newName) {
    const { documents, step } = await this.stepAt(document, position);
    if (!step) {
      return undefined;
    }

    const edit = createWorkspaceEdit(this.vscode);
    const kotlinDocuments = this.kotlinDocuments(documents);
    for (const candidate of documents) {
      if (isGaugeDocument(candidate)) {
        this.addGaugeRenames(edit, candidate, step.template, newName);
      } else if (isKotlinDocument(candidate)) {
        this.addKotlinRenames(edit, candidate, kotlinDocuments, step.template, newName, step.hasInlineTable);
      }
    }
    return edit;
  }

  register() {
    if (!this.vscode.languages || typeof this.vscode.languages.registerRenameProvider !== "function") {
      return { dispose() {} };
    }
    return this.vscode.languages.registerRenameProvider(
      [
        { language: GAUGE_LANGUAGE },
        { language: "kotlin" },
      ],
      this,
    );
  }
}

module.exports = {
  GaugeRenameProvider,
};
