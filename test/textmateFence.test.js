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
