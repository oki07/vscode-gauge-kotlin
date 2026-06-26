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
      Variable: "variable",
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

function createDocument(text, fsPath = "/workspace/specs/example.spec") {
  const lines = text.split(/\r?\n/);
  return {
    languageId: "gauge",
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
