const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode() {
  return {
    CodeAction: class CodeAction {
      constructor(title, kind) {
        this.title = title;
        this.kind = kind;
      }
    },
    CodeActionKind: {
      QuickFix: "quickfix",
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
    WorkspaceEdit: class WorkspaceEdit {
      constructor() {
        this.replacements = [];
      }

      replace(uri, range, newText) {
        this.replacements.push({ uri, range, newText });
      }
    },
  };
}

function createDocument(line, fsPath = "/workspace/specs/example.spec") {
  return {
    uri: { fsPath },
    lineAt() {
      return { text: line };
    },
  };
}

function createRange(line, start, end = start) {
  return {
    start: { line, character: start },
    end: { line, character: end },
  };
}

test("GaugeArgumentCodeActionProvider converts static arguments to dynamic parameters", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeArgumentCodeActionProvider({ vscode });

  const actions = provider.provideCodeActions(
    createDocument('* Open "cart" for <user>'),
    createRange(0, 8),
  );

  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, "Convert to Dynamic Parameter");
  assert.equal(actions[0].kind, "quickfix");
  const replacement = actions[0].edit.replacements[0];
  assert.deepEqual(replacement.uri, { fsPath: "/workspace/specs/example.spec" });
  assert.deepEqual({ ...replacement.range.start }, { line: 0, character: 7 });
  assert.deepEqual({ ...replacement.range.end }, { line: 0, character: 13 });
  assert.equal(replacement.newText, "<cart>");
});

test("GaugeArgumentCodeActionProvider converts dynamic arguments to static parameters", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeArgumentCodeActionProvider({ vscode });

  const actions = provider.provideCodeActions(
    createDocument("# Shared checkout <item>", "/workspace/specs/concepts/shared.cpt"),
    createRange(0, 20),
  );

  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, "Convert to Static Parameter");
  const replacement = actions[0].edit.replacements[0];
  assert.deepEqual(replacement.uri, { fsPath: "/workspace/specs/concepts/shared.cpt" });
  assert.deepEqual({ ...replacement.range.start }, { line: 0, character: 18 });
  assert.deepEqual({ ...replacement.range.end }, { line: 0, character: 24 });
  assert.equal(replacement.newText, "\"item\"");
});

test("GaugeArgumentCodeActionProvider ignores non-step text", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const provider = new GaugeArgumentCodeActionProvider({ vscode: createFakeVscode() });

  assert.deepEqual(
    provider.provideCodeActions(createDocument('Note "cart"'), createRange(0, 7)),
    [],
  );
});

test("GaugeArgumentCodeActionProvider ignores specification and scenario headings", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const provider = new GaugeArgumentCodeActionProvider({ vscode: createFakeVscode() });

  assert.deepEqual(
    provider.provideCodeActions(createDocument("# Specification <name>"), createRange(0, 17)),
    [],
  );
  assert.deepEqual(
    provider.provideCodeActions(createDocument("## Scenario <name>"), createRange(0, 14)),
    [],
  );
});
