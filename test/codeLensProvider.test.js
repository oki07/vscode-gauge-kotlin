const assert = require("node:assert/strict");
const test = require("node:test");

function createDocument(text, fsPath = "/workspace/specs/example.spec") {
  const lines = text.split("\n");
  return {
    languageId: "gauge",
    uri: { fsPath },
    fileName: fsPath,
    lineAt(line) {
      return { text: lines[line] };
    },
    get lineCount() {
      return lines.length;
    },
  };
}

test("GaugeCodeLensProvider adds run and debug lenses for specification and scenario headings", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "# Checkout",
    "* Open cart",
    "",
    "## Successful checkout",
    "* Pay",
    "",
  ].join("\n"));

  const lenses = provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    title: lens.command.title,
    command: lens.command.command,
    argument: lens.command.arguments[0],
  })), [
    {
      line: 0,
      title: "Run Specification",
      command: "gauge.execute",
      argument: "/workspace/specs/example.spec",
    },
    {
      line: 0,
      title: "Debug Specification",
      command: "gauge.debug",
      argument: "/workspace/specs/example.spec",
    },
    {
      line: 3,
      title: "Run Scenario",
      command: "gauge.execute",
      argument: "/workspace/specs/example.spec:4",
    },
    {
      line: 3,
      title: "Debug Scenario",
      command: "gauge.debug",
      argument: "/workspace/specs/example.spec:4",
    },
  ]);
});

test("GaugeCodeLensProvider adds lenses for legacy underline headings", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "Checkout",
    "========",
    "* Open cart",
    "",
    "Successful checkout",
    "-------------------",
    "* Pay",
    "",
  ].join("\n"));

  const lenses = provider.provideCodeLenses(document);

  assert.deepEqual(lenses.map((lens) => ({
    line: lens.range.start.line,
    title: lens.command.title,
    argument: lens.command.arguments[0],
  })), [
    {
      line: 0,
      title: "Run Specification",
      argument: "/workspace/specs/example.spec",
    },
    {
      line: 0,
      title: "Debug Specification",
      argument: "/workspace/specs/example.spec",
    },
    {
      line: 4,
      title: "Run Scenario",
      argument: "/workspace/specs/example.spec:5",
    },
    {
      line: 4,
      title: "Debug Scenario",
      argument: "/workspace/specs/example.spec:5",
    },
  ]);
});

test("GaugeCodeLensProvider ignores concept documents", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider();
  const document = createDocument([
    "# Shared checkout",
    "* Reuse checkout",
    "",
  ].join("\n"), "/workspace/specs/concepts/shared.cpt");

  assert.deepEqual(provider.provideCodeLenses(document), []);
});
