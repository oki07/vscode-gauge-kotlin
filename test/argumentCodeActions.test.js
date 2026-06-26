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
  assert.equal(actions[0].command.command, "gauge.selectArgumentRange");
  assert.equal(actions[0].command.title, "Select Gauge Argument");
  assert.deepEqual(actions[0].command.arguments[0], { fsPath: "/workspace/specs/example.spec" });
  assert.deepEqual({ ...actions[0].command.arguments[1].start }, { line: 0, character: 8 });
  assert.deepEqual({ ...actions[0].command.arguments[1].end }, { line: 0, character: 12 });
});

test("GaugeArgumentCodeActionProvider converts escaped static arguments to dynamic parameters", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeArgumentCodeActionProvider({ vscode });

  const actions = provider.provideCodeActions(
    createDocument('* Open "Ada \\"The First\\"" for <user>'),
    createRange(0, 10),
  );

  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, "Convert to Dynamic Parameter");
  const replacement = actions[0].edit.replacements[0];
  assert.deepEqual({ ...replacement.range.start }, { line: 0, character: 7 });
  assert.deepEqual({ ...replacement.range.end }, { line: 0, character: 26 });
  assert.equal(replacement.newText, '<Ada \\"The First\\">');
  assert.deepEqual({ ...actions[0].command.arguments[1].start }, { line: 0, character: 8 });
  assert.deepEqual({ ...actions[0].command.arguments[1].end }, { line: 0, character: 25 });
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

test("GaugeArgumentCodeActionProvider converts concept double-hash heading arguments", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeArgumentCodeActionProvider({ vscode });

  const actions = provider.provideCodeActions(
    createDocument("## Shared checkout <item>", "/workspace/specs/concepts/shared.cpt"),
    createRange(0, 21),
  );

  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, "Convert to Static Parameter");
  const replacement = actions[0].edit.replacements[0];
  assert.deepEqual(replacement.uri, { fsPath: "/workspace/specs/concepts/shared.cpt" });
  assert.deepEqual({ ...replacement.range.start }, { line: 0, character: 19 });
  assert.deepEqual({ ...replacement.range.end }, { line: 0, character: 25 });
  assert.equal(replacement.newText, "\"item\"");
});

test("GaugeArgumentCodeActionProvider converts escaped dynamic arguments to static parameters", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeArgumentCodeActionProvider({ vscode });

  const actions = provider.provideCodeActions(
    createDocument("* Open <item \\> special> now"),
    createRange(0, 14),
  );

  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, "Convert to Static Parameter");
  const replacement = actions[0].edit.replacements[0];
  assert.deepEqual({ ...replacement.range.start }, { line: 0, character: 7 });
  assert.deepEqual({ ...replacement.range.end }, { line: 0, character: 24 });
  assert.equal(replacement.newText, "\"item \\> special\"");
  assert.deepEqual({ ...actions[0].command.arguments[1].start }, { line: 0, character: 8 });
  assert.deepEqual({ ...actions[0].command.arguments[1].end }, { line: 0, character: 23 });
});

test("GaugeArgumentCodeActionProvider ignores escaped argument starts", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const provider = new GaugeArgumentCodeActionProvider({ vscode: createFakeVscode() });

  assert.deepEqual(
    provider.provideCodeActions(createDocument("* Literal \\<user> now"), createRange(0, 13)),
    [],
  );
  assert.deepEqual(
    provider.provideCodeActions(createDocument('* Literal \\"admin" now'), createRange(0, 13)),
    [],
  );
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

test("GaugeArgumentCodeActionProvider ignores quoted concept heading text", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const provider = new GaugeArgumentCodeActionProvider({ vscode: createFakeVscode() });

  assert.deepEqual(
    provider.provideCodeActions(
      createDocument('# Shared "cart"', "/workspace/specs/concepts/shared.cpt"),
      createRange(0, 10),
    ),
    [],
  );
});

test("selectArgumentRange selects the converted Gauge argument body", () => {
  const { selectArgumentRange } = require("../src/argumentCodeActions");
  const vscode = createFakeVscode();
  const activeTextEditor = {
    document: { uri: { fsPath: "/workspace/specs/example.spec" } },
    selection: undefined,
  };
  vscode.window = { activeTextEditor };

  selectArgumentRange(vscode, { fsPath: "/workspace/specs/example.spec" }, {
    start: new vscode.Position(0, 8),
    end: new vscode.Position(0, 12),
  });

  assert.deepEqual({ ...activeTextEditor.selection.start }, { line: 0, character: 8 });
  assert.deepEqual({ ...activeTextEditor.selection.end }, { line: 0, character: 12 });
});
