const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode(textDocuments, options = {}) {
  const workspace = {
    textDocuments,
  };
  if (options.findFiles) {
    workspace.findFiles = options.findFiles;
  }
  if (options.openTextDocument) {
    workspace.openTextDocument = options.openTextDocument;
  }
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
    workspace,
  };
}

function createDocument(text, languageId, fsPath) {
  const lines = text.split(/\r?\n/);
  return {
    languageId,
    lineCount: lines.length,
    uri: { fsPath },
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] || "" };
    },
  };
}

function createStrictDocument(text, languageId, fsPath) {
  const document = createDocument(text, languageId, fsPath);
  const lines = text.split(/\r?\n/);
  document.lineAt = (line) => {
    if (line < 0 || line >= lines.length) {
      throw new RangeError("line out of range");
    }
    return { text: lines[line] };
  };
  return document;
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

test("GaugeStepDefinitionProvider resolves spec steps to Kotlin Step functions", async () => {
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

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

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

test("GaugeStepDefinitionProvider resolves concept steps to Kotlin Step functions", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const conceptDocument = createDocument([
    "# Shared login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/concepts/shared.cpt");
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
  const vscode = createFakeVscode([conceptDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(conceptDocument, { line: 1, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 6, character: 2 },
  );
});

test("GaugeStepDefinitionProvider resolves concept steps when Kotlin files open as plaintext", async () => {
  // VS Code ships no Kotlin language. Without a separate Kotlin extension the
  // workspace .kt files open with languageId "plaintext", which previously hid
  // every step implementation from navigation. The provider discovers the files
  // via a `**/*.kt` search, so it must key off the extension, not languageId.
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const conceptDocument = createDocument([
    "# Shared login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/concepts/shared.cpt");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class LoginSteps {",
    "  @Step(\"Log in as <user>\")",
    "  fun login(user: String) {}",
    "}",
  ].join("\n"), "plaintext", "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt");
  const vscode = createFakeVscode([conceptDocument], {
    findFiles: async () => [kotlinDocument.uri],
    openTextDocument: async (uri) => {
      if (uri === kotlinDocument.uri) {
        return kotlinDocument;
      }
      throw new Error(`unexpected uri ${uri && uri.fsPath}`);
    },
  });
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(conceptDocument, { line: 1, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 6, character: 2 },
  );
});

test("GaugeStepDefinitionProvider writes a measured trace to the output channel", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const conceptDocument = createDocument([
    "# Shared login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/concepts/shared.cpt");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class LoginSteps {",
    "  @Step(\"Log in as <user>\")",
    "  fun login(user: String) {}",
    "}",
  ].join("\n"), "plaintext", "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt");
  const appended = [];
  const vscode = createFakeVscode([conceptDocument], {
    findFiles: async () => [kotlinDocument.uri],
    openTextDocument: async () => kotlinDocument,
  });
  vscode.window = {
    createOutputChannel() {
      return {
        appendLine(message) {
          appended.push(message);
        },
        show() {},
        clear() {},
      };
    },
  };
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(conceptDocument, { line: 1, character: 5 });

  assert.equal(definitions.length, 1);
  assert.ok(appended.some((line) => line.includes("provideDefinition called")));
  assert.ok(appended.some((line) => line.includes("languageId=gauge")));
  assert.ok(appended.some((line) => line.includes("wantedStep=\"Log in as {}\"")));
  assert.ok(appended.some((line) => line.includes("findFiles(\"**/*.kt\") returned 1")));
  assert.ok(appended.some((line) => line.includes("@Step functions=1 matched=1")));
  assert.ok(appended.some((line) => line.includes("1 definition(s) from project group")));
});

test("GaugeStepDefinitionProvider falls back to external workspace Kotlin Step functions", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const conceptDocument = createDocument([
    "# Shared login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/concepts/shared.cpt");
  const externalKotlinDocument = createDocument([
    "package external.steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class ExternalLoginSteps {",
    "  @Step(\"Log in as <user>\")",
    "  fun login(user: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/shared-steps/src/test/kotlin/ExternalLoginSteps.kt");
  const vscode = createFakeVscode([conceptDocument, externalKotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(conceptDocument, { line: 1, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, externalKotlinDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 6, character: 2 },
  );
});

test("GaugeStepDefinitionProvider prefers Gauge project Kotlin Step functions over external fallback", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const conceptDocument = createDocument([
    "# Shared login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/concepts/shared.cpt");
  const projectKotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class LoginSteps {",
    "  @Step(\"Log in as <user>\")",
    "  fun login(user: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt");
  const externalKotlinDocument = createDocument([
    "package external.steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class ExternalLoginSteps {",
    "  @Step(\"Log in as <user>\")",
    "  fun login(user: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/shared-steps/src/test/kotlin/ExternalLoginSteps.kt");
  const vscode = createFakeVscode([conceptDocument, externalKotlinDocument, projectKotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(conceptDocument, { line: 1, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, projectKotlinDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 6, character: 2 },
  );
});

test("GaugeStepDefinitionProvider resolves unopened workspace Kotlin Step functions", async () => {
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
  const vscode = createFakeVscode([specDocument], {
    async findFiles(pattern) {
      assert.equal(pattern, "**/*.kt");
      return [kotlinDocument.uri];
    },
    async openTextDocument(uri) {
      assert.equal(uri, kotlinDocument.uri);
      return kotlinDocument;
    },
  });
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 6, character: 2 },
  );
});

test("GaugeStepDefinitionProvider keeps open Kotlin definitions when workspace search fails", async () => {
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
  const vscode = createFakeVscode([specDocument, kotlinDocument], {
    async findFiles(pattern) {
      assert.equal(pattern, "**/*.kt");
      throw new Error("workspace search failed");
    },
    async openTextDocument() {
      throw new Error("openTextDocument should not run after a search failure");
    },
  });
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 6, character: 2 },
  );
});

test("GaugeStepDefinitionProvider resolves final-line spec steps", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createStrictDocument([
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

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
});

test("GaugeStepDefinitionProvider uses workspace Kotlin constants when matching steps", async () => {
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

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 7, character: 2 },
  );
});

test("GaugeStepDefinitionProvider uses package wildcard top-level Kotlin constants", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Login specification",
    "",
    "## Successful login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const constantsDocument = createDocument([
    "package fixtures.steps",
    "",
    "const val LOGIN_STEP = \"Log in as <user>\"",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/steps/StepText.kt");
  const kotlinDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.steps.*",
    "",
    "@Step(LOGIN_STEP)",
    "fun login(user: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/fixtures/impl/LoginSteps.kt");
  const vscode = createFakeVscode([specDocument, constantsDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 6, character: 0 },
  );
});

test("GaugeStepDefinitionProvider resolves grouped and accessor Kotlin Step annotations", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const cases = [
    {
      expectedStart: { line: 6, character: 2 },
      kotlinLines: [
        "package steps",
        "",
        "import com.thoughtworks.gauge.Step",
        "",
        "class LoginSteps {",
        "  @[Step(\"Grouped login as <user>\")]",
        "  fun grouped(user: String) {}",
        "}",
      ],
      step: "Grouped login as \"alice\"",
    },
    {
      expectedStart: { line: 7, character: 4 },
      kotlinLines: [
        "package steps",
        "",
        "import com.thoughtworks.gauge.Step",
        "",
        "class LoginSteps {",
        "  val getterStep: String",
        "    @[Step(\"Getter login as <user>\")]",
        "    get() = \"\"",
        "}",
      ],
      step: "Getter login as \"alice\"",
    },
    {
      expectedStart: { line: 7, character: 4 },
      kotlinLines: [
        "package steps",
        "",
        "import com.thoughtworks.gauge.Step",
        "",
        "class LoginSteps {",
        "  var setterStep: String = \"\"",
        "    @[Step(\"Setter login as <user>\")]",
        "    set(value) { field = value }",
        "}",
      ],
      step: "Setter login as \"alice\"",
    },
  ];

  for (const entry of cases) {
    const specDocument = createDocument([
      "# Login specification",
      "",
      "## Successful login",
      `* ${entry.step}`,
    ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
    const kotlinDocument = createDocument(
      entry.kotlinLines.join("\n"),
      "kotlin",
      "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt",
    );
    const vscode = createFakeVscode([specDocument, kotlinDocument]);
    const provider = new GaugeStepDefinitionProvider({
      projectFactory: createProjectFactory(),
      vscode,
    });

    const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

    assert.equal(definitions.length, 1);
    assert.equal(definitions[0].uri, kotlinDocument.uri);
    assert.deepEqual(
      { ...definitions[0].range.start },
      entry.expectedStart,
    );
  }
});

test("GaugeStepDefinitionProvider ignores non-step positions", async () => {
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
    await provider.provideDefinition(specDocument, { line: 0, character: 2 }),
    [],
  );
});
