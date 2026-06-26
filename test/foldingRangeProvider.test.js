const assert = require("node:assert/strict");
const test = require("node:test");

function createDocument(text, fsPath = "/workspace/specs/example.spec") {
  const lines = text.split("\n");
  return {
    uri: { fsPath },
    lineAt(line) {
      return { text: lines[line] };
    },
    get lineCount() {
      return lines.length;
    },
  };
}

test("GaugeFoldingRangeProvider folds specifications scenarios and teardown blocks", () => {
  const { GaugeFoldingRangeProvider } = require("../src/foldingRangeProvider");
  const provider = new GaugeFoldingRangeProvider();
  const document = createDocument([
    "# Checkout",
    "tags: web",
    "* Open cart",
    "",
    "## Successful checkout",
    "* Pay",
    "|item|price|",
    "|----|-----|",
    "|book|10|",
    "",
    "## Cancel checkout",
    "* Cancel",
    "",
    "___",
    "* After spec",
    "",
  ].join("\n"));

  assert.deepEqual(provider.provideFoldingRanges(document), [
    { start: 0, end: 2 },
    { start: 4, end: 8 },
    { start: 10, end: 11 },
    { start: 13, end: 14 },
  ]);
});

test("GaugeFoldingRangeProvider folds legacy underline headings and concepts", () => {
  const { GaugeFoldingRangeProvider } = require("../src/foldingRangeProvider");
  const provider = new GaugeFoldingRangeProvider();
  const document = createDocument([
    "Checkout",
    "========",
    "* Open cart",
    "",
    "Successful checkout",
    "-------------------",
    "* Pay",
    "",
    "# Shared checkout <item>",
    "* Reuse <item>",
    "",
  ].join("\n"));

  assert.deepEqual(provider.provideFoldingRanges(document), [
    { start: 1, end: 2 },
    { start: 5, end: 6 },
    { start: 8, end: 9 },
  ]);
});

test("GaugeFoldingRangeProvider folds hash headings accepted by the Gauge lexer", () => {
  const { GaugeFoldingRangeProvider } = require("../src/foldingRangeProvider");
  const provider = new GaugeFoldingRangeProvider();
  const document = createDocument([
    "#",
    "* Open cart",
    "",
    "##",
    "* Pay",
    "",
    "### Nested scenario syntax",
    "* Reuse",
    "",
  ].join("\n"));

  assert.deepEqual(provider.provideFoldingRanges(document), [
    { start: 0, end: 1 },
    { start: 3, end: 4 },
    { start: 6, end: 7 },
  ]);
});

test("GaugeFoldingRangeProvider ignores concept hyphen underline headings", () => {
  const { GaugeFoldingRangeProvider } = require("../src/foldingRangeProvider");
  const provider = new GaugeFoldingRangeProvider();
  const document = createDocument([
    "Not a concept heading",
    "---------------------",
    "* Reuse",
    "",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  assert.deepEqual(provider.provideFoldingRanges(document), []);
});

test("GaugeFoldingRangeProvider ignores indented concept hash headings", () => {
  const { GaugeFoldingRangeProvider } = require("../src/foldingRangeProvider");
  const provider = new GaugeFoldingRangeProvider();
  const document = createDocument([
    "  # Shared checkout",
    "* Reuse",
    "",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  assert.deepEqual(provider.provideFoldingRanges(document), []);
});

test("GaugeFoldingRangeProvider ignores concept equals underlines after identifiers", () => {
  const { GaugeFoldingRangeProvider } = require("../src/foldingRangeProvider");
  const provider = new GaugeFoldingRangeProvider();
  const document = createDocument([
    "# Shared checkout",
    "* Reuse",
    "=======",
    "| name |",
    "=======",
    "* Still part of concept",
    "",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  assert.deepEqual(provider.provideFoldingRanges(document), [
    { start: 0, end: 5 },
  ]);
});

test("GaugeFoldingRangeProvider does not split concept folds on teardown markers", () => {
  const { GaugeFoldingRangeProvider } = require("../src/foldingRangeProvider");
  const provider = new GaugeFoldingRangeProvider();
  const document = createDocument([
    "# Shared checkout",
    "* Reuse cart",
    "",
    "___",
    "* Still concept text",
    "",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  assert.deepEqual(provider.provideFoldingRanges(document), [
    { start: 0, end: 4 },
  ]);
});

test("GaugeFoldingRangeProvider ignores indented teardown markers", () => {
  const { GaugeFoldingRangeProvider } = require("../src/foldingRangeProvider");
  const provider = new GaugeFoldingRangeProvider();
  const document = createDocument([
    "# Checkout",
    "* Open cart",
    "  ___",
    "* Still scenario text",
    "",
    "## Pay",
    "* Pay",
    "",
  ].join("\n"));

  assert.deepEqual(provider.provideFoldingRanges(document), [
    { start: 0, end: 3 },
    { start: 5, end: 6 },
  ]);
});
