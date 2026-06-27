const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode() {
  return {
    CompletionItem: class CompletionItem {
      constructor(label, kind) {
        this.label = label;
        this.kind = kind;
      }
    },
    CompletionItemKind: {
      Function: "function",
      Variable: "variable",
    },
    SnippetString: class SnippetString {
      constructor(value) {
        this.value = value;
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
  };
}

function createDocument(text, fsPath = "/workspace/specs/example.spec", languageId = "gauge") {
  const lines = text.split(/\r?\n/);
  return {
    languageId,
    uri: { fsPath },
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] };
    },
  };
}

function labels(items) {
  return items.map((item) => item.label);
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

test("GaugeDynamicArgumentCompletionProvider suggests spec data table headers inside dynamic arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "",
    "## Successful checkout",
    "* Login as <u>",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(6, 13));

  assert.deepEqual(labels(items), ["user", "role"]);
  assert.equal(items[0].kind, "variable");
  assert.deepEqual({ ...items[0].range.start }, { line: 6, character: 12 });
  assert.deepEqual({ ...items[0].range.end }, { line: 6, character: 13 });
});

test("GaugeDynamicArgumentCompletionProvider suggests spec data table headers without separators", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "",
    "| user | role |",
    "| Bob  | admin |",
    "| Ada  | owner |",
    "",
    "* Login as <u>",
    "",
    "## Successful checkout",
    "* Confirm <role>",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(6, 13));

  assert.deepEqual(labels(items), ["user", "role"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests headers inside escaped dynamic arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const step = "* Login as <u \\> suffix>";
  const document = createDocument([
    "# Checkout",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "",
    "## Successful checkout",
    step,
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(6, step.indexOf("suffix")));

  assert.deepEqual(labels(items), ["user", "role"]);
  assert.deepEqual({ ...items[0].range.start }, { line: 6, character: step.indexOf("<") + 1 });
  assert.deepEqual({ ...items[0].range.end }, { line: 6, character: step.lastIndexOf(">") });
});

test("GaugeDynamicArgumentCompletionProvider ignores escaped dynamic argument starts", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const step = "* Login as \\<u>";
  const document = createDocument([
    "# Checkout",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "",
    "## Successful checkout",
    step,
  ].join("\n"));

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(6, step.indexOf("u") + 1),
  );

  assert.deepEqual(items, []);
});

test("GaugeDynamicArgumentCompletionProvider suggests escaped table header pipes", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "| user \\| name | role |",
    "| ------------ | ---- |",
    "| Bob          | admin |",
    "",
    "## Successful checkout",
    "* Login as <u>",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(6, 13));

  assert.deepEqual(labels(items), ["user \\| name", "role"]);
});

test("GaugeDynamicArgumentCompletionProvider splits even-backslash table pipes", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "| path\\\\| alias | role |",
    "| ----- | ----- | ---- |",
    "| C:\\\\  | Ada   | admin |",
    "",
    "## Successful checkout",
    "* Login as <p>",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(6, 13));

  assert.deepEqual(labels(items), ["path\\\\", "alias", "role"]);
});

test("GaugeDynamicArgumentCompletionProvider stops table dynamic arguments at unescaped pipes", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const tableRow = "| <u | admin> |";
  const document = createDocument([
    "# Checkout",
    "| user | role |",
    "| ---- | ---- |",
    tableRow,
  ].join("\n"));

  const beforePipeItems = provider.provideCompletionItems(
    document,
    new vscode.Position(3, tableRow.indexOf("u") + 1),
  );
  const afterPipeItems = provider.provideCompletionItems(
    document,
    new vscode.Position(3, tableRow.indexOf("admin")),
  );

  assert.deepEqual(labels(beforePipeItems), ["user", "role"]);
  assert.deepEqual({ ...beforePipeItems[0].range.start }, { line: 3, character: tableRow.indexOf("<") + 1 });
  assert.deepEqual({ ...beforePipeItems[0].range.end }, { line: 3, character: tableRow.indexOf("|", tableRow.indexOf("<")) });
  assert.deepEqual(afterPipeItems, []);
});

test("GaugeDynamicArgumentCompletionProvider suggests dynamic arguments inside inline table body cells", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const specHeader = "  | <field> | value |";
  const specBody = "  | <u>     | admin |";
  const specDocument = createDocument([
    "# Checkout",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "",
    "## Successful checkout",
    "* Login with table",
    specHeader,
    "  | ------- | ----- |",
    specBody,
  ].join("\n"));
  const conceptHeader = "  | <field> | value |";
  const conceptBody = "  | <i>     | admin |";
  const conceptDocument = createDocument([
    "# Shared checkout <item>",
    "* Select <user>",
    conceptHeader,
    "  | ------- | ----- |",
    conceptBody,
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const specItems = provider.provideCompletionItems(
    specDocument,
    new vscode.Position(9, specBody.indexOf("u") + 1),
  );
  const specHeaderItems = provider.provideCompletionItems(
    specDocument,
    new vscode.Position(7, specHeader.indexOf("field")),
  );
  const conceptItems = provider.provideCompletionItems(
    conceptDocument,
    new vscode.Position(4, conceptBody.indexOf("i") + 1),
  );
  const conceptHeaderItems = provider.provideCompletionItems(
    conceptDocument,
    new vscode.Position(2, conceptHeader.indexOf("field")),
  );

  assert.deepEqual(labels(specItems), ["user", "role"]);
  assert.deepEqual(specHeaderItems, []);
  assert.deepEqual(labels(conceptItems), ["item", "user"]);
  assert.deepEqual(conceptHeaderItems, []);
});

test("GaugeDynamicArgumentCompletionProvider ignores dynamic-looking table headers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const header = "| <user> | role |";
  const document = createDocument([
    "# Checkout",
    header,
    "| ------ | ---- |",
    "| Bob    | admin |",
  ].join("\n"));

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(1, header.indexOf("user")),
  );

  assert.deepEqual(items, []);
});

test("GaugeDynamicArgumentCompletionProvider ignores blank-separated table headers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const header = "| <item> | quantity |";
  const document = createDocument([
    "# Inventory",
    "| user |",
    "| Bob  |",
    "",
    header,
    "| book   | 2        |",
  ].join("\n"));

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(4, header.indexOf("item")),
  );

  assert.deepEqual(items, []);
});

test("GaugeDynamicArgumentCompletionProvider ignores context step inline tables", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Prepare users",
    "  | user | role |",
    "  | ---- | ---- |",
    "  | Bob  | admin |",
    "",
    "## Successful checkout",
    "* Login as <u>",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(7, 13));

  assert.deepEqual(labels(items), []);
});

test("GaugeDynamicArgumentCompletionProvider treats indented step markers as comments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "  * Commented setup \"draft\" <ignored>",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "",
    "## Successful checkout",
    "* Login as <u>",
    "* Confirm \"a\"",
  ].join("\n"));

  const indentedItems = provider.provideCompletionItems(
    document,
    new vscode.Position(1, 31),
  );
  const dynamicItems = provider.provideCompletionItems(
    document,
    new vscode.Position(7, 13),
  );
  const staticItems = provider.provideCompletionItems(
    document,
    new vscode.Position(8, 12),
  );

  assert.deepEqual(indentedItems, []);
  assert.deepEqual(labels(dynamicItems), ["user", "role"]);
  assert.deepEqual(labels(staticItems), ["a"]);
});

test("GaugeDynamicArgumentCompletionProvider ignores indented top-level table markers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "  | user | role |",
    "  | ---- | ---- |",
    "",
    "* Login as <u>",
  ].join("\n"));

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(4, 13),
  );

  assert.deepEqual(labels(items), []);
});

test("GaugeDynamicArgumentCompletionProvider ignores standalone indented table body arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const specBody = "  | <u>  | admin |";
  const specDocument = createDocument([
    "# Checkout",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "",
    "  | name | role |",
    "  | ---- | ---- |",
    specBody,
    "* Login as <u>",
  ].join("\n"));
  const conceptBody = "  | <i> |";
  const conceptDocument = createDocument([
    "# Shared checkout <item>",
    "  | name |",
    "  | ---- |",
    conceptBody,
    "* Select <user>",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const specItems = provider.provideCompletionItems(
    specDocument,
    new vscode.Position(7, specBody.indexOf("u") + 1),
  );
  const conceptItems = provider.provideCompletionItems(
    conceptDocument,
    new vscode.Position(3, conceptBody.indexOf("i") + 1),
  );

  assert.deepEqual(specItems, []);
  assert.deepEqual(conceptItems, []);
});

test("GaugeDynamicArgumentCompletionProvider ignores non-step spec arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout <u>",
    "| user | role |",
    "| ---- | ---- |",
    "* Login as \"admin\"",
    "// keep \"a\" as a note",
  ].join("\n"));

  assert.deepEqual(
    provider.provideCompletionItems(document, new vscode.Position(0, 12)),
    [],
  );
  assert.deepEqual(
    provider.provideCompletionItems(document, new vscode.Position(4, 10)),
    [],
  );
});

test("GaugeDynamicArgumentCompletionProvider suggests concept dynamic arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Shared checkout <item> for <user>",
    "* Select <item>",
    "* Confirm <u>",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const items = provider.provideCompletionItems(document, new vscode.Position(2, 12));

  assert.deepEqual(labels(items), ["item", "user", "u"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests escaped concept dynamic arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Shared checkout <user \\> name>",
    "* Select <item>",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const items = provider.provideCompletionItems(document, new vscode.Position(1, 11));

  assert.deepEqual(labels(items), ["user \\> name", "item"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests concept double-hash heading arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const heading = "## Shared checkout <item>";
  const step = "* Select <i>";
  const document = createDocument([
    heading,
    step,
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const stepItems = provider.provideCompletionItems(document, new vscode.Position(1, step.indexOf("i") + 1));
  const headingItems = provider.provideCompletionItems(document, new vscode.Position(0, heading.indexOf("item")));

  assert.deepEqual(labels(stepItems), ["item", "i"]);
  assert.deepEqual(labels(headingItems), ["item", "i"]);
});

test("GaugeDynamicArgumentCompletionProvider ignores indented concept hash heading arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const heading = "  # Shared checkout <item>";
  const step = "* Select <i>";
  const document = createDocument([
    heading,
    step,
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const stepItems = provider.provideCompletionItems(document, new vscode.Position(1, step.indexOf("i") + 1));
  const headingItems = provider.provideCompletionItems(document, new vscode.Position(0, heading.indexOf("item")));

  assert.deepEqual(labels(stepItems), ["i"]);
  assert.deepEqual(headingItems, []);
});

test("GaugeDynamicArgumentCompletionProvider ignores concept table dynamic arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Shared checkout <item>",
    "* Select <user>",
    "| name |",
    "| ---- |",
    "| <tableUser> |",
    "* Confirm <u>",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const items = provider.provideCompletionItems(document, new vscode.Position(5, 12));

  assert.deepEqual(labels(items), ["item", "user", "u"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests spec static arguments inside quotes", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Login as \"admin\"",
    "",
    "## Successful checkout",
    "* Confirm \"a\"",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(4, 12));

  assert.deepEqual(labels(items), ["admin", "a"]);
  assert.equal(items[0].kind, "variable");
  assert.deepEqual({ ...items[0].range.start }, { line: 4, character: 11 });
  assert.deepEqual({ ...items[0].range.end }, { line: 4, character: 12 });
});

test("GaugeDynamicArgumentCompletionProvider excludes teardown static arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "## Successful checkout",
    "* Confirm \"c\"",
    "___",
    "* Cleanup \"temp\"",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(2, 12));

  assert.deepEqual(labels(items), ["c"]);
});

test("GaugeDynamicArgumentCompletionProvider keeps static arguments after indented teardown markers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "## Successful checkout",
    "* Confirm \"c\"",
    "  ___",
    "* Cleanup \"temp\"",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(2, 12));

  assert.deepEqual(labels(items), ["c", "temp"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests escaped spec static arguments inside quotes", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Login as \"Ada \\\"The First\\\"\"",
    "",
    "## Successful checkout",
    "* Confirm \"A\"",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(4, 12));

  assert.deepEqual(labels(items), ["Ada \\\"The First\\\"", "A"]);
  assert.deepEqual({ ...items[0].range.start }, { line: 4, character: 11 });
  assert.deepEqual({ ...items[0].range.end }, { line: 4, character: 12 });
});

test("GaugeDynamicArgumentCompletionProvider ignores escaped static argument starts", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const step = "* Escape \\\"literal\\\" text";
  const document = createDocument([
    "# Checkout",
    step,
    "* Confirm \"a\"",
  ].join("\n"));

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(1, step.indexOf("literal")),
  );

  assert.deepEqual(items, []);
});

test("GaugeDynamicArgumentCompletionProvider suggests concept static arguments inside quotes", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Shared checkout <item>",
    "* Select \"cart\"",
    "* Confirm \"c\"",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const items = provider.provideCompletionItems(document, new vscode.Position(2, 12));

  assert.deepEqual(labels(items), ["cart", "c"]);
});

test("GaugeDynamicArgumentCompletionProvider ignores non-argument positions", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "| user |",
    "| ---- |",
    "* Login as <user>",
    "* Confirm \"user\"",
  ].join("\n"));

  assert.deepEqual(provider.provideCompletionItems(document, new vscode.Position(3, 3)), []);
  assert.deepEqual(provider.provideCompletionItems(document, new vscode.Position(3, 17)), []);
  assert.deepEqual(provider.provideCompletionItems(document, new vscode.Position(4, 16)), []);
});

test("GaugeDynamicArgumentCompletionProvider suggests Kotlin Step aliases on step lines", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Log",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class CheckoutSteps {",
    "  @Step(\"Log in as <user>\", \"Sign in as <user>\")",
    "  fun login(user: String) {}",
    "}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/CheckoutSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), ["Log in as <user>", "Sign in as <user>"]);
  assert.equal(items[0].kind, "function");
  assert.equal(items[0].detail, "step");
  assert.equal(items[0].insertText.value, "Log in as \"${0:user}\"");
  assert.equal(items[0].filterText, "Log in as <user>");
  assert.deepEqual({ ...items[0].range.start }, { line: 2, character: 2 });
  assert.deepEqual({ ...items[0].range.end }, { line: 2, character: 5 });
});

test("GaugeDynamicArgumentCompletionProvider keeps filled static args in Kotlin Step alias snippets", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const stepLine = "* Log in as \"Alice\"";
  const specDocument = createDocument([
    "# Checkout",
    "",
    stepLine,
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/CheckoutSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, stepLine.length));

  assert.deepEqual(labels(items), ["Log in as <user>"]);
  assert.equal(items[0].insertText.value, "Log in as \"${0:Alice}\"");
});

test("GaugeDynamicArgumentCompletionProvider ignores indented step lines for Kotlin Step aliases", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "  * Log",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/CheckoutSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 7));

  assert.deepEqual(items, []);
});

test("GaugeDynamicArgumentCompletionProvider suggests unopened workspace Kotlin Step aliases", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <card>\")",
    "fun pay(card: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/PaymentSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument],
        async findFiles(pattern) {
          assert.equal(pattern, "**/*.kt");
          return [kotlinDocument.uri];
        },
        async openTextDocument(uri) {
          assert.equal(uri, kotlinDocument.uri);
          return kotlinDocument;
        },
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), ["Pay with <card>"]);
  assert.equal(items[0].insertText.value, "Pay with \"${0:card}\"");
});

test("GaugeDynamicArgumentCompletionProvider suggests package wildcard const Step aliases", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Login",
    "",
    "* Log",
  ].join("\n"), "/workspace/gauge/specs/login.spec");
  const constantsDocument = createDocument([
    "package fixtures.steps",
    "",
    "const val LOGIN_STEP = \"Log in as <user>\"",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/fixtures/steps/StepText.kt", "kotlin");
  const kotlinDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.steps.*",
    "",
    "@Step(LOGIN_STEP)",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/fixtures/impl/LoginSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, constantsDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), ["Log in as <user>"]);
  assert.equal(items[0].insertText.value, "Log in as \"${0:user}\"");
});
