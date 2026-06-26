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
