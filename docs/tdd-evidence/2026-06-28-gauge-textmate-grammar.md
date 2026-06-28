# Gauge TextMate grammar

Parity item: SRC-ED-005

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/highlight/HighlighterTokens.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/highlight/SpecSyntaxHighlighter.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/highlight/ConceptSyntaxHighlighter.java`
- `references/gauge-vscode/syntaxes/markdown.tmLanguage`

Behavior:
- The extension should contribute a Gauge-specific TextMate grammar instead of reusing the Markdown grammar scope.
- The grammar should expose Gauge token groups for comments, tags, headings, steps, tables, static arguments, and dynamic arguments.

RED:
- Command: `node --test --test-name-pattern "TextMate grammar|core Gauge VS Code surface" test/manifest.test.js`
- Result: failed 2 of 2. The manifest still contributed `text.html.markdown` from `./syntaxes/markdown.tmLanguage`.

GREEN:
- Command: `node --test --test-name-pattern "TextMate grammar|core Gauge VS Code surface" test/manifest.test.js`
- Result: passed 2 of 2.

Related:
- Command: `node --test test/manifest.test.js test/extension.test.js && node -e 'JSON.parse(require("node:fs").readFileSync("syntaxes/gauge.tmLanguage.json", "utf8")); console.log("grammar json ok")'`
- Result: passed 26 of 26 and parsed the grammar JSON.

Broad:
- Command: `npm run check`
- Result: passed. Unit 600 of 600, LSP 22 of 22, VS Code 26 of 26, package succeeded.
