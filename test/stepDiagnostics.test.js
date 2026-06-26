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

test("GaugeStepDiagnosticsProvider ignores comments inside Kotlin Step function parameters", () => {
  const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
  const provider = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode() });
  const document = createDocument([
    "@Step(\"No params\")",
    "fun commented(/* no parameters */) {}",
  ].join("\n"));

  assert.deepEqual(provider.provideDiagnostics(document), []);
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
