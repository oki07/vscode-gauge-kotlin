const assert = require("node:assert/strict");
const test = require("node:test");

function createDocument(text, languageId = "markdown", fsPath = "/workspace/specs/example.md") {
  const lines = text.split(/\r?\n/);
  return {
    languageId,
    lineCount: lines.length,
    uri: { fsPath },
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] || "" };
    },
  };
}

function createFakeVscode(document, selection) {
  const appliedEdits = [];
  const commandCalls = [];

  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }

  class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }

  class WorkspaceEdit {
    constructor() {
      this.replacements = [];
    }

    replace(uri, range, newText) {
      this.replacements.push({ uri, range, newText });
    }
  }

  return {
    appliedEdits,
    commandCalls,
    vscode: {
      Position,
      Range,
      WorkspaceEdit,
      commands: {
        executeCommand(command) {
          commandCalls.push(command);
          return Promise.resolve(undefined);
        },
      },
      window: {
        activeTextEditor: {
          document,
          selection,
          selections: [selection],
        },
      },
      workspace: {
        applyEdit(edit) {
          appliedEdits.push(edit);
          return Promise.resolve(true);
        },
      },
    },
  };
}

function createSelection(startLine, startCharacter, endLine, endCharacter) {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

test("toggleGaugeLineComment comments Markdown Gauge spec lines with Gauge line comments", async () => {
  const { toggleGaugeLineComment } = require("../src/commentCommand");
  const document = createDocument([
    "# Checkout",
    "* Pay",
    "  * Setup",
  ].join("\n"));
  const { appliedEdits, commandCalls, vscode } = createFakeVscode(
    document,
    createSelection(1, 0, 3, 0),
  );

  const result = await toggleGaugeLineComment(vscode, {
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/specs/example.md");
        return "/workspace";
      },
    },
  });

  assert.equal(result, true);
  assert.deepEqual(commandCalls, []);
  assert.deepEqual(
    appliedEdits[0].replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/specs/example.md",
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 5 },
        },
        newText: "// * Pay",
      },
      {
        file: "/workspace/specs/example.md",
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 9 },
        },
        newText: "  // * Setup",
      },
    ],
  );
});

test("toggleGaugeLineComment comments spec files by extension", async () => {
  const { toggleGaugeLineComment } = require("../src/commentCommand");
  const document = createDocument(
    "* Pay",
    "plaintext",
    "/workspace/specs/example.spec",
  );
  const { appliedEdits, commandCalls, vscode } = createFakeVscode(
    document,
    createSelection(0, 0, 0, 0),
  );

  const result = await toggleGaugeLineComment(vscode, {
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/specs/example.spec");
        return "/workspace";
      },
    },
  });

  assert.equal(result, true);
  assert.deepEqual(commandCalls, []);
  assert.deepEqual(appliedEdits[0].replacements.map((replacement) => ({
    file: replacement.uri.fsPath,
    newText: replacement.newText,
  })), [
    {
      file: "/workspace/specs/example.spec",
      newText: "// * Pay",
    },
  ]);
});

test("toggleGaugeLineComment comments concept files by extension", async () => {
  const { toggleGaugeLineComment } = require("../src/commentCommand");
  const document = createDocument(
    "* Shared step",
    "plaintext",
    "/workspace/specs/concepts/shared.cpt",
  );
  const { appliedEdits, commandCalls, vscode } = createFakeVscode(
    document,
    createSelection(0, 0, 0, 0),
  );

  const result = await toggleGaugeLineComment(vscode, {
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/specs/concepts/shared.cpt");
        return "/workspace";
      },
    },
  });

  assert.equal(result, true);
  assert.deepEqual(commandCalls, []);
  assert.deepEqual(appliedEdits[0].replacements.map((replacement) => ({
    file: replacement.uri.fsPath,
    newText: replacement.newText,
  })), [
    {
      file: "/workspace/specs/concepts/shared.cpt",
      newText: "// * Shared step",
    },
  ]);
});

test("toggleGaugeLineComment comments gauge-concept documents by language id", async () => {
  const { toggleGaugeLineComment } = require("../src/commentCommand");
  const document = createDocument(
    "* Shared step",
    "gauge-concept",
    "/workspace/specs/concepts/shared",
  );
  const { appliedEdits, commandCalls, vscode } = createFakeVscode(
    document,
    createSelection(0, 0, 0, 0),
  );

  const result = await toggleGaugeLineComment(vscode, {
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/specs/concepts/shared");
        return "/workspace";
      },
    },
  });

  assert.equal(result, true);
  assert.deepEqual(commandCalls, []);
  assert.deepEqual(appliedEdits[0].replacements.map((replacement) => ({
    file: replacement.uri.fsPath,
    newText: replacement.newText,
  })), [
    {
      file: "/workspace/specs/concepts/shared",
      newText: "// * Shared step",
    },
  ]);
});

test("toggleGaugeLineComment uncomments Markdown Gauge spec lines", async () => {
  const { toggleGaugeLineComment } = require("../src/commentCommand");
  const document = createDocument([
    "// * Pay",
    "  // * Setup",
  ].join("\n"));
  const { appliedEdits, vscode } = createFakeVscode(
    document,
    createSelection(0, 0, 2, 0),
  );

  const result = await toggleGaugeLineComment(vscode, {
    projectFactory: {
      getGaugeRootFromFilePath() {
        return "/workspace";
      },
    },
  });

  assert.equal(result, true);
  assert.deepEqual(
    appliedEdits[0].replacements.map((replacement) => ({
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 8 },
        },
        newText: "* Pay",
      },
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 12 },
        },
        newText: "  * Setup",
      },
    ],
  );
});

test("toggleGaugeLineComment delegates Markdown files when the resolved root is not a Gauge project", async () => {
  const { DEFAULT_COMMENT_COMMAND, toggleGaugeLineComment } = require("../src/commentCommand");
  const document = createDocument(
    '* Draft "note"',
    "markdown",
    "/workspace/notes/example.md",
  );
  const { appliedEdits, commandCalls, vscode } = createFakeVscode(
    document,
    createSelection(0, 0, 0, 0),
  );

  await toggleGaugeLineComment(vscode, {
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/example.md");
        return "/workspace/notes";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/notes");
        return false;
      },
    },
  });

  assert.deepEqual(appliedEdits, []);
  assert.deepEqual(commandCalls, [DEFAULT_COMMENT_COMMAND]);
});

test("toggleGaugeLineComment delegates Gauge files when project root is unresolved", async () => {
  const { DEFAULT_COMMENT_COMMAND, toggleGaugeLineComment } = require("../src/commentCommand");
  const document = createDocument(
    "* Draft step",
    "plaintext",
    "/workspace/notes/example.spec",
  );
  const { appliedEdits, commandCalls, vscode } = createFakeVscode(
    document,
    createSelection(0, 0, 0, 0),
  );

  await toggleGaugeLineComment(vscode, {
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/example.spec");
        return undefined;
      },
    },
  });

  assert.deepEqual(appliedEdits, []);
  assert.deepEqual(commandCalls, [DEFAULT_COMMENT_COMMAND]);
});
