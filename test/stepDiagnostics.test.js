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

function createDocument(text, languageId = "kotlin", fsPath = "/workspace/gauge/src/test/kotlin/Steps.kt") {
  return {
    languageId,
    uri: { fsPath },
    getText() {
      return text;
    },
  };
}

function createMultiProjectFactory() {
  return {
    getGaugeRootFromFilePath(filename) {
      if (filename.startsWith("/workspace/project-a/")) {
        return "/workspace/project-a";
      }
      if (filename.startsWith("/workspace/project-b/")) {
        return "/workspace/project-b";
      }
      throw new Error("not a Gauge project file");
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

test("GaugeStepDiagnosticsProvider accepts docstring Step parameters used by Gauge specs", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const specDocument = createDocument([
    "# Checkout",
    "* Execute the following content",
    "\"\"\"",
    "payload",
    "\"\"\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const stepDocument = createDocument([
    "@Step(\"Execute the following content\")",
    "fun execute(content: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");

  const diagnostics = provider.provideDiagnostics(stepDocument, [
    specDocument,
    stepDocument,
  ]);

  assert.deepEqual(diagnostics, []);
});

test("GaugeStepDiagnosticsProvider reports plaintext Kotlin Step parameter count mismatches", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Say <what> to <who>\")",
    "fun say(what: String) {",
    "}",
  ].join("\n"), "plaintext", "/workspace/gauge/src/test/kotlin/Steps.kt");

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Say <what> to <who>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider reports Java Step parameter count mismatches", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "package steps;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "",
    "public class Steps {",
    "  @Step(\"Say <what> to <who>\")",
    "  public void say(String what) {",
    "  }",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/steps/Steps.java");

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Say <what> to <who>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider counts escaped dynamic Step parameters", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Use <first \\\\> middle <second>>\")",
    "fun use(first: String) {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(document), []);
});

test("GaugeStepDiagnosticsProvider ignores escaped dynamic Step parameter starts", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Use \\\\<literal> and <value>\")",
    "fun use(value: String) {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(document), []);
});

test("GaugeStepDiagnosticsProvider counts static Step parameters", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Log in as \\\"admin\\\" in <tenant>\")",
    "fun login(tenant: String) {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      `Parameter count mismatch(found [1] expected [2]) with step annotation : "Log in as "admin" in <tenant>". `,
    ],
  );
});

test("GaugeStepDiagnosticsProvider handles raw Step strings with embedded quotes and parens", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"\"\"Use \"quoted)\" <name>\"\"\")",
    "fun use() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [2]) with step annotation : \"Use \"quoted)\" <name>\". ",
    ],
  );
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

test("GaugeStepDiagnosticsProvider checks Kotlin Step vararg aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Use <name>\", \"Use <name> as <role>\")",
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

test("GaugeStepDiagnosticsProvider checks generic Kotlin arrayOf Step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(value = arrayOf<String>(\"Use <name>\", \"Use <name> as <role>\"))",
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

test("GaugeStepDiagnosticsProvider ignores comments inside generic arrayOf Step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(value = arrayOf</* > */ String>(\"Use <name>\"))",
    "fun use() {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Use <name>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks qualified Kotlin arrayOf Step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(value = kotlin.arrayOf(\"Use <name>\", \"Use <name> as <role>\"))",
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

test("GaugeStepDiagnosticsProvider checks newline-qualified Kotlin arrayOf Step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(value = kotlin.",
    "  arrayOf(\"Use <name>\", \"Use <name> as <role>\"))",
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

test("GaugeStepDiagnosticsProvider checks commented qualified Kotlin arrayOf Step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(value = kotlin./* stdlib */arrayOf(\"Use <name>\", \"Use <name> as <role>\"))",
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

test("GaugeStepDiagnosticsProvider accepts Kotlin comments inside Step annotation arguments", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(/* ignored ) */ \"Commented <value>\")",
    "fun commented() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Commented <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts newline-separated qualified Step annotation names", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@com.thoughtworks.gauge.",
    "  Step(\"Qualified <value> and <other>\")",
    "fun qualified(value: String) {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Qualified <value> and <other>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores Gauge hook annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "import com.thoughtworks.gauge.*",
    "",
    "@BeforeStep",
    "fun beforeStep(value: String) {}",
    "",
    "@AfterScenario(tags = [\"fast\"])",
    "fun afterScenario() {}",
    "",
    "@Step(\"Use <value>\")",
    "fun step() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Use <value>\". ",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 9, character: 9 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 9, character: 9 });
});

test("GaugeStepDiagnosticsProvider accepts Kotlin comments in Step value argument names", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(",
    "  value /* ignored */ = [",
    "    \"Use <name>\",",
    "    \"Use <name> as <role>\",",
    "  ],",
    ")",
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

test("GaugeStepDiagnosticsProvider accepts backtick Step value argument names", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "@Step(`value` = [\"Use <name>\", \"Use <name> as <role>\"])",
    "fun use(name: String) {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Use <name> as <role>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores comments inside Kotlin Step function parameters", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"No params\")",
    "fun commented(/* no parameters */) {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(document), []);
});

test("GaugeStepDiagnosticsProvider ignores commas inside backtick parameter names", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Use <first> and <second>\")",
    "fun use(`first,second`: String) {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Use <first> and <second>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider counts Kotlin default comparison parameters", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Compare <value> <other> <third>\")",
    "fun compare(flag: Boolean = 1 < 2, other: String = \"x\") {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [2] expected [3]) with step annotation : \"Compare <value> <other> <third>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider counts Kotlin compact default comparison parameters", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "val left = 1",
    "val right = 2",
    "",
    "@Step(\"Compare <value> <other> <third>\")",
    "fun compare(flag: Boolean = left<right, other: String = \"x\") {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [2] expected [3]) with step annotation : \"Compare <value> <other> <third>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider does not attach Step annotations to later functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Holder <value>\")",
    "class StepHolder {",
    "  fun helper() {}",
    "}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(document), []);
});

test("GaugeStepDiagnosticsProvider ignores function-local Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const localFunctionDocument = createDocument([
    "fun helper() {",
    "  @Step(\"Local <value>\")",
    "  fun localStep() {}",
    "}",
  ].join("\n"));
  const memberFunctionDocument = createDocument([
    "class Steps {",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(localFunctionDocument), []);
  assert.deepEqual(
    provider.provideDiagnostics(memberFunctionDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores expression-bodied function-local Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "fun helper() = run {",
    "  @Step(\"Local <value>\")",
    "  fun localStep() {}",
    "}",
    "",
    "@Step(\"Member <value>\")",
    "fun memberStep() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks function-body object member Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const blockBodyDocument = createDocument([
    "class Steps {",
    "  fun holder() {",
    "    val objectStep = object {",
    "      @Step(\"Block object <value>\")",
    "      fun objectMemberStep() {}",
    "    }",
    "  }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));
  const expressionBodyDocument = createDocument([
    "class Steps {",
    "  fun holder() = object {",
    "    @Step(\"Expression object <value>\")",
    "    fun objectMemberStep() {}",
    "  }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(blockBodyDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Block object <value>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
  assert.deepEqual(
    provider.provideDiagnostics(expressionBodyDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Expression object <value>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks function-body local class member Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  fun holder() {",
    "    class LocalSteps {",
    "      @Step(\"Local class <value>\")",
    "      fun localClassStep() {}",
    "    }",
    "",
    "    @Step(\"Local function <value>\")",
    "    fun localFunctionStep() {}",
    "  }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Local class <value>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores init-block-local Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  init {",
    "    @Step(\"Local <value>\")",
    "    fun localStep() {}",
    "  }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks init-block object member Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  init {",
    "    val objectStep = object {",
    "      @Step(\"Init object <value>\")",
    "      fun objectMemberStep() {}",
    "    }",
    "  }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Init object <value>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores property-initializer-local Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  val setup = run {",
    "    @Step(\"Local <value>\")",
    "    fun localStep() {}",
    "    1",
    "  }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks property-initializer object member Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  val objectStep = object {",
    "    @Step(\"Object member <value>\")",
    "    fun objectMemberStep() {}",
    "  }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Object member <value>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores property-delegate-local Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  val setup by lazy {",
    "    @Step(\"Delegate local <value>\")",
    "    fun localStep() {}",
    "    1",
    "  }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores accessor-body-local Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  val getterValue: Int",
    "    get() {",
    "      @Step(\"Getter local <value>\")",
    "      fun localGetterStep() {}",
    "      return 1",
    "    }",
    "",
    "  var setterValue: Int = 0",
    "    set(value) {",
    "      @Step(\"Setter local <value>\")",
    "      fun localSetterStep() {}",
    "      field = value",
    "    }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores expression-bodied accessor-local Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  val getterValue: Int",
    "    get() = run {",
    "      @Step(\"Getter local <value>\")",
    "      fun localGetterStep() {}",
    "      1",
    "    }",
    "",
    "  var setterValue: Int = 0",
    "    set(value) = run {",
    "      @Step(\"Setter local <value>\")",
    "      fun localSetterStep() {}",
    "      field = value",
    "    }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks accessor-body object member Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  val getterValue: Int",
    "    get() {",
    "      val objectStep = object {",
    "        @Step(\"Getter object <value>\")",
    "        fun objectMemberStep() {}",
    "      }",
    "      return 1",
    "    }",
    "",
    "  var setterValue: Int = 0",
    "    set(value) = run {",
    "      val objectStep = object {",
    "        @Step(\"Setter object <value> and <other>\")",
    "        fun objectMemberStep(value: String) {}",
    "      }",
    "      field = value",
    "    }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Getter object <value>\". ",
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Setter object <value> and <other>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores constructor-body-local Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  constructor() {",
    "    @Step(\"Local <value>\")",
    "    fun localStep() {}",
    "  }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores annotated constructor-body-local Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  @Inject constructor() {",
    "    @Step(\"Local <value>\")",
    "    fun localStep() {}",
    "  }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks constructor-body object member Step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  constructor() {",
    "    val objectStep = object {",
    "      @Step(\"Constructor object <value>\")",
    "      fun objectMemberStep() {}",
    "    }",
    "  }",
    "",
    "  @Step(\"Member <value>\")",
    "  fun memberStep() {}",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Constructor object <value>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Member <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks Kotlin Step getter use-site annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const getterDocument = createDocument([
    "class Steps {",
    "  @get:Step(\"Getter <value>\")",
    "  val getterStep: String",
    "    get() = \"value\"",
    "}",
  ].join("\n"));
  const localGetterDocument = createDocument([
    "fun helper() {",
    "  @get:Step(\"Local <value>\")",
    "  val localStep: String",
    "    get() = \"value\"",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(getterDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Getter <value>\". ",
    ],
  );
  assert.deepEqual(provider.provideDiagnostics(localGetterDocument), []);
});

test("GaugeStepDiagnosticsProvider accepts whitespace after Kotlin Step annotation markers", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const functionDocument = createDocument([
    "@ /* marker */ Step(\"Decorated <value>\")",
    "fun decorated() {}",
  ].join("\n"));
  const getterDocument = createDocument([
    "class Steps {",
    "  @get: /* marker */ Step(\"Getter <value>\")",
    "  val getterStep: String",
    "    get() = \"value\"",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(functionDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Decorated <value>\". ",
    ],
  );
  assert.deepEqual(
    provider.provideDiagnostics(getterDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Getter <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks Kotlin Step getter accessor annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  val getterStep: String",
    "    @Step(\"Getter accessor <value>\")",
    "    get() = \"value\"",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Getter accessor <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks Kotlin Step getter accessors without parameter lists", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  var getterStep: String = \"value\"",
    "    @Step(\"Getter accessor <value>\")",
    "    get",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Getter accessor <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks Kotlin Step getter accessors with modifiers", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  val getterStep: String",
    "    @Step(\"Getter accessor <value>\")",
    "    public get() = \"value\"",
    "",
    "  val bodylessGetterStep: String",
    "    @Step(\"Bodyless getter accessor <value>\")",
    "    private get",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Getter accessor <value>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Bodyless getter accessor <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks Kotlin Step setter use-site annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const setterDocument = createDocument([
    "class Steps {",
    "  @set:Step(\"Setter <value> and <other>\")",
    "  var setterStep: String = \"\"",
    "}",
  ].join("\n"));
  const localSetterDocument = createDocument([
    "fun helper() {",
    "  @set:Step(\"Local <value> and <other>\")",
    "  var localStep: String = \"\"",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(setterDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Setter <value> and <other>\". ",
    ],
  );
  assert.deepEqual(provider.provideDiagnostics(localSetterDocument), []);
});

test("GaugeStepDiagnosticsProvider accepts intervening Kotlin use-site annotations on Step properties", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "annotation class Audit",
    "class Steps {",
    "  @get:Step(\"Getter <value>\")",
    "  @field:Audit",
    "  val getterStep: String = \"\"",
    "",
    "  @set:Step(\"Setter <value> and <other>\")",
    "  @property:Audit",
    "  var setterStep: String = \"\"",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Getter <value>\". ",
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Setter <value> and <other>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks Kotlin Step setter accessor annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  var setterStep: String = \"\"",
    "    @Step(\"Setter accessor <value> and <other>\")",
    "    set(value) {",
    "      field = value",
    "    }",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Setter accessor <value> and <other>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks Kotlin Step setter accessors without parameter lists", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  var setterStep: String = \"\"",
    "    @Step(\"Setter accessor <value> and <other>\")",
    "    private set",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Setter accessor <value> and <other>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks Kotlin Step setter accessors with modifiers", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  var setterStep: String = \"\"",
    "    @Step(\"Setter accessor <value> and <other>\")",
    "    private set(value) {",
    "      field = value",
    "    }",
    "",
    "  var bodylessSetterStep: String = \"\"",
    "    @Step(\"Bodyless setter accessor <value> and <other>\")",
    "    internal set",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Setter accessor <value> and <other>\". ",
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Bodyless setter accessor <value> and <other>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks grouped Kotlin Step accessor annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  val getterStep: String",
    "    @[Step(\"Grouped getter <value>\")]",
    "    public get() = \"value\"",
    "",
    "  var setterStep: String = \"\"",
    "    @[Step(\"Grouped setter <value> and <other>\")]",
    "    private set(value) {",
    "      field = value",
    "    }",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Grouped getter <value>\". ",
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Grouped setter <value> and <other>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider checks same-indent Kotlin Step setter accessors", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  var setterStep: String = \"\"",
    "  @Step(\"Setter accessor <value> and <other>\")",
    "  private set",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Setter accessor <value> and <other>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores bare accessor-like Step annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });

  assert.deepEqual(provider.provideDiagnostics(createDocument([
    "@Step(\"Bare getter <value>\")",
    "get() = \"value\"",
  ].join("\n"))), []);
  assert.deepEqual(provider.provideDiagnostics(createDocument([
    "@Step(\"Bare setter <value> and <other>\")",
    "set(value) {}",
  ].join("\n"))), []);
  assert.deepEqual(provider.provideDiagnostics(createDocument([
    "class Steps {",
    "  @Step(\"Class getter <value>\")",
    "  get() = \"value\"",
    "}",
  ].join("\n"))), []);
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

test("GaugeStepDiagnosticsProvider respects Step wildcard imports", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const nonGaugeDocument = createDocument([
    "import io.cucumber.java.en.*",
    "",
    "@Step(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"));
  const gaugeDocument = createDocument([
    "import com.thoughtworks.gauge.*",
    "",
    "@Step(\"Gauge <value>\")",
    "fun gauge() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(nonGaugeDocument), []);
  assert.deepEqual(
    provider.provideDiagnostics(gaugeDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Gauge <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores ambiguous Step wildcard imports", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const ambiguousDocument = createDocument([
    "import com.thoughtworks.gauge.*",
    "import io.cucumber.java.en.*",
    "",
    "@Step(\"Ambiguous <value>\")",
    "fun ambiguous() {}",
  ].join("\n"));
  const explicitGaugeDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "import io.cucumber.java.en.*",
    "",
    "@Step(\"Gauge <value>\")",
    "fun gauge() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(ambiguousDocument), []);
  assert.deepEqual(
    provider.provideDiagnostics(explicitGaugeDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Gauge <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores ambiguous named Step imports", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const ambiguousDocument = createDocument([
    "import io.cucumber.java.en.Step",
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Ambiguous <value>\")",
    "fun ambiguous() {}",
  ].join("\n"));
  const ambiguousAliasDocument = createDocument([
    "import io.cucumber.java.en.Step as GaugeStep",
    "import com.thoughtworks.gauge.Step as GaugeStep",
    "",
    "@GaugeStep(\"Ambiguous alias <value>\")",
    "fun ambiguousAlias() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(ambiguousDocument), []);
  assert.deepEqual(provider.provideDiagnostics(ambiguousAliasDocument), []);
});

test("GaugeStepDiagnosticsProvider resolves Step type aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const nonGaugeAliasDocument = createDocument([
    "typealias Step = io.cucumber.java.en.Step",
    "",
    "@Step(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"));
  const gaugeAliasDocument = createDocument([
    "typealias GaugeStep = com.thoughtworks.gauge.Step",
    "",
    "@GaugeStep(\"Gauge <value>\")",
    "fun gauge() {}",
  ].join("\n"));
  const annotatedGaugeAliasDocument = createDocument([
    "@Deprecated(\"use GaugeStep\") typealias GaugeStep = com.thoughtworks.gauge.Step",
    "",
    "@GaugeStep(\"Annotated <value>\")",
    "fun gauge() {}",
  ].join("\n"));
  const localAliasDocument = createDocument([
    "annotation class LocalStep(val value: String)",
    "typealias Step = LocalStep",
    "",
    "@Step(\"Local <value>\")",
    "fun local() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(nonGaugeAliasDocument), []);
  assert.deepEqual(
    provider.provideDiagnostics(gaugeAliasDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Gauge <value>\". ",
    ],
  );
  assert.deepEqual(
    provider.provideDiagnostics(annotatedGaugeAliasDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Annotated <value>\". ",
    ],
  );
  assert.deepEqual(provider.provideDiagnostics(localAliasDocument), []);
});

test("GaugeStepDiagnosticsProvider resolves chained Step type aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const gaugeChainDocument = createDocument([
    "typealias GaugeStep = com.thoughtworks.gauge.Step",
    "typealias ProjectStep = GaugeStep",
    "",
    "@ProjectStep(\"Gauge <value>\")",
    "fun gauge() {}",
  ].join("\n"));
  const nonGaugeChainDocument = createDocument([
    "typealias CucumberStep = io.cucumber.java.en.Step",
    "typealias Step = CucumberStep",
    "",
    "@Step(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"));
  const cyclicAliasDocument = createDocument([
    "typealias Step = ProjectStep",
    "typealias ProjectStep = Step",
    "",
    "@Step(\"Cycle <value>\")",
    "fun cycle() {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(gaugeChainDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Gauge <value>\". ",
    ],
  );
  assert.deepEqual(provider.provideDiagnostics(nonGaugeChainDocument), []);
  assert.deepEqual(provider.provideDiagnostics(cyclicAliasDocument), []);
});

test("GaugeStepDiagnosticsProvider resolves Step type aliases through wildcard imports", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const gaugeWildcardDocument = createDocument([
    "import com.thoughtworks.gauge.*",
    "typealias GaugeStep = Step",
    "",
    "@GaugeStep(\"Wildcard <value>\")",
    "fun gauge() {}",
  ].join("\n"));
  const nonGaugeWildcardDocument = createDocument([
    "import io.cucumber.java.en.*",
    "typealias GaugeStep = Step",
    "",
    "@GaugeStep(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"));
  const ambiguousWildcardDocument = createDocument([
    "import com.thoughtworks.gauge.*",
    "import io.cucumber.java.en.*",
    "typealias GaugeStep = Step",
    "",
    "@GaugeStep(\"Ambiguous <value>\")",
    "fun ambiguous() {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(gaugeWildcardDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Wildcard <value>\". ",
    ],
  );
  assert.deepEqual(provider.provideDiagnostics(nonGaugeWildcardDocument), []);
  assert.deepEqual(provider.provideDiagnostics(ambiguousWildcardDocument), []);
});

test("GaugeStepDiagnosticsProvider resolves imported workspace Step type aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const aliasesDocument = createDocument([
    "package fixtures.steps",
    "",
    "typealias GaugeStep = com.thoughtworks.gauge.Step",
    "typealias CucumberStep = io.cucumber.java.en.Step",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Aliases.kt");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import fixtures.steps.GaugeStep",
    "import fixtures.steps.CucumberStep",
    "",
    "@GaugeStep(\"Imported alias <value>\")",
    "fun gauge() {}",
    "",
    "@CucumberStep(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [aliasesDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Imported alias <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider resolves wildcard-imported workspace Step type aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const aliasesDocument = createDocument([
    "package fixtures.steps",
    "",
    "typealias GaugeStep = com.thoughtworks.gauge.Step",
    "typealias CucumberStep = io.cucumber.java.en.Step",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Aliases.kt");
  const otherAliasesDocument = createDocument([
    "package fixtures.other",
    "",
    "typealias GaugeStep = io.cucumber.java.en.Step",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/other/Aliases.kt");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import fixtures.steps.*",
    "",
    "@GaugeStep(\"Wildcard imported alias <value>\")",
    "fun gauge() {}",
    "",
    "@CucumberStep(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const ambiguousDocument = createDocument([
    "package fixtures.impl",
    "",
    "import fixtures.steps.*",
    "import fixtures.other.*",
    "",
    "@GaugeStep(\"Ambiguous wildcard alias <value>\")",
    "fun ambiguous() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/AmbiguousSteps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [aliasesDocument, otherAliasesDocument, stepDocument, ambiguousDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  assert.deepEqual(
    provider.provideDiagnostics(stepDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Wildcard imported alias <value>\". ",
    ],
  );
  assert.deepEqual(provider.provideDiagnostics(ambiguousDocument), []);
});

test("GaugeStepDiagnosticsProvider resolves imported workspace Step typealias chains", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const baseAliasesDocument = createDocument([
    "package fixtures.base",
    "",
    "typealias GaugeStep = com.thoughtworks.gauge.Step",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/base/Aliases.kt");
  const chainedAliasesDocument = createDocument([
    "package fixtures.steps",
    "",
    "import fixtures.base.GaugeStep",
    "",
    "typealias LoginStep = GaugeStep",
    "typealias CucumberStep = io.cucumber.java.en.Step",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Aliases.kt");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import fixtures.steps.LoginStep",
    "import fixtures.steps.CucumberStep",
    "",
    "@LoginStep(\"Chained imported alias <value>\")",
    "fun login() {}",
    "",
    "@CucumberStep(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [chainedAliasesDocument, baseAliasesDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Chained imported alias <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider resolves same-package workspace Step type aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const aliasesDocument = createDocument([
    "package fixtures.steps",
    "",
    "typealias GaugeStep = com.thoughtworks.gauge.Step",
    "typealias CucumberStep = io.cucumber.java.en.Step",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Aliases.kt");
  const stepDocument = createDocument([
    "package fixtures.steps",
    "",
    "@GaugeStep(\"Same package alias <value>\")",
    "fun gauge() {}",
    "",
    "@CucumberStep(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [aliasesDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Same package alias <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores same-package workspace Step classifiers", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const classifierDocument = createDocument([
    "package fixtures.steps",
    "",
    "annotation class Step(val value: String)",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Annotations.kt");
  const stepDocument = createDocument([
    "package fixtures.steps",
    "",
    "@Step(\"Same package local <value>\")",
    "fun local() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [classifierDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  assert.deepEqual(provider.provideDiagnostics(stepDocument), []);
});

test("GaugeStepDiagnosticsProvider ignores ambiguous same-package workspace Step type aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const gaugeAliasesDocument = createDocument([
    "package fixtures.steps",
    "",
    "typealias GaugeStep = com.thoughtworks.gauge.Step",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/GaugeAliases.kt");
  const cucumberAliasesDocument = createDocument([
    "package fixtures.steps",
    "",
    "typealias GaugeStep = io.cucumber.java.en.Step",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/CucumberAliases.kt");
  const stepDocument = createDocument([
    "package fixtures.steps",
    "",
    "@GaugeStep(\"Ambiguous same package alias <value>\")",
    "fun gauge() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [gaugeAliasesDocument, cucumberAliasesDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [],
  );
});

test("GaugeStepDiagnosticsProvider resolves multiline Step type aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const splitAfterEqualsDocument = createDocument([
    "typealias GaugeStep =",
    "  com.thoughtworks.gauge.Step",
    "",
    "@GaugeStep(\"Split alias <value>\")",
    "fun gauge() {}",
  ].join("\n"));
  const splitBeforeEqualsDocument = createDocument([
    "typealias GaugeStep",
    "  = com.thoughtworks.gauge.Step",
    "",
    "@GaugeStep(\"Split before equals <value>\")",
    "fun gauge() {}",
  ].join("\n"));
  const wildcardTargetDocument = createDocument([
    "import com.thoughtworks.gauge.*",
    "typealias GaugeStep =",
    "  Step",
    "",
    "@GaugeStep(\"Split wildcard target <value>\")",
    "fun gauge() {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(splitAfterEqualsDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Split alias <value>\". ",
    ],
  );
  assert.deepEqual(
    provider.provideDiagnostics(splitBeforeEqualsDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Split before equals <value>\". ",
    ],
  );
  assert.deepEqual(
    provider.provideDiagnostics(wildcardTargetDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Split wildcard target <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider resolves commented qualified Step typealias targets", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "typealias GaugeStep = com.thoughtworks.gauge./* target */Step",
    "",
    "@GaugeStep(\"Commented target <value>\")",
    "fun gauge() {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Commented target <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider resolves type-use annotated typealias targets for Step annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Target(AnnotationTarget.TYPE)",
    "annotation class StepType",
    "typealias GaugeStep = @StepType com.thoughtworks.gauge.Step",
    "",
    "@GaugeStep(\"Annotated target <value>\")",
    "fun gauge() {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Annotated target <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider lets local classifiers shadow Step typealias targets", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const wildcardDocument = createDocument([
    "import com.thoughtworks.gauge.*",
    "annotation class Step(val value: String)",
    "typealias GaugeStep = Step",
    "",
    "@GaugeStep(\"Local alias <value>\")",
    "fun local() {}",
  ].join("\n"));
  const explicitImportDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "annotation class Step(val value: String)",
    "typealias GaugeStep = Step",
    "",
    "@GaugeStep(\"Local explicit alias <value>\")",
    "fun local() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(wildcardDocument), []);
  assert.deepEqual(provider.provideDiagnostics(explicitImportDocument), []);
});

test("GaugeStepDiagnosticsProvider lets same-package workspace classifiers shadow Step typealias targets", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const classifierDocument = createDocument([
    "package fixtures.steps",
    "",
    "annotation class Step(val value: String)",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Annotations.kt");
  const stepDocument = createDocument([
    "package fixtures.steps",
    "",
    "import com.thoughtworks.gauge.*",
    "",
    "typealias GaugeStep = Step",
    "",
    "@GaugeStep(\"Same package alias target <value>\")",
    "fun local() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Steps.kt");
  const aliasDocument = createDocument([
    "package fixtures.steps",
    "",
    "import com.thoughtworks.gauge.*",
    "",
    "typealias ImportedGaugeStep = Step",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Aliases.kt");
  const importedStepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import fixtures.steps.ImportedGaugeStep",
    "",
    "@ImportedGaugeStep(\"Imported alias target <value>\")",
    "fun local() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [classifierDocument, stepDocument, aliasDocument, importedStepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  assert.deepEqual(provider.provideDiagnostics(stepDocument), []);
  assert.deepEqual(provider.provideDiagnostics(importedStepDocument), []);
});

test("GaugeStepDiagnosticsProvider resolves backtick Step type aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const gaugeAliasDocument = createDocument([
    "typealias `Gauge Step` = com.thoughtworks.gauge.Step",
    "",
    "@`Gauge Step`(\"Gauge <value>\")",
    "fun gauge() {}",
  ].join("\n"));
  const nonGaugeAliasDocument = createDocument([
    "typealias `Step Alias` = io.cucumber.java.en.Step",
    "",
    "@`Step Alias`(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(gaugeAliasDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Gauge <value>\". ",
    ],
  );
  assert.deepEqual(provider.provideDiagnostics(nonGaugeAliasDocument), []);
});

test("GaugeStepDiagnosticsProvider resolves backtick Step import aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const gaugeAliasDocument = createDocument([
    "import com.thoughtworks.gauge.Step as `Gauge Step`",
    "",
    "@`Gauge Step`(\"Gauge <value>\")",
    "fun gauge() {}",
  ].join("\n"));
  const nonGaugeAliasDocument = createDocument([
    "import io.cucumber.java.en.Step as `Step Alias`",
    "",
    "@`Step Alias`(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(gaugeAliasDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Gauge <value>\". ",
    ],
  );
  assert.deepEqual(provider.provideDiagnostics(nonGaugeAliasDocument), []);
});

test("GaugeStepDiagnosticsProvider resolves Step aliases with Kotlin comments", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const importAliasDocument = createDocument([
    "import com.thoughtworks.gauge.Step /* comment */ as GaugeStep",
    "",
    "@GaugeStep(\"Imported <value>\")",
    "fun imported() {}",
  ].join("\n"));
  const importAliasAfterAsDocument = createDocument([
    "import com.thoughtworks.gauge.Step as /* comment */ GaugeStep",
    "",
    "@GaugeStep(\"Imported after as <value>\")",
    "fun importedAfterAs() {}",
  ].join("\n"));
  const tightImportAliasDocument = createDocument([
    "import com.thoughtworks.gauge.Step/* comment */as GaugeStep",
    "",
    "@GaugeStep(\"Tight imported <value>\")",
    "fun tightImported() {}",
  ].join("\n"));
  const tightImportAliasAfterAsDocument = createDocument([
    "import com.thoughtworks.gauge.Step as/* comment */GaugeStep",
    "",
    "@GaugeStep(\"Tight imported after as <value>\")",
    "fun tightImportedAfterAs() {}",
  ].join("\n"));
  const typeAliasDocument = createDocument([
    "typealias ProjectStep /* comment */ = com.thoughtworks.gauge.Step",
    "",
    "@ProjectStep(\"Aliased <value>\")",
    "fun aliased() {}",
  ].join("\n"));
  const typeAliasAfterEqualsDocument = createDocument([
    "typealias ProjectStep = /* comment */ com.thoughtworks.gauge.Step",
    "",
    "@ProjectStep(\"Aliased after equals <value>\")",
    "fun aliasedAfterEquals() {}",
  ].join("\n"));
  const nonGaugeImportAliasDocument = createDocument([
    "import io.cucumber.java.en.Step /* comment */ as GaugeStep",
    "",
    "@GaugeStep(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(importAliasDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Imported <value>\". ",
    ],
  );
  assert.deepEqual(
    provider.provideDiagnostics(importAliasAfterAsDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Imported after as <value>\". ",
    ],
  );
  assert.deepEqual(
    provider.provideDiagnostics(tightImportAliasDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Tight imported <value>\". ",
    ],
  );
  assert.deepEqual(
    provider
      .provideDiagnostics(tightImportAliasAfterAsDocument)
      .map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Tight imported after as <value>\". ",
    ],
  );
  assert.deepEqual(
    provider.provideDiagnostics(typeAliasDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Aliased <value>\". ",
    ],
  );
  assert.deepEqual(
    provider.provideDiagnostics(typeAliasAfterEqualsDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Aliased after equals <value>\". ",
    ],
  );
  assert.deepEqual(provider.provideDiagnostics(nonGaugeImportAliasDocument), []);
});

test("GaugeStepDiagnosticsProvider resolves commented qualified Step import aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const gaugeAliasDocument = createDocument([
    "import com.thoughtworks.gauge./* target */Step as GaugeStep",
    "",
    "@GaugeStep(\"Imported <value>\")",
    "fun imported() {}",
  ].join("\n"));
  const nonGaugeAliasDocument = createDocument([
    "import io.cucumber.java.en./* target */Step as CucumberStep",
    "",
    "@CucumberStep(\"Cucumber <value>\")",
    "fun cucumber() {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(gaugeAliasDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Imported <value>\". ",
    ],
  );
  assert.deepEqual(provider.provideDiagnostics(nonGaugeAliasDocument), []);
});

test("GaugeStepDiagnosticsProvider resolves newline-qualified Step import aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "import com.thoughtworks.gauge.",
    "  Step as GaugeStep",
    "",
    "@GaugeStep(\"Imported <value> and <other>\")",
    "fun imported(value: String) {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Imported <value> and <other>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores local Step annotation declarations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "annotation class Step(val value: String)",
    "",
    "@Step(\"Local <value>\")",
    "fun localStep() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(document), []);
});

test("GaugeStepDiagnosticsProvider ignores local Step classifier declarations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const localClassDocument = createDocument([
    "class Step(val value: String)",
    "",
    "@Step(\"Local <value>\")",
    "fun localClassStep() {}",
  ].join("\n"));
  const localObjectDocument = createDocument([
    "object Step",
    "",
    "@Step(\"Object <value>\")",
    "fun localObjectStep() {}",
  ].join("\n"));
  const commentedLocalClassDocument = createDocument([
    "class/* comment */Step",
    "",
    "@Step(\"Commented local <value>\")",
    "fun commentedLocalClassStep() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(localClassDocument), []);
  assert.deepEqual(provider.provideDiagnostics(localObjectDocument), []);
  assert.deepEqual(provider.provideDiagnostics(commentedLocalClassDocument), []);
});

test("GaugeStepDiagnosticsProvider ignores nested local Step classifier declarations in scope", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const localAnnotationDocument = createDocument([
    "class Steps {",
    "  annotation class Step(val value: String)",
    "",
    "  @Step(\"Local <value>\")",
    "  fun localStep() {}",
    "}",
  ].join("\n"));
  const siblingObjectDocument = createDocument([
    "class Steps {",
    "  object Helpers {",
    "    annotation class Step(val value: String)",
    "  }",
    "",
    "  @Step(\"Gauge <value>\")",
    "  fun gaugeStep() {}",
    "}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(localAnnotationDocument), []);
  assert.deepEqual(
    provider.provideDiagnostics(siblingObjectDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Gauge <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider lets local Step classifiers shadow Gauge imports", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const namedImportDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "class Steps {",
    "  annotation class Step(val value: String)",
    "",
    "  @Step(\"Local <value>\")",
    "  fun localStep() {}",
    "}",
  ].join("\n"));
  const aliasImportDocument = createDocument([
    "import com.thoughtworks.gauge.Step as GaugeStep",
    "",
    "class Steps {",
    "  annotation class GaugeStep(val value: String)",
    "",
    "  @GaugeStep(\"Local <value>\")",
    "  fun localStep() {}",
    "}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(namedImportDocument), []);
  assert.deepEqual(provider.provideDiagnostics(aliasImportDocument), []);
});

test("GaugeStepDiagnosticsProvider ignores nested Step classifiers outside annotation scope", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "fun helper() {",
    "  class Step",
    "}",
    "object Helpers {",
    "  class Step",
    "}",
    "",
    "@Step(\"Gauge <value>\")",
    "fun gauge() {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Gauge <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores Step imports inside Kotlin comments", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "/*",
    "import io.cucumber.java.en.Step",
    "*/",
    "",
    "@Step(\"Gauge <value>\")",
    "fun gauge() {}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Gauge <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores Step text in Kotlin comments and strings", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "// @Step(\"Comment <value>\")",
    "val sample = \"@Step(\\\"String <value>\\\")\"",
    "fun notStep() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(document), []);
});

test("GaugeStepDiagnosticsProvider ignores Step text in nested Kotlin block comments", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "/*",
    "  /* @Step(\"Nested <value>\") */",
    "  @Step(\"Outer <value>\")",
    "*/",
    "fun notStep() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(document), []);
});

test("GaugeStepDiagnosticsProvider accepts Gauge Step import aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "import com.thoughtworks.gauge.Step as GaugeStep",
    "",
    "@GaugeStep(\"Aliased <value>\")",
    "fun aliased() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Aliased <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts escaped Gauge Step annotation identifiers", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@`Step`(\"Escaped imported <value>\")",
    "fun imported() {}",
    "",
    "@com.thoughtworks.gauge.`Step`(\"Escaped qualified <value>\")",
    "fun qualified() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Escaped imported <value>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Escaped qualified <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts backtick Kotlin step function names", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Backtick <value>\")",
    "fun `backtick step`() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Backtick <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts backtick Kotlin step function names containing parentheses", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Backtick <value>\")",
    "fun `backtick (legacy) step`() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Backtick <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts backtick Kotlin step function names containing dots", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Backtick <value>\")",
    "fun `legacy.step`() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Backtick <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts generic Kotlin step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Generic <value>\")",
    "fun <T : List<String>> generic() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Generic <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts function type upper-bound Kotlin step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Bound <value>\")",
    "fun <T : (String, Int) -> Unit> bound() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Bound <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts multiline generic Kotlin step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Generic <value>\")",
    "fun <",
    "  T : List<String>",
    "> generic() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Generic <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts nullable receiver Kotlin step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Normalize <value>\")",
    "fun String?.normalizeStep() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Normalize <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts function type receiver Kotlin step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Function receiver <value>\")",
    "fun (() -> Unit).functionReceiver() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Function receiver <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts Kotlin step function header comments", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Header comment <value>\")",
    "fun headerComment /* whitespace */ () {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Header comment <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores parentheses inside Kotlin step function header comments", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Header comment <value>\")",
    "fun /* ignored ( */ headerComment() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Header comment <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts Kotlin step function parameter lists on the next line", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Line break <value>\")",
    "fun lineBreak",
    "() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Line break <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts Kotlin step function names on the next line", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Name line break <value>\")",
    "fun",
    "nameLineBreak() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Name line break <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts receiver dots on the next line", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Receiver dot <value>\")",
    "fun String?",
    ".receiverDot() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Receiver dot <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts context parameter Kotlin step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"Context <value>\")",
    "context(service: StepService, user: User)",
    "fun contextStep() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Context <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider skips backtick annotations before Kotlin step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "annotation class `Audit Marker`",
    "",
    "@Step(\"Decorated <value>\")",
    "@`Audit Marker`",
    "fun decorated() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Decorated <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts grouped Kotlin Step annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@[Step(\"Grouped <value>\")]",
    "fun grouped() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Grouped <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider accepts whitespace after grouped annotation markers", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const functionDocument = createDocument([
    "@ /* marker */ [Step(\"Grouped <value>\")]",
    "fun grouped() {}",
  ].join("\n"));
  const getterDocument = createDocument([
    "class Steps {",
    "  @get: /* marker */ [Step(\"Grouped getter <value>\")]",
    "  val getterStep: String",
    "    get() = \"value\"",
    "}",
  ].join("\n"));

  assert.deepEqual(
    provider.provideDiagnostics(functionDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Grouped <value>\". ",
    ],
  );
  assert.deepEqual(
    provider.provideDiagnostics(getterDocument).map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Grouped getter <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider skips grouped annotations before Kotlin step functions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "annotation class Audit",
    "annotation class Trace(val value: String = \"\")",
    "",
    "@Step(\"Grouped decorated <value>\")",
    "@[Audit Trace(\"step\")]",
    "fun groupedDecorated() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Grouped decorated <value>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores newline-separated non-Gauge grouped Step annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@[com.example.",
    "  Step(\"Grouped <value>\")]",
    "fun grouped() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(document), []);
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const step annotation values", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Log in as <user>\"",
    "private const val LOGOUT_STEP = \"Log out <user> from <tenant>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
    "",
    "@Step(value = arrayOf(LOGOUT_STEP, \"Audit <event>\"))",
    "fun audit(user: String) {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Log out <user> from <tenant>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const declarations with header comments", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val OPEN /* start */ = \"<\"",
    "private const val NAME: /* type */ String = \"user\"",
    "private const val CLOSE: String /* assign */ = \">\"",
    "private const val LOGIN_STEP /* alias */ : String /* value */ = \"Log in as $OPEN$NAME$CLOSE\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const declarations with reordered modifiers", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "const private val OPEN = \"<\"",
    "const /* c */ internal /* p */ val NAME: String = \"user\"",
    "const public val CLOSE = \">\"",
    "const private val LOGIN_STEP: String = \"Log in as $OPEN$NAME$CLOSE\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin string template constants", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val USER_ARG = \"<user>\"",
    "private const val LOGIN_STEP = \"Log in as $USER_ARG\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates backtick constants in simple string templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val `USER ARG` = \"<user>\"",
    "private const val LOGIN_STEP = \"Log in as $`USER ARG`\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin char templates in const values", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val PAY_STEP = \"Pay ${'$'}${'<'}amount${'>'}\"",
    "",
    "@Step(PAY_STEP)",
    "fun pay() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Pay $<amount>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin char constants in string templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val OPEN: Char = '<'",
    "private const val CLOSE = '>'",
    "private const val LOGIN_STEP = \"Log in as ${OPEN}user${CLOSE}\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin integer constants in string templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val RETRY_COUNT: Int = 2",
    "private const val LOGIN_STEP = \"Retry $RETRY_COUNT times as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 2 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider stringifies Kotlin hex and binary integer constants", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val HEX_COUNT: Int = 0x10",
    "private const val BINARY_COUNT: Int = 0b10",
    "private const val LOGIN_STEP = \"Retry $HEX_COUNT/$BINARY_COUNT times as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 16/2 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin long constants in string templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val RETRY_COUNT: Long = 10L",
    "private const val LOGIN_STEP = \"Retry $RETRY_COUNT times as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 10 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin unsigned integer constants in string templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val UINT_COUNT: UInt = 3u",
    "private const val UINT_TOTAL: UInt = 5U",
    "private const val ULONG_COUNT: ULong = 4UL",
    "private const val ULONG_TOTAL: ULong = 6uL",
    "private const val LOGIN_STEP = \"Retry $UINT_COUNT/$UINT_TOTAL and $ULONG_COUNT/$ULONG_TOTAL times as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 3/5 and 4/6 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin boolean constants in string templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val FEATURE_ENABLED: Boolean = true",
    "private const val LOGIN_STEP = \"Feature $FEATURE_ENABLED for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin unary boolean expressions in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Feature ${!false} for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin boolean operator expressions in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Feature ${false || true && !false} for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin integer equality expressions in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Feature ${1 + 1 == 2} for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin integer comparison expressions in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Feature ${2 * 3 >= 6} for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const boolean comparison aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val FEATURE_ENABLED = 1 < 2",
    "private const val LOGIN_STEP = \"Feature $FEATURE_ENABLED for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin byte and short constants in string templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val RETRY_COUNT: Byte = 2",
    "private const val GROUP_COUNT: Short = 4",
    "private const val LOGIN_STEP = \"Retry $RETRY_COUNT/$GROUP_COUNT times as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 2/4 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin float and double constants in string templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val TIMEOUT_SECONDS: Float = 1.5F",
    "private const val RETRY_RATE: Double = 2.25",
    "private const val LOGIN_STEP = \"Wait $TIMEOUT_SECONDS/$RETRY_RATE seconds as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Wait 1.5/2.25 seconds as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin floating-point arithmetic expressions in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Wait ${1.5 + 0.5} seconds as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Wait 2.0 seconds as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin typed floating-point constants in arithmetic templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val TIMEOUT_SECONDS: Double = 1.5",
    "private const val LOGIN_STEP = \"Wait ${TIMEOUT_SECONDS + 0.5} seconds as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Wait 2.0 seconds as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin inferred floating-point constants in arithmetic templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val TIMEOUT_SECONDS = 1.5",
    "private const val LOGIN_STEP = \"Wait ${TIMEOUT_SECONDS + 0.5} seconds as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Wait 2.0 seconds as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates typed constants in direct Step templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val TIMEOUT_SECONDS: Double = 1.5",
    "",
    "@Step(\"Wait ${TIMEOUT_SECONDS + 0.5} seconds as <user>\")",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Wait 2.0 seconds as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin floating-point boolean expressions in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val TIMEOUT_SECONDS = 1.5",
    "private const val LOGIN_STEP = \"Feature ${TIMEOUT_SECONDS + 0.5 == 2.0 && 2.5 >= 2.0} for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin string equality expressions in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val FEATURE_NAME = \"login\"",
    "private const val LOGIN_STEP = \"Feature ${FEATURE_NAME == \"login\"} for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin string expression equality operands in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Feature ${(\"log\" + \"in\") == \"login\"} for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider preserves numeric-looking Kotlin string equality operands", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LEFT = \"1\"",
    "private const val RIGHT = \"1L\"",
    "private const val LOGIN_STEP = \"Feature ${LEFT == RIGHT} for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature false for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin boolean equality expressions in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val FEATURE_ENABLED = true",
    "private const val LOGIN_STEP = \"Feature ${FEATURE_ENABLED == true} for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates backtick boolean constants with operators in names", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val `FLAG==ENABLED`: Boolean = true",
    "private const val LOGIN_STEP = \"Feature ${`FLAG==ENABLED` == true} for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin boolean expression equality operands in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Feature ${(true && false) == false} for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin char equality expressions in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val OPEN: Char = '<'",
    "private const val LOGIN_STEP = \"Feature ${OPEN == '<'} for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin char comparison constants in string templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val FEATURE_ENABLED = 'a' < 'b'",
    "private const val LOGIN_STEP = \"Feature $FEATURE_ENABLED for <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Feature true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider propagates Kotlin const alias types into equality templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val BASE_NAME = \"login\"",
    "private const val FEATURE_NAME = BASE_NAME",
    "private const val BASE_ENABLED = true",
    "private const val FEATURE_ENABLED = BASE_ENABLED",
    "private const val BASE_OPEN = '<'",
    "private const val OPEN = BASE_OPEN",
    "private const val STRING_STEP = \"String ${FEATURE_NAME == \"login\"} for <user>\"",
    "private const val BOOLEAN_STEP = \"Boolean ${FEATURE_ENABLED == true} for <user>\"",
    "private const val CHAR_STEP = \"Char ${OPEN == '<'} for <user>\"",
    "",
    "@Step(STRING_STEP)",
    "fun stringStep() {}",
    "",
    "@Step(BOOLEAN_STEP)",
    "fun booleanStep() {}",
    "",
    "@Step(CHAR_STEP)",
    "fun charStep() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"String true for <user>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Boolean true for <user>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Char true for <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider preserves numeric-looking Kotlin string constants in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val TIMEOUT_TEXT = \"1.5\"",
    "private const val LOGIN_STEP = \"Wait ${TIMEOUT_TEXT + 0.5} seconds as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Wait 1.50.5 seconds as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin template constant expressions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val OPEN = \"<\"",
    "private const val NAME = \"user\"",
    "private const val CLOSE = \">\"",
    "private const val LOGIN_STEP = \"Log in as ${OPEN + NAME + CLOSE}\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin integer addition in template expressions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Retry ${1 + 1} times as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 2 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates backtick integer constants with operators in names", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val `A+B`: Int = 2",
    "private const val LOGIN_STEP = \"Retry ${`A+B` + 1} times as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 3 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin integer subtraction in template expressions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Retry ${2 - 1} time as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 1 time as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin integer multiplication in template expressions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Retry ${2 * 3} times as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 6 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin integer division in template expressions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Retry ${7 / 2} times as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 3 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin integer remainder in template expressions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Retry ${7 % 4} times as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 3 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider respects Kotlin integer operator precedence in template expressions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Retry ${1 + 2 * 3} times as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 7 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin unary integer expressions in templates", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Retry ${-(2 + 1)} times as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry -3 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates parenthesized Kotlin const expressions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val USER_ARG = \"<user>\"",
    "private const val LOGIN_STEP = (\"Log in as \" + USER_ARG)",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const expressions with qualified String type", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP: kotlin.String = \"Log in as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const expressions with commented qualified type annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP: kotlin./* type */String = \"Log in as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const expressions with type-use annotated type annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Target(AnnotationTarget.TYPE)",
    "annotation class StepType",
    "typealias StepText = String",
    "private const val USER_ARG: @StepType StepText = \"<user>\"",
    "private const val LOGIN_STEP: @StepType kotlin.String = \"Log in as $USER_ARG\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const expressions with typealias primitive types", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "typealias StepText = String",
    "typealias StepCount = Int",
    "private const val USER_ARG: StepText = \"<user>\"",
    "private const val RETRY_COUNT: StepCount = 2",
    "private const val LOGIN_STEP: StepText = \"Retry $RETRY_COUNT times as $USER_ARG\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 2 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const expressions with annotated typealias primitive types", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Deprecated(\"use String\") typealias StepText = String",
    "@Deprecated(\"use Int\") public typealias StepCount = Int",
    "private const val USER_ARG: StepText = \"<user>\"",
    "private const val RETRY_COUNT: StepCount = 2",
    "private const val LOGIN_STEP: StepText = \"Retry $RETRY_COUNT times as $USER_ARG\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 2 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const expressions with multiline typealias primitive types", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Deprecated(\"use String\") typealias StepText =",
    "  String",
    "typealias StepCount",
    "  = Int",
    "private const val USER_ARG: StepText = \"<user>\"",
    "private const val RETRY_COUNT: StepCount = 2",
    "private const val LOGIN_STEP: StepText = \"Retry $RETRY_COUNT times as $USER_ARG\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 2 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const expressions with commented qualified typealias targets", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "typealias StepText = kotlin./* target */String",
    "private const val USER_ARG: StepText = \"<user>\"",
    "private const val LOGIN_STEP: StepText = \"Log in as $USER_ARG\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const expressions with type-use annotated typealias targets", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Target(AnnotationTarget.TYPE)",
    "annotation class StepType",
    "typealias StepText = @StepType String",
    "private const val USER_ARG: StepText = \"<user>\"",
    "private const val LOGIN_STEP: StepText = \"Log in as $USER_ARG\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const expressions with imported primitive type aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "import kotlin.String as StepText",
    "import kotlin.Int as StepCount",
    "private const val USER_ARG: StepText = \"<user>\"",
    "private const val RETRY_COUNT: StepCount = 2",
    "private const val LOGIN_STEP: StepText = \"Retry $RETRY_COUNT times as $USER_ARG\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Retry 2 times as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const expressions with commented qualified import aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "import kotlin./* target */String as StepText",
    "private const val USER_ARG: StepText = \"<user>\"",
    "private const val LOGIN_STEP: StepText = \"Log in as $USER_ARG\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin const expressions with newline-qualified import aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "import kotlin.",
    "  String as StepText",
    "private const val LOGIN_STEP: StepText = \"Log in as <user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates commented qualified Kotlin const references", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const documents = {
    directAnnotation: createDocument([
      "object Steps {",
      "  const val LOGIN_STEP = \"Log in as <user>\"",
      "}",
      "",
      "@Step(Steps./* ref */LOGIN_STEP)",
      "fun login() {}",
    ].join("\n")),
    templateExpression: createDocument([
      "object Steps {",
      "  const val USER_ARG = \"<user>\"",
      "}",
      "const val LOGIN_STEP = \"Log in as ${Steps./* ref */USER_ARG}\"",
      "",
      "@Step(LOGIN_STEP)",
      "fun login() {}",
    ].join("\n")),
    aliasExpression: createDocument([
      "object Steps {",
      "  const val BASE_STEP = \"Log in as <user>\"",
      "}",
      "const val LOGIN_STEP = Steps./* ref */BASE_STEP",
      "",
      "@Step(LOGIN_STEP)",
      "fun login() {}",
    ].join("\n")),
  };

  const diagnostics = Object.fromEntries(
    Object.entries(documents).map(([name, document]) => [
      name,
      provider.provideDiagnostics(document).map((diagnostic) => diagnostic.message),
    ]),
  );

  assert.deepEqual(diagnostics, {
    aliasExpression: [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
    directAnnotation: [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
    templateExpression: [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  });
});

test("GaugeStepDiagnosticsProvider evaluates qualified Kotlin const references", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "object StepText {",
    "  const val USER_ARG = \"<user>\"",
    "  const val LOGIN_STEP = \"Log in as \" + USER_ARG",
    "}",
    "",
    "@Step(StepText.LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates imported Kotlin const step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "package fixtures.steps",
    "",
    "import fixtures.steps.StepText.LOGIN_STEP",
    "import fixtures.steps.StepText.AUDIT_STEP as AUDIT_STEP_ALIAS",
    "",
    "object StepText {",
    "  const val LOGIN_STEP = \"Log in as <user>\"",
    "  const val AUDIT_STEP = \"Audit <event>\"",
    "}",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
    "",
    "@Step(AUDIT_STEP_ALIAS)",
    "fun audit() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Audit <event>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates imported workspace Kotlin const step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const constantsDocument = createDocument([
    "package fixtures.steps",
    "",
    "const val LOGIN_STEP = \"Log in as <user>\"",
    "",
    "object StepText {",
    "  const val AUDIT_STEP = \"Audit <event>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/StepText.kt");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import fixtures.steps.LOGIN_STEP",
    "import fixtures.steps.StepText.AUDIT_STEP as AUDIT_STEP_ALIAS",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
    "",
    "@Step(AUDIT_STEP_ALIAS)",
    "fun audit() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [constantsDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Audit <event>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates same-package workspace Kotlin const step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const constantsDocument = createDocument([
    "package fixtures.steps",
    "",
    "const val LOGIN_STEP = \"Same package <user>\"",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/StepText.kt");
  const stepDocument = createDocument([
    "package fixtures.steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [constantsDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Same package <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates same-package workspace object Kotlin const references", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const constantsDocument = createDocument([
    "package fixtures.steps",
    "",
    "object StepText {",
    "  const val LOGIN_STEP = \"Same package object <user>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/StepText.kt");
  const stepDocument = createDocument([
    "package fixtures.steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(StepText.LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [constantsDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Same package object <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores ambiguous same-package workspace Kotlin const aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const firstConstantsDocument = createDocument([
    "package fixtures.steps",
    "",
    "const val LOGIN_STEP = \"First <user> and <tenant>\"",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/FirstText.kt");
  const secondConstantsDocument = createDocument([
    "package fixtures.steps",
    "",
    "const val LOGIN_STEP = \"Second <user>\"",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/SecondText.kt");
  const stepDocument = createDocument([
    "package fixtures.steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(LOGIN_STEP)",
    "fun login(user: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [firstConstantsDocument, secondConstantsDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [],
  );
});

test("GaugeStepDiagnosticsProvider ignores ambiguous imported workspace Kotlin const step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const firstConstantsDocument = createDocument([
    "package fixtures.first",
    "",
    "object StepText {",
    "  const val LOGIN_STEP = \"First <user> and <tenant>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/first/StepText.kt");
  const secondConstantsDocument = createDocument([
    "package fixtures.second",
    "",
    "object StepText {",
    "  const val LOGIN_STEP = \"Second <user>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/second/StepText.kt");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.first.StepText.LOGIN_STEP",
    "import fixtures.second.StepText.LOGIN_STEP",
    "",
    "@Step(LOGIN_STEP)",
    "fun login(user: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [firstConstantsDocument, secondConstantsDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [],
  );
});

test("GaugeStepDiagnosticsProvider evaluates wildcard-imported workspace Kotlin const step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const constantsDocument = createDocument([
    "package fixtures.steps",
    "",
    "object StepText {",
    "  const val LOGIN_STEP = \"Log in as <user>\"",
    "  const val AUDIT_STEP = \"Audit <event>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/StepText.kt");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.steps.StepText.*",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
    "",
    "@Step(AUDIT_STEP)",
    "fun audit() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [constantsDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Audit <event>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates package wildcard-imported workspace Kotlin const step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const constantsDocument = createDocument([
    "package fixtures.steps",
    "",
    "const val LOGIN_STEP = \"Log in as <user>\"",
    "const val AUDIT_STEP = \"Audit <event>\"",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/StepText.kt");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.steps.*",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
    "",
    "@Step(AUDIT_STEP)",
    "fun audit() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [constantsDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Audit <event>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider lets package Kotlin const aliases shadow wildcard-imported aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const constantsDocument = createDocument([
    "package fixtures.steps",
    "",
    "object StepText {",
    "  const val LOGIN_STEP = \"Imported <user>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/StepText.kt");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.steps.StepText.*",
    "",
    "const val LOGIN_STEP = \"Local <user> and <tenant>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login(user: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [constantsDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Local <user> and <tenant>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores ambiguous wildcard-imported Kotlin const step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const firstConstantsDocument = createDocument([
    "package fixtures.first",
    "",
    "object StepText {",
    "  const val LOGIN_STEP = \"First <user> and <tenant>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/first/StepText.kt");
  const secondConstantsDocument = createDocument([
    "package fixtures.second",
    "",
    "object StepText {",
    "  const val LOGIN_STEP = \"Second <user>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/second/StepText.kt");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.first.StepText.*",
    "import fixtures.second.StepText.*",
    "",
    "@Step(LOGIN_STEP)",
    "fun login(user: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [firstConstantsDocument, secondConstantsDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [],
  );
});

test("GaugeStepDiagnosticsProvider ignores same-value ambiguous wildcard-imported Kotlin const step aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const firstConstantsDocument = createDocument([
    "package fixtures.first",
    "",
    "object StepText {",
    "  const val LOGIN_STEP = \"Shared <user> and <tenant>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/first/StepText.kt");
  const secondConstantsDocument = createDocument([
    "package fixtures.second",
    "",
    "object StepText {",
    "  const val LOGIN_STEP = \"Shared <user> and <tenant>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/second/StepText.kt");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.first.StepText.*",
    "import fixtures.second.StepText.*",
    "",
    "@Step(LOGIN_STEP)",
    "fun login(user: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [firstConstantsDocument, secondConstantsDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [],
  );
});

test("GaugeStepDiagnosticsProvider rechecks delayed ambiguous wildcard-imported Kotlin const aliases", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const firstConstantsDocument = createDocument([
    "package fixtures.first",
    "",
    "object StepText {",
    "  const val LOGIN_STEP = \"First <user> and <tenant>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/first/StepText.kt");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.first.StepText.*",
    "import fixtures.impl.StepText.*",
    "",
    "object StepText {",
    "  const val LOGIN_STEP = \"Local <user>\"",
    "}",
    "",
    "@Step(LOGIN_STEP)",
    "fun login(user: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [firstConstantsDocument, stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [],
  );
});

test("GaugeStepDiagnosticsProvider resolves same-file wildcard-imported Kotlin const aliases outside local object scopes", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.impl.ImportedText.*",
    "",
    "object LocalText {",
    "  const val LOGIN_STEP = \"Local <user>\"",
    "}",
    "",
    "object ImportedText {",
    "  const val LOGIN_STEP = \"Imported <user> and <tenant>\"",
    "}",
    "",
    "@Step(LOGIN_STEP)",
    "fun login(user: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/Steps.kt");
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [stepDocument],
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const diagnostics = provider.provideDiagnostics(stepDocument);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [1] expected [2]) with step annotation : \"Imported <user> and <tenant>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider ignores unqualified object Kotlin const references outside scope", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const topLevelDocument = createDocument([
    "object StepText {",
    "  const val LOGIN_STEP = \"Log in as <user>\"",
    "}",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));
  const nestedObjectDocument = createDocument([
    "class Steps {",
    "  object Text {",
    "    const val LOGIN_STEP = \"Log in as <user>\"",
    "  }",
    "",
    "  @Step(LOGIN_STEP)",
    "  fun login() {}",
    "}",
  ].join("\n"));
  const topLevelAliasDocument = createDocument([
    "object StepText {",
    "  const val USER_ARG = \"<user>\"",
    "}",
    "private const val LOGIN_STEP = \"Log in as \" + USER_ARG",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(topLevelDocument), []);
  assert.deepEqual(provider.provideDiagnostics(nestedObjectDocument), []);
  assert.deepEqual(provider.provideDiagnostics(topLevelAliasDocument), []);
});

test("GaugeStepDiagnosticsProvider evaluates unqualified companion Kotlin const references in the enclosing class", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class Steps {",
    "  companion object {",
    "    const val LOGIN_STEP = \"Log in as <user>\"",
    "  }",
    "",
    "  @Step(LOGIN_STEP)",
    "  fun login() {}",
    "}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates compact object Kotlin const references", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "object StepText { const val LOGIN_STEP = \"Log in as <user>\" }",
    "",
    "@Step(StepText.LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates class nested object Kotlin const references", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class StepText {",
    "  object Aliases {",
    "    const val LOGIN_STEP = \"Log in as <user>\"",
    "  }",
    "}",
    "",
    "@Step(StepText.Aliases.LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates companion object Kotlin const references", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class StepText {",
    "  companion object {",
    "    const val USER_ARG = \"<user>\"",
    "    const val LOGIN_STEP = \"Log in as \" + USER_ARG",
    "  }",
    "}",
    "",
    "@Step(StepText.LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates explicit companion object Kotlin const reference paths", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class DefaultStepText {",
    "  companion object {",
    "    const val LOGIN_STEP = \"Log in as <user>\"",
    "  }",
    "}",
    "",
    "class NamedStepText {",
    "  companion object Names {",
    "    const val LOGIN_STEP = \"Log in as <user>\"",
    "  }",
    "}",
    "",
    "@Step(DefaultStepText.Companion.LOGIN_STEP)",
    "fun defaultLogin() {}",
    "",
    "@Step(NamedStepText.LOGIN_STEP)",
    "fun namedLogin() {}",
    "",
    "@Step(NamedStepText.Names.LOGIN_STEP)",
    "fun explicitNamedLogin() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates interface companion object Kotlin const references", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "interface StepText {",
    "  companion object {",
    "    const val LOGIN_STEP = \"Log in as <user>\"",
    "  }",
    "}",
    "",
    "@Step(StepText.LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates nested companion object Kotlin const references", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "class StepNames {",
    "  class Login {",
    "    companion object {",
    "      const val USER_ARG = \"<user>\"",
    "      const val LOGIN_STEP = \"Log in as \" + USER_ARG",
    "    }",
    "  }",
    "}",
    "",
    "@Step(StepNames.Login.LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates multiline Kotlin const expressions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val USER_ARG = \"<user>\"",
    "private const val LOGIN_STEP = (",
    "  \"Log in as \" + USER_ARG",
    ")",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates multiline Kotlin const concatenations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val USER_ARG = \"<user>\"",
    "private const val LOGIN_STEP = \"Log in as \" +",
    "  USER_ARG",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates forward Kotlin const references", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Log in as \" + USER_ARG",
    "private const val USER_ARG = \"<user>\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin unicode escapes in const values", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val LOGIN_STEP = \"Log in as \\u003cuser\\u003e\"",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin backtick const references", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "private const val `LOGIN STEP` = \"Log in as <user>\"",
    "object StepText {",
    "  const val `AUDIT STEP` = \"Audit <event>\"",
    "}",
    "",
    "@Step(`LOGIN STEP`)",
    "fun login() {}",
    "",
    "@Step(StepText.`AUDIT STEP`)",
    "fun audit() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Audit <event>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider evaluates Kotlin backtick named const scopes", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "object `Step Text` {",
    "  const val LOGIN_STEP = \"Log in as <user>\"",
    "}",
    "",
    "class `Step Container` {",
    "  companion object {",
    "    const val AUDIT_STEP = \"Audit <event>\"",
    "  }",
    "}",
    "",
    "interface `Step Interface` {",
    "  companion object {",
    "    const val DELETE_STEP = \"Delete <record>\"",
    "  }",
    "}",
    "",
    "@Step(`Step Text`.LOGIN_STEP)",
    "fun login() {}",
    "",
    "@Step(`Step Container`.AUDIT_STEP)",
    "fun audit() {}",
    "",
    "@Step(`Step Interface`.DELETE_STEP)",
    "fun delete() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Audit <event>\". ",
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Delete <record>\". ",
    ],
  );
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
    "  *   ",
    "// *",
  ].join("\n"), "gauge");

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Step should not be blank",
      "Step should not be blank",
      "Step should not be blank",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 1, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 1, character: 2 });
  assert.deepEqual({ ...diagnostics[1].range.start }, { line: 5, character: 2 });
  assert.deepEqual({ ...diagnostics[1].range.end }, { line: 5, character: 3 });
  assert.deepEqual({ ...diagnostics[2].range.start }, { line: 6, character: 2 });
  assert.deepEqual({ ...diagnostics[2].range.end }, { line: 6, character: 6 });
});

test("GaugeStepDiagnosticsProvider reports Gauge step parser errors", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "## Scenario",
    "* Pay \"card",
    "* Pay <card",
    "* Pay {card}",
    "* Pay }card",
    "* Pay \\{card\\}",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Pay \\\\{card\\\\}\")",
    "fun payLiteral() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "String not terminated",
      "Dynamic parameter not terminated",
      "'{' is a reserved character and should be escaped",
      "'}' is a reserved character and should be escaped",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 2, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 2, character: 11 });
  assert.deepEqual({ ...diagnostics[3].range.start }, { line: 5, character: 0 });
  assert.deepEqual({ ...diagnostics[3].range.end }, { line: 5, character: 11 });
});

test("GaugeStepDiagnosticsProvider reports Gauge table header parser errors", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "| id | id |",
    "|----|----|",
    "| one | two |",
    "",
    "## Scenario",
    "* Confirm order",
    "| name | |",
    "| John | Doe |",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Confirm order <table>\")",
    "fun confirm(table: Table) {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Table header cannot have repeated column values",
      "Table header should not be blank",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 1, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 1, character: 11 });
  assert.deepEqual({ ...diagnostics[1].range.start }, { line: 7, character: 0 });
  assert.deepEqual({ ...diagnostics[1].range.end }, { line: 7, character: 10 });
});

test("GaugeStepDiagnosticsProvider reports Gauge data tables without rows", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "| id | name |",
    "## Scenario",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Data table should have at least 1 data row",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 1, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 1, character: 13 });
});

test("GaugeStepDiagnosticsProvider reports Gauge external tables without locations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "Table: ",
    "## Scenario",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Table location not specified",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 1, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 1, character: 6 });
});

test("GaugeStepDiagnosticsProvider reports short Gauge teardown markers", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "## Scenario",
    "* Confirm order",
    "__",
    "* Cleanup order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
    "@Step(\"Cleanup order\")",
    "fun cleanup() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Teardown should have at least three underscore characters",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 3, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 3, character: 2 });
});

test("GaugeStepDiagnosticsProvider reports repeated Gauge specification tag definitions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "tags: smoke",
    "* Context setup",
    "tags: slow",
    "## Scenario",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Context setup\")",
    "fun context() {}",
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Tags can be defined only once per specification",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 3, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 3, character: 10 });
});

test("GaugeStepDiagnosticsProvider reports repeated Gauge scenario tag definitions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "## Scenario",
    "tags: smoke",
    "* Confirm order",
    "tags: slow",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Tags can be defined only once per scenario",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 4, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 4, character: 10 });
});

test("GaugeStepDiagnosticsProvider reports duplicate Gauge scenario headings", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "## Successful checkout",
    "* Confirm order",
    "## successful checkout",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Duplicate scenario definition 'Successful checkout' found in the same specification",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 3, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 3, character: 22 });
});

test("GaugeStepDiagnosticsProvider reports multiple Gauge spec headings", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "## Successful checkout",
    "* Confirm order",
    "# Duplicate checkout",
    "## Guest checkout",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Multiple spec headings found in same file",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 3, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 3, character: 20 });
});

test("GaugeStepDiagnosticsProvider reports scenarios before Gauge spec heading", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "## Guest checkout",
    "* Confirm order",
    "# Checkout",
    "## Successful checkout",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Scenario should be defined after the spec heading",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 0, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 0, character: 17 });
});

test("GaugeStepDiagnosticsProvider reports missing Gauge spec headings", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "## Guest checkout",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Spec heading not found",
      "Scenario should be defined after the spec heading",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 0, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 0, character: 17 });
});

test("GaugeStepDiagnosticsProvider reports empty Gauge specs", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument("", "gauge", "/workspace/gauge/specs/checkout.spec");

  const diagnostics = provider.provideDiagnostics(document, [document]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Spec does not have any elements",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 0, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 0, character: 0 });
});

test("GaugeStepDiagnosticsProvider reports Gauge specs without scenarios", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "* Context setup",
    "tags: smoke",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Context setup\")",
    "fun context() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Spec should have at least one scenario",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 0, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 0, character: 10 });
});

test("GaugeStepDiagnosticsProvider reports Gauge scenarios without steps", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "## Empty scenario",
    "tags: smoke",
    "## Successful checkout",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Scenario should have at least one step",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 1, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 1, character: 17 });
});

test("GaugeStepDiagnosticsProvider reports empty Gauge spec headings", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "#   ",
    "## Scenario",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Spec heading should have at least one character",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 0, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 0, character: 1 });
});

test("GaugeStepDiagnosticsProvider reports empty Gauge scenario headings", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "# Checkout",
    "##   ",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const implementation = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document, [document, implementation]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Scenario heading should have at least one character",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 1, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 1, character: 2 });
});

test("GaugeStepDiagnosticsProvider reports undefined Gauge steps", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const specDocument = createDocument([
    "# Checkout",
    "## Scenario",
    "* Pay with <amount>",
    "  * Ship order",
    "* Confirm order",
    "  | id",
    "* Reuse payment concept",
    "*",
    "** Markdown bullet",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const kotlinDocument = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));
  const conceptDocument = createDocument([
    "# Reuse payment concept",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/concepts/payment.cpt");

  const diagnostics = provider.provideDiagnostics(specDocument, [
    specDocument,
    kotlinDocument,
    conceptDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Undefined Step",
      "Undefined Step",
      "Undefined Step",
      "Step should not be blank",
      "Undefined Step",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 2, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 2, character: 19 });
  assert.deepEqual({ ...diagnostics[1].range.start }, { line: 3, character: 2 });
  assert.deepEqual({ ...diagnostics[1].range.end }, { line: 3, character: 14 });
  assert.deepEqual({ ...diagnostics[2].range.start }, { line: 4, character: 0 });
  assert.deepEqual({ ...diagnostics[2].range.end }, { line: 4, character: 15 });
  assert.deepEqual({ ...diagnostics[4].range.start }, { line: 8, character: 0 });
  assert.deepEqual({ ...diagnostics[4].range.end }, { line: 8, character: 18 });
});

test("GaugeStepDiagnosticsProvider resolves multiline Gauge steps when project allows them", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const originalAllowMultiline = process.env.allow_multiline_step;
  delete process.env.allow_multiline_step;
  const provider = new GaugeStepDiagnosticsProvider({
    fileSystem: {
      readFileSync(filename, encoding) {
        assert.equal(filename, "/workspace/gauge/env/default/default.properties");
        assert.equal(encoding, "utf8");
        return "allow_multiline_step = true\n";
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        if (filename.startsWith("/workspace/gauge/")) {
          return "/workspace/gauge";
        }
        throw new Error("not a Gauge project file");
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/gauge");
        return true;
      },
    },
    vscode: createFakeVscode(),
  });
  const specDocument = createDocument([
    "# Checkout",
    "## Scenario",
    "* Pay with",
    "card",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const kotlinDocument = createDocument([
    "@Step(\"Pay with card\")",
    "fun pay() {}",
  ].join("\n"));

  try {
    const diagnostics = provider.provideDiagnostics(specDocument, [
      specDocument,
      kotlinDocument,
    ]);

    assert.deepEqual(diagnostics, []);
  } finally {
    if (originalAllowMultiline === undefined) {
      delete process.env.allow_multiline_step;
    } else {
      process.env.allow_multiline_step = originalAllowMultiline;
    }
  }
});

test("GaugeStepDiagnosticsProvider reports undefined concept steps by extension", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const conceptDocument = createDocument([
    "# Shared checkout",
    "* Confirm order",
    "* Pay with card",
    "*",
    "  *",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/shared.cpt");
  const kotlinDocument = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(conceptDocument, [
    conceptDocument,
    kotlinDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Undefined Step",
      "Step should not be blank",
      "Step should not be blank",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 2, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 2, character: 15 });
});

test("GaugeStepDiagnosticsProvider reports duplicate concept definitions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const conceptDocument = createDocument([
    "# Shared checkout",
    "* Confirm order",
    "",
    "  # Shared checkout",
    "* Confirm order",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/shared.cpt");
  const kotlinDocument = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(conceptDocument, [
    conceptDocument,
    kotlinDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Duplicate concept definition found",
      "Duplicate concept definition found",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 0, character: 2 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 0, character: 17 });
  assert.deepEqual({ ...diagnostics[1].range.start }, { line: 3, character: 4 });
  assert.deepEqual({ ...diagnostics[1].range.end }, { line: 3, character: 19 });
});

test("GaugeStepDiagnosticsProvider reports cross-file duplicate concept definitions", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const firstConceptDocument = createDocument([
    "# Shared checkout",
    "* Confirm order",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/checkout.cpt");
  const secondConceptDocument = createDocument([
    "# Shared checkout",
    "* Confirm order",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/duplicate.cpt");
  const kotlinDocument = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));
  const workspaceDocuments = [
    firstConceptDocument,
    secondConceptDocument,
    kotlinDocument,
  ];

  const firstDiagnostics = provider.provideDiagnostics(firstConceptDocument, workspaceDocuments);
  const secondDiagnostics = provider.provideDiagnostics(secondConceptDocument, workspaceDocuments);

  assert.deepEqual(
    firstDiagnostics.map((diagnostic) => diagnostic.message),
    [
      "Duplicate concept definition found",
    ],
  );
  assert.deepEqual({ ...firstDiagnostics[0].range.start }, { line: 0, character: 2 });
  assert.deepEqual({ ...firstDiagnostics[0].range.end }, { line: 0, character: 17 });
  assert.deepEqual(
    secondDiagnostics.map((diagnostic) => diagnostic.message),
    [
      "Duplicate concept definition found",
    ],
  );
  assert.deepEqual({ ...secondDiagnostics[0].range.start }, { line: 0, character: 2 });
  assert.deepEqual({ ...secondDiagnostics[0].range.end }, { line: 0, character: 17 });
});

test("GaugeStepDiagnosticsProvider reports concepts without steps", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const conceptDocument = createDocument([
    "# Empty concept",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/empty.cpt");

  const diagnostics = provider.provideDiagnostics(conceptDocument, [
    conceptDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Concept should have at least one step",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 0, character: 2 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 0, character: 15 });
});

test("findConceptHeadings ignores unterminated legacy underline concept headings", () => {
  const { findConceptHeadings } = require("../src/stepDiagnostics");

  assert.deepEqual(findConceptHeadings([
    "Shared login",
    "============",
  ].join("\n")), []);
});

test("findConceptHeadings includes indented hash concept headings", () => {
  const { findConceptHeadings } = require("../src/stepDiagnostics");

  assert.deepEqual(findConceptHeadings([
    "  # Shared checkout <item>",
    "* Confirm order",
  ].join("\n")), [
    {
      end: { line: 0, character: 26 },
      normalized: "Shared checkout {}",
      start: { line: 0, character: 4 },
      text: "Shared checkout <item>",
    },
  ]);
});

test("GaugeStepDiagnosticsProvider reports steps outside concept headings", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const conceptDocument = createDocument([
    "* Confirm order",
    "",
    "# Shared checkout",
    "* Confirm order",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/shared.cpt");
  const kotlinDocument = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(conceptDocument, [
    conceptDocument,
    kotlinDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Step is not defined inside a concept heading",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 0, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 0, character: 15 });
});

test("GaugeStepDiagnosticsProvider rejects scenario headings in concept files", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const conceptDocument = createDocument([
    "## Hash scenario",
    "",
    "Scenario heading",
    "----------------",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/scenario.cpt");

  const diagnostics = provider.provideDiagnostics(conceptDocument, [
    conceptDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Scenario Heading is not allowed in concept file",
      "Scenario Heading is not allowed in concept file",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 0, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 0, character: 16 });
  assert.deepEqual({ ...diagnostics[1].range.start }, { line: 2, character: 0 });
  assert.deepEqual({ ...diagnostics[1].range.end }, { line: 2, character: 16 });
});

test("GaugeStepDiagnosticsProvider rejects static arguments in concept headings", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const conceptDocument = createDocument([
    "  # Shared checkout \"user\"",
    "* Confirm order",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/shared.cpt");
  const kotlinDocument = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(conceptDocument, [
    conceptDocument,
    kotlinDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Concept heading can have only Dynamic Parameters",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 0, character: 4 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 0, character: 26 });
});

test("GaugeStepDiagnosticsProvider reports unresolved special concept heading parameters", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const conceptDocument = createDocument([
    "# Shared checkout <table:users.csv>",
    "* Confirm order",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/shared.cpt");
  const kotlinDocument = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(conceptDocument, [
    conceptDocument,
    kotlinDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Dynamic parameter <table:users.csv> could not be resolved",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 0, character: 2 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 0, character: 35 });
});

test("GaugeStepDiagnosticsProvider reports concept tables outside steps", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const conceptDocument = createDocument([
    "# Shared checkout",
    "",
    "|table|",
    "|one|",
    "",
    "* Confirm order",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/shared.cpt");
  const kotlinDocument = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(conceptDocument, [
    conceptDocument,
    kotlinDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Table doesn't belong to any step",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 2, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 2, character: 7 });
});

test("GaugeStepDiagnosticsProvider reports concept tables without closing pipes outside steps", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const conceptDocument = createDocument([
    "# Shared checkout",
    "",
    "|table",
    "",
    "* Confirm order",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/shared.cpt");
  const kotlinDocument = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(conceptDocument, [
    conceptDocument,
    kotlinDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Table doesn't belong to any step",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 2, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 2, character: 6 });
});

test("GaugeStepDiagnosticsProvider reports circular concept references", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const conceptDocument = createDocument([
    "# Concept1",
    "* Concept2",
    "",
    "# Concept2",
    "* Concept1",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/circular.cpt");

  const diagnostics = provider.provideDiagnostics(conceptDocument, [
    conceptDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Circular reference found in concept. \"Concept2\" => /workspace/gauge/specs/concepts/circular.cpt:2",
      "Circular reference found in concept. \"Concept1\" => /workspace/gauge/specs/concepts/circular.cpt:5",
    ],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 4, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 4, character: 10 });
  assert.deepEqual({ ...diagnostics[1].range.start }, { line: 1, character: 0 });
  assert.deepEqual({ ...diagnostics[1].range.end }, { line: 1, character: 10 });
});

test("GaugeStepDiagnosticsProvider reports undefined steps implemented only in another Gauge project", async () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const specDocument = createDocument([
    "# Checkout",
    "## Scenario",
    "* Shared checkout",
  ].join("\n"), "gauge", "/workspace/project-a/specs/checkout.spec");
  const otherProjectKotlinDocument = createDocument([
    "@Step(\"Shared checkout\")",
    "fun checkout() {}",
  ].join("\n"), "kotlin", "/workspace/project-b/src/test/kotlin/CheckoutSteps.kt");
  const vscode = {
    ...createFakeVscode(),
    workspace: {
      textDocuments: [specDocument],
      async findFiles(pattern) {
        if (pattern === "**/*.kt") {
          return [otherProjectKotlinDocument.uri];
        }
        if (pattern === "**/*.java" || pattern === "**/*.cpt") {
          return [];
        }
        throw new Error(`Unexpected pattern ${pattern}`);
      },
      async openTextDocument(uri) {
        assert.equal(uri, otherProjectKotlinDocument.uri);
        return otherProjectKotlinDocument;
      },
    },
  };
  const provider = new GaugeStepDiagnosticsProvider({
    projectFactory: createMultiProjectFactory(),
    vscode,
  });

  const workspaceDocuments = await provider.workspaceDocuments();
  const diagnostics = provider.provideDiagnostics(specDocument, workspaceDocuments);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    ["Undefined Step"],
  );
});

test("GaugeStepDiagnosticsProvider reports undefined steps defined only by concepts in another Gauge project", async () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const specDocument = createDocument([
    "# Checkout",
    "## Scenario",
    "* Shared concept",
  ].join("\n"), "gauge", "/workspace/project-a/specs/checkout.spec");
  const otherProjectConceptDocument = createDocument([
    "# Shared concept",
    "* Inner step",
  ].join("\n"), "gauge", "/workspace/project-b/specs/concepts/shared.cpt");
  const vscode = {
    ...createFakeVscode(),
    workspace: {
      textDocuments: [specDocument],
      async findFiles(pattern) {
        if (pattern === "**/*.cpt") {
          return [otherProjectConceptDocument.uri];
        }
        if (pattern === "**/*.kt" || pattern === "**/*.java") {
          return [];
        }
        throw new Error(`Unexpected pattern ${pattern}`);
      },
      async openTextDocument(uri) {
        assert.equal(uri, otherProjectConceptDocument.uri);
        return otherProjectConceptDocument;
      },
    },
  };
  const provider = new GaugeStepDiagnosticsProvider({
    projectFactory: createMultiProjectFactory(),
    vscode,
  });

  const workspaceDocuments = await provider.workspaceDocuments();
  const diagnostics = provider.provideDiagnostics(specDocument, workspaceDocuments);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    ["Undefined Step"],
  );
});

test("GaugeStepDiagnosticsProvider reports undefined Gauge steps when no implementations exist", async () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const specDocument = createDocument([
    "# Checkout",
    "## Scenario",
    "* Pay with card",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const vscode = {
    ...createFakeVscode(),
    workspace: {
      textDocuments: [specDocument],
      async findFiles(pattern) {
        if (pattern === "**/*.kt" || pattern === "**/*.java" || pattern === "**/*.cpt") {
          return [];
        }
        throw new Error(`Unexpected pattern ${pattern}`);
      },
      async openTextDocument() {
        throw new Error("No files should be opened");
      },
    },
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const workspaceDocuments = await provider.workspaceDocuments();
  const diagnostics = provider.provideDiagnostics(specDocument, workspaceDocuments);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    ["Undefined Step"],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 2, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 2, character: 15 });
});

test("GaugeStepDiagnosticsProvider reports undefined markdown Gauge spec steps", async () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const specDocument = createDocument([
    "# Checkout",
    "## Scenario",
    "* Pay with card",
  ].join("\n"), "markdown", "/workspace/gauge/specs/checkout.md");
  const vscode = {
    ...createFakeVscode(),
    workspace: {
      textDocuments: [specDocument],
      async findFiles(pattern) {
        if (pattern === "**/*.kt" || pattern === "**/*.java" || pattern === "**/*.cpt") {
          return [];
        }
        throw new Error(`Unexpected pattern ${pattern}`);
      },
      async openTextDocument() {
        throw new Error("No files should be opened");
      },
    },
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const workspaceDocuments = await provider.workspaceDocuments();
  const diagnostics = provider.provideDiagnostics(specDocument, workspaceDocuments);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    ["Undefined Step"],
  );
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 2, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 2, character: 15 });
});

test("GaugeStepDiagnosticsProvider ignores Markdown when the resolved root is not a Gauge project", async () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const specDocument = createDocument([
    "# Notes",
    "* Pay with card",
  ].join("\n"), "markdown", "/workspace/notes/checkout.md");
  const vscode = {
    ...createFakeVscode(),
    workspace: {
      textDocuments: [specDocument],
      async findFiles(pattern) {
        if (pattern === "**/*.kt" || pattern === "**/*.java" || pattern === "**/*.cpt") {
          return [];
        }
        if (pattern === "**/*.{spec,md}") {
          return [specDocument.uri];
        }
        throw new Error(`Unexpected pattern ${pattern}`);
      },
      async openTextDocument(uri) {
        assert.equal(uri, specDocument.uri);
        return specDocument;
      },
    },
  };
  const provider = new GaugeStepDiagnosticsProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/checkout.md");
        return "/workspace/notes";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/notes");
        return false;
      },
    },
    vscode,
  });

  const workspaceDocuments = await provider.workspaceDocuments();
  const diagnostics = provider.provideDiagnostics(specDocument, workspaceDocuments);

  assert.deepEqual(diagnostics, []);
});

test("GaugeStepDiagnosticsProvider uses unopened plaintext Kotlin files for Gauge undefined steps", async () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const specDocument = createDocument([
    "# Checkout",
    "## Scenario",
    "* Pay with \"card\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const openedKotlinDocument = createDocument([
    "@Step(\"Confirm order\")",
    "fun confirm() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/ConfirmSteps.kt");
  const plaintextKotlinDocument = createDocument([
    "@Step(\"Pay with <method>\")",
    "fun pay(method: String) {}",
  ].join("\n"), "plaintext", "/workspace/gauge/src/test/kotlin/PaymentSteps.kt");
  const vscode = {
    ...createFakeVscode(),
    workspace: {
      textDocuments: [specDocument, openedKotlinDocument],
      async findFiles(pattern) {
        if (pattern === "**/*.kt") {
          return [plaintextKotlinDocument.uri];
        }
        if (pattern === "**/*.java") {
          return [];
        }
        if (pattern === "**/*.cpt") {
          return [];
        }
        throw new Error(`Unexpected pattern ${pattern}`);
      },
      async openTextDocument(uri) {
        assert.equal(uri, plaintextKotlinDocument.uri);
        return plaintextKotlinDocument;
      },
    },
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const workspaceDocuments = await provider.workspaceDocuments();
  const diagnostics = provider.provideDiagnostics(specDocument, workspaceDocuments);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [],
  );
});

test("GaugeStepDiagnosticsProvider uses unopened Java Step files for Gauge undefined steps", async () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const specDocument = createDocument([
    "# Checkout",
    "## Scenario",
    "* Pay with \"card\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const javaDocument = createDocument([
    "package steps;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "",
    "public class PaymentSteps {",
    "  @Step(\"Pay with <method>\")",
    "  public void pay(String method) {",
    "  }",
    "}",
  ].join("\n"), "plaintext", "/workspace/gauge/src/test/java/steps/PaymentSteps.java");
  const vscode = {
    ...createFakeVscode(),
    workspace: {
      textDocuments: [specDocument],
      async findFiles(pattern) {
        if (pattern === "**/*.kt" || pattern === "**/*.cpt") {
          return [];
        }
        if (pattern === "**/*.java") {
          return [javaDocument.uri];
        }
        throw new Error(`Unexpected pattern ${pattern}`);
      },
      async openTextDocument(uri) {
        assert.equal(uri, javaDocument.uri);
        return javaDocument;
      },
    },
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  const workspaceDocuments = await provider.workspaceDocuments();
  const diagnostics = provider.provideDiagnostics(specDocument, workspaceDocuments);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [],
  );
});

test("GaugeStepDiagnosticsProvider uses Java constants in Java Step annotations", async () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const specDocument = createDocument([
    "# Checkout",
    "## Scenario",
    "* Pay with \"card\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const constantsDocument = createDocument([
    "package fixtures.steps;",
    "",
    "public final class JavaStepText {",
    "  public static final String PAYMENT = \"Pay with <method>\";",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/steps/JavaStepText.java");
  const stepDocument = createDocument([
    "package fixtures.impl;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "import fixtures.steps.JavaStepText;",
    "",
    "public class PaymentSteps {",
    "  @Step(JavaStepText.PAYMENT)",
    "  public void pay(String method) {",
    "  }",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/impl/PaymentSteps.java");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });

  const diagnostics = provider.provideDiagnostics(specDocument, [
    specDocument,
    constantsDocument,
    stepDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [],
  );
});

test("GaugeStepDiagnosticsProvider decodes Java unicode and octal escapes in Step annotations", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const specDocument = createDocument([
    "# Checkout",
    "## Scenario",
    "* Pay with \"card\"",
    "* Ship with \"ground\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const stepDocument = createDocument([
    "package fixtures.impl;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "",
    "public class PaymentSteps {",
    "  @Step(\"Pay \\u0077ith <method>\")",
    "  public void pay(String method) {",
    "  }",
    "",
    "  @Step(\"Ship \\167ith <method>\")",
    "  public void ship(String method) {",
    "  }",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/impl/PaymentSteps.java");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });

  const diagnostics = provider.provideDiagnostics(specDocument, [
    specDocument,
    stepDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [],
  );
});

test("GaugeStepDiagnosticsProvider reports Java constant Step parameter mismatches", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "package fixtures.steps;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "",
    "public class PaymentSteps {",
    "  public static final String PAYMENT = \"Pay with <method>\";",
    "",
    "  @Step(PAYMENT)",
    "  public void pay() {",
    "  }",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/steps/PaymentSteps.java");

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Pay with <method>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider uses Java constants in Kotlin Step annotations", async () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const specDocument = createDocument([
    "# Checkout",
    "## Scenario",
    "* Pay with \"card\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const constantsDocument = createDocument([
    "package fixtures.steps;",
    "",
    "public final class JavaStepText {",
    "  public static final String PAYMENT = \"Pay with <method>\";",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/steps/JavaStepText.java");
  const stepDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.steps.JavaStepText",
    "",
    "class PaymentSteps {",
    "  @Step(JavaStepText.PAYMENT)",
    "  fun pay(method: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/PaymentSteps.kt");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });

  const diagnostics = provider.provideDiagnostics(specDocument, [
    specDocument,
    constantsDocument,
    stepDocument,
  ]);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [],
  );
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
  const changedDocument = createDocument("@Step(\"A <value>\")\nfun a(value: String) {}");
  vscode.workspace.textDocuments = [changedDocument];
  changed[0]({ document: changedDocument });
  vscode.workspace.textDocuments = [];
  closed[0](changedDocument);
  disposable.dispose();

  assert.equal(sets[0].diagnostics.length, 1);
  assert.deepEqual(sets[1].diagnostics, []);
  assert.deepEqual(deletes, [document.uri]);
  assert.deepEqual(disposals, ["gauge-kotlin", "open", "change", "close"]);
});

test("GaugeStepDiagnosticsProvider resolves unopened workspace Kotlin constants during refresh", async () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const sets = [];
  const stepDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt");
  const constantsDocument = createDocument([
    "package steps",
    "",
    "const val LOGIN_STEP = \"Log in as <user>\"",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/StepText.kt");
  const vscode = {
    ...createFakeVscode(),
    workspace: {
      textDocuments: [stepDocument],
      async findFiles(pattern) {
        if (pattern === "**/*.cpt") {
          return [];
        }
        if (pattern === "**/*.java") {
          return [];
        }
        assert.equal(pattern, "**/*.kt");
        return [constantsDocument.uri];
      },
      async openTextDocument(uri) {
        assert.equal(uri, constantsDocument.uri);
        return constantsDocument;
      },
    },
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });

  await provider.refreshDocuments({
    set(uri, diagnostics) {
      sets.push({ uri, diagnostics });
    },
  });

  assert.equal(sets.length, 1);
  assert.equal(sets[0].uri, stepDocument.uri);
  assert.deepEqual(
    sets[0].diagnostics.map((diagnostic) => diagnostic.message),
    [
      "Parameter count mismatch(found [0] expected [1]) with step annotation : \"Log in as <user>\". ",
    ],
  );
});

test("GaugeStepDiagnosticsProvider reuses an in-flight workspace scan during refresh", async () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const stepDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(LOGIN_STEP)",
    "fun login() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt");
  const constantsDocument = createDocument([
    "package steps",
    "",
    "const val LOGIN_STEP = \"Log in as <user>\"",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/StepText.kt");
  let findFilesCalls = 0;
  let finishFindFiles;
  const firstFindFiles = new Promise((resolve) => {
    finishFindFiles = resolve;
  });
  const vscode = {
    ...createFakeVscode(),
    workspace: {
      textDocuments: [stepDocument],
      async findFiles(pattern) {
        findFilesCalls += 1;
        if (pattern === "**/*.kt") {
          await firstFindFiles;
          return [constantsDocument.uri];
        }
        return [];
      },
      async openTextDocument(uri) {
        assert.equal(uri, constantsDocument.uri);
        return constantsDocument;
      },
    },
  };
  const provider = new GaugeStepDiagnosticsProvider({ vscode });
  const collection = { set() {} };

  const firstRefresh = provider.refreshDocuments(collection);
  const secondRefresh = provider.refreshDocuments(collection);
  await Promise.resolve();

  assert.equal(findFilesCalls, 1);

  finishFindFiles();
  await Promise.all([firstRefresh, secondRefresh]);
});
