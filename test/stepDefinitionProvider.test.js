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

function createRegistrationVscode() {
  const registration = {};
  return {
    languages: {
      registerDefinitionProvider(selector, provider) {
        registration.selector = selector;
        registration.provider = provider;
        return { dispose() {} };
      },
    },
    registration,
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

test("GaugeStepDefinitionProvider does not resolve Kotlin step definitions from another Gauge project", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Login specification",
    "",
    "## Successful login",
    "* Shared login",
  ].join("\n"), "gauge", "/workspace/project-a/specs/login.spec");
  const otherProjectKotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class LoginSteps {",
    "  @Step(\"Shared login\")",
    "  fun login() {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/project-b/src/test/kotlin/steps/LoginSteps.kt");
  const vscode = createFakeVscode([specDocument, otherProjectKotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createMultiProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.deepEqual(definitions, []);
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

test("GaugeStepDefinitionProvider resolves spec files by extension to Kotlin Step functions", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Login specification",
    "",
    "* Log in as \"alice\"",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/login.spec");
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

test("GaugeStepDefinitionProvider resolves table steps without closing pipes", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Compare",
    "* Compare",
    "  | name",
  ].join("\n"), "gauge", "/workspace/gauge/specs/compare.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class CompareSteps {",
    "  @Step(\"Compare <table>\")",
    "  fun compare(table: Any) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/CompareSteps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 1, character: 4 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
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

test("GaugeStepDefinitionProvider resolves multiline Gauge steps when project allows them", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const originalAllowMultiline = process.env.allow_multiline_step;
  delete process.env.allow_multiline_step;
  const specDocument = createDocument([
    "# Payment specification",
    "",
    "## Pays with card",
    "* Pay with",
    "card",
  ].join("\n"), "gauge", "/workspace/gauge/specs/payment.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class PaymentSteps {",
    "  @Step(\"Pay with card\")",
    "  fun pay() {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/PaymentSteps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    fileSystem: {
      readFileSync(filename, encoding) {
        assert.equal(filename, "/workspace/gauge/env/default/default.properties");
        assert.equal(encoding, "utf8");
        return "allow_multiline_step = true\n";
      },
    },
    projectFactory: createProjectFactory(),
    vscode,
  });

  try {
    const firstLineDefinitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });
    const continuationDefinitions = await provider.provideDefinition(specDocument, { line: 4, character: 1 });

    assert.equal(firstLineDefinitions.length, 1);
    assert.equal(firstLineDefinitions[0].uri, kotlinDocument.uri);
    assert.equal(continuationDefinitions.length, 1);
    assert.equal(continuationDefinitions[0].uri, kotlinDocument.uri);
  } finally {
    if (originalAllowMultiline === undefined) {
      delete process.env.allow_multiline_step;
    } else {
      process.env.allow_multiline_step = originalAllowMultiline;
    }
  }
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

test("GaugeStepDefinitionProvider resolves spec steps to indented hash concept headings", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Checkout",
    "",
    "## Reuses a concept",
    "* Pay with \"card\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const conceptDocument = createDocument([
    "  # Pay with <method>",
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
    { line: 0, character: 4 },
  );
  assert.deepEqual(
    { ...definitions[0].range.end },
    { line: 0, character: 21 },
  );
});

test("GaugeStepDefinitionProvider prefers concept headings over Step functions", async () => {
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
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class PaymentSteps {",
    "  @Step(\"Pay with <method>\")",
    "  fun pay(method: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/PaymentSteps.kt");
  const vscode = createFakeVscode([specDocument, conceptDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, conceptDocument.uri);
});

test("GaugeStepDefinitionProvider resolves indented legacy concept headings", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Checkout",
    "",
    "## Reuses a concept",
    "* Pay with \"card\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const conceptDocument = createDocument([
    "  Pay with <method>",
    "===================",
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

test("GaugeStepDefinitionProvider does not resolve concept definitions from another Gauge project", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Checkout",
    "",
    "## Reuses a concept",
    "* Pay with \"card\"",
  ].join("\n"), "gauge", "/workspace/project-a/specs/checkout.spec");
  const otherProjectConceptDocument = createDocument([
    "# Pay with <method>",
    "* Enter payment method <method>",
  ].join("\n"), "gauge", "/workspace/project-b/specs/concepts/payment.cpt");
  const vscode = createFakeVscode([specDocument, otherProjectConceptDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createMultiProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.deepEqual(definitions, []);
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
    "  * Log in as \"alice\"",
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

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 7 });

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

test("GaugeStepDefinitionProvider resolves Java Step methods using imported Java constants", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Login specification",
    "",
    "## Successful login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const constantsDocument = createDocument([
    "package fixtures.steps;",
    "",
    "public final class JavaStepText {",
    "  public static final String LOGIN = \"Log in as <user>\";",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/steps/JavaStepText.java");
  const javaDocument = createDocument([
    "package fixtures.impl;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "import fixtures.steps.JavaStepText;",
    "",
    "public class LoginSteps {",
    "  @Step(JavaStepText.LOGIN)",
    "  public void login(String user) {",
    "  }",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/impl/LoginSteps.java");
  const vscode = createFakeVscode([specDocument, constantsDocument, javaDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, javaDocument.uri);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 7, character: 14 },
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

test("GaugeStepDefinitionProvider uses imported Java constants in Kotlin Step annotations", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Login specification",
    "",
    "## Successful login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const constantsDocument = createDocument([
    "package fixtures.steps;",
    "",
    "public final class JavaStepText {",
    "  public static final String LOGIN = \"Log in as <user>\";",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/steps/JavaStepText.java");
  const kotlinDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.steps.JavaStepText",
    "",
    "class LoginSteps {",
    "  @Step(JavaStepText.LOGIN)",
    "  fun login(user: String) {}",
    "}",
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
    { line: 7, character: 2 },
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

test("GaugeStepDefinitionProvider skips unopened Step sources resolved to non-Gauge projects", async () => {
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
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt");
  const outsideUri = {
    fsPath: "/workspace/notes/src/test/kotlin/OtherSteps.kt",
  };
  const openedFiles = [];
  const vscode = createFakeVscode([specDocument, kotlinDocument], {
    findFiles(pattern) {
      return pattern === "**/*.kt" ? Promise.resolve([outsideUri]) : Promise.resolve([]);
    },
    openTextDocument(uri) {
      openedFiles.push(uri.fsPath);
      return Promise.resolve(createDocument([
        "package notes",
        "",
        "import com.thoughtworks.gauge.Step",
        "",
        "@Step(\"Other <value>\")",
        "fun other(value: String) {}",
      ].join("\n"), "kotlin", uri.fsPath));
    },
  });
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        if (filename.startsWith("/workspace/gauge/")) {
          return "/workspace/gauge";
        }
        if (filename.startsWith("/workspace/notes/")) {
          return "/workspace/notes";
        }
        throw new Error("not a Gauge project file");
      },
      isGaugeProject(root) {
        return root === "/workspace/gauge";
      },
    },
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
  assert.deepEqual(openedFiles, []);
});

test("GaugeStepDefinitionProvider ignores headings and resolves double-star step positions", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Login specification",
    "",
    "## Successful login",
    "* Log in as \"alice\"",
    "** Bold comment",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
    "",
    "@Step(\"* Bold comment\")",
    "fun bold() {}",
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
  const doubleStarDefinitions = await provider.provideDefinition(specDocument, { line: 4, character: 3 });
  assert.equal(doubleStarDefinitions.length, 1);
  assert.equal(doubleStarDefinitions[0].uri, kotlinDocument.uri);
});

test("GaugeStepDefinitionProvider registers concept definition selectors", () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const vscode = createRegistrationVscode();
  const provider = new GaugeStepDefinitionProvider({ vscode });

  provider.register();

  assert.deepEqual(vscode.registration.selector, [
    { language: "gauge" },
    { language: "gauge-concept" },
    { scheme: "file", pattern: "**/*.spec" },
    { scheme: "file", pattern: "**/*.cpt" },
    { language: "markdown", scheme: "file", pattern: "**/*.md" },
  ]);
  assert.equal(vscode.registration.provider, provider);
});
