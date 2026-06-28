"use strict";

const { countStepParameters, UNDEFINED_STEP_MESSAGE } = require("./stepDiagnostics");

const CREATE_STEP_IMPLEMENTATION_TITLE = "Create step implementation";
const GENERATE_STEP_STUB = "gauge.generate.step";
const GAUGE_LANGUAGE = "gauge";
const SPEC_FILE_PATTERN = /\.(?:spec|md)$/i;

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createCodeAction(vscode, title) {
  const kind = vscode.CodeActionKind && vscode.CodeActionKind.QuickFix;
  return typeof vscode.CodeAction === "function"
    ? new vscode.CodeAction(title, kind)
    : { title, kind };
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

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function isGaugeSpecDocument(document) {
  if (!document) {
    return false;
  }
  if (document.languageId === GAUGE_LANGUAGE) {
    return true;
  }
  return SPEC_FILE_PATTERN.test(documentPath(document));
}

function isInlineTableLine(line) {
  return String(line || "").trimStart().startsWith("|");
}

function gaugeStepTextAt(document, lineNumber) {
  const line = documentLine(document, lineNumber);
  const marker = line.search(/\S/);
  if (marker === -1 || line[marker] !== "*") {
    return undefined;
  }
  const text = line.slice(marker + 1).trim();
  if (!text) {
    return undefined;
  }
  return isInlineTableLine(documentLine(document, lineNumber + 1))
    ? `${text} <table>`
    : text;
}

function kotlinStringLiteral(value) {
  return JSON.stringify(value);
}

function isKotlinDocument(document) {
  const file = document && document.uri && document.uri.fsPath;
  return document && (
    document.languageId === "kotlin"
    || (typeof file === "string" && file.toLowerCase().endsWith(".kt"))
  );
}

function kotlinFunctionNames(text) {
  const names = [];
  const pattern = /\bfun\s+(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_]*))\s*\(/g;
  let match = pattern.exec(text);
  while (match) {
    names.push(match[1] || match[2]);
    match = pattern.exec(text);
  }
  return names;
}

function workspaceKotlinFunctionNames(vscode) {
  const documents = vscode && vscode.workspace && Array.isArray(vscode.workspace.textDocuments)
    ? vscode.workspace.textDocuments
    : [];
  const names = [];
  for (const document of documents) {
    if (!isKotlinDocument(document) || typeof document.getText !== "function") {
      continue;
    }
    names.push(...kotlinFunctionNames(document.getText()));
  }
  return names;
}

function stepImplementationName(existingNames) {
  const names = new Set(existingNames || []);
  if (!names.has("implementation")) {
    return "implementation";
  }
  for (let index = 1; ; index += 1) {
    const candidate = `implementation${index}`;
    if (!names.has(candidate)) {
      return candidate;
    }
  }
}

function stepStubCode(stepText, methodName = "implementation") {
  const params = Array.from(
    { length: countStepParameters(stepText) },
    (_entry, index) => `arg${index}: Any`,
  ).join(", ");
  return [
    `@com.thoughtworks.gauge.Step(${kotlinStringLiteral(stepText)})`,
    `fun ${methodName}(${params}) {`,
    "}",
    "",
  ].join("\n");
}

function undefinedStepDiagnostics(context) {
  return (context && Array.isArray(context.diagnostics) ? context.diagnostics : [])
    .filter((diagnostic) => diagnostic && diagnostic.message === UNDEFINED_STEP_MESSAGE);
}

class GaugeStepCodeActionProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
  }

  provideCodeActions(document, range, context = {}) {
    if (!document || !isGaugeSpecDocument(document) || !range) {
      return [];
    }
    const diagnostics = undefinedStepDiagnostics(context);
    if (diagnostics.length === 0) {
      return [];
    }

    const stepText = gaugeStepTextAt(document, range.start.line);
    if (!stepText) {
      return [];
    }

    const action = createCodeAction(this.vscode, CREATE_STEP_IMPLEMENTATION_TITLE);
    action.diagnostics = diagnostics;
    action.isPreferred = true;
    action.command = {
      command: GENERATE_STEP_STUB,
      title: CREATE_STEP_IMPLEMENTATION_TITLE,
      arguments: [
        stepStubCode(
          stepText,
          stepImplementationName(workspaceKotlinFunctionNames(this.vscode)),
        ),
      ],
    };
    return [action];
  }
}

module.exports = {
  CREATE_STEP_IMPLEMENTATION_TITLE,
  GENERATE_STEP_STUB,
  GaugeStepCodeActionProvider,
  UNDEFINED_STEP_MESSAGE,
  kotlinFunctionNames,
  stepImplementationName,
  stepStubCode,
};
