const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode(textDocuments) {
  return {
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
    WorkspaceEdit: class WorkspaceEdit {
      constructor() {
        this.replacements = [];
      }

      replace(uri, range, newText) {
        this.replacements.push({ uri, range, newText });
      }
    },
    workspace: {
      textDocuments,
    },
  };
}

function createRegistrationVscode() {
  let registration;
  return {
    get registration() {
      return registration;
    },
    languages: {
      registerRenameProvider(selector, provider) {
        registration = { selector, provider };
        return { dispose() {} };
      },
    },
  };
}

function createDocument(text, languageId, fsPath) {
  const lines = text.split(/\r?\n/);
  return {
    languageId,
    uri: { fsPath },
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] || "" };
    },
  };
}

test("GaugeRenameProvider renames Gauge steps and Kotlin Step annotations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const otherSpecDocument = createDocument([
    "# Retry",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/retry.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\")",
    "fun pay(amount: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, otherSpecDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Pay with <value>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/specs/retry.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 24 },
        },
        newText: "Pay with <value>",
      },
    ],
  );
});

test("GaugeRenameProvider preserves inline table step identity when renaming", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with account",
    "  | id |",
    "  | 42 |",
    "* Pay with account",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with account <table>\")",
    "fun pay(table: Table) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Pay with ledger",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 18 },
        },
        newText: "Pay with ledger",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 31 },
        },
        newText: "Pay with ledger <table>",
      },
    ],
  );
});

test("GaugeRenameProvider renames concept headings when renaming concept usages", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Reuse payment <card>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const conceptDocument = createDocument([
    "# Reuse payment <method>",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/concepts/payment.cpt");
  const vscode = createFakeVscode([specDocument, conceptDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Shared payment <account>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 22 },
        },
        newText: "Shared payment <account>",
      },
      {
        file: "/workspace/gauge/specs/concepts/payment.cpt",
        range: {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 24 },
        },
        newText: "Shared payment <account>",
      },
    ],
  );
});

test("GaugeRenameProvider registers plaintext Kotlin file rename selector", () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const vscode = createRegistrationVscode();
  const provider = new GaugeRenameProvider({ vscode });

  provider.register();

  assert.deepEqual(vscode.registration.selector, [
    { language: "gauge" },
    { language: "kotlin" },
    { scheme: "file", pattern: "**/*.kt" },
  ]);
  assert.equal(vscode.registration.provider, provider);
});
