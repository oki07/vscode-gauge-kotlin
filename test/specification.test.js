const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

test("buildSpecificationDocument matches the Gauge help template", () => {
  const { buildSpecificationDocument } = require("../src/specification");

  const document = buildSpecificationDocument({ withHelp: true, eol: "\n" });

  assert.equal(
    document.text,
    [
      "# SPECIFICATION HEADING",
      "",
      "This is an executable specification file. This file follows markdown syntax.",
      "Every heading in this file denotes a scenario. Every bulleted point denotes a step.",
      "",
      "> To turn off these comments, set the configuration`gauge.create.specification.withHelp` to false.",
      "",
      "## SCENARIO HEADING",
      "",
      "* step",
      "",
    ].join("\n"),
  );
  assert.deepEqual(document.selection, {
    start: { line: 9, character: 2 },
    end: { line: 9, character: 6 },
  });
});

test("buildSpecificationDocument can omit help comments", () => {
  const { buildSpecificationDocument } = require("../src/specification");

  const document = buildSpecificationDocument({ withHelp: false, eol: "\n" });

  assert.equal(
    document.text,
    [
      "# SPECIFICATION HEADING",
      "",
      "## SCENARIO HEADING",
      "",
      "* step",
      "",
    ].join("\n"),
  );
  assert.deepEqual(document.selection, {
    start: { line: 4, character: 2 },
    end: { line: 4, character: 6 },
  });
});

test("createSpecification writes a spec file under the workspace specs directory", async () => {
  const { createSpecification } = require("../src/specification");
  const writes = new Map();
  const madeDirectories = [];
  let openedDocument;
  let shownDocument;

  const fileSystem = {
    existsSync() {
      return false;
    },
    promises: {
      async mkdir(directory, options) {
        madeDirectories.push({ directory, options });
      },
      async writeFile(filename, content, encoding) {
        writes.set(filename, { content, encoding });
      },
    },
  };

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

  const vscode = {
    Position,
    Range,
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/project" } }],
      getConfiguration(section) {
        assert.equal(section, "gauge");
        return {
          get(key) {
            assert.equal(key, "create.specification.withHelp");
            return false;
          },
        };
      },
      async openTextDocument(filename) {
        openedDocument = { filename };
        return openedDocument;
      },
    },
    window: {
      async showInputBox(options) {
        assert.equal(options.placeHolder, "Enter the file name");
        return "Login";
      },
      async showTextDocument(document, options) {
        shownDocument = { document, options };
      },
      async showErrorMessage(message) {
        throw new Error(message);
      },
    },
  };

  await createSpecification({
    vscode,
    fileSystem,
    pathModule: path.posix,
    eol: "\n",
  });

  assert.deepEqual(madeDirectories, [
    { directory: "/project/specs", options: { recursive: true } },
  ]);
  assert.deepEqual(writes.get("/project/specs/Login.spec"), {
    content: [
      "# SPECIFICATION HEADING",
      "",
      "## SCENARIO HEADING",
      "",
      "* step",
      "",
    ].join("\n"),
    encoding: "utf8",
  });
  assert.deepEqual(shownDocument, {
    document: openedDocument,
    options: {
      selection: new Range(new Position(4, 2), new Position(4, 6)),
    },
  });
});
