"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const textmate = require("vscode-textmate");
const oniguruma = require("vscode-oniguruma");
const cases = require("./fixtures/textmate-fence-context.json");
const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"));
const ready = oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));

// Actual execution of getgauge/gauge-vscode syntaxes/markdown.tmLanguage
// distinguishes paragraph, list and indented-code continuation. The fixture
// records reference opening decisions, including blank-line and heading resets.
for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} preserves fence continuation contexts`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    const registry = new textmate.Registry({ onigLib: Promise.resolve(oniguruma),
      loadGrammar: async scope => scope === raw.scopeName ? raw : null });
    try {
      const grammar = await registry.loadGrammar(raw.scopeName);
      const mismatches = [];
      for (const fixture of cases) {
        let state = textmate.INITIAL;
        for (const line of [...fixture.prefix, fixture.indent + fixture.fence]) {
          state = grammar.tokenizeLine(line, state).ruleStack;
        }
        const result = grammar.tokenizeLine("payload", state);
        const opened = result.tokens.some(token => token.scopes.includes("markup.fenced_code.block.markdown.gauge"));
        if (opened !== fixture.opened) mismatches.push({ ...fixture, actual: opened });
      }
      assert.deepEqual(mismatches, []);
    } finally { registry.dispose(); }
  });
}

for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} preserves Gauge decoration on continuation lines`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    const registry = new textmate.Registry({ onigLib: Promise.resolve(oniguruma),
      loadGrammar: async scope => scope === raw.scopeName ? raw : null });
    try {
      const grammar = await registry.loadGrammar(raw.scopeName);
      for (const prefix of ["* Prior step", "- List item", "plain text", "    raw text"]) {
        for (const [line, scopes] of [
          ['    * Step "value" <arg>', ["keyword.operator.step.gauge", "string.quoted.double.argument.gauge", "variable.parameter.dynamic.gauge"]],
          ["    // Comment", ["comment.line.double-slash.gauge"]],
          ["    explanation", ["comment.line.gauge"]],
          ...["- ", "+ ", "1. "].map(marker => ["    " + marker + "List item", ["markup.list.markdown.gauge", "punctuation.definition.list.begin.markdown.gauge"]]),
          // The reference grammar keeps indented underscores in paragraph/raw
          // context, including a tab consumed by a surrounding list.
          ...(filename === "gauge-concept.tmLanguage.json" ? ["    ___", ...(prefix === "plain text" ? [] : ["\t___"])].map(line => [line, ["comment.line.gauge"]]) : []),
        ]) {
          const state = grammar.tokenizeLine(prefix, textmate.INITIAL).ruleStack;
          const tokens = grammar.tokenizeLine(line, state).tokens;
          for (const scope of scopes) assert.ok(tokens.some(token => token.scopes.includes(scope)), `${prefix}: ${line}: ${scope}`);
        }
      }
    } finally { registry.dispose(); }
  });
}

// Gauge underline headings require the physical start of a line. Actual
// TextMate execution of getgauge/gauge-vscode syntaxes/markdown.tmLanguage
// keeps these indented list continuations in a paragraph.
test("Gauge underline headings retain physical column boundaries", async () => {
  await ready;
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes/gauge.tmLanguage.json"), "utf8"));
  const registry = new textmate.Registry({ onigLib: Promise.resolve(oniguruma),
    loadGrammar: async scope => scope === raw.scopeName ? raw : null });
  try {
    const grammar = await registry.loadGrammar(raw.scopeName);
    for (const prefix of ["* Prior step", "- List item"]) for (const indent of ["    ", "\t"]) {
      for (const marker of ["===", "=", "---", "-"]) {
        const state = grammar.tokenizeLine(prefix, textmate.INITIAL).ruleStack;
        const tokens = grammar.tokenizeLine(indent + marker, state).tokens;
        assert.ok(tokens.every(token => !token.scopes.some(scope => scope.startsWith("punctuation.definition.heading."))), prefix + indent + marker);
      }
    }
  } finally { registry.dispose(); }
});
