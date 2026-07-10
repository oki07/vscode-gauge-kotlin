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

function createDocument(line, fsPath = "/workspace/specs/example.spec", languageId = "gauge") {
  return {
    languageId,
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

test("GaugeArgumentCodeActionProvider converts Markdown spec arguments", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeArgumentCodeActionProvider({ vscode });

  const actions = provider.provideCodeActions(
    createDocument('* Open "cart"', "/workspace/specs/checkout.md", "markdown"),
    createRange(0, 8),
  );

  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, "Convert to Dynamic Parameter");
  const replacement = actions[0].edit.replacements[0];
  assert.deepEqual(replacement.uri, { fsPath: "/workspace/specs/checkout.md" });
  assert.deepEqual({ ...replacement.range.start }, { line: 0, character: 7 });
  assert.deepEqual({ ...replacement.range.end }, { line: 0, character: 13 });
  assert.equal(replacement.newText, "<cart>");
});

test("GaugeArgumentCodeActionProvider ignores Markdown files outside Gauge projects", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const provider = new GaugeArgumentCodeActionProvider({
    vscode: createFakeVscode(),
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        assert.equal(file, "/workspace/README.md");
        throw new Error("not a Gauge project");
      },
    },
  });

  const actions = provider.provideCodeActions(
    createDocument('* Document "cart"', "/workspace/README.md", "markdown"),
    createRange(0, 12),
  );

  assert.deepEqual(actions, []);
});

test("GaugeArgumentCodeActionProvider ignores Gauge files by extension outside Gauge projects", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const checkedFiles = [];
  const provider = new GaugeArgumentCodeActionProvider({
    vscode: createFakeVscode(),
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        checkedFiles.push(file);
        throw new Error("not a Gauge project");
      },
    },
  });

  const specActions = provider.provideCodeActions(
    createDocument('* Document "cart"', "/workspace/docs/example.spec", "plaintext"),
    createRange(0, 12),
  );
  const conceptActions = provider.provideCodeActions(
    createDocument("# Shared <cart>", "/workspace/docs/concepts/shared.cpt", "plaintext"),
    createRange(0, 10),
  );

  assert.deepEqual(specActions, []);
  assert.deepEqual(conceptActions, []);
  assert.deepEqual(checkedFiles, [
    "/workspace/docs/example.spec",
    "/workspace/docs/concepts/shared.cpt",
  ]);
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

test("GaugeArgumentCodeActionProvider converts indented concept hash heading arguments", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const provider = new GaugeArgumentCodeActionProvider({ vscode: createFakeVscode() });
  const line = "  # Shared checkout <item>";

  const actions = provider.provideCodeActions(
    createDocument(line, "/workspace/specs/concepts/shared.cpt"),
    createRange(0, line.indexOf("item")),
  );

  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, "Convert to Static Parameter");
  const replacement = actions[0].edit.replacements[0];
  assert.deepEqual(replacement.uri, { fsPath: "/workspace/specs/concepts/shared.cpt" });
  assert.deepEqual({ ...replacement.range.start }, { line: 0, character: 20 });
  assert.deepEqual({ ...replacement.range.end }, { line: 0, character: 26 });
  assert.equal(replacement.newText, "\"item\"");
});

test("GaugeArgumentCodeActionProvider converts gauge-concept heading arguments by language id", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const provider = new GaugeArgumentCodeActionProvider({
    vscode: createFakeVscode(),
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        assert.equal(file, "/workspace/gauge/specs/concepts/shared");
        return "/workspace/gauge";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/gauge");
        return true;
      },
    },
  });
  const line = '  # Shared checkout <item> as "cart"';
  const document = createDocument(
    line,
    "/workspace/gauge/specs/concepts/shared",
    "gauge-concept",
  );

  const dynamicActions = provider.provideCodeActions(
    document,
    createRange(0, line.indexOf("item")),
  );
  const staticActions = provider.provideCodeActions(
    document,
    createRange(0, line.indexOf("cart")),
  );

  assert.equal(dynamicActions.length, 1);
  assert.equal(dynamicActions[0].title, "Convert to Static Parameter");
  assert.equal(dynamicActions[0].edit.replacements[0].newText, "\"item\"");
  assert.deepEqual({ ...dynamicActions[0].edit.replacements[0].range.start }, { line: 0, character: 20 });
  assert.deepEqual({ ...dynamicActions[0].edit.replacements[0].range.end }, { line: 0, character: 26 });

  assert.equal(staticActions.length, 1);
  assert.equal(staticActions[0].title, "Convert to Dynamic Parameter");
  assert.equal(staticActions[0].edit.replacements[0].newText, "<cart>");
  assert.deepEqual({ ...staticActions[0].edit.replacements[0].range.start }, { line: 0, character: 30 });
  assert.deepEqual({ ...staticActions[0].edit.replacements[0].range.end }, { line: 0, character: 36 });
});

test("GaugeArgumentCodeActionProvider converts indented step marker arguments", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const provider = new GaugeArgumentCodeActionProvider({ vscode: createFakeVscode() });
  const line = "  * Commented setup \"draft\" <ignored>";

  const staticActions = provider.provideCodeActions(
    createDocument(line),
    createRange(0, line.indexOf("draft")),
  );
  const dynamicActions = provider.provideCodeActions(
    createDocument(line),
    createRange(0, line.indexOf("ignored")),
  );

  assert.equal(staticActions.length, 1);
  assert.equal(staticActions[0].title, "Convert to Dynamic Parameter");
  assert.deepEqual({ ...staticActions[0].edit.replacements[0].range.start }, { line: 0, character: 20 });
  assert.deepEqual({ ...staticActions[0].edit.replacements[0].range.end }, { line: 0, character: 27 });
  assert.equal(staticActions[0].edit.replacements[0].newText, "<draft>");
  assert.equal(dynamicActions.length, 1);
  assert.equal(dynamicActions[0].title, "Convert to Static Parameter");
  assert.deepEqual({ ...dynamicActions[0].edit.replacements[0].range.start }, { line: 0, character: 28 });
  assert.deepEqual({ ...dynamicActions[0].edit.replacements[0].range.end }, { line: 0, character: 37 });
  assert.equal(dynamicActions[0].edit.replacements[0].newText, "\"ignored\"");
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

test("GaugeArgumentCodeActionProvider converts arguments on double-star step lines", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const provider = new GaugeArgumentCodeActionProvider({ vscode: createFakeVscode() });

  const actions = provider.provideCodeActions(
    createDocument('** Bold "cart"'),
    createRange(0, 10),
  );

  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, "Convert to Dynamic Parameter");
  const replacement = actions[0].edit.replacements[0];
  assert.deepEqual({ ...replacement.range.start }, { line: 0, character: 8 });
  assert.deepEqual({ ...replacement.range.end }, { line: 0, character: 14 });
  assert.equal(replacement.newText, "<cart>");
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

test("GaugeArgumentCodeActionProvider converts static concept heading arguments to dynamic parameters", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeArgumentCodeActionProvider({ vscode });

  const actions = provider.provideCodeActions(
    createDocument('# Shared "cart"', "/workspace/specs/concepts/shared.cpt"),
    createRange(0, 10),
  );

  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, "Convert to Dynamic Parameter");
  const replacement = actions[0].edit.replacements[0];
  assert.deepEqual(replacement.uri, { fsPath: "/workspace/specs/concepts/shared.cpt" });
  assert.deepEqual({ ...replacement.range.start }, { line: 0, character: 9 });
  assert.deepEqual({ ...replacement.range.end }, { line: 0, character: 15 });
  assert.equal(replacement.newText, "<cart>");
  assert.deepEqual({ ...actions[0].command.arguments[1].start }, { line: 0, character: 10 });
  assert.deepEqual({ ...actions[0].command.arguments[1].end }, { line: 0, character: 14 });
});

test("GaugeArgumentCodeActionProvider does not duplicate undefined-step fixes", () => {
  const { GaugeArgumentCodeActionProvider } = require("../src/argumentCodeActions");
  const { UNDEFINED_STEP_MESSAGE } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeArgumentCodeActionProvider({ vscode });
  const diagnosticRange = new vscode.Range(
    new vscode.Position(0, 0),
    new vscode.Position(0, 19),
  );
  const cursorRange = new vscode.Range(
    new vscode.Position(0, 2),
    new vscode.Position(0, 2),
  );
  const document = {
    languageId: "gauge",
    uri: { fsPath: "/workspace/specs/example.spec" },
    lineAt() {
      return { text: "* Pay with <amount>" };
    },
  };

  const actions = provider.provideCodeActions(document, cursorRange, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range: diagnosticRange }],
  });

  assert.equal(actions.length, 0);
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

test("registerArgumentSelectionCommand selects through the registered command handler", () => {
  const {
    SELECT_ARGUMENT_RANGE_COMMAND,
    registerArgumentSelectionCommand,
  } = require("../src/argumentCodeActions");
  const vscode = createFakeVscode();
  const registeredCommands = [];
  const activeTextEditor = {
    document: { uri: { fsPath: "/workspace/specs/example.spec" } },
    selection: undefined,
  };
  vscode.Selection = class Selection {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  };
  vscode.commands = {
    registerCommand(command, handler) {
      registeredCommands.push({ command, handler });
      return { dispose() {} };
    },
  };
  vscode.window = { activeTextEditor };

  const disposable = registerArgumentSelectionCommand(vscode);
  const range = {
    start: new vscode.Position(0, 8),
    end: new vscode.Position(0, 12),
  };
  const selection = registeredCommands[0].handler(
    { fsPath: "/workspace/specs/example.spec" },
    range,
  );

  assert.equal(typeof disposable.dispose, "function");
  assert.equal(registeredCommands[0].command, SELECT_ARGUMENT_RANGE_COMMAND);
  assert.deepEqual({ ...selection.start }, { line: 0, character: 8 });
  assert.deepEqual({ ...selection.end }, { line: 0, character: 12 });
  assert.deepEqual({ ...activeTextEditor.selection.start }, { line: 0, character: 8 });
  assert.deepEqual({ ...activeTextEditor.selection.end }, { line: 0, character: 12 });
});
