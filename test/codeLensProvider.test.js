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
    argument: lens.command.arguments[0],
    flags: lens.command.arguments[1],
  })), [
    {
      line: 0,
      title: "Run Specification",
      command: "gauge.execute",
      argument: "/workspace/specs/example.spec",
      flags: { "hide-suggestion": true, "machine-readable": true },
    },
    {
      line: 0,
      title: "Debug Specification",
      command: "gauge.debug",
      argument: "/workspace/specs/example.spec",
      flags: { "hide-suggestion": true, "machine-readable": true },
    },
    {
      line: 3,
      title: "Run Scenario",
      command: "gauge.execute",
      argument: "/workspace/specs/example.spec:4",
      flags: { "hide-suggestion": true, "machine-readable": true },
    },
    {
      line: 3,
      title: "Debug Scenario",
      command: "gauge.debug",
      argument: "/workspace/specs/example.spec:4",
      flags: { "hide-suggestion": true, "machine-readable": true },
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
      line: 0,
      title: "Run Specification",
      argument: "/workspace/specs/example.md",
    },
    {
      line: 0,
      title: "Debug Specification",
      argument: "/workspace/specs/example.md",
    },
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
      line: 0,
      title: "Run Specification",
      argument: "/workspace/specs/example.spec",
    },
    {
      line: 0,
      title: "Debug Specification",
      argument: "/workspace/specs/example.spec",
    },
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

test("GaugeCodeLensProvider ignores non-Gauge markdown subheadings", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "# Checkout",
    "* Open cart",
    "",
    "### Notes",
    "* Plain markdown bullet",
    "",
  ].join("\n"));

  const lenses = provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    title: lens.command.title,
    argument: lens.command.arguments[0],
  })), [
    {
      line: 0,
      title: "Run Specification",
      argument: "/workspace/specs/example.spec",
    },
    {
      line: 0,
      title: "Debug Specification",
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
      line: 0,
      title: "Run Specification",
      argument: "/workspace/specs/example.spec",
    },
    {
      line: 0,
      title: "Debug Specification",
      argument: "/workspace/specs/example.spec",
    },
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
    argument: lens.command.arguments[0],
    flags: lens.command.arguments[1],
  })), [
    {
      line: 0,
      title: "Run Specification",
      command: "gauge.execute",
      argument: "/workspace/specs/example.spec",
      flags: { "hide-suggestion": true, "machine-readable": true },
    },
    {
      line: 0,
      title: "Debug Specification",
      command: "gauge.debug",
      argument: "/workspace/specs/example.spec",
      flags: { "hide-suggestion": true, "machine-readable": true },
    },
    {
      line: 0,
      title: "Run in parallel",
      command: "gauge.execute.inParallel",
      argument: "/workspace/specs/example.spec",
      flags: { "hide-suggestion": true, "machine-readable": true },
    },
    {
      line: 7,
      title: "Run Scenario",
      command: "gauge.execute",
      argument: "/workspace/specs/example.spec:8",
      flags: { "hide-suggestion": true, "machine-readable": true },
    },
    {
      line: 7,
      title: "Debug Scenario",
      command: "gauge.debug",
      argument: "/workspace/specs/example.spec:8",
      flags: { "hide-suggestion": true, "machine-readable": true },
    },
  ]);
});

test("GaugeCodeLensProvider adds reference lenses for concept headings", async () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const document = createDocument([
    "# Reuse checkout <user>",
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
      character: 0,
      title: "2 reference(s)",
      command: "gauge.showReferences",
      arguments: [
        "file:///workspace/specs/concepts/shared.cpt",
        { line: 0, character: 0 },
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
    "* Log in as \"Alice\"",
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
