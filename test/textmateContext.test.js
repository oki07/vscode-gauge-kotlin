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

function loadGrammar(raw, scope) {
  if (scope === raw.scopeName) return raw;
  const files = {
    "text.gauge": "gauge.tmLanguage.json",
    "text.gauge.quoted.markdown": "gauge-quoted-markdown.tmLanguage.json",
  };
  return files[scope] ? JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", files[scope]), "utf8")) : null;
}

// Actual execution of getgauge/gauge-vscode syntaxes/markdown.tmLanguage
// distinguishes paragraph, list and indented-code continuation. The fixture
// records reference opening decisions, including blank-line and heading resets.
for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} preserves fence continuation contexts`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    const registry = new textmate.Registry({ onigLib: Promise.resolve(oniguruma),
      loadGrammar: async scope => loadGrammar(raw, scope) });
    try {
      const grammar = await registry.loadGrammar(raw.scopeName);
      const mismatches = [];
      for (const fixture of cases) {
        let state = textmate.INITIAL;
        for (const line of [...fixture.prefix, fixture.indent + fixture.fence]) {
          state = grammar.tokenizeLine(line, state).ruleStack;
        }
        const result = grammar.tokenizeLine("payload", state);
        const opened = result.tokens.some(token => token.scopes.some(scope => scope.startsWith("markup.fenced_code.block.markdown")));
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
      loadGrammar: async scope => loadGrammar(raw, scope) });
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
    loadGrammar: async scope => loadGrammar(raw, scope) });
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

// Actual TextMate execution of getgauge/gauge-vscode
// syntaxes/markdown.tmLanguage maintains nested quote containers and releases
// their fenced state when a continuation no longer carries the quote marker.
for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} preserves quoted fence containers`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    const registry = new textmate.Registry({ onigLib: Promise.resolve(oniguruma),
      loadGrammar: async scope => loadGrammar(raw, scope) });
    try {
      const grammar = await registry.loadGrammar(raw.scopeName);
      const fixtures = require("./fixtures/textmate-quote-context.json");
      const mismatches = [];
      for (const fixture of fixtures) {
        let state = textmate.INITIAL;
        const actual = fixture.lines.map(line => {
          const result = grammar.tokenizeLine(line, state);
          state = result.ruleStack;
          return {
            fenced: result.tokens.some(token => token.scopes.some(scope => scope.startsWith("markup.fenced_code.block.markdown"))),
            quoteDepth: Math.max(...result.tokens.map(token => token.scopes.filter(scope => scope.startsWith("markup.quote.markdown")).length)),
          };
        });
        if (JSON.stringify(actual) !== JSON.stringify(fixture.states)) mismatches.push({ ...fixture, actual });
      }
      assert.deepEqual(mismatches, []);
    } finally { registry.dispose(); }
  });
}

for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} keeps quoted prose separate from Gauge lines`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    const registry = new textmate.Registry({ onigLib: Promise.resolve(oniguruma),
      loadGrammar: async scope => loadGrammar(raw, scope) });
    try {
      const grammar = await registry.loadGrammar(raw.scopeName);
      // The reference Markdown grammar classifies these as quoted lists,
      // paragraphs and Markdown headings, without Gauge language decoration.
      for (const quote of ["> ", "> > "]) for (const body of ['* Step "str" <arg>', "Tags: sample", "# Heading", "// Comment", "table: data.csv"]) {
        const result = grammar.tokenizeLine(quote + body, textmate.INITIAL);
        const gaugeScopes = result.tokens.flatMap(token => token.scopes).filter(scope =>
          /^(?:meta\.step|meta\.tags|meta\.table-file|keyword\.operator\.step|keyword\.control\.tags|string\.quoted\.double\.argument|variable\.parameter\.dynamic|markup\.heading\.(?:spec|scenario|concept)|comment\.line\.double-slash)\.gauge$/.test(scope));
        assert.deepEqual(gaugeScopes, [], quote + body);
        const after = grammar.tokenizeLine("* After <value>", result.ruleStack);
        assert.ok(after.tokens.some(token => token.scopes.includes("keyword.operator.step.gauge")));
        assert.ok(after.tokens.some(token => token.scopes.includes("variable.parameter.dynamic.gauge")));
      }
    } finally { registry.dispose(); }
  });
}

for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} embeds available Kotlin grammars inside quotes`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    for (const available of [false, true]) {
      const registry = new textmate.Registry({ onigLib: Promise.resolve(oniguruma),
        loadGrammar: async scope => scope === "source.kotlin" ? (available ? {
          scopeName: scope, patterns: [{ match: "val", name: "storage.type.kotlin" }],
        } : null) : loadGrammar(raw, scope) });
      try {
        const grammar = await registry.loadGrammar(raw.scopeName);
        for (const alias of ["kotlin", "kt", "kts"]) for (const marker of ["```", "~~~"]) {
          let state = grammar.tokenizeLine("> " + marker + alias, textmate.INITIAL).ruleStack;
          const body = grammar.tokenizeLine("> val answer = 1", state);
          // Actual TextMate execution keeps a plain fenced scope when the
          // optional Kotlin grammar is absent, including outside quotes.
          assert.ok(body.tokens.some(token => token.scopes.some(scope => scope.startsWith("markup.fenced_code.block.markdown"))));
          assert.equal(body.tokens.some(token => token.scopes.includes("meta.embedded.block.kotlin")), available);
          assert.equal(body.tokens.some(token => token.scopes.includes("storage.type.kotlin")), available);
          state = grammar.tokenizeLine("> " + marker, body.ruleStack).ruleStack;
          assert.ok(grammar.tokenizeLine("* After <value>", state).tokens.some(token => token.scopes.includes("keyword.operator.step.gauge")));
        }
      } finally { registry.dispose(); }
    }
  });
}

// Actual TextMate execution of getgauge/gauge-vscode
// syntaxes/markdown.tmLanguage distinguishes HTML comments, raw-text elements,
// blank-line-terminated blocks and ordinary inline tags.
for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} preserves HTML container boundaries`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    const registry = new textmate.Registry({ onigLib: Promise.resolve(oniguruma),
      loadGrammar: async scope => scope === "text.html.basic" ? {
        scopeName: scope, patterns: [{ match: ".", name: "text.html.control" }],
      } : loadGrammar(raw, scope) });
    try {
      const grammar = await registry.loadGrammar(raw.scopeName);
      const mismatches = [];
      for (const fixture of require("./fixtures/textmate-html-context.json")) {
        let state = textmate.INITIAL;
        const actual = fixture.lines.map(line => {
          const result = grammar.tokenizeLine(line, state);
          state = result.ruleStack;
          return {
            fenced: result.tokens.some(token => token.scopes.some(scope => scope.startsWith("markup.fenced_code.block.markdown"))),
            htmlComment: result.tokens.some(token => token.scopes.includes("comment.block.html")),
          };
        });
        if (JSON.stringify(actual) !== JSON.stringify(fixture.states)) mismatches.push({ ...fixture, actual });
      }
      assert.deepEqual(mismatches, []);
    } finally { registry.dispose(); }
  });
}

// Actual TextMate execution of getgauge/gauge-vscode
// syntaxes/markdown.tmLanguage gives every tag in this inline HTML line
// the scopes supplied by the external HTML grammar.
for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} decorates line-start inline HTML without retaining a block`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    const registry = new textmate.Registry({ onigLib: Promise.resolve(oniguruma),
      loadGrammar: async scope => scope === "text.html.basic" ? {
        scopeName: scope, patterns: [{ match: "</?([A-Za-z]+)>", captures: { 1: { name: "entity.name.tag.html" } } }],
      } : loadGrammar(raw, scope) });
    try {
      const grammar = await registry.loadGrammar(raw.scopeName);
      for (const indent of ["", "   "]) {
        const line = indent + "<span><b>text</b></span>";
        const result = grammar.tokenizeLine(line, textmate.INITIAL);
        assert.deepEqual(result.tokens.filter(token => token.scopes.includes("entity.name.tag.html"))
          .map(token => line.slice(token.startIndex, token.endIndex)), ["span", "b", "b", "span"]);
        const after = grammar.tokenizeLine("* After <value>", result.ruleStack);
        assert.ok(after.tokens.some(token => token.scopes.includes("keyword.operator.step.gauge")));
        assert.ok(after.tokens.some(token => token.scopes.includes("variable.parameter.dynamic.gauge")));
      }
    } finally { registry.dispose(); }
  });
}

// Actual TextMate execution of getgauge/gauge-vscode
// syntaxes/markdown.tmLanguage retains inline HTML state on space-indented
// paragraph continuations and resolves Markdown code/links before HTML.
for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} preserves inline HTML in paragraph and list prose`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    const registry = new textmate.Registry({ onigLib: Promise.resolve(oniguruma),
      loadGrammar: async scope => scope === "text.html.basic" ? {
        scopeName: scope, patterns: [
          { begin: "<!--", end: "-->", name: "comment.block.html" },
          { begin: "</?([A-Za-z]+)", beginCaptures: { 1: { name: "entity.name.tag.html" } }, end: ">",
            patterns: [{ match: "class", name: "entity.other.attribute-name.html" }] },
        ],
      } : loadGrammar(raw, scope) });
    try {
      const grammar = await registry.loadGrammar(raw.scopeName);
      const fixtures = [
        { lines: ["before <b>text</b> after"], tags: [["b", "b"]], attributes: [false], comments: [false] },
        { lines: ["before **<b>text</b>** after"], tags: [["b", "b"]], attributes: [false], comments: [false] },
        { lines: ["before `<b>text</b>` after"], tags: [[]], attributes: [false], comments: [false] },
        { lines: ["before [<b>text</b>](https://example.test)"], tags: [[]], attributes: [false], comments: [false] },
        { lines: ["before <!-- hidden", "    <b>hidden</b>", "    --> after <i>visible</i>"], tags: [[], [], ["i", "i"]], attributes: [false, false, false], comments: [true, true, true] },
        { lines: ["before <span", "    class=\"note\">inside</span>"], tags: [["span"], ["span"]], attributes: [false, true], comments: [false, false] },
      ];
      for (const prefix of ["", "   ", "- ", "> "]) for (const fixture of fixtures) {
        let state = textmate.INITIAL;
        const actual = fixture.lines.map((source, index) => {
          const line = (prefix === "- " && index > 0 ? "    " : prefix) + source;
          const result = grammar.tokenizeLine(line, state); state = result.ruleStack;
          return {
            tags: result.tokens.filter(token => token.scopes.includes("entity.name.tag.html")).map(token => line.slice(token.startIndex, token.endIndex)),
            attributes: result.tokens.some(token => token.scopes.includes("entity.other.attribute-name.html")),
            comments: result.tokens.some(token => token.scopes.includes("comment.block.html")),
          };
        });
        assert.deepEqual(actual.map(row => row.tags), fixture.tags, prefix + fixture.lines.join("\n"));
        assert.deepEqual(actual.map(row => row.attributes), fixture.attributes);
        assert.deepEqual(actual.map(row => row.comments), fixture.comments);
        state = grammar.tokenizeLine("", state).ruleStack;
        const after = grammar.tokenizeLine("* After <value>", state);
        assert.ok(after.tokens.some(token => token.scopes.includes("keyword.operator.step.gauge")));
        assert.ok(after.tokens.some(token => token.scopes.includes("variable.parameter.dynamic.gauge")));
      }
    } finally { registry.dispose(); }
  });
}
