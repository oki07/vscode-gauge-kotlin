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
