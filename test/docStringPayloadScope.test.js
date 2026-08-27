const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

// A `"""` block on the line after a step is that step's multi-line argument, and
// its payload is data, not Gauge syntax (references/gauge/parser/stepParser.go
// processStep, references/gauge/parser/specparser.go CreateStepUsingLookup; see
// docs/tdd-evidence/2026-08-27-multiline-argument-step-parameter-count.md).
// A payload that happens to contain "## Login" must not become a scenario in the
// outline, a fold, or a scenario-coloured line.

const SPEC = [
  "# Checkout",
  "",
  "## Buy",
  "* Send payload",
  "\"\"\"",
  "## Login",
  "* not a step",
  "| not | a table |",
  "\"\"\"",
  "* a real step",
].join("\n");

function createDocument(text, fsPath = "/workspace/gauge/specs/checkout.spec") {
  const lines = text.split("\n");
  return {
    languageId: "gauge",
    uri: { fsPath },
    fileName: fsPath,
    lineCount: lines.length,
    lineAt(line) {
      return { text: lines[line] };
    },
    getText() {
      return text;
    },
  };
}

function providerOptions() {
  return {
    fileSystem: { existsSync: () => false, readFileSync() { throw new Error("none"); } },
    pathModule: path.posix,
    projectFactory: {
      isGaugeProject: () => true,
      getGaugeRootFromFilePath: () => "/workspace/gauge",
    },
  };
}

test("the outline ignores a doc string payload in a specification", () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const provider = new GaugeDocumentSymbolProvider({
    ...providerOptions(),
    vscode: {
      SymbolKind: { Namespace: 2, Method: 5, Field: 7 },
      Range: function Range(start, end) {
        this.start = start;
        this.end = end;
      },
      Position: function Position(line, character) {
        this.line = line;
        this.character = character;
      },
      SymbolInformation: function SymbolInformation(name, kind, containerName, location) {
        this.name = name;
        this.kind = kind;
        this.containerName = containerName;
        this.location = location;
      },
      Uri: { file: (value) => ({ fsPath: value }) },
    },
  });

  const names = provider.provideDocumentSymbols(createDocument(SPEC)).map((symbol) => symbol.name);

  assert.deepEqual(names, ["# Checkout", "## Buy"]);
});

test("folding ignores a doc string payload in a specification", () => {
  const { GaugeFoldingRangeProvider } = require("../src/foldingRangeProvider");
  const provider = new GaugeFoldingRangeProvider(providerOptions());

  const ranges = provider.provideFoldingRanges(createDocument(SPEC));

  // The specification heading gets no fold of its own when the scenario below it
  // ends at the same line; that shape is unchanged by this test.
  assert.deepEqual(ranges, [{ start: 2, end: 9 }]);
});

test("semantic tokens leave a doc string payload uncoloured", () => {
  const { GaugeSemanticTokensProvider, createLegend } = require("../src/semanticTokensProvider");
  const pushed = [];
  class SemanticTokensBuilder {
    push(line, start, length, tokenType) {
      pushed.push({ line, tokenType });
    }

    build() {
      return { data: pushed };
    }
  }
  const legend = createLegend({
    SemanticTokensLegend: function Legend(types) {
      this.types = types;
    },
  });
  const { tokenTypes } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    ...providerOptions(),
    legend,
    SemanticTokensBuilder,
  });

  provider.provideDocumentSemanticTokens(createDocument(SPEC));

  // Lines 5 to 7 are payload: no scenario, step or table token may land there.
  // They are painted with gaugeComment rather than left bare. Emitting nothing
  // leaves the TextMate grammar's colouring showing through, which is how a
  // "## Login" inside a doc string still rendered as a scenario heading.
  const payloadTokens = pushed
    .filter((entry) => entry.line >= 5 && entry.line <= 7)
    .map((entry) => tokenTypes[entry.tokenType]);
  assert.deepEqual(payloadTokens, ["gaugeComment", "gaugeComment", "gaugeComment"]);
});
