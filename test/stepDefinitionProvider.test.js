const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode(textDocuments) {
  return {
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
    workspace: {
      textDocuments,
    },
  };
}

function createDocument(text, languageId, fsPath) {
  const lines = text.split(/\r?\n/);
  return {
    languageId,
    uri: { fsPath },
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] || "" };
    },
  };
}

function createProjectFactory() {
  return {
    getGaugeRootFromFilePath(filename) {
      if (!filename.startsWith("/workspace/gauge/")) {
        throw new Error("not a Gauge project file");
      }
      return "/workspace/gauge";
    },
  };
}

test("GaugeStepDefinitionProvider resolves spec steps to Kotlin Step functions", () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Login specification",
    "",
    "## Successful login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class LoginSteps {",
    "  @Step(\"Log in as <user>\")",
    "  fun login(user: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 6, character: 2 },
  );
  assert.deepEqual(
    { ...definitions[0].range.end },
    { line: 6, character: 26 },
  );
});

test("GaugeStepDefinitionProvider uses workspace Kotlin constants when matching steps", () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Login specification",
    "",
    "## Successful login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const constantsDocument = createDocument([
    "package steps",
    "",
    "object StepText {",
    "  const val LOGIN = \"Log in as <user>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/StepText.kt");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "import steps.StepText.LOGIN",
    "",
    "class LoginSteps {",
    "  @Step(LOGIN)",
    "  fun login(user: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt");
  const vscode = createFakeVscode([specDocument, constantsDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 7, character: 2 },
  );
});

test("GaugeStepDefinitionProvider ignores non-step positions", () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Login specification",
    "",
    "## Successful login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  assert.deepEqual(
    provider.provideDefinition(specDocument, { line: 0, character: 2 }),
    [],
  );
});
