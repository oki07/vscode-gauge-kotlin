"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const textmate = require("vscode-textmate");
const oniguruma = require("vscode-oniguruma");

const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"));
const ready = oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));

// getgauge/gauge-vscode syntaxes/markdown.tmLanguage terminates the embedded
// body with a while rule before processing the closing fence. Its real
// TextMate execution releases text.git-commit's persistent message state.
for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} closes fences with persistent embedded state`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    const nested = { begin: "^payload", end: "(?!)", name: "meta.persistent.external" };
    const registry = new textmate.Registry({
      onigLib: Promise.resolve(oniguruma),
      loadGrammar: async (scope) => scope === raw.scopeName ? raw : {
        scopeName: scope, patterns: [nested], repository: { language: { patterns: [nested] } },
      },
    });
    try {
      const grammar = await registry.loadGrammar(raw.scopeName);
      for (const alias of [
        "css", "html", "ini", "java", "lua", "makefile", "perl", "r", "ruby", "php",
        "sql", "vb", "xml", "xsl", "yaml", "bat", "clojure", "coffee", "c", "cpp",
        "diff", "dockerfile", "COMMIT_EDITMSG", "git-rebase-todo", "go", "groovy",
        "jade", "js", "regexp", "json", "less", "objectivec", "scss", "perl6",
        "powershell", "python", "re", "rust", "scala", "shell", "typescript", "tsx",
        "csharp", "fsharp", "kotlin",
      ]) {
        for (const fence of ["```", "~~~"]) {
          let state = textmate.INITIAL;
          const tokenize = (line) => {
            const result = grammar.tokenizeLine(line, state);
            state = result.ruleStack;
            return result.tokens;
          };
          tokenize(fence + alias);
          assert.ok(tokenize("payload").some((token) => token.scopes.includes("meta.persistent.external")), alias);
          assert.ok(tokenize("still embedded").some((token) => token.scopes.includes("meta.persistent.external")), alias);
          assert.ok(tokenize(fence.slice(0, 2)).some((token) => token.scopes.includes("meta.persistent.external")), alias + " short marker stays embedded");
          tokenize(fence);
          const step = tokenize("* After <argument>");
          assert.ok(step.some((token) => token.scopes.includes("keyword.operator.step.gauge")), alias + " step after fence");
          assert.ok(step.every((token) => !token.scopes.includes("meta.persistent.external")), alias + " releases external state");
        }
      }
    } finally {
      registry.dispose();
    }
  });
}

// Real TextMate execution of getgauge/gauge-vscode
// syntaxes/markdown.tmLanguage assigns HTML tag scopes inside PHP fences,
// including when the external PHP grammar contributes no usable rules.
for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} resolves HTML inside PHP fences`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    for (const phpAvailable of [false, true]) {
      const registry = new textmate.Registry({
        onigLib: Promise.resolve(oniguruma),
        loadGrammar: async (scope) => {
          if (scope === raw.scopeName) return raw;
          if (scope === "text.html.basic") return {
            scopeName: scope,
            patterns: [{ match: "</?(strong)", captures: { 1: { name: "entity.name.tag.html" } } }],
          };
          if (scope === "text.html.php" && phpAvailable) return {
            scopeName: scope, patterns: [], repository: {
              language: { patterns: [{ match: "echo", name: "keyword.control.php" }] },
            },
          };
          return null;
        },
      });
      try {
        const grammar = await registry.loadGrammar(raw.scopeName);
        for (const alias of ["php", "php3", "php4", "php5", "phpt", "phtml", "aw", "ctp"]) {
          for (const fence of ["```", "~~~"]) {
            let state = grammar.tokenizeLine(fence + alias, textmate.INITIAL).ruleStack;
            const line = '<?php echo "hello"; ?><strong class="note">world</strong>';
            const result = grammar.tokenizeLine(line, state);
            const tags = result.tokens.filter((token) => token.scopes.includes("entity.name.tag.html"));
            assert.deepEqual(tags.map((token) => line.slice(token.startIndex, token.endIndex)), ["strong", "strong"], alias);
            assert.equal(result.tokens.some((token) => token.scopes.includes("keyword.control.php")), phpAvailable);
            state = grammar.tokenizeLine(fence, result.ruleStack).ruleStack;
            assert.ok(grammar.tokenizeLine("* After <argument>", state).tokens.some((token) => token.scopes.includes("keyword.operator.step.gauge")));
          }
        }
      } finally {
        registry.dispose();
      }
    }
  });
}
