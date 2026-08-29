const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode() {
  return {
    Location: class Location {
      constructor(uri, range) {
        this.uri = uri;
        this.range = range;
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
    SymbolInformation: class SymbolInformation {
      constructor(name, kind, rangeOrLocation, uri) {
        this.name = name;
        this.kind = kind;
        if (rangeOrLocation && rangeOrLocation.range) {
          this.location = rangeOrLocation;
        } else {
          this.location = { uri, range: rangeOrLocation };
        }
      }
    },
    SymbolKind: {
      Namespace: 3,
    },
  };
}

function createDocument(text, fsPath = "/workspace/gauge/specs/example.spec", languageId = "gauge") {
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
    get lineCount() {
      return lines.length;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createCancellationToken(initiallyCancelled = false) {
  const listeners = new Set();
  const state = {
    cancelled: initiallyCancelled,
    disposals: 0,
    registrations: 0,
  };
  const token = {
    get isCancellationRequested() {
      return state.cancelled;
    },
    onCancellationRequested(listener) {
      state.registrations += 1;
      listeners.add(listener);
      let disposed = false;
      return {
        dispose() {
          if (disposed) {
            return;
          }
          disposed = true;
          state.disposals += 1;
          listeners.delete(listener);
        },
      };
    },
  };
  return {
    cancel() {
      if (state.cancelled) {
        return;
      }
      state.cancelled = true;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    listenerCount() {
      return listeners.size;
    },
    state,
    token,
  };
}

function createWorkspaceSymbolProjectScopeFixture() {
  const gaugeDocument = createDocument(
    "# Shared Gauge concept",
    "/workspace/gauge/specs/shared.cpt",
    "gauge-concept",
  );
  const notesDocument = createDocument(
    "# Shared notes concept",
    "/workspace/notes/shared.cpt",
    "gauge-concept",
  );
  const missingDocument = createDocument(
    "# Shared missing concept",
    "/workspace/missing/shared.cpt",
    "gauge-concept",
  );
  const brokenDocument = createDocument(
    "# Shared broken concept",
    "/workspace/broken/shared.cpt",
    "gauge-concept",
  );
  const checkDocument = createDocument(
    "# Shared check concept",
    "/workspace/check/shared.cpt",
    "gauge-concept",
  );
  const lookups = [];
  return {
    brokenDocument,
    checkDocument,
    gaugeDocument,
    lookups,
    missingDocument,
    notesDocument,
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        lookups.push(file);
        if (file === brokenDocument.uri.fsPath) {
          throw new Error("project lookup failed");
        }
        if (file === checkDocument.uri.fsPath) {
          return "/workspace/check";
        }
        if (file === missingDocument.uri.fsPath) {
          return undefined;
        }
        return file.startsWith("/workspace/gauge/")
          ? "/workspace/gauge"
          : "/workspace/notes";
      },
      isGaugeProject(root) {
        if (root === "/workspace/check") {
          throw new Error("project check failed");
        }
        return root === "/workspace/gauge";
      },
    },
  };
}

// references/gauge/parser/lex.go isScenarioHeading rejects a third '#', so
// "### Third scenario" is a comment and gets no symbol. Verified against the
// real parser.
test("GaugeDocumentSymbolProvider lists specification and scenario symbols", () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const provider = new GaugeDocumentSymbolProvider({ vscode });
  const document = createDocument([
    "# Specification Heading",
    "tags: smoke",
    "* Context",
    "",
    "## First scenario",
    "* Step",
    "",
    "### Third scenario",
    "",
    "## Second scenario",
    "* Step",
  ].join("\n"));

  const symbols = provider.provideDocumentSymbols(document);

  assert.deepEqual(symbols.map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    uri: symbol.location.uri,
    range: {
      start: { ...symbol.location.range.start },
      end: { ...symbol.location.range.end },
    },
  })), [
    {
      name: "# Specification Heading",
      kind: 3,
      uri: document.uri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 23 },
      },
    },
    {
      name: "## First scenario",
      kind: 3,
      uri: document.uri,
      range: {
        start: { line: 4, character: 0 },
        end: { line: 4, character: 17 },
      },
    },
    {
      name: "## Second scenario",
      kind: 3,
      uri: document.uri,
      range: {
        start: { line: 9, character: 0 },
        end: { line: 9, character: 18 },
      },
    },
  ]);
});

test("GaugeDocumentSymbolProvider lists concept symbols by extension", () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const provider = new GaugeDocumentSymbolProvider({ vscode });
  const document = createDocument([
    "  # Shared checkout",
    "* Reuse",
    "",
    "# Shared payment",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared.cpt", "plaintext");

  const symbols = provider.provideDocumentSymbols(document);

  assert.deepEqual(symbols.map((symbol) => symbol.name), [
    "# Shared checkout",
    "# Shared payment",
  ]);
  assert.deepEqual({ ...symbols[0].location.range.start }, { line: 0, character: 2 });
  assert.deepEqual({ ...symbols[1].location.range.start }, { line: 3, character: 0 });
});

test("GaugeDocumentSymbolProvider lists concept symbols by language id", () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const provider = new GaugeDocumentSymbolProvider({
    projectFactory: {
      getGaugeRootFromFilePath() {
        throw new Error("explicit Gauge concept documents should not require project lookup");
      },
    },
    vscode,
  });
  const document = createDocument([
    "  # Shared checkout",
    "* Reuse",
    "",
    "# Shared payment",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared", "gauge-concept");

  const symbols = provider.provideDocumentSymbols(document);

  assert.deepEqual(symbols.map((symbol) => symbol.name), [
    "# Shared checkout",
    "# Shared payment",
  ]);
  assert.deepEqual({ ...symbols[0].location.range.start }, { line: 0, character: 2 });
  assert.deepEqual({ ...symbols[1].location.range.start }, { line: 3, character: 0 });
});

test("GaugeDocumentSymbolProvider ignores Gauge files when project root is unresolved", () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const provider = new GaugeDocumentSymbolProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/example.spec");
        return undefined;
      },
    },
    vscode,
  });
  const document = createDocument([
    "# Notes",
    "",
    "## Draft",
  ].join("\n"), "/workspace/notes/example.spec", "plaintext");

  assert.deepEqual(provider.provideDocumentSymbols(document), []);
});

test("GaugeDocumentSymbolProvider prefixes legacy underline symbols like Gauge LSP", () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const provider = new GaugeDocumentSymbolProvider({ vscode });
  const specDocument = createDocument([
    "Specification Heading",
    "=====================",
    "",
    "Scenario Heading",
    "----------------",
    "* Step",
  ].join("\n"));
  const conceptDocument = createDocument([
    "Shared checkout <item>",
    "======================",
    "* Reuse <item>",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared.cpt", "gauge");

  assert.deepEqual(provider.provideDocumentSymbols(specDocument).map((symbol) => symbol.name), [
    "# Specification Heading",
    "## Scenario Heading",
  ]);
  assert.deepEqual(provider.provideDocumentSymbols(conceptDocument).map((symbol) => symbol.name), [
    "# Shared checkout <item>",
  ]);
});

test("GaugeDocumentSymbolProvider leaves specification workspace symbols to Gauge LSP", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const documents = new Map();
  const specDocument = createDocument([
    "# Specification Heading",
    "* Context",
    "",
    "## Vowel counts in single word",
    "* Count",
  ].join("\n"), "/workspace/gauge/specs/example.spec", "gauge");
  const otherSpecDocument = createDocument([
    "# Checkout",
    "* Context",
    "",
    "## Payment",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
  documents.set(specDocument.uri.fsPath, specDocument);
  documents.set(otherSpecDocument.uri.fsPath, otherSpecDocument);

  const vscode = createFakeVscode();
  const searchedPatterns = [];
  vscode.workspace = {
    async findFiles(pattern) {
      searchedPatterns.push(pattern);
      if (pattern === "**/*.cpt") {
        return [];
      }
      throw new Error(`Unexpected workspace symbol pattern: ${pattern}`);
    },
    async openTextDocument(uri) {
      return documents.get(uri.fsPath);
    },
  };
  const provider = new GaugeDocumentSymbolProvider({ vscode });

  const symbols = await provider.provideWorkspaceSymbols("Shared");

  assert.deepEqual(searchedPatterns, ["**/*.cpt"]);
  assert.deepEqual(symbols, []);
});

test("GaugeDocumentSymbolProvider lists concept workspace symbols", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const specDocument = createDocument([
    "# Shared specification",
    "* Use a shared concept",
  ].join("\n"), "/workspace/gauge/specs/shared.spec", "gauge");
  const conceptDocument = createDocument([
    "# Shared checkout",
    "* Reuse checkout",
    "",
    "# Shared payment",
    "* Reuse payment",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared.cpt", "gauge");
  const documents = new Map([
    [specDocument.uri.fsPath, specDocument],
    [conceptDocument.uri.fsPath, conceptDocument],
  ]);
  const vscode = createFakeVscode();
  const searchedPatterns = [];
  vscode.workspace = {
    async findFiles(pattern) {
      searchedPatterns.push(pattern);
      if (pattern === "**/*.spec") {
        return [specDocument.uri];
      }
      if (pattern === "**/*.cpt") {
        return [conceptDocument.uri];
      }
      throw new Error(`Unexpected workspace symbol pattern: ${pattern}`);
    },
    async openTextDocument(uri) {
      return documents.get(uri.fsPath);
    },
  };
  const provider = new GaugeDocumentSymbolProvider({ vscode });

  const symbols = await provider.provideWorkspaceSymbols("Shared");

  assert.deepEqual(searchedPatterns, ["**/*.cpt"]);
  assert.deepEqual(symbols.map((symbol) => ({
    name: symbol.name,
    uri: symbol.location.uri,
    range: {
      start: { ...symbol.location.range.start },
      end: { ...symbol.location.range.end },
    },
  })), [
    {
      name: "# Shared checkout",
      uri: conceptDocument.uri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 17 },
      },
    },
    {
      name: "# Shared payment",
      uri: conceptDocument.uri,
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 16 },
      },
    },
  ]);
});

test("GaugeDocumentSymbolProvider excludes closed doc string headings from concept workspace symbols", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const documents = [
    createDocument([
      "# Owner concept",
      "* Send payload",
      "\"\"\"",
      "# Payload hash hidden",
      "Payload legacy hidden",
      "=====================",
      "\"\"\"",
      "# Payload retained",
      "* Retained step",
    ].join("\n"), "/workspace/gauge/specs/closed.cpt", "gauge-concept"),
    createDocument([
      "# Unterminated owner",
      "* Send payload",
      "\"\"\"",
      "# Payload unterminated",
      "* Unterminated step",
    ].join("\n"), "/workspace/gauge/specs/unterminated.cpt", "gauge-concept"),
    createDocument([
      "** Comment",
      "\"\"\"",
      "# Payload comment visible",
      "\"\"\"",
      "* Comment step",
    ].join("\n"), "/workspace/gauge/specs/comment.cpt", "gauge-concept"),
    createDocument([
      "* Send payload",
      "",
      "\"\"\"",
      "# Payload separated visible",
      "\"\"\"",
      "* Separated step",
    ].join("\n"), "/workspace/gauge/specs/separated.cpt", "gauge-concept"),
  ];
  const documentStore = {
    documents() {
      return documents;
    },
    onDidChangeDocuments() {
      return { dispose() {} };
    },
    async whenReady() {},
  };
  const provider = new GaugeDocumentSymbolProvider({ documentStore, vscode });

  const symbols = await provider.provideWorkspaceSymbols("Payload");
  provider.dispose();

  assert.deepEqual(symbols.map((symbol) => ({
    file: symbol.location.uri.fsPath,
    line: symbol.location.range.start.line,
    name: symbol.name,
  })), [
    {
      file: "/workspace/gauge/specs/comment.cpt",
      line: 2,
      name: "# Payload comment visible",
    },
    {
      file: "/workspace/gauge/specs/closed.cpt",
      line: 7,
      name: "# Payload retained",
    },
    {
      file: "/workspace/gauge/specs/separated.cpt",
      line: 3,
      name: "# Payload separated visible",
    },
    {
      file: "/workspace/gauge/specs/unterminated.cpt",
      line: 3,
      name: "# Payload unterminated",
    },
  ]);
});

test("GaugeDocumentSymbolProvider excludes non-Gauge open concepts from stored workspace symbols", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const fixture = createWorkspaceSymbolProjectScopeFixture();

  const provider = new GaugeDocumentSymbolProvider({
    documentStore: {
      documents() {
        return [
          fixture.gaugeDocument,
          fixture.notesDocument,
          fixture.missingDocument,
          fixture.brokenDocument,
          fixture.checkDocument,
        ];
      },
      async whenReady() {},
    },
    projectFactory: fixture.projectFactory,
    vscode: createFakeVscode(),
  });
  const symbols = await provider.provideWorkspaceSymbols("Shared");

  assert.deepEqual({
    files: symbols.map((symbol) => symbol.location.uri.fsPath),
    lookups: fixture.lookups,
    records: [...provider.workspaceSymbolRecords.keys()],
  }, {
    files: [fixture.gaugeDocument.uri.fsPath],
    lookups: [
      fixture.gaugeDocument.uri.fsPath,
      fixture.notesDocument.uri.fsPath,
      fixture.missingDocument.uri.fsPath,
      fixture.brokenDocument.uri.fsPath,
      fixture.checkDocument.uri.fsPath,
    ],
    records: [fixture.gaugeDocument.uri.fsPath],
  });
});

test("GaugeDocumentSymbolProvider skips non-Gauge fallback concepts before opening documents", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const fixture = createWorkspaceSymbolProjectScopeFixture();

  const openedFiles = [];
  const mismatchedUri = { fsPath: "/workspace/gauge/specs/mismatched.cpt" };
  const fallbackVscode = createFakeVscode();
  fallbackVscode.workspace = {
    async findFiles(pattern) {
      assert.equal(pattern, "**/*.cpt");
      return [
        fixture.gaugeDocument.uri,
        mismatchedUri,
        fixture.notesDocument.uri,
        fixture.missingDocument.uri,
        fixture.brokenDocument.uri,
        fixture.checkDocument.uri,
      ];
    },
    async openTextDocument(uri) {
      openedFiles.push(uri.fsPath);
      return uri.fsPath === fixture.gaugeDocument.uri.fsPath
        ? fixture.gaugeDocument
        : fixture.notesDocument;
    },
  };
  const provider = new GaugeDocumentSymbolProvider({
    projectFactory: fixture.projectFactory,
    vscode: fallbackVscode,
  });
  const symbols = await provider.provideWorkspaceSymbols("Shared");

  assert.deepEqual({
    files: symbols.map((symbol) => symbol.location.uri.fsPath),
    lookups: fixture.lookups,
    openedFiles,
  }, {
    files: [fixture.gaugeDocument.uri.fsPath],
    lookups: [
      fixture.gaugeDocument.uri.fsPath,
      mismatchedUri.fsPath,
      fixture.notesDocument.uri.fsPath,
      fixture.missingDocument.uri.fsPath,
      fixture.brokenDocument.uri.fsPath,
      fixture.checkDocument.uri.fsPath,
      fixture.gaugeDocument.uri.fsPath,
      fixture.notesDocument.uri.fsPath,
    ],
    openedFiles: [fixture.gaugeDocument.uri.fsPath, mismatchedUri.fsPath],
  });
});

test("GaugeDocumentSymbolProvider stops project scope checks after synchronous disposal", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const first = createDocument(
    "# Shared first",
    "/workspace/gauge/specs/first.cpt",
    "gauge-concept",
  );
  const second = createDocument(
    "# Shared second",
    "/workspace/gauge/specs/second.cpt",
    "gauge-concept",
  );
  const snapshots = [];

  for (const source of ["store", "fallback"]) {
    let lookups = 0;
    let opens = 0;
    let provider;
    const projectFactory = {
      getGaugeRootFromFilePath() {
        lookups += 1;
        provider.dispose();
        return "/workspace/gauge";
      },
      isGaugeProject() {
        return true;
      },
    };
    const vscode = createFakeVscode();
    const options = { projectFactory, vscode };
    if (source === "store") {
      options.documentStore = {
        documents() {
          return [first, second];
        },
        async whenReady() {},
      };
    } else {
      vscode.workspace = {
        async findFiles() {
          return [first.uri, second.uri];
        },
        async openTextDocument() {
          opens += 1;
          return first;
        },
      };
    }
    provider = new GaugeDocumentSymbolProvider(options);
    const result = await provider.provideWorkspaceSymbols("Shared");
    snapshots.push({
      lookups,
      opens,
      records: provider.workspaceSymbolRecords.size,
      result,
      source,
    });
  }

  assert.deepEqual(snapshots, [
    { lookups: 1, opens: 0, records: 0, result: [], source: "store" },
    { lookups: 1, opens: 0, records: 0, result: [], source: "fallback" },
  ]);
});

test("GaugeDocumentSymbolProvider matches raw queries against concept heading values", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const conceptDocument = createDocument([
    "# Shared checkout",
    "* Reuse checkout",
    "",
    "# Shared payment",
    "* Reuse payment",
    "",
    "#Compact checkout",
    "* Reuse compact checkout",
    "",
    "#   Spaced checkout",
    "* Reuse spaced checkout",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared.cpt", "gauge-concept");
  const documentStore = {
    documents() {
      return [conceptDocument];
    },
    async whenReady() {},
  };
  const provider = new GaugeDocumentSymbolProvider({ documentStore, vscode });
  const queries = [
    "Shared",
    " p",
    "# S",
    "## S",
    "\"Shared\"",
    " Shared",
    "#C",
    "  S",
    "Compact",
    "Spaced",
  ];
  const results = [];

  for (const query of queries) {
    results.push((await provider.provideWorkspaceSymbols(query))
      .map((symbol) => symbol.name));
  }

  // A concept heading is a single "#", so this file holds no "##" heading and the
  // queries that only matched one ("# S" and " Shared", which used to hit
  // "## Shared payment") now match nothing. Scenario "##" matching is covered by
  // the specification-side tests above.
  assert.deepEqual(results, [
    ["# Shared checkout", "# Shared payment"],
    ["# Shared payment"],
    [],
    [],
    [],
    [],
    [],
    [],
    ["#Compact checkout"],
    ["#   Spaced checkout"],
  ]);
});

test("GaugeDocumentSymbolProvider groups and sorts concept workspace symbols", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const leftDocument = createDocument([
    "# Sample 2",
    "## Scenario Sample 5",
    "* Pay",
    "",
    "## Sample Scenario 6",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/b.cpt", "gauge-concept");
  const rightDocument = createDocument([
    "# Sample 1",
    "## Sample Scenario 1",
    "* Pay",
    "",
    "## Scenario Sample 2",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/a.cpt", "gauge-concept");
  const documents = new Map([
    [leftDocument.uri.fsPath, leftDocument],
    [rightDocument.uri.fsPath, rightDocument],
  ]);
  const vscode = createFakeVscode();
  vscode.workspace = {
    async findFiles(pattern) {
      if (pattern === "**/*.cpt") {
        return [leftDocument.uri, rightDocument.uri];
      }
      throw new Error(`Unexpected workspace symbol pattern: ${pattern}`);
    },
    async openTextDocument(uri) {
      return documents.get(uri.fsPath);
    },
  };
  const provider = new GaugeDocumentSymbolProvider({ vscode });

  const symbols = await provider.provideWorkspaceSymbols("Sample");

  assert.deepEqual(symbols.map((symbol) => symbol.name), [
    // A "##" line in a .cpt is a scenario heading Gauge rejects there, not a
    // symbol. Verified against parser.CreateConceptsDictionary - see
    // test/fixtures/concept-parity.json "hash scenario".
    "# Sample 1",
    "# Sample 2",
  ]);
});

test("GaugeDocumentSymbolProvider uses the shared document store without workspace scans", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const specPath = "/workspace/gauge/specs/example.spec";
  const conceptPath = "/workspace/gauge/specs/concepts/shared.cpt";
  const diskFiles = new Map([
    [specPath, [
      "# Specification Heading",
      "* Context",
      "",
      "## Vowel counts in single word",
      "* Count",
    ].join("\n")],
    [conceptPath, [
      "# Shared checkout",
      "* Reuse checkout",
    ].join("\n")],
  ]);
  const findFilesPatterns = [];
  const openedFiles = [];
  const vscode = createFakeVscode();
  vscode.workspace = {
    textDocuments: [],
    async findFiles(pattern) {
      findFilesPatterns.push(pattern);
      return [{ fsPath: specPath }, { fsPath: conceptPath }];
    },
    async openTextDocument(uri) {
      openedFiles.push(uri.fsPath);
      return createDocument(diskFiles.get(uri.fsPath) || "", uri.fsPath);
    },
  };
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
    vscode,
  });
  await documentStore.whenReady();
  const provider = new GaugeDocumentSymbolProvider({ documentStore, vscode });

  const symbols = await provider.provideWorkspaceSymbols("Shared");

  assert.deepEqual(symbols.map((symbol) => ({
    name: symbol.name,
    fsPath: symbol.location.uri.fsPath,
    range: {
      start: { ...symbol.location.range.start },
      end: { ...symbol.location.range.end },
    },
  })), [
    {
      name: "# Shared checkout",
      fsPath: conceptPath,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 17 },
      },
    },
  ]);
  assert.equal(
    findFilesPatterns.length,
    1,
    `expected only the store scan, saw findFiles patterns: ${findFilesPatterns.join(", ")}`,
  );
  assert.deepEqual(openedFiles, []);
  assert.deepEqual([...provider.workspaceSymbolRecords.keys()], [conceptPath]);
  provider.dispose();
  assert.equal(provider.workspaceSymbolRecords.size, 0);
});

test("GaugeDocumentSymbolProvider reparses only changed concept workspace documents", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const listeners = [];
  let documents = [
    createDocument("# Spec Alpha\n## Scenario Alpha", "/workspace/gauge/specs/a.cpt", "gauge-concept"),
    createDocument("# Spec Beta\n## Scenario Beta", "/workspace/gauge/specs/b.cpt", "gauge-concept"),
    createDocument("# Shared Concept\n* Reuse", "/workspace/gauge/specs/shared.cpt", "gauge-concept"),
  ];
  const documentStore = {
    documents() {
      return documents;
    },
    onDidChangeDocuments(listener) {
      listeners.push(listener);
      return { dispose() {} };
    },
    async whenReady() {},
  };
  const provider = new GaugeDocumentSymbolProvider({ documentStore, vscode });
  const analyze = provider.provideDocumentSymbols.bind(provider);
  let analyses = 0;
  provider.provideDocumentSymbols = (document) => {
    analyses += 1;
    return analyze(document);
  };

  await provider.provideWorkspaceSymbols("Spec");
  assert.equal(analyses, 3);

  await provider.provideWorkspaceSymbols("Scenario");
  assert.equal(analyses, 3, "an unchanged query must reuse parsed workspace symbols");

  listeners[0]({ file: "/workspace/gauge/specs/ignored.spec" });
  await provider.provideWorkspaceSymbols("Scenario");
  assert.equal(analyses, 3, "a specification change must remain Gauge LSP-owned");

  documents = documents.map((document) => (
    document.uri.fsPath === "/workspace/gauge/specs/b.cpt"
      ? createDocument(
        "# Updated Beta\n## Updated Scenario",
        "/workspace/gauge/specs/b.cpt",
        "gauge-concept",
      )
      : document
  ));
  listeners[0]({ file: "/workspace/gauge/specs/b.cpt" });
  const updated = await provider.provideWorkspaceSymbols("Updated");

  assert.equal(analyses, 4, "a watcher update must reparse only the changed document");
  assert.deepEqual(updated.map((symbol) => symbol.name), [
    // "##" in a .cpt is not a concept symbol; see the note above.
    "# Updated Beta",
  ]);
});

test("GaugeDocumentSymbolProvider waits for the latest pending workspace symbol refresh", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const file = "/workspace/gauge/specs/example.cpt";
  const original = createDocument("# Original", file, "gauge-concept");
  const intermediate = createDocument("# Intermediate", file, "gauge-concept");
  const finalDocument = createDocument("# Final", file, "gauge-concept");
  const listeners = [];
  let documents = [original];
  let replaceDuringNextRead = false;
  let readyCalls = 0;
  let markRefreshEntered;
  const refreshEntered = new Promise((resolve) => {
    markRefreshEntered = resolve;
  });
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  const documentStore = {
    documents() {
      const result = documents;
      if (replaceDuringNextRead) {
        replaceDuringNextRead = false;
        documents = [finalDocument];
        for (const listener of listeners) {
          listener({ file });
        }
      }
      return result;
    },
    onDidChangeDocuments(listener) {
      listeners.push(listener);
      return { dispose() {} };
    },
    async whenReady() {
      readyCalls += 1;
      if (readyCalls === 2) {
        markRefreshEntered();
        await refreshGate;
      }
    },
  };
  const provider = new GaugeDocumentSymbolProvider({ documentStore, vscode });

  assert.deepEqual(
    (await provider.provideWorkspaceSymbols("Original")).map((symbol) => symbol.name),
    ["# Original"],
  );

  documents = [intermediate];
  listeners[0]({ file });
  replaceDuringNextRead = true;
  const firstSymbols = provider.provideWorkspaceSymbols("Final");
  await refreshEntered;
  const concurrentSymbols = provider.provideWorkspaceSymbols("Final");
  releaseRefresh();

  const [firstResult, concurrentResult] = await Promise.all([firstSymbols, concurrentSymbols]);
  assert.deepEqual(firstResult.map((symbol) => symbol.name), ["# Final"]);
  assert.deepEqual(concurrentResult.map((symbol) => symbol.name), ["# Final"]);
  assert.equal(readyCalls, 3);
});

test("GaugeDocumentSymbolProvider detaches a cancelled workspace symbol query from a shared refresh", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const refreshEntered = deferred();
  const releaseRefresh = deferred();
  const cancellation = createCancellationToken();
  const conceptDocument = createDocument(
    "# Shared checkout",
    "/workspace/gauge/specs/concepts/shared.cpt",
    "gauge-concept",
  );
  let documentReads = 0;
  let readyCalls = 0;
  const documentStore = {
    documents() {
      documentReads += 1;
      return [conceptDocument];
    },
    onDidChangeDocuments() {
      return { dispose() {} };
    },
    async whenReady() {
      readyCalls += 1;
      refreshEntered.resolve();
      await releaseRefresh.promise;
    },
  };
  const provider = new GaugeDocumentSymbolProvider({ documentStore, vscode });
  const cancelledQuery = provider.provideWorkspaceSymbols("Shared", cancellation.token);
  const liveQuery = provider.provideWorkspaceSymbols("Shared");
  const cancelledOutcome = { settled: false };
  cancelledQuery.then(
    (value) => {
      cancelledOutcome.settled = true;
      cancelledOutcome.value = value;
    },
    (error) => {
      cancelledOutcome.error = error;
      cancelledOutcome.settled = true;
    },
  );

  await refreshEntered.promise;
  assert.equal(provider.activeWorkspaceSymbolOperations.size, 2);
  cancellation.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  const outcomeBeforeRefresh = { ...cancelledOutcome };
  const listenersBeforeRefresh = cancellation.listenerCount();
  const activeBeforeRefresh = provider.activeWorkspaceSymbolOperations.size;

  releaseRefresh.resolve();
  const [cancelledSymbols, liveSymbols] = await Promise.all([cancelledQuery, liveQuery]);
  const activeFinished = provider.activeWorkspaceSymbolOperations.size;
  provider.dispose();

  assert.deepEqual(outcomeBeforeRefresh, { settled: true, value: [] });
  assert.deepEqual(cancelledSymbols, []);
  assert.deepEqual(liveSymbols.map((symbol) => symbol.name), ["# Shared checkout"]);
  assert.deepEqual({
    activeBeforeRefresh,
    activeFinished,
    disposals: cancellation.state.disposals,
    documentReads,
    listenersBeforeRefresh,
    readyCalls,
    registrations: cancellation.state.registrations,
  }, {
    activeBeforeRefresh: 1,
    activeFinished: 0,
    disposals: 1,
    documentReads: 1,
    listenersBeforeRefresh: 0,
    readyCalls: 1,
    registrations: 1,
  });
});

test("GaugeDocumentSymbolProvider skips pre-cancelled and synchronously cancelled workspace symbol queries", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  let readyCalls = 0;
  const documentStore = {
    documents() {
      throw new Error("cancelled queries must not read documents");
    },
    onDidChangeDocuments() {
      return { dispose() {} };
    },
    async whenReady() {
      readyCalls += 1;
    },
  };

  const preCancelled = createCancellationToken(true);
  const preCancelledProvider = new GaugeDocumentSymbolProvider({ documentStore, vscode });
  const preCancelledResult = preCancelledProvider.provideWorkspaceSymbols(
    "Shared",
    preCancelled.token,
  );
  assert.deepEqual(preCancelledResult, []);
  assert.deepEqual({
    active: preCancelledProvider.activeWorkspaceSymbolOperations.size,
    disposals: preCancelled.state.disposals,
    listeners: preCancelled.listenerCount(),
    registrations: preCancelled.state.registrations,
  }, {
    active: 0,
    disposals: 0,
    listeners: 0,
    registrations: 0,
  });
  preCancelledProvider.dispose();

  let synchronousDisposals = 0;
  let synchronousRegistrations = 0;
  const synchronousToken = {
    isCancellationRequested: false,
    onCancellationRequested(listener) {
      synchronousRegistrations += 1;
      listener();
      return {
        dispose() {
          synchronousDisposals += 1;
        },
      };
    },
  };
  const synchronousProvider = new GaugeDocumentSymbolProvider({ documentStore, vscode });
  const synchronousResult = synchronousProvider.provideWorkspaceSymbols(
    "Shared",
    synchronousToken,
  );

  assert.deepEqual(synchronousResult, []);
  assert.deepEqual({
    active: synchronousProvider.activeWorkspaceSymbolOperations.size,
    disposals: synchronousDisposals,
    readyCalls,
    registrations: synchronousRegistrations,
  }, {
    active: 0,
    disposals: 1,
    readyCalls: 0,
    registrations: 1,
  });
  synchronousProvider.dispose();
});

test("GaugeDocumentSymbolProvider detaches terminal fallback queries from a pending document read", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");

  for (const terminal of ["host cancellation", "provider disposal"]) {
    const vscode = createFakeVscode();
    const readEntered = deferred();
    const releaseRead = deferred();
    const cancellation = createCancellationToken();
    const firstUri = { fsPath: `/workspace/gauge/specs/${terminal}-first.cpt` };
    const secondUri = { fsPath: `/workspace/gauge/specs/${terminal}-second.cpt` };
    const opened = [];
    vscode.workspace = {
      async findFiles() {
        return [firstUri, secondUri];
      },
      async openTextDocument(uri) {
        opened.push(uri);
        if (uri === firstUri) {
          readEntered.resolve();
          return releaseRead.promise;
        }
        return createDocument("# Shared second", uri.fsPath, "gauge-concept");
      },
    };
    const provider = new GaugeDocumentSymbolProvider({ vscode });
    const symbolsPromise = provider.provideWorkspaceSymbols("Shared", cancellation.token);
    const outcome = { settled: false };
    Promise.resolve(symbolsPromise).then(
      (value) => {
        outcome.settled = true;
        outcome.value = value;
      },
      (error) => {
        outcome.error = error;
        outcome.settled = true;
      },
    );

    await readEntered.promise;
    if (terminal === "host cancellation") {
      cancellation.cancel();
    } else {
      provider.dispose();
    }
    await new Promise((resolve) => setImmediate(resolve));
    const outcomeBeforeRead = { ...outcome };
    const activeBeforeRead = provider.activeWorkspaceSymbolOperations.size;

    if (terminal === "host cancellation") {
      releaseRead.resolve(createDocument("# Shared first", firstUri.fsPath, "gauge-concept"));
    } else {
      releaseRead.reject(new Error("disposed fallback read failed"));
    }
    assert.deepEqual(await symbolsPromise, []);
    await new Promise((resolve) => setImmediate(resolve));
    provider.dispose();

    assert.deepEqual(outcomeBeforeRead, { settled: true, value: [] }, terminal);
    assert.equal(activeBeforeRead, 0, terminal);
    assert.deepEqual(opened, [firstUri], terminal);
    assert.deepEqual({
      disposals: cancellation.state.disposals,
      listeners: cancellation.listenerCount(),
      registrations: cancellation.state.registrations,
    }, {
      disposals: 1,
      listeners: 0,
      registrations: 1,
    }, terminal);
  }
});

test("GaugeDocumentSymbolProvider preserves live workspace symbol failures", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const cancellation = createCancellationToken();
  const requestError = new Error("workspace symbol refresh failed");
  const documentStore = {
    documents() {
      throw new Error("failed refreshes must not read documents");
    },
    onDidChangeDocuments() {
      return { dispose() {} };
    },
    async whenReady() {
      throw requestError;
    },
  };
  const provider = new GaugeDocumentSymbolProvider({ documentStore, vscode });

  await assert.rejects(
    provider.provideWorkspaceSymbols("Shared", cancellation.token),
    (error) => error === requestError,
  );

  assert.deepEqual({
    active: provider.activeWorkspaceSymbolOperations.size,
    disposals: cancellation.state.disposals,
    listeners: cancellation.listenerCount(),
    registrations: cancellation.state.registrations,
  }, {
    active: 0,
    disposals: 1,
    listeners: 0,
    registrations: 1,
  });
  provider.dispose();
});

test("GaugeDocumentSymbolProvider does not republish cache state after synchronous disposal", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const documents = [
    createDocument("# Shared first", "/workspace/gauge/specs/first.cpt", "gauge-concept"),
    createDocument("# Shared second", "/workspace/gauge/specs/second.cpt", "gauge-concept"),
  ];
  const documentStore = {
    documents() {
      return documents;
    },
    onDidChangeDocuments() {
      return { dispose() {} };
    },
    async whenReady() {},
  };
  const provider = new GaugeDocumentSymbolProvider({ documentStore, vscode });
  const provideDocumentSymbols = provider.provideDocumentSymbols.bind(provider);
  let analyses = 0;
  provider.provideDocumentSymbols = (document) => {
    analyses += 1;
    if (analyses === 1) {
      provider.dispose();
    }
    return provideDocumentSymbols(document);
  };

  assert.deepEqual(await provider.provideWorkspaceSymbols("Shared"), []);
  assert.deepEqual({
    analyses,
    entries: provider.workspaceSymbolEntries,
    ready: provider.workspaceSymbolReady,
    records: provider.workspaceSymbolRecords.size,
  }, {
    analyses: 1,
    entries: [],
    ready: false,
    records: 0,
  });
});

test("GaugeDocumentSymbolProvider completes disposal when its store subscription throws", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const conceptDocument = createDocument(
    "# Shared checkout",
    "/workspace/gauge/specs/shared.cpt",
    "gauge-concept",
  );
  let changeListener;
  let subscriptionDisposals = 0;
  const documentStore = {
    documents() {
      return [conceptDocument];
    },
    onDidChangeDocuments(listener) {
      changeListener = listener;
      return {
        dispose() {
          subscriptionDisposals += 1;
          throw new Error("store subscription cleanup failed");
        },
      };
    },
    async whenReady() {},
  };
  const provider = new GaugeDocumentSymbolProvider({ documentStore, vscode });
  assert.deepEqual(
    (await provider.provideWorkspaceSymbols("Shared")).map((symbol) => symbol.name),
    ["# Shared checkout"],
  );

  let disposalError;
  try {
    provider.dispose();
  } catch (error) {
    disposalError = error;
  }
  changeListener({ file: conceptDocument.uri.fsPath });
  provider.dispose();

  assert.deepEqual({
    active: provider.activeWorkspaceSymbolOperations.size,
    dirty: provider.workspaceSymbolDirtyFiles.size,
    disposalError,
    entries: provider.workspaceSymbolEntries,
    fullDirty: provider.workspaceSymbolFullDirty,
    ready: provider.workspaceSymbolReady,
    records: provider.workspaceSymbolRecords.size,
    subscription: provider.documentStoreSubscription,
    subscriptionDisposals,
  }, {
    active: 0,
    dirty: 0,
    disposalError: undefined,
    entries: [],
    fullDirty: false,
    ready: false,
    records: 0,
    subscription: undefined,
    subscriptionDisposals: 1,
  });
});

test("GaugeDocumentSymbolProvider restores workspace symbol invalidations after refresh failure", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const file = "/workspace/gauge/specs/example.cpt";
  const listeners = [];
  let documents = [createDocument("# Original", file, "gauge-concept")];
  let nextFailure;
  const documentStore = {
    documents() {
      return documents;
    },
    onDidChangeDocuments(listener) {
      listeners.push(listener);
      return { dispose() {} };
    },
    async whenReady() {
      if (nextFailure) {
        const failure = nextFailure;
        nextFailure = undefined;
        throw new Error(failure);
      }
    },
  };
  const provider = new GaugeDocumentSymbolProvider({ documentStore, vscode });

  assert.deepEqual(
    (await provider.provideWorkspaceSymbols("Original")).map((symbol) => symbol.name),
    ["# Original"],
  );

  documents = [createDocument("# Full Refresh", file, "gauge-concept")];
  listeners[0]({});
  nextFailure = "full refresh failed";
  await assert.rejects(
    () => provider.provideWorkspaceSymbols("Full"),
    /full refresh failed/,
  );
  assert.deepEqual(
    (await provider.provideWorkspaceSymbols("Full")).map((symbol) => symbol.name),
    ["# Full Refresh"],
  );

  documents = [createDocument("# File Refresh", file, "gauge-concept")];
  listeners[0]({ file });
  nextFailure = "file refresh failed";
  await assert.rejects(
    () => provider.provideWorkspaceSymbols("File"),
    /file refresh failed/,
  );
  assert.deepEqual(
    (await provider.provideWorkspaceSymbols("File")).map((symbol) => symbol.name),
    ["# File Refresh"],
  );
});

test("GaugeDocumentSymbolProvider returns no workspace symbols after disposal during refresh", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const refreshEntered = deferred();
  const releaseRefresh = deferred();
  const listeners = new Set();
  let analyses = 0;
  let documentReads = 0;
  let readyCalls = 0;
  const documentStore = {
    documents() {
      documentReads += 1;
      return [createDocument("# Disposed Refresh")];
    },
    onDidChangeDocuments(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    async whenReady() {
      readyCalls += 1;
      refreshEntered.resolve();
      await releaseRefresh.promise;
    },
  };
  const provider = new GaugeDocumentSymbolProvider({ documentStore, vscode });
  const analyze = provider.provideDocumentSymbols.bind(provider);
  provider.provideDocumentSymbols = (document) => {
    analyses += 1;
    return analyze(document);
  };

  const pendingSymbols = provider.provideWorkspaceSymbols("Disposed");
  const outcome = { settled: false };
  Promise.resolve(pendingSymbols).then((value) => {
    outcome.settled = true;
    outcome.value = value;
  });
  await refreshEntered.promise;

  assert.equal(listeners.size, 1);
  provider.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  const outcomeBeforeRefresh = { ...outcome };
  assert.equal(listeners.size, 0);
  assert.equal(provider.activeWorkspaceSymbolOperations.size, 0);
  assert.equal(provider.workspaceSymbolRecords.size, 0);
  assert.deepEqual(provider.workspaceSymbolEntries, []);

  releaseRefresh.resolve();
  assert.deepEqual(await pendingSymbols, []);
  assert.deepEqual(outcomeBeforeRefresh, { settled: true, value: [] });
  assert.deepEqual(await provider.provideWorkspaceSymbols("Disposed"), []);
  assert.deepEqual({
    analyses,
    documentReads,
    entries: provider.workspaceSymbolEntries,
    readyCalls,
    records: provider.workspaceSymbolRecords.size,
  }, {
    analyses: 0,
    documentReads: 0,
    entries: [],
    readyCalls: 1,
    records: 0,
  });
});

test("GaugeDocumentSymbolProvider suppresses refresh failures after disposal", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const refreshEntered = deferred();
  const releaseRefresh = deferred();
  const listeners = new Set();
  let readyCalls = 0;
  const documentStore = {
    documents() {
      throw new Error("documents must not be read after disposal");
    },
    onDidChangeDocuments(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    async whenReady() {
      readyCalls += 1;
      refreshEntered.resolve();
      await releaseRefresh.promise;
      throw new Error("disposed workspace symbol refresh failed");
    },
  };
  const provider = new GaugeDocumentSymbolProvider({ documentStore, vscode });

  const pendingSymbols = provider.provideWorkspaceSymbols("Disposed");
  const outcome = { settled: false };
  Promise.resolve(pendingSymbols).then(
    (value) => {
      outcome.settled = true;
      outcome.value = value;
    },
    (error) => {
      outcome.error = error;
      outcome.settled = true;
    },
  );
  await refreshEntered.promise;
  provider.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  const outcomeBeforeRefresh = { ...outcome };
  releaseRefresh.resolve();

  assert.deepEqual(await pendingSymbols, []);
  assert.deepEqual(outcomeBeforeRefresh, { settled: true, value: [] });
  assert.deepEqual(await provider.provideWorkspaceSymbols("Disposed"), []);
  assert.deepEqual({
    entries: provider.workspaceSymbolEntries,
    listeners: listeners.size,
    readyCalls,
    records: provider.workspaceSymbolRecords.size,
  }, {
    entries: [],
    listeners: 0,
    readyCalls: 1,
    records: 0,
  });
});

test("GaugeDocumentSymbolProvider stops fallback document reads after disposal", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  const readEntered = deferred();
  const releaseRead = deferred();
  const firstUri = { fsPath: "/workspace/gauge/specs/first.cpt" };
  const secondUri = { fsPath: "/workspace/gauge/specs/second.cpt" };
  let findCalls = 0;
  let openCalls = 0;
  vscode.workspace = {
    async findFiles() {
      findCalls += 1;
      return findCalls === 1 ? [firstUri, secondUri] : [];
    },
    async openTextDocument(uri) {
      openCalls += 1;
      if (uri === firstUri) {
        readEntered.resolve();
        await releaseRead.promise;
        throw new Error("disposed fallback read failed");
      }
      return createDocument("# Second", uri.fsPath);
    },
  };
  const provider = new GaugeDocumentSymbolProvider({ vscode });

  const pendingSymbols = provider.provideWorkspaceSymbols("Second");
  await readEntered.promise;
  provider.dispose();
  releaseRead.resolve();

  assert.deepEqual(await pendingSymbols, []);
  assert.deepEqual(await provider.provideWorkspaceSymbols("Second"), []);
  assert.deepEqual({ findCalls, openCalls }, { findCalls: 1, openCalls: 1 });
});

test("GaugeDocumentSymbolProvider returns no workspace symbols for one-character queries", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const vscode = createFakeVscode();
  let searched = false;
  vscode.workspace = {
    async findFiles() {
      searched = true;
      return [];
    },
  };
  const provider = new GaugeDocumentSymbolProvider({ vscode });

  assert.deepEqual(await provider.provideWorkspaceSymbols("S"), []);
  assert.equal(searched, false);
});
