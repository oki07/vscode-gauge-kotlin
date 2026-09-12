"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const textmate = require("vscode-textmate");
const oniguruma = require("vscode-oniguruma");

const embeddedAliases = [
  "css", "html", "ini", "java", "lua", "makefile", "perl", "r", "ruby", "php",
  "sql", "vb", "xml", "xsl", "yaml", "bat", "clojure", "coffee", "c", "cpp",
  "diff", "dockerfile", "COMMIT_EDITMSG", "git-rebase-todo", "go", "groovy",
  "jade", "js", "regexp", "json", "less", "objectivec", "scss", "perl6",
  "powershell", "python", "re", "rust", "scala", "shell", "typescript", "tsx",
  "csharp", "fsharp", "kotlin",
];

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
      for (const alias of embeddedAliases) {
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

// Real TextMate execution of getgauge/gauge-vscode
// syntaxes/markdown.tmLanguage closes a fence only when its marker characters
// and count equal the opener, including for unknown language labels.
for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} matches closing fence markers to the opener`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    const registry = new textmate.Registry({
      onigLib: Promise.resolve(oniguruma),
      loadGrammar: async (scope) => scope === raw.scopeName ? raw : {
        scopeName: scope, patterns: [{ match: "payload", name: "source.external.fixture" }],
        repository: { language: { patterns: [{ match: "payload", name: "source.external.fixture" }] } },
      },
    });
    try {
      const grammar = await registry.loadGrammar(raw.scopeName);
      for (const alias of [...embeddedAliases, "unknown", ""]) {
        for (const opening of ["```", "````", "~~~", "~~~~"]) {
          for (const closing of ["```", "````", "`````", "~~~", "~~~~", "~~~~~"]) {
            let state = textmate.INITIAL;
            let result;
            for (const line of [opening + alias, "payload", closing, "* After <argument>"]) {
              result = grammar.tokenizeLine(line, state);
              state = result.ruleStack;
            }
            const isStep = result.tokens.some((token) => token.scopes.includes("keyword.operator.step.gauge"));
            assert.equal(isStep, opening === closing, JSON.stringify({ alias, opening, closing }));
          }
        }
      }
    } finally {
      registry.dispose();
    }
  });
}

// Real TextMate execution of getgauge/gauge-vscode
// syntaxes/markdown.tmLanguage accepts indented openers. Closing indentation
// matches the opener or contains at most three whitespace characters.
for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} preserves opening and closing fence indentation`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    const registry = new textmate.Registry({
      onigLib: Promise.resolve(oniguruma),
      loadGrammar: async (scope) => scope === raw.scopeName ? raw : {
        scopeName: scope, patterns: [{ match: "payload", name: "source.external.fixture" }],
        repository: { language: { patterns: [{ match: "payload", name: "source.external.fixture" }] } },
      },
    });
    try {
      const grammar = await registry.loadGrammar(raw.scopeName);
      for (const alias of [...embeddedAliases, "unknown", ""]) {
        for (const marker of ["```", "~~~"]) {
          for (const openingIndent of ["", " ", "  ", "   ", "    ", "        ", "\t", " \t"]) {
            for (const closingIndent of ["", " ", "  ", "   ", "    ", "        ", "\t"]) {
              let state = grammar.tokenizeLine(openingIndent + marker + alias, textmate.INITIAL).ruleStack;
              let result = grammar.tokenizeLine("payload", state);
              assert.ok(result.tokens.some((token) => token.scopes.includes("markup.fenced_code.block.markdown.gauge")), JSON.stringify({ alias, openingIndent }));
              state = grammar.tokenizeLine(closingIndent + marker, result.ruleStack).ruleStack;
              result = grammar.tokenizeLine("* After <argument>", state);
              const isStep = result.tokens.some((token) => token.scopes.includes("keyword.operator.step.gauge"));
              assert.equal(isStep, closingIndent === openingIndent || closingIndent.length <= 3,
                JSON.stringify({ alias, openingIndent, closingIndent }));
            }
          }
        }
      }
    } finally {
      registry.dispose();
    }
  });
}

// Real TextMate execution of getgauge/gauge-vscode
// syntaxes/markdown.tmLanguage accepts arbitrary unknown fence information
// except backticks and tildes, including spaces, punctuation and attributes.
for (const filename of ["gauge.tmLanguage.json", "gauge-concept.tmLanguage.json"]) {
  test(`${filename} accepts unknown fenced-code information strings`, async () => {
    await ready;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes", filename), "utf8"));
    const registry = new textmate.Registry({
      onigLib: Promise.resolve(oniguruma),
      loadGrammar: async (scope) => scope === raw.scopeName ? raw : null,
    });
    try {
      const grammar = await registry.loadGrammar(raw.scopeName);
      for (const info of ["unknown title=sample", "foo.bar", "language/c++", "{.demo #id}", "text with spaces", "custom+lang", "unknown\tflag", "unknown `hint`", "unknown ~hint"]) {
        for (const fence of ["```", "````", "~~~", "~~~~"]) {
          for (const indent of ["", "    "]) {
            let state = grammar.tokenizeLine(indent + fence + info, textmate.INITIAL).ruleStack;
            const body = grammar.tokenizeLine("* Inside <argument>", state);
            const accepted = !/[`~]/.test(info);
            assert.equal(body.tokens.some((token) => token.scopes.includes("markup.fenced_code.block.markdown.gauge")), accepted, info);
            if (accepted) {
              state = grammar.tokenizeLine(indent + fence, body.ruleStack).ruleStack;
              assert.ok(grammar.tokenizeLine("* After <argument>", state).tokens.some((token) => token.scopes.includes("keyword.operator.step.gauge")));
            }
          }
        }
      }
    } finally {
      registry.dispose();
    }
  });
}
