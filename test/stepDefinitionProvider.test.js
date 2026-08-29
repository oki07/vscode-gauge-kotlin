const assert = require("node:assert/strict");
const test = require("node:test");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((receivedResolve, receivedReject) => {
    resolve = receivedResolve;
    reject = receivedReject;
  });
  return { promise, reject, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createCancellation() {
  let cancellationRequested = false;
  let listenerDisposals = 0;
  let registrations = 0;
  const listeners = new Set();
  const token = {
    get isCancellationRequested() {
      return cancellationRequested;
    },
    onCancellationRequested(listener) {
      registrations += 1;
      listeners.add(listener);
      let disposed = false;
      return {
        dispose() {
          if (disposed) {
            return;
          }
          disposed = true;
          listenerDisposals += 1;
          listeners.delete(listener);
        },
      };
    },
  };
  return {
    cancel() {
      if (cancellationRequested) {
        return;
      }
      cancellationRequested = true;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    listenerCount() {
      return listeners.size;
    },
    listenerDisposals() {
      return listenerDisposals;
    },
    registrations() {
      return registrations;
    },
    token,
  };
}

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
  const registration = {
    disposeCalls: 0,
    registerCalls: 0,
  };
  return {
    languages: {
      registerDefinitionProvider(selector, provider) {
        registration.registerCalls += 1;
        registration.selector = selector;
        registration.provider = provider;
        return {
          dispose() {
            registration.disposeCalls += 1;
          },
        };
      },
    },
    registration,
  };
}

// The inline table follows the step's LAST line. hasInlineTableAfterStep was
// asked from the FIRST line, where the next non-blank line is a continuation, so
// a multi-line step with a table never got the <table> suffix: diagnostics and
// CodeLens reported it implemented (stepDiagnostics advances to the end line
// before the same check) while F12 answered nothing. The real parser sides with
// diagnostics: with allow_multiline_step the table is that step's argument.
test("stepTextAt appends the table of a multi-line step", () => {
  const { stepTextAt } = require("../src/stepDefinitionProvider");
  const lines = [
    "# Checkout",
    "## Buy",
    "* Pay the total amount",
    "  for the customer",
    "| a | b |",
    "| 1 | 2 |",
  ];
  const document = {
    languageId: "gauge",
    uri: { fsPath: "/workspace/gauge/specs/checkout.spec" },
    get lineCount() {
      return lines.length;
    },
    lineAt(line) {
      return { text: lines[line] };
    },
    getText() {
      return lines.join("\n");
    },
  };

  assert.equal(
    stepTextAt(document, { line: 2 }, { allowMultilineStep: true }),
    "Pay the total amount for the customer {}",
  );
  assert.equal(
    stepTextAt(document, { line: 3 }, { allowMultilineStep: true }),
    "Pay the total amount for the customer {}",
  );
});

// references/gauge/parser/lex.go isTableRow requires a closing "|" as well as an
// opening one, so "|name" is a comment and no table attaches to the step.
// Accepting it gave the step a "{}" argument it does not have, so F12 and the
// implemented/unimplemented verdict were both answered for the wrong step value.
// Probed: with the closing pipe the row warns "Treating it as static param",
// without it the parser reports nothing at all.
test("stepTextAt ignores a pipe line with no closing pipe", () => {
  const { stepTextAt } = require("../src/stepDefinitionProvider");
  const lines = [
    "# Checkout",
    "## Buy",
    "* Pay the total amount",
    "|a",
    "|1",
  ];
  const document = {
    languageId: "gauge",
    uri: { fsPath: "/workspace/gauge/specs/checkout.spec" },
    get lineCount() {
      return lines.length;
    },
    lineAt(line) {
      return { text: lines[line] };
    },
    getText() {
      return lines.join("\n");
    },
  };

  assert.equal(stepTextAt(document, { line: 2 }), "Pay the total amount");
});

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

test("GaugeStepDefinitionProvider uses the shared workspace step index", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Login specification",
    "",
    "## Successful login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const kotlinDocument = createDocument([
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/LoginSteps.kt");
  const calls = [];
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode: createFakeVscode([specDocument, kotlinDocument]),
    workspaceStepIndex: {
      definitionEntries(sourceDocument, templates) {
        calls.push({ sourceDocument, templates });
        return [{
          document: kotlinDocument,
          entry: {
            declarationEnd: kotlinDocument.getText().length,
            declarationStart: 0,
          },
          kind: "step",
        }];
      },
    },
  });
  provider.stepImplementationDocumentGroups = () => {
    throw new Error("legacy workspace scan should not run");
  };

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 8 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
  assert.deepEqual(calls, [{
    sourceDocument: specDocument,
    templates: ["Log in as {}"],
  }]);
});

test("GaugeStepDefinitionProvider follows Gauge reserved brace parsing", async () => {
  const { GaugeStepDefinitionProvider, normalizeStepTemplate } = require("../src/stepDefinitionProvider");
  const validSpecDocument = createDocument([
    "# Literal braces",
    "",
    "## Escaped braces",
    "* Step with \\{braces\\}",
  ].join("\n"), "gauge", "/workspace/gauge/specs/escaped.spec");
  const invalidSpecDocument = createDocument([
    "# Literal braces",
    "",
    "## Unescaped braces",
    "* Step with {braces}",
  ].join("\n"), "gauge", "/workspace/gauge/specs/unescaped.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class BraceSteps {",
    "  @Step(\"Step with \\\\{braces\\\\}\")",
    "  fun escaped() {}",
    "",
    "  @Step(\"Step with {braces}\")",
    "  fun unescaped() {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/BraceSteps.kt");
  const vscode = createFakeVscode([validSpecDocument, invalidSpecDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const validDefinitions = await provider.provideDefinition(validSpecDocument, { line: 3, character: 5 });
  const invalidDefinitions = await provider.provideDefinition(invalidSpecDocument, { line: 3, character: 5 });

  assert.equal(normalizeStepTemplate("Step with \\{braces\\}"), "Step with {braces}");
  assert.equal(normalizeStepTemplate("Step with {braces}"), undefined);
  assert.equal(validDefinitions.length, 1);
  assert.deepEqual({ ...validDefinitions[0].range.start }, { line: 6, character: 2 });
  assert.deepEqual(invalidDefinitions, []);
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

// Indentation does not stop the row being the step's table.
test("GaugeStepDefinitionProvider resolves indented table steps", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Compare",
    "* Compare",
    "  | name |",
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

test("GaugeStepDefinitionProvider resolves starred docstring payloads to their owner step", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# Execution specification",
    "",
    "## Runs content",
    "* Execute the following content",
    "\"\"\"",
    "* Literal payload",
    "\"\"\"",
    "* Run next step",
  ].join("\n"), "gauge", "/workspace/gauge/specs/execution.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class ExecutionSteps {",
    "  @Step(\"Execute the following content\")",
    "  fun execute(content: String) {}",
    "",
    "  @Step(\"Literal payload\")",
    "  fun literalPayload() {}",
    "",
    "  @Step(\"Run next step\")",
    "  fun runNextStep() {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/ExecutionSteps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });
  const contentDefinitions = await provider.provideDefinition(specDocument, { line: 5, character: 5 });
  const followingDefinitions = await provider.provideDefinition(specDocument, { line: 7, character: 5 });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri, kotlinDocument.uri);
  assert.equal(definitions[0].range.start.line, 6);
  assert.equal(contentDefinitions.length, 1);
  assert.equal(contentDefinitions[0].uri, kotlinDocument.uri);
  assert.equal(contentDefinitions[0].range.start.line, 6);
  assert.equal(followingDefinitions.length, 1);
  assert.equal(followingDefinitions[0].uri, kotlinDocument.uri);
  assert.equal(followingDefinitions[0].range.start.line, 12);
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

test("GaugeStepDefinitionProvider prefers Gauge project Step functions over concept headings", async () => {
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

test("GaugeStepDefinitionProvider resolves dependency Step methods from the library index", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument([
    "# HTTP specification",
    "",
    "## Request",
    "* Send the request",
  ].join("\n"), "gauge", "/workspace/gauge/specs/http.spec");
  const dependencyUri = { scheme: "gauge-dependency", path: "/steps/RequestSteps.class" };
  const dependencyRange = {
    start: { line: 7, character: 2 },
    end: { line: 7, character: 17 },
  };
  const requests = [];
  const dependencyStepIndex = {
    async findDefinitions(projectRoot, normalizedSteps) {
      requests.push({ normalizedSteps, projectRoot });
      return [{ range: dependencyRange, uri: dependencyUri }];
    },
  };
  const vscode = createFakeVscode([specDocument]);
  const provider = new GaugeStepDefinitionProvider({
    dependencyStepIndex,
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });

  assert.deepEqual(requests, [{
    normalizedSteps: ["Send the request"],
    projectRoot: "/workspace/gauge",
  }]);
  assert.deepEqual(definitions, [{
    range: dependencyRange,
    uri: dependencyUri,
  }]);
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

// references/gauge/parser/lex.go isStep rejects a second '*', so "** Bold
// comment" is a comment and has no definition. Verified against the real parser.
test("GaugeStepDefinitionProvider ignores headings and double-star comment lines", async () => {
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
  assert.deepEqual(
    await provider.provideDefinition(specDocument, { line: 4, character: 3 }),
    [],
  );
});

test("GaugeStepDefinitionProvider uses the shared document store without workspace scans", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const specDocument = createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
    "* Log in as \"alice\"",
    "* Pay with \"card\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const kotlinPath = "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt";
  const conceptPath = "/workspace/gauge/specs/concepts/payment.cpt";
  const diskFiles = new Map([
    [kotlinPath, [
      "package steps",
      "",
      "import com.thoughtworks.gauge.Step",
      "",
      "class LoginSteps {",
      "  @Step(\"Log in as <user>\")",
      "  fun login(user: String) {}",
      "}",
    ].join("\n")],
    [conceptPath, [
      "# Pay with <method>",
      "* Enter payment method <method>",
    ].join("\n")],
  ]);
  const findFilesPatterns = [];
  const openedFiles = [];
  const vscode = createFakeVscode([specDocument], {
    async findFiles(pattern) {
      findFilesPatterns.push(pattern);
      return [{ fsPath: kotlinPath }, { fsPath: conceptPath }];
    },
    async openTextDocument(uri) {
      openedFiles.push(uri.fsPath);
      return createDocument(
        diskFiles.get(uri.fsPath) || "",
        uri.fsPath === kotlinPath ? "kotlin" : "gauge",
        uri.fsPath,
      );
    },
  });
  const projectFactory = createProjectFactory();
  const documentStore = new WorkspaceDocumentStore({
    fileSystem: {
      promises: {
        async readFile(file) {
          if (!diskFiles.has(file)) {
            throw new Error(`unexpected read: ${file}`);
          }
          return diskFiles.get(file);
        },
      },
    },
    projectFactory,
    vscode,
  });
  await documentStore.whenReady();
  const provider = new GaugeStepDefinitionProvider({
    documentStore,
    projectFactory,
    vscode,
  });

  const stepDefinitions = await provider.provideDefinition(specDocument, { line: 3, character: 5 });
  const conceptDefinitions = await provider.provideDefinition(specDocument, { line: 4, character: 5 });

  assert.equal(stepDefinitions.length, 1);
  assert.equal(stepDefinitions[0].uri.fsPath, kotlinPath);
  assert.deepEqual(
    { ...stepDefinitions[0].range.start },
    { line: 6, character: 2 },
  );
  assert.deepEqual(
    { ...stepDefinitions[0].range.end },
    { line: 6, character: 26 },
  );
  assert.equal(conceptDefinitions.length, 1);
  assert.equal(conceptDefinitions[0].uri.fsPath, conceptPath);
  assert.deepEqual(
    { ...conceptDefinitions[0].range.start },
    { line: 0, character: 2 },
  );
  assert.deepEqual(
    { ...conceptDefinitions[0].range.end },
    { line: 0, character: 19 },
  );
  assert.equal(
    findFilesPatterns.length,
    1,
    `expected only the store scan, saw findFiles patterns: ${findFilesPatterns.join(", ")}`,
  );
  assert.deepEqual(openedFiles, []);
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

test("GaugeStepDefinitionProvider returns no definitions when host cancellation stops a pending index request", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument(
    "# Send\n\n* Send the request",
    "gauge",
    "/workspace/gauge/specs/send.spec",
  );
  const targetDocument = createDocument(
    "# Send the request\n* Continue",
    "gauge-concept",
    "/workspace/gauge/concepts/send.cpt",
  );

  for (const settlement of ["resolve", "reject"]) {
    const cancellation = createCancellation();
    const indexEntered = deferred();
    const indexGate = deferred();
    let dependencyCalls = 0;
    const provider = new GaugeStepDefinitionProvider({
      dependencyStepIndex: {
        findDefinitions() {
          dependencyCalls += 1;
          return [];
        },
      },
      diagnosticsProvider: {
        isGaugeProjectDocument() {
          return true;
        },
        isGaugeProjectRoot() {
          return true;
        },
      },
      projectFactory: createProjectFactory(),
      vscode: createFakeVscode([specDocument]),
      workspaceStepIndex: {
        definitionEntries() {
          indexEntered.resolve();
          return indexGate.promise;
        },
      },
    });
    let outcome = { status: "pending" };
    const invocation = provider.provideDefinition(
      specDocument,
      { line: 2, character: 5 },
      cancellation.token,
    ).then(
      (value) => {
        outcome = { status: "fulfilled", value };
        return value;
      },
      (reason) => {
        outcome = { reason, status: "rejected" };
        throw reason;
      },
    );

    await indexEntered.promise;
    cancellation.cancel();
    await nextTurn();
    const observedBeforeRelease = outcome;
    if (settlement === "resolve") {
      indexGate.resolve([{
        document: targetDocument,
        heading: {
          end: { line: 0, character: 18 },
          start: { line: 0, character: 2 },
        },
        kind: "concept",
      }]);
    } else {
      indexGate.reject(new Error("late definition index failure"));
    }
    await Promise.allSettled([invocation]);

    assert.deepEqual(observedBeforeRelease, { status: "fulfilled", value: [] });
    assert.deepEqual(outcome, { status: "fulfilled", value: [] });
    assert.equal(dependencyCalls, 0);
    assert.equal(cancellation.registrations(), 1);
    assert.equal(cancellation.listenerDisposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
  }
});

test("GaugeStepDefinitionProvider disposal settles pending dependency requests and owns its registration", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument(
    "# Send\n\n* Send the request",
    "gauge",
    "/workspace/gauge/specs/send.spec",
  );

  for (const settlement of ["resolve", "reject"]) {
    const dependencyEntered = deferred();
    const dependencyGate = deferred();
    const borrowedDisposals = {
      dependency: 0,
      diagnostics: 0,
      index: 0,
      store: 0,
    };
    let dependencyCalls = 0;
    let indexCalls = 0;
    const vscode = createRegistrationVscode();
    const provider = new GaugeStepDefinitionProvider({
      dependencyStepIndex: {
        dispose() {
          borrowedDisposals.dependency += 1;
        },
        findDefinitions() {
          dependencyCalls += 1;
          dependencyEntered.resolve();
          return dependencyGate.promise;
        },
      },
      diagnosticsProvider: {
        dispose() {
          borrowedDisposals.diagnostics += 1;
        },
        isGaugeProjectDocument() {
          return true;
        },
        isGaugeProjectRoot() {
          return true;
        },
      },
      documentStore: {
        dispose() {
          borrowedDisposals.store += 1;
        },
      },
      projectFactory: createProjectFactory(),
      vscode,
      workspaceStepIndex: {
        definitionEntries() {
          indexCalls += 1;
          return [];
        },
        dispose() {
          borrowedDisposals.index += 1;
        },
      },
    });
    const firstRegistration = provider.register();
    const secondRegistration = provider.register();
    let outcome = { status: "pending" };
    const invocation = provider.provideDefinition(
      specDocument,
      { line: 2, character: 5 },
    ).then(
      (value) => {
        outcome = { status: "fulfilled", value };
        return value;
      },
      (reason) => {
        outcome = { reason, status: "rejected" };
        throw reason;
      },
    );

    await dependencyEntered.promise;
    firstRegistration.dispose();
    firstRegistration.dispose();
    await nextTurn();
    const observedBeforeRelease = outcome;
    const retained = vscode.registration.provider.provideDefinition(
      specDocument,
      { line: 2, character: 5 },
    );
    const direct = provider.provideDefinition(specDocument, { line: 2, character: 5 });
    if (settlement === "resolve") {
      dependencyGate.resolve([{ uri: { fsPath: "/dependency/Steps.class" } }]);
    } else {
      dependencyGate.reject(new Error("late dependency definition failure"));
    }
    const outcomes = await Promise.allSettled([invocation, retained, direct]);

    assert.equal(firstRegistration, provider);
    assert.equal(secondRegistration, provider);
    assert.deepEqual(observedBeforeRelease, { status: "fulfilled", value: [] });
    assert.deepEqual(
      outcomes,
      [
        { status: "fulfilled", value: [] },
        { status: "fulfilled", value: [] },
        { status: "fulfilled", value: [] },
      ],
    );
    assert.equal(provider.activeOperations.size, 0);
    assert.equal(vscode.registration.registerCalls, 1);
    assert.equal(vscode.registration.disposeCalls, 1);
    assert.equal(indexCalls, 1);
    assert.equal(dependencyCalls, 1);
    assert.deepEqual(borrowedDisposals, {
      dependency: 0,
      diagnostics: 0,
      index: 0,
      store: 0,
    });
  }
});

test("GaugeStepDefinitionProvider disposal detaches a borrowed document store scan", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument(
    "# Send\n\n* Send the request",
    "gauge",
    "/workspace/gauge/specs/send.spec",
  );

  for (const settlement of ["resolve", "reject"]) {
    const readyEntered = deferred();
    const readyGate = deferred();
    let dependencyCalls = 0;
    let disposeCalls = 0;
    let documentReads = 0;
    let disposeError;
    const documentStore = {
      dispose() {
        disposeCalls += 1;
      },
      documents() {
        documentReads += 1;
        return [];
      },
      whenReady() {
        readyEntered.resolve();
        return readyGate.promise;
      },
    };
    const provider = new GaugeStepDefinitionProvider({
      dependencyStepIndex: {
        findDefinitions() {
          dependencyCalls += 1;
          return [];
        },
      },
      diagnosticsProvider: {
        isGaugeProjectDocument() {
          return true;
        },
        isGaugeProjectRoot() {
          return true;
        },
      },
      documentStore,
      projectFactory: createProjectFactory(),
      vscode: createFakeVscode([specDocument]),
    });
    let outcome = { status: "pending" };
    const invocation = provider.provideDefinition(
      specDocument,
      { line: 2, character: 5 },
    ).then(
      (value) => {
        outcome = { status: "fulfilled", value };
        return value;
      },
      (reason) => {
        outcome = { reason, status: "rejected" };
        throw reason;
      },
    );

    await readyEntered.promise;
    try {
      provider.dispose();
    } catch (error) {
      disposeError = error;
    }
    await nextTurn();
    const observedBeforeRelease = outcome;
    if (settlement === "resolve") {
      readyGate.resolve();
    } else {
      readyGate.reject(new Error("late document store failure"));
    }
    await Promise.allSettled([invocation]);

    assert.equal(disposeError, undefined);
    assert.deepEqual(observedBeforeRelease, { status: "fulfilled", value: [] });
    assert.deepEqual(outcome, { status: "fulfilled", value: [] });
    assert.equal(documentReads, 0);
    assert.equal(dependencyCalls, 0);
    assert.equal(disposeCalls, 0);
  }
});

test("GaugeStepDefinitionProvider preserves live results and failures with host tokens", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument(
    "# Send\n\n* Send the request",
    "gauge",
    "/workspace/gauge/specs/send.spec",
  );
  const targetDocument = createDocument(
    "# Send the request\n* Continue",
    "gauge-concept",
    "/workspace/gauge/concepts/send.cpt",
  );
  const entry = {
    document: targetDocument,
    heading: {
      end: { line: 0, character: 18 },
      start: { line: 0, character: 2 },
    },
    kind: "concept",
  };

  {
    const cancellation = createCancellation();
    let indexCalls = 0;
    const provider = new GaugeStepDefinitionProvider({
      diagnosticsProvider: {
        isGaugeProjectDocument() {
          return true;
        },
        isGaugeProjectRoot() {
          return true;
        },
      },
      projectFactory: createProjectFactory(),
      vscode: createFakeVscode([specDocument]),
      workspaceStepIndex: {
        definitionEntries() {
          indexCalls += 1;
          return [entry];
        },
      },
    });
    cancellation.cancel();

    const definitions = await provider.provideDefinition(
      specDocument,
      { line: 2, character: 5 },
      cancellation.token,
    );

    assert.deepEqual(definitions, []);
    assert.equal(indexCalls, 0);
    assert.equal(cancellation.registrations(), 0);
    assert.equal(cancellation.listenerDisposals(), 0);
  }

  {
    const cancellation = createCancellation();
    const provider = new GaugeStepDefinitionProvider({
      diagnosticsProvider: {
        isGaugeProjectDocument() {
          return true;
        },
        isGaugeProjectRoot() {
          return true;
        },
      },
      projectFactory: createProjectFactory(),
      vscode: createFakeVscode([specDocument]),
      workspaceStepIndex: {
        definitionEntries() {
          return [entry];
        },
      },
    });

    const definitions = await provider.provideDefinition(
      specDocument,
      { line: 2, character: 5 },
      cancellation.token,
    );

    assert.equal(definitions.length, 1);
    assert.equal(definitions[0].uri, targetDocument.uri);
    assert.equal(cancellation.registrations(), 1);
    assert.equal(cancellation.listenerDisposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
    assert.equal(provider.activeOperations.size, 0);
  }

  for (const source of ["index", "dependency", "store"]) {
    const cancellation = createCancellation();
    const liveError = new Error(`live ${source} definition failure`);
    const provider = new GaugeStepDefinitionProvider({
      dependencyStepIndex: {
        findDefinitions() {
          if (source === "dependency") {
            return Promise.reject(liveError);
          }
          return [];
        },
      },
      diagnosticsProvider: {
        isGaugeProjectDocument() {
          return true;
        },
        isGaugeProjectRoot() {
          return true;
        },
      },
      documentStore: source === "store"
        ? {
          whenReady() {
            return Promise.reject(liveError);
          },
        }
        : undefined,
      projectFactory: createProjectFactory(),
      vscode: createFakeVscode([specDocument]),
      workspaceStepIndex: source === "store"
        ? undefined
        : {
          definitionEntries() {
            if (source === "index") {
              return Promise.reject(liveError);
            }
            return [];
          },
        },
    });

    await assert.rejects(
      provider.provideDefinition(
        specDocument,
        { line: 2, character: 5 },
        cancellation.token,
      ),
      (error) => error === liveError,
    );
    assert.equal(cancellation.registrations(), 1);
    assert.equal(cancellation.listenerDisposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
    assert.equal(provider.activeOperations.size, 0);
  }
});

test("GaugeStepDefinitionProvider stops fallback file discovery on host cancellation", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument(
    "# Send\n\n* Send the request",
    "gauge",
    "/workspace/gauge/specs/send.spec",
  );

  for (const boundary of ["findFiles", "openTextDocument"]) {
    for (const settlement of ["resolve", "reject"]) {
      const cancellation = createCancellation();
      const boundaryEntered = deferred();
      const boundaryGate = deferred();
      const findPatterns = [];
      const openedFiles = [];
      const firstUri = { fsPath: "/workspace/gauge/src/test/kotlin/FirstSteps.kt" };
      const secondUri = { fsPath: "/workspace/gauge/src/test/kotlin/SecondSteps.kt" };
      let dependencyCalls = 0;
      const vscode = createFakeVscode([specDocument], {
        findFiles(pattern) {
          findPatterns.push(pattern);
          if (boundary === "findFiles") {
            boundaryEntered.resolve();
            return boundaryGate.promise;
          }
          return Promise.resolve(pattern === "**/*.kt" ? [firstUri, secondUri] : []);
        },
        openTextDocument(uri) {
          openedFiles.push(uri.fsPath);
          boundaryEntered.resolve();
          return boundaryGate.promise;
        },
      });
      const provider = new GaugeStepDefinitionProvider({
        dependencyStepIndex: {
          findDefinitions() {
            dependencyCalls += 1;
            return [];
          },
        },
        diagnosticsProvider: {
          isGaugeProjectDocument() {
            return true;
          },
          isGaugeProjectRoot() {
            return true;
          },
        },
        projectFactory: createProjectFactory(),
        vscode,
      });
      let outcome = { status: "pending" };
      const invocation = provider.provideDefinition(
        specDocument,
        { line: 2, character: 5 },
        cancellation.token,
      ).then(
        (value) => {
          outcome = { status: "fulfilled", value };
          return value;
        },
        (reason) => {
          outcome = { reason, status: "rejected" };
          throw reason;
        },
      );

      await boundaryEntered.promise;
      cancellation.cancel();
      await nextTurn();
      const observedBeforeRelease = outcome;
      if (settlement === "resolve") {
        boundaryGate.resolve(boundary === "findFiles"
          ? [firstUri, secondUri]
          : createDocument(
            "@Step(\"Send the request\")\nfun send() {}",
            "kotlin",
            firstUri.fsPath,
          ));
      } else {
        boundaryGate.reject(new Error(`late ${boundary} failure`));
      }
      await Promise.allSettled([invocation]);

      assert.deepEqual(observedBeforeRelease, { status: "fulfilled", value: [] });
      assert.deepEqual(outcome, { status: "fulfilled", value: [] });
      assert.deepEqual(findPatterns, ["**/*.kt"]);
      assert.deepEqual(openedFiles, boundary === "openTextDocument" ? [firstUri.fsPath] : []);
      assert.equal(dependencyCalls, 0);
      assert.equal(cancellation.listenerDisposals(), 1);
      assert.equal(cancellation.listenerCount(), 0);
    }
  }
});

test("GaugeStepDefinitionProvider preserves live fallback file failures", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument(
    "# Send\n\n* Send the request",
    "gauge",
    "/workspace/gauge/specs/send.spec",
  );
  const unreadableUri = { fsPath: "/workspace/gauge/src/test/java/UnreadableSteps.java" };
  const readableUri = { fsPath: "/workspace/gauge/src/test/java/OtherSteps.java" };
  const dependencyLocation = { uri: { fsPath: "/dependency/Steps.class" } };
  const cancellation = createCancellation();
  const findPatterns = [];
  const openedFiles = [];
  const vscode = createFakeVscode([specDocument], {
    findFiles(pattern) {
      findPatterns.push(pattern);
      if (pattern === "**/*.kt") {
        return Promise.reject(new Error("live Kotlin search failure"));
      }
      if (pattern === "**/*.java") {
        return Promise.resolve([unreadableUri, readableUri]);
      }
      return Promise.resolve([]);
    },
    openTextDocument(uri) {
      openedFiles.push(uri.fsPath);
      if (uri === unreadableUri) {
        return Promise.reject(new Error("live Java read failure"));
      }
      return Promise.resolve(createDocument(
        "@Step(\"Another request\")\nvoid another() {}",
        "java",
        uri.fsPath,
      ));
    },
  });
  const provider = new GaugeStepDefinitionProvider({
    dependencyStepIndex: {
      findDefinitions() {
        return [dependencyLocation];
      },
    },
    diagnosticsProvider: {
      collectWorkspaceConstants() {
        return new Map();
      },
      isGaugeProjectDocument() {
        return true;
      },
      isGaugeProjectRoot() {
        return true;
      },
    },
    projectFactory: createProjectFactory(),
    vscode,
  });

  const definitions = await provider.provideDefinition(
    specDocument,
    { line: 2, character: 5 },
    cancellation.token,
  );

  assert.deepEqual(definitions, [dependencyLocation]);
  assert.deepEqual(findPatterns, ["**/*.kt", "**/*.java", "**/*.cpt"]);
  assert.deepEqual(openedFiles, [unreadableUri.fsPath, readableUri.fsPath]);
  assert.equal(cancellation.listenerDisposals(), 1);
  assert.equal(cancellation.listenerCount(), 0);
  assert.equal(provider.activeOperations.size, 0);
});

test("GaugeStepDefinitionProvider normalizes synchronous lifecycle reentrancy", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument(
    "# Send\n\n* Send the request",
    "gauge",
    "/workspace/gauge/specs/send.spec",
  );
  const targetDocument = createDocument(
    "# Send the request\n* Continue",
    "gauge-concept",
    "/workspace/gauge/concepts/send.cpt",
  );
  const entry = {
    document: targetDocument,
    heading: {
      end: { line: 0, character: 18 },
      start: { line: 0, character: 2 },
    },
    kind: "concept",
  };

  {
    let indexCalls = 0;
    let listenerDisposals = 0;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested(listener) {
        listener();
        return {
          dispose() {
            listenerDisposals += 1;
          },
        };
      },
    };
    const provider = new GaugeStepDefinitionProvider({
      diagnosticsProvider: {
        isGaugeProjectDocument() {
          return true;
        },
        isGaugeProjectRoot() {
          return true;
        },
      },
      projectFactory: createProjectFactory(),
      vscode: createFakeVscode([specDocument]),
      workspaceStepIndex: {
        definitionEntries() {
          indexCalls += 1;
          return [entry];
        },
      },
    });

    assert.deepEqual(
      await provider.provideDefinition(specDocument, { line: 2, character: 5 }, token),
      [],
    );
    assert.equal(indexCalls, 0);
    assert.equal(listenerDisposals, 1);
    assert.equal(provider.activeOperations.size, 0);
  }

  {
    const cancellation = createCancellation();
    const lateError = new Error("synchronous cancelled index failure");
    let dependencyCalls = 0;
    const provider = new GaugeStepDefinitionProvider({
      dependencyStepIndex: {
        findDefinitions() {
          dependencyCalls += 1;
          return [];
        },
      },
      diagnosticsProvider: {
        isGaugeProjectDocument() {
          return true;
        },
        isGaugeProjectRoot() {
          return true;
        },
      },
      projectFactory: createProjectFactory(),
      vscode: createFakeVscode([specDocument]),
      workspaceStepIndex: {
        definitionEntries() {
          cancellation.cancel();
          return Promise.reject(lateError);
        },
      },
    });

    assert.deepEqual(
      await provider.provideDefinition(
        specDocument,
        { line: 2, character: 5 },
        cancellation.token,
      ),
      [],
    );
    assert.equal(dependencyCalls, 0);
    assert.equal(cancellation.listenerDisposals(), 1);
    assert.equal(provider.activeOperations.size, 0);
  }

  {
    let locationCalls = 0;
    let provider;
    const vscode = createFakeVscode([specDocument]);
    vscode.Location = class Location {
      constructor(uri, range) {
        locationCalls += 1;
        this.uri = uri;
        this.range = range;
        if (locationCalls === 1) {
          provider.dispose();
        }
      }
    };
    provider = new GaugeStepDefinitionProvider({
      diagnosticsProvider: {
        isGaugeProjectDocument() {
          return true;
        },
        isGaugeProjectRoot() {
          return true;
        },
      },
      projectFactory: createProjectFactory(),
      vscode,
      workspaceStepIndex: {
        definitionEntries() {
          return [entry, entry];
        },
      },
    });

    assert.deepEqual(
      await provider.provideDefinition(specDocument, { line: 2, character: 5 }),
      [],
    );
    assert.equal(locationCalls, 1);
    assert.equal(provider.activeOperations.size, 0);
  }

  {
    let registrationDisposeCalls = 0;
    const vscode = createFakeVscode([specDocument]);
    vscode.languages = {
      registerDefinitionProvider(_selector, registeredProvider) {
        registeredProvider.dispose();
        return {
          dispose() {
            registrationDisposeCalls += 1;
          },
        };
      },
    };
    const provider = new GaugeStepDefinitionProvider({
      diagnosticsProvider: {
        isGaugeProjectDocument() {
          return true;
        },
        isGaugeProjectRoot() {
          return true;
        },
      },
      projectFactory: createProjectFactory(),
      vscode,
    });

    assert.equal(provider.register(), provider);
    assert.equal(provider.register(), provider);
    assert.equal(registrationDisposeCalls, 1);
    assert.deepEqual(
      await provider.provideDefinition(specDocument, { line: 2, character: 5 }),
      [],
    );
  }
});

test("GaugeStepDefinitionProvider isolates concurrent cancellation and provider disposal", async () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const specDocument = createDocument(
    "# Send\n\n* Send the request",
    "gauge",
    "/workspace/gauge/specs/send.spec",
  );
  const targetDocument = createDocument(
    "# Send the request\n* Continue",
    "gauge-concept",
    "/workspace/gauge/concepts/send.cpt",
  );
  const entry = {
    document: targetDocument,
    heading: {
      end: { line: 0, character: 18 },
      start: { line: 0, character: 2 },
    },
    kind: "concept",
  };
  const gates = [];
  const provider = new GaugeStepDefinitionProvider({
    diagnosticsProvider: {
      disposeCalls: 0,
      dispose() {
        this.disposeCalls += 1;
      },
      isGaugeProjectDocument() {
        return true;
      },
      isGaugeProjectRoot() {
        return true;
      },
    },
    projectFactory: createProjectFactory(),
    vscode: createFakeVscode([specDocument]),
    workspaceStepIndex: {
      definitionEntries() {
        const gate = deferred();
        gates.push(gate);
        return gate.promise;
      },
    },
  });
  const firstCancellation = createCancellation();
  const secondCancellation = createCancellation();
  const first = provider.provideDefinition(
    specDocument,
    { line: 2, character: 5 },
    firstCancellation.token,
  );
  const second = provider.provideDefinition(
    specDocument,
    { line: 2, character: 5 },
    secondCancellation.token,
  );
  await nextTurn();

  firstCancellation.cancel();
  gates[1].resolve([entry]);
  const firstOutcome = await first;
  const secondOutcome = await second;
  gates[0].reject(new Error("late cancelled concurrent definition failure"));
  await nextTurn();

  assert.deepEqual(firstOutcome, []);
  assert.equal(secondOutcome.length, 1);
  assert.equal(secondOutcome[0].uri, targetDocument.uri);
  assert.equal(firstCancellation.listenerDisposals(), 1);
  assert.equal(secondCancellation.listenerDisposals(), 1);
  assert.equal(provider.activeOperations.size, 0);

  const thirdCancellation = createCancellation();
  const fourthCancellation = createCancellation();
  const third = provider.provideDefinition(
    specDocument,
    { line: 2, character: 5 },
    thirdCancellation.token,
  );
  const fourth = provider.provideDefinition(
    specDocument,
    { line: 2, character: 5 },
    fourthCancellation.token,
  );
  await nextTurn();
  provider.dispose();
  provider.dispose();
  const disposedOutcomes = await Promise.all([third, fourth]);
  gates[2].reject(new Error("late third definition failure"));
  gates[3].resolve([entry]);
  await nextTurn();

  assert.deepEqual(disposedOutcomes, [[], []]);
  assert.equal(thirdCancellation.listenerDisposals(), 1);
  assert.equal(fourthCancellation.listenerDisposals(), 1);
  assert.equal(provider.activeOperations.size, 0);
  assert.equal(provider.diagnosticsProvider.disposeCalls, 0);
});

test("GaugeStepDefinitionProvider disposes only provider-owned diagnostic caches", () => {
  const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
  const vscode = createFakeVscode([]);
  const provider = new GaugeStepDefinitionProvider({ vscode });
  const ownedDiagnosticsProvider = provider.ownedDiagnosticsProvider;
  const externalConstantsProvider = provider.externalWorkspaceConstantsProvider();
  let ownedDisposeCalls = 0;
  let externalDisposeCalls = 0;
  const ownedDispose = ownedDiagnosticsProvider.dispose.bind(ownedDiagnosticsProvider);
  const externalDispose = externalConstantsProvider.dispose.bind(externalConstantsProvider);
  ownedDiagnosticsProvider.dispose = () => {
    ownedDisposeCalls += 1;
    ownedDispose();
  };
  externalConstantsProvider.dispose = () => {
    externalDisposeCalls += 1;
    externalDispose();
  };

  provider.dispose();
  provider.dispose();

  assert.equal(ownedDisposeCalls, 1);
  assert.equal(externalDisposeCalls, 1);
  assert.equal(ownedDiagnosticsProvider.disposed, true);
  assert.equal(externalConstantsProvider.disposed, true);
  assert.equal(provider.ownedDiagnosticsProvider, undefined);
  assert.equal(provider.externalConstantsProvider, undefined);
});
