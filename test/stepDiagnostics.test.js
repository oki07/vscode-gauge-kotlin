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

  assert.deepEqual(provider.provideDiagnostics(localClassDocument), []);
  assert.deepEqual(provider.provideDiagnostics(localObjectDocument), []);
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
