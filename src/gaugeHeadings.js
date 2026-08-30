"use strict";

// references/gauge/parser/lex.go isDataTable matches
// /^\s*[tT][aA][bB][lL][eE]\s*:/, so any run of whitespace may sit between the
// keyword and the colon. Verified against the real parser.
const DATA_TABLE_KEYWORD_PATTERN = /^\s*table\s*:/i;

function trimmedHashText(line) {
  return String(line || "").trimStart();
}

function isSpecHashHeading(line) {
  const text = trimmedHashText(line);
  return text.startsWith("#") && !text.startsWith("##");
}

// references/gauge/parser/lex.go isScenarioHeading requires the third character
// not to be another '#', so "### Sub heading" is a comment, not a scenario.
function isScenarioHashHeading(line) {
  const text = trimmedHashText(line);
  return text.startsWith("##") && !text.startsWith("###");
}

function isGaugeHashHeading(line) {
  return isSpecHashHeading(line) || isScenarioHashHeading(line);
}

// A concept heading is a single "#": "##" is a scenario heading, which Gauge
// rejects in a concept file, and "###" is neither - verified against
// parser.CreateConceptsDictionary, where "### x" defines nothing and reports
// nothing. Treating any run of hashes as a concept put a phantom node in the
// outline and split the real concept in two.
function isConceptHashHeading(line) {
  const text = trimmedHashText(line);
  return text.startsWith("#") && !text.startsWith("##");
}

function documentLine(document, line) {
  if (typeof document.lineAt === "function") {
    return document.lineAt(line).text;
  }
  return String(document.getText()).split(/\r?\n/)[line] || "";
}

function documentLineCount(document) {
  if (typeof document.lineCount === "number") {
    return document.lineCount;
  }
  if (typeof document.getText === "function") {
    return String(document.getText()).split(/\r?\n/).length;
  }
  return 0;
}

function firstNonWhitespace(line) {
  const index = String(line || "").search(/\S/);
  return index === -1 ? 0 : index;
}

// references/gauge/parser/lex.go isStep requires the second character not to be
// another '*', so "**bold text**" is a comment, not a step.
function isStepLine(line) {
  const text = String(line || "");
  const marker = text.search(/\S/);
  return marker !== -1 && text[marker] === "*" && text[marker + 1] !== "*";
}

function isDocStringFenceLine(line) {
  return String(line || "").trim() === "\"\"\"";
}

function closedDocStringLines(lines) {
  const result = new Set();
  for (let stepLine = 0; stepLine < lines.length; stepLine += 1) {
    if (!isStepLine(lines[stepLine])) {
      continue;
    }
    const openLine = stepLine + 1;
    if (!isDocStringFenceLine(lines[openLine])) {
      continue;
    }
    let closeLine;
    for (let candidateLine = openLine + 1; candidateLine < lines.length; candidateLine += 1) {
      if (isDocStringFenceLine(lines[candidateLine])) {
        closeLine = candidateLine;
        break;
      }
    }
    if (closeLine === undefined) {
      continue;
    }
    for (let line = openLine; line <= closeLine; line += 1) {
      result.add(line);
    }
    stepLine = closeLine;
  }
  return result;
}

// references/gauge/parser/lex.go isTableRow:
//   text[0] == '|' && text[len(text)-1] == '|'
// A lone "|" satisfies it, because both indices are the same character.
//
// This is the one place the rule lives. Every module that decides what a step's
// value is must import it: when two of them answer differently the editor
// contradicts itself, and test/stepKeyAgreement.test.js is what catches that.
// The two keywords do NOT take the same whitespace. Probed by putting each line
// above a "=====" underline and watching for a promoted heading:
//   "tags: x" / "tags : x"   -> a tags line
//   "tags\t: x" / "tags\f: x" -> NOT a tags line, promoted as a comment
//   "table: x" / "table  : x" -> both data tables (isDataTable allows \s*)
// references/gauge/parser/lex.go: the tags branch tests the two literal
// prefixes, while isDataTable matches /^\s*[tT][aA][bB][lL][eE]\s*:/.
const TAGS_KEYWORD_PATTERN = /^\s*tags ?:/i;

function isGaugeTagKeywordLine(line) {
  return TAGS_KEYWORD_PATTERN.test(String(line || "").trimStart());
}

function isGaugeDataTableKeywordLine(line) {
  return DATA_TABLE_KEYWORD_PATTERN.test(String(line || ""));
}

function isGaugeTableRowLine(line) {
  const text = String(line || "").trim();
  return text.startsWith("|") && text.endsWith("|");
}

// A step may carry a doc string AND an inline table, in that order, and the two
// are read as separate arguments. The doc string must open on the line
// IMMEDIATELY after the step's last line; the table scan then resumes after its
// closing fence, skipping blank lines on either side. Probed with the real
// parser and cross-checked with `gauge validate`:
//   step + fence + table                -> table   ("Load {}")
//   step + fence + BLANK + table        -> table
//   step + BLANK + fence + table        -> no table, and no doc string either
//   step + fence + comment + table      -> no table
//   step + fence + fence + table        -> no table (only the first attaches)
//   step + unclosed fence + table       -> no table
// Returns the line the step's inline table starts on, or undefined.
function inlineTableLineAfterStep(lines, endLine, isTableRow) {
  const rowTest = isTableRow || isGaugeTableRowLine;
  let index = endLine + 1;
  if (isDocStringFenceLine(lines[index])) {
    let close;
    for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
      if (isDocStringFenceLine(lines[candidate])) {
        close = candidate;
        break;
      }
    }
    if (close === undefined) {
      return undefined;
    }
    index = close + 1;
  }
  for (; index < lines.length; index += 1) {
    const text = String(lines[index] || "").trim();
    if (text === "") {
      continue;
    }
    return rowTest(text) ? index : undefined;
  }
  return undefined;
}

// references/gauge/parser/helper.go isUnderline accepts a run of ONE or more, so
// "_" and "__" are teardown markers too - they simply also earn "Teardown should
// have at least three underscore characters". Probed: both end the scenario, so
// a scenario whose only step sits below one is empty. Requiring three let the
// step stay in the scenario and the error vanish.
function isGaugeTeardownLine(line) {
  return /^_+$/.test(String(line || "").trim());
}

// A separator row is one whose cells are all runs of dashes, EMPTY CELLS ASIDE.
// Probed with a header and nothing else, watching for "Data table should have at
// least 1 data row":
//   | |---|    -> separator        |---|---| -> separator
//   |-|-|      -> separator        |:-:|---| -> NOT a separator, a data row
// So an empty cell does not disqualify the row and a Markdown alignment cell
// does not qualify it.
function isGaugeTableSeparatorRow(line) {
  const text = String(line || "").trim();
  if (!isGaugeTableRowLine(text)) {
    return false;
  }
  const cells = text.slice(1, -1).split("|").map((cell) => cell.trim()).filter(Boolean);
  return cells.length > 0 && cells.every((cell) => /^-+$/.test(cell));
}

function headingKind(line) {
  if (isScenarioHashHeading(line)) {
    return "scenario";
  }
  return isSpecHashHeading(line) ? "specification" : undefined;
}

// references/gauge/parser/lex.go reaches its isSpecUnderline branch only after the
// scenario-heading, spec-heading, tag, table-row and step branches, and there it
// rewrites the previous token only when isInState(commentScope). So an underline
// promotes a comment line and nothing else: a step, a tags line, a table row, a
// doc string fence, a teardown marker and an existing hash heading all keep their
// own kind. Verified against the real parser.
function isLegacyHeadingText(line) {
  const text = String(line || "").trim();
  if (!text) {
    return false;
  }
  // "###" is a comment, so an underline DOES promote it; only "#" and "##" are
  // already heading tokens. And a pipe line is only a table row when it closes,
  // so "| id | name" is a comment an underline promotes.
  if (isGaugeHashHeading(text) || isGaugeTableRowLine(text)) {
    return false;
  }
  // Only the teardown marker is excluded among the run-of-symbols shapes. Probed
  // by putting each line above a "=====" underline in a spec that already has a
  // heading and watching for "Multiple spec headings found in same file":
  //   ___  -> not heading text        (teardown)
  //   ---  -> heading text
  //   ===  -> heading text
  //   """  -> heading text            (an unmatched fence is just a comment)
  if (isStepLine(text) || isGaugeTeardownLine(text)) {
    return false;
  }
  return !isGaugeTagKeywordLine(text) && !isGaugeDataTableKeywordLine(text);
}

function legacyHeadingKind(line, nextLine) {
  if (!isLegacyHeadingText(line)) {
    return undefined;
  }
  // Gauge compares the trimmed line (references/gauge/parser/lex.go) and
  // parser/helper.go isUnderline accepts a run of one or more, so a trailing
  // space must not hide the heading and a single character is enough.
  const underline = String(nextLine || "").trim();
  if (/^=+$/.test(underline)) {
    return "specification";
  }
  if (/^-+$/.test(underline)) {
    return "scenario";
  }
  return undefined;
}

function headingMarkers(document) {
  const markers = [];
  const lineCount = documentLineCount(document);
  const lines = Array.from({ length: lineCount }, (_value, line) => documentLine(document, line));
  const docStringLines = closedDocStringLines(lines);
  for (let line = 0; line < lineCount; line += 1) {
    if (docStringLines.has(line)) {
      continue;
    }
    const text = lines[line];
    const hashKind = headingKind(text);
    if (hashKind) {
      markers.push({ kind: hashKind, line, start: firstNonWhitespace(text), end: text.length });
      continue;
    }

    const legacyKind = legacyHeadingKind(text, lines[line + 1]);
    if (legacyKind) {
      markers.push({ kind: legacyKind, line, start: firstNonWhitespace(text), end: text.length });
      line += 1;
    }
  }
  return markers;
}

module.exports = {
  closedDocStringLines,
  isGaugeTableSeparatorRow,
  isGaugeTeardownLine,
  inlineTableLineAfterStep,
  isGaugeDataTableKeywordLine,
  isGaugeTagKeywordLine,
  isGaugeTableRowLine,
  isLegacyHeadingText,
  headingMarkers,
  isConceptHashHeading,
  isDocStringFenceLine,
  isGaugeHashHeading,
  isScenarioHashHeading,
  isSpecHashHeading,
  isStepLine,
};
