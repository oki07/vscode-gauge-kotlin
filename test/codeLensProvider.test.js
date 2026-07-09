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

test("GaugeCodeLensProvider adds run and debug lenses for specification and scenario headings", () => {
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

test("GaugeCodeLensProvider matches reference run link command arguments and ranges", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
    "* Pay",
    "",
  ].join("\n"), "/workspace/specs/simpleSpecification.spec");

  const lenses = provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    command: lens.command.command,
    range: {
      start: { ...lens.range.start },
      end: { ...lens.range.end },
    },
    title: lens.command.title,
    arguments: lens.command.arguments,
  })), [
    {
      command: "gauge.execute",
      range: {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 12 },
      },
      title: "Run Scenario",
      arguments: ["/workspace/specs/simpleSpecification.spec:3"],
    },
    {
      command: "gauge.debug",
      range: {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 14 },
      },
      title: "Debug Scenario",
      arguments: ["/workspace/specs/simpleSpecification.spec:3"],
    },
    {
      command: "gauge.execute",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 8 },
      },
      title: "Run Spec",
      arguments: ["/workspace/specs/simpleSpecification.spec"],
    },
    {
      command: "gauge.debug",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 10 },
      },
      title: "Debug Spec",
      arguments: ["/workspace/specs/simpleSpecification.spec"],
    },
  ]);
});

test("GaugeCodeLensProvider adds lenses for Markdown Gauge specifications", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/specs/example.md");
        return "/workspace";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace");
        return true;
      },
    },
  });
  const document = createDocument([
    "# Checkout",
    "* Open cart",
    "",
    "## Successful checkout",
    "* Pay",
  ].join("\n"), "/workspace/specs/example.md", "markdown");

  const lenses = provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    title: lens.command.title,
    argument: lens.command.arguments[0],
  })), [
    {
      line: 3,
      title: "Run Scenario",
      argument: "/workspace/specs/example.md:4",
    },
    {
      line: 3,
      title: "Debug Scenario",
      argument: "/workspace/specs/example.md:4",
    },
    {
      line: 0,
      title: "Run Spec",
      argument: "/workspace/specs/example.md",
    },
    {
      line: 0,
      title: "Debug Spec",
      argument: "/workspace/specs/example.md",
    },
  ]);
});

test("GaugeCodeLensProvider adds lenses for spec files by extension", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/specs/example.spec");
        return "/workspace";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace");
        return true;
      },
    },
  });
  const document = createDocument([
    "# Checkout",
    "* Open cart",
    "",
    "## Successful checkout",
    "* Pay",
  ].join("\n"), "/workspace/specs/example.spec", "plaintext");

  const lenses = provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    title: lens.command.title,
    argument: lens.command.arguments[0],
  })), [
    {
      line: 3,
      title: "Run Scenario",
      argument: "/workspace/specs/example.spec:4",
    },
    {
      line: 3,
      title: "Debug Scenario",
      argument: "/workspace/specs/example.spec:4",
    },
    {
      line: 0,
      title: "Run Spec",
      argument: "/workspace/specs/example.spec",
    },
    {
      line: 0,
      title: "Debug Spec",
      argument: "/workspace/specs/example.spec",
    },
  ]);
});

test("GaugeCodeLensProvider ignores Markdown files outside Gauge projects", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/readme.md");
        throw new Error("not a Gauge project");
      },
    },
  });
  const document = createDocument([
    "# Notes",
    "",
    "## Draft",
  ].join("\n"), "/workspace/readme.md", "markdown");

  assert.deepEqual(provider.provideCodeLenses(document), []);
});

test("GaugeCodeLensProvider treats triple-hash headings as scenarios", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "# Checkout",
    "* Open cart",
    "",
    "### Notes",
    "* Reuse cart",
    "",
  ].join("\n"));

  const lenses = provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    title: lens.command.title,
    argument: lens.command.arguments[0],
  })), [
    {
      line: 3,
      title: "Run Scenario",
      argument: "/workspace/specs/example.spec:4",
    },
    {
      line: 3,
      title: "Debug Scenario",
      argument: "/workspace/specs/example.spec:4",
    },
    {
      line: 0,
      title: "Run Spec",
      argument: "/workspace/specs/example.spec",
    },
    {
      line: 0,
      title: "Debug Spec",
      argument: "/workspace/specs/example.spec",
    },
  ]);
});

test("GaugeCodeLensProvider adds lenses for legacy underline headings", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "Checkout",
    "========",
    "* Open cart",
    "",
    "Successful checkout",
    "-------------------",
    "* Pay",
    "",
  ].join("\n"));

  const lenses = provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    title: lens.command.title,
    argument: lens.command.arguments[0],
  })), [
    {
      line: 4,
      title: "Run Scenario",
      argument: "/workspace/specs/example.spec:5",
    },
    {
      line: 4,
      title: "Debug Scenario",
      argument: "/workspace/specs/example.spec:5",
    },
    {
      line: 0,
      title: "Run Spec",
      argument: "/workspace/specs/example.spec",
    },
    {
      line: 0,
      title: "Debug Spec",
      argument: "/workspace/specs/example.spec",
    },
  ]);
});

test("GaugeCodeLensProvider adds run in parallel lens for specification data tables", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "Checkout",
    "========",
    "",
    "  | user | role |",
    "  | ---- | ---- |",
    "  | Bob  | admin |",
    "",
    "Successful checkout",
    "-------------------",
    "* Login as <user>",
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
      line: 7,
      title: "Run Scenario",
      command: "gauge.execute",
      arguments: ["/workspace/specs/example.spec:8"],
    },
    {
      line: 7,
      title: "Debug Scenario",
      command: "gauge.debug",
      arguments: ["/workspace/specs/example.spec:8"],
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
    {
      line: 0,
      title: "Run in parallel",
      command: "gauge.execute.inParallel",
      arguments: ["/workspace/specs/example.spec"],
    },
  ]);
});

test("GaugeCodeLensProvider adds run in parallel lens for table rows without closing pipes", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "Checkout",
    "========",
    "",
    "| user",
    "",
    "Successful checkout",
    "-------------------",
    "* Login as <user>",
    "",
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
