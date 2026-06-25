const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode() {
  return {
    Diagnostic: class Diagnostic {
      constructor(range, message, severity) {
        this.range = range;
        this.message = message;
        this.severity = severity;
      }
    },
    DiagnosticSeverity: {
      Error: "error",
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
  };
}

function createDocument(text, languageId = "kotlin") {
  return {
    languageId,
    uri: { fsPath: "/workspace/gauge/src/test/kotlin/Steps.kt" },
    getText() {
      return text;
    },
  };
}

test("GaugeStepDiagnosticsProvider reports Kotlin Step parameter count mismatches", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Say <what> to <who>\")",
    "fun say(what: String) {",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.equal(diagnostics.length, 1);
  assert.equal(
    diagnostics[0].message,
    "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Say <what> to <who>\". ",
  );
  assert.equal(diagnostics[0].severity, "error");
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 1, character: 8 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 1, character: 20 });
});

test("GaugeStepDiagnosticsProvider checks each Step alias separately", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step([\"Use <name>\", \"Use <name> as <role>\"])",
    "fun use(name: String) {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Use <name> as <role>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores matching Kotlin Step parameters", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Store <items> for <user>\")",
    "suspend fun store(items: List<String> = emptyList(), user: String) {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(document), []);
  assert.deepEqual(provider.provideDiagnostics(createDocument("@Step(\"x\")\nfun x()", "javascript")), []);
});

test("GaugeStepDiagnosticsProvider only inspects Gauge Step annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });

  assert.deepEqual(provider.provideDiagnostics(createDocument([
    "@StepAlias(\"Alias <value>\")",
    "fun alias() {}",
  ].join("\n"))), []);

  const diagnostics = provider.provideDiagnostics(createDocument([
    "@com.thoughtworks.gauge.Step(\"Qualified <value>\")",
    "fun qualified() {}",
  ].join("\n")));

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Qualified <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores non-Gauge qualified Step annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@io.cucumber.java.en.Step(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(document), []);
});

test("GaugeStepDiagnosticsProvider ignores non-Gauge imported Step annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "import io.cucumber.java.en.Step",
    "",
    "@Step(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(document), []);
});

test("GaugeStepDiagnosticsProvider reports blank Gauge steps", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "* ",
    "* Pay with card",
    "",
    "## Successful checkout",
    "  *",
    "// *",
  ].join("\n"), "gauge");

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Step should not be blank",
      "Step should not be blank",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 1, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 1, character: 2 });
  assert.deepEqual({ ...diagnostics[1].range.start }, { line: 5, character: 2 });
  assert.deepEqual({ ...diagnostics[1].range.end }, { line: 5, character: 3 });
});

test("GaugeStepDiagnosticsProvider updates and clears the diagnostic collection", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const opened = [];
  const changed = [];
  const closed = [];
  const sets = [];
  const deletes = [];
  const disposals = [];
  const document = createDocument("@Step(\"A <value>\")\nfun a() {}");
  const vscode = {
    ...createFakeVscode(),
    languages: {
      createDiagnosticCollection(name) {
        return {
          name,
          set(uri, diagnostics) {
            sets.push({ uri, diagnostics });
          },
          delete(uri) {
            deletes.push(uri);
          },
          dispose() {
            disposals.push(name);
          },
        };
      },
    },
    workspace: {
      textDocuments: [document],
      onDidOpenTextDocument(listener) {
        opened.push(listener);
        return { dispose() { disposals.push("open"); } };
      },
      onDidChangeTextDocument(listener) {
        changed.push(listener);
        return { dispose() { disposals.push("change"); } };
      },
      onDidCloseTextDocument(listener) {
        closed.push(listener);
        return { dispose() { disposals.push("close"); } };
      },
    },
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const disposable = provider.register();
  changed[0]({ document: createDocument("@Step(\"A <value>\")\nfun a(value: String) {}") });
  closed[0](document);
  disposable.dispose();

  assert.equal(sets[0].diagnostics.length, 1);
  assert.deepEqual(sets[1].diagnostics, []);
  assert.deepEqual(deletes, [document.uri]);
  assert.deepEqual(disposals, ["gauge-kotlin", "open", "change", "close"]);
});
