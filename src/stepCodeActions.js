"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const { countStepParameters, UNDEFINED_STEP_MESSAGE } = require("./stepDiagnostics");
const { allowMultilineStep } = require("./stepDefinitionProvider");

const CREATE_CONCEPT_TITLE = "Create concept";
const CREATE_STEP_IMPLEMENTATION_TITLE = "Create step implementation";
const GENERATE_CONCEPT_STUB = "gauge.generate.concept";
const GENERATE_STEP_STUB = "gauge.generate.step";
const GAUGE_LANGUAGE = "gauge";
const GAUGE_FILE_PATTERN = /\.(?:spec|md|cpt)$/i;
const JAVA_LANGUAGE = "java";
const VALIDATE_MISSING_IMPLEMENTATION_MESSAGE = "Step implementation not found";

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
  if (line < 0) {
    return "";
  }
  if (typeof document.lineCount === "number" && line >= document.lineCount) {
    return "";
  }
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

function documentLineCount(document) {
  if (typeof document.lineCount === "number") {
    return document.lineCount;
  }
  if (typeof document.getText === "function") {
    return document.getText().split(/\r?\n/).length;
  }
  return 0;
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
  return GAUGE_FILE_PATTERN.test(documentPath(document));
}

function isGaugeProjectDocument(document, projectFactory) {
  if (!projectFactory || typeof projectFactory.getGaugeRootFromFilePath !== "function") {
    return true;
  }
  const file = documentPath(document);
  if (!file) {
    return true;
  }
  try {
    const root = projectFactory.getGaugeRootFromFilePath(file);
    if (!root) {
      return false;
    }
    if (typeof projectFactory.isGaugeProject === "function") {
      return projectFactory.isGaugeProject(root) !== false;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function projectLanguage(document, projectFactory) {
  if (!projectFactory) {
    return undefined;
  }
  const file = documentPath(document);
  if (!file) {
    return undefined;
  }
  try {
    if (typeof projectFactory.getProjectByFilepath === "function") {
      const project = projectFactory.getProjectByFilepath(file);
      if (project && typeof project.language === "function") {
        const language = project.language();
        return typeof language === "string" ? language.toLowerCase() : undefined;
      }
    }
    if (
      typeof projectFactory.getGaugeRootFromFilePath === "function"
      && typeof projectFactory.get === "function"
    ) {
      const root = projectFactory.getGaugeRootFromFilePath(file);
      const project = projectFactory.get(root);
      if (project && typeof project.language === "function") {
        const language = project.language();
        return typeof language === "string" ? language.toLowerCase() : undefined;
      }
    }
  } catch (_error) {
    return undefined;
  }
  return undefined;
}

function isInlineTableLine(line) {
  const text = String(line || "").trim();
  return text.startsWith("|");
}

function isDocStringFenceLine(line) {
  return String(line || "").trim() === "\"\"\"";
}

function isGaugeSyntaxBoundary(line) {
  const text = String(line || "").trim();
  return !text
    || text.startsWith("*")
    || text.startsWith("#")
    || text.toLowerCase().startsWith("tags:")
    || text.toLowerCase().startsWith("tags :")
    || text.toLowerCase().startsWith("table:")
    || text.toLowerCase().startsWith("table :")
    || isInlineTableLine(text)
    || isDocStringFenceLine(text)
    || /^={3,}\s*$/.test(text)
    || /^-{3,}\s*$/.test(text);
}

function isStepLine(line) {
  const marker = String(line || "").search(/\S/);
  return marker !== -1 && line[marker] === "*";
}

function stepMarkerIndex(line) {
  const marker = String(line || "").search(/\S/);
  return marker !== -1 && line[marker] === "*" ? marker : -1;
}

function multilineStepLineAt(document, lineNumber) {
  for (let currentLine = lineNumber; currentLine >= 0; currentLine -= 1) {
    const line = documentLine(document, currentLine);
    if (isStepLine(line)) {
      return currentLine;
    }
    if (isGaugeSyntaxBoundary(line)) {
      return undefined;
    }
  }
  return undefined;
}

function isEscapedAt(text, index) {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function findParameterStart(text, token, startIndex) {
  let openIndex = text.indexOf(token, startIndex);
  while (openIndex !== -1 && isEscapedAt(text, openIndex)) {
    openIndex = text.indexOf(token, openIndex + 1);
  }
  return openIndex;
}

function nextStepParameter(text, startIndex) {
  const dynamicStart = findParameterStart(text, "<", startIndex);
  const staticStart = findParameterStart(text, "\"", startIndex);
  if (dynamicStart === -1 && staticStart === -1) {
    return undefined;
  }
  if (staticStart === -1 || (dynamicStart !== -1 && dynamicStart < staticStart)) {
    return { openIndex: dynamicStart, closeToken: ">" };
  }
  return { openIndex: staticStart, closeToken: "\"" };
}

function parameterEnd(text, parameter) {
  let closeIndex = text.indexOf(parameter.closeToken, parameter.openIndex + 1);
  while (closeIndex !== -1 && isEscapedAt(text, closeIndex)) {
    closeIndex = text.indexOf(parameter.closeToken, closeIndex + 1);
  }
  return closeIndex;
}

function conceptStepText(stepText) {
  let result = "";
  let index = 0;
  let parameterIndex = 0;

  while (index < stepText.length) {
    const parameter = nextStepParameter(stepText, index);
    if (!parameter) {
      result += stepText.slice(index);
      break;
    }
    const closeIndex = parameterEnd(stepText, parameter);
    if (closeIndex === -1) {
      result += stepText.slice(index);
      break;
    }

    result += `${stepText.slice(index, parameter.openIndex)}<arg${parameterIndex}>`;
    parameterIndex += 1;
    index = closeIndex + 1;
  }
  return result.replace(/\*/g, "").trim();
}

function conceptInfo(stepText) {
  return {
    conceptName: `# ${conceptStepText(stepText)}\n* `,
    conceptFile: "",
    dir: "",
  };
}

function gaugeStepAt(document, lineNumber, options = {}) {
  let stepLineNumber = lineNumber;
  let line = documentLine(document, stepLineNumber);
  if (!isStepLine(line)) {
    stepLineNumber = options.allowMultilineStep
      ? multilineStepLineAt(document, lineNumber)
      : undefined;
    if (stepLineNumber === undefined) {
      return undefined;
    }
    line = documentLine(document, stepLineNumber);
  }

  const marker = stepMarkerIndex(line);
  if (marker === -1) {
    return undefined;
  }
  const lines = [line.slice(marker + 1).trim()];
  let endLineNumber = stepLineNumber;
  if (options.allowMultilineStep) {
    for (let nextLine = stepLineNumber + 1; nextLine < documentLineCount(document); nextLine += 1) {
      const nextText = documentLine(document, nextLine);
      if (isGaugeSyntaxBoundary(nextText)) {
        break;
      }
      lines.push(nextText.trim());
      endLineNumber = nextLine;
    }
  }
  const text = lines.join(" ").trim();
  if (!text) {
    return undefined;
  }
  const nextLine = documentLine(document, endLineNumber + 1);
  return {
    implicitParameterCount: isDocStringFenceLine(nextLine) ? 1 : 0,
    text: isInlineTableLine(nextLine) ? `${text} <table>` : text,
  };
}

function kotlinStringLiteral(value) {
  return JSON.stringify(value).replace(/\$/g, () => "\\$");
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

function stepStubCode(stepText, methodName = "implementation", implicitParameterCount = 0) {
  const params = Array.from(
    { length: countStepParameters(stepText) + implicitParameterCount },
    (_entry, index) => `arg${index}: Any`,
  ).join(", ");
  return [
    `@com.thoughtworks.gauge.Step(${kotlinStringLiteral(stepText)})`,
    `fun ${methodName}(${params}) {`,
    "}",
    "",
  ].join("\n");
}

function javaStepStubCode(stepText, methodName = "implementation", implicitParameterCount = 0) {
  const params = Array.from(
    { length: countStepParameters(stepText) + implicitParameterCount },
    (_entry, index) => `Object arg${index}`,
  ).join(", ");
  return [
    `@com.thoughtworks.gauge.Step(${JSON.stringify(stepText)})`,
    `public void ${methodName}(${params}) {`,
    "}",
    "",
  ].join("\n");
}

function diagnosticStubCode(diagnostic) {
  const code = diagnostic && diagnostic.code;
  if (typeof code === "string") {
    if (!code || /^gauge\./.test(code)) {
      return undefined;
    }
    return code;
  }
  if (typeof code === "number") {
    return String(code);
  }
  return undefined;
}

function isMissingImplementationDiagnostic(diagnostic) {
  return String((diagnostic && diagnostic.message) || "").includes(
    VALIDATE_MISSING_IMPLEMENTATION_MESSAGE,
  );
}

function undefinedStepDiagnostics(context) {
  return (context && Array.isArray(context.diagnostics) ? context.diagnostics : [])
    .filter((diagnostic) => (
      diagnostic
      && (
        diagnostic.message === UNDEFINED_STEP_MESSAGE
        || isMissingImplementationDiagnostic(diagnostic)
        || diagnosticStubCode(diagnostic) !== undefined
      )
    ));
}

class GaugeStepCodeActionProvider {
  constructor(options = {}) {
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
  }

  gaugeProjectRoot(document) {
    if (
      !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return undefined;
    }
    try {
      const root = this.projectFactory.getGaugeRootFromFilePath(documentPath(document));
      if (!root) {
        return undefined;
      }
      if (
        typeof this.projectFactory.isGaugeProject === "function"
        && this.projectFactory.isGaugeProject(root) === false
      ) {
        return undefined;
      }
      return root;
    } catch (_error) {
      return undefined;
    }
  }

  allowsMultilineStep(document) {
    return allowMultilineStep({
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectRoot: this.gaugeProjectRoot(document),
    });
  }

  provideCodeActions(document, range, context = {}) {
    if (
      !document
      || !isGaugeSpecDocument(document)
      || !isGaugeProjectDocument(document, this.projectFactory)
      || !range
    ) {
      return [];
    }
    const diagnostics = undefinedStepDiagnostics(context);
    if (diagnostics.length === 0) {
      return [];
    }

    const step = gaugeStepAt(document, range.start.line, {
      allowMultilineStep: this.allowsMultilineStep(document),
    });
    const suppliedCode = diagnostics.map(diagnosticStubCode).find((code) => code !== undefined);
    if (!step && suppliedCode === undefined) {
      return [];
    }

    const action = createCodeAction(this.vscode, CREATE_STEP_IMPLEMENTATION_TITLE);
    action.diagnostics = diagnostics;
    action.isPreferred = true;
    const language = projectLanguage(document, this.projectFactory);
    const code = suppliedCode || (language === JAVA_LANGUAGE
      ? javaStepStubCode(step.text, "implementation", step.implicitParameterCount)
      : stepStubCode(
        step.text,
        stepImplementationName(workspaceKotlinFunctionNames(this.vscode)),
        step.implicitParameterCount,
      ));
    action.command = {
      command: GENERATE_STEP_STUB,
      title: CREATE_STEP_IMPLEMENTATION_TITLE,
      arguments: [code],
    };
    if (!step) {
      return [action];
    }
    const conceptAction = createCodeAction(this.vscode, CREATE_CONCEPT_TITLE);
    conceptAction.diagnostics = diagnostics;
    conceptAction.command = {
      command: GENERATE_CONCEPT_STUB,
      title: CREATE_CONCEPT_TITLE,
      arguments: [
        conceptInfo(step.text),
      ],
    };
    return [action, conceptAction];
  }
}

module.exports = {
  CREATE_CONCEPT_TITLE,
  CREATE_STEP_IMPLEMENTATION_TITLE,
  GENERATE_CONCEPT_STUB,
  GENERATE_STEP_STUB,
  GaugeStepCodeActionProvider,
  UNDEFINED_STEP_MESSAGE,
  conceptInfo,
  conceptStepText,
  javaStepStubCode,
  kotlinFunctionNames,
  stepImplementationName,
  stepStubCode,
};
