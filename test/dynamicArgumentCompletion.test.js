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

test("GaugeDynamicArgumentCompletionProvider ignores non-dynamic argument positions", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "| user |",
    "| ---- |",
    "* Login as <user>",
  ].join("\n"));

  assert.deepEqual(provider.provideCompletionItems(document, new vscode.Position(3, 3)), []);
  assert.deepEqual(provider.provideCompletionItems(document, new vscode.Position(3, 17)), []);
});
