"use strict";

const {
  findConceptHeadings,
  GaugeStepDiagnosticsProvider,
  findStepFunctionsForDocument,
  isConceptDocument,
  isJavaDocument,
  isKotlinDocument,
  isStepImplementationDocument,
  positionAt,
} = require("./stepDiagnostics");
const { normalizeStepTemplate } = require("./stepDefinitionProvider");
const { GaugeValidateDiagnosticsProvider } = require("./validateDiagnostics");

const GAUGE_LANGUAGE = "gauge";
const MARKDOWN_LANGUAGE = "markdown";
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const GAUGE_FILE_PATTERNS = ["**/*.spec", "**/*.cpt", "**/*.md"];
const JAVA_FILE_PATTERN = "**/*.java";
const KOTLIN_FILE_PATTERN = "**/*.kt";
const ALIASED_STEP_RENAME_ERROR = "Refactoring for steps having aliases are not supported.";
const LSP_RENAME_REQUEST = "textDocument/rename";

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

function createToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
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

function documentUriString(vscode, document) {
  if (!document || !document.uri) {
    return undefined;
  }
  if (typeof document.uri.toString === "function") {
    const value = document.uri.toString();
    if (value && value !== "[object Object]") {
      return value;
    }
  }
  const filename = documentPath(document);
  if (!filename) {
    return undefined;
  }
  if (vscode.Uri && typeof vscode.Uri.file === "function") {
    return vscode.Uri.file(filename).toString();
  }
  return `file://${filename}`;
}

function uriFromString(vscode, value) {
  if (vscode.Uri && typeof vscode.Uri.parse === "function") {
    return vscode.Uri.parse(value);
  }
  return {
    fsPath: value && value.startsWith("file://") ? value.slice("file://".length) : value,
    toString() {
      return value;
    },
  };
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
  if (marker !== 0 || line[marker] !== "*") {
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
    engineRename: true,
    range: createRange(
      vscode,
      { line: lineNumber, character: textStart },
      { line: lineNumber, character: textEnd },
    ),
    template: normalizeStepTemplate(hasInlineTable ? `${text} <table>` : text),
    text,
  };
}

function conceptHeadingOnLine(vscode, document, lineNumber) {
  if (!isConceptDocument(document)) {
    return undefined;
  }
  for (const heading of findConceptHeadings(document.getText())) {
    if (heading.start.line !== lineNumber) {
      continue;
    }
    return {
      hasInlineTable: false,
      engineRename: false,
      range: createRange(vscode, heading.start, heading.end),
      template: heading.normalized,
      text: heading.text,
    };
  }
  return undefined;
}

function isGaugeDocument(document) {
  if (!document || typeof document.getText !== "function") {
    return false;
  }
  if (document.languageId === GAUGE_LANGUAGE) {
    return true;
  }
  return document.languageId === MARKDOWN_LANGUAGE
    && MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document));
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

function normalizeKotlinReferenceText(value) {
  return String(value || "")
    .trim()
    .replace(/\s*\.\s*/g, ".")
    .replace(/`([^`\r\n]+)`/g, "$1");
}

function annotationConstantReferenceRanges(text, entry) {
  if (entry.annotationStart === undefined || entry.annotationEnd === undefined) {
    return [];
  }
  const references = [];
  const seen = new Set();
  const annotationText = text.slice(entry.annotationStart, entry.annotationEnd);
  const pattern = /`[^`\r\n]+`|[A-Za-z_][A-Za-z0-9_]*(?:\s*\.\s*(?:`[^`\r\n]+`|[A-Za-z_][A-Za-z0-9_]*))*/g;
  let match = pattern.exec(annotationText);
  while (match) {
    const reference = normalizeKotlinReferenceText(match[0]);
    if (reference !== "Step" && !seen.has(reference)) {
      references.push({
        end: entry.annotationStart + match.index + match[0].length,
        reference,
        start: entry.annotationStart + match.index,
      });
      seen.add(reference);
    }
    match = pattern.exec(annotationText);
  }
  return references;
}

function annotationConstantReferences(text, entry) {
  return annotationConstantReferenceRanges(text, entry).map((match) => match.reference);
}

function collectJavaPackageName(text) {
  const match = /^\s*package\s+([^;]+);/m.exec(text);
  if (!match) {
    return undefined;
  }
  const packageName = normalizeKotlinReferenceText(match[1]);
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(packageName)
    ? packageName
    : undefined;
}

function collectJavaReferenceImports(text) {
  const imports = {
    classImports: new Map(),
    staticImports: new Map(),
    staticWildcards: [],
  };
  const pattern = /^\s*import\s+(static\s+)?([^;]+);/gm;
  let match = pattern.exec(text);
  while (match) {
    const imported = normalizeKotlinReferenceText(match[2]);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\.\*)*$/.test(imported)) {
      match = pattern.exec(text);
      continue;
    }
    if (match[1]) {
      if (imported.endsWith(".*")) {
        imports.staticWildcards.push(imported.slice(0, -2));
      } else {
        const parts = imported.split(".");
        imports.staticImports.set(parts[parts.length - 1], imported);
      }
    } else if (!imported.endsWith(".*")) {
      const parts = imported.split(".");
      imports.classImports.set(parts[parts.length - 1], imported);
    }
    match = pattern.exec(text);
  }
  return imports;
}

function javaConstantReferenceTargets(sourceText, reference) {
  const normalized = normalizeKotlinReferenceText(reference);
  const parts = normalized.split(".");
  const imports = collectJavaReferenceImports(sourceText);
  if (parts.length === 1) {
    const staticImport = imports.staticImports.get(normalized);
    if (staticImport) {
      return [staticImport];
    }
    if (imports.staticWildcards.length === 1) {
      return [`${imports.staticWildcards[0]}.${normalized}`];
    }
    return [normalized];
  }
  const classImport = imports.classImports.get(parts[0]);
  if (classImport) {
    return [`${classImport}.${parts.slice(1).join(".")}`];
  }
  return [normalized];
}

function constantReferenceTargets(sourceText, reference) {
  return javaConstantReferenceTargets(sourceText, reference);
}

function findConstInitializerLiteral(text, declarationStart) {
  const equalsIndex = text.indexOf("=", declarationStart);
  if (equalsIndex === -1) {
    return undefined;
  }
  for (let index = equalsIndex + 1; index < text.length; index += 1) {
    if (text[index] === "\n" || text[index] === "\r" || text[index] === ";") {
      return undefined;
    }
    if (text[index] !== "\"") {
      continue;
    }
    return readQuotedLiteral(text, index, text.length);
  }
  return undefined;
}

function collectKotlinNamedScopes(text) {
  const scopes = [];
  const pattern = /\b(object|class|interface)\s+(`[^`\r\n]+`|[A-Za-z_][A-Za-z0-9_]*)/g;
  let match = pattern.exec(text);
  while (match) {
    const open = text.indexOf("{", pattern.lastIndex);
    if (open === -1) {
      match = pattern.exec(text);
      continue;
    }
    let depth = 0;
    let end = -1;
    for (let index = open; index < text.length; index += 1) {
      if (text[index] === "{") {
        depth += 1;
      } else if (text[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end !== -1) {
      scopes.push({
        end,
        name: normalizeKotlinReferenceText(match[2]),
        start: open + 1,
      });
      pattern.lastIndex = open + 1;
    }
    match = pattern.exec(text);
  }
  return scopes;
}

function enclosingKotlinScopePath(scopes, offset) {
  return scopes
    .filter((scope) => offset >= scope.start && offset < scope.end)
    .sort((left, right) => left.start - right.start)
    .map((scope) => scope.name);
}

function referenceMatchesConstScope(reference, scopePath, constName) {
  const parts = normalizeKotlinReferenceText(reference).split(".");
  if (parts[parts.length - 1] !== constName) {
    return false;
  }
  const containerParts = parts.slice(0, -1);
  if (containerParts.length === 0) {
    return true;
  }
  const scopedName = [...scopePath, constName].join(".");
  return scopedName === parts.slice(-scopePath.length - 1).join(".");
}

function findKotlinConstLiteralRange(vscode, document, reference, alias) {
  if (!isKotlinDocument(document) || typeof document.getText !== "function") {
    return undefined;
  }
  const text = document.getText();
  const parts = normalizeKotlinReferenceText(reference).split(".");
  const constName = parts[parts.length - 1];
  if (!constName) {
    return undefined;
  }
  const scopes = collectKotlinNamedScopes(text);
  const escapedName = constName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\bconst\\b[\\s\\S]{0,160}\\bval\\s+\`?${escapedName}\`?\\b`, "g");
  let match = pattern.exec(text);
  while (match) {
    const literal = findConstInitializerLiteral(text, pattern.lastIndex);
    if (!literal || literal.value !== alias) {
      match = pattern.exec(text);
      continue;
    }
    const scopePath = enclosingKotlinScopePath(scopes, match.index);
    if (referenceMatchesConstScope(reference, scopePath, constName)) {
      return {
        literal,
        range: createRangeFromOffsets(vscode, text, literal.contentStart, literal.contentEnd),
      };
    }
    match = pattern.exec(text);
  }
  return undefined;
}

function collectJavaNamedScopes(text) {
  const scopes = [];
  const pattern = /\b(class|interface|enum|record)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let match = pattern.exec(text);
  while (match) {
    const open = text.indexOf("{", pattern.lastIndex);
    if (open === -1) {
      match = pattern.exec(text);
      continue;
    }
    let depth = 0;
    let end = -1;
    for (let index = open; index < text.length; index += 1) {
      if (text[index] === "{") {
        depth += 1;
      } else if (text[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end !== -1) {
      scopes.push({
        end,
        name: match[2],
        start: open + 1,
      });
      pattern.lastIndex = open + 1;
    }
    match = pattern.exec(text);
  }
  return scopes;
}

function enclosingJavaScopePath(scopes, offset) {
  return scopes
    .filter((scope) => offset >= scope.start && offset < scope.end)
    .sort((left, right) => left.start - right.start)
    .map((scope) => scope.name);
}

function referenceMatchesJavaConstScope(reference, packageName, scopePath, constName) {
  const parts = normalizeKotlinReferenceText(reference).split(".");
  if (parts[parts.length - 1] !== constName) {
    return false;
  }
  const containerParts = parts.slice(0, -1);
  if (containerParts.length === 0) {
    return true;
  }
  const scopeMatches = scopePath.length > 0
    && containerParts.slice(-scopePath.length).join(".") === scopePath.join(".");
  if (!scopeMatches) {
    return false;
  }
  if (containerParts.length === scopePath.length) {
    return true;
  }
  if (!packageName) {
    return false;
  }
  return containerParts.join(".") === `${packageName}.${scopePath.join(".")}`;
}

function findJavaConstLiteralRange(vscode, document, reference, alias) {
  if (!isJavaDocument(document) || typeof document.getText !== "function") {
    return undefined;
  }
  const text = document.getText();
  const parts = normalizeKotlinReferenceText(reference).split(".");
  const constName = parts[parts.length - 1];
  if (!constName) {
    return undefined;
  }
  const scopes = collectJavaNamedScopes(text);
  const packageName = collectJavaPackageName(text);
  const escapedName = constName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\b((?:(?:public|protected|private|static|final|transient|volatile)\\s+)*)String\\s+${escapedName}\\b`,
    "g",
  );
  let match = pattern.exec(text);
  while (match) {
    const literal = findConstInitializerLiteral(text, pattern.lastIndex);
    if (!literal || literal.value !== alias) {
      match = pattern.exec(text);
      continue;
    }
    const scopePath = enclosingJavaScopePath(scopes, match.index);
    if (referenceMatchesJavaConstScope(reference, packageName, scopePath, constName)) {
      return {
        literal,
        range: createRangeFromOffsets(vscode, text, literal.contentStart, literal.contentEnd),
      };
    }
    match = pattern.exec(text);
  }
  return undefined;
}

function findConstLiteralRange(vscode, document, reference, alias) {
  return findKotlinConstLiteralRange(vscode, document, reference, alias)
    || findJavaConstLiteralRange(vscode, document, reference, alias);
}

function escapeStringContent(value) {
  return JSON.stringify(value).slice(1, -1);
}

function escapeKotlinStringContent(value) {
  return escapeStringContent(value).replace(/\$/g, () => "\\$");
}

function escapeKotlinRawStringContent(value) {
  return String(value).replace(/\$/g, () => "${'$'}");
}

function replacementForLiteral(value, literal, options = {}) {
  if (literal.raw) {
    return options.kotlin ? escapeKotlinRawStringContent(value) : value;
  }
  return options.kotlin ? escapeKotlinStringContent(value) : escapeStringContent(value);
}

function stepEntryHasTemplate(entry, template) {
  return (entry.aliases || []).some((alias) => normalizeStepTemplate(alias) === template);
}

function uriKey(uri) {
  if (!uri) {
    return undefined;
  }
  if (uri.fsPath) {
    return uri.fsPath;
  }
  if (typeof uri.toString === "function") {
    return uri.toString();
  }
  return undefined;
}

function sameUri(left, right) {
  const leftKey = uriKey(left);
  const rightKey = uriKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function sameRange(left, right) {
  if (!left || !right || !left.start || !left.end || !right.start || !right.end) {
    return false;
  }
  return left.start.line === right.start.line
    && left.start.character === right.start.character
    && left.end.line === right.end.line
    && left.end.character === right.end.character;
}

function editHasReplacement(edit, uri, range) {
  if (!edit || !uri || !range) {
    return false;
  }
  for (const replacement of edit.replacements || []) {
    if (sameUri(replacement.uri, uri) && sameRange(replacement.range, range)) {
      return true;
    }
  }
  if (typeof edit.entries === "function") {
    for (const [entryUri, textEdits] of edit.entries()) {
      if (!sameUri(entryUri, uri)) {
        continue;
      }
      for (const textEdit of textEdits || []) {
        if (sameRange(textEdit.range, range)) {
          return true;
        }
      }
    }
  }
  return false;
}

class GaugeRenameProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.clientsMap = options.clientsMap;
    this.projectFactory = options.projectFactory;
    this.diagnosticsProvider = new GaugeStepDiagnosticsProvider({
      projectFactory: this.projectFactory,
      vscode: this.vscode,
    });
    this.validateDiagnosticsProvider = options.validateDiagnosticsProvider
      || new GaugeValidateDiagnosticsProvider({
        cli: options.cli,
        env: options.env,
        pathModule: options.pathModule,
        projectFactory: this.projectFactory,
        vscode: this.vscode,
      });
  }

  isGaugeProjectDocument(document) {
    return this.diagnosticsProvider.isGaugeProjectDocument(document);
  }

  shouldOpenWorkspaceFile(file) {
    if (
      !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return true;
    }
    return this.diagnosticsProvider.rootForFile(file) !== undefined;
  }

  async workspaceDocuments(sourceDocument) {
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    const addDocument = (candidate) => {
      if (
        !candidate
        || typeof candidate.getText !== "function"
        || (!isGaugeDocument(candidate) && !isStepImplementationDocument(candidate))
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
      for (const pattern of [...GAUGE_FILE_PATTERNS, KOTLIN_FILE_PATTERN, JAVA_FILE_PATTERN]) {
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
          if (file && !this.shouldOpenWorkspaceFile(file)) {
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

  stepImplementationDocuments(documents) {
    return documents.filter((document) => isStepImplementationDocument(document));
  }

  stepAtGaugePosition(document, position) {
    if (!isGaugeDocument(document) || !position) {
      return undefined;
    }
    return gaugeStepOnLine(this.vscode, document, position.line)
      || conceptHeadingOnLine(this.vscode, document, position.line);
  }

  stepAtImplementationPosition(document, position, implementationDocuments) {
    if (!isStepImplementationDocument(document) || !position || typeof document.getText !== "function") {
      return undefined;
    }
    const text = document.getText();
    const offset = offsetAt(text, position);
    let externalConstants;
    if (isStepImplementationDocument(document)) {
      try {
        externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(document, implementationDocuments);
      } catch (_error) {
        externalConstants = undefined;
      }
    }
    for (const entry of findStepFunctionsForDocument(document, externalConstants)) {
      const start = entry.annotationStart !== undefined ? entry.annotationStart : entry.parameterStart;
      const end = entry.declarationEnd !== undefined ? entry.declarationEnd : entry.parameterEnd;
      if (offset < start || offset > end) {
        continue;
      }
      if (entry.aliases.length > 1) {
        throw new Error(ALIASED_STEP_RENAME_ERROR);
      }
      if (entry.aliases.length !== 1) {
        continue;
      }
      const alias = entry.aliases[0];
      const literal = literalAliasRange(text, entry, alias);
      if (literal) {
        return {
          hasInlineTable: /\s+<table>\s*$/.test(alias),
          engineRename: false,
          range: createRangeFromOffsets(this.vscode, text, literal.contentStart, literal.contentEnd),
          template: normalizeStepTemplate(alias),
          text: alias,
        };
      }
      if (isStepImplementationDocument(document)) {
        for (const reference of annotationConstantReferenceRanges(text, entry)) {
          const targetReferences = constantReferenceTargets(text, reference.reference);
          if (implementationDocuments.some((candidate) => targetReferences.some((targetReference) => (
            findConstLiteralRange(this.vscode, candidate, targetReference, alias)
          )))) {
            return {
              hasInlineTable: /\s+<table>\s*$/.test(alias),
              engineRename: false,
              range: createRangeFromOffsets(this.vscode, text, reference.start, reference.end),
              template: normalizeStepTemplate(alias),
              text: alias,
            };
          }
        }
      }
    }
    return undefined;
  }

  async stepAt(document, position) {
    const documents = await this.workspaceDocuments(document);
    const implementationDocuments = this.stepImplementationDocuments(documents);
    return {
      documents,
      step: this.stepAtGaugePosition(document, position)
        || this.stepAtImplementationPosition(document, position, implementationDocuments),
    };
  }

  async prepareRename(document, position) {
    const { documents, step } = await this.stepAt(document, position);
    this.validateRenameTarget(documents, step);
    return step ? { range: step.range, placeholder: step.text } : undefined;
  }

  validateRenameTarget(documents, step) {
    if (!step) {
      return;
    }
    const implementationDocuments = this.stepImplementationDocuments(documents);
    for (const document of this.stepImplementationDocuments(documents)) {
      let externalConstants;
      if (isStepImplementationDocument(document)) {
        try {
          externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(document, implementationDocuments);
        } catch (_error) {
          externalConstants = undefined;
        }
      }
      for (const entry of findStepFunctionsForDocument(document, externalConstants)) {
        if (entry.aliases.length > 1 && stepEntryHasTemplate(entry, step.template)) {
          throw new Error(ALIASED_STEP_RENAME_ERROR);
        }
      }
    }
  }

  projectClientFor(document) {
    const filename = documentPath(document);
    if (!filename || !this.clientsMap || typeof this.clientsMap.get !== "function") {
      return undefined;
    }
    return this.clientsMap.get(filename);
  }

  lspWorkspaceEditToVscodeEdit(lspEdit) {
    if (!lspEdit || typeof lspEdit !== "object") {
      return undefined;
    }

    const edit = createWorkspaceEdit(this.vscode);
    const addTextEdit = (uri, textEdit) => {
      if (!uri || !textEdit || !textEdit.range) {
        return;
      }
      edit.replace(
        uriFromString(this.vscode, uri),
        createRange(this.vscode, textEdit.range.start, textEdit.range.end),
        textEdit.newText || "",
      );
    };

    for (const [uri, edits] of Object.entries(lspEdit.changes || {})) {
      for (const textEdit of edits || []) {
        addTextEdit(uri, textEdit);
      }
    }

    for (const change of lspEdit.documentChanges || []) {
      const uri = change && change.textDocument && change.textDocument.uri;
      for (const textEdit of (change && change.edits) || []) {
        addTextEdit(uri, textEdit);
      }
    }

    return edit;
  }

  async provideLanguageServerRenameEdits(document, position, newName) {
    const projectClient = this.projectClientFor(document);
    const client = projectClient && projectClient.client;
    const uri = documentUriString(this.vscode, document);
    if (!client || typeof client.sendRequest !== "function" || !uri) {
      return undefined;
    }

    const params = {
      textDocument: { uri },
      position: {
        line: position.line,
        character: position.character,
      },
      newName,
    };
    const lspEdit = await client.sendRequest(LSP_RENAME_REQUEST, params, createToken(this.vscode));
    return this.lspWorkspaceEditToVscodeEdit(lspEdit);
  }

  async preflightRename(document) {
    if (this.vscode.workspace && typeof this.vscode.workspace.saveAll === "function") {
      await this.vscode.workspace.saveAll();
    }
    if (
      !this.validateDiagnosticsProvider
      || typeof this.validateDiagnosticsProvider.validateErrorsForDocument !== "function"
    ) {
      return;
    }
    const { errors } = this.validateDiagnosticsProvider.validateErrorsForDocument(document, new Map());
    if (Array.isArray(errors) && errors.length > 0) {
      throw new Error("Please fix all errors before refactoring.");
    }
  }

  addGaugeRenames(edit, document, template, newName) {
    const lines = documentLines(document);
    for (let line = 0; line < lines.length; line += 1) {
      const step = gaugeStepOnLine(this.vscode, document, line, lines);
      if (step && step.template === template) {
        edit.replace(document.uri, step.range, gaugeReplacementName(newName, step.hasInlineTable));
      }
    }
    if (isConceptDocument(document)) {
      for (const heading of findConceptHeadings(document.getText())) {
        if (heading.normalized === template) {
          edit.replace(
            document.uri,
            createRange(this.vscode, heading.start, heading.end),
            gaugeReplacementName(newName, false),
          );
        }
      }
    }
  }

  addConstantBackedStepRenames(edit, implementationDocuments, sourceText, entry, alias, newName, hasInlineTable) {
    for (const reference of annotationConstantReferences(sourceText, entry)) {
      const targetReferences = constantReferenceTargets(sourceText, reference);
      for (const document of implementationDocuments) {
        for (const targetReference of targetReferences) {
          const constantRange = findConstLiteralRange(this.vscode, document, targetReference, alias);
          if (!constantRange || editHasReplacement(edit, document.uri, constantRange.range)) {
            continue;
          }
          edit.replace(
            document.uri,
            constantRange.range,
            replacementForLiteral(kotlinReplacementName(newName, hasInlineTable), constantRange.literal, {
              kotlin: isKotlinDocument(document),
            }),
          );
        }
      }
    }
  }

  addStepImplementationRenames(edit, document, implementationDocuments, template, newName, hasInlineTable) {
    const text = document.getText();
    let externalConstants;
    const kotlinDocument = isKotlinDocument(document);
    if (isStepImplementationDocument(document)) {
      try {
        externalConstants = this.diagnosticsProvider.collectWorkspaceConstants(document, implementationDocuments);
      } catch (_error) {
        externalConstants = undefined;
      }
    }
    for (const entry of findStepFunctionsForDocument(document, externalConstants)) {
      if (entry.aliases.length !== 1 || normalizeStepTemplate(entry.aliases[0]) !== template) {
        continue;
      }
      const literal = literalAliasRange(text, entry, entry.aliases[0]);
      if (!literal) {
        if (isStepImplementationDocument(document)) {
          this.addConstantBackedStepRenames(
            edit,
            implementationDocuments,
            text,
            entry,
            entry.aliases[0],
            newName,
            hasInlineTable,
          );
        }
        continue;
      }
      const range = createRangeFromOffsets(this.vscode, text, literal.contentStart, literal.contentEnd);
      if (editHasReplacement(edit, document.uri, range)) {
        continue;
      }
      edit.replace(
        document.uri,
        range,
        replacementForLiteral(kotlinReplacementName(newName, hasInlineTable), literal, {
          kotlin: kotlinDocument,
        }),
      );
    }
  }

  async provideRenameEdits(document, position, newName) {
    const { documents, step } = await this.stepAt(document, position);
    if (!step) {
      return undefined;
    }
    this.validateRenameTarget(documents, step);
    await this.preflightRename(document);
    if (step.engineRename) {
      const languageServerEdit = await this.provideLanguageServerRenameEdits(document, position, newName);
      if (languageServerEdit) {
        const implementationDocuments = this.stepImplementationDocuments(documents);
        for (const candidate of this.stepImplementationDocuments(documents)) {
          this.addStepImplementationRenames(
            languageServerEdit,
            candidate,
            implementationDocuments,
            step.template,
            newName,
            step.hasInlineTable,
          );
        }
        return languageServerEdit;
      }
    }

    const edit = createWorkspaceEdit(this.vscode);
    const implementationDocuments = this.stepImplementationDocuments(documents);
    for (const candidate of documents) {
      if (isGaugeDocument(candidate)) {
        this.addGaugeRenames(edit, candidate, step.template, newName);
      } else if (isStepImplementationDocument(candidate)) {
        this.addStepImplementationRenames(
          edit,
          candidate,
          implementationDocuments,
          step.template,
          newName,
          step.hasInlineTable,
        );
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
        { language: MARKDOWN_LANGUAGE, scheme: "file", pattern: "**/*.md" },
        { language: "kotlin" },
        { scheme: "file", pattern: "**/*.kt" },
        { language: "java" },
        { scheme: "file", pattern: "**/*.java" },
      ],
      this,
    );
  }
}

module.exports = {
  GaugeRenameProvider,
};
