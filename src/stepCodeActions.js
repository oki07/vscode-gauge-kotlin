"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const {
  countStepParameters,
  parameterizedStepValue,
  UNDEFINED_STEP_MESSAGE,
} = require("./stepDiagnostics");
const { allowMultilineStep } = require("./stepDefinitionProvider");
const {
  isGaugeDataTableKeywordLine,
  isGaugeTableRowLine,
  isGaugeTagKeywordLine,
} = require("./gaugeHeadings");
const { isMarkdownGaugeSpecFile } = require("./gaugeSpecScope");

const CREATE_CONCEPT_TITLE = "Create concept";
const CREATE_STEP_IMPLEMENTATION_TITLE = "Create step implementation";
const GENERATE_CONCEPT_STUB = "gauge.generate.concept";
const GENERATE_STEP_STUB = "gauge.generate.step";
const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const GAUGE_FILE_PATTERN = /\.(?:spec|md|cpt)$/i;
const JAVA_LANGUAGE = "java";
const KOTLIN_LANGUAGE = "kotlin";
const VALIDATE_DIAGNOSTIC_CODE = "gauge.validate";
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
  if (document.languageId === GAUGE_CONCEPT_LANGUAGE) {
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

// references/gauge/parser/lex.go isTableRow requires a closing "|" as well as an
// opening one, so "|name" is a comment and attaches no table to the step.
function isInlineTableLine(line) {
  const text = String(line || "").trim();
  return isGaugeTableRowLine(text);
}

// Gauge's lexer emits no token for a blank line following a step
// (references/gauge/parser/lex.go sets the step token's Suffix and continues),
// so a table separated from its step by blank lines still attaches to it.
// Verified against parser.SpecParser.Parse.
// A step may carry a doc string AND a table, in that order, so the scan resumes
// after a closed fence. Probed: such a step has the value "Load the payload {}"
// with the args [special_string, table], and stopping at the fence generated an
// annotation that cleared the diagnostic without satisfying the runner.
function hasInlineTableAfterStep(document, endLineNumber) {
  let fenceLine;
  for (let line = endLineNumber + 1; line < documentLineCount(document); line += 1) {
    const text = String(documentLine(document, line) || "").trim();
    if (text === "") {
      continue;
    }
    if (fenceLine === undefined && isDocStringFenceLine(text) && hasClosedDocString(document, line)) {
      fenceLine = docStringEndLine(document, line);
      if (fenceLine === undefined) {
        return false;
      }
      line = fenceLine;
      continue;
    }
    return isInlineTableLine(text);
  }
  return false;
}


function isDocStringFenceLine(line) {
  return String(line || "").trim() === "\"\"\"";
}

function docStringEndLine(document, fenceLine) {
  if (!isDocStringFenceLine(documentLine(document, fenceLine))) {
    return undefined;
  }
  for (let line = fenceLine + 1; line < documentLineCount(document); line += 1) {
    if (isDocStringFenceLine(documentLine(document, line))) {
      return line;
    }
  }
  return undefined;
}

function hasClosedDocString(document, fenceLine) {
  return docStringEndLine(document, fenceLine) !== undefined;
}

function isGaugeSyntaxBoundary(line) {
  const text = String(line || "").trim();
  return !text
    || text.startsWith("*")
    || text.startsWith("#")
    || isGaugeTagKeywordLine(text)
    || isGaugeDataTableKeywordLine(text)
    || isInlineTableLine(text)
    || isDocStringFenceLine(text)
    // A heading underline is one or more characters
    // (references/gauge/parser/helper.go isUnderline), and Gauge terminates the
    // step at it either way.
    || /^=+$/.test(text)
    || /^-+$/.test(text)
    // The teardown marker: references/gauge/parser/lex.go isTearDown ->
    // parser/helper.go isUnderline recognises a line of underscores.
    || /^_{3,}\s*$/.test(text);
}

function isStepLine(line) {
  const text = String(line || "");
  const marker = text.search(/\S/);
  return marker !== -1 && text[marker] === "*" && text[marker + 1] !== "*";
}

function stepMarkerIndex(line) {
  const text = String(line || "");
  const marker = text.search(/\S/);
  return marker !== -1 && text[marker] === "*" && text[marker + 1] !== "*" ? marker : -1;
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
  return {
    implicitParameterCount: hasClosedDocString(document, endLineNumber + 1) ? 1 : 0,
    text: hasInlineTableAfterStep(document, endLineNumber) ? `${text} <table>` : text,
  };
}

function kotlinStringLiteral(value) {
  return JSON.stringify(value).replace(/\$/g, () => "\\$");
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
  // The annotation carries the parameterized step value, the same shape the
  // runner suggests. A static literal left verbatim registers as `Pay with "100`
  // in the gauge-java registry and can never match `Pay with {}`.
  return [
    `@com.thoughtworks.gauge.Step(${kotlinStringLiteral(parameterizedStepValue(stepText))})`,
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
    `@com.thoughtworks.gauge.Step(${JSON.stringify(parameterizedStepValue(stepText))})`,
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

function isLocalStepCodeActionDiagnostic(diagnostic) {
  return Boolean(
    diagnostic
    && (
      diagnostic.message === UNDEFINED_STEP_MESSAGE
      || (
        diagnostic.code === VALIDATE_DIAGNOSTIC_CODE
        && isMissingImplementationDiagnostic(diagnostic)
      )
    )
  );
}

function undefinedStepDiagnostics(context) {
  return (context && Array.isArray(context.diagnostics) ? context.diagnostics : [])
    .filter(isLocalStepCodeActionDiagnostic);
}

class GaugeStepCodeActionProvider {
  constructor(options = {}) {
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
  }

  // A Kotlin Gauge project runs on the gauge-java runner, so its manifest says
  // "Language": "java" and cannot tell Kotlin from Java. Deciding the stub from
  // it made the Kotlin branch unreachable and emitted Java into every Kotlin
  // project. The source layout is the signal that can tell them apart; Kotlin is
  // the default, since that is what this extension exists for.
  stubLanguage(document) {
    const language = projectLanguage(document, this.projectFactory);
    if (language && language !== JAVA_LANGUAGE) {
      return language;
    }
    const root = this.gaugeProjectRoot(document);
    if (!root || !this.fileSystem || typeof this.fileSystem.existsSync !== "function") {
      return language;
    }
    const has = (...segments) => {
      try {
        return this.fileSystem.existsSync(this.pathModule.join(root, ...segments));
      } catch (_error) {
        return false;
      }
    };
    if (has("src", "test", "kotlin") || has("src", "main", "kotlin")) {
      return KOTLIN_LANGUAGE;
    }
    if (has("src", "test", "java") || has("src", "main", "java")) {
      return JAVA_LANGUAGE;
    }
    return language;
  }

  // A Markdown file is a Gauge specification only inside the project's
  // configured gauge_specs_dir. The rule lives in src/gaugeSpecScope.js so every
  // provider gives the same answer for the same file.
  isMarkdownDocumentInScope(document) {
    const file = (document && document.uri && (document.uri.fsPath || document.uri.path))
      || (document && document.fileName)
      || "";
    if (!/\.md$/i.test(String(file))) {
      return true;
    }
    return isMarkdownGaugeSpecFile(file, {
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectFactory: this.projectFactory,
    });
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
      || !this.isMarkdownDocumentInScope(document)
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
    const language = this.stubLanguage(document);
    const code = suppliedCode || (language === JAVA_LANGUAGE
      ? javaStepStubCode(step.text, "implementation", step.implicitParameterCount)
      : stepStubCode(
        step.text,
        "implementation",
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
  isLocalStepCodeActionDiagnostic,
  kotlinFunctionNames,
  stepImplementationName,
  stepStubCode,
};
