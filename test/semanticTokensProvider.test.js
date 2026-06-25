const assert = require("node:assert/strict");
const test = require("node:test");

class CapturingSemanticTokensBuilder {
  constructor() {
    this.tokens = [];
  }

  push(line, start, length, tokenType, tokenModifiers) {
    this.tokens.push({ line, start, length, tokenType, tokenModifiers });
  }

  build() {
    return this.tokens;
  }
}

test("GaugeSemanticTokensProvider tokenizes Gauge document elements", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    getText() {
      return [
        "* Say \"hello\" to <name>",
        "table: users.csv",
        "| name |",
        "| ---- | ---- |",
        "tags: smoke, fast",
        "// * disabled step",
        "plain comment",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document);
  const namedTokens = tokens.map((entry) => ({
    ...entry,
    type: tokenTypes[entry.tokenType],
  }));

  assert.deepEqual(namedTokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "stepMarker",
    "step",
    "argument",
    "step",
    "argument",
  ]);
  assert.deepEqual(namedTokens.filter((entry) => entry.line === 1).map((entry) => entry.type), [
    "tableKeyword",
    "tableFileValue",
  ]);
  assert.equal(namedTokens.some((entry) => entry.line === 2 && entry.type === "tableBorder"), true);
  assert.equal(namedTokens.some((entry) => entry.line === 3 && entry.type === "tableHeaderSeparator"), true);
  assert.deepEqual(namedTokens.filter((entry) => entry.line === 4).map((entry) => entry.type), [
    "tagKeyword",
    "tagValue",
  ]);
  assert.deepEqual(namedTokens.filter((entry) => entry.line === 5).map((entry) => entry.type), [
    "disabledStep",
  ]);
  assert.deepEqual(namedTokens.filter((entry) => entry.line === 6).map((entry) => entry.type), [
    "gaugeComment",
  ]);
});
