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

test("buildConceptDocument matches the Gauge concept file template", () => {
  const { buildConceptDocument } = require("../src/specification");

  const document = buildConceptDocument({
    date: "2026-06-26",
    eol: "\n",
    user: "Ada",
  });

  assert.equal(
    document.text,
    [
      "Created by Ada on 2026-06-26",
      "",
      "This is a concept file with following syntax for each concept.",
      "# Concept Heading",
      "* step1",
      "* step2",
    ].join("\n"),
  );
  assert.deepEqual(document.selection, {
    start: { line: 3, character: 2 },
    end: { line: 3, character: 17 },
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

test("createSpecification asks for project and spec directory when multiple choices exist", async () => {
  const { createSpecification } = require("../src/specification");
  const writes = new Map();
  const madeDirectories = [];
  const quickPicks = [];
  const specDirRequests = [];
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
      workspaceFolders: [
        { uri: { fsPath: "/workspace/shop" } },
        { uri: { fsPath: "/workspace/admin" } },
      ],
      getConfiguration() {
        return {
          get() {
            return false;
          },
        };
      },
      async openTextDocument(filename) {
        return { filename };
      },
    },
    window: {
      async showQuickPick(items, options) {
        quickPicks.push({ items, options });
        if (quickPicks.length === 1) {
          return items[1];
        }
        return "features/specs";
      },
      async showInputBox() {
        return "Checkout";
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
    async specDirsProvider(projectRoot) {
      specDirRequests.push(projectRoot);
      return ["specs", "features/specs"];
    },
  });

  assert.deepEqual(specDirRequests, ["/workspace/admin"]);
  assert.deepEqual(quickPicks, [
    {
      items: [
        { label: "shop", description: "/workspace/shop" },
        { label: "admin", description: "/workspace/admin" },
      ],
      options: { canPickMany: false, placeHolder: "Choose a project" },
    },
    {
      items: ["specs", "features/specs"],
      options: {
        canPickMany: false,
        placeHolder: "Choose the folder in which the specification should be created",
      },
    },
  ]);
  assert.deepEqual(madeDirectories, [
    { directory: "/workspace/admin/features/specs", options: { recursive: true } },
  ]);
  assert.deepEqual(writes.get("/workspace/admin/features/specs/Checkout.spec"), {
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
    document: { filename: "/workspace/admin/features/specs/Checkout.spec" },
    options: {
      selection: new Range(new Position(4, 2), new Position(4, 6)),
    },
  });
});

test("createConcept writes a concept file under the workspace specs directory", async () => {
  const { createConcept } = require("../src/specification");
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
      async openTextDocument(filename) {
        openedDocument = { filename };
        return openedDocument;
      },
    },
    window: {
      async showInputBox(options) {
        assert.equal(options.placeHolder, "Enter the concept file name");
        return "Authentication";
      },
      async showTextDocument(document, options) {
        shownDocument = { document, options };
      },
      async showErrorMessage(message) {
        throw new Error(message);
      },
    },
  };

  await createConcept({
    date: "2026-06-26",
    eol: "\n",
    fileSystem,
    pathModule: path.posix,
    user: "Ada",
    vscode,
  });

  assert.deepEqual(madeDirectories, [
    { directory: "/project/specs", options: { recursive: true } },
  ]);
  assert.deepEqual(writes.get("/project/specs/Authentication.cpt"), {
    content: [
      "Created by Ada on 2026-06-26",
      "",
      "This is a concept file with following syntax for each concept.",
      "# Concept Heading",
      "* step1",
      "* step2",
    ].join("\n"),
    encoding: "utf8",
  });
  assert.deepEqual(shownDocument, {
    document: openedDocument,
    options: {
      selection: new Range(new Position(3, 2), new Position(3, 17)),
    },
  });
});
