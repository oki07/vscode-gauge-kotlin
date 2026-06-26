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

test("GaugeSemanticTokensProvider distinguishes specification scenario and concept headings", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const specDocument = {
    uri: { fsPath: "/workspace/specs/example.spec" },
    getText() {
      return [
        "# Specification <name>",
        "## Scenario <name>",
      ].join("\n");
    },
  };
  const conceptDocument = {
    uri: { fsPath: "/workspace/specs/concepts/shared.cpt" },
    getText() {
      return "# Shared checkout <item> now";
    },
  };

  const specTokens = provider.provideDocumentSemanticTokens(specDocument)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  assert.deepEqual(specTokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "specification",
  ]);
  assert.deepEqual(specTokens.filter((entry) => entry.line === 1).map((entry) => entry.type), [
    "scenario",
  ]);

  const conceptTokens = provider.provideDocumentSemanticTokens(conceptDocument)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  assert.deepEqual(conceptTokens.map((entry) => entry.type), [
    "specification",
    "argument",
    "specification",
  ]);
});

test("GaugeSemanticTokensProvider keeps quoted concept heading text as heading", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    uri: { fsPath: "/workspace/specs/concepts/shared.cpt" },
    getText() {
      return '# Shared "cart" only';
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.map((entry) => entry.type), [
    "specification",
  ]);
});

test("GaugeSemanticTokensProvider tokenizes dynamic table cell arguments", () => {
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
        "| name | role |",
        "| ---- | ---- |",
        "| <user> | admin |",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const argumentTokens = tokens.filter((entry) => entry.line === 2 && entry.type === "argument");

  assert.deepEqual(argumentTokens, [
    {
      line: 2,
      start: 2,
      length: 6,
      tokenType: tokenTypes.indexOf("argument"),
      tokenModifiers: 0,
      type: "argument",
    },
  ]);
});

test("GaugeSemanticTokensProvider tokenizes table headers as tableHeader tokens", () => {
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
        "| <user> | role |",
        "| ------ | ---- |",
        "| Bob    | admin |",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  const headerTokens = tokens
    .filter((entry) => entry.line === 0 && entry.type === "tableHeader")
    .map(({ start, length }) => ({ start, length }));

  assert.deepEqual(tokens.filter((entry) => entry.line === 0 && entry.type === "argument"), []);
  assert.deepEqual(tokens.filter((entry) => entry.line === 0 && entry.type === "table"), []);
  assert.deepEqual(
    tokens.filter((entry) => entry.line === 0 && entry.type === "tableBorder").map((entry) => entry.start),
    [0, 9, 16],
  );
  assert.deepEqual(headerTokens, [
    { start: 1, length: 8 },
    { start: 10, length: 6 },
  ]);
});

test("GaugeSemanticTokensProvider keeps escaped table pipes in cell tokens", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const row = "| Ada \\| Bob | admin |";
  const document = {
    getText() {
      return row;
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const escapedPipeStart = row.indexOf("\\|");
  const middleBorderStart = row.indexOf("|", escapedPipeStart + 2);
  const borderStarts = tokens
    .filter((entry) => entry.type === "tableBorder")
    .map((entry) => entry.start);

  assert.deepEqual(borderStarts, [0, middleBorderStart, row.length - 1]);
  assert.equal(tokens.some((entry) => (
    entry.type === "table"
    && entry.start <= escapedPipeStart
    && entry.start + entry.length >= escapedPipeStart + 2
  )), true);
});

test("GaugeSemanticTokensProvider tokenizes single-column table separators", () => {
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
        "| user |",
        "| ---- |",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const separatorTokens = tokens.filter((entry) => entry.line === 1);

  assert.equal(separatorTokens.some((entry) => entry.type === "tableHeaderSeparator"), true);
  assert.deepEqual(
    separatorTokens.filter((entry) => entry.type === "tableBorder").map((entry) => entry.start),
    [0, 7],
  );
});

test("GaugeSemanticTokensProvider does not span dynamic table arguments across pipes", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const row = "| <user | admin> |";
  const document = {
    getText() {
      return row;
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const argumentTokens = tokens.filter((entry) => entry.type === "argument");
  const dynamicBoundary = row.indexOf("|", row.indexOf("<"));
  const borderStarts = tokens
    .filter((entry) => entry.type === "tableBorder")
    .map((entry) => entry.start);

  assert.deepEqual(argumentTokens, []);
  assert.equal(borderStarts.includes(dynamicBoundary), true);
});

test("GaugeSemanticTokensProvider tokenizes escaped dynamic step arguments", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const step = "* Say <name \\> suffix>";
  const document = {
    getText() {
      return step;
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const argumentTokens = tokens.filter((entry) => entry.type === "argument");

  assert.deepEqual(argumentTokens, [
    {
      line: 0,
      start: step.indexOf("<"),
      length: step.length - step.indexOf("<"),
      tokenType: tokenTypes.indexOf("argument"),
      tokenModifiers: 0,
      type: "argument",
    },
  ]);
});

test("GaugeSemanticTokensProvider tokenizes escaped static step arguments", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const step = "* Say \"Ada \\\"The First\\\"\" now";
  const document = {
    getText() {
      return step;
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const argumentTokens = tokens.filter((entry) => entry.type === "argument");
  const start = step.indexOf("\"");
  const end = step.lastIndexOf("\"") + 1;

  assert.deepEqual(argumentTokens, [
    {
      line: 0,
      start,
      length: end - start,
      tokenType: tokenTypes.indexOf("argument"),
      tokenModifiers: 0,
      type: "argument",
    },
  ]);
});
