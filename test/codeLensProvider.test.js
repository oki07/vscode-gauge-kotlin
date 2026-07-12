const assert = require("node:assert/strict");
const test = require("node:test");

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
