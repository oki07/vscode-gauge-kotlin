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

function createDocument(text, fsPath = "/workspace/specs/example.spec", languageId = "gauge") {
  const lines = text.split("\n");
  return {
    languageId,
    uri: {
      fsPath,
      toString() {
        return `file://${fsPath}`;
      },
    },
    fileName: fsPath,
    lineAt(line) {
      return { text: lines[line] };
    },
    getText() {
      return text;
    },
    get lineCount() {
      return lines.length;
    },
  };
}

function createFakeVscode(options = {}) {
  const workspace = {
    ...(options.workspace || {}),
  };
  if (typeof workspace.getConfiguration !== "function") {
    workspace.getConfiguration = (section) => {
      if (section !== "gauge.codeLenses") {
        return { get() { return undefined; } };
      }
      return {
        has(key) {
          return Object.prototype.hasOwnProperty.call(options.codeLenses || {}, key);
        },
        get(key) {
          return (options.codeLenses || {})[key];
        },
      };
    };
  }
  return {
    workspace,
  };
}

test("GaugeCodeLensProvider adds one local execution surface for TestController tests", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "# Checkout",
    "* Open cart",
    "",
    "## Successful checkout",
    "* Pay",
    "",
  ].join("\n"));

  const lenses = provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    title: lens.command.title,
    command: lens.command.command,
    arguments: lens.command.arguments,
  })), [
    {
      line: 3,
      title: "Run Scenario",
      command: "gauge.execute",
      arguments: ["/workspace/specs/example.spec:4"],
    },
    {
      line: 3,
      title: "Debug Scenario",
      command: "gauge.debug",
      arguments: ["/workspace/specs/example.spec:4"],
    },
    {
      line: 0,
      title: "Run Spec",
      command: "gauge.execute",
      arguments: ["/workspace/specs/example.spec"],
    },
    {
      line: 0,
      title: "Debug Spec",
      command: "gauge.debug",
      arguments: ["/workspace/specs/example.spec"],
    },
  ]);
});

test("GaugeCodeLensProvider uses the shared workspace step index for reference lenses", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "@Step(\"Open cart\")",
    "fun openCart() {}",
  ].join("\n"), "/workspace/tests/CartSteps.kt", "kotlin");
  const positionOffsets = [];
  document.positionAt = (offset) => {
    positionOffsets.push(offset);
    return offset === 0 ? { line: 0, character: 0 } : { line: 1, character: 17 };
  };
  const entry = {
    aliases: ["Open cart"],
    declarationEnd: document.getText().length,
    declarationStart: 0,
  };
  const referenceQueries = [];
  const provider = new GaugeCodeLensProvider({
    projectFactory: {
      getGaugeRootFromFilePath() {
        return "/workspace";
      },
      isGaugeProject() {
        return true;
      },
    },
    vscode: createFakeVscode(),
    workspaceStepIndex: {
      referenceCount(sourceDocument, template) {
        referenceQueries.push({ sourceDocument, template });
        return 3;
      },
      stepAliasesForEntry(sourceDocument, targetDocument, targetEntry) {
        assert.equal(sourceDocument, document);
        assert.equal(targetDocument, document);
        assert.equal(targetEntry, entry);
        return ["Open cart"];
      },
      stepEntriesForDocument(sourceDocument, targetDocument) {
        assert.equal(sourceDocument, document);
        assert.equal(targetDocument, document);
        return [entry];
      },
    },
  });
  provider.stepImplementationDocuments = () => {
    throw new Error("legacy implementation scan should not run");
  };
  provider.gaugeReferenceDocuments = () => {
    throw new Error("legacy reference scan should not run");
  };

  const lenses = await provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    argument: lens.command.arguments[2],
    title: lens.command.title,
  })), [{ argument: "Open cart", title: "3 reference(s)" }]);
  assert.deepEqual(referenceQueries, [{ sourceDocument: document, template: "Open cart" }]);
  assert.deepEqual(positionOffsets, [0, document.getText().length]);
});

test("GaugeCodeLensProvider allows execution CodeLens text to be disabled", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider({
    vscode: createFakeVscode({ codeLenses: { execution: false } }),
  });
  const document = createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
    "* Pay",
  ].join("\n"));

  assert.deepEqual(provider.provideCodeLenses(document), []);
});

test("GaugeCodeLensProvider mirrors Gauge parallel execution CodeLens for specification tables", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "# Checkout",
    "| user |",
    "| Alice |",
    "",
    "## Successful checkout",
    "* Pay",
  ].join("\n"));

  const lenses = provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => lens.command.title), [
    "Run Scenario",
    "Debug Scenario",
    "Run Spec",
    "Debug Spec",
    "Run in parallel",
  ]);
});

// Gauge emits the parallel lens whenever spec.DataTable.IsInitialized()
// (references/gauge/api/lang/codeLens.go), and an external `table: file.csv`
// initializes it through AddExternalDataTable
// (references/gauge/parser/convert.go), exactly like an inline table.
test("GaugeCodeLensProvider mirrors Gauge parallel execution CodeLens for external data tables", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "# Checkout",
    "table: ./users.csv",
    "",
    "## Successful checkout",
    "* Pay",
  ].join("\n"));

  assert.deepEqual(provider.provideCodeLenses(document).map((lens) => lens.command.title), [
    "Run Scenario",
    "Debug Scenario",
    "Run Spec",
    "Debug Spec",
    "Run in parallel",
  ]);
});

test("GaugeCodeLensProvider keeps the parallel CodeLens off a scenario data table", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
    "table: ./users.csv",
    "* Pay",
  ].join("\n"));

  assert.deepEqual(provider.provideCodeLenses(document).map((lens) => lens.command.title), [
    "Run Scenario",
    "Debug Scenario",
    "Run Spec",
    "Debug Spec",
  ]);
});

test("GaugeCodeLensProvider adds execution CodeLens text to Markdown Gauge specs", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
    "* Pay",
  ].join("\n"), "/workspace/specs/example.md", "markdown");

  assert.deepEqual(provider.provideCodeLenses(document).map((lens) => lens.command.title), [
    "Run Scenario",
    "Debug Scenario",
    "Run Spec",
    "Debug Spec",
  ]);
});

test("GaugeCodeLensProvider adds reference lenses for concept headings", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "  # Reuse checkout <user>",
    "* Prepare cart",
    "",
    "# Unused concept",
    "",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");
  const specDocument = createDocument([
    "# Checkout",
    "* Reuse checkout \"Alice\"",
    "",
  ].join("\n"));
  const nestedConceptDocument = createDocument([
    "# Cart setup",
    "* Reuse checkout <buyer>",
    "",
  ].join("\n"), "/workspace/specs/concepts/cart.cpt");
  const provider = new GaugeCodeLensProvider({
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [
          document,
          specDocument,
          nestedConceptDocument,
        ],
      },
    }),
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    character: lens.range.start.character,
    title: lens.command.title,
    command: lens.command.command,
    arguments: lens.command.arguments,
  })), [
    {
      line: 0,
      character: 2,
      title: "2 reference(s)",
      command: "gauge.showReferences",
      arguments: [
        "file:///workspace/specs/concepts/shared.cpt",
        { line: 0, character: 2 },
        "Reuse checkout {}",
      ],
    },
    {
      line: 3,
      character: 0,
      title: "0 reference(s)",
      command: "gauge.showReferences",
      arguments: [
        "file:///workspace/specs/concepts/shared.cpt",
        { line: 3, character: 0 },
        "Unused concept",
      ],
    },
  ]);
});

test("GaugeCodeLensProvider adds reference lenses for gauge-concept headings by language id", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "  # Reuse checkout <user>",
    "* Prepare cart",
    "",
  ].join("\n"), "/workspace/specs/concepts/shared", "gauge-concept");
  const specDocument = createDocument([
    "# Checkout",
    "* Reuse checkout \"Alice\"",
    "",
  ].join("\n"));
  const provider = new GaugeCodeLensProvider({
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [
          document,
          specDocument,
        ],
      },
    }),
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    character: lens.range.start.character,
    title: lens.command.title,
    command: lens.command.command,
    arguments: lens.command.arguments,
  })), [
    {
      line: 0,
      character: 2,
      title: "1 reference(s)",
      command: "gauge.showReferences",
      arguments: [
        "file:///workspace/specs/concepts/shared",
        { line: 0, character: 2 },
        "Reuse checkout {}",
      ],
    },
  ]);
});

test("GaugeCodeLensProvider ignores documents outside Gauge projects", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/example.spec");
        throw new Error("not a Gauge project");
      },
    },
  });
  const document = createDocument([
    "# Notes",
    "",
    "## Draft",
  ].join("\n"), "/workspace/notes/example.spec");

  assert.deepEqual(provider.provideCodeLenses(document), []);
});

test("GaugeCodeLensProvider adds reference lenses for Kotlin Step functions", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/tests/LoginSteps.kt", "kotlin");
  const specDocument = createDocument([
    "# Login",
    "  * Log in as \"Alice\"",
    "",
  ].join("\n"));
  const provider = new GaugeCodeLensProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename.startsWith("/workspace/"), true);
        return "/workspace";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace");
        return true;
      },
    },
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [document, specDocument],
      },
    }),
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    character: lens.range.start.character,
    title: lens.command.title,
    command: lens.command.command,
    arguments: lens.command.arguments,
  })), [
    {
      line: 3,
      character: 0,
      title: "1 reference(s)",
      command: "gauge.showReferences",
      arguments: [
        "file:///workspace/tests/LoginSteps.kt",
        { line: 3, character: 0 },
        "Log in as {}",
      ],
    },
  ]);
});

test("GaugeCodeLensProvider adds separate reference lenses for Step aliases", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step([\"Create user <name>\", \"Delete user <name>\"])",
    "fun updateUser(name: String) {}",
  ].join("\n"), "/workspace/tests/UserSteps.kt", "kotlin");
  const specDocument = createDocument([
    "# Users",
    "* Create user \"Alice\"",
    "* Create user \"Bob\"",
    "* Delete user \"Alice\"",
    "",
  ].join("\n"));
  const provider = new GaugeCodeLensProvider({
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [document, specDocument],
      },
    }),
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    character: lens.range.start.character,
    title: lens.command.title,
    command: lens.command.command,
    arguments: lens.command.arguments,
  })), [
    {
      line: 3,
      character: 0,
      title: "2 reference(s)",
      command: "gauge.showReferences",
      arguments: [
        "file:///workspace/tests/UserSteps.kt",
        { line: 3, character: 0 },
        "Create user {}",
      ],
    },
    {
      line: 3,
      character: 0,
      title: "1 reference(s)",
      command: "gauge.showReferences",
      arguments: [
        "file:///workspace/tests/UserSteps.kt",
        { line: 3, character: 0 },
        "Delete user {}",
      ],
    },
  ]);
});

test("GaugeCodeLensProvider counts double-star lines as step references", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"* Bold comment\")",
    "fun bold() {}",
  ].join("\n"), "/workspace/tests/BoldSteps.kt", "kotlin");
  const specDocument = createDocument([
    "# Notes",
    "** Bold comment",
  ].join("\n"));
  const provider = new GaugeCodeLensProvider({
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [document, specDocument],
      },
    }),
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => lens.command.title), [
    "1 reference(s)",
  ]);
});

test("GaugeCodeLensProvider excludes starred docstring payloads from step references", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Not a Gauge step\")",
    "fun wrong() {}",
  ].join("\n"), "/workspace/tests/Steps.kt", "kotlin");
  const specDocument = createDocument([
    "# Execution",
    "## Runs content",
    "* Execute content",
    "\"\"\"",
    "* Not a Gauge step",
    "\"\"\"",
  ].join("\n"));
  const provider = new GaugeCodeLensProvider({
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [document, specDocument],
      },
    }),
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => lens.command.title), [
    "0 reference(s)",
  ]);
});

test("GaugeCodeLensProvider counts multiline step references when project allows them", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const originalAllowMultiline = process.env.allow_multiline_step;
  delete process.env.allow_multiline_step;
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with card\")",
    "fun pay() {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/PaymentSteps.kt", "kotlin");
  const specDocument = createDocument([
    "# Payment",
    "* Pay with",
    "card",
  ].join("\n"), "/workspace/gauge/specs/payment.spec", "gauge");
  const provider = new GaugeCodeLensProvider({
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
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [document, specDocument],
      },
    }),
  });

  try {
    const lenses = await provider.provideCodeLenses(document);

    assert.deepEqual(lenses.map((lens) => lens.command.title), [
      "1 reference(s)",
    ]);
  } finally {
    if (originalAllowMultiline === undefined) {
      delete process.env.allow_multiline_step;
    } else {
      process.env.allow_multiline_step = originalAllowMultiline;
    }
  }
});

test("GaugeCodeLensProvider counts table references without closing pipes", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Compare <table>\")",
    "fun compare() {}",
  ].join("\n"), "/workspace/tests/CompareSteps.kt", "kotlin");
  const specDocument = createDocument([
    "# Compare",
    "* Compare",
    "  | name",
  ].join("\n"));
  const provider = new GaugeCodeLensProvider({
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [document, specDocument],
      },
    }),
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => lens.command.title), [
    "1 reference(s)",
  ]);
});

test("GaugeCodeLensProvider skips unopened Step sources resolved to non-Gauge projects", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const openedFiles = [];
  const outsideUri = {
    fsPath: "/workspace/notes/src/test/kotlin/OtherSteps.kt",
  };
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/LoginSteps.kt", "kotlin");
  const provider = new GaugeCodeLensProvider({
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
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [document],
        findFiles(pattern) {
          return pattern === "**/*.kt" ? Promise.resolve([outsideUri]) : Promise.resolve([]);
        },
        openTextDocument(uri) {
          openedFiles.push(uri.fsPath);
          return Promise.resolve(createDocument([
            "import com.thoughtworks.gauge.Step",
            "",
            "@Step(\"Other <value>\")",
            "fun other(value: String) {}",
          ].join("\n"), uri.fsPath, "kotlin"));
        },
      },
    }),
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.equal(lenses.length, 1);
  assert.deepEqual(openedFiles, []);
});

test("GaugeCodeLensProvider skips unopened Step sources from other Gauge projects", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const openedFiles = [];
  const foreignUri = {
    fsPath: "/workspace/project-b/src/test/kotlin/OtherSteps.kt",
  };
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/project-a/src/test/kotlin/LoginSteps.kt", "kotlin");
  const provider = new GaugeCodeLensProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        if (filename.startsWith("/workspace/project-a/")) {
          return "/workspace/project-a";
        }
        if (filename.startsWith("/workspace/project-b/")) {
          return "/workspace/project-b";
        }
        throw new Error("not a Gauge project file");
      },
      isGaugeProject(root) {
        return root === "/workspace/project-a" || root === "/workspace/project-b";
      },
    },
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [document],
        findFiles(pattern) {
          return pattern === "**/*.kt" ? Promise.resolve([foreignUri]) : Promise.resolve([]);
        },
        openTextDocument(uri) {
          openedFiles.push(uri.fsPath);
          return Promise.resolve(createDocument([
            "import com.thoughtworks.gauge.Step",
            "",
            "@Step(\"Other <value>\")",
            "fun other(value: String) {}",
          ].join("\n"), uri.fsPath, "kotlin"));
        },
      },
    }),
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.equal(lenses.length, 1);
  assert.deepEqual(openedFiles, []);
});

test("GaugeCodeLensProvider skips open Step sources from other Gauge projects", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/project-a/src/test/kotlin/LoginSteps.kt", "kotlin");
  const foreignDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Other <value>\")",
    "fun other(value: String) {}",
  ].join("\n"), "/workspace/project-b/src/test/kotlin/OtherSteps.kt", "kotlin");
  const provider = new GaugeCodeLensProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        if (filename.startsWith("/workspace/project-a/")) {
          return "/workspace/project-a";
        }
        if (filename.startsWith("/workspace/project-b/")) {
          return "/workspace/project-b";
        }
        throw new Error("not a Gauge project file");
      },
      isGaugeProject(root) {
        return root === "/workspace/project-a" || root === "/workspace/project-b";
      },
    },
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [document, foreignDocument],
      },
    }),
  });

  const documents = await provider.stepImplementationDocuments(document);

  assert.deepEqual(documents, []);
});

test("GaugeCodeLensProvider adds reference lenses for Java Step methods", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "package steps;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "",
    "public class LoginSteps {",
    "  @Step(\"Log in as <user>\")",
    "  public void login(String user) {",
    "  }",
    "}",
  ].join("\n"), "/workspace/tests/LoginSteps.java", "plaintext");
  const specDocument = createDocument([
    "# Login",
    "* Log in as \"Alice\"",
    "* Log in as \"Bob\"",
    "",
  ].join("\n"));
  const provider = new GaugeCodeLensProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename.startsWith("/workspace/"), true);
        return "/workspace";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace");
        return true;
      },
    },
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [document, specDocument],
      },
    }),
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    character: lens.range.start.character,
    title: lens.command.title,
    command: lens.command.command,
    arguments: lens.command.arguments,
  })), [
    {
      line: 6,
      character: 14,
      title: "2 reference(s)",
      command: "gauge.showReferences",
      arguments: [
        "file:///workspace/tests/LoginSteps.java",
        { line: 6, character: 14 },
        "Log in as {}",
      ],
    },
  ]);
});

test("GaugeCodeLensProvider includes Kotlin super Step aliases in implementation lenses", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "interface LoginContract {",
    "  @Step(\"Log in as <user>\")",
    "  fun login(user: String)",
    "}",
    "",
    "class LoginSteps : LoginContract {",
    "  @Step(\"Sign in as <user>\")",
    "  override fun login(user: String) {}",
    "}",
  ].join("\n"), "/workspace/tests/LoginSteps.kt", "kotlin");
  const specDocument = createDocument([
    "# Login",
    "* Log in as \"Alice\"",
    "* Sign in as \"Bob\"",
    "",
  ].join("\n"));
  const provider = new GaugeCodeLensProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename.startsWith("/workspace/"), true);
        return "/workspace";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace");
        return true;
      },
    },
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [document, specDocument],
      },
    }),
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    character: lens.range.start.character,
    title: lens.command.title,
    argument: lens.command.arguments[2],
  })), [
    {
      line: 4,
      character: 2,
      title: "1 reference(s)",
      argument: "Log in as {}",
    },
    {
      line: 9,
      character: 11,
      title: "1 reference(s)",
      argument: "Sign in as {}",
    },
    {
      line: 9,
      character: 11,
      title: "1 reference(s)",
      argument: "Log in as {}",
    },
  ]);
});

test("GaugeCodeLensProvider includes Java super Step aliases in implementation lenses", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "package steps;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "",
    "interface LoginContract {",
    "  @Step(\"Log in as <user>\")",
    "  void login(String user);",
    "}",
    "",
    "public class LoginSteps implements LoginContract {",
    "  @Step(\"Sign in as <user>\")",
    "  public void login(String user) {",
    "  }",
    "}",
  ].join("\n"), "/workspace/tests/LoginSteps.java", "java");
  const specDocument = createDocument([
    "# Login",
    "* Log in as \"Alice\"",
    "* Sign in as \"Bob\"",
    "",
  ].join("\n"));
  const provider = new GaugeCodeLensProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename.startsWith("/workspace/"), true);
        return "/workspace";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace");
        return true;
      },
    },
    vscode: createFakeVscode({
      workspace: {
        textDocuments: [document, specDocument],
      },
    }),
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    character: lens.range.start.character,
    title: lens.command.title,
    argument: lens.command.arguments[2],
  })), [
    {
      line: 6,
      character: 7,
      title: "1 reference(s)",
      argument: "Log in as {}",
    },
    {
      line: 11,
      character: 14,
      title: "1 reference(s)",
      argument: "Sign in as {}",
    },
    {
      line: 11,
      character: 14,
      title: "1 reference(s)",
      argument: "Log in as {}",
    },
  ]);
});

test("GaugeCodeLensProvider uses the shared document store without workspace scans", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/tests/LoginSteps.kt", "kotlin");
  const diskFiles = {
    "/workspace/specs/login.spec": [
      "# Login",
      "  * Log in as \"Alice\"",
      "",
    ].join("\n"),
  };
  const findFilesCalls = [];
  const openTextDocumentCalls = [];
  const fakeVscode = createFakeVscode({
    workspace: {
      textDocuments: [document],
      findFiles(pattern) {
        findFilesCalls.push(pattern);
        return Promise.resolve(Object.keys(diskFiles).map((fsPath) => ({ fsPath })));
      },
      openTextDocument(uri) {
        openTextDocumentCalls.push(uri.fsPath);
        return Promise.reject(new Error("openTextDocument must not be used"));
      },
    },
  });
  const projectFactory = {
    getGaugeRootFromFilePath(filename) {
      assert.equal(filename.startsWith("/workspace/"), true);
      return "/workspace";
    },
    isGaugeProject(root) {
      assert.equal(root, "/workspace");
      return true;
    },
  };
  const documentStore = new WorkspaceDocumentStore({
    fileSystem: {
      promises: {
        readFile(file) {
          if (!Object.prototype.hasOwnProperty.call(diskFiles, file)) {
            return Promise.reject(new Error(`unexpected disk read: ${file}`));
          }
          return Promise.resolve(diskFiles[file]);
        },
      },
    },
    projectFactory,
    vscode: fakeVscode,
  });
  const provider = new GaugeCodeLensProvider({
    documentStore,
    fileSystem: {
      readFileSync() {
        throw new Error("no default properties");
      },
    },
    projectFactory,
    vscode: fakeVscode,
  });

  const lenses = await provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    character: lens.range.start.character,
    title: lens.command.title,
    command: lens.command.command,
    arguments: lens.command.arguments,
  })), [
    {
      line: 3,
      character: 0,
      title: "1 reference(s)",
      command: "gauge.showReferences",
      arguments: [
        "file:///workspace/tests/LoginSteps.kt",
        { line: 3, character: 0 },
        "Log in as {}",
      ],
    },
  ]);
  assert.equal(
    findFilesCalls.length <= 1,
    true,
    `expected at most one findFiles call, got: ${findFilesCalls.join(", ")}`,
  );
  assert.deepEqual(openTextDocumentCalls, []);
});

test("GaugeCodeLensProvider suppresses Kotlin reference lenses when disabled", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider({
    vscode: createFakeVscode({ codeLenses: { reference: false } }),
  });
  const document = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/tests/LoginSteps.kt", "kotlin");

  assert.deepEqual(await provider.provideCodeLenses(document), []);
});

test("GaugeCodeLensProvider stops pending concept reference counts on host cancellation", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");

  {
    const cancellation = createCancellation();
    cancellation.cancel();
    let referenceQueries = 0;
    const provider = new GaugeCodeLensProvider({
      vscode: createFakeVscode(),
      workspaceStepIndex: {
        referenceCount() {
          referenceQueries += 1;
          return 0;
        },
      },
    });
    const document = createDocument(
      "# Cancelled concept\n* Continue",
      "/workspace/concepts/cancelled.cpt",
      "gauge-concept",
    );

    assert.deepEqual(provider.provideCodeLenses(document, cancellation.token), []);
    assert.equal(referenceQueries, 0);
    assert.equal(cancellation.registrations(), 0);
  }

  for (const settlement of ["resolve", "reject"]) {
    const document = createDocument([
      "# First concept",
      "* First step",
      "",
      "# Second concept",
      "* Second step",
    ].join("\n"), "/workspace/concepts/shared.cpt", "gauge-concept");
    const cancellation = createCancellation();
    const referenceEntered = deferred();
    const referenceGate = deferred();
    const referenceQueries = [];
    const provider = new GaugeCodeLensProvider({
      vscode: createFakeVscode(),
      workspaceStepIndex: {
        referenceCount(_sourceDocument, stepValue) {
          referenceQueries.push(stepValue);
          if (referenceQueries.length === 1) {
            referenceEntered.resolve();
            return referenceGate.promise;
          }
          return 2;
        },
      },
    });

    let outcome = { status: "pending" };
    const invocation = Promise.resolve(provider.provideCodeLenses(document, cancellation.token));
    invocation.then(
      (value) => {
        outcome = { status: "fulfilled", value };
      },
      (error) => {
        outcome = { status: "rejected", error };
      },
    );
    await referenceEntered.promise;
    cancellation.cancel();
    await nextTurn();
    const outcomeAfterCancellation = outcome;
    if (settlement === "resolve") {
      referenceGate.resolve(1);
    } else {
      referenceGate.reject(new Error("Late reference count failure."));
    }
    const finalOutcome = await invocation.then(
      (value) => ({ status: "fulfilled", value }),
      (error) => ({ status: "rejected", error }),
    );
    await nextTurn();

    assert.deepEqual(outcomeAfterCancellation, { status: "fulfilled", value: [] });
    assert.deepEqual(finalOutcome, { status: "fulfilled", value: [] });
    assert.deepEqual(referenceQueries, ["First concept"]);
    assert.equal(cancellation.registrations(), 1);
    assert.equal(cancellation.listenerDisposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
  }
});

test("GaugeCodeLensProvider disposal settles indexed requests and owns registration", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "@Step(\"Open cart\")",
    "fun openCart() {}",
  ].join("\n"), "/workspace/tests/CartSteps.kt", "kotlin");
  document.positionAt = (offset) => (
    offset === 0 ? { line: 0, character: 0 } : { line: 1, character: 17 }
  );
  const entriesEntered = deferred();
  const entriesGate = deferred();
  let indexCalls = 0;
  let registrationCalls = 0;
  let registrationDisposeCalls = 0;
  let registeredSelector;
  const borrowedDiagnostics = {
    disposeCalls: 0,
    dispose() {
      this.disposeCalls += 1;
    },
  };
  const vscode = createFakeVscode();
  let registeredProvider;
  vscode.languages = {
    registerCodeLensProvider(selector, provider) {
      registrationCalls += 1;
      registeredSelector = selector;
      registeredProvider = provider;
      return {
        dispose() {
          registrationDisposeCalls += 1;
        },
      };
    },
  };
  const provider = new GaugeCodeLensProvider({
    diagnosticsProvider: borrowedDiagnostics,
    vscode,
    workspaceStepIndex: {
      stepEntriesForDocument() {
        indexCalls += 1;
        entriesEntered.resolve();
        return entriesGate.promise;
      },
    },
  });
  const hasRegistrationOwner = typeof provider.register === "function";
  const firstRegistration = hasRegistrationOwner ? provider.register() : undefined;
  const secondRegistration = hasRegistrationOwner ? provider.register() : undefined;
  let outcome = { status: "pending" };
  const invocation = Promise.resolve(provider.provideCodeLenses(document));
  invocation.then((value) => {
    outcome = { status: "fulfilled", value };
  });
  await entriesEntered.promise;
  if (typeof provider.dispose === "function") {
    provider.dispose();
    provider.dispose();
  }
  await nextTurn();
  const outcomeAfterDisposal = outcome;
  entriesGate.resolve([]);
  const finalOutcome = await invocation;
  const retainedOutcome = registeredProvider
    ? await registeredProvider.provideCodeLenses(document)
    : undefined;

  assert.equal(hasRegistrationOwner, true);
  assert.equal(firstRegistration, provider);
  assert.equal(secondRegistration, provider);
  assert.equal(registrationCalls, 1);
  assert.equal(registrationDisposeCalls, 1);
  assert.deepEqual(registeredSelector, [
    { language: "gauge" },
    { language: "gauge-concept" },
    { scheme: "file", pattern: "**/*.spec" },
    { scheme: "file", pattern: "**/*.cpt" },
    { language: "markdown", scheme: "file", pattern: "**/*.md" },
    { language: "kotlin" },
    { scheme: "file", pattern: "**/*.kt" },
    { language: "java" },
    { scheme: "file", pattern: "**/*.java" },
  ]);
  assert.deepEqual(outcomeAfterDisposal, { status: "fulfilled", value: [] });
  assert.deepEqual(finalOutcome, []);
  assert.deepEqual(retainedOutcome, []);
  assert.equal(indexCalls, 1);
  assert.equal(provider.activeOperations.size, 0);
  assert.equal(borrowedDiagnostics.disposeCalls, 0);
});

test("GaugeCodeLensProvider disposal detaches borrowed document-store readiness", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument(
    "# Shared concept\n* Continue",
    "/workspace/concepts/shared.cpt",
    "gauge-concept",
  );
  const readyEntered = deferred();
  const readyGate = deferred();
  let documentsCalls = 0;
  const documentStore = {
    disposeCalls: 0,
    dispose() {
      this.disposeCalls += 1;
    },
    documents() {
      documentsCalls += 1;
      return [];
    },
    whenReady() {
      readyEntered.resolve();
      return readyGate.promise;
    },
  };
  const provider = new GaugeCodeLensProvider({
    diagnosticsProvider: {
      belongsToSourceGaugeProject() {
        return true;
      },
      gaugeProjectRoot() {
        return "/workspace";
      },
      rootForFile() {
        return "/workspace";
      },
    },
    documentStore,
    vscode: createFakeVscode(),
  });
  let outcome = { status: "pending" };
  const invocation = Promise.resolve(provider.provideCodeLenses(document));
  invocation.then((value) => {
    outcome = { status: "fulfilled", value };
  });
  await readyEntered.promise;
  if (typeof provider.dispose === "function") {
    provider.dispose();
  }
  await nextTurn();
  const outcomeAfterDisposal = outcome;
  readyGate.reject(new Error("Late document store failure."));
  const finalOutcome = await invocation.then(
    (value) => ({ status: "fulfilled", value }),
    (error) => ({ status: "rejected", error }),
  );
  await nextTurn();

  assert.deepEqual(outcomeAfterDisposal, { status: "fulfilled", value: [] });
  assert.deepEqual(finalOutcome, { status: "fulfilled", value: [] });
  assert.equal(documentsCalls, 0);
  assert.equal(documentStore.disposeCalls, 0);
  assert.equal(provider.activeOperations.size, 0);
});

test("GaugeCodeLensProvider preserves live failures and disposes owned diagnostics", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument(
    "# Shared concept\n* Continue",
    "/workspace/concepts/shared.cpt",
    "gauge-concept",
  );
  const cancellation = createCancellation();
  const requestError = new Error("Reference index failed.");
  const provider = new GaugeCodeLensProvider({
    vscode: createFakeVscode(),
    workspaceStepIndex: {
      referenceCount() {
        return Promise.reject(requestError);
      },
    },
  });

  await assert.rejects(
    provider.provideCodeLenses(document, cancellation.token),
    (error) => error === requestError,
  );
  assert.equal(cancellation.registrations(), 1);
  assert.equal(cancellation.listenerDisposals(), 1);
  assert.equal(cancellation.listenerCount(), 0);
  assert.equal(provider.activeOperations.size, 0);

  const ownedProvider = new GaugeCodeLensProvider({ vscode: createFakeVscode() });
  const ownedDiagnostics = ownedProvider.ownedDiagnosticsProvider;
  let ownedDisposeCalls = 0;
  const ownedDispose = ownedDiagnostics.dispose.bind(ownedDiagnostics);
  ownedDiagnostics.dispose = () => {
    ownedDisposeCalls += 1;
    ownedDispose();
  };
  ownedProvider.dispose();
  ownedProvider.dispose();

  assert.equal(ownedDisposeCalls, 1);
  assert.equal(ownedProvider.ownedDiagnosticsProvider, undefined);
});

test("GaugeCodeLensProvider stops fallback workspace scans on host cancellation", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const sourceDocument = createDocument([
    "@Step(\"Open cart\")",
    "fun openCart() {}",
  ].join("\n"), "/workspace/tests/CartSteps.kt", "kotlin");

  for (const boundary of ["find", "open"]) {
    const cancellation = createCancellation();
    const operationEntered = deferred();
    const operationGate = deferred();
    const findCalls = [];
    const openCalls = [];
    const firstUri = { fsPath: "/workspace/tests/FirstSteps.kt" };
    const secondUri = { fsPath: "/workspace/tests/SecondSteps.kt" };
    const provider = new GaugeCodeLensProvider({
      diagnosticsProvider: {
        belongsToSourceGaugeProject() {
          return true;
        },
        collectWorkspaceConstants() {
          return {};
        },
        gaugeProjectRoot() {
          return "/workspace";
        },
        rootForFile() {
          return "/workspace";
        },
      },
      vscode: createFakeVscode({
        workspace: {
          findFiles(pattern) {
            findCalls.push(pattern);
            if (boundary === "find") {
              operationEntered.resolve();
              return operationGate.promise;
            }
            return Promise.resolve([firstUri, secondUri]);
          },
          openTextDocument(uri) {
            openCalls.push(uri.fsPath);
            operationEntered.resolve();
            return operationGate.promise;
          },
          textDocuments: [],
        },
      }),
    });
    let outcome = { status: "pending" };
    const invocation = Promise.resolve(provider.provideCodeLenses(
      sourceDocument,
      cancellation.token,
    ));
    invocation.then((value) => {
      outcome = { status: "fulfilled", value };
    });
    await operationEntered.promise;
    cancellation.cancel();
    await nextTurn();
    const outcomeAfterCancellation = outcome;
    if (boundary === "find") {
      operationGate.reject(new Error("Late workspace scan failure."));
    } else {
      operationGate.resolve(createDocument(
        "@Step(\"First\")\nfun first() {}",
        firstUri.fsPath,
        "kotlin",
      ));
    }
    assert.deepEqual(await invocation, []);
    await nextTurn();

    assert.deepEqual(outcomeAfterCancellation, { status: "fulfilled", value: [] });
    assert.equal(findCalls.length, 1);
    assert.equal(openCalls.length, boundary === "find" ? 0 : 1);
    assert.equal(cancellation.listenerDisposals(), 1);
    assert.equal(provider.activeOperations.size, 0);
  }
});

test("GaugeCodeLensProvider cleans synchronous cancellation and registration reentrancy", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument("# Checkout\n* Continue");
  let listenerDisposeCalls = 0;
  const provider = new GaugeCodeLensProvider({ vscode: createFakeVscode() });
  const result = provider.provideCodeLenses(document, {
    isCancellationRequested: false,
    onCancellationRequested(listener) {
      listener();
      return {
        dispose() {
          listenerDisposeCalls += 1;
        },
      };
    },
  });

  assert.deepEqual(result, []);
  assert.equal(listenerDisposeCalls, 1);
  assert.equal(provider.activeOperations.size, 0);

  let rawDisposeCalls = 0;
  const registrationVscode = createFakeVscode();
  registrationVscode.languages = {
    registerCodeLensProvider(_selector, registeredProvider) {
      registeredProvider.dispose();
      return {
        dispose() {
          rawDisposeCalls += 1;
        },
      };
    },
  };
  const registrationProvider = new GaugeCodeLensProvider({ vscode: registrationVscode });

  assert.equal(registrationProvider.register(), registrationProvider);
  assert.equal(registrationProvider.register(), registrationProvider);
  assert.equal(rawDisposeCalls, 1);
  assert.deepEqual(registrationProvider.provideCodeLenses(document), []);
});

test("GaugeCodeLensProvider skips execution checks for unsupported documents", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  let configurationCalls = 0;
  let projectRootCalls = 0;
  const vscode = createFakeVscode({
    workspace: {
      getConfiguration() {
        configurationCalls += 1;
        return {
          get() {
            return true;
          },
        };
      },
    },
  });
  const provider = new GaugeCodeLensProvider({
    projectFactory: {
      getGaugeRootFromFilePath() {
        projectRootCalls += 1;
        return "/workspace";
      },
    },
    vscode,
  });
  const document = createDocument(
    "Not a Gauge document.",
    "/workspace/notes.txt",
    "plaintext",
  );

  assert.deepEqual(provider.provideCodeLenses(document), []);
  assert.equal(configurationCalls, 0);
  assert.equal(projectRootCalls, 0);
});

test("GaugeCodeLensProvider neutralizes a throwing then getter after synchronous disposal", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider({ vscode: createFakeVscode() });
  const document = createDocument("# Checkout\n* Continue");
  const thenError = new Error("Detached then getter failed.");
  let thenGetterCalls = 0;
  provider.provideCodeLensesForOperation = () => {
    provider.dispose();
    return {
      get then() {
        thenGetterCalls += 1;
        throw thenError;
      },
    };
  };

  assert.doesNotThrow(() => {
    assert.deepEqual(provider.provideCodeLenses(document), []);
  });
  assert.equal(thenGetterCalls, 1);
  assert.equal(provider.activeOperations.size, 0);
});

test("GaugeCodeLensProvider isolates cancellation while step aliases are pending", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const firstDocument = createDocument(
    "@Step(\"First alias\")\nfun first() {}",
    "/workspace/tests/FirstSteps.kt",
    "kotlin",
  );
  const secondDocument = createDocument(
    "@Step(\"Second alias\")\nfun second() {}",
    "/workspace/tests/SecondSteps.kt",
    "kotlin",
  );
  for (const document of [firstDocument, secondDocument]) {
    document.positionAt = (offset) => (
      offset === 0 ? { line: 0, character: 0 } : { line: 1, character: 14 }
    );
  }
  const firstCancellation = createCancellation();
  const secondCancellation = createCancellation();
  const firstAliases = deferred();
  const secondAliases = deferred();
  const aliasesEntered = deferred();
  const aliasCalls = [];
  const referenceCalls = [];
  const provider = new GaugeCodeLensProvider({
    vscode: createFakeVscode(),
    workspaceStepIndex: {
      referenceCount(document, value) {
        referenceCalls.push({ file: document.fileName, value });
        return 1;
      },
      stepAliasesForEntry(document) {
        aliasCalls.push(document.fileName);
        if (aliasCalls.length === 2) {
          aliasesEntered.resolve();
        }
        return document === firstDocument ? firstAliases.promise : secondAliases.promise;
      },
      stepEntriesForDocument(_sourceDocument, document) {
        return [{
          aliases: [],
          declarationEnd: document.getText().length,
          declarationStart: 0,
        }];
      },
    },
  });

  let firstOutcome = { status: "pending" };
  let secondOutcome = { status: "pending" };
  const firstInvocation = Promise.resolve(provider.provideCodeLenses(
    firstDocument,
    firstCancellation.token,
  ));
  const secondInvocation = Promise.resolve(provider.provideCodeLenses(
    secondDocument,
    secondCancellation.token,
  ));
  firstInvocation.then((value) => {
    firstOutcome = { status: "fulfilled", value };
  });
  secondInvocation.then((value) => {
    secondOutcome = { status: "fulfilled", value };
  });
  await aliasesEntered.promise;

  firstCancellation.cancel();
  await nextTurn();

  assert.deepEqual(firstOutcome, { status: "fulfilled", value: [] });
  assert.deepEqual(secondOutcome, { status: "pending" });
  assert.equal(provider.activeOperations.size, 1);

  secondAliases.resolve(["Second alias"]);
  const secondLenses = await secondInvocation;
  firstAliases.reject(new Error("Late first alias failure."));
  assert.deepEqual(await firstInvocation, []);
  await nextTurn();

  assert.deepEqual(secondLenses.map((lens) => ({
    argument: lens.command.arguments[2],
    title: lens.command.title,
  })), [{ argument: "Second alias", title: "1 reference(s)" }]);
  assert.deepEqual(referenceCalls, [{
    file: secondDocument.fileName,
    value: "Second alias",
  }]);
  assert.equal(firstCancellation.listenerDisposals(), 1);
  assert.equal(secondCancellation.listenerDisposals(), 1);
  assert.equal(firstCancellation.listenerCount(), 0);
  assert.equal(secondCancellation.listenerCount(), 0);
  assert.equal(provider.activeOperations.size, 0);
});

test("GaugeCodeLensProvider stops later indexed aliases when a step count is cancelled", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument(
    "@Step(\"First alias\")\nfun first() {}",
    "/workspace/tests/FirstSteps.kt",
    "kotlin",
  );
  document.positionAt = (offset) => (
    offset === 0 ? { line: 0, character: 0 } : { line: 1, character: 14 }
  );

  for (const settlement of ["resolve", "reject"]) {
    const cancellation = createCancellation();
    const countEntered = deferred();
    const countGate = deferred();
    const countCalls = [];
    const provider = new GaugeCodeLensProvider({
      vscode: createFakeVscode(),
      workspaceStepIndex: {
        referenceCount(_document, value) {
          countCalls.push(value);
          countEntered.resolve();
          return countGate.promise;
        },
        stepAliasesForEntry() {
          return ["First alias", "Second alias"];
        },
        stepEntriesForDocument() {
          return [{
            aliases: [],
            declarationEnd: document.getText().length,
            declarationStart: 0,
          }];
        },
      },
    });
    let outcome = { status: "pending" };
    const invocation = Promise.resolve(provider.provideCodeLenses(document, cancellation.token));
    invocation.then((value) => {
      outcome = { status: "fulfilled", value };
    });
    await countEntered.promise;

    cancellation.cancel();
    await nextTurn();
    const outcomeAfterCancellation = outcome;
    if (settlement === "resolve") {
      countGate.resolve(1);
    } else {
      countGate.reject(new Error("Late indexed count failure."));
    }
    assert.deepEqual(await invocation, []);
    await nextTurn();

    assert.deepEqual(outcomeAfterCancellation, { status: "fulfilled", value: [] });
    assert.deepEqual(countCalls, ["First alias"]);
    assert.equal(cancellation.listenerDisposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
    assert.equal(provider.activeOperations.size, 0);
  }
});

test("GaugeCodeLensProvider preserves live fallback scan error topology", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const sourceDocument = createDocument(
    "# Shared concept\n* Continue",
    "/workspace/concepts/shared.cpt",
    "gauge-concept",
  );
  const diagnosticsProvider = {
    belongsToSourceGaugeProject() {
      return true;
    },
    gaugeProjectRoot() {
      return "/workspace";
    },
    rootForFile() {
      return "/workspace";
    },
  };

  {
    const readyError = new Error("Document store readiness failed.");
    const cancellation = createCancellation();
    const provider = new GaugeCodeLensProvider({
      diagnosticsProvider,
      documentStore: {
        documents() {
          throw new Error("documents should not be read");
        },
        whenReady() {
          return Promise.reject(readyError);
        },
      },
      vscode: createFakeVscode(),
    });

    await assert.rejects(
      provider.provideCodeLenses(sourceDocument, cancellation.token),
      (error) => error === readyError,
    );
    assert.equal(cancellation.listenerDisposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
    assert.equal(provider.activeOperations.size, 0);
  }

  {
    const cancellation = createCancellation();
    const findCalls = [];
    const openCalls = [];
    const staleUri = { fsPath: "/workspace/specs/stale.spec" };
    const liveUri = { fsPath: "/workspace/specs/live.spec" };
    const provider = new GaugeCodeLensProvider({
      diagnosticsProvider,
      vscode: createFakeVscode({
        workspace: {
          findFiles(pattern) {
            findCalls.push(pattern);
            if (findCalls.length === 1) {
              return Promise.reject(new Error("Workspace search failed."));
            }
            if (findCalls.length === 2) {
              return Promise.resolve([staleUri, liveUri]);
            }
            return Promise.resolve([]);
          },
          openTextDocument(uri) {
            openCalls.push(uri.fsPath);
            if (uri === staleUri) {
              return Promise.reject(new Error("Stale document failed."));
            }
            return Promise.resolve(createDocument(
              "# Checkout\n* Shared concept",
              uri.fsPath,
              "gauge",
            ));
          },
          textDocuments: [],
        },
      }),
    });

    const lenses = await provider.provideCodeLenses(sourceDocument, cancellation.token);

    assert.deepEqual(lenses.map((lens) => lens.command.title), ["1 reference(s)"]);
    assert.deepEqual(findCalls, ["**/*.spec", "**/*.cpt", "**/*.md"]);
    assert.deepEqual(openCalls, [staleUri.fsPath, liveUri.fsPath]);
    assert.equal(cancellation.listenerDisposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
    assert.equal(provider.activeOperations.size, 0);
  }
});

// references/gauge/parser/lex.go isDataTable matches /^\s*[tT][aA][bB][lL][eE]\s*:/,
// so any run of whitespace may sit between the keyword and the colon. Verified
// against the real parser: "table  : data.csv" and "table\t: data.csv" both parse
// as an external data table ("Could not resolve table. File data.csv doesn't
// exist."), while the extension only knew "table:" and "table :".
test("GaugeCodeLensProvider accepts any whitespace before the data table colon", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();

  for (const keyword of ["table: ./users.csv", "table : ./users.csv", "table  : ./users.csv", "table\t: ./users.csv"]) {
    const document = createDocument([
      "# Checkout",
      keyword,
      "",
      "## Successful checkout",
      "* Pay",
    ].join("\n"));
    assert.deepEqual(
      provider.provideCodeLenses(document).map((lens) => lens.command.title),
      ["Run Scenario", "Debug Scenario", "Run Spec", "Debug Spec", "Run in parallel"],
      `for ${JSON.stringify(keyword)}`,
    );
  }
});
