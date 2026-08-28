const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((receivedResolve, receivedReject) => {
    reject = receivedReject;
    resolve = receivedResolve;
  });
  return { promise, reject, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createCancellation(cancelled = false) {
  let cancellationRequested = cancelled;
  let disposals = 0;
  let registrations = 0;
  const listeners = new Set();
  const token = {
    get isCancellationRequested() {
      return cancellationRequested;
    },
    onCancellationRequested(listener) {
      registrations += 1;
      listeners.add(listener);
      let disposed = false;
      return {
        dispose() {
          if (disposed) {
            return;
          }
          disposed = true;
          disposals += 1;
          listeners.delete(listener);
        },
      };
    },
  };
  return {
    cancel() {
      if (cancellationRequested) {
        return;
      }
      cancellationRequested = true;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    disposals() {
      return disposals;
    },
    listenerCount() {
      return listeners.size;
    },
    registrations() {
      return registrations;
    },
    token,
  };
}

function createFakeVscode() {
  return {
    CompletionItem: class CompletionItem {
      constructor(label, kind) {
        this.label = label;
        this.kind = kind;
      }
    },
    CompletionItemKind: {
      Function: 2,
      Text: 0,
      Variable: 5,
    },
    SnippetString: class SnippetString {
      constructor(value) {
        this.value = value;
      }
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

function createDocument(text, fsPath = "/workspace/specs/example.spec", languageId = "gauge") {
  const lines = text.split(/\r?\n/);
  return {
    languageId,
    uri: { fsPath },
    getText() {
      return text;
    },
    // TextDocument.lineAt throws for a line outside [0, lineCount).
    lineAt(line) {
      if (typeof line !== "number" || line < 0 || line >= lines.length) {
        throw new Error("Illegal value for `line`");
      }
      return { text: lines[line] };
    },
  };
}

function labels(items) {
  return items.map((item) => item.label);
}

function createProjectFactory() {
  return {
    getGaugeRootFromFilePath(filename) {
      if (!filename.startsWith("/workspace/gauge/")) {
        throw new Error("not a Gauge project file");
      }
      return "/workspace/gauge";
    },
  };
}

function createMultiProjectFactory() {
  return {
    getGaugeRootFromFilePath(filename) {
      if (filename.startsWith("/workspace/project-a/")) {
        return "/workspace/project-a";
      }
      if (filename.startsWith("/workspace/project-b/")) {
        return "/workspace/project-b";
      }
      throw new Error("not a Gauge project file");
    },
  };
}

// A doc string payload is arbitrary text, so a payload line that looks like a
// step must not make the CLOSING fence read as an opening one. That mistake
// killed every completion on the step after such a block.
test("GaugeDynamicArgumentCompletionProvider completes after a doc string whose payload looks like a step", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "| user |",
    "| ---- |",
    "| Bob  |",
    "",
    "## Scenario",
    "* Post a payload",
    "\"\"\"",
    "notes:",
    "* first bullet",
    "\"\"\"",
    "* Login as <",
  ].join("\n"));

  assert.deepEqual(
    labels(provider.provideCompletionItems(document, new vscode.Position(11, 12))),
    ["user"],
  );
});

// Gauge parses a """ block as the preceding step's single special_string
// argument - data, not syntax - so no step or parameter exists at a position
// inside it. Offering completions there let one silently rewrite the payload.
test("GaugeDynamicArgumentCompletionProvider offers nothing inside a doc string", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "| user |",
    "| ---- |",
    "| Bob  |",
    "",
    "## Scenario",
    "* Post a payload",
    "\"\"\"",
    "* not a step <u>",
    "\"\"\"",
  ].join("\n"));

  assert.deepEqual(
    provider.provideCompletionItems(document, new vscode.Position(8, 16)),
    [],
  );
});

// references/gauge/parser/lex.go isStep requires text[1] != '*', so a Markdown
// bold line is a comment. isStepLine in this same file already encodes that;
// stepCompletionRange did not, so accepting a completion on "**bold**" rewrote
// the comment into a step.
test("GaugeDynamicArgumentCompletionProvider offers nothing on a Markdown bold line", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "",
    "## Scenario",
    "* Real step",
    "**bold**",
  ].join("\n"));

  assert.deepEqual(
    provider.provideCompletionItems(document, new vscode.Position(4, 6)),
    [],
  );
});

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
  assert.equal(items[0].kind, vscode.CompletionItemKind.Variable);
  assert.deepEqual({ ...items[0].range.start }, { line: 6, character: 12 });
  assert.deepEqual({ ...items[0].range.end }, { line: 6, character: 13 });
});

// Gauge compares the trimmed line (references/gauge/parser/lex.go), so a legacy
// concept heading whose underline carries trailing whitespace still defines the
// concept and its parameters. isLegacyScenarioHeadingAt already trimmed while
// isLegacySpecHeadingAt and isLegacyConceptHeadingAt did not, so completion
// refused to open inside such a heading.
test("GaugeDynamicArgumentCompletionProvider completes in a legacy concept heading with an untidy underline", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const headingLine = "Shared checkout <i>";
  const document = createDocument([
    headingLine,
    "===================   ",
    "* Select <user>",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(0, headingLine.indexOf("i") + 1),
  );

  assert.deepEqual(labels(items), ["i", "user"]);
});

test("GaugeDynamicArgumentCompletionProvider uses the shared workspace step index", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const document = createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
    "* ",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec");
  document.getText = () => {
    throw new Error("indexed step completion must read only the current line");
  };
  const calls = [];
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
    workspaceStepIndex: {
      completionEntries(sourceDocument, position) {
        calls.push({ position, sourceDocument });
        return [{ detail: "step", label: "Open cart" }];
      },
    },
  });
  provider.workspaceDocuments = () => {
    throw new Error("legacy workspace scan should not run");
  };

  const position = new vscode.Position(3, 2);
  const items = await provider.provideCompletionItems(document, position);

  assert.deepEqual(labels(items), ["Open cart"]);
  assert.deepEqual(calls, [{ position, sourceDocument: document }]);
});

test("GaugeDynamicArgumentCompletionProvider uses indexed Gauge tags", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const document = createDocument([
    "# Checkout",
    "tags: ",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec");
  document.getText = () => {
    throw new Error("indexed tag completion must read only nearby lines");
  };
  const calls = [];
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
    workspaceStepIndex: {
      tagEntries(sourceDocument) {
        calls.push(sourceDocument);
        return ["smoke", "regression"];
      },
    },
  });
  provider.workspaceDocuments = () => {
    throw new Error("tag completion must not rescan workspace documents");
  };

  const items = await provider.provideCompletionItems(document, new vscode.Position(1, 6));

  assert.deepEqual(labels(items), ["smoke", "regression"]);
  assert.deepEqual(calls, [document]);
});

test("GaugeDynamicArgumentCompletionProvider uses indexed parameters", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const document = createDocument([
    "# Checkout",
    "## Pay",
    "* Pay with <cu>",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec");
  document.getText = () => {
    throw new Error("indexed parameter completion must read only nearby lines");
  };
  const calls = [];
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
    workspaceStepIndex: {
      parameterEntries(sourceDocument, position, argumentType) {
        calls.push({ argumentType, position, sourceDocument });
        return ["customer", "account"];
      },
    },
  });

  const position = new vscode.Position(2, 14);
  const items = await provider.provideCompletionItems(document, position);

  assert.deepEqual(labels(items), ["customer", "account"]);
  assert.deepEqual(calls, [{ argumentType: "dynamic", position, sourceDocument: document }]);
});

test("GaugeDynamicArgumentCompletionProvider suggests external CSV data table headers inside dynamic arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const reads = [];
  const provider = new GaugeDynamicArgumentCompletionProvider({
    fileSystem: {
      readFileSync(filename, encoding) {
        reads.push({ encoding, filename });
        assert.equal(filename, "/workspace/gauge/specs/csv.csv");
        assert.equal(encoding, "utf8");
        return "one,two\n1,2\n";
      },
    },
    pathModule: path.posix,
    vscode,
  });
  const document = createDocument([
    "# Checkout",
    "Table : ./csv.csv",
    "",
    "## Successful checkout",
    "* Login as <o>",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec");

  const items = provider.provideCompletionItems(document, new vscode.Position(4, 13));

  assert.deepEqual(labels(items), ["one", "two"]);
  assert.deepEqual(reads, [
    {
      encoding: "utf8",
      filename: "/workspace/gauge/specs/csv.csv",
    },
  ]);
});

test("GaugeDynamicArgumentCompletionProvider resolves external CSV headers from Gauge data dir", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const reads = [];
  const provider = new GaugeDynamicArgumentCompletionProvider({
    fileSystem: {
      readFileSync(filename, encoding) {
        reads.push({ encoding, filename });
        assert.equal(encoding, "utf8");
        if (filename === "/workspace/gauge/data/csv.csv") {
          return "one,two\n1,2\n";
        }
        if (filename === "/workspace/gauge/env/default/default.properties") {
          return "gauge_data_dir = data\n";
        }
        throw new Error(`unexpected read: ${filename}`);
      },
    },
    pathModule: path.posix,
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/checkout.spec");
        return "/workspace/gauge";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/gauge");
        return true;
      },
    },
    vscode,
  });
  const document = createDocument([
    "# Checkout",
    "Table : csv.csv",
    "",
    "## Successful checkout",
    "* Login as <o>",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec");

  const items = provider.provideCompletionItems(document, new vscode.Position(4, 13));

  assert.deepEqual(labels(items), ["one", "two"]);
  assert.ok(reads.some((entry) => entry.filename === "/workspace/gauge/data/csv.csv"));
});

test("GaugeDynamicArgumentCompletionProvider prefers environment Gauge data dir for external CSV headers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const originalGaugeDataDir = process.env.gauge_data_dir;
  process.env.gauge_data_dir = "env-data";
  try {
    const provider = new GaugeDynamicArgumentCompletionProvider({
      fileSystem: {
        readFileSync(filename, encoding) {
          assert.equal(encoding, "utf8");
          if (filename === "/workspace/gauge/env-data/csv.csv") {
            return "envOne,envTwo\n1,2\n";
          }
          if (filename === "/workspace/gauge/env/default/default.properties") {
            return "gauge_data_dir = property-data\n";
          }
          throw new Error(`unexpected read: ${filename}`);
        },
      },
      pathModule: path.posix,
      projectFactory: {
        getGaugeRootFromFilePath(filename) {
          assert.equal(filename, "/workspace/gauge/specs/checkout.spec");
          return "/workspace/gauge";
        },
        isGaugeProject(root) {
          assert.equal(root, "/workspace/gauge");
          return true;
        },
      },
      vscode,
    });
    const document = createDocument([
      "# Checkout",
      "Table : csv.csv",
      "",
      "## Successful checkout",
      "* Login as <e>",
    ].join("\n"), "/workspace/gauge/specs/checkout.spec");

    const items = provider.provideCompletionItems(document, new vscode.Position(4, 13));

    assert.deepEqual(labels(items), ["envOne", "envTwo"]);
  } finally {
    if (originalGaugeDataDir === undefined) {
      delete process.env.gauge_data_dir;
    } else {
      process.env.gauge_data_dir = originalGaugeDataDir;
    }
  }
});

test("GaugeDynamicArgumentCompletionProvider uses project default csv delimiter for external headers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const originalDelimiter = process.env.csv_delimiter;
  delete process.env.csv_delimiter;
  const reads = [];
  try {
    const provider = new GaugeDynamicArgumentCompletionProvider({
      fileSystem: {
        readFileSync(filename, encoding) {
          reads.push({ encoding, filename });
          assert.equal(encoding, "utf8");
          if (filename === "/workspace/gauge/csv.csv") {
            return "one;two\n1;2\n";
          }
          if (filename === "/workspace/gauge/env/default/default.properties") {
            return "csv_delimiter = ;\n";
          }
          throw new Error(`unexpected read: ${filename}`);
        },
      },
      pathModule: path.posix,
      projectFactory: {
        getGaugeRootFromFilePath(filename) {
          assert.equal(filename, "/workspace/gauge/specs/checkout.spec");
          return "/workspace/gauge";
        },
        isGaugeProject(root) {
          assert.equal(root, "/workspace/gauge");
          return true;
        },
      },
      vscode,
    });
    const document = createDocument([
      "# Checkout",
      "Table : ./csv.csv",
      "",
      "## Successful checkout",
      "* Login as <o>",
    ].join("\n"), "/workspace/gauge/specs/checkout.spec");

    const items = provider.provideCompletionItems(document, new vscode.Position(4, 13));

    assert.deepEqual(labels(items), ["one", "two"]);
    // Each property lookup first resolves the environment directory from the
    // manifest (references/gauge/env/env.go getEnvDir) and then reads the
    // properties beside it. Deliberately not memoized: a cached directory would
    // answer stale after the manifest changed.
    assert.deepEqual(reads.map((entry) => entry.filename), [
      "/workspace/gauge/manifest.json",
      "/workspace/gauge/env/default/default.properties",
      "/workspace/gauge/csv.csv",
      "/workspace/gauge/manifest.json",
      "/workspace/gauge/env/default/default.properties",
      "/workspace/gauge/manifest.json",
      "/workspace/gauge/env/default/default.properties",
    ]);
    assert.ok(reads.every((entry) => entry.encoding === "utf8"));
  } finally {
    if (originalDelimiter === undefined) {
      delete process.env.csv_delimiter;
    } else {
      process.env.csv_delimiter = originalDelimiter;
    }
  }
});

// references/gauge/parser/lex.go isDataTable matches
// /^\s*[tT][aA][bB][lL][eE]\s*:/, so the keyword is case insensitive and any run
// of whitespace may precede the colon. Verified against the real parser:
// "table  : data.csv" and "table\t: data.csv" both parse as an external data
// table.
test("GaugeDynamicArgumentCompletionProvider accepts any Gauge table keyword spacing for external CSV headers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const reads = [];
  const provider = new GaugeDynamicArgumentCompletionProvider({
    fileSystem: {
      readFileSync(filename, encoding) {
        reads.push({ encoding, filename });
        return "one,two\n1,2\n";
      },
    },
    pathModule: path.posix,
    vscode,
  });
  const document = createDocument([
    "# Checkout",
    "Table   : ./csv.csv",
    "",
    "## Successful checkout",
    "* Login as <o>",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec");

  const items = provider.provideCompletionItems(document, new vscode.Position(4, 13));

  assert.deepEqual(labels(items), ["one", "two"]);
  assert.deepEqual(reads, [{ encoding: "utf8", filename: "/workspace/gauge/specs/csv.csv" }]);
});

test("GaugeDynamicArgumentCompletionProvider suggests spec dynamic step arguments inside dynamic arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Seed <customer>",
    "",
    "## Successful checkout",
    "* Login as <cu>",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(4, 13));

  assert.deepEqual(labels(items), ["customer"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests multiline spec dynamic arguments when project allows them", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const originalAllowMultiline = process.env.allow_multiline_step;
  delete process.env.allow_multiline_step;
  const provider = new GaugeDynamicArgumentCompletionProvider({
    fileSystem: {
      readFileSync(filename, encoding) {
        assert.equal(filename, "/workspace/gauge/env/default/default.properties");
        assert.equal(encoding, "utf8");
        return "allow_multiline_step = true\n";
      },
    },
    pathModule: path.posix,
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        if (filename.startsWith("/workspace/gauge/")) {
          return "/workspace/gauge";
        }
        throw new Error("not a Gauge project file");
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/gauge");
        return true;
      },
    },
    vscode,
  });
  const document = createDocument([
    "# Checkout",
    "* Seed",
    "<customer>",
    "",
    "## Successful checkout",
    "* Login as <cu>",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec");

  try {
    const items = provider.provideCompletionItems(document, new vscode.Position(5, 13));

    assert.deepEqual(labels(items), ["customer"]);
  } finally {
    if (originalAllowMultiline === undefined) {
      delete process.env.allow_multiline_step;
    } else {
      process.env.allow_multiline_step = originalAllowMultiline;
    }
  }
});

test("GaugeDynamicArgumentCompletionProvider suggests Gauge tags on tag lines", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const document = createDocument([
    "# Checkout",
    "tags: smoke, fast",
    "",
    "## Pay",
    "tags: ",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
  const otherDocument = createDocument([
    "# Login",
    "tags: auth, with space",
  ].join("\n"), "/workspace/gauge/specs/login.spec", "gauge");
  vscode.workspace = {
    textDocuments: [otherDocument],
  };
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const items = await provider.provideCompletionItems(document, new vscode.Position(4, 6));

  assert.deepEqual(labels(items), ["smoke", "fast", "auth", "with space"]);
  assert.equal(items[0].detail, "Tag");
  assert.equal(items[0].kind, vscode.CompletionItemKind.Variable);
  assert.equal(items[0].filterText, "smoke");
  assert.equal(items[0].insertText, " smoke");
  assert.equal(items[0].sortText, "asmoke");
  assert.deepEqual({ ...items[0].range.start }, { line: 4, character: 5 });
  assert.deepEqual({ ...items[0].range.end }, { line: 4, character: 6 });
});

test("GaugeDynamicArgumentCompletionProvider requires Gauge tag keyword spacing", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const document = createDocument([
    "# Checkout",
    "tags: smoke",
    "",
    "## Pay",
    "ta gs: ",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const items = await provider.provideCompletionItems(document, new vscode.Position(4, 7));

  assert.deepEqual(labels(items), []);
});

test("GaugeDynamicArgumentCompletionProvider suggests Gauge tags on tag continuation lines", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const document = createDocument([
    "# Checkout",
    "tags: smoke,",
    "fast,",
    "regression",
    "## Pay",
    "tags: fast",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const items = await provider.provideCompletionItems(document, new vscode.Position(3, "reg".length));

  assert.deepEqual(labels(items), ["smoke", "fast", "regression"]);
  assert.equal(items[2].detail, "Tag");
  assert.deepEqual({ ...items[2].range.start }, { line: 3, character: 0 });
  assert.deepEqual({ ...items[2].range.end }, { line: 3, character: "regression".length });
});

test("GaugeDynamicArgumentCompletionProvider ignores tag completions on table keyword lines", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const document = createDocument([
    "# Checkout",
    "tags: smoke,",
    "table: users.csv",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const items = await provider.provideCompletionItems(document, new vscode.Position(2, "table: ".length));

  assert.deepEqual(labels(items), []);
});

test("GaugeDynamicArgumentCompletionProvider ignores tag completions on Gauge syntax lines", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });
  const cases = [
    "# Next specification",
    "## Next scenario",
    "* Pay",
    "___",
    "| name |",
    "// disabled",
  ];

  for (const line of cases) {
    const document = createDocument([
      "# Checkout",
      "tags: smoke,",
      line,
    ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
    const items = await provider.provideCompletionItems(
      document,
      new vscode.Position(2, Math.min(3, line.length)),
    );

    assert.deepEqual(items.filter((item) => item.detail === "Tag"), []);
  }
});

test("GaugeDynamicArgumentCompletionProvider ignores tag completions on legacy heading lines", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });
  const cases = [
    ["Checkout flow", "============="],
    ["Successful checkout", "-------------------"],
  ];

  for (const [heading, underline] of cases) {
    const document = createDocument([
      "# Checkout",
      "tags: smoke,",
      heading,
      underline,
    ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
    const items = await provider.provideCompletionItems(
      document,
      new vscode.Position(2, Math.min(3, heading.length)),
    );

    assert.deepEqual(items.filter((item) => item.detail === "Tag"), []);
  }
});

test("GaugeDynamicArgumentCompletionProvider preserves tag separators when editing in the middle", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const document = createDocument([
    "# Checkout",
    "tags: smoke, fast, slow",
    "",
    "## Pay",
    "tags: smoke, fast, slow",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const items = await provider.provideCompletionItems(document, new vscode.Position(4, "tags: smoke,".length));

  assert.deepEqual(labels(items), ["smoke", "fast", "slow"]);
  assert.equal(items[1].filterText, "fast,");
  assert.equal(items[1].insertText, " fast,");
  assert.deepEqual({ ...items[1].range.start }, { line: 4, character: "tags: smoke,".length });
  assert.deepEqual({ ...items[1].range.end }, { line: 4, character: "tags: smoke, fast,".length });
});

test("GaugeDynamicArgumentCompletionProvider suggests scenario data table headers inside scenario dynamic arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "",
    "## Successful checkout",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "* Login as <u>",
    "",
    "## Failed checkout",
    "| error |",
    "| ----- |",
    "| empty |",
    "* Report <e>",
  ].join("\n"));

  const successfulItems = provider.provideCompletionItems(document, new vscode.Position(6, 13));
  const failedItems = provider.provideCompletionItems(document, new vscode.Position(12, 10));

  assert.deepEqual(labels(successfulItems), ["user", "role", "e"]);
  assert.deepEqual(labels(failedItems), ["error", "u"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests legacy scenario data table headers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "",
    "Successful checkout",
    "-------------------",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "* Login as <u>",
    "",
    "Failed checkout",
    "---------------",
    "| error |",
    "| ----- |",
    "| empty |",
    "* Report <e>",
  ].join("\n"));

  const successfulItems = provider.provideCompletionItems(document, new vscode.Position(7, 13));
  const failedItems = provider.provideCompletionItems(document, new vscode.Position(14, 10));

  assert.deepEqual(labels(successfulItems), ["user", "role", "e"]);
  assert.deepEqual(labels(failedItems), ["error", "u"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests spec data table headers without separators", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "",
    "| user | role |",
    "| Bob  | admin |",
    "| Ada  | owner |",
    "",
    "* Login as <u>",
    "",
    "## Successful checkout",
    "* Confirm <role>",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(6, 13));

  assert.deepEqual(labels(items), ["user", "role"]);
});

// A "### Notes" line is a comment, not a scenario heading
// (references/gauge/parser/lex.go isScenarioHeading), so the table below it is no
// longer scenario scoped. Against the real parser this document has no scenario
// at all and the table becomes the spec data table; the extension's spec data
// table walk stops at the context step above it, which is recorded as an open
// item in docs/parity-progress.md. This test keeps its original intent - scenario
// scoped table headers - by using a real scenario heading.
test("GaugeDynamicArgumentCompletionProvider reads scenario table headers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Open cart",
    "## Notes",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "",
    "* Login as <u>",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(7, 13));

  assert.deepEqual(labels(items), ["user", "role"]);
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

test("GaugeDynamicArgumentCompletionProvider ignores escaped dynamic argument starts", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const step = "* Login as \\<u>";
  const document = createDocument([
    "# Checkout",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "",
    "## Successful checkout",
    step,
  ].join("\n"));

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(6, step.indexOf("u") + 1),
  );

  assert.deepEqual(items, []);
});

test("GaugeDynamicArgumentCompletionProvider suggests escaped table header pipes", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "| user \\| name | role |",
    "| ------------ | ---- |",
    "| Bob          | admin |",
    "",
    "## Successful checkout",
    "* Login as <u>",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(6, 13));

  assert.deepEqual(labels(items), ["user \\| name", "role"]);
});

test("GaugeDynamicArgumentCompletionProvider splits even-backslash table pipes", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "| path\\\\| alias | role |",
    "| ----- | ----- | ---- |",
    "| C:\\\\  | Ada   | admin |",
    "",
    "## Successful checkout",
    "* Login as <p>",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(6, 13));

  assert.deepEqual(labels(items), ["path\\\\", "alias", "role"]);
});

test("GaugeDynamicArgumentCompletionProvider stops table dynamic arguments at unescaped pipes", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const tableRow = "| <u | admin> |";
  const document = createDocument([
    "# Checkout",
    "| user | role |",
    "| ---- | ---- |",
    tableRow,
  ].join("\n"));

  const beforePipeItems = provider.provideCompletionItems(
    document,
    new vscode.Position(3, tableRow.indexOf("u") + 1),
  );
  const afterPipeItems = provider.provideCompletionItems(
    document,
    new vscode.Position(3, tableRow.indexOf("admin")),
  );

  assert.deepEqual(labels(beforePipeItems), ["user", "role"]);
  assert.deepEqual({ ...beforePipeItems[0].range.start }, { line: 3, character: tableRow.indexOf("<") + 1 });
  assert.deepEqual({ ...beforePipeItems[0].range.end }, { line: 3, character: tableRow.indexOf("|", tableRow.indexOf("<")) });
  assert.deepEqual(afterPipeItems, []);
});

test("GaugeDynamicArgumentCompletionProvider suggests table headers without closing pipes", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const tableRow = "| <u";
  const document = createDocument([
    "# Checkout",
    "| user | role |",
    "| ---- | ---- |",
    tableRow,
  ].join("\n"));

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(3, tableRow.indexOf("u") + 1),
  );

  assert.deepEqual(labels(items), ["user", "role"]);
  assert.deepEqual({ ...items[0].range.start }, { line: 3, character: tableRow.indexOf("<") + 1 });
  assert.deepEqual({ ...items[0].range.end }, { line: 3, character: tableRow.indexOf("u") + 1 });
});

test("GaugeDynamicArgumentCompletionProvider suggests dynamic arguments inside inline table body cells", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const specHeader = "  | <field> | value |";
  const specBody = "  | <u>     | admin |";
  const specDocument = createDocument([
    "# Checkout",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "",
    "## Successful checkout",
    "* Login with table",
    specHeader,
    "  | ------- | ----- |",
    specBody,
  ].join("\n"));
  const conceptHeader = "  | <field> | value |";
  const conceptBody = "  | <i>     | admin |";
  const conceptDocument = createDocument([
    "# Shared checkout <item>",
    "* Select <user>",
    conceptHeader,
    "  | ------- | ----- |",
    conceptBody,
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const specItems = provider.provideCompletionItems(
    specDocument,
    new vscode.Position(9, specBody.indexOf("u") + 1),
  );
  const specHeaderItems = provider.provideCompletionItems(
    specDocument,
    new vscode.Position(7, specHeader.indexOf("field")),
  );
  const conceptItems = provider.provideCompletionItems(
    conceptDocument,
    new vscode.Position(4, conceptBody.indexOf("i") + 1),
  );
  const conceptHeaderItems = provider.provideCompletionItems(
    conceptDocument,
    new vscode.Position(2, conceptHeader.indexOf("field")),
  );

  assert.deepEqual(labels(specItems), ["user", "role"]);
  assert.deepEqual(specHeaderItems, []);
  assert.deepEqual(labels(conceptItems), ["item", "user", "i"]);
  assert.deepEqual(conceptHeaderItems, []);
});

test("GaugeDynamicArgumentCompletionProvider ignores dynamic-looking table headers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const header = "| <user> | role |";
  const document = createDocument([
    "# Checkout",
    header,
    "| ------ | ---- |",
    "| Bob    | admin |",
  ].join("\n"));

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(1, header.indexOf("user")),
  );

  assert.deepEqual(items, []);
});

test("GaugeDynamicArgumentCompletionProvider ignores blank-separated table headers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const header = "| <item> | quantity |";
  const document = createDocument([
    "# Inventory",
    "| user |",
    "| Bob  |",
    "",
    header,
    "| book   | 2        |",
  ].join("\n"));

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(4, header.indexOf("item")),
  );

  assert.deepEqual(items, []);
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

test("GaugeDynamicArgumentCompletionProvider completes indented Gauge step arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "  * Commented setup \"draft\" <ignored>",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "",
    "## Successful checkout",
    "* Login as <u>",
    "* Confirm \"a\"",
  ].join("\n"));

  const indentedItems = provider.provideCompletionItems(
    document,
    new vscode.Position(1, 31),
  );
  const dynamicItems = provider.provideCompletionItems(
    document,
    new vscode.Position(7, 13),
  );
  const staticItems = provider.provideCompletionItems(
    document,
    new vscode.Position(8, 12),
  );

  assert.deepEqual(labels(indentedItems), ["u"]);
  assert.deepEqual(labels(dynamicItems), ["ignored"]);
  assert.deepEqual(labels(staticItems), ["draft", "a"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests indented top-level table headers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "  | user | role |",
    "  | ---- | ---- |",
    "",
    "* Login as <u>",
  ].join("\n"));

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(4, 13),
  );

  assert.deepEqual(labels(items), ["user", "role"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests standalone indented table body arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const specBody = "  | <u>  | admin |";
  const specDocument = createDocument([
    "# Checkout",
    "  | name | role |",
    "  | ---- | ---- |",
    specBody,
    "* Login as <u>",
  ].join("\n"));
  const conceptBody = "  | <i> |";
  const conceptDocument = createDocument([
    "# Shared checkout <item>",
    "  | name |",
    "  | ---- |",
    conceptBody,
    "* Select <user>",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const specItems = provider.provideCompletionItems(
    specDocument,
    new vscode.Position(3, specBody.indexOf("u") + 1),
  );
  const conceptItems = provider.provideCompletionItems(
    conceptDocument,
    new vscode.Position(3, conceptBody.indexOf("i") + 1),
  );

  assert.deepEqual(labels(specItems), ["name", "role", "u"]);
  assert.deepEqual(labels(conceptItems), ["item", "i", "user"]);
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

test("GaugeDynamicArgumentCompletionProvider suggests concept dynamic arguments in concept files by extension", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });
  const document = createDocument([
    "# Shared checkout <item> for <user>",
    "* Select <i>",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared.cpt", "plaintext");

  const items = provider.provideCompletionItems(document, new vscode.Position(1, 11));

  assert.deepEqual(labels(items), ["item", "user", "i"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests concept arguments by language id", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });
  const dynamicStep = "* Select <i>";
  const staticStep = "* Confirm \"c\"";
  const document = createDocument([
    "# Shared checkout <item> for <user>",
    dynamicStep,
    "* Pick \"cart\"",
    staticStep,
  ].join("\n"), "/workspace/gauge/untitled-concept", "gauge-concept");

  const dynamicItems = provider.provideCompletionItems(
    document,
    new vscode.Position(1, dynamicStep.indexOf("i") + 1),
  );
  const staticItems = provider.provideCompletionItems(
    document,
    new vscode.Position(3, staticStep.indexOf("c") + 1),
  );

  assert.deepEqual(labels(dynamicItems), ["item", "user", "i"]);
  assert.deepEqual(labels(staticItems), ["cart", "c"]);
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

test("GaugeDynamicArgumentCompletionProvider suggests concept double-hash heading arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const heading = "## Shared checkout <item>";
  const step = "* Select <i>";
  const document = createDocument([
    heading,
    step,
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const stepItems = provider.provideCompletionItems(document, new vscode.Position(1, step.indexOf("i") + 1));
  const headingItems = provider.provideCompletionItems(document, new vscode.Position(0, heading.indexOf("item")));

  assert.deepEqual(labels(stepItems), ["item", "i"]);
  assert.deepEqual(labels(headingItems), ["item", "i"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests indented concept hash heading arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const heading = "  # Shared checkout <item>";
  const step = "* Select <i>";
  const document = createDocument([
    heading,
    step,
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const stepItems = provider.provideCompletionItems(document, new vscode.Position(1, step.indexOf("i") + 1));
  const headingItems = provider.provideCompletionItems(document, new vscode.Position(0, heading.indexOf("item")));

  assert.deepEqual(labels(stepItems), ["item", "i"]);
  assert.deepEqual(labels(headingItems), ["item", "i"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests legacy concept heading dynamic arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const heading = "Shared checkout <item>";
  const step = "* Select <i>";
  const document = createDocument([
    heading,
    "======================",
    step,
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const stepItems = provider.provideCompletionItems(document, new vscode.Position(2, step.indexOf("i") + 1));
  const headingItems = provider.provideCompletionItems(document, new vscode.Position(0, heading.indexOf("item")));

  assert.deepEqual(labels(stepItems), ["item", "i"]);
  assert.deepEqual(labels(headingItems), ["item", "i"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests concept table dynamic arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Shared checkout <item>",
    "* Select <user>",
    "| name |",
    "| ---- |",
    "| <tableUser> |",
    "* Confirm <u>",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const items = provider.provideCompletionItems(document, new vscode.Position(5, 12));

  assert.deepEqual(labels(items), ["item", "user", "tableUser", "u"]);
});

test("GaugeDynamicArgumentCompletionProvider closes incomplete dynamic argument completions", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const line = "* Confirm <u";
  const document = createDocument([
    "# Checkout",
    "* Login as <user>",
    line,
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(2, line.length));

  assert.deepEqual(labels(items), ["user"]);
  assert.equal(items[0].detail, "dynamic");
  assert.equal(items[0].insertText, "user>");
  assert.equal(items[0].filterText, "user>");
  assert.deepEqual({ ...items[0].range.start }, { line: 2, character: 11 });
  assert.deepEqual({ ...items[0].range.end }, { line: 2, character: line.length });
});

test("GaugeDynamicArgumentCompletionProvider merges Gauge LSP dynamic argument completions", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const requests = [];
  const line = "* Confirm <u>";
  const specDocument = createDocument([
    "# Checkout",
    "| user |",
    "| ---- |",
    "| Ada  |",
    line,
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  specDocument.uri.toString = () => "file:///workspace/gauge/specs/example.spec";
  const clientsMap = {
    get(fsPath) {
      assert.equal(fsPath, "/workspace/gauge/specs/example.spec");
      return {
        client: {
          sendRequest(method, params) {
            requests.push({ argumentCount: arguments.length, method, params });
            return Promise.resolve({
              items: [
                {
                  detail: "dynamic",
                  filterText: "user",
                  kind: 6,
                  label: "user",
                  textEdit: {
                    newText: "user",
                    range: {
                      start: { line: 4, character: 11 },
                      end: { line: 4, character: 12 },
                    },
                  },
                },
                {
                  detail: "dynamic",
                  filterText: "account",
                  kind: 6,
                  label: "account",
                  textEdit: {
                    newText: "account",
                    range: {
                      start: { line: 4, character: 11 },
                      end: { line: 4, character: 12 },
                    },
                  },
                },
                {
                  detail: "dynamic",
                  filterText: "note",
                  kind: 1,
                  label: "note",
                  textEdit: {
                    newText: "note",
                    range: {
                      start: { line: 4, character: 11 },
                      end: { line: 4, character: 12 },
                    },
                  },
                },
                { kind: 25, label: "typeParameter" },
                { kind: 26, label: "unknown" },
                { label: "untyped" },
              ],
            });
          },
        },
      };
    },
  };
  const provider = new GaugeDynamicArgumentCompletionProvider({
    clientsMap,
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(4, 12));

  assert.deepEqual(requests, [
    {
      argumentCount: 2,
      method: "textDocument/completion",
      params: {
        position: { line: 4, character: 12 },
        textDocument: { uri: "file:///workspace/gauge/specs/example.spec" },
      },
    },
  ]);
  assert.deepEqual(labels(items), [
    "user",
    "account",
    "note",
    "typeParameter",
    "unknown",
    "untyped",
  ]);
  assert.equal(items[1].detail, "dynamic");
  assert.equal(items[1].kind, vscode.CompletionItemKind.Variable);
  assert.equal(items[1].insertText, "account");
  assert.equal(items[1].filterText, "account");
  assert.deepEqual({ ...items[1].range.start }, { line: 4, character: 11 });
  assert.deepEqual({ ...items[1].range.end }, { line: 4, character: 12 });
  assert.equal(items[2].kind, vscode.CompletionItemKind.Text);
  assert.equal(items[3].kind, 24);
  assert.equal(items[4].kind, vscode.CompletionItemKind.Text);
  assert.equal(items[5].kind, undefined);
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
  assert.equal(items[0].kind, vscode.CompletionItemKind.Variable);
  assert.deepEqual({ ...items[0].range.start }, { line: 4, character: 11 });
  assert.deepEqual({ ...items[0].range.end }, { line: 4, character: 12 });
});

test("GaugeDynamicArgumentCompletionProvider closes incomplete static argument completions", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const line = "* Confirm \"a";
  const document = createDocument([
    "# Checkout",
    "* Login as \"admin\"",
    line,
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(2, line.length));

  assert.deepEqual(labels(items), ["admin"]);
  assert.equal(items[0].detail, "static");
  assert.equal(items[0].insertText, "admin\"");
  assert.equal(items[0].filterText, "admin\"");
  assert.deepEqual({ ...items[0].range.start }, { line: 2, character: 11 });
  assert.deepEqual({ ...items[0].range.end }, { line: 2, character: line.length });
});

test("GaugeDynamicArgumentCompletionProvider excludes teardown static arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "## Successful checkout",
    "* Confirm \"c\"",
    "___",
    "* Cleanup \"temp\"",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(2, 12));

  assert.deepEqual(labels(items), ["c"]);
});

test("GaugeDynamicArgumentCompletionProvider excludes static arguments after indented teardown markers", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "## Successful checkout",
    "* Confirm \"c\"",
    "  ___",
    "* Cleanup \"temp\"",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(2, 12));

  assert.deepEqual(labels(items), ["c"]);
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

test("GaugeDynamicArgumentCompletionProvider ignores escaped static argument starts", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const step = "* Escape \\\"literal\\\" text";
  const document = createDocument([
    "# Checkout",
    step,
    "* Confirm \"a\"",
  ].join("\n"));

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(1, step.indexOf("literal")),
  );

  assert.deepEqual(items, []);
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

test("GaugeDynamicArgumentCompletionProvider ignores concept heading static arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const heading = "# Shared checkout \"ca\"";
  const step = "* Confirm \"card\"";
  const document = createDocument([
    "# Other checkout \"cart\"",
    heading,
    step,
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  const headingItems = provider.provideCompletionItems(
    document,
    new vscode.Position(1, heading.indexOf("ca") + 2),
  );
  const stepItems = provider.provideCompletionItems(
    document,
    new vscode.Position(2, step.indexOf("ca") + 2),
  );

  assert.deepEqual(headingItems, []);
  assert.deepEqual(labels(stepItems), ["card"]);
  assert.deepEqual({ ...stepItems[0].range.start }, { line: 2, character: 11 });
  assert.deepEqual({ ...stepItems[0].range.end }, { line: 2, character: 15 });
});

test("GaugeDynamicArgumentCompletionProvider suggests used steps at non-argument step positions", () => {
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

  assert.deepEqual(labels(provider.provideCompletionItems(document, new vscode.Position(3, 3))), [
    "Login as <user>",
    "Confirm <user>",
  ]);
  assert.deepEqual(labels(provider.provideCompletionItems(document, new vscode.Position(3, 17))), [
    "Confirm <user>",
  ]);
  assert.deepEqual(labels(provider.provideCompletionItems(document, new vscode.Position(4, 16))), [
    "Login as <user>",
  ]);
});

test("GaugeDynamicArgumentCompletionProvider suggests multiline used steps when project allows them", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const originalAllowMultilineStep = process.env.allow_multiline_step;
  process.env.allow_multiline_step = "true";
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay with",
    "  <card>",
    "* Pay",
  ].join("\n"));

  try {
    const items = provider.provideCompletionItems(document, new vscode.Position(3, 5));

    assert.deepEqual(labels(items), ["Pay with <card>"]);
  } finally {
    if (originalAllowMultilineStep === undefined) {
      delete process.env.allow_multiline_step;
    } else {
      process.env.allow_multiline_step = originalAllowMultilineStep;
    }
  }
});

test("GaugeDynamicArgumentCompletionProvider suggests Kotlin Step aliases on step lines", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Log",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class CheckoutSteps {",
    "  @Step(\"Log in as <user>\", \"Sign in as <user>\")",
    "  fun login(user: String) {}",
    "}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/CheckoutSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), ["Log in as <user>", "Sign in as <user>"]);
  assert.equal(items[0].kind, vscode.CompletionItemKind.Function);
  assert.equal(items[0].detail, "step");
  assert.equal(items[0].documentation, "Log in as <user>");
  assert.equal(items[0].insertText.value, "Log in as \"${0:user}\"");
  assert.equal(items[0].filterText, "Log in as <user>");
  assert.deepEqual({ ...items[0].range.start }, { line: 2, character: 2 });
  assert.deepEqual({ ...items[0].range.end }, { line: 2, character: 5 });
});

test("GaugeDynamicArgumentCompletionProvider inserts a space after bare step markers", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const stepLine = "*Log";
  const specDocument = createDocument([
    "# Checkout",
    "",
    stepLine,
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/CheckoutSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, stepLine.length));

  assert.deepEqual(labels(items), ["Log in as <user>"]);
  assert.equal(items[0].insertText.value, " Log in as \"${0:user}\"");
  assert.equal(items[0].filterText, " Log in as <user>");
  assert.deepEqual({ ...items[0].range.start }, { line: 2, character: 1 });
  assert.deepEqual({ ...items[0].range.end }, { line: 2, character: stepLine.length });
});

test("GaugeDynamicArgumentCompletionProvider suggests Kotlin Step aliases in Markdown Gauge specs", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Log",
  ].join("\n"), "/workspace/gauge/specs/example.md", "markdown");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/CheckoutSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), ["Log in as <user>"]);
  assert.equal(items[0].detail, "step");
  assert.equal(items[0].insertText.value, "Log in as \"${0:user}\"");
});

// A step whose text begins with "*" is written "* * Log in as <user>": the
// marker, then the text. "** Log" is a comment, because
// references/gauge/parser/lex.go isStep requires text[1] != '*'. Verified
// against the real parser - "** Log" yields no step, "* * Log in as <u>" yields
// the step "* Log in as {}".
test("GaugeDynamicArgumentCompletionProvider completes a step whose text starts with a star", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* * Log",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"* Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/CheckoutSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 7));

  assert.deepEqual(labels(items), ["* Log in as <user>"]);
  assert.equal(items[0].detail, "step");
});

test("GaugeDynamicArgumentCompletionProvider suggests Step aliases in spec files by extension", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/example.spec", "plaintext");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <method>\")",
    "fun pay(method: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/PaymentSteps.kt", "plaintext");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), ["Pay with <method>"]);
  assert.equal(items[0].insertText.value, "Pay with \"${0:method}\"");
});

test("GaugeDynamicArgumentCompletionProvider suggests concept headings on step lines", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Reuse",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const conceptDocument = createDocument([
    "# Reuse payment <method>",
    "* Pay with <method>",
  ].join("\n"), "/workspace/gauge/specs/concepts/payment.cpt", "gauge");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, conceptDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 7));

  assert.deepEqual(labels(items), ["Reuse payment <method>", "Pay with <method>"]);
  assert.equal(items[0].detail, "concept");
  assert.equal(items[0].insertText.value, "Reuse payment \"${0:method}\"");
});

test("GaugeDynamicArgumentCompletionProvider suggests gauge-concept headings on step lines by language id", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Reuse",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const conceptDocument = createDocument([
    "# Reuse payment <method>",
    "* Pay with <method>",
  ].join("\n"), "/workspace/gauge/specs/concepts/payment", "gauge-concept");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, conceptDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 7));

  assert.deepEqual(labels(items), ["Reuse payment <method>", "Pay with <method>"]);
  assert.equal(items[0].detail, "concept");
  assert.equal(items[0].insertText.value, "Reuse payment \"${0:method}\"");
});

test("GaugeDynamicArgumentCompletionProvider prefers concept headings over Step aliases", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const conceptDocument = createDocument([
    "# Pay with <method>",
    "* Enter payment method <method>",
  ].join("\n"), "/workspace/gauge/specs/concepts/payment.cpt", "gauge");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class PaymentSteps {",
    "  @Step(\"Pay with <method>\")",
    "  fun pay(method: String) {}",
    "}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/PaymentSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, conceptDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items).slice(0, 2), [
    "Pay with <method>",
    "Enter payment method <method>",
  ]);
  const payItem = items.find((item) => item.label === "Pay with <method>");
  assert.equal(payItem.detail, "concept");
});

test("GaugeDynamicArgumentCompletionProvider suggests used Gauge steps without implementations", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const line = "* unimplemented step one";
  const specDocument = createDocument([
    "# Checkout",
    "",
    line,
    "* unimplemented step two",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 18));

  assert.deepEqual(labels(items), [
    "unimplemented step one",
    "unimplemented step two",
  ]);
  assert.equal(items[0].detail, "step");
  assert.equal(items[0].insertText.value, "unimplemented step one");
  assert.equal(items[0].filterText, "unimplemented step one");
  assert.deepEqual({ ...items[0].range.start }, { line: 2, character: 2 });
  assert.deepEqual({ ...items[0].range.end }, { line: 2, character: line.length });
});

test("GaugeDynamicArgumentCompletionProvider ignores step aliases from another Gauge project", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Sha",
  ].join("\n"), "/workspace/project-a/specs/example.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Shared checkout\")",
    "fun sharedCheckout() {}",
  ].join("\n"), "/workspace/project-b/src/test/kotlin/steps/CheckoutSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createMultiProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), []);
});

test("GaugeDynamicArgumentCompletionProvider ignores concept headings from another Gauge project", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Sha",
  ].join("\n"), "/workspace/project-a/specs/example.spec");
  const conceptDocument = createDocument([
    "# Shared checkout",
    "* Use shared checkout",
  ].join("\n"), "/workspace/project-b/specs/concepts/shared.cpt", "gauge");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createMultiProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, conceptDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), []);
});

test("GaugeDynamicArgumentCompletionProvider suggests Gauge LSP step completions on step lines", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const requests = [];
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Log",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  specDocument.uri.toString = () => "file:///workspace/gauge/specs/example.spec";
  const clientsMap = {
    get(fsPath) {
      assert.equal(fsPath, "/workspace/gauge/specs/example.spec");
      return {
        client: {
          sendRequest(method, params) {
            requests.push({ method, params });
            return Promise.resolve({
              items: [
                {
                  detail: "Step",
                  filterText: "Log in as <user>",
                  insertTextFormat: 2,
                  kind: 3,
                  label: "Log in as <user>",
                  textEdit: {
                    newText: "Log in as \"${0:user}\"",
                    range: {
                      start: { line: 2, character: 2 },
                      end: { line: 2, character: 5 },
                    },
                  },
                },
              ],
            });
          },
        },
      };
    },
  };
  const provider = new GaugeDynamicArgumentCompletionProvider({
    clientsMap,
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(requests, [
    {
      method: "textDocument/completion",
      params: {
        position: { line: 2, character: 5 },
        textDocument: { uri: "file:///workspace/gauge/specs/example.spec" },
      },
    },
  ]);
  assert.deepEqual(labels(items), ["Log in as <user>"]);
  assert.equal(items[0].detail, "Step");
  assert.equal(items[0].kind, vscode.CompletionItemKind.Function);
  assert.equal(items[0].insertText.value, "Log in as \"${0:user}\"");
  assert.equal(items[0].filterText, "Log in as <user>");
  assert.deepEqual({ ...items[0].range.start }, { line: 2, character: 2 });
  assert.deepEqual({ ...items[0].range.end }, { line: 2, character: 5 });
});

test("GaugeDynamicArgumentCompletionProvider deduplicates normalized Gauge LSP step completions", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  specDocument.uri.toString = () => "file:///workspace/gauge/specs/example.spec";
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\")",
    "fun pay(amount: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/PaymentSteps.kt", "kotlin");
  const clientsMap = {
    get(fsPath) {
      assert.equal(fsPath, "/workspace/gauge/specs/example.spec");
      return {
        client: {
          sendRequest() {
            return Promise.resolve({
              items: [
                {
                  detail: "Step",
                  filterText: "Pay with <value>",
                  insertTextFormat: 2,
                  kind: 3,
                  label: "Pay with <value>",
                  textEdit: {
                    newText: "Pay with \"${0:value}\"",
                    range: {
                      start: { line: 2, character: 2 },
                      end: { line: 2, character: 5 },
                    },
                  },
                },
              ],
            });
          },
        },
      };
    },
  };
  const provider = new GaugeDynamicArgumentCompletionProvider({
    clientsMap,
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), ["Pay with <amount>"]);
  assert.equal(items[0].detail, "step");
  assert.equal(items[0].documentation, "Pay with <amount>");
  assert.equal(items[0].insertText.value, "Pay with \"${0:amount}\"");
});

test("GaugeDynamicArgumentCompletionProvider keeps filled static args in Kotlin Step alias snippets", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const stepLine = "* Log in as \"Alice\"";
  const specDocument = createDocument([
    "# Checkout",
    "",
    stepLine,
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/CheckoutSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, stepLine.length));

  assert.deepEqual(labels(items), ["Log in as <user>"]);
  assert.equal(items[0].insertText.value, "Log in as \"${0:Alice}\"");
  assert.equal(items[0].filterText, "Log in as \"Alice\"");
});

test("GaugeDynamicArgumentCompletionProvider keeps filled dynamic args in Kotlin Step alias filter text", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const stepLine = "* Say <file:test.txt> to";
  const specDocument = createDocument([
    "# Checkout",
    "",
    stepLine,
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Say <hello> to <gauge>\")",
    "fun say(hello: String, gauge: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/CheckoutSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, stepLine.length));

  assert.deepEqual(labels(items), ["Say <hello> to <gauge>"]);
  assert.equal(items[0].insertText.value, "Say \"${1:hello}\" to \"${0:gauge}\"");
  assert.equal(items[0].filterText, "Say <file:test.txt> to <gauge>");
});

test("GaugeDynamicArgumentCompletionProvider suggests Kotlin Step aliases on indented Gauge step lines", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "  * Log",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Log in as <user>\")",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/CheckoutSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 7));

  assert.deepEqual(labels(items), ["Log in as <user>"]);
  assert.equal(items[0].insertText.value, "Log in as \"${0:user}\"");
});

test("GaugeDynamicArgumentCompletionProvider ignores Markdown files outside Gauge projects", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });
  const document = createDocument([
    "# Notes",
    "",
    "|name|",
    "|----|",
    "|Alice|",
    "",
    "* Use <",
  ].join("\n"), "/workspace/readme.md", "markdown");

  const items = provider.provideCompletionItems(document, new vscode.Position(6, 7));

  assert.deepEqual(items, []);
});

test("GaugeDynamicArgumentCompletionProvider suggests unopened workspace Kotlin Step aliases", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <card>\")",
    "fun pay(card: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/steps/PaymentSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument],
        async findFiles(pattern) {
          assert.equal(pattern, "**/*.kt");
          return [kotlinDocument.uri];
        },
        async openTextDocument(uri) {
          assert.equal(uri, kotlinDocument.uri);
          return kotlinDocument;
        },
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), ["Pay with <card>"]);
  assert.equal(items[0].insertText.value, "Pay with \"${0:card}\"");
});

test("GaugeDynamicArgumentCompletionProvider suggests unopened workspace Java Step aliases", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const javaDocument = createDocument([
    "package steps;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "",
    "public class PaymentSteps {",
    "  @Step(\"Pay with <card>\")",
    "  public void pay(String card) {",
    "  }",
    "}",
  ].join("\n"), "/workspace/gauge/src/test/java/steps/PaymentSteps.java", "plaintext");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument],
        async findFiles(pattern) {
          if (pattern === "**/*.kt" || pattern === "**/*.cpt") {
            return [];
          }
          if (pattern === "**/*.java") {
            return [javaDocument.uri];
          }
          throw new Error(`Unexpected pattern ${pattern}`);
        },
        async openTextDocument(uri) {
          assert.equal(uri, javaDocument.uri);
          return javaDocument;
        },
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), ["Pay with <card>"]);
  assert.equal(items[0].insertText.value, "Pay with \"${0:card}\"");
});

test("GaugeDynamicArgumentCompletionProvider suggests unopened Markdown used steps", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const openedFiles = [];
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Reu",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const markdownDocument = createDocument([
    "# Shared flows",
    "",
    "* Reused checkout",
  ].join("\n"), "/workspace/gauge/specs/shared.md", "markdown");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument],
        async findFiles(pattern) {
          if (pattern === "**/*.md") {
            return [markdownDocument.uri];
          }
          return [];
        },
        async openTextDocument(uri) {
          openedFiles.push(uri.fsPath);
          assert.equal(uri, markdownDocument.uri);
          return markdownDocument;
        },
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), ["Reused checkout"]);
  assert.deepEqual(openedFiles, ["/workspace/gauge/specs/shared.md"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests unopened Markdown tags", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const openedFiles = [];
  const specDocument = createDocument([
    "# Checkout",
    "tags: ",
    "",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const markdownDocument = createDocument([
    "# Shared flows",
    "tags: smoke, web",
    "",
    "* Reused checkout",
  ].join("\n"), "/workspace/gauge/specs/shared.md", "markdown");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument],
        async findFiles(pattern) {
          if (pattern === "**/*.md") {
            return [markdownDocument.uri];
          }
          return [];
        },
        async openTextDocument(uri) {
          openedFiles.push(uri.fsPath);
          assert.equal(uri, markdownDocument.uri);
          return markdownDocument;
        },
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(1, 6));

  assert.deepEqual(labels(items), ["smoke", "web"]);
  assert.deepEqual(openedFiles, ["/workspace/gauge/specs/shared.md"]);
});

test("GaugeDynamicArgumentCompletionProvider suggests package wildcard const Step aliases", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Login",
    "",
    "* Log",
  ].join("\n"), "/workspace/gauge/specs/login.spec");
  const constantsDocument = createDocument([
    "package fixtures.steps",
    "",
    "const val LOGIN_STEP = \"Log in as <user>\"",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/fixtures/steps/StepText.kt", "kotlin");
  const kotlinDocument = createDocument([
    "package fixtures.impl",
    "",
    "import com.thoughtworks.gauge.Step",
    "import fixtures.steps.*",
    "",
    "@Step(LOGIN_STEP)",
    "fun login(user: String) {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/fixtures/impl/LoginSteps.kt", "kotlin");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      workspace: {
        textDocuments: [specDocument, constantsDocument, kotlinDocument],
      },
    },
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), ["Log in as <user>"]);
  assert.equal(items[0].insertText.value, "Log in as \"${0:user}\"");
});

test("GaugeDynamicArgumentCompletionProvider uses the shared document store without workspace scans", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const vscode = createFakeVscode();
  const specDocument = createDocument([
    "# Checkout",
    "",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/example.spec");
  const kotlinPath = "/workspace/gauge/src/test/kotlin/steps/PaymentSteps.kt";
  const diskFiles = new Map([
    [kotlinPath, [
      "package steps",
      "",
      "import com.thoughtworks.gauge.Step",
      "",
      "@Step(\"Pay with <card>\")",
      "fun pay(card: String) {}",
    ].join("\n")],
  ]);
  const findFilesPatterns = [];
  const openedFiles = [];
  const workspaceVscode = {
    ...vscode,
    workspace: {
      textDocuments: [specDocument],
      async findFiles(pattern) {
        findFilesPatterns.push(pattern);
        return [{ fsPath: kotlinPath }];
      },
      async openTextDocument(uri) {
        openedFiles.push(uri.fsPath);
        return createDocument(diskFiles.get(uri.fsPath) || "", uri.fsPath, "kotlin");
      },
    },
  };
  const projectFactory = createProjectFactory();
  const documentStore = new WorkspaceDocumentStore({
    fileSystem: {
      promises: {
        async readFile(file) {
          if (!diskFiles.has(file)) {
            throw new Error(`unexpected read: ${file}`);
          }
          return diskFiles.get(file);
        },
      },
    },
    projectFactory,
    vscode: workspaceVscode,
  });
  await documentStore.whenReady();
  const provider = new GaugeDynamicArgumentCompletionProvider({
    documentStore,
    projectFactory,
    vscode: workspaceVscode,
  });

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(2, 5));

  assert.deepEqual(labels(items), ["Pay with <card>"]);
  assert.equal(items[0].insertText.value, "Pay with \"${0:card}\"");
  assert.equal(
    findFilesPatterns.length,
    1,
    `expected only the store scan, saw findFiles patterns: ${findFilesPatterns.join(", ")}`,
  );
  assert.deepEqual(openedFiles, []);
});

test("GaugeDynamicArgumentCompletionProvider skips pre-cancelled completion requests", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const cancellation = createCancellation(true);
  const document = createDocument(
    "# Checkout\n* Pay",
    "/workspace/gauge/specs/example.spec",
  );
  let indexCalls = 0;
  let clientLookups = 0;
  const provider = new GaugeDynamicArgumentCompletionProvider({
    clientsMap: {
      get() {
        clientLookups += 1;
        return undefined;
      },
    },
    projectFactory: createProjectFactory(),
    vscode,
    workspaceStepIndex: {
      completionEntries() {
        indexCalls += 1;
        return [{ detail: "step", label: "Pay now" }];
      },
    },
  });

  const items = provider.provideCompletionItems(
    document,
    new vscode.Position(1, 5),
    cancellation.token,
  );

  assert.deepEqual(items, []);
  assert.equal(indexCalls, 0);
  assert.equal(clientLookups, 0);
  assert.equal(cancellation.registrations(), 0);
  assert.equal(cancellation.disposals(), 0);
  assert.equal(cancellation.listenerCount(), 0);
});

test("GaugeDynamicArgumentCompletionProvider stops pending indexed completion on host cancellation", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();

  for (const settlement of ["resolve", "reject"]) {
    const cancellation = createCancellation();
    const indexResponse = deferred();
    const document = createDocument(
      "# Checkout\n* Pay",
      "/workspace/gauge/specs/example.spec",
    );
    let clientLookups = 0;
    const provider = new GaugeDynamicArgumentCompletionProvider({
      clientsMap: {
        get() {
          clientLookups += 1;
          return undefined;
        },
      },
      projectFactory: createProjectFactory(),
      vscode,
      workspaceStepIndex: {
        completionEntries() {
          return indexResponse.promise;
        },
      },
    });
    let outcome = { status: "pending" };
    const completion = Promise.resolve(provider.provideCompletionItems(
      document,
      new vscode.Position(1, 5),
      cancellation.token,
    )).then(
      (value) => {
        outcome = { status: "fulfilled", value };
      },
      (error) => {
        outcome = { error, status: "rejected" };
      },
    );

    cancellation.cancel();
    await nextTurn();
    const cancellationOutcome = outcome;
    if (settlement === "resolve") {
      indexResponse.resolve([{ detail: "step", label: "Pay now" }]);
    } else {
      indexResponse.reject(new Error("late indexed completion failure"));
    }
    await completion;

    assert.deepEqual(cancellationOutcome, { status: "fulfilled", value: [] });
    assert.deepEqual(outcome, { status: "fulfilled", value: [] });
    assert.equal(clientLookups, 0);
    assert.equal(cancellation.registrations(), 1);
    assert.equal(cancellation.disposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
  }
});

test("GaugeDynamicArgumentCompletionProvider cancels pending Gauge LSP completion requests", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();

  for (const settlement of ["resolve", "reject"]) {
    const cancellation = createCancellation();
    const serverResponse = deferred();
    const document = createDocument(
      "# Checkout\n* Pay",
      "/workspace/gauge/specs/example.spec",
    );
    const requests = [];
    const provider = new GaugeDynamicArgumentCompletionProvider({
      clientsMap: {
        get() {
          return {
            client: {
              sendRequest(method, params, token) {
                requests.push({ method, params, token });
                return serverResponse.promise;
              },
            },
          };
        },
      },
      projectFactory: createProjectFactory(),
      vscode,
      workspaceStepIndex: {
        completionEntries() {
          return [{ detail: "step", label: "Pay now" }];
        },
      },
    });
    let outcome = { status: "pending" };
    const completion = Promise.resolve(provider.provideCompletionItems(
      document,
      new vscode.Position(1, 5),
      cancellation.token,
    )).then(
      (value) => {
        outcome = { status: "fulfilled", value };
      },
      (error) => {
        outcome = { error, status: "rejected" };
      },
    );

    assert.equal(requests.length, 1);
    cancellation.cancel();
    await nextTurn();
    const cancellationOutcome = outcome;
    if (settlement === "resolve") {
      serverResponse.resolve([{ label: "Remote pay" }]);
    } else {
      serverResponse.reject(new Error("late Gauge completion failure"));
    }
    await completion;

    assert.equal(requests[0].method, "textDocument/completion");
    assert.equal(requests[0].token, cancellation.token);
    assert.deepEqual(cancellationOutcome, { status: "fulfilled", value: [] });
    assert.deepEqual(outcome, { status: "fulfilled", value: [] });
    assert.equal(cancellation.registrations(), 1);
    assert.equal(cancellation.disposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
  }
});

test("GaugeDynamicArgumentCompletionProvider normalizes synchronous host cancellation", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();

  for (const stage of ["index", "request"]) {
    const cancellation = createCancellation();
    const lateError = new Error(`late ${stage} cancellation failure`);
    const document = createDocument(
      "# Checkout\n* Pay",
      "/workspace/gauge/specs/example.spec",
    );
    let requests = 0;
    const provider = new GaugeDynamicArgumentCompletionProvider({
      clientsMap: {
        get() {
          return {
            client: {
              sendRequest() {
                requests += 1;
                cancellation.cancel();
                return Promise.reject(lateError);
              },
            },
          };
        },
      },
      projectFactory: createProjectFactory(),
      vscode,
      workspaceStepIndex: {
        completionEntries() {
          if (stage === "index") {
            cancellation.cancel();
            return Promise.reject(lateError);
          }
          return [{ detail: "step", label: "Pay now" }];
        },
      },
    });

    const items = await provider.provideCompletionItems(
      document,
      new vscode.Position(1, 5),
      cancellation.token,
    );

    assert.deepEqual(items, []);
    assert.equal(requests, stage === "request" ? 1 : 0);
    assert.equal(cancellation.registrations(), 1);
    assert.equal(cancellation.disposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
  }
});

test("GaugeDynamicArgumentCompletionProvider stops every pending local completion source", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const cases = [
    {
      createIndex(gate) {
        return { tagEntries: () => gate.promise };
      },
      document: createDocument(
        "# Checkout\ntags: ",
        "/workspace/gauge/specs/example.spec",
      ),
      position: new vscode.Position(1, 6),
    },
    {
      createIndex(gate) {
        return { parameterEntries: () => gate.promise };
      },
      document: createDocument(
        "# Checkout\n* Pay with <cu>",
        "/workspace/gauge/specs/example.spec",
      ),
      position: new vscode.Position(1, 14),
    },
    {
      createStore(gate) {
        return {
          isScanComplete() {
            return false;
          },
          whenReady() {
            return gate.promise;
          },
        };
      },
      document: createDocument(
        "# Checkout\n* Pay",
        "/workspace/gauge/specs/example.spec",
      ),
      position: new vscode.Position(1, 5),
    },
  ];

  for (const fixture of cases) {
    for (const settlement of ["resolve", "reject"]) {
      const cancellation = createCancellation();
      const response = deferred();
      let clientLookups = 0;
      let workspaceDocumentCalls = 0;
      const diagnosticsProvider = {
        belongsToSourceGaugeProject() {
          return true;
        },
        gaugeProjectRoot() {
          return "/workspace/gauge";
        },
        isGaugeProjectDocument() {
          return true;
        },
        workspaceDocuments() {
          workspaceDocumentCalls += 1;
          return [];
        },
      };
      const provider = new GaugeDynamicArgumentCompletionProvider({
        clientsMap: {
          get() {
            clientLookups += 1;
            return undefined;
          },
        },
        diagnosticsProvider,
        documentStore: fixture.createStore && fixture.createStore(response),
        projectFactory: createProjectFactory(),
        vscode,
        workspaceStepIndex: fixture.createIndex && fixture.createIndex(response),
      });
      let outcome = { status: "pending" };
      const completion = Promise.resolve(provider.provideCompletionItems(
        fixture.document,
        fixture.position,
        cancellation.token,
      )).then(
        (value) => {
          outcome = { status: "fulfilled", value };
        },
        (error) => {
          outcome = { error, status: "rejected" };
        },
      );

      cancellation.cancel();
      await nextTurn();
      const cancellationOutcome = outcome;
      if (settlement === "resolve") {
        response.resolve([]);
      } else {
        response.reject(new Error("late local completion source failure"));
      }
      await completion;

      assert.deepEqual(cancellationOutcome, { status: "fulfilled", value: [] });
      assert.deepEqual(outcome, { status: "fulfilled", value: [] });
      assert.equal(clientLookups, 0);
      assert.equal(workspaceDocumentCalls, 0);
      assert.equal(cancellation.registrations(), 1);
      assert.equal(cancellation.disposals(), 1);
      assert.equal(cancellation.listenerCount(), 0);
    }
  }
});

test("GaugeDynamicArgumentCompletionProvider isolates concurrent request cancellation", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const cancellations = [createCancellation(), createCancellation()];
  const responses = [deferred(), deferred()];
  const document = createDocument(
    "# Checkout\n* Pay",
    "/workspace/gauge/specs/example.spec",
  );
  let requestIndex = 0;
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
    workspaceStepIndex: {
      completionEntries() {
        const response = responses[requestIndex];
        requestIndex += 1;
        return response.promise;
      },
    },
  });

  const first = provider.provideCompletionItems(
    document,
    new vscode.Position(1, 5),
    cancellations[0].token,
  );
  const second = provider.provideCompletionItems(
    document,
    new vscode.Position(1, 5),
    cancellations[1].token,
  );
  cancellations[0].cancel();
  responses[0].resolve([{ detail: "step", label: "Old pay" }]);
  responses[1].resolve([{ detail: "step", label: "Current pay" }]);

  assert.deepEqual(await first, []);
  assert.deepEqual(labels(await second), ["Current pay"]);
  assert.equal(requestIndex, 2);
  for (const cancellation of cancellations) {
    assert.equal(cancellation.registrations(), 1);
    assert.equal(cancellation.disposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
  }
  assert.equal(provider.activeOperations.size, 0);
});

test("GaugeDynamicArgumentCompletionProvider preserves live completion outcomes", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const document = createDocument(
    "# Checkout\n* Pay",
    "/workspace/gauge/specs/example.spec",
  );
  const indexError = new Error("live indexed completion failure");
  const indexCancellation = createCancellation();
  const failingIndexProvider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
    workspaceStepIndex: {
      completionEntries() {
        return Promise.reject(indexError);
      },
    },
  });

  await assert.rejects(
    failingIndexProvider.provideCompletionItems(
      document,
      new vscode.Position(1, 5),
      indexCancellation.token,
    ),
    (error) => error === indexError,
  );
  assert.equal(indexCancellation.registrations(), 1);
  assert.equal(indexCancellation.disposals(), 1);
  assert.equal(indexCancellation.listenerCount(), 0);
  assert.equal(failingIndexProvider.activeOperations.size, 0);

  const serverCancellation = createCancellation();
  const serverError = new Error("live Gauge completion failure");
  const failingServerProvider = new GaugeDynamicArgumentCompletionProvider({
    clientsMap: {
      get() {
        return {
          client: {
            sendRequest() {
              return Promise.reject(serverError);
            },
          },
        };
      },
    },
    projectFactory: createProjectFactory(),
    vscode,
    workspaceStepIndex: {
      completionEntries() {
        return [{ detail: "step", label: "Pay now" }];
      },
    },
  });

  const items = await failingServerProvider.provideCompletionItems(
    document,
    new vscode.Position(1, 5),
    serverCancellation.token,
  );

  assert.deepEqual(labels(items), ["Pay now"]);
  assert.equal(serverCancellation.registrations(), 1);
  assert.equal(serverCancellation.disposals(), 1);
  assert.equal(serverCancellation.listenerCount(), 0);
  assert.equal(failingServerProvider.activeOperations.size, 0);

  const conversionCancellation = createCancellation();
  const conversionError = new Error("live Gauge completion conversion failure");
  const conversionProvider = new GaugeDynamicArgumentCompletionProvider({
    clientsMap: {
      get() {
        return {
          client: {
            sendRequest() {
              return Promise.resolve({ items: [{ label: "remote" }] });
            },
          },
        };
      },
    },
    projectFactory: createProjectFactory(),
    vscode: {
      ...vscode,
      CompletionItem: class CompletionItem {
        constructor() {
          throw conversionError;
        }
      },
    },
    workspaceStepIndex: {
      tagEntries() {
        return [];
      },
    },
  });

  await assert.rejects(
    conversionProvider.provideCompletionItems(
      createDocument("# Checkout\ntags: ", "/workspace/gauge/specs/example.spec"),
      new vscode.Position(1, 6),
      conversionCancellation.token,
    ),
    (error) => error === conversionError,
  );
  assert.equal(conversionCancellation.registrations(), 1);
  assert.equal(conversionCancellation.disposals(), 1);
  assert.equal(conversionCancellation.listenerCount(), 0);
  assert.equal(conversionProvider.activeOperations.size, 0);

  const syncCancellation = createCancellation();
  const syncError = new Error("synchronous Gauge completion failure");
  const syncFailureProvider = new GaugeDynamicArgumentCompletionProvider({
    clientsMap: {
      get() {
        return {
          client: {
            sendRequest() {
              throw syncError;
            },
          },
        };
      },
    },
    projectFactory: createProjectFactory(),
    vscode,
    workspaceStepIndex: {
      completionEntries() {
        return [{ detail: "step", label: "Pay now" }];
      },
    },
  });

  assert.throws(
    () => syncFailureProvider.provideCompletionItems(
      document,
      new vscode.Position(1, 5),
      syncCancellation.token,
    ),
    (error) => error === syncError,
  );
  assert.equal(syncCancellation.registrations(), 1);
  assert.equal(syncCancellation.disposals(), 1);
  assert.equal(syncCancellation.listenerCount(), 0);
  assert.equal(syncFailureProvider.activeOperations.size, 0);
});

test("GaugeDynamicArgumentCompletionProvider disposal settles tokenless indexed requests", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();

  for (const settlement of ["resolve", "reject"]) {
    const indexResponse = deferred();
    const document = createDocument(
      "# Checkout\n* Pay",
      "/workspace/gauge/specs/example.spec",
    );
    let clientLookups = 0;
    let indexCalls = 0;
    const provider = new GaugeDynamicArgumentCompletionProvider({
      clientsMap: {
        get() {
          clientLookups += 1;
          return undefined;
        },
      },
      projectFactory: createProjectFactory(),
      vscode,
      workspaceStepIndex: {
        completionEntries() {
          indexCalls += 1;
          return indexResponse.promise;
        },
      },
    });
    let outcome = { status: "pending" };
    const completion = Promise.resolve(provider.provideCompletionItems(
      document,
      new vscode.Position(1, 5),
    )).then(
      (value) => {
        outcome = { status: "fulfilled", value };
      },
      (error) => {
        outcome = { error, status: "rejected" };
      },
    );

    const hasDispose = typeof provider.dispose === "function";
    if (hasDispose) {
      provider.dispose();
      provider.dispose();
    }
    await nextTurn();
    const disposalOutcome = outcome;
    if (settlement === "resolve") {
      indexResponse.resolve([{ detail: "step", label: "Pay now" }]);
    } else {
      indexResponse.reject(new Error("late indexed completion failure"));
    }
    await completion;
    const callsBeforeRetainedRequest = indexCalls;
    const retainedResult = hasDispose
      ? provider.provideCompletionItems(document, new vscode.Position(1, 5))
      : undefined;

    assert.equal(hasDispose, true);
    assert.deepEqual(disposalOutcome, { status: "fulfilled", value: [] });
    assert.deepEqual(outcome, { status: "fulfilled", value: [] });
    assert.deepEqual(retainedResult, []);
    assert.equal(indexCalls, callsBeforeRetainedRequest);
    assert.equal(clientLookups, 0);
    assert.equal(provider.activeOperations.size, 0);
  }
});

test("GaugeDynamicArgumentCompletionProvider disposal detaches pending Gauge LSP requests", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();

  for (const settlement of ["resolve", "reject"]) {
    const cancellation = createCancellation();
    const serverResponse = deferred();
    const requests = [];
    const document = createDocument(
      "# Checkout\n* Pay",
      "/workspace/gauge/specs/example.spec",
    );
    const provider = new GaugeDynamicArgumentCompletionProvider({
      clientsMap: {
        get() {
          return {
            client: {
              sendRequest(method, params, token) {
                requests.push({ method, params, token });
                return serverResponse.promise;
              },
            },
          };
        },
      },
      projectFactory: createProjectFactory(),
      vscode,
      workspaceStepIndex: {
        completionEntries() {
          return [{ detail: "step", label: "Pay now" }];
        },
      },
    });
    let outcome = { status: "pending" };
    const completion = Promise.resolve(provider.provideCompletionItems(
      document,
      new vscode.Position(1, 5),
      cancellation.token,
    )).then(
      (value) => {
        outcome = { status: "fulfilled", value };
      },
      (error) => {
        outcome = { error, status: "rejected" };
      },
    );

    const hasDispose = typeof provider.dispose === "function";
    if (hasDispose) {
      provider.dispose();
    }
    await nextTurn();
    const disposalOutcome = outcome;
    if (settlement === "resolve") {
      serverResponse.resolve([{ label: "Remote pay" }]);
    } else {
      serverResponse.reject(new Error("late Gauge completion failure"));
    }
    await completion;

    assert.equal(hasDispose, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "textDocument/completion");
    assert.equal(requests[0].token, cancellation.token);
    assert.deepEqual(disposalOutcome, { status: "fulfilled", value: [] });
    assert.deepEqual(outcome, { status: "fulfilled", value: [] });
    assert.equal(cancellation.registrations(), 1);
    assert.equal(cancellation.disposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
    assert.equal(provider.activeOperations.size, 0);
  }
});

test("GaugeDynamicArgumentCompletionProvider disposal detaches borrowed store readiness", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();

  for (const settlement of ["resolve", "reject"]) {
    const readyResponse = deferred();
    let clientLookups = 0;
    let storeDisposals = 0;
    let workspaceDocumentCalls = 0;
    const documentStore = {
      dispose() {
        storeDisposals += 1;
      },
      isScanComplete() {
        return false;
      },
      whenReady() {
        return readyResponse.promise;
      },
    };
    const provider = new GaugeDynamicArgumentCompletionProvider({
      clientsMap: {
        get() {
          clientLookups += 1;
          return undefined;
        },
      },
      diagnosticsProvider: {
        belongsToSourceGaugeProject() {
          return true;
        },
        gaugeProjectRoot() {
          return "/workspace/gauge";
        },
        isGaugeProjectDocument() {
          return true;
        },
        workspaceDocuments() {
          workspaceDocumentCalls += 1;
          return [];
        },
      },
      documentStore,
      projectFactory: createProjectFactory(),
      vscode,
    });
    const document = createDocument(
      "# Checkout\n* Pay",
      "/workspace/gauge/specs/example.spec",
    );
    let outcome = { status: "pending" };
    const completion = Promise.resolve(provider.provideCompletionItems(
      document,
      new vscode.Position(1, 5),
    )).then(
      (value) => {
        outcome = { status: "fulfilled", value };
      },
      (error) => {
        outcome = { error, status: "rejected" };
      },
    );

    const hasDispose = typeof provider.dispose === "function";
    if (hasDispose) {
      provider.dispose();
    }
    await nextTurn();
    const disposalOutcome = outcome;
    if (settlement === "resolve") {
      readyResponse.resolve();
    } else {
      readyResponse.reject(new Error("late store readiness failure"));
    }
    await completion;

    assert.equal(hasDispose, true);
    assert.deepEqual(disposalOutcome, { status: "fulfilled", value: [] });
    assert.deepEqual(outcome, { status: "fulfilled", value: [] });
    assert.equal(workspaceDocumentCalls, 0);
    assert.equal(clientLookups, 0);
    assert.equal(storeDisposals, 0);
    assert.equal(provider.activeOperations.size, 0);
  }
});

test("GaugeDynamicArgumentCompletionProvider owns its registration and created diagnostics", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  let registrationDisposals = 0;
  const registrations = [];
  const vscode = {
    ...createFakeVscode(),
    languages: {
      registerCompletionItemProvider(selector, provider, ...triggerCharacters) {
        registrations.push({ provider, selector, triggerCharacters });
        return {
          dispose() {
            registrationDisposals += 1;
          },
        };
      },
    },
  };
  const borrowedDiagnostics = {
    disposeCalls: 0,
    dispose() {
      this.disposeCalls += 1;
    },
  };
  const borrowedProvider = new GaugeDynamicArgumentCompletionProvider({
    diagnosticsProvider: borrowedDiagnostics,
    vscode,
  });
  const ownedProvider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const ownedDiagnostics = ownedProvider.diagnosticsProvider;
  let ownedDiagnosticsDisposals = 0;
  ownedDiagnostics.dispose = () => {
    ownedDiagnosticsDisposals += 1;
  };

  const hasRegister = typeof ownedProvider.register === "function";
  const registration = hasRegister ? ownedProvider.register() : undefined;
  if (hasRegister) {
    ownedProvider.register();
    ownedProvider.dispose();
    ownedProvider.dispose();
    borrowedProvider.dispose();
  }

  assert.equal(hasRegister, true);
  assert.equal(registration, ownedProvider);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].provider, ownedProvider);
  assert.deepEqual(registrations[0].selector, [
    { language: "gauge" },
    { language: "gauge-concept" },
    { scheme: "file", pattern: "**/*.spec" },
    { language: "markdown", scheme: "file", pattern: "**/*.md" },
    { scheme: "file", pattern: "**/*.cpt" },
  ]);
  assert.deepEqual(registrations[0].triggerCharacters, ["*", " ", "<", "\"", ":", ","]);
  assert.equal(registrationDisposals, 1);
  assert.equal(ownedDiagnosticsDisposals, 1);
  assert.equal(borrowedDiagnostics.disposeCalls, 0);
});

test("GaugeDynamicArgumentCompletionProvider stops local item construction after synchronous disposal", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const baseVscode = createFakeVscode();
  let completionItemConstructions = 0;
  let provider;
  const vscode = {
    ...baseVscode,
    CompletionItem: class CompletionItem {
      constructor(label, kind) {
        completionItemConstructions += 1;
        this.kind = kind;
        this.label = label;
        provider.dispose();
      }
    },
  };
  provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
    workspaceStepIndex: {
      parameterEntries() {
        return ["card", "account"];
      },
    },
  });
  const document = createDocument(
    "# Checkout\n* Pay with <cu>",
    "/workspace/gauge/specs/example.spec",
  );

  const items = await provider.provideCompletionItems(
    document,
    new vscode.Position(1, 14),
  );

  assert.deepEqual(items, []);
  assert.equal(completionItemConstructions, 1);
  assert.equal(provider.activeOperations.size, 0);
});

test("GaugeDynamicArgumentCompletionProvider closes a registration returned after synchronous disposal", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  let provider;
  let registrationDisposals = 0;
  const vscode = {
    ...createFakeVscode(),
    languages: {
      registerCompletionItemProvider() {
        provider.dispose();
        return {
          dispose() {
            registrationDisposals += 1;
          },
        };
      },
    },
  };
  provider = new GaugeDynamicArgumentCompletionProvider({ vscode });

  const result = provider.register();
  provider.dispose();

  assert.equal(result, provider);
  assert.equal(registrationDisposals, 1);
  assert.deepEqual(provider.provideCompletionItems({}, {}), []);
});

test("GaugeDynamicArgumentCompletionProvider observes values returned during synchronous disposal", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();

  for (const stage of ["index", "request"]) {
    const lateError = new Error(`late ${stage} disposal failure`);
    const document = createDocument(
      "# Checkout\n* Pay",
      "/workspace/gauge/specs/example.spec",
    );
    let provider;
    let requests = 0;
    provider = new GaugeDynamicArgumentCompletionProvider({
      clientsMap: {
        get() {
          return {
            client: {
              sendRequest() {
                requests += 1;
                provider.dispose();
                return Promise.reject(lateError);
              },
            },
          };
        },
      },
      projectFactory: createProjectFactory(),
      vscode,
      workspaceStepIndex: {
        completionEntries() {
          if (stage === "index") {
            provider.dispose();
            return Promise.reject(lateError);
          }
          return [{ detail: "step", label: "Pay now" }];
        },
      },
    });

    const items = await provider.provideCompletionItems(
      document,
      new vscode.Position(1, 5),
    );
    await nextTurn();

    assert.deepEqual(items, []);
    assert.equal(requests, stage === "request" ? 1 : 0);
    assert.equal(provider.activeOperations.size, 0);
  }
});

test("GaugeDynamicArgumentCompletionProvider neutralizes a throwing then getter after synchronous disposal", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const thenError = new Error("late completion then getter failure");
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });

  const items = provider.runCompletionOperation(undefined, () => {
    provider.dispose();
    return {
      get then() {
        throw thenError;
      },
    };
  });

  assert.deepEqual(items, []);
  assert.equal(provider.activeOperations.size, 0);
});

test("GaugeDynamicArgumentCompletionProvider stops fallback scans after synchronous disposal", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  let belongsCalls = 0;
  let getTextCalls = 0;
  let provider;
  const conceptDocuments = ["first", "second"].map((name) => ({
    languageId: "gauge-concept",
    uri: { fsPath: `/workspace/gauge/concepts/${name}.cpt` },
    getText() {
      getTextCalls += 1;
      return `# ${name}`;
    },
  }));
  provider = new GaugeDynamicArgumentCompletionProvider({
    diagnosticsProvider: {
      belongsToSourceGaugeProject() {
        belongsCalls += 1;
        if (belongsCalls === 1) {
          provider.dispose();
        }
        return true;
      },
      gaugeProjectRoot() {
        return "/workspace/gauge";
      },
      isGaugeProjectDocument() {
        return true;
      },
      workspaceDocuments() {
        return conceptDocuments;
      },
    },
    projectFactory: createProjectFactory(),
    vscode,
  });
  const document = createDocument(
    "# Checkout\n* ",
    "/workspace/gauge/specs/example.spec",
  );

  const items = await provider.provideCompletionItems(
    document,
    new vscode.Position(1, 2),
  );

  assert.deepEqual(items, []);
  assert.equal(belongsCalls, 1);
  assert.equal(getTextCalls, 0);
  assert.equal(provider.activeOperations.size, 0);
});

test("GaugeDynamicArgumentCompletionProvider stops tag fallback scans after synchronous disposal", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  let belongsCalls = 0;
  let getTextCalls = 0;
  let provider;
  const document = createDocument(
    "# Checkout\ntags: ",
    "/workspace/gauge/specs/example.spec",
  );
  document.getText = () => {
    getTextCalls += 1;
    return "# Checkout\ntags: ";
  };
  provider = new GaugeDynamicArgumentCompletionProvider({
    diagnosticsProvider: {
      belongsToSourceGaugeProject() {
        belongsCalls += 1;
        provider.dispose();
        return true;
      },
      gaugeProjectRoot() {
        return "/workspace/gauge";
      },
      isGaugeProjectDocument() {
        return true;
      },
      workspaceDocuments() {
        return [];
      },
    },
    projectFactory: createProjectFactory(),
    vscode,
  });

  const items = await provider.provideCompletionItems(
    document,
    new vscode.Position(1, 6),
  );

  assert.deepEqual(items, []);
  assert.equal(belongsCalls, 1);
  assert.equal(getTextCalls, 0);
  assert.equal(provider.activeOperations.size, 0);
});

test("GaugeDynamicArgumentCompletionProvider disposal settles every active request", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const cancellations = [createCancellation(), createCancellation()];
  const responses = [deferred(), deferred()];
  const outcomes = [
    { status: "pending" },
    { status: "pending" },
  ];
  let requestIndex = 0;
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
    workspaceStepIndex: {
      completionEntries() {
        const response = responses[requestIndex];
        requestIndex += 1;
        return response.promise;
      },
    },
  });
  const document = createDocument(
    "# Checkout\n* Pay",
    "/workspace/gauge/specs/example.spec",
  );
  const completions = cancellations.map((cancellation, index) => Promise.resolve(
    provider.provideCompletionItems(
      document,
      new vscode.Position(1, 5),
      cancellation.token,
    ),
  ).then(
    (value) => {
      outcomes[index] = { status: "fulfilled", value };
    },
    (error) => {
      outcomes[index] = { error, status: "rejected" };
    },
  ));

  assert.equal(provider.activeOperations.size, 2);
  provider.dispose();
  provider.dispose();
  await nextTurn();
  const disposalOutcomes = [...outcomes];
  responses[0].resolve([{ detail: "step", label: "Old pay" }]);
  responses[1].reject(new Error("late concurrent completion failure"));
  await Promise.all(completions);

  assert.deepEqual(disposalOutcomes, [
    { status: "fulfilled", value: [] },
    { status: "fulfilled", value: [] },
  ]);
  assert.deepEqual(outcomes, disposalOutcomes);
  assert.equal(provider.activeOperations.size, 0);
  assert.equal(requestIndex, 2);
  for (const cancellation of cancellations) {
    assert.equal(cancellation.registrations(), 1);
    assert.equal(cancellation.disposals(), 1);
    assert.equal(cancellation.listenerCount(), 0);
  }
});

// A `"""` block on the line after a step is that step's multi-line argument and
// its payload is data. A payload line that looks like a step must not be offered
// as a used-step completion.
test("GaugeDynamicArgumentCompletionProvider does not offer steps from a doc string payload", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "",
    "## Buy",
    "* Send payload",
    "\"\"\"",
    "* payload that looks like a step",
    "\"\"\"",
    "* ",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec");

  const items = provider.provideCompletionItems(document, new vscode.Position(7, 2));

  assert.equal(
    labels(items).includes("payload that looks like a step"),
    false,
    labels(items).join(" | "),
  );
});
