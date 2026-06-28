"use strict";

const { countStepParameters, UNDEFINED_STEP_MESSAGE } = require("./stepDiagnostics");

const CREATE_STEP_IMPLEMENTATION_TITLE = "Create step implementation";
const GENERATE_STEP_STUB = "gauge.generate.step";
const GAUGE_LANGUAGE = "gauge";

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
    return document.lineAt(line).text;
  }
  if (typeof document.getText === "function") {
    return document.getText().split(/\r?\n/)[line] || "";
  }
  return "";
}

function gaugeStepTextAt(document, lineNumber) {
  const line = documentLine(document, lineNumber);
  const marker = line.search(/\S/);
  if (marker === -1 || line[marker] !== "*") {
    return undefined;
  }
  const text = line.slice(marker + 1).trim();
  return text || undefined;
}

function kotlinStringLiteral(value) {
  return JSON.stringify(value);
}

function stepStubCode(stepText) {
  const params = Array.from(
    { length: countStepParameters(stepText) },
    (_entry, index) => `arg${index}: Any`,
  ).join(", ");
  return [
    `@com.thoughtworks.gauge.Step(${kotlinStringLiteral(stepText)})`,
    `fun implementation(${params}) {`,
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
    if (!document || document.languageId !== GAUGE_LANGUAGE || !range) {
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
      arguments: [stepStubCode(stepText)],
    };
    return [action];
  }
}

module.exports = {
  CREATE_STEP_IMPLEMENTATION_TITLE,
  GENERATE_STEP_STUB,
  GaugeStepCodeActionProvider,
  UNDEFINED_STEP_MESSAGE,
  stepStubCode,
};
