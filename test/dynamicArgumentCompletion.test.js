const assert = require("node:assert/strict");
const path = require("node:path");
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
      Function: "function",
      Variable: "variable",
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
    lineAt(line) {
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

test("GaugeDynamicArgumentCompletionProvider requires Gauge table keyword spacing for external CSV headers", () => {
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

  assert.deepEqual(labels(items), []);
  assert.deepEqual(reads, []);
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
  assert.equal(items[0].kind, "variable");
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

test("GaugeDynamicArgumentCompletionProvider suggests Gauge tags on continuation lines", async () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const document = createDocument([
    "# Checkout",
    "tags: smoke,",
    "  ",
    "",
    "## Pay",
    "tags: fast",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
  const provider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  });

  const items = await provider.provideCompletionItems(document, new vscode.Position(2, 2));

  assert.deepEqual(labels(items), ["smoke", "fast"]);
  assert.deepEqual({ ...items[0].range.start }, { line: 2, character: 0 });
  assert.deepEqual({ ...items[0].range.end }, { line: 2, character: 2 });
});

test("GaugeDynamicArgumentCompletionProvider stops tag continuations before table keyword lines", async () => {
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

test("GaugeDynamicArgumentCompletionProvider stops tag continuations before Gauge syntax starts", async () => {
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

test("GaugeDynamicArgumentCompletionProvider stops tag continuations before legacy underline headings", async () => {
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

test("GaugeDynamicArgumentCompletionProvider ignores scenario table headers after triple-hash comments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Open cart",
    "### Notes",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "",
    "* Login as <u>",
  ].join("\n"));

  const items = provider.provideCompletionItems(document, new vscode.Position(7, 13));

  assert.deepEqual(labels(items), []);
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

test("GaugeDynamicArgumentCompletionProvider ignores indented top-level table markers", () => {
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

  assert.deepEqual(labels(items), []);
});

test("GaugeDynamicArgumentCompletionProvider ignores standalone indented table body arguments", () => {
  const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
  const vscode = createFakeVscode();
  const provider = new GaugeDynamicArgumentCompletionProvider({ vscode });
  const specBody = "  | <u>  | admin |";
  const specDocument = createDocument([
    "# Checkout",
    "| user | role |",
    "| ---- | ---- |",
    "| Bob  | admin |",
    "",
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
    new vscode.Position(7, specBody.indexOf("u") + 1),
  );
  const conceptItems = provider.provideCompletionItems(
    conceptDocument,
    new vscode.Position(3, conceptBody.indexOf("i") + 1),
  );

  assert.deepEqual(specItems, []);
  assert.deepEqual(conceptItems, []);
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

test("GaugeDynamicArgumentCompletionProvider ignores indented concept hash heading arguments", () => {
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

  assert.deepEqual(labels(stepItems), ["i"]);
  assert.deepEqual(headingItems, []);
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
            requests.push({ method, params });
            return Promise.resolve({
              items: [
                {
                  detail: "dynamic",
                  filterText: "user",
                  kind: "variable",
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
                  kind: "variable",
                  label: "account",
                  textEdit: {
                    newText: "account",
                    range: {
                      start: { line: 4, character: 11 },
                      end: { line: 4, character: 12 },
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

  const items = await provider.provideCompletionItems(specDocument, new vscode.Position(4, 12));

  assert.deepEqual(requests, [
    {
      method: "textDocument/completion",
      params: {
        position: { line: 4, character: 12 },
        textDocument: { uri: "file:///workspace/gauge/specs/example.spec" },
      },
    },
  ]);
  assert.deepEqual(labels(items), ["user", "account"]);
  assert.equal(items[1].detail, "dynamic");
  assert.equal(items[1].insertText, "account");
  assert.equal(items[1].filterText, "account");
  assert.deepEqual({ ...items[1].range.start }, { line: 4, character: 11 });
  assert.deepEqual({ ...items[1].range.end }, { line: 4, character: 12 });
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
  assert.equal(items[0].kind, "variable");
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

test("GaugeDynamicArgumentCompletionProvider keeps static arguments after indented teardown markers", () => {
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

  assert.deepEqual(labels(items), ["c", "temp"]);
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
  assert.equal(items[0].kind, "function");
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
                  kind: "function",
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
                  kind: "function",
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
