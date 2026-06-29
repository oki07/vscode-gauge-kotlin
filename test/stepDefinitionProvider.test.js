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

test("GaugeStepDefinitionProvider resolves Markdown Gauge spec steps to Kotlin Step functions", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Login specification",
    "",
    "* Log in as \"alice\"",
  ].join("\n"), "markdown", "/workspace/gauge/specs/login.md");
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

  const definitions = await provider.provideDefinition(specDocument, { line: 2, character: 5 });

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

test("GaugeStepDefinitionProvider resolves static and dynamic argument spec steps", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Display specification",
    "",
    "## Shows a value",
    "* Text \"hello\" is visible",
    "* Text <message> is visible",
  ].join("\n"), "gauge", "/workspace/gauge/specs/display.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class DisplaySteps {",
    "  @Step(\"Text <value> is visible\")",
    "  fun visible(value: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/DisplaySteps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const staticDefinitions = await provider.provideDefinition(specDocument, { line: 3, character: 8 });
  const dynamicDefinitions = await provider.provideDefinition(specDocument, { line: 4, character: 8 });

  assert.equal(staticDefinitions.length, 1);
  assert.equal(staticDefinitions[0].uri, kotlinDocument.uri);
  assert.equal(dynamicDefinitions.length, 1);
  assert.equal(dynamicDefinitions[0].uri, kotlinDocument.uri);
});

test("GaugeStepDefinitionProvider resolves docstring steps without annotation placeholder", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Execution specification",
    "",
    "## Runs content",
    "* Execute the following content",
    "\"\"\"",
    "payload",
    "\"\"\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/execution.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class ExecutionSteps {",
    "  @Step(\"Execute the following content\")",
    "  fun execute(content: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/ExecutionSteps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });
  const contentDefinitions = await provider.provideDefinition(specDocument, { line: 5, character: 1 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
  assert.equal(contentDefinitions.length, 1);
  assert.equal(contentDefinitions[0].uri, kotlinDocument.uri);
});

test("GaugeStepDefinitionProvider resolves adjacent quoted spec arguments", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Display specification",
    "",
    "## Shows a value",
    "* Text\"hello\"is visible",
  ].join("\n"), "gauge", "/workspace/gauge/specs/display.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class DisplaySteps {",
    "  @Step(\"Text<value>is visible\")",
    "  fun visible(value: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/DisplaySteps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 8 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
});

test("GaugeStepDefinitionProvider resolves spec steps to concept headings", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Checkout",
    "",
    "## Reuses a concept",
    "* Pay with \"card\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const conceptDocument = createDocument([
    "# Pay with <method>",
    "* Enter payment method <method>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/concepts/payment.cpt");
  const vscode = createFakeVscode([specDocument, conceptDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, conceptDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 0, character: 2 },
  );
  assert.deepEqual(
    { ...definitions[0].range.end },
    { line: 0, character: 19 },
  );
});

test("GaugeStepDefinitionProvider matches steps across NFC/NFD unicode normalization", async () => {
  // macOS commonly stores text decomposed (NFD). A spec saved as NFD and a
  // Kotlin @Step saved as NFC render identically but are not byte-equal, so a
  // strict comparison fails for any step containing combining marks. Steps with
  // no combining marks match either way, which is why only some steps appeared
  // broken. This is script-agnostic: "e" + combining acute (U+0301, NFD) versus
  // the precomposed e-acute (U+00E9, NFC) stands in for a Japanese dakuten.
  // \u escapes keep this source ASCII while the runtime strings differ in form.
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Display",
    "## Scenario",
    "* show \"hi\" in cafe\u0301", // NFD: e + combining acute
  ].join("\n"), "gauge", "/workspace/gauge/specs/display.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "import com.thoughtworks.gauge.Step",
    "class DisplaySteps {",
    "  @Step(\"show <text> in caf\u00e9\")", // NFC: precomposed e-acute
    "  fun shown(text: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/DisplaySteps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 2, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
});

test("GaugeStepDefinitionProvider resolves argument steps on Unicode Kotlin function names", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Display",
    "",
    "## Shows a value",
    "* Text \"hello\" is visible",
  ].join("\n"), "gauge", "/workspace/gauge/specs/display.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class DisplaySteps {",
    "  @Step(\"Text <value> is visible\")",
    "  fun \u8868\u793a\u3059\u308b(value: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/DisplaySteps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 8 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
});

test("GaugeStepDefinitionProvider resolves docstring steps through Unicode Kotlin constants", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Execution specification",
    "",
    "## Runs content",
    "* Execute the following content",
    "\"\"\"",
    "payload",
    "\"\"\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/execution.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "const val \u5b9f\u884c_STEP = \"Execute the following content\"",
    "",
    "class ExecutionSteps {",
    "  @Step(\u5b9f\u884c_STEP)",
    "  fun execute(content: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/ExecutionSteps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 5, character: 1 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
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

test("GaugeStepDefinitionProvider does not write definition trace output", async () => {
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
  const outputChannelNames = [];
  const vscode = createFakeVscode([conceptDocument], {
    findFiles: async () => [kotlinDocument.uri],
    openTextDocument: async () => kotlinDocument,
  });
  vscode.window = {
    createOutputChannel(name) {
      outputChannelNames.push(name);
      return {
        appendLine() {},
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
  assert.deepEqual(outputChannelNames, []);
});

test("GaugeStepDefinitionProvider resolves steps when workspace exposes a throwing proposed-API getter", async () => {
  // Real VS Code / Cursor expose proposed-API getters (e.g. workspace.tunnels)
  // that throw when accessed by an extension that did not declare the proposal.
  // Spreading `vscode.workspace` enumerates and invokes those getters, which
  // previously aborted the whole definition lookup.
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
  Object.defineProperty(vscode.workspace, "tunnels", {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error("Extension 'gauge-kotlin' CANNOT use API proposal: tunnels.");
    },
  });
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(conceptDocument, { line: 1, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
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

test("GaugeStepDefinitionProvider resolves unopened workspace Java Step functions", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Login specification",
    "",
    "## Successful login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const javaDocument = createDocument([
    "package steps;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "",
    "public class LoginSteps {",
    "  @Step(\"Log in as <user>\")",
    "  public void login(String user) {",
    "  }",
    "}",
  ].join("\n"), "plaintext", "/workspace/gauge/src/test/java/steps/LoginSteps.java");
  const vscode = createFakeVscode([specDocument], {
    async findFiles(pattern) {
      if (pattern === "**/*.kt") {
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
  });
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, javaDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 6, character: 14 },
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
