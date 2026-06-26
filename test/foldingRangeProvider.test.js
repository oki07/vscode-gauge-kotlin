const assert = require("node:assert/strict");
const test = require("node:test");

function createDocument(text) {
  const lines = text.split("\n");
  return {
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
