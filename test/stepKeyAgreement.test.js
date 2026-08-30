const assert = require("node:assert/strict");
const test = require("node:test");

// Every surface that answers "is this step implemented?" must derive the same
// key for the same step. The diagnostics, Go to Definition, the Kotlin reference
// lens and Rename each derive it independently, so they can disagree - and a
// disagreement is worse than either answer alone: the editor reports a step
// implemented and suppresses the runner's correct verdict, or reports it
// undefined while F12 resolves it, or rewrites a specification while leaving the
// annotation that no longer matches it.
//
// A per-module test cannot observe a disagreement between modules. This file is
// where that observation lives: one truth per shape, checked against all four.
//
// The truth for each shape below is what the real Gauge parser and the real
// gauge-java runner do - see the rule tables in src/gaugeHeadings.js and
// src/gaugeStepValue.js. A failure here means a module has diverged from the
// runner; the fix is to make it agree, never to relax the expectation without
// re-establishing the behaviour against Gauge itself.

const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
const { GaugeRenameProvider } = require("../src/renameProvider");

const SPEC_PATH = "/workspace/gauge/specs/agreement.spec";
const KOTLIN_PATH = "/workspace/gauge/src/test/kotlin/steps/Steps.kt";

function createDocument(text, languageId, fsPath) {
  const lines = text.split(/\r?\n/);
  return {
    fileName: fsPath,
    languageId,
    lineCount: lines.length,
    uri: {
      fsPath,
      path: fsPath,
      toString() {
        return `file://${fsPath}`;
      },
    },
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] || "" };
    },
  };
}

function createFakeVscode(textDocuments) {
  return {
    CodeLens: class CodeLens {
      constructor(range, command) {
        this.range = range;
        this.command = command;
      }
    },
    Location: class Location {
      constructor(uri, range) {
        this.uri = uri;
        this.range = range;
      }
    },
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Range: class Range {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    Uri: {
      file(fsPath) {
        return { fsPath, path: fsPath, toString: () => `file://${fsPath}` };
      },
    },
    WorkspaceEdit: class WorkspaceEdit {
      constructor() {
        this.replacements = [];
      }

      replace(uri, range, newText) {
        this.replacements.push({ uri, range, newText });
      }
    },
    languages: {
      createDiagnosticCollection: () => ({
        set() {},
        delete() {},
        dispose() {},
      }),
    },
    window: {},
    workspace: {
      textDocuments,
      getConfiguration: () => ({ get: () => undefined }),
      async saveAll() {
        return true;
      },
    },
  };
}

function createProjectFactory() {
  return {
    getGaugeRootFromFilePath(filename) {
      if (!String(filename).startsWith("/workspace/gauge/")) {
        throw new Error("not a Gauge project file");
      }
      return "/workspace/gauge";
    },
    isGaugeProject() {
      return true;
    },
  };
}

function kotlinSource(annotation) {
  return [
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class Steps {",
    `  @Step("${annotation}")`,
    "  fun implementation() {}",
    "}",
  ].join("\n");
}

// Everything a user can observe about "does this annotation implement this
// step?", asked of each module in turn.
async function surfacesFor(specLines, annotation, stepLine) {
  const specDocument = createDocument(specLines.join("\n"), "gauge", SPEC_PATH);
  const kotlinDocument = createDocument(kotlinSource(annotation), "kotlin", KOTLIN_PATH);
  const documents = [specDocument, kotlinDocument];
  const vscode = createFakeVscode(documents);

  const diagnostics = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode(documents) })
    .provideDiagnostics(specDocument, documents)
    .map((diagnostic) => diagnostic.message);

  const definitions = await new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  }).provideDefinition(specDocument, { line: stepLine, character: 4 });

  const lenses = await new GaugeCodeLensProvider({
    projectFactory: createProjectFactory(),
    vscode,
  }).provideCodeLenses(kotlinDocument);

  const edit = await new GaugeRenameProvider({ vscode })
    .provideRenameEdits(kotlinDocument, { line: 5, character: 12 }, `${annotation} renamed`);

  return {
    // The diagnostics module's verdict.
    undefinedStep: diagnostics.includes("Undefined Step"),
    // Go to Definition's verdict.
    definitions: (definitions || []).length,
    // The Kotlin-side reference count.
    references: (lenses || [])
      .map((lens) => lens.command && lens.command.title)
      .filter((title) => typeof title === "string" && title.includes("reference")),
    // Whether a rename of the annotation reaches the specification.
    renamesSpec: (edit && edit.replacements ? edit.replacements : [])
      .some((replacement) => replacement.uri.fsPath === SPEC_PATH),
  };
}

// A shape the runner CAN match: every surface must say so.
async function assertImplemented(label, specLines, annotation, stepLine) {
  const surfaces = await surfacesFor(specLines, annotation, stepLine);
  assert.deepEqual(surfaces, {
    undefinedStep: false,
    definitions: 1,
    references: ["1 reference(s)"],
    renamesSpec: true,
  }, `${label}: every surface must agree the step IS implemented`);
}

// A shape the runner CANNOT match: every surface must say so too. Reporting it
// implemented is worse than reporting it undefined, because the editor then
// suppresses the runner's correct verdict.
async function assertUnimplemented(label, specLines, annotation, stepLine) {
  const surfaces = await surfacesFor(specLines, annotation, stepLine);
  assert.deepEqual(surfaces, {
    undefinedStep: true,
    definitions: 0,
    references: ["0 reference(s)"],
    renamesSpec: false,
  }, `${label}: every surface must agree the step is NOT implemented`);
}

const HEAD = ["# Agreement", "", "## Scenario", ""];

test("every step surface agrees for a plain step", async () => {
  await assertImplemented("plain", [...HEAD, "* Confirm order"], "Confirm order", 4);
  await assertUnimplemented("plain mismatch", [...HEAD, "* Confirm order"], "Cancel order", 4);
});

// The runner keys its registry on StepsUtil.getStepText, which replaces only
// <...>. A quoted run therefore stays literal in an annotation while the SPEC
// grammar reads it as an argument, so `@Step("the user \"admin\" logs in")`
// registers `the user "admin" logs in` and can never match the step value
// `the user {} logs in`.
test("every step surface agrees about a quoted literal in the annotation", async () => {
  await assertUnimplemented(
    "quoted literal",
    [...HEAD, "* the user \"admin\" logs in"],
    "the user \\\"admin\\\" logs in",
    4,
  );
  await assertImplemented(
    "quoted parameter",
    [...HEAD, "* the user \"admin\" logs in"],
    "the user <name> logs in",
    4,
  );
});

// StepsUtil performs no escape processing, so braces are ordinary characters in
// an annotation, while a specification must write them "\{". The two sides
// therefore spell the same key differently, and each must use its own grammar.
test("every step surface agrees about braces in the annotation", async () => {
  await assertImplemented(
    "escaped braces",
    [...HEAD, "* cost is \\{5\\}"],
    "cost is {5}",
    4,
  );
  await assertUnimplemented(
    "annotation keeps the spec escapes",
    [...HEAD, "* cost is \\{5\\}"],
    "cost is \\\\{5\\\\}",
    4,
  );
});

// A step may carry a doc string AND an inline table, and both are arguments, so
// the step value gains the table's "{}" while the doc string adds none.
test("every step surface agrees about a doc string followed by a table", async () => {
  const lines = [...HEAD, "* Load the payload", "\"\"\"", "body", "\"\"\"", "|id|", "|--|", "|1 |"];
  await assertImplemented("doc string then table", lines, "Load the payload <table>", 4);
  await assertUnimplemented("doc string then table, no table arg", lines, "Load the payload", 4);
});

// The fence must open on the line immediately after the step. A blank line
// before it detaches the doc string AND the table, so the step takes no
// arguments at all.
test("every step surface agrees when a blank line detaches the doc string", async () => {
  const lines = [...HEAD, "* Load the payload", "", "\"\"\"", "body", "\"\"\"", "|id|", "|--|", "|1 |"];
  await assertImplemented("blank then doc string", lines, "Load the payload", 4);
  await assertUnimplemented("blank then doc string, table arg", lines, "Load the payload <table>", 4);
});

// isTableRow tests the first and last characters, so a row needs a closing pipe
// and a lone "|" is a row - both indices are the same character.
test("every step surface agrees about an unclosed table row", async () => {
  const lines = [...HEAD, "* Pay the total amount", "|a", "|1"];
  await assertImplemented("unclosed row is a comment", lines, "Pay the total amount", 4);
  await assertUnimplemented("unclosed row is not a table", lines, "Pay the total amount <table>", 4);
});

test("every step surface agrees about a bare pipe table row", async () => {
  const lines = [...HEAD, "* Pay the total amount", "|", "|1|"];
  await assertImplemented("bare pipe is a row", lines, "Pay the total amount <table>", 4);
  await assertUnimplemented("bare pipe is not a comment", lines, "Pay the total amount", 4);
});
