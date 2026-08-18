const assert = require("node:assert/strict");
const test = require("node:test");

function createDocument(text, fsPath, languageId) {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  return {
    languageId,
    uri: { fsPath, scheme: "file" },
    getText() {
      return text;
    },
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) {
        line += 1;
      }
      return { line, character: offset - lineStarts[line] };
    },
  };
}

function createFakeVscode(textDocuments = []) {
  return {
    Diagnostic: class Diagnostic {
      constructor(range, message, severity) {
        this.range = range;
        this.message = message;
        this.severity = severity;
      }
    },
    DiagnosticSeverity: {
      Hint: "hint",
    },
    DiagnosticTag: {
      Unnecessary: "unnecessary",
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
    workspace: { textDocuments },
  };
}

function diagnosticSummary(diagnostic) {
  return {
    code: diagnostic.code,
    end: { ...diagnostic.range.end },
    message: diagnostic.message,
    severity: diagnostic.severity,
    source: diagnostic.source,
    start: { ...diagnostic.range.start },
    tags: diagnostic.tags,
  };
}

test("GaugeUnusedReferenceDiagnosticsProvider fades only unreferenced concept headings", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const document = createDocument([
    "  # Reuse checkout <user>",
    "* Prepare cart",
    "",
    "# Unused concept",
    "* Prepare cart",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared.cpt", "gauge-concept");
  const referenceCounts = new Map([
    ["Reuse checkout {}", 1],
    ["Unused concept", 0],
  ]);
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    vscode: createFakeVscode([document]),
    workspaceStepIndex: {
      referenceCount(sourceDocument, template) {
        assert.equal(sourceDocument, document);
        return referenceCounts.get(template);
      },
    },
  });

  const diagnostics = await provider.provideDiagnostics(document);

  assert.deepEqual(diagnostics.map(diagnosticSummary), [
    {
      code: "gauge.unusedConcept",
      end: { line: 3, character: 16 },
      message: "Concept has no references.",
      severity: "hint",
      source: "gauge",
      start: { line: 3, character: 2 },
      tags: ["unnecessary"],
    },
  ]);
});

test("GaugeUnusedReferenceDiagnosticsProvider fades a Step declaration only when every alias is unreferenced", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const text = [
    "@Step([\"Used alias\", \"Unused alias\"])",
    "fun mixed() {}",
    "",
    "@Step(\"Unused step\")",
    "fun unusedStep() {}",
  ].join("\n");
  const document = createDocument(
    text,
    "/workspace/gauge/src/test/kotlin/Steps.kt",
    "kotlin",
  );
  const mixedStart = text.indexOf("fun mixed");
  const unusedStart = text.indexOf("fun unusedStep");
  const mixedEntry = {
    declarationEnd: mixedStart + "fun mixed()".length,
    declarationStart: mixedStart,
  };
  const unusedEntry = {
    declarationEnd: unusedStart + "fun unusedStep()".length,
    declarationStart: unusedStart,
  };
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    vscode: createFakeVscode([document]),
    workspaceStepIndex: {
      referenceCount(_sourceDocument, template) {
        return template === "Used alias" ? 1 : 0;
      },
      stepAliasesForEntry(_sourceDocument, _targetDocument, entry) {
        return entry === mixedEntry
          ? ["Used alias", "Unused alias"]
          : ["Unused step"];
      },
      stepEntriesForDocument() {
        return [mixedEntry, unusedEntry];
      },
    },
  });

  const diagnostics = await provider.provideDiagnostics(document);

  assert.deepEqual(diagnostics.map(diagnosticSummary), [
    {
      code: "gauge.unusedStepImplementation",
      end: { line: 4, character: 16 },
      message: "Step implementation has no references.",
      severity: "hint",
      source: "gauge",
      start: { line: 4, character: 0 },
      tags: ["unnecessary"],
    },
  ]);
});

test("GaugeUnusedReferenceDiagnosticsProvider uses the shared index for concept Kotlin and Java references", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");
  const conceptDocument = createDocument([
    "# Used concept <user>",
    "* Nested support",
    "",
    "# Unused concept",
    "* Nested support",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared.cpt", "gauge-concept");
  const specDocument = createDocument([
    "# Checkout",
    "* Used concept \"Alice\"",
    "* Used Kotlin step",
    "* Used Java step",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Used Kotlin step\")",
    "fun usedKotlinStep() {}",
    "",
    "@Step(\"Unused Kotlin step\")",
    "fun unusedKotlinStep() {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/Steps.kt", "kotlin");
  const javaDocument = createDocument([
    "import com.thoughtworks.gauge.Step;",
    "",
    "class Steps {",
    "  @Step(\"Used Java step\")",
    "  void usedJavaStep() {}",
    "  @Step(\"Unused Java step\")",
    "  void unusedJavaStep() {}",
    "}",
  ].join("\n"), "/workspace/gauge/src/test/java/Steps.java", "java");
  const documents = [conceptDocument, specDocument, kotlinDocument, javaDocument];
  const documentStore = {
    documents() {
      return documents;
    },
    onDidChangeDocuments() {
      return { dispose() {} };
    },
    start() {},
    whenReady() {
      return Promise.resolve();
    },
  };
  const projectFactory = {
    getGaugeRootFromFilePath() {
      return "/workspace/gauge";
    },
    isGaugeProject() {
      return true;
    },
  };
  const vscode = createFakeVscode(documents);
  const workspaceStepIndex = new WorkspaceStepIndex({
    documentStore,
    projectFactory,
    vscode,
  });
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    documentStore,
    vscode,
    workspaceStepIndex,
  });

  const [conceptDiagnostics, kotlinDiagnostics, javaDiagnostics] = await Promise.all([
    provider.provideDiagnostics(conceptDocument),
    provider.provideDiagnostics(kotlinDocument),
    provider.provideDiagnostics(javaDocument),
  ]);

  assert.deepEqual(conceptDiagnostics.map((diagnostic) => diagnostic.code), [
    "gauge.unusedConcept",
  ]);
  assert.deepEqual(kotlinDiagnostics.map((diagnostic) => diagnostic.code), [
    "gauge.unusedStepImplementation",
  ]);
  assert.deepEqual(javaDiagnostics.map((diagnostic) => diagnostic.code), [
    "gauge.unusedStepImplementation",
  ]);
  assert.deepEqual({ ...conceptDiagnostics[0].range.start }, { line: 3, character: 2 });
  assert.deepEqual({ ...kotlinDiagnostics[0].range.start }, { line: 6, character: 0 });
  assert.deepEqual({ ...javaDiagnostics[0].range.start }, { line: 6, character: 7 });
  workspaceStepIndex.dispose();
});

test("GaugeUnusedReferenceDiagnosticsProvider refreshes fading after reference changes", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const document = createDocument(
    "# Shared checkout\n* Prepare cart",
    "/workspace/gauge/specs/concepts/shared.cpt",
    "gauge-concept",
  );
  const listeners = new Set();
  const documentStore = {
    onDidChangeDocuments(listener) {
      listeners.add(listener);
      return { dispose() { listeners.delete(listener); } };
    },
    start() {},
  };
  let referenceCount = 0;
  const sets = [];
  const vscode = createFakeVscode([document]);
  vscode.languages = {
    createDiagnosticCollection(name) {
      return {
        delete() {},
        dispose() {},
        set(uri, diagnostics) {
          sets.push({ diagnostics, name, uri });
        },
      };
    },
  };
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    documentStore,
    refreshDelayMs: 0,
    vscode,
    workspaceStepIndex: {
      referenceCount() {
        return referenceCount;
      },
    },
  });

  const disposable = provider.register();
  await provider.waitForPendingRefresh();
  assert.equal(sets.at(-1).diagnostics.length, 1);

  referenceCount = 1;
  for (const listener of listeners) {
    listener({ file: "/workspace/gauge/specs/checkout.spec" });
  }
  await provider.waitForPendingRefresh();

  assert.deepEqual(sets.at(-1).diagnostics, []);
  disposable.dispose();
});
