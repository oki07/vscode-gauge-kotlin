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
    "### Markdown note",
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
    "# Shared checkout",
    "* Reuse",
    "",
    "## Shared payment",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared.cpt", "plaintext");

  const symbols = provider.provideDocumentSymbols(document);

  assert.deepEqual(symbols.map((symbol) => symbol.name), [
    "# Shared checkout",
    "## Shared payment",
  ]);
  assert.deepEqual({ ...symbols[1].location.range.start }, { line: 3, character: 0 });
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

test("GaugeDocumentSymbolProvider lists matching workspace symbols", async () => {
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
  vscode.workspace = {
    async findFiles(pattern) {
      if (pattern === "**/*.spec") {
        return [specDocument.uri, otherSpecDocument.uri];
      }
      if (pattern === "**/*.md") {
        return [];
      }
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

  const symbols = await provider.provideWorkspaceSymbols("Spe");

  assert.deepEqual(symbols.map((symbol) => ({
    name: symbol.name,
    uri: symbol.location.uri,
    range: {
      start: { ...symbol.location.range.start },
      end: { ...symbol.location.range.end },
    },
  })), [
    {
      name: "# Specification Heading",
      uri: specDocument.uri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 23 },
      },
    },
  ]);
});

test("GaugeDocumentSymbolProvider lists concept workspace symbols", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const conceptDocument = createDocument([
    "# Shared checkout",
    "* Reuse checkout",
    "",
    "## Shared payment",
    "* Reuse payment",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared.cpt", "gauge");
  const documents = new Map([
    [conceptDocument.uri.fsPath, conceptDocument],
  ]);
  const vscode = createFakeVscode();
  const searchedPatterns = [];
  vscode.workspace = {
    async findFiles(pattern) {
      searchedPatterns.push(pattern);
      if (pattern === "**/*.spec" || pattern === "**/*.md") {
        return [];
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

  assert.deepEqual(searchedPatterns, ["**/*.spec", "**/*.md", "**/*.cpt"]);
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
      name: "## Shared payment",
      uri: conceptDocument.uri,
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 17 },
      },
    },
  ]);
});

test("GaugeDocumentSymbolProvider groups and sorts workspace spec and scenario symbols", async () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const leftDocument = createDocument([
    "Sample 2",
    "========",
    "",
    "Scenario Sample 5",
    "-----------------",
    "* Pay",
    "",
    "Sample Scenario 6",
    "-----------------",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/b.spec", "gauge");
  const rightDocument = createDocument([
    "Sample 1",
    "========",
    "",
    "Sample Scenario 1",
    "-----------------",
    "* Pay",
    "",
    "Scenario Sample 2",
    "-----------------",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/a.spec", "gauge");
  const documents = new Map([
    [leftDocument.uri.fsPath, leftDocument],
    [rightDocument.uri.fsPath, rightDocument],
  ]);
  const vscode = createFakeVscode();
  vscode.workspace = {
    async findFiles(pattern) {
      if (pattern === "**/*.spec") {
        return [leftDocument.uri, rightDocument.uri];
      }
      if (pattern === "**/*.md") {
        return [];
      }
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

  const symbols = await provider.provideWorkspaceSymbols("Sample");

  assert.deepEqual(symbols.map((symbol) => symbol.name), [
    "# Sample 1",
    "# Sample 2",
    "## Sample Scenario 1",
    "## Sample Scenario 6",
    "## Scenario Sample 2",
    "## Scenario Sample 5",
  ]);
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
