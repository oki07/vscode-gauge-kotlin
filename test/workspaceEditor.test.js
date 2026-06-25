const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function createFakeVscode() {
  const appliedEdits = [];
  const openedDocuments = [];
  const shownDocuments = [];

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
      this.entriesList = [];
    }

    set(uri, edits) {
      this.entriesList.push([uri, edits]);
    }

    entries() {
      return this.entriesList;
    }
  }

  return {
    appliedEdits,
    openedDocuments,
    shownDocuments,
    vscode: {
      Position,
      Range,
      WorkspaceEdit,
      window: {
        showTextDocument(document, options) {
          shownDocuments.push({ document, options });
          return Promise.resolve({ document, options });
        },
      },
      workspace: {
        applyEdit(edit) {
          appliedEdits.push(edit);
          return Promise.resolve(true);
        },
        openTextDocument(filename) {
          openedDocuments.push(filename);
          return Promise.resolve({
            fileName: filename,
            uri: { fsPath: filename },
          });
        },
      },
    },
  };
}

function createWorkspaceEdit(filename, edits) {
  return {
    entries() {
      return [[{ fsPath: filename }, edits]];
    },
  };
}

test("WorkspaceEditor creates missing files before applying LSP text edits", async () => {
  const { WorkspaceEditor } = require("../src/refactor/workspaceEditor");
  const madeDirectories = [];
  const writes = [];
  const existing = new Set();
  const filename = "/workspace/src/test/kotlin/NewSteps.kt";
  const edit = createWorkspaceEdit(filename, [
    {
      range: {
        start: { line: 4, character: 2 },
        end: { line: 4, character: 2 },
      },
      newText: "fun step() {}\n",
    },
  ]);
  const { appliedEdits, openedDocuments, shownDocuments, vscode } = createFakeVscode();

  const fileSystem = {
    existsSync(candidate) {
      return existing.has(candidate);
    },
    mkdirSync(directory, options) {
      madeDirectories.push({ directory, options });
      existing.add(directory);
    },
    writeFileSync(candidate, content, options) {
      writes.push({ content, filename: candidate, options });
      existing.add(candidate);
    },
  };

  await new WorkspaceEditor(edit, {
    fileSystem,
    pathModule: path.posix,
    vscode,
  }).applyChanges();

  assert.deepEqual(madeDirectories, [
    { directory: "/workspace/src/test/kotlin", options: { recursive: true } },
  ]);
  assert.deepEqual(writes, [
    {
      content: "",
      filename,
      options: { encoding: "utf8" },
    },
  ]);
  assert.deepEqual(openedDocuments, [filename]);
  assert.deepEqual(shownDocuments[0].options.selection.start, new vscode.Position(4, 0));
  assert.deepEqual(shownDocuments[0].options.selection.end, new vscode.Position(4, 0));
  assert.deepEqual(appliedEdits[0].entries(), [[{ fsPath: filename }, edit.entries()[0][1]]]);
});
