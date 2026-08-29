const assert = require("node:assert/strict");
const test = require("node:test");

const {
  headingMarkers,
  isGaugeHashHeading,
  isScenarioHashHeading,
  isSpecHashHeading,
  isStepLine,
} = require("../src/gaugeHeadings");

function document(text) {
  const lines = text.split("\n");
  return {
    lineCount: lines.length,
    lineAt(line) {
      return { text: lines[line] };
    },
    getText() {
      return text;
    },
  };
}

// Every rule below was checked against the real parser through a temporary Go
// module with `replace github.com/getgauge/gauge => references/gauge`, calling
// parser.SpecParser.Parse and printing the resulting headings and steps.

// references/gauge/parser/lex.go isScenarioHeading:
//   len(text) > 2 -> text[0]=='#' && text[1]=='#' && text[2] != '#'
// A "### Sub heading" is a comment, not a scenario. Probe: "# Spec / ## Scenario
// / ### Sub heading / * a step" gives one scenario named "Scenario".
test("a third-level heading is not a Gauge scenario", () => {
  assert.equal(isScenarioHashHeading("### Sub heading"), false);
  assert.equal(isGaugeHashHeading("### Sub heading"), false);
  assert.equal(isScenarioHashHeading("## Scenario"), true);
  assert.equal(isScenarioHashHeading("##"), true);
  assert.equal(isSpecHashHeading("# Spec"), true);
  assert.equal(isSpecHashHeading("## Scenario"), false);

  assert.deepEqual(
    headingMarkers(document([
      "# Spec",
      "",
      "## Scenario",
      "### Sub heading",
      "* a step",
    ].join("\n"))).map((marker) => [marker.kind, marker.line]),
    [["specification", 0], ["scenario", 2]],
  );
});

// references/gauge/parser/lex.go isStep:
//   len(text) > 1 -> text[0]=='*' && text[1] != '*'
// A "**bold text**" line is a comment, not a step. Probe: "## Scenario /
// **bold text** / * a step" gives one step, "a step".
test("a bold Markdown line is not a Gauge step", () => {
  assert.equal(isStepLine("**bold text**"), false);
  assert.equal(isStepLine("  **bold text**"), false);
  assert.equal(isStepLine("* a step"), true);
  assert.equal(isStepLine("  * a step"), true);
  assert.equal(isStepLine("*"), true);
});

// references/gauge/parser/lex.go compares the trimmed line, and
// parser/helper.go isUnderline accepts a run of one or more. Probe:
// "Spec / ====   " and "Spec / =" are both specification headings.
test("a legacy underline is recognised when trimmed and however short", () => {
  assert.deepEqual(
    headingMarkers(document([
      "Spec",
      "====   ",
      "",
      "Scenario",
      "-",
      "* a step",
    ].join("\n"))).map((marker) => [marker.kind, marker.line]),
    [["specification", 0], ["scenario", 3]],
  );
});

test("an underline of mixed characters is not a heading", () => {
  assert.deepEqual(
    headingMarkers(document([
      "Spec",
      "=-=-",
      "* a step",
    ].join("\n"))),
    [],
  );
});

// references/gauge/parser/lex.go promotes an underline to a heading only when the
// previous token was a comment: the isSpecUnderline branch is reached after the
// scenario-heading, spec-heading, tag, table-row and step branches, and it only
// rewrites the last token when isInState(commentScope). Verified against the real
// parser:
//   "* a step / ----"    -> one scenario with two steps, no new heading
//   "tags: smoke / ----" -> zero scenarios, "Spec should have at least one scenario"
//   "| a | b | / ----"   -> one scenario, no new heading
//   "Just a comment / ----" -> a scenario named "Just a comment"
test("an underline promotes only a comment line to a heading", () => {
  // Probed by putting each line between "# S" and "----": the shapes that stay
  // themselves leave "Spec should have at least one scenario" (or, for a table,
  // "Data table should have at least 1 data row"), while a promoted one gives
  // the scenario its step and reports nothing. An UNMATCHED doc-string fence is
  // just a comment, so it is promoted like any other.
  const cases = [
    ["* a step", []],
    ["tags: smoke", []],
    ["| a | b |", []],
    ["\"\"\"", [["scenario", 0]]],
    ["____", []],
    ["# Already a heading", [["specification", 0]]],
    ["Just a comment", [["scenario", 0]]],
  ];

  for (const [line, expected] of cases) {
    const markers = headingMarkers(document([line, "----", "* a step"].join("\n")))
      .map((marker) => [marker.kind, marker.line]);
    assert.deepEqual(markers, expected, `for ${JSON.stringify(line)}`);
  }
});
